CREATE TABLE content_publications (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES drafts(id) ON DELETE RESTRICT,
  platform TEXT NOT NULL CHECK (platform IN ('知乎','小红书','公众号')),
  topic_title_snapshot TEXT NOT NULL,
  title_snapshot TEXT NOT NULL,
  published_on DATE NOT NULL,
  published_time TIME,
  publish_url TEXT,
  note TEXT NOT NULL DEFAULT '',
  content_snapshot JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','legacy')),
  request_key UUID UNIQUE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ
);

CREATE TABLE content_publication_assets (
  publication_id BIGINT NOT NULL REFERENCES content_publications(id) ON DELETE RESTRICT,
  asset_id BIGINT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  file_name_snapshot TEXT NOT NULL,
  PRIMARY KEY (publication_id,position),
  UNIQUE (publication_id,asset_id)
);

CREATE TABLE content_publication_events (
  id BIGSERIAL PRIMARY KEY,
  publication_id BIGINT NOT NULL REFERENCES content_publications(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created','corrected','voided')),
  previous_values JSONB,
  next_values JSONB,
  reason TEXT NOT NULL DEFAULT '',
  request_key UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX content_publications_date_idx ON content_publications(published_on DESC,id DESC);
CREATE INDEX content_publications_platform_date_idx ON content_publications(platform,published_on DESC,id DESC);
CREATE INDEX content_publications_draft_date_idx ON content_publications(draft_id,published_on DESC,id DESC);
CREATE UNIQUE INDEX content_publications_legacy_draft_idx ON content_publications(draft_id) WHERE origin='legacy';
CREATE INDEX content_publication_events_publication_idx ON content_publication_events(publication_id,created_at,id);

INSERT INTO content_publications(draft_id,platform,topic_title_snapshot,title_snapshot,published_on,publish_url,origin)
SELECT d.id,d.platform,t.title,d.title,(d.published_at AT TIME ZONE 'Asia/Shanghai')::date,d.publish_url,'legacy'
FROM drafts d JOIN topics t ON t.id=d.topic_id
WHERE d.published_at IS NOT NULL
ON CONFLICT DO NOTHING;
