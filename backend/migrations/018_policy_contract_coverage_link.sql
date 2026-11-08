ALTER TABLE customer_policy_contracts
  ADD COLUMN IF NOT EXISTS coverage_excluded_at TIMESTAMPTZ;
