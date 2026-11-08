import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException,ServiceUnavailableException } from '@nestjs/common';
import {
  buildProductAnalysisPrompt,buildProductCopyPrompt,normalizeProductAnalysis,
  normalizeProductCopy,productCopySources,
} from '../product-center-prompts.js';

const document = {
  id:7,fileName:'新华产品说明.pdf',documentType:'product_brief',pageCount:1,
  extractedText:'本产品等待期为九十天，具体保险责任以保险合同约定为准。',
  pages:[{num:1,text:'本产品等待期为九十天，具体保险责任以保险合同约定为准。'}],
};

test('analysis prompt identifies the product source and requires exact, traceable evidence',() => {
  const prompt = buildProductAnalysisPrompt({product:{productName:'安心守护'},document});
  assert.match(prompt.instructions,/逐字摘自/);
  assert.match(prompt.input,/安心守护/);
  assert.match(prompt.input,/资料页码:1/);
  assert.throws(() => buildProductAnalysisPrompt({product:{},document:{...document,extractedText:''}}),BadRequestException);
});

test('analysis normalization verifies page citations against extracted source text',() => {
  const result = normalizeProductAnalysis({
    positioning:'健康保障产品',facts:[
      {category:'保障责任',title:'等待期',productFact:'等待期为九十天。',plainExplanation:'等待期内责任可能有限制。',sourceRefs:[{page:1,quote:'本产品等待期为九十天'}]},
      {category:'产品特点',title:'没有出处的要点',productFact:'资料未提供',sourceRefs:[{page:1,quote:'这是不存在的资料内容。'}]},
    ],openQuestions:['请补充适用人群'],
  },{documentId:7,document,documentText:document.extractedText,documentPages:document.pages});
  assert.equal(result.facts.length,1);
  assert.equal(result.facts[0].sourceRefs[0].verified,true);
  assert.equal(result.facts[0].sourceRefs[0].page,1);
  assert.equal(result.facts[0].confirmed,false);
  assert.deepEqual(result.openQuestions,['请补充适用人群']);
  assert.throws(() => normalizeProductAnalysis({facts:[{productFact:'无来源',sourceRefs:[]}]},{documentId:7,document,documentText:document.extractedText}),ServiceUnavailableException);
});

test('analysis prompt combines every product document and instructs the model to retain cross-file citations',() => {
  const terms = {id:17,fileName:'正式条款.pdf',documentType:'policy_terms',pageCount:2,
    extractedText:'保险责任等待期为九十天，具体保险责任以保险合同为准。',
    pages:[{num:1,text:'保险责任等待期为九十天，具体保险责任以保险合同为准。'}]};
  const rates = {id:18,fileName:'费率表.pdf',documentType:'rate_table',pageCount:1,
    extractedText:'本产品的保险费按照投保年龄和缴费期限确定。',
    pages:[{num:1,text:'本产品的保险费按照投保年龄和缴费期限确定。'}]};
  const prompt = buildProductAnalysisPrompt({product:{company:'友邦保险',productName:'友邦示例产品'},documents:[terms,rates]});
  assert.match(prompt.input,/doc-17/);
  assert.match(prompt.input,/doc-18/);
  assert.match(prompt.input,/友邦保险/);
  assert.match(prompt.instructions,/重复事实合并/);
  assert.match(prompt.instructions,/冲突/);
});

test('analysis normalization verifies each citation against the document and page it names',() => {
  const documents = [
    {id:17,fileName:'正式条款.pdf',extractedText:'保险责任等待期为九十天。',pages:[{num:1,text:'保险责任等待期为九十天。'}]},
    {id:18,fileName:'费率表.pdf',extractedText:'保险费按照投保年龄和缴费期限确定。',pages:[{num:1,text:'保险费按照投保年龄和缴费期限确定。'}]},
  ];
  const result = normalizeProductAnalysis({positioning:'保障产品',facts:[
    {title:'等待期',productFact:'等待期为九十天。',sourceRefs:[{sourceId:'doc-17',page:1,quote:'保险责任等待期为九十天。'}]},
    {title:'费率依据',productFact:'保费按年龄和缴费期确定。',sourceRefs:[{sourceId:'doc-18',page:1,quote:'保险费按照投保年龄和缴费期限确定。'}]},
    {title:'伪造来源',productFact:'这条应被丢弃。',sourceRefs:[{sourceId:'doc-99',page:1,quote:'保险责任等待期为九十天。'}]},
  ]},{documents});
  assert.equal(result.facts.length,2);
  assert.deepEqual(result.facts.map((fact) => fact.sourceRefs[0].documentId),[17,18]);
  assert.deepEqual(result.facts.map((fact) => fact.sourceRefs[0].documentName),['正式条款.pdf','费率表.pdf']);
  assert.ok(result.facts.every((fact) => fact.sourceRefs[0].verified));
});

test('copy prompt uses only confirmed facts and has separate platform guidance',() => {
  const confirmed = {category:'保障责任',title:'等待期',productFact:'等待期九十天',plainExplanation:'在一段时间后责任生效',customerValue:'便于理解责任开始时间',boundary:'以条款为准',confirmed:true,sourceRefs:[{verified:true,documentName:'资料.pdf',page:2,section:'责任免除',quote:'等待期为九十天'}]};
  const pending = {...confirmed,title:'尚未确认',confirmed:false};
  const prompt = buildProductCopyPrompt({product:{productName:'安心守护'},extraction:{positioning:'健康保障',facts:[confirmed,pending]},platform:'小红书',platformConfig:{audience:'普通读者'}});
  const input = JSON.parse(prompt.input);
  assert.equal(input.json,true);
  assert.equal(input.confirmedFacts.length,1);
  assert.match(prompt.instructions,/面向手机快速阅读/);
  assert.match(prompt.instructions,/不使用 Markdown 粗体符号/);
  assert.match(prompt.instructions,/只调整受众、语气、结构和篇幅/);
  assert.match(prompt.instructions,/"audience":"普通读者"/);
  assert.throws(() => buildProductCopyPrompt({product:{},extraction:{facts:[confirmed]},platform:'抖音'}),BadRequestException);
  assert.throws(() => buildProductCopyPrompt({product:{},extraction:{facts:[pending]},platform:'知乎'}),BadRequestException);
});

test('normalizes required copy fields and formats verified source labels',() => {
  const draft = normalizeProductCopy({platform:'公众号',title:'  产品介绍  ',summary:' 摘要 ',body:' 正文 ',hashtags:''},'公众号');
  assert.deepEqual(draft,{platform:'公众号',title:'产品介绍',summary:'摘要',body:'正文',hashtags:''});
  assert.throws(() => normalizeProductCopy({platform:'小红书',title:'标题',body:''},'小红书'),ServiceUnavailableException);
  assert.equal(productCopySources([{sourceRefs:[
    {verified:true,documentName:'条款.pdf',page:3,section:'保险责任'},
    {verified:false,documentName:'不可信资料',page:1},
  ]}]),'条款.pdf · 第 3 页 · 保险责任');
});
