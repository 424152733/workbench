CREATE TABLE IF NOT EXISTS source_dictionary (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  phone_normalized TEXT,
  kind TEXT NOT NULL DEFAULT '新线索',
  stage TEXT NOT NULL DEFAULT '新线索',
  source_code TEXT NOT NULL REFERENCES source_dictionary(code),
  concern TEXT NOT NULL DEFAULT '待了解',
  contact_status TEXT NOT NULL DEFAULT '待确认联系偏好',
  preferred_contact TEXT,
  consent_at TIMESTAMPTZ,
  content_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_contact_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS customers_search_idx ON customers USING GIN (to_tsvector('simple', name || ' ' || COALESCE(phone, '') || ' ' || concern));
CREATE INDEX IF NOT EXISTS customers_source_idx ON customers(source_code);

CREATE TABLE IF NOT EXISTS customer_stage_history (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  insurance_type TEXT NOT NULL,
  policy_number TEXT,
  holder_name TEXT,
  insured_name TEXT,
  premium TEXT,
  coverage_summary TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  service_scope TEXT NOT NULL DEFAULT 'external',
  expiry_date DATE,
  document_asset_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS policies_expiry_idx ON policies(expiry_date);

CREATE TABLE IF NOT EXISTS follow_ups (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_method TEXT NOT NULL,
  note TEXT NOT NULL,
  next_followup DATE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS follow_ups_next_idx ON follow_ups(next_followup);

CREATE TABLE IF NOT EXISTS customer_follow_up_tasks (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  planned_method TEXT NOT NULL DEFAULT '其他',
  note TEXT NOT NULL DEFAULT '',
  due_date DATE NOT NULL,
  due_time TIME,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','customer_create','follow_up','legacy_migration')),
  source_follow_up_id BIGINT UNIQUE REFERENCES follow_ups(id) ON DELETE SET NULL,
  request_key TEXT UNIQUE,
  completed_follow_up_id BIGINT REFERENCES follow_ups(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_follow_up_tasks_due_idx ON customer_follow_up_tasks(status,due_date,due_time);
CREATE INDEX IF NOT EXISTS customer_follow_up_tasks_customer_idx ON customer_follow_up_tasks(customer_id,status,due_date,due_time);

CREATE TABLE IF NOT EXISTS customer_follow_up_task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES customer_follow_up_tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created','rescheduled','completed','cancelled')),
  from_due_date DATE,
  to_due_date DATE,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_follow_up_task_events_task_idx ON customer_follow_up_task_events(task_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '保险基础',
  insurance_type TEXT NOT NULL DEFAULT '未分类',
  status TEXT NOT NULL DEFAULT '选题中',
  due_date DATE,
  platforms JSONB NOT NULL DEFAULT '["知乎","小红书","公众号"]'::jsonb,
  generation_status TEXT NOT NULL DEFAULT 'idle',
  generation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE topics ADD COLUMN IF NOT EXISTS insurance_type TEXT NOT NULL DEFAULT '未分类';

CREATE TABLE IF NOT EXISTS drafts (
  id BIGSERIAL PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '',
  xhs_card_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT '草稿',
  humanized BOOLEAN NOT NULL DEFAULT FALSE,
  approval_checks JSONB NOT NULL DEFAULT '[false,false,false]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'demo',
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  publish_url TEXT,
  html_content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(topic_id, platform)
);
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS xhs_card_plan JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS draft_versions (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(draft_id, version)
);

CREATE TABLE IF NOT EXISTS assets (
  id BIGSERIAL PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
  platform TEXT,
  file_name TEXT NOT NULL,
  storage_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source_dictionary(code,label,sort_order) VALUES
 ('offline_visit','线下拜访',10),('referral','朋友转介绍',20),('event','门店/活动',30),
 ('zhihu','知乎',40),('xhs','小红书',50),('wechat','公众号',60),('other','其他',70),('unknown','未记录',80)
ON CONFLICT(code) DO NOTHING;

INSERT INTO settings(key,value) VALUES
 ('content', '{"autoEnabled":false,"frequencyDays":2,"runAt":"09:00","nextRunAt":null,"voice":"用大白话解释保险；先说结论；不编造数据、案例和个人经历；关键事实标注资料来源；免责和适用边界讲清楚。","wechatTheme":"clean","imageStyles":{"xhs":{"style":"sketch-notes","layout":"auto","palette":"macaron"},"article":{"type":"auto","style":"notion","palette":"macaron"}}}'::jsonb),
 ('preferences', '{"displayName":"保险顾问","startPage":"home","menuPosition":"left","notifications":true}'::jsonb)
ON CONFLICT(key) DO NOTHING;

INSERT INTO customers(name,phone,phone_normalized,kind,stage,source_code,concern,contact_status,preferred_contact,consent_at,created_at,last_contact_at)
SELECT '林女士',NULL,NULL,'新线索','需求了解中','offline_visit','家庭医疗保障','已确认可按所选方式联系','电话',NOW(),NOW() - INTERVAL '12 days',NOW() - INTERVAL '1 day'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name='林女士' AND source_code='offline_visit' AND concern='家庭医疗保障');
INSERT INTO customers(name,phone,phone_normalized,kind,stage,source_code,concern,contact_status,preferred_contact,consent_at,created_at,last_contact_at)
SELECT '周先生',NULL,NULL,'已有客户','已有客户','referral','车险续保','已确认可按所选方式联系','微信',NOW(),NOW() - INTERVAL '150 days',NOW() - INTERVAL '3 days'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name='周先生' AND source_code='referral' AND concern='车险续保');
INSERT INTO customers(name,phone,phone_normalized,kind,stage,source_code,concern,contact_status,preferred_contact,consent_at,created_at,last_contact_at)
SELECT '赵女士',NULL,NULL,'新线索','新线索','xhs','保险等待期','已确认可按所选方式联系','微信',NOW(),NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name='赵女士' AND source_code='xhs' AND concern='保险等待期');
INSERT INTO customers(name,phone,phone_normalized,kind,stage,source_code,concern,contact_status,preferred_contact,created_at,last_contact_at)
SELECT '陈先生',NULL,NULL,'新线索','已联系','wechat','免责条款怎么看','待确认联系偏好',NULL,NOW() - INTERVAL '1 day',NOW() - INTERVAL '1 day'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name='陈先生' AND source_code='wechat' AND concern='免责条款怎么看');

INSERT INTO policies(customer_id,company,policy_name,insurance_type,premium,coverage_summary,verified,service_scope,expiry_date)
SELECT c.id,'人保财险','家庭财产综合险','家财险','680 元/年','责任限额待核实',FALSE,'owned',CURRENT_DATE + 18 FROM customers c WHERE c.name='林女士' AND c.source_code='offline_visit' AND c.concern='家庭医疗保障'
AND NOT EXISTS (SELECT 1 FROM policies p WHERE p.customer_id=c.id AND p.policy_name='家庭财产综合险');
INSERT INTO policies(customer_id,company,policy_name,insurance_type,premium,coverage_summary,verified,service_scope,expiry_date)
SELECT c.id,'人保财险','机动车商业保险','车险','3,280 元/年','责任限额已核实',TRUE,'owned',CURRENT_DATE + 4 FROM customers c WHERE c.name='周先生' AND c.source_code='referral' AND c.concern='车险续保'
AND NOT EXISTS (SELECT 1 FROM policies p WHERE p.customer_id=c.id AND p.policy_name='机动车商业保险');
INSERT INTO policies(customer_id,company,policy_name,insurance_type,premium,coverage_summary,verified,service_scope,expiry_date)
SELECT c.id,'新华保险','示例寿险（客户自有）','寿险','5,600 元/年','保额待核实',FALSE,'external',CURRENT_DATE + 540 FROM customers c WHERE c.name='周先生' AND c.source_code='referral' AND c.concern='车险续保'
AND NOT EXISTS (SELECT 1 FROM policies p WHERE p.customer_id=c.id AND p.policy_name='示例寿险（客户自有）');

INSERT INTO follow_ups(customer_id,contact_method,note,next_followup,occurred_at)
SELECT c.id,'电话','线下初次拜访，主要询问家庭医疗保障。客户同意下周再联系。',CURRENT_DATE,NOW() - INTERVAL '1 day' FROM customers c WHERE c.name='林女士' AND c.source_code='offline_visit' AND c.concern='家庭医疗保障'
AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.customer_id=c.id);
INSERT INTO follow_ups(customer_id,contact_method,note,next_followup,occurred_at)
SELECT c.id,'微信','客户希望续保前提醒，已有寿险保单资料还未核对。',CURRENT_DATE + 1,NOW() - INTERVAL '3 days' FROM customers c WHERE c.name='周先生' AND c.source_code='referral' AND c.concern='车险续保'
AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.customer_id=c.id);

INSERT INTO customer_follow_up_tasks(customer_id,title,planned_method,note,due_date,status,source,source_follow_up_id)
SELECT DISTINCT ON (f.customer_id) f.customer_id,'旧提醒：'||left(f.note,72),f.contact_method,f.note,f.next_followup,'pending','legacy_migration',f.id
FROM follow_ups f
JOIN customers c ON c.id=f.customer_id
WHERE f.next_followup IS NOT NULL AND c.contact_status <> '已拒绝联系'
ORDER BY f.customer_id,f.occurred_at DESC,f.id DESC
ON CONFLICT (source_follow_up_id) DO NOTHING;

INSERT INTO customer_follow_up_task_events(task_id,action,to_due_date,note)
SELECT t.id,'created',t.due_date,'旧提醒迁入，建议核对'
FROM customer_follow_up_tasks t
WHERE t.source='legacy_migration'
  AND NOT EXISTS (SELECT 1 FROM customer_follow_up_task_events e WHERE e.task_id=t.id AND e.action='created');

INSERT INTO topics(id,title,category,status,due_date,platforms)
VALUES ('T-026','买保险时，等待期到底是什么意思？','误区澄清','待审核',CURRENT_DATE,'["知乎","小红书","公众号"]'),
 ('T-025','买了保险，为什么还要看免责条款？','条款翻译','草稿',CURRENT_DATE + 1,'["知乎","小红书","公众号"]'),
 ('T-024','车险续保前，先核对这几项','办事指南','选题中',CURRENT_DATE + 3,'["小红书","公众号"]')
ON CONFLICT(id) DO NOTHING;

INSERT INTO drafts(topic_id,platform,title,summary,body,hashtags,sources,status,humanized,provider,approval_checks)
SELECT 'T-026','知乎','买保险时，等待期到底是什么意思？','',
'先用一句话说：等待期是合同约定的一段时间。在这段时间内，某些保险责任暂时不生效；具体怎么约定，要看对应产品的保险条款。'||E'\n\n'||
'为什么会有等待期？它通常用于约定保障从什么时候开始。不同产品、不同责任的安排可能不同，不能只看一个统一天数。'||E'\n\n'||
'看条款时，建议重点找三件事：等待期多长、等待期内发生约定情况怎么处理、意外等其他责任是否适用同样约定。'||E'\n\n'||
'所以，“过了等待期就什么都能赔”也不准确。能不能赔，还要看保险责任、免责条款、事故情况和理赔材料。','','','待审核',FALSE,'demo','[false,false,false]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE topic_id='T-026' AND platform='知乎');
INSERT INTO drafts(topic_id,platform,title,summary,body,hashtags,sources,status,humanized,provider,approval_checks)
SELECT 'T-026','小红书','等待期是什么？买保险前用大白话讲清楚','',
'可以把等待期理解成：合同里约定的“保障开始时间”。'||E'\n\n'||
'但别只记一个天数：'||E'\n'||'✅ 不同产品可能不一样'||E'\n'||'✅ 不同保障责任也可能有不同约定'||E'\n'||'✅ 等待期内发生情况，合同会写清楚怎么处理'||E'\n\n'||
'看保单时，记得找“保险责任”和“责任免除”相关条款。到底适不适用，以你那份合同为准。','大话保险 保险科普 买保险前先看','','待审核',FALSE,'demo','[false,false,false]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE topic_id='T-026' AND platform='小红书');
INSERT INTO drafts(topic_id,platform,title,summary,body,hashtags,sources,status,humanized,provider,approval_checks)
SELECT 'T-026','公众号','大话保险｜等待期到底是什么意思？','用普通人听得懂的话，讲清保险里的常见说法。',
'有些朋友买保险后会问：“等待期是不是过了这段时间，之后发生的事就都能赔？”'||E'\n\n'||
'不是这么简单。'||E'\n\n'||
'等待期可以先理解成合同约定的保障开始时间。不同产品、不同保障责任的约定可能不同，等待期内发生约定情况时如何处理，也要回到具体条款里看。'||E'\n\n'||
'看保单时，可以先找等待期、保险责任和责任免除这几部分。如果条款里有不明白的地方，再结合自己的合同向保险公司或服务人员确认。'||E'\n\n'||
'这篇文章只解释一般概念，具体保障以保险合同和保险公司正式文件为准。','','','待审核',FALSE,'demo','[false,false,false]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM drafts WHERE topic_id='T-026' AND platform='公众号');
