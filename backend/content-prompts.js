import { CASE_KIND_NAMES, CONTENT_TYPE_RULES } from '../src/features/content/content-types.js';

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
面向移动端快速浏览的读者，一条稿件聚焦一个问题。标题短而清楚；body 是精炼发布配文，只承担开场、图片未覆盖的补充说明、必要边界和自然互动，不要逐张复述图片文案。生成 3–5 张生产用 cardPlan，每张卡片承担不同角色，适合一眼读懂，同时让卡片文案本身足以理解：封面用 1–2 条短句补充主题或结论；解释类内容卡建议 2–3 条 keyPoints，每条约 20–35 个汉字，写成完整、易懂的短句，说明重点及必要的原因、条件或判断方法。整张卡片的要点约 50–90 字为宜；简单内容可以更短，不为达到字数而重复。不要只写关键词或口号，也不要堆成大段正文。测试生图时运行器只会取封面卡片。封面标题或一句核心结论可以有意重复，除此之外避免配文与卡片整段重复。不能为精简而删除重要免责、适用条件或合同差异。`,
};

function platformSchema(platform) {
  if (platform === '知乎') return '{"platform":"知乎","title":"","summary":"","body":"回答正文","hashtags":"","sources":""}';
  if (platform === '公众号') return '{"platform":"公众号","title":"","summary":"文章摘要","body":"文章正文","hashtags":"","sources":""}';
  return '{"platform":"小红书","title":"不超过20字","summary":"","body":"精炼发布配文","hashtags":"话题标签","sources":"","cardPlan":[{"role":"cover|concept|misconception|checklist|boundary|summary|example|comparison","headline":"卡片标题","keyPoints":["表达完整的解释短句"],"visualDirection":"画面说明"}]}';
}

export function buildDraftGenerationPrompt({ title, category, platforms, voice = '', materials = '', contentTypeCode = 'insurance_education', contentTypeName = '大话保险' }) {
  const selectedPlatforms = [...new Set((platforms || []).filter((platform) => platformGuidance[platform]))];
  if (!selectedPlatforms.length) throw new TypeError('至少需要一个有效的发布平台');
  const instructions = [
    `你是“${contentTypeName || '大话保险'}”的中文保险内容编辑，服务对象是不了解保险术语的普通消费者。`,
    contentTypeCode === 'product_explainer'
      ? '只根据输入选题和产品中心逐条确认的事实写作。不得编造产品条款、政策、数字、理赔结果或产品来源；正文面向读者表达产品事实，不写内部出处。一般科普不得伪装成针对个人的承保或理赔建议。'
      : '只根据输入选题和用户明确提供的正式资料写作。不得编造产品条款、政策、数字、理赔结果、真实客户经历或资料来源。没有可核实来源时，sources 留空，并以谨慎措辞提醒读者查正式合同或文件。一般科普不得伪装成针对个人的承保或理赔建议。',
    '用自然大白话解释术语，清楚说明不同合同、产品、地区和责任可能不同。保持事实的确定程度，不把“可能”写成“必然”。不使用“第一步”“第几步”等僵硬过渡，不使用 Markdown 粗体语法或输出 ** 符号。需要分组时可用自然小标题、①②③、✅或⭐，只有内容确实是操作流程时才分步说明。',
    '同一选题的多平台稿件必须重新组织论述以适配各自的阅读目标。可以共享已核实的核心事实，但不要复用同一篇正文再换标题或格式；不要为了拉长文章重复结论、免责声明或同一段内容。篇幅按主题复杂度决定，讲完整即可，不凑字数。',
    '通用内容规范：资料来源可追溯，事实不夸大，适用边界讲清楚；只根据输入材料写作，不把模型生成视为事实核验或合规审核。',
    `分类专属要求：${(CONTENT_TYPE_RULES[contentTypeCode] || CONTENT_TYPE_RULES.insurance_education).join('；')}`,
    contentTypeCode === 'product_explainer' ? '产品解读要写给普通读者看，不是资料摘要：围绕选题直接回答一个具体问题，优先挑选 3–5 条与问题最相关的已确认产品事实，用清楚的产品责任、适用对象、年龄、等待期、续保条件、免赔额、额度、医院范围或责任限制等具体信息解释“这对投保人意味着什么、还要核对什么”；只写输入材料实际提供的项目和数字。不要把事实字段逐条堆砌，不要用空泛的“按需选择”“以合同为准”代替解释。sourceRefs、文件名、页码、原文摘录和 openQuestions 是内部核对信息，不要放进标题、摘要或正文，也不要在正文加出处标记；sources 字段留空。只在未确认事项会直接影响本选题结论时，用读者听得懂的话说明具体缺口及其影响，不要把内部待核实清单整段贴出。涉及保费、现金价值、演示利益或收益率时，只能写资料中明确提供的数值及其完整条件；若资料只有费率影响因素而没有可用的具体费率，明确说明现有资料不足以给出准确金额，并指出材料明确要求的报价条件，不能自行补造条件或数字。区分保证与非保证利益，不自行换算或推导年化收益率、IRR。' : '',
    contentTypeCode === 'customer_case' ? '涉及案例保费、现金价值、演示利益或收益率时，只能引用已确认产品资料或案例中明确记录且注明来源的数值，并说明材料给出的方案、条件和年度；不得自行推算年化收益率、IRR，也不得把案例数字泛化为其他人的结果。' : '',
    `栏目表达设定：${voice || (CONTENT_TYPE_RULES[contentTypeCode] || CONTENT_TYPE_RULES.insurance_education).join('；')}`,
    contentTypeCode === 'customer_case' ? `案例性质要求：综合案例必须明确标注“${CASE_KIND_NAMES.composite}”，情景案例必须明确标注“${CASE_KIND_NAMES.scenario}”。不得把示例描述成真实客户。` : '',
    ...selectedPlatforms.map((platform) => platformGuidance[platform]),
    `返回一个合法 JSON 对象，顶层必须是 drafts 数组，只包含以下选中平台且每个平台恰好一条：${selectedPlatforms.join('、')}。每条结构如下：${selectedPlatforms.map(platformSchema).join('；')}。除小红书的 cardPlan 数组及其对象/要点数组外，其余字段都用字符串；cardPlan 需有 3–5 张卡片，每张 1–4 个 keyPoints。解释类卡片优先 2–3 条、每条约 20–35 个汉字；封面可用 1–2 条短句。简单内容可以更短，不得用重复内容凑长度。不适用的 hashtags、summary 留空字符串。不要附加 Markdown 围栏或 JSON 以外说明。`,
  ].join('\n\n');
  const input = JSON.stringify({
    contentTypeCode:String(contentTypeCode || 'insurance_education'),
    contentTypeName:String(contentTypeName || '大话保险'),
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
    '只重组输入中已有的保险事实，不新增产品条款、数字、政策、理赔结论、个人经历或资料来源。图卡文字要适合手机阅读，但不能因为追求短而只剩关键词；每条 keyPoint 写成意思完整的短句，提供读者理解要点所需的解释。',
    '卡片按内容需要承担不同角色，优先从 cover、concept、misconception、checklist、boundary、summary、example、comparison 中选择。封面用 1–2 条短句说明主题或结论；解释类卡片建议提供 2–3 条 keyPoints，每条约 20–35 个汉字，说明重点及必要的原因、条件或判断方法，整张卡片要点约 50–90 字。简单内容可少于此范围，不为凑字数重复信息；不要写成大段正文。每张最多 4 条 keyPoints，并给出简短 visualDirection。复杂解释和免责边界可留在配文，但不得删掉配文中的关键限制。避免卡片之间重复，也不要照抄配文整段；封面标题或一句核心结论可有意重复。示例只能明确作为假设情境，不得伪装成真实客户案例。',
    '只输出合法 JSON：{"cardPlan":[{"role":"cover","headline":"短标题","keyPoints":["表达完整的解释短句"],"visualDirection":"简短画面说明"}]}。cardPlan 必须有 3–5 项，禁止输出其他字段、Markdown 围栏或解释。',
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
    { role:'cover',headline:cleanTitle.slice(0,26),keyPoints:['先看合同写明的责任和适用条件，不要只凭产品名字判断。'],visualDirection:'用清楚醒目的标题，再以一行短句点出阅读重点；搭配简洁友好的保险生活场景插画。' },
    { role:'concept',headline:'先弄清具体约定',keyPoints:[firstSentence.slice(0,55),'同一个说法在不同产品中的含义可能不一样，要结合合同上下文理解并核对适用条件。'],visualDirection:'用简洁图示解释概念，保留两条短句的阅读空间，不使用只有关键词的标签式排版。' },
    { role:'checklist',headline:'看合同核对这些',keyPoints:['找到合同里的保险责任和责任免除，确认哪些情况属于约定范围。','再核对保障对象、时间和适用条件，看看是否符合当前要了解的情况。'],visualDirection:'将两条核对内容做成有层次的清单，文字完整可读，避免挤成一团。' },
    { role:'boundary',headline:'记得看适用边界',keyPoints:['宣传页或日常说法不能代替具体合同约定，需看对应条款。','条款不清楚时可向保险公司核实，具体以正式合同和文件为准。'],visualDirection:'突出需要核实的边界，同时完整呈现两条短句；不添加产品宣传元素。' },
  ];
}
