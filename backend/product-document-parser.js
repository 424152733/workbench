import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const PRODUCT_DOCUMENT_EXTENSIONS = Object.freeze(['.pdf','.docx','.txt']);
export const PRODUCT_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
export const PRODUCT_DOCUMENT_MAX_TEXT_CHARS = 250_000;

const normalizeText = (value) => String(value || '')
  .replace(/\u0000/g,'')
  .replace(/\r\n?/g,'\n')
  .replace(/[\t\u00a0 ]+\n/g,'\n')
  .replace(/\n{3,}/g,'\n\n')
  .trim();

export async function extractProductDocumentText({ buffer,fileName,pdfParserFactory = (options) => new PDFParse(options),wordParser = mammoth }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError('资料文件内容为空');
  const extension = String(fileName || '').toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!PRODUCT_DOCUMENT_EXTENSIONS.includes(extension)) throw new TypeError('仅支持 PDF、DOCX 和 TXT 文件');

  if (extension === '.txt') {
    let text;
    try { text = new TextDecoder('utf-8',{fatal:true}).decode(buffer).replace(/^\uFEFF/,''); }
    catch { throw new TypeError('TXT 文件不是有效的 UTF-8 编码'); }
    return { text:normalizeText(text),pages:[],pageCount:null,warnings:[] };
  }

  if (extension === '.docx') {
    const result = await wordParser.extractRawText({buffer});
    return {
      text:normalizeText(result.value),pages:[],pageCount:null,
      warnings:(result.messages || []).filter((message) => message.type === 'warning').map((message) => String(message.message || '')),
    };
  }

  const parser = pdfParserFactory({data:buffer});
  try {
    const result = await parser.getText();
    const pages = (result.pages || []).map((page) => ({num:Number(page.num),text:normalizeText(page.text)}));
    return {
      text:normalizeText(pages.filter((page) => page.text).map((page) => `【第 ${page.num} 页】\n${page.text}`).join('\n\n')),
      pages,
      pageCount:Number(result.total) || pages.length,
      warnings:[],
    };
  } finally {
    await parser.destroy();
  }
}

export function limitProductDocumentText(value,maxChars = PRODUCT_DOCUMENT_MAX_TEXT_CHARS) {
  const text = normalizeText(value);
  return {
    text:text.slice(0,maxChars),
    truncated:text.length > maxChars,
    originalLength:text.length,
  };
}
