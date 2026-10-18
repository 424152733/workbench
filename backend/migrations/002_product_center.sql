CREATE TABLE product_company_dictionary (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_insurance_type_dictionary (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO product_company_dictionary(code,label,is_active,sort_order)
VALUES ('xinhua','新华保险',TRUE,10)
ON CONFLICT(code) DO NOTHING;

INSERT INTO product_insurance_type_dictionary(code,label,is_active,sort_order) VALUES
 ('life','寿险',TRUE,10),
 ('health','健康险',TRUE,20),
 ('accident','意外险',TRUE,30),
 ('annuity','年金/养老险',TRUE,40),
 ('property','财险',TRUE,50),
 ('comprehensive','综合保险',TRUE,60)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE insurance_products (
  id BIGSERIAL PRIMARY KEY,
  company_code TEXT NOT NULL REFERENCES product_company_dictionary(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  insurance_type_code TEXT NOT NULL REFERENCES product_insurance_type_dictionary(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  product_version TEXT NOT NULL DEFAULT '',
  effective_date DATE,
  status TEXT NOT NULL DEFAULT '整理中' CHECK (status IN ('整理中','可用','已停用')),
  note TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_code,product_name,product_version)
);
CREATE INDEX insurance_products_company_status_idx ON insurance_products(company_code,status,updated_at DESC);
CREATE INDEX insurance_products_type_idx ON insurance_products(insurance_type_code,status,updated_at DESC);

CREATE TABLE product_documents (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES insurance_products(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL DEFAULT 'product_brief' CHECK (document_type IN ('policy_terms','product_brief','brochure','other')),
  file_name TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  parse_status TEXT NOT NULL DEFAULT 'processing' CHECK (parse_status IN ('processing','parsed','needs_review','failed')),
  parse_error TEXT,
  page_count INTEGER,
  extracted_char_count INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL DEFAULT '',
  extracted_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX product_documents_product_idx ON product_documents(product_id,created_at DESC,id DESC);

CREATE TABLE product_extractions (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES insurance_products(id) ON DELETE CASCADE,
  document_id BIGINT NOT NULL REFERENCES product_documents(id) ON DELETE CASCADE,
  positioning TEXT NOT NULL DEFAULT '',
  facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT '待核对' CHECK (status IN ('待核对','已确认')),
  provider TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX product_extractions_product_idx ON product_extractions(product_id,created_at DESC,id DESC);
CREATE INDEX product_extractions_document_idx ON product_extractions(document_id,created_at DESC,id DESC);

CREATE TABLE product_copy_drafts (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES insurance_products(id) ON DELETE CASCADE,
  extraction_id BIGINT NOT NULL REFERENCES product_extractions(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('知乎','小红书','公众号')),
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '待审核' CHECK (status IN ('草稿','待审核','已审核')),
  approval_checks JSONB NOT NULL DEFAULT '[false,false,false]'::jsonb,
  provider TEXT NOT NULL DEFAULT '',
  humanized BOOLEAN NOT NULL DEFAULT FALSE,
  html_content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(extraction_id,platform)
);
CREATE INDEX product_copy_drafts_product_status_idx ON product_copy_drafts(product_id,status,updated_at DESC);

CREATE TABLE product_copy_versions (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES product_copy_drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(draft_id,version)
);
CREATE INDEX product_copy_versions_draft_idx ON product_copy_versions(draft_id,version DESC);
