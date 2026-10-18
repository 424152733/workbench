CREATE TABLE IF NOT EXISTS family_policy_coverage_tags (
  family_id BIGINT NOT NULL,
  policy_id BIGINT NOT NULL,
  tag TEXT NOT NULL CHECK (tag IN ('medical','critical_illness','life','accident','auto','home','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (family_id, policy_id, tag),
  CONSTRAINT family_policy_coverage_tags_policy_fk FOREIGN KEY (family_id, policy_id)
    REFERENCES family_policies(family_id, policy_id) ON DELETE CASCADE
);

INSERT INTO family_policy_coverage_tags(family_id,policy_id,tag)
SELECT fp.family_id,fp.policy_id,legacy.tag
FROM family_policies fp
JOIN policy_coverage_tags legacy ON legacy.policy_id=fp.policy_id
ON CONFLICT DO NOTHING;
