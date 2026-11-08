CREATE TABLE IF NOT EXISTS family_contracts (
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  contract_id BIGINT NOT NULL REFERENCES customer_policy_contracts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id,contract_id)
);

CREATE TABLE IF NOT EXISTS family_contract_people (
  family_id BIGINT NOT NULL,
  contract_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('holder','insured')),
  PRIMARY KEY (family_id,contract_id,member_id,role),
  FOREIGN KEY (family_id,contract_id) REFERENCES family_contracts(family_id,contract_id) ON DELETE CASCADE,
  FOREIGN KEY (family_id,member_id) REFERENCES family_members(family_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS family_contract_people_member_idx ON family_contract_people(family_id,member_id,role);

CREATE TABLE IF NOT EXISTS family_member_coverage_profiles (
  family_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id,member_id),
  FOREIGN KEY (family_id,member_id) REFERENCES family_members(family_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS family_coverage_context (
  family_id BIGINT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
