CREATE TABLE IF NOT EXISTS families (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  primary_customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_members (
  id BIGSERIAL PRIMARY KEY,
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
  guest_name TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT family_members_identity_check CHECK (
    (customer_id IS NOT NULL AND guest_name IS NULL) OR
    (customer_id IS NULL AND length(trim(guest_name)) BETWEEN 1 AND 100)
  ),
  CONSTRAINT family_members_family_customer_unique UNIQUE (family_id, customer_id),
  CONSTRAINT family_members_family_id_unique UNIQUE (family_id, id)
);
CREATE INDEX IF NOT EXISTS family_members_customer_idx ON family_members(customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS family_relationships (
  id BIGSERIAL PRIMARY KEY,
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_a_id BIGINT NOT NULL,
  member_b_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('partner','parent_child','sibling','other')),
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT family_relationships_distinct_members CHECK (member_a_id <> member_b_id),
  CONSTRAINT family_relationships_family_members_fk FOREIGN KEY (family_id, member_a_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE,
  CONSTRAINT family_relationships_family_members_b_fk FOREIGN KEY (family_id, member_b_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS family_relationships_pair_unique
  ON family_relationships(family_id, LEAST(member_a_id, member_b_id), GREATEST(member_a_id, member_b_id));

CREATE TABLE IF NOT EXISTS family_insured_objects (
  id BIGSERIAL PRIMARY KEY,
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('vehicle','home','property','other')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT family_insured_objects_family_id_unique UNIQUE (family_id, id)
);

CREATE TABLE IF NOT EXISTS family_policies (
  family_id BIGINT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  policy_id BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id, policy_id)
);

CREATE TABLE IF NOT EXISTS family_policy_people (
  family_id BIGINT NOT NULL,
  policy_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('holder','insured')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id, policy_id, member_id, role),
  CONSTRAINT family_policy_people_policy_fk FOREIGN KEY (family_id, policy_id)
    REFERENCES family_policies(family_id, policy_id) ON DELETE CASCADE,
  CONSTRAINT family_policy_people_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members(family_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS family_policy_people_member_idx ON family_policy_people(family_id, member_id, role);

CREATE TABLE IF NOT EXISTS family_policy_objects (
  family_id BIGINT NOT NULL,
  policy_id BIGINT NOT NULL,
  object_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id, policy_id, object_id),
  CONSTRAINT family_policy_objects_policy_fk FOREIGN KEY (family_id, policy_id)
    REFERENCES family_policies(family_id, policy_id) ON DELETE CASCADE,
  CONSTRAINT family_policy_objects_object_fk FOREIGN KEY (family_id, object_id)
    REFERENCES family_insured_objects(family_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS policy_coverage_tags (
  policy_id BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN ('medical','critical_illness','life','accident','auto','home','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_id, tag)
);
