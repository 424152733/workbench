import assert from 'node:assert/strict';
import test from 'node:test';
import { extractProductDocumentText,limitProductDocumentText,PRODUCT_DOCUMENT_MAX_BYTES } from '../product-document-parser.js';

test('parses UTF-8 TXT with normalized newlines and trims the byte-order mark',async () => {
  const result = await extractProductDocumentText({buffer:Buffer.from('\uFEFF第一段\r\n\r\n\r\n第二段  \n','utf8'),fileName:'terms.TXT'});
  assert.equal(result.text,'第一段\n\n第二段');
  assert.deepEqual(result.pages,[]);
  assert.equal(result.pageCount,null);
});

test('rejects unsupported extensions and invalid UTF-8 text',async () => {
  await assert.rejects(extractProductDocumentText({buffer:Buffer.from('x'),fileName:'terms.doc'}),/仅支持 PDF/);
  await assert.rejects(extractProductDocumentText({buffer:Buffer.from([0xff,0xfe]),fileName:'terms.txt'}),/UTF-8/);
});

test('extracts DOCX raw text and retains parser warnings',async () => {
  let args;
  const result = await extractProductDocumentText({
    buffer:Buffer.from('docx'),fileName:'product.docx',
    wordParser:{extractRawText:async (input) => { args=input; return {value:'产品说明\r\n保障内容',messages:[{type:'warning',message:'表格内容可能丢失'}]}; }},
  });
  assert.equal(args.buffer.toString(),'docx');
  assert.equal(result.text,'产品说明\n保障内容');
  assert.deepEqual(result.warnings,['表格内容可能丢失']);
});

test('extracts PDF page text and always destroys the parser',async () => {
  let destroyed = false;
  const result = await extractProductDocumentText({
    buffer:Buffer.from('pdf'),fileName:'terms.pdf',
    pdfParserFactory:() => ({getText:async () => ({total:2,pages:[{num:1,text:'等待期为 90 天。'},{num:2,text:'具体责任以合同为准。'}]}),destroy:async () => { destroyed=true; }}),
  });
  assert.equal(result.pageCount,2);
  assert.deepEqual(result.pages,[{num:1,text:'等待期为 90 天。'},{num:2,text:'具体责任以合同为准。'}]);
  assert.match(result.text,/【第 1 页】/);
  assert.equal(destroyed,true);
});

test('scanned PDFs without extractable page text do not look like successfully parsed documents',async () => {
  const result = await extractProductDocumentText({
    buffer:Buffer.from('pdf'),fileName:'scan.pdf',
    pdfParserFactory:() => ({getText:async () => ({total:12,pages:Array.from({length:12},(_unused,index) => ({num:index + 1,text:''}))}),destroy:async () => {}}),
  });
  assert.equal(result.text,'');
  assert.equal(result.pages.length,12);
  assert.ok(result.pages.every((page) => page.text === ''));
});

test('destroys the PDF parser after a parse error and enforces text limits',async () => {
  let destroyed = false;
  await assert.rejects(extractProductDocumentText({
    buffer:Buffer.from('pdf'),fileName:'terms.pdf',
    pdfParserFactory:() => ({getText:async () => { throw new Error('bad pdf'); },destroy:async () => { destroyed=true; }}),
  }),/bad pdf/);
  assert.equal(destroyed,true);
  assert.equal(PRODUCT_DOCUMENT_MAX_BYTES,25 * 1024 * 1024);
  assert.deepEqual(limitProductDocumentText('123456',4),{text:'1234',truncated:true,originalLength:6});
});
