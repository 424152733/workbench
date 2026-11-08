CREATE TABLE IF NOT EXISTS customer_policy_contracts (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  policy_id BIGINT REFERENCES policies(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size BIGINT NOT NULL DEFAULT 0,
  page_count INTEGER,
  parse_status TEXT NOT NULL DEFAULT 'ready' CHECK (parse_status IN ('ready','needs_ocr')),
  analysis_status TEXT NOT NULL DEFAULT '待整理' CHECK (analysis_status IN ('待整理','整理中','已整理','部分完成','已归档')),
  selected_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  chunk_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  extraction_data JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  selected_page_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  selected_char_count INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  omitted_page_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_policy_contracts_customer_idx
  ON customer_policy_contracts(customer_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS customer_policy_contracts_policy_idx
  ON customer_policy_contracts(policy_id) WHERE policy_id IS NOT NULL;
