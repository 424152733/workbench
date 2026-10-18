export const XHS_CARD_ROLES = Object.freeze([
  'cover',
  'concept',
  'misconception',
  'checklist',
  'boundary',
  'summary',
  'example',
  'comparison',
]);

export const XHS_CARD_MIN = 3;
export const XHS_CARD_MAX = 5;

export function normalizeXhsCardPlan(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) return null;
  if (allowEmpty && value.length === 0) return [];
  if (value.length < XHS_CARD_MIN || value.length > XHS_CARD_MAX) return null;

  const cards = [];
  for (const card of value) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
    const role = String(card.role || '').trim();
    const headline = String(card.headline || '').trim();
    const keyPoints = card.keyPoints;
    const visualDirection = String(card.visualDirection || '').trim();
    if (!XHS_CARD_ROLES.includes(role) || !headline || headline.length > 60) return null;
    if (!Array.isArray(keyPoints) || keyPoints.length < 1 || keyPoints.length > 4) return null;
    if (keyPoints.some((point) => typeof point !== 'string' || !point.trim() || point.trim().length > 160)) return null;
    if (visualDirection.length > 600) return null;
    cards.push({ role,headline,keyPoints:keyPoints.map((point) => point.trim()),visualDirection });
  }
  return cards;
}

// Draft editing persists in-progress values (for example, while a headline is
// temporarily empty). The strict normalizer remains the gate before humanizing
// or sending a plan to Baoyu.
export function normalizeEditableXhsCardPlan(value) {
  if (!Array.isArray(value) || value.length > XHS_CARD_MAX) return null;
  const cards = [];
  for (const card of value) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) return null;
    const role = String(card.role || 'concept').trim();
    if (!XHS_CARD_ROLES.includes(role)) return null;
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints.slice(0,4) : [];
    cards.push({
      role,
      headline:typeof card.headline === 'string' ? card.headline.slice(0,60) : '',
      keyPoints:keyPoints.map((point) => typeof point === 'string' ? point.slice(0,160) : ''),
      visualDirection:typeof card.visualDirection === 'string' ? card.visualDirection.slice(0,600) : '',
    });
  }
  return cards;
}

const platformGuidance = {
  知乎: `【知乎回答】
面向正在搜索具体疑问的读者。开头直接回答问题并说明结论适用范围；再解释概念和判断依据，讲清容易混淆的点、常见误区及需要核对的合同条件；需要时给核对清单，结尾回扣问题并说明适用边界。保持回答语气，不写公众号式导语，不加话题标签。按主题复杂度充分解释，不用重复内容凑长度。`,
  公众号: `【公众号文章】
面向愿意完整阅读一个主题的读者。提供可独立阅读的标题、摘要和正文；正文可按主题安排读者疑问或背景、核心概念、分节说明、实用核对方法、总结和保险边界。段落之间自然衔接，摘要与正文不要互相照抄。保持科普文章语气，不写成问答串或小红书文案。按主题复杂度充分解释，不用重复内容凑长度。`,
  小红书: `【小红书图文】
面向移动端快速浏览的读者，一条稿件聚焦一个问题。标题短而清楚；body 是精炼发布配文，只承担开场、图片未覆盖的补充说明、必要边界和自然互动，不要逐张复述图片文案。生成 3–5 张生产用 cardPlan，每张卡片承担不同角色，适合一眼读懂；测试生图时运行器只会取封面卡片。封面标题或一句核心结论可以有意重复，除此之外避免配文与卡片整段重复。不能为精简而删除重要免责、适用条件或合同差异。`,
};

function platformSchema(platform) {
  if (platform === '知乎') return '{"platform":"知乎","title":"","summary":"","body":"回答正文","hashtags":"","sources":""}';
  if (platform === '公众号') return '{"platform":"公众号","title":"","summary":"文章摘要","body":"文章正文","hashtags":"","sources":""}';
  return '{"platform":"小红书","title":"不超过20字","summary":"","body":"精炼发布配文","hashtags":"话题标签","sources":"","cardPlan":[{"role":"cover|concept|misconception|checklist|boundary|summary|example|comparison","headline":"卡片标题","keyPoints":["卡片要点"],"visualDirection":"画面说明"}]}';
}

export function buildDraftGenerationPrompt({ title, category, platforms, voice = '', materials = '' }) {
  const selectedPlatforms = [...new Set((platforms || []).filter((platform) => platformGuidance[platform]))];
  if (!selectedPlatforms.length) throw new TypeError('至少需要一个有效的发布平台');
  const instructions = [
    '你是“大话保险”的中文保险科普编辑，服务对象是不了解保险术语的普通消费者。',
    '只根据输入选题和用户明确提供的正式资料写作。不得编造产品条款、政策、数字、理赔结果、真实客户经历或资料来源。没有可核实来源时，sources 留空，并以谨慎措辞提醒读者查正式合同或文件。一般科普不得伪装成针对个人的承保或理赔建议。',
    '用自然大白话解释术语，清楚说明不同合同、产品、地区和责任可能不同。保持事实的确定程度，不把“可能”写成“必然”。不使用“第一步”“第几步”等僵硬过渡，不使用 Markdown 粗体语法或输出 ** 符号。需要分组时可用自然小标题、①②③、✅或⭐，只有内容确实是操作流程时才分步说明。',
    '同一选题的多平台稿件必须重新组织论述以适配各自的阅读目标。可以共享已核实的核心事实，但不要复用同一篇正文再换标题或格式；不要为了拉长文章重复结论、免责声明或同一段内容。篇幅按主题复杂度决定，讲完整即可，不凑字数。',
    `栏目表达设定：${voice || '用大白话解释保险；先给结论；不编造事实；关键事实标注来源；免责和适用边界讲清楚。'}`,
    ...selectedPlatforms.map((platform) => platformGuidance[platform]),
    `返回一个合法 JSON 对象，顶层必须是 drafts 数组，只包含以下选中平台且每个平台恰好一条：${selectedPlatforms.join('、')}。每条结构如下：${selectedPlatforms.map(platformSchema).join('；')}。除小红书的 cardPlan 数组及其对象/要点数组外，其余字段都用字符串；cardPlan 需有 3–5 张卡片，每张 1–4 个简短 keyPoints；不适用的 hashtags、summary 留空字符串。不要附加 Markdown 围栏或 JSON 以外说明。`,
  ].join('\n\n');
  const input = JSON.stringify({
    topicTitle:String(title || ''),
    category:String(category || ''),
    selectedPlatforms,
    verifiedMaterials:String(materials || ''),
  });
  return { instructions,input,platforms:selectedPlatforms };
}

export function buildXhsCardPlanPrompt({ title, body, sources = '' }) {
  const instructions = [
    '你是“大话保险”的小红书图文策划编辑。根据现有小红书配文，补全一套 3–5 张生产用图卡规划，帮助用户之后单独调用 Baoyu 生图。',
    '只重组输入中已有的保险事实，不新增产品条款、数字、政策、理赔结论、个人经历或资料来源。图卡文字要短、清楚、适合手机阅读；复杂解释和免责边界可留在配文，不得删掉配文中的关键限制。',
    '卡片按内容需要承担不同角色，优先从 cover、concept、misconception、checklist、boundary、summary、example、comparison 中选择。每张卡片提供 1–4 条 keyPoints 和简短 visualDirection。避免卡片之间重复，也不要照抄配文整段；封面标题或一句核心结论可有意重复。示例只能明确作为假设情境，不得伪装成真实客户案例。',
    '只输出合法 JSON：{"cardPlan":[{"role":"cover","headline":"短标题","keyPoints":["短要点"],"visualDirection":"简短画面说明"}]}。cardPlan 必须有 3–5 项，禁止输出其他字段、Markdown 围栏或解释。',
  ].join('\n\n');
  return {
    instructions,
    input:JSON.stringify({platform:'小红书',title:String(title || ''),caption:String(body || ''),verifiedSources:String(sources || '')}),
  };
}

export function demoXhsCardPlan(title, body = '') {
  const cleanTitle = String(title || '保险问题').trim();
  const firstSentence = String(body || '').split(/[。！？\n]/).map((part) => part.trim()).find(Boolean) || '先看具体保险合同约定。';
  return [
    { role:'cover',headline:cleanTitle.slice(0,26),keyPoints:['一个问题，先抓住核心概念'],visualDirection:'大标题搭配简洁、友好的保险生活场景插画。' },
    { role:'concept',headline:'先弄懂这是什么',keyPoints:[firstSentence.slice(0,100)],visualDirection:'用日常物件做直观比喻，画面留白充足。' },
    { role:'checklist',headline:'看合同核对这些',keyPoints:['找到相关保险责任和责任免除','核对适用对象、时间和条件'],visualDirection:'用清晰的核对清单图示，避免密集长句。' },
    { role:'boundary',headline:'记得看适用边界',keyPoints:['不同产品和合同约定可能不同','具体情况以正式合同和文件为准'],visualDirection:'用提示卡片突出“以正式合同为准”，不添加产品宣传元素。' },
  ];
}
