CREATE TABLE IF NOT EXISTS work_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  series_id UUID,
  repeat_until DATE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  category TEXT NOT NULL DEFAULT '客户活动' CHECK (category IN ('客户活动','客户服务','团队事项','培训学习','其他')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (end_time IS NULL OR start_time IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS work_calendar_events_dates_idx ON work_calendar_events(start_date,end_date,start_time,id);
CREATE INDEX IF NOT EXISTS work_calendar_events_series_idx ON work_calendar_events(series_id,start_date) WHERE series_id IS NOT NULL;
