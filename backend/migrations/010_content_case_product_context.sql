ALTER TABLE content_topic_cases
  ADD COLUMN IF NOT EXISTS financial_details TEXT NOT NULL DEFAULT '';
