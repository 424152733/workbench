ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS basic_sum_insured JSONB;

ALTER TABLE customer_policy_contracts
  ADD COLUMN IF NOT EXISTS local_facts JSONB NOT NULL DEFAULT '{}'::jsonb;
