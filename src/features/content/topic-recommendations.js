export const PRODUCT_TOPIC_ANGLES = Object.freeze([
  {value:'coverage',label:'保障责任'},
  {value:'conditions',label:'适用条件'},
  {value:'premium',label:'保费与缴费'},
  {value:'benefits',label:'利益演示'},
  {value:'misconceptions',label:'常见误解'},
]);

export const CASE_TOPIC_ANGLES = Object.freeze([
  {value:'needs',label:'需求与选择'},
  {value:'budget',label:'预算与缴费'},
  {value:'coverage',label:'保障缺口'},
  {value:'benefits',label:'利益理解'},
  {value:'review',label:'决策复盘'},
]);

const PRODUCT_TEMPLATES = Object.freeze({
  coverage:[
    '别只看「{name}」的名字：这几项保障责任先核清',
    '「{name}」保什么、不保什么？先从合同这几处看',
    '准备了解「{name}」？保障责任和边界要一起看',
  ],
  conditions:[
    '看「{name}」适不适合，先对照这些投保条件',
    '「{name}」不是看名字就能选：这些适用条件别漏',
    '了解「{name}」前，先确认保障对象和适用范围',
  ],
  premium:[
    '看「{name}」别只问保费：缴费方式和期限也要看',
    '「{name}」的保费怎么理解？先核对对应方案和条件',
    '预算要怎么对照「{name}」？从缴费安排和保障责任看起',
  ],
  benefits:[
    '「{name}」的利益演示怎么看？先分清保证与演示部分',
    '看「{name}」的现金价值，别漏掉对应的保单年度',
    '别急着问「{name}」回报率：先看利益演示的条件和口径',
  ],
  misconceptions:[
    '关于「{name}」的这几个说法，哪些要回到合同核对？',
    '「{name}」宣传页看懂了吗？这些表述还要对照正式资料',
    '别被一个数字带着走：看「{name}」还要核对这些条件',
  ],
});

const CASE_TEMPLATES = Object.freeze({
  needs:[
    '一个「{name}」案例：先厘清需求，再看保障是否匹配',
    '面对「{name}」，这个案例先把家庭需求拆开看',
    '为什么会考虑「{name}」？从案例里的实际需求说起',
  ],
  budget:[
    '预算有限时怎么讨论「{name}」？先看缴费安排和取舍',
    '这个案例里的「{name}」选择，先从预算和缴费压力看起',
    '谈「{name}」不只看保费：案例里还核对了哪些条件？',
  ],
  coverage:[
    '这个案例为什么考虑「{name}」？先看原有保障缺了什么',
    '从一个「{name}」案例，看清保障缺口是怎么梳理的',
    '补保障前先盘点已有保单：这个案例怎么评估「{name}」？',
  ],
  benefits:[
    '这个「{name}」案例怎么看利益演示？先把口径和年份对上',
    '谈「{name}」的收益前，案例里先核对了哪些利益数据？',
    '保费、现金价值、演示利益怎么区分？从「{name}」案例说起',
  ],
  review:[
    '这个案例最后为什么选择了解「{name}」？复盘关键判断',
    '从需求到方案：这个「{name}」案例核对了哪几件事？',
    '不急着下结论：复盘案例里评估「{name}」的过程',
  ],
});

const BENEFIT_FACT_TERMS = /现金价值|保单价值|生存金|年金|红利|利益演示|演示利益|保证利益|非保证利益|满期金|身故金|养老金领取|收益率|回报率|累积价值/;

export function hasConfirmedBenefitFacts(facts) {
  if (!Array.isArray(facts)) return false;
  return facts.some((fact) => BENEFIT_FACT_TERMS.test([fact?.title,fact?.productFact,fact?.plainExplanation].filter(Boolean).join(' ')));
}

export function topicAngleOptions(contentTypeCode,facts) {
  const options = contentTypeCode === 'customer_case' ? CASE_TOPIC_ANGLES : PRODUCT_TOPIC_ANGLES;
  return hasConfirmedBenefitFacts(facts) ? options : options.filter((item) => item.value !== 'benefits');
}

export function recommendProductTopics({contentTypeCode,angle,productName,hasVerifiedExtraction=false,hasBenefitFacts=false,caseSummary='',caseKind='scenario',authorizationConfirmed=false,anonymizationConfirmed=false}) {
  const name = String(productName || '').trim();
  if (!name || !hasVerifiedExtraction) return [];
  if (contentTypeCode !== 'product_explainer' && contentTypeCode !== 'customer_case') return [];
  if (angle === 'benefits' && !hasBenefitFacts) return [];
  if (contentTypeCode === 'customer_case' && !String(caseSummary || '').trim()) return [];
  if (contentTypeCode === 'customer_case' && caseKind === 'authorized_real' && (!authorizationConfirmed || !anonymizationConfirmed)) return [];
  const templates = (contentTypeCode === 'product_explainer' ? PRODUCT_TEMPLATES : CASE_TEMPLATES)[angle];
  if (!templates) return [];
  const category = contentTypeCode === 'product_explainer' ? '产品解读' : '客户案例';
  return templates.map((title) => ({title:title.replaceAll('{name}',name),category,contentTypeCode}));
}
