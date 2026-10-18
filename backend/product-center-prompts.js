import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CHANNELS } from './workbench-primitives.js';

export const PRODUCT_COPY_PLATFORMS = Object.freeze([...CHANNELS]);
export const MAX_PRODUCT_ANALYSIS_CHARS = 80_000;
const FACT_CATEGORIES = new Set(['保障责任','产品特点','适用条件','责任边界']);
const MAX_FACTS = 18;

const clean = (value,max = 1200) => String(value ?? '').trim().slice(0,max);
const evidenceText = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');

export function buildProductAnalysisPrompt({product,document}) {
  const text = String(document.extractedText || '');
  if (!text.trim()) throw new BadRequestException('这份资料没有提取到可整理的文字，请确认文件内容或使用可复制文字的版本');
  if (text.length > MAX_PRODUCT_ANALYSIS_CHARS) throw new BadRequestException(`资料文字较长（${text.length.toLocaleString()} 字符），首期单次整理上限为 ${MAX_PRODUCT_ANALYSIS_CHARS.toLocaleString()} 字符。请拆分资料后分别导入，避免一次发送过多内容。`);
  const sourcePages = Array.isArray(document.pages) ? document.pages : [];
  const sourceText = sourcePages.length
    ? sourcePages.map((page) => `【资料页码:${page.num}】\n${page.text}`).join('\n\n')
    : text;
  const instructions = [
    '你是保险产品资料整理助手。任务是把用户提供的新华保险产品资料整理成待人工核对的结构化事实。',
    '只能根据输入资料写事实。不要推断未写明的责任、等待期、费率、收益、赔付结论或适配人群；资料没有说明时写入 openQuestions。产品价值只解释某项已列明特点可能对应的需求，不得承诺效果或判断某人适合买。',
    '每条 fact 必须提供至少一条来源引用，quote 必须逐字摘自输入资料，PDF 用输入中标注的页码；DOCX/TXT 的 page 填 null，并尽可能填资料中的小节标题。不要伪造页码或标题。',
    '输出合法 JSON 对象，格式为：{"positioning":"一句话产品定位","facts":[{"category":"保障责任|产品特点|适用条件|责任边界","title":"简短标题","productFact":"资料写明的事实","plainExplanation":"面向普通人的解释","customerValue":"可能对应的需求价值；没有依据时留空","boundary":"限制或边界；没有则留空","sourceRefs":[{"page":1,"section":"章节标题或空字符串","quote":"资料原文短句"}]}],"openQuestions":["需要人工确认的问题"]}。facts 只放资料直接支持的内容，最多 18 条。不要附加 Markdown 或其他字段。',
  ].join('\n\n');
  const input = JSON.stringify({
    company:'新华保险',productName:String(product.productName || ''),productVersion:String(product.productVersion || ''),
    documentName:String(document.fileName || ''),documentType:String(document.documentType || ''),
    documentPageCount:document.pageCount || null,sourceText,
  });
  return {instructions,input};
}

export function normalizeProductAnalysis(value,{documentId,document,documentText,documentPages = []}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.facts)) {
    throw new ServiceUnavailableException('GPT 没有按要求返回产品要点，请重试');
  }
  const facts = value.facts.slice(0,MAX_FACTS).map((fact,index) => {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) throw new ServiceUnavailableException('GPT 返回的产品要点格式有误，请重试');
    const category = FACT_CATEGORIES.has(fact.category) ? fact.category : '产品特点';
    const sourceRefs = (Array.isArray(fact.sourceRefs) ? fact.sourceRefs : []).slice(0,4).map((source) => {
      const requestedPage = source?.page === null || source?.page === undefined || source?.page === '' ? null : Number(source.page);
      const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : null;
      const quote = clean(source?.quote,240);
      const pageText = page === null
        ? (documentPages.length ? '' : documentText)
        : documentPages.find((item) => Number(item.num) === page)?.text;
      const normalizedQuote = evidenceText(quote);
      const verified = Boolean(pageText && [...normalizedQuote].length >= 8 && evidenceText(pageText).includes(normalizedQuote));
      return {
        documentId:Number(documentId),documentName:String(document.fileName || ''),page,
        section:clean(source?.section,160),quote,verified,
      };
    });
    return {
      id:`fact-${index + 1}-${randomUUID()}`,
      category,
      title:clean(fact.title,100) || `产品要点 ${index + 1}`,
      productFact:clean(fact.productFact,1200),
      plainExplanation:clean(fact.plainExplanation,1200),
      customerValue:clean(fact.customerValue,1000),
      boundary:clean(fact.boundary,1000),
      sourceRefs,
      confirmed:false,
    };
  }).filter((fact) => fact.productFact && fact.sourceRefs.some((source) => source.verified));
  if (!facts.length) throw new ServiceUnavailableException('没有提取到带来源引用的产品要点，请确认资料文字清晰后重试');
  return {
    positioning:clean(value.positioning,500),
    facts,
    openQuestions:Array.isArray(value.openQuestions) ? value.openQuestions.slice(0,20).map((item) => clean(item,500)).filter(Boolean) : [],
  };
}

const platformInstructions = {
  知乎:'以一个明确的产品保障疑问切入，给出审慎结论，再详细解释已核实的产品事实、适用条件和责任边界。写成完整、易懂的科普回答，避免绝对推荐。',
  小红书:'面向手机快速阅读，标题简洁，正文精炼，按自然小标题或 1、2、3 分段，突出少量关键特点和适用边界。不要把所有条款塞进正文，也不要夸大产品价值。',
  公众号:'写成可独立阅读的产品解读文章，包含标题、简短摘要、背景引入、分段说明产品特点与价值、适用条件和保障边界。段落充分但不重复，不写成强推销文案。',
};

export function buildProductCopyPrompt({product,extraction,platform,platformConfig={}}) {
  if (!PRODUCT_COPY_PLATFORMS.includes(platform)) throw new BadRequestException('发布平台无效');
  const facts = (Array.isArray(extraction.facts) ? extraction.facts : []).filter((fact) => fact.confirmed);
  if (!facts.length) throw new BadRequestException('请先确认至少一条有资料出处的产品要点');
  const instructions = [
    '你是保险顾问的产品解读编辑。基于用户确认过的产品事实，为公开内容平台写清楚产品特点和可能对应的需求价值。',
    '不能添加输入以外的保障、费率、收益、理赔结论或适配判断；不得使用最好、保证获赔、人人适合等绝对或承诺表达。未知信息留空，不要补猜。明确提示具体责任和限制以正式合同及保险公司资料为准。',
    '表达自然、通俗、克制。分组用清楚的编号或小标题，不使用 Markdown 粗体符号 **，不写“第几步”。不得编造真实投保人或理赔案例。',
    `平台表达要求：${platformInstructions[platform]}`,
    `本工作台的平台表达偏好（只调整受众、语气、结构和篇幅，不能覆盖资料事实及风险边界）：${JSON.stringify({audience:platformConfig.audience || '',tone:platformConfig.tone || '',structure:platformConfig.structure || '',lengthHint:platformConfig.lengthHint || ''})}`,
    '只返回 JSON：{"platform":"所选平台","title":"标题","summary":"公众号摘要；其他平台留空","body":"正文","hashtags":"小红书标签；其他平台留空"}。不要返回资料出处字段；系统会从已确认事实中生成可核对的出处。不要附加 Markdown 围栏。',
  ].join('\n\n');
  const input = JSON.stringify({
    json:true,platform,company:'新华保险',productName:product.productName,productVersion:product.productVersion || '',
    productPositioning:extraction.positioning || '',confirmedFacts:facts.map(({category,title,productFact,plainExplanation,customerValue,boundary,sourceRefs}) => ({
      category,title,productFact,plainExplanation,customerValue,boundary,
      sources:sourceRefs.filter((source) => source.verified).map(({documentName,page,section,quote}) => ({documentName,page,section,quote})),
    })),
  });
  return {instructions,input};
}

export function productCopySources(facts) {
  const seen = new Set();
  const sources = [];
  for (const fact of facts || []) for (const ref of fact.sourceRefs || []) {
    if (!ref.verified) continue;
    const label = [ref.documentName,ref.page ? `第 ${ref.page} 页` : '',ref.section].filter(Boolean).join(' · ');
    if (label && !seen.has(label)) { seen.add(label); sources.push(label); }
  }
  return sources.join('\n');
}

export function normalizeProductCopy(value,platform) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.platform !== platform ||
      typeof value.title !== 'string' || !value.title.trim() || typeof value.body !== 'string' || !value.body.trim()) {
    throw new ServiceUnavailableException('GPT 返回的平台文案格式不完整，请重试');
  }
  if (['summary','hashtags'].some((field) => value[field] !== undefined && typeof value[field] !== 'string')) {
    throw new ServiceUnavailableException('GPT 返回的平台文案字段格式错误，请重试');
  }
  return {
    platform,
    title:String(value.title).trim().slice(0,200),
    summary:String(value.summary || '').trim().slice(0,500),
    body:String(value.body).trim().slice(0,40_000),
    hashtags:String(value.hashtags || '').trim().slice(0,800),
  };
}
