ALTER TABLE product_company_dictionary
  ADD COLUMN IF NOT EXISTS adapter_code TEXT,
  ADD COLUMN IF NOT EXISTS sync_supported BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sync_coverage TEXT NOT NULL DEFAULT '';

INSERT INTO product_company_dictionary(code,label,is_active,sort_order,adapter_code,sync_supported,sync_enabled,sync_coverage)
VALUES
  ('xinhua','新华保险',TRUE,10,'xinhua',TRUE,TRUE,'个人寿险、健康险、意外险、年金险'),
  ('china-life','中国人寿',TRUE,20,'china-life',TRUE,TRUE,'个人寿险、健康险、意外险、年金险'),
  ('taikang','泰康人寿',TRUE,30,'taikang',TRUE,TRUE,'官网在售目录'),
  ('ping-an','平安人寿',TRUE,40,'ping-an',TRUE,TRUE,'官网在售目录'),
  ('cpic-life','太平洋人寿',TRUE,50,'cpic-life',TRUE,TRUE,'寿险、年金、意外险、健康险')
ON CONFLICT(code) DO UPDATE SET
  label=EXCLUDED.label,
  is_active=TRUE,
  sort_order=EXCLUDED.sort_order,
  adapter_code=EXCLUDED.adapter_code,
  sync_supported=EXCLUDED.sync_supported,
  sync_enabled=EXCLUDED.sync_enabled,
  sync_coverage=EXCLUDED.sync_coverage;

ALTER TABLE insurance_products
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_product_key TEXT,
  ADD COLUMN IF NOT EXISTS official_product_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_product_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS official_sale_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS sale_status_evidence_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_scope TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_run_id TEXT;

ALTER TABLE insurance_products
  DROP CONSTRAINT IF EXISTS insurance_products_company_code_product_name_product_version_key,
  DROP CONSTRAINT IF EXISTS insurance_products_company_code_product_name_product_versio_key;
ALTER TABLE insurance_products
  ADD CONSTRAINT insurance_products_source_type_check CHECK (source_type IN ('manual','official_sync')),
  ADD CONSTRAINT insurance_products_official_sale_status_check CHECK (official_sale_status IN ('unverified','verified_on_sale','review_required','confirmed_stopped')),
  ADD CONSTRAINT insurance_products_product_scope_check CHECK (product_scope IN ('individual','supplementary','group','unknown'));
CREATE UNIQUE INDEX IF NOT EXISTS insurance_products_manual_name_version_idx
  ON insurance_products(company_code,product_name,product_version) WHERE source_type='manual';
CREATE UNIQUE INDEX IF NOT EXISTS insurance_products_official_key_idx
  ON insurance_products(company_code,source_product_key) WHERE source_type='official_sync' AND source_product_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS insurance_products_sale_status_idx
  ON insurance_products(company_code,official_sale_status,last_verified_at DESC);

CREATE TABLE IF NOT EXISTS product_sync_runs (
  id TEXT PRIMARY KEY,
  company_code TEXT NOT NULL REFERENCES product_company_dictionary(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','success','partial_success','failed')),
  phase TEXT NOT NULL DEFAULT 'queued',
  discovered_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  material_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_sync_runs_one_active_company_idx
  ON product_sync_runs(company_code) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS product_sync_runs_company_created_idx
  ON product_sync_runs(company_code,created_at DESC);

CREATE TABLE IF NOT EXISTS product_sync_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES product_sync_runs(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES insurance_products(id) ON DELETE SET NULL,
  product_key TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS product_sync_events_run_idx ON product_sync_events(run_id,id);

CREATE TABLE IF NOT EXISTS product_official_materials (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES insurance_products(id) ON DELETE CASCADE,
  material_type TEXT NOT NULL CHECK(material_type IN ('policy_terms','product_brief','brochure','rate_table','cash_value','other')),
  label TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_page_url TEXT NOT NULL DEFAULT '',
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_run_id TEXT REFERENCES product_sync_runs(id) ON DELETE SET NULL,
  UNIQUE(product_id,source_key)
);
CREATE INDEX IF NOT EXISTS product_official_materials_product_idx
  ON product_official_materials(product_id,is_current,material_type,id);

ALTER TABLE product_documents
  DROP CONSTRAINT IF EXISTS product_documents_document_type_check;
ALTER TABLE product_documents
  ADD CONSTRAINT product_documents_document_type_check
    CHECK (document_type IN ('policy_terms','product_brief','brochure','rate_table','cash_value','other')),
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_page_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE product_documents
  ADD CONSTRAINT product_documents_source_type_check CHECK(source_type IN ('manual','official_sync'));
