CREATE TABLE IF NOT EXISTS content_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  default_platforms JSONB NOT NULL DEFAULT '["知乎","小红书","公众号"]'::jsonb,
  prompt_key TEXT NOT NULL,
  review_key TEXT NOT NULL
);

INSERT INTO content_types(code,name,description,sort_order,prompt_key,review_key) VALUES
  ('insurance_education','大话保险','保险知识科普、常见误区和办理事项',10,'insurance_education','general'),
  ('product_explainer','产品解读','依据产品中心已确认资料解读具体产品',20,'product_explainer','product'),
  ('customer_case','客户案例','通过脱敏案例说明需求分析和保障思路',30,'customer_case','case')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE topics ADD COLUMN IF NOT EXISTS content_type_code TEXT NOT NULL DEFAULT 'insurance_education'
  REFERENCES content_types(code) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS topics_content_type_updated_idx ON topics(content_type_code,updated_at DESC,created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_extractions_product_id_id_key') THEN
    ALTER TABLE product_extractions ADD CONSTRAINT product_extractions_product_id_id_key UNIQUE(product_id,id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS content_topic_products (
  topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES insurance_products(id) ON DELETE RESTRICT,
  extraction_id BIGINT NOT NULL,
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(product_id,extraction_id) REFERENCES product_extractions(product_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS content_topic_products_product_idx ON content_topic_products(product_id,created_at DESC);

CREATE TABLE IF NOT EXISTS content_topic_cases (
  topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
  case_kind TEXT NOT NULL CHECK(case_kind IN ('authorized_real','composite','scenario')),
  summary TEXT NOT NULL DEFAULT '',
  needs TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  authorization_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  anonymization_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE content_publications ADD COLUMN IF NOT EXISTS content_type_code TEXT NOT NULL DEFAULT 'insurance_education'
  REFERENCES content_types(code) ON UPDATE CASCADE ON DELETE RESTRICT;
UPDATE content_publications p SET content_type_code=t.content_type_code
FROM drafts d JOIN topics t ON t.id=d.topic_id
WHERE p.draft_id=d.id AND p.content_type_code='insurance_education' AND t.content_type_code<>'insurance_education';
CREATE INDEX IF NOT EXISTS content_publications_type_date_idx ON content_publications(content_type_code,published_on DESC,id DESC);

CREATE TABLE IF NOT EXISTS product_copy_draft_migration_map (
  legacy_draft_id BIGINT PRIMARY KEY REFERENCES product_copy_drafts(id) ON DELETE CASCADE,
  content_topic_id TEXT NOT NULL,
  content_draft_id BIGINT NOT NULL,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(content_draft_id)
);

INSERT INTO topics(id,title,category,insurance_type,status,due_date,platforms,content_type_code)
SELECT 'PX-' || e.id::text,
  COALESCE(NULLIF(BTRIM(e.positioning),''),p.product_name || '产品解读'),
  '产品解读',COALESCE(NULLIF(t.label,''),'未分类'),'草稿',NULL,
  jsonb_agg(DISTINCT to_jsonb(pcd.platform) ORDER BY to_jsonb(pcd.platform)),
  'product_explainer'
FROM product_copy_drafts pcd
JOIN product_extractions e ON e.id=pcd.extraction_id AND e.product_id=pcd.product_id
JOIN insurance_products p ON p.id=pcd.product_id
LEFT JOIN product_insurance_type_dictionary t ON t.code=p.insurance_type_code
GROUP BY e.id,e.positioning,p.product_name,t.label
ON CONFLICT(id) DO NOTHING;

INSERT INTO content_topic_products(topic_id,product_id,extraction_id,source_snapshot)
SELECT 'PX-' || e.id::text,p.id,e.id,
  jsonb_build_object('productId',p.id,'productName',p.product_name,'shortName',p.short_name,
    'productVersion',p.product_version,'effectiveDate',p.effective_date,'extractionId',e.id,
    'confirmedAt',e.confirmed_at,'status',e.status,'facts',e.facts,'openQuestions',e.open_questions,
    'documentId',doc.id,'documentName',doc.file_name,'positioning',e.positioning)
FROM product_extractions e
JOIN insurance_products p ON p.id=e.product_id
JOIN product_documents doc ON doc.id=e.document_id
WHERE EXISTS(SELECT 1 FROM product_copy_drafts pcd WHERE pcd.extraction_id=e.id)
ON CONFLICT(topic_id) DO NOTHING;

INSERT INTO drafts(topic_id,platform,title,summary,body,hashtags,sources,status,humanized,approval_checks,provider,approved_at,html_content,created_at,updated_at)
SELECT 'PX-' || e.id::text,pcd.platform,pcd.title,pcd.summary,pcd.body,pcd.hashtags,pcd.sources,
  CASE WHEN e.status='已确认' THEN pcd.status ELSE '草稿' END,
  pcd.humanized,
  CASE WHEN e.status='已确认' THEN pcd.approval_checks ELSE '[false,false,false]'::jsonb END,
  pcd.provider,CASE WHEN e.status='已确认' THEN pcd.approved_at ELSE NULL END,pcd.html_content,pcd.created_at,pcd.updated_at
FROM product_copy_drafts pcd JOIN product_extractions e ON e.id=pcd.extraction_id
WHERE NOT EXISTS(SELECT 1 FROM drafts d WHERE d.topic_id='PX-' || e.id::text AND d.platform=pcd.platform)
ON CONFLICT(topic_id,platform) DO NOTHING;

INSERT INTO product_copy_draft_migration_map(legacy_draft_id,content_topic_id,content_draft_id)
SELECT pcd.id,'PX-' || e.id::text,d.id
FROM product_copy_drafts pcd JOIN product_extractions e ON e.id=pcd.extraction_id
JOIN drafts d ON d.topic_id='PX-' || e.id::text AND d.platform=pcd.platform
ON CONFLICT(legacy_draft_id) DO NOTHING;

INSERT INTO draft_versions(draft_id,version,snapshot,changed_by,created_at)
SELECT m.content_draft_id,v.version,
  v.snapshot || jsonb_build_object('source','product-center-legacy','legacyDraftId',m.legacy_draft_id),
  v.changed_by,v.created_at
FROM product_copy_versions v
JOIN product_copy_draft_migration_map m ON m.legacy_draft_id=v.draft_id
ON CONFLICT(draft_id,version) DO NOTHING;

DO $$ BEGIN
  IF (SELECT COUNT(*) FROM product_copy_drafts) <> (SELECT COUNT(*) FROM product_copy_draft_migration_map) THEN
    RAISE EXCEPTION 'Product copy migration is incomplete: legacy draft count does not match migration map';
  END IF;
  IF (SELECT COUNT(*) FROM product_copy_versions) <> (
    SELECT COUNT(*) FROM draft_versions WHERE snapshot->>'source'='product-center-legacy'
  ) THEN
    RAISE EXCEPTION 'Product copy migration is incomplete: legacy version count does not match migrated versions';
  END IF;
END $$;
