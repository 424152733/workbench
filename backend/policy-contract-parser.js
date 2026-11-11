import { extractProductDocumentText, PRODUCT_DOCUMENT_MAX_BYTES } from './product-document-parser.js';
import { recognizePolicyContractPages } from './policy-contract-ocr.js';
import { extractPolicyContractExportFacts } from './policy-contract-export-facts.js';

export const POLICY_CONTRACT_EXTENSIONS = Object.freeze(['.pdf']);
export const POLICY_CONTRACT_MAX_BYTES = PRODUCT_DOCUMENT_MAX_BYTES;
export const POLICY_CONTRACT_MAX_PAGES = 300;
export const POLICY_CONTRACT_MAX_ANALYSIS_CHARS = 120_000;
export const POLICY_CONTRACT_CHUNK_CHARS = 8_000;
export const POLICY_CONTRACT_MAX_CHUNKS = 16;
export const POLICY_CONTRACT_MAX_MODEL_CALLS = 24;
export const POLICY_CONTRACT_PARSER_VERSION = 4;
const OCR_TEXT_THRESHOLD = 220;

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
    .replace(/(^|\n)([ \t]*(?:投保人|被保险人|受益人)(?:姓名)?[ \t]*[:：][ \t]*)([\u4e00-\u9fa5]{2,4})(?=[ \t]|身份证|证件|性别|$)/gm,'$1$2[姓名已隐藏]')
    .replace(/(^|\n)([ \t]*(?:投保人|被保险人|受益人)(?:姓名)?[ \t]+)([\u4e00-\u9fa5]{2,4})(?=[ \t]|身份证|证件|性别|$)/gm,'$1$2[姓名已隐藏]')
    .replace(/(联系地址|通讯地址|家庭住址|地址)\s*[:：]?\s*[^\n，,。;；]{4,60}/g,'$1[地址已隐藏]')
    .replace(/(电子邮箱|邮箱|E-?mail)\s*[:：]?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'$1[邮箱已隐藏]')
    .replace(/(银行账号|银行卡号|银行账户)\s*[:：]?\s*[0-9-]{10,24}/g,'$1[账号已隐藏]')
    .replace(/(保单号|保险单号|合同号|保单号码)\s*[:：]?\s*[A-Za-z0-9-]{6,}/g,'$1[号码已隐藏]')
    .replace(/\b\d{16,19}\b/g,'[卡号已隐藏]');
}

export function isDiseaseDefinitionPage(value) {
  const text=normalizeContractText(value);
  const sections=new Map();
  for (const match of text.matchAll(/(?:^|\s)(\d{1,2}\.\d{1,2})\.\d{1,3}\s+(?!条)(?=[\u4e00-\u9fff])/g)) {
    sections.set(match[1],(sections.get(match[1]) || 0)+1);
  }
  return Math.max(0,...sections.values())>=3 && /疾病|轻症|重疾|重大|释义/.test(text);
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
  return chunks.map((chunk)=>({...chunk,parserVersion:POLICY_CONTRACT_PARSER_VERSION}));
}

export async function preparePolicyContract({buffer,fileName,pdfParserFactory,sourcePath}={}) {
  const parsed = await extractProductDocumentText({buffer,fileName,pdfParserFactory});
  if (!parsed.pages?.length) throw new TypeError('PDF 中没有可读取的页面');
  if (parsed.pages.length > POLICY_CONTRACT_MAX_PAGES) throw new TypeError(`合同页数超过 ${POLICY_CONTRACT_MAX_PAGES} 页，请拆分后上传`);
  const sparsePages=parsed.pages.filter((page)=>normalizeContractText(page.text).length<OCR_TEXT_THRESHOLD).map((page)=>Number(page.num));
  let ocrApplied=0;
  let ocrUnreadable=0;
  const ocrText=new Map();
  if (sourcePath && sparsePages.length) {
    let recognized;
    try { recognized=await recognizePolicyContractPages(sourcePath,sparsePages); }
    catch (error) { throw new TypeError(`合同有 ${sparsePages.length} 页缺少可复制文字，本机 OCR 失败：${error.message}`); }
    for (const page of recognized) ocrText.set(page.num,normalizeContractText(page.text));
  }
  const sourcePages=parsed.pages.map((page)=>{
    const original=normalizeContractText(page.text);
    const recognized=ocrText.get(Number(page.num)) || '';
    if (recognized.length>original.length+20) { ocrApplied+=1; return {...page,text:recognized}; }
    if (original.length<OCR_TEXT_THRESHOLD && sourcePath && recognized.length<50) ocrUnreadable+=1;
    return {...page,text:original};
  }).filter((page)=>normalizeContractText(page.text));
  if (!sourcePages.length) {
    return {pages:[],chunks:[],pageCount:parsed.pageCount,totalTextChars:0,selectedChars:0,omittedPageCount:parsed.pageCount,
      estimatedInputTokens:0,parseStatus:'needs_ocr',warnings:['本机 OCR 未能识别到可用文字，请提供更清晰的 PDF。']};
  }
  const exportFacts=extractPolicyContractExportFacts(sourcePages);
  const knownNames=[exportFacts.holderName,exportFacts.insuredName,exportFacts.beneficiary]
    .filter((name)=>/^[\u4e00-\u9fa5]{2,4}$/.test(name) && !/法定继承人|证件|姓名|保险/.test(name));
  const definitionPageCount=sourcePages.filter((page)=>isDiseaseDefinitionPage(page.text)).length;
  const selectedPages=sourcePages.map((page,index)=>({
    num:Number(page.num) || index+1,
    text:knownNames.reduce((text,name)=>text.replaceAll(name,'[姓名已隐藏]'),redactContractText(normalizeContractText(page.text))),
    originalChars:normalizeContractText(page.text).length,
  })).filter((page)=>page.text.trim());
  const selectedChars=selectedPages.reduce((sum,page)=>sum+page.text.length,0);
  if (selectedChars>POLICY_CONTRACT_MAX_ANALYSIS_CHARS) {
    throw new TypeError(`合同可读取文字共 ${selectedChars.toLocaleString()} 字，超过单次整理上限 ${POLICY_CONTRACT_MAX_ANALYSIS_CHARS.toLocaleString()} 字；请按保单或险种拆分 PDF 后上传，避免只整理到部分内容。`);
  }
  const chunks=chunksForPages(selectedPages);
  if (chunks.length>POLICY_CONTRACT_MAX_CHUNKS) {
    throw new TypeError(`合同需要 ${chunks.length} 个 AI 分段，超过单次整理上限 ${POLICY_CONTRACT_MAX_CHUNKS} 段；请按保单或险种拆分 PDF 后上传。`);
  }
  const actualChars = chunks.reduce((sum,chunk)=>sum+chunk.excerpts.reduce((count,item)=>count+item.text.length,0),0);
  const coveredPages = new Set(chunks.flatMap((chunk)=>chunk.pages));
  const warnings = [];
  if (ocrApplied) warnings.push(`本机 OCR 补充了 ${ocrApplied} 页图片文字，已纳入 AI 整理范围。`);
  if (ocrUnreadable) warnings.push(`另有 ${ocrUnreadable} 页本机 OCR 未识别到足够文字，可能为空白页或图片不清晰，请对照原合同检查。`);
  if (parsed.pageCount > coveredPages.size) warnings.push(`合同共 ${parsed.pageCount} 页，其中 ${parsed.pageCount-coveredPages.size} 页没有可复制文字，无法交给 AI；可能是扫描页，请人工补充或先做 OCR。`);
  if (definitionPageCount) warnings.push(`疾病定义页也会交给 AI 作为保障范围参考；模型需区分疾病定义与保险责任，病种数仍由本机按完整 PDF 编号核算。`);
  const totalTextChars = sourcePages.reduce((sum,page)=>sum+normalizeContractText(page.text).length,0);
  const scheduleFacts=extractPolicyContractScheduleFacts(sourcePages);
  return {
    pages:selectedPages,
    chunks,
    parserVersion:POLICY_CONTRACT_PARSER_VERSION,
    localFacts:{...scheduleFacts,basicSumInsured:scheduleFacts.basicSumInsured || exportFacts.basicSumInsured || null},
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
