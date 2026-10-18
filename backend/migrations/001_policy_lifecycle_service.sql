ALTER TABLE policies ADD COLUMN effective_date DATE;
ALTER TABLE policies ADD COLUMN next_payment_date DATE;
ALTER TABLE policies ADD COLUMN contract_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE policies ADD CONSTRAINT policies_contract_status_check CHECK (contract_status IN ('unknown','pending_effective','active','suspended','expired','terminated'));
ALTER TABLE policies ADD COLUMN status_confirmed_on DATE;
ALTER TABLE policies ADD COLUMN status_basis TEXT;
ALTER TABLE policies ADD COLUMN renewed_from_policy_id BIGINT REFERENCES policies(id) ON DELETE SET NULL;
CREATE INDEX policies_payment_date_idx ON policies(next_payment_date);

CREATE TABLE policy_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  policy_id BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX policy_lifecycle_events_policy_idx ON policy_lifecycle_events(policy_id,recorded_at DESC,id DESC);

CREATE TABLE policy_service_items (
  id BIGSERIAL PRIMARY KEY,
  policy_id BIGINT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('payment','renewal','endorsement','claim_inquiry','other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','waiting_customer','waiting_insurer','completed','cancelled')),
  anchor_date DATE,
  next_action_date DATE NOT NULL,
  outcome TEXT,
  closed_on DATE,
  closed_at TIMESTAMPTZ,
  request_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX policy_service_items_due_idx ON policy_service_items(status,next_action_date,id);
CREATE INDEX policy_service_items_policy_idx ON policy_service_items(policy_id,status,created_at DESC);
CREATE UNIQUE INDEX policy_service_items_open_cycle_idx ON policy_service_items(policy_id,kind,anchor_date)
  WHERE anchor_date IS NOT NULL AND status IN ('pending','in_progress','waiting_customer','waiting_insurer');

CREATE TABLE policy_service_item_events (
  id BIGSERIAL PRIMARY KEY,
  service_item_id BIGINT NOT NULL REFERENCES policy_service_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created','updated','progress','completed','cancelled')),
  from_status TEXT,
  to_status TEXT,
  from_next_action_date DATE,
  to_next_action_date DATE,
  note TEXT NOT NULL DEFAULT '',
  request_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX policy_service_item_events_item_idx ON policy_service_item_events(service_item_id,created_at DESC,id DESC);

ALTER TABLE customer_follow_up_tasks ADD COLUMN service_item_id BIGINT REFERENCES policy_service_items(id) ON DELETE CASCADE;
CREATE INDEX customer_follow_up_tasks_service_idx ON customer_follow_up_tasks(service_item_id,status,due_date);
ALTER TABLE follow_ups ADD COLUMN service_item_id BIGINT REFERENCES policy_service_items(id) ON DELETE CASCADE;
CREATE INDEX follow_ups_service_idx ON follow_ups(service_item_id,occurred_at DESC);
