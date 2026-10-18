CREATE TABLE customer_acquisition (
  customer_id BIGINT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  initial_kind TEXT NOT NULL,
  source_code TEXT NOT NULL REFERENCES source_dictionary(code),
  basis TEXT NOT NULL CHECK (basis IN ('captured','legacy_snapshot','manually_confirmed')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE customer_acquisition_corrections (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  previous_initial_kind TEXT NOT NULL,
  next_initial_kind TEXT NOT NULL,
  previous_source_code TEXT NOT NULL REFERENCES source_dictionary(code),
  next_source_code TEXT NOT NULL REFERENCES source_dictionary(code),
  previous_basis TEXT NOT NULL CHECK (previous_basis IN ('captured','legacy_snapshot','manually_confirmed')),
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO customer_acquisition(customer_id,initial_kind,source_code,basis,recorded_at)
SELECT id,kind,source_code,'legacy_snapshot',NOW()
FROM customers
ON CONFLICT(customer_id) DO NOTHING;

CREATE OR REPLACE FUNCTION capture_customer_acquisition_snapshot() RETURNS trigger AS $$
BEGIN
  INSERT INTO customer_acquisition(customer_id,initial_kind,source_code,basis,recorded_at)
  VALUES(NEW.id,NEW.kind,NEW.source_code,'captured',NOW())
  ON CONFLICT(customer_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customers_capture_acquisition_after_insert
AFTER INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION capture_customer_acquisition_snapshot();

CREATE INDEX customer_acquisition_source_kind_idx ON customer_acquisition(source_code,initial_kind);
CREATE INDEX customer_acquisition_corrections_customer_idx ON customer_acquisition_corrections(customer_id,recorded_at DESC);
CREATE INDEX customers_created_at_idx ON customers(created_at);
CREATE INDEX customer_stage_history_analytics_idx ON customer_stage_history(customer_id,changed_at,to_stage);
