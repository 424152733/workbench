CREATE TABLE product_platform_settings (
  platform TEXT PRIMARY KEY CHECK (platform IN ('知乎','小红书','公众号')),
  audience TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  structure TEXT NOT NULL DEFAULT '',
  length_hint TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO product_platform_settings(platform,audience,tone,structure,length_hint) VALUES
 ('知乎','正在了解保险产品、希望理解责任和限制的普通读者','像认真回答问题的保险顾问，先说结论，再解释依据；克制、具体、易懂','从一个明确疑问切入；按产品事实、适用条件、责任边界分段；结尾列出核对事项','中长篇，信息完整，避免重复和空泛铺垫'),
 ('小红书','使用手机快速阅读、希望先抓住重点的普通读者','自然、口语、简洁；不制造焦虑，不写强推销语气','短标题；用清楚的小标题或图标序号分组；突出少量关键特点和适用边界','短篇，段落短，优先保留最重要的 3–5 个信息点'),
 ('公众号','希望系统了解产品特点、适用条件和保障边界的读者','通俗、温和、解释充分；保持段落衔接，不写成硬广','包含标题、摘要、引入、特点与需求解释、适用条件、责任边界和总结','长文，可详细说明背景和边界，但避免同一观点反复表述')
ON CONFLICT(platform) DO NOTHING;
