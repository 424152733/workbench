import { extractProductDocumentText, PRODUCT_DOCUMENT_MAX_BYTES } from './product-document-parser.js';

export const POLICY_CONTRACT_EXTENSIONS = Object.freeze(['.pdf']);
export const POLICY_CONTRACT_MAX_BYTES = PRODUCT_DOCUMENT_MAX_BYTES;
export const POLICY_CONTRACT_MAX_PAGES = 300;
export const POLICY_CONTRACT_MAX_ANALYSIS_CHARS = 30_000;
export const POLICY_CONTRACT_CHUNK_CHARS = 3_000;
export const POLICY_CONTRACT_MAX_CHUNKS = 10;
export const POLICY_CONTRACT_MAX_MODEL_CALLS = 16;
const MAX_SELECTED_PAGES = 60;

const KEYWORDS = Object.freeze([
  '保险责任','保险金额','基本保险金额','保险金','保险费','首期保险费','交费期间','缴费期间','保险期间','保障期间',
  '责任免除','免责条款','等待期','犹豫期','现金价值','红利','分红','生存金','年金','身故','全残','重大疾病','轻症','中症',
  '医疗费用','住院医疗','意外伤害','豁免保险费','满期保险金','投保规则','产品名称','保险单','保单信息','特别约定',
]);

function formatContractAmount(value,unit='元') {
  const numeric=Number(String(value || '').replaceAll(',',''));
  if (!Number.isFinite(numeric)) return null;
  const formatted=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(numeric);
  return `${formatted}${unit || '元'}`;
}

export function extractPolicyContractScheduleFacts(pages=[]) {
  const matches=[];
  const amountPattern=/(基本保险金额|基本保额)\s*(?:为\s*)?[:：]?\s*(?:人民币\s*)?[￥¥]?\s*([0-9][\d,]*(?:\.\d{1,2})?)\s*(万元|万|元)?/g;
  for (const [index,page] of (Array.isArray(pages)?pages:[]).entries()) {
    const text=normalizeContractText(page?.text || '');
    if (!text) continue;
    amountPattern.lastIndex=0;
    let match;
    while ((match=amountPattern.exec(text))) {
      const amount=formatContractAmount(match[2],match[3] || '元');
      if (!amount) continue;
      matches.push({label:'基本保险金额',amount,page:Number(page?.num) || index+1});
    }
  }
  const unique=[...new Map(matches.map((item)=>[`${item.amount}`,item])).values()];
  return {basicSumInsured:unique.length===1?unique[0]:null,ambiguous:unique.length>1};
}

export const normalizeContractText = (value) => String(value || '')
  .replace(/\u0000/g,'')
  .replace(/\r\n?/g,'\n')
  .replace(/[\t\u00a0 ]+\n/g,'\n')
  .replace(/\n{3,}/g,'\n\n')
  .trim();

export function redactContractText(value) {
  return normalizeContractText(value)
    .replace(/(身份证(?:号码|号)?|证件号码|证件号)\s*[:：]?\s*[0-9Xx-]{15,20}/g,'$1[号码已隐藏]')
    .replace(/\b\d{17}[0-9Xx]\b/g,'[证件号码已隐藏]')
    .replace(/(手机号|联系电话|联系手机|电话)\s*[:：]?\s*1[3-9]\d{9}/g,'$1[号码已隐藏]')
    .replace(/\b1[3-9]\d{9}\b/g,'[手机号已隐藏]')
    .replace(/(投保人|被保险人|受益人)\s*[:：]?\s*[\u4e00-\u9fa5]{2,4}/g,'$1[姓名已隐藏]')
    .replace(/(联系地址|通讯地址|家庭住址|地址)\s*[:：]?\s*[^\n，,。;；]{4,60}/g,'$1[地址已隐藏]')
    .replace(/(电子邮箱|邮箱|E-?mail)\s*[:：]?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'$1[邮箱已隐藏]')
    .replace(/(银行账号|银行卡号|银行账户)\s*[:：]?\s*[0-9-]{10,24}/g,'$1[账号已隐藏]')
    .replace(/(保单号|保险单号|合同号|保单号码)\s*[:：]?\s*[A-Za-z0-9-]{6,}/g,'$1[号码已隐藏]')
    .replace(/\b\d{16,19}\b/g,'[卡号已隐藏]');
}

function pageScore(text) {
  let score = 0;
  for (const keyword of KEYWORDS) {
    if (text.includes(keyword)) score += keyword.length >= 4 ? 2 : 1;
  }
  return score;
}

function extractWindows(text,{maxChars=1_200,maxWindows=7}={}) {
  const hits = [];
  for (const keyword of KEYWORDS) {
    let cursor = 0;
    let keywordHits=0;
    while (cursor < text.length && keywordHits < 3) {
      const index = text.indexOf(keyword,cursor);
      if (index < 0) break;
      hits.push({start:Math.max(0,index-100),end:Math.min(text.length,index+220),score:keyword.length});
      keywordHits+=1;
      cursor = index + keyword.length;
    }
  }
  if (!hits.length) return text.slice(0,Math.min(maxChars,500));
  hits.sort((a,b)=>a.start-b.start);
  const merged = [];
  for (const hit of hits) {
    const previous = merged.at(-1);
    if (previous && hit.start <= previous.end + 60) {
      previous.end = Math.max(previous.end,hit.end);
      previous.score += hit.score;
    } else merged.push({...hit});
  }
  merged.sort((a,b)=>b.score-a.score || a.start-b.start);
  const chosen = merged.slice(0,maxWindows).sort((a,b)=>a.start-b.start);
  let excerpt = chosen.map((part)=>text.slice(part.start,part.end)).join(' … ');
  if (excerpt.length > maxChars) excerpt = excerpt.slice(0,maxChars);
  return excerpt;
}

function chunksForPages(pages) {
  const chunks = [];
  let current = [];
  let currentChars = 0;
  for (const page of pages) {
    const text = page.text;
    const pieces = [];
    for (let start=0;start<text.length;start+=POLICY_CONTRACT_CHUNK_CHARS) {
      pieces.push(text.slice(start,start+POLICY_CONTRACT_CHUNK_CHARS));
    }
    for (const piece of pieces) {
      const entry = {page:page.num,text:piece};
      if (current.length && currentChars + piece.length > POLICY_CONTRACT_CHUNK_CHARS) {
        chunks.push({index:chunks.length,pages:[...new Set(current.map((item)=>item.page))],excerpts:current});
        current = [];
        currentChars = 0;
      }
      current.push(entry);
      currentChars += piece.length;
    }
  }
  if (current.length) chunks.push({index:chunks.length,pages:[...new Set(current.map((item)=>item.page))],excerpts:current});
  return chunks;
}

export async function preparePolicyContract({buffer,fileName,pdfParserFactory}={}) {
  const parsed = await extractProductDocumentText({buffer,fileName,pdfParserFactory});
  if (!parsed.pages?.length) throw new TypeError('PDF 中没有可读取的页面');
  if (parsed.pages.length > POLICY_CONTRACT_MAX_PAGES) throw new TypeError(`合同页数超过 ${POLICY_CONTRACT_MAX_PAGES} 页，请拆分后上传`);
  const sourcePages = parsed.pages.filter((page)=>normalizeContractText(page.text));
  if (!sourcePages.length) {
    return {pages:[],chunks:[],pageCount:parsed.pageCount,totalTextChars:0,selectedChars:0,omittedPageCount:parsed.pageCount,
      estimatedInputTokens:0,parseStatus:'needs_ocr',warnings:['未识别到可复制文字，可能是扫描件；当前版本不含 OCR，暂时无法进行 AI 整理。']};
  }
  const candidates = sourcePages.map((page,index)=>({
    num:Number(page.num) || index+1,
    score:pageScore(normalizeContractText(page.text)),
    originalChars:normalizeContractText(page.text).length,
    text:redactContractText(extractWindows(normalizeContractText(page.text),{maxChars:1_200})),
  })).filter((page)=>page.text.trim());
  const ranked = [...candidates].sort((a,b)=>b.score-a.score || a.num-b.num);
  const selected = [];
  let selectedChars = 0;
  const firstPages = new Set(candidates.slice(0,3).map((page)=>page.num));
  const priority = [...ranked.filter((page)=>firstPages.has(page.num)),...ranked.filter((page)=>!firstPages.has(page.num) && page.score>0)];
  for (const page of priority) {
    if (selected.length >= MAX_SELECTED_PAGES || selectedChars + page.text.length > POLICY_CONTRACT_MAX_ANALYSIS_CHARS) continue;
    selected.push(page);
    selectedChars += page.text.length;
  }
  const selectedPages = selected.sort((a,b)=>a.num-b.num).map(({num,text,originalChars})=>({num,text,originalChars}));
  let chunks = chunksForPages(selectedPages);
  const truncatedPlan = chunks.length > POLICY_CONTRACT_MAX_CHUNKS;
  if (truncatedPlan) {
    chunks = chunks.slice(0,POLICY_CONTRACT_MAX_CHUNKS);
    const allowedPages = new Set(chunks.flatMap((chunk)=>chunk.pages));
    for (let index=selectedPages.length-1;index>=0;index--) if (!allowedPages.has(selectedPages[index].num)) selectedPages.splice(index,1);
  }
  const actualChars = chunks.reduce((sum,chunk)=>sum+chunk.excerpts.reduce((count,item)=>count+item.text.length,0),0);
  const coveredPages = new Set(chunks.flatMap((chunk)=>chunk.pages));
  const warnings = [];
  if (parsed.pageCount > coveredPages.size) warnings.push(`本次按关键词筛选并发送了 ${coveredPages.size}/${parsed.pageCount} 页的短摘录，其他页面没有发送给 AI；结果需要对照原合同核验。`);
  if (candidates.some((page)=>page.originalChars > page.text.length)) warnings.push('部分页面只截取了条款关键词附近的短摘录，未把整页发送给 AI。');
  if (truncatedPlan) warnings.push(`合同信息较多，本次最多安排 ${POLICY_CONTRACT_MAX_CHUNKS} 个小段；未覆盖内容需重新拆分合同后补充整理。`);
  const totalTextChars = sourcePages.reduce((sum,page)=>sum+normalizeContractText(page.text).length,0);
  return {
    pages:selectedPages,
    chunks,
    localFacts:extractPolicyContractScheduleFacts(selectedPages),
    pageCount:parsed.pageCount,
    totalTextChars,
    selectedChars:actualChars,
    omittedPageCount:Math.max(0,parsed.pageCount-coveredPages.size),
    estimatedInputTokens:Math.ceil(actualChars*1.45 + chunks.length*700),
    parseStatus:'ready',
    warnings,
  };
}

export function splitPolicyContractChunk(chunk) {
  const entries = chunk.excerpts || [];
  if (entries.length > 1) {
    const middle = Math.ceil(entries.length/2);
    return [entries.slice(0,middle),entries.slice(middle)].filter((items)=>items.length).map((excerpts)=>({
      pages:[...new Set(excerpts.map((item)=>item.page))],excerpts,
    }));
  }
  const entry = entries[0];
  if (!entry || entry.text.length < 600) return [];
  const midpoint = Math.floor(entry.text.length/2);
  return [entry.text.slice(0,midpoint),entry.text.slice(midpoint)].map((text)=>({pages:[entry.page],excerpts:[{page:entry.page,text}]}));
}
