import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChunkData, PolicyContractOperations } from '../policy-contract-operations.js';

test('only payout scenarios backed by a quote on the cited page survive', () => {
  const chunk={pages:[5],excerpts:[{page:5,text:'等待期内因疾病身故，按已交保费的1.1倍给付。因意外身故，按基本保险金额20万元给付。'}]};
  const result=normalizeChunkData({benefits:[{name:'身故保险金',page:5,scenarios:[
    {trigger:'等待期内因疾病身故',amount:'已交保费的1.1倍',page:5,sourceQuote:'等待期内因疾病身故，按已交保费的1.1倍给付'},
    {trigger:'因意外身故',amount:'基本保险金额100万元',page:5,sourceQuote:'因意外身故，按基本保险金额20万元给付'},
    {trigger:'无来源',amount:'20万元',page:6,sourceQuote:'按基本保险金额20万元给付'},
  ]}]},chunk);
  assert.equal(result.benefits.length,1);
  assert.equal(result.benefits[0].scenarios.length,1);
  assert.equal(result.benefits[0].scenarios[0].evidenceVerified,true);
});

test('a payout limit must appear in the cited quote, not merely elsewhere on the page', () => {
  const chunk={pages:[5],excerpts:[{page:5,text:'符合条件按基本保险金额20万元给付。年度累计给付限额200万元。'}]};
  const result=normalizeChunkData({benefits:[{name:'保险金',page:5,scenarios:[
    {trigger:'符合条件',amount:'20万元',limit:'200万元',page:5,sourceQuote:'符合条件按基本保险金额20万元给付'},
  ]}]},chunk);
  assert.equal(result.benefits[0].scenarios.length,0);
});

test('waiting period outside the amount quote does not discard a verified payout', () => {
  const chunk={pages:[19],excerpts:[{page:19,text:'等待期为90日。轻症疾病保险金按基本保险金额的25%给付。'}]};
  const result=normalizeChunkData({benefits:[{name:'轻症疾病保险金',page:19,scenarios:[
    {trigger:'等待期90日后确诊轻症',amount:'基本保险金额的25%',page:19,sourceQuote:'轻症疾病保险金按基本保险金额的25%给付'},
  ]}]},chunk);
  assert.equal(result.benefits[0].scenarios.length,1);
});

test('a quoted scenario failure does not erase a payout figure present in its named clause', () => {
  const chunk={pages:[19],excerpts:[{page:19,text:'轻症疾病保险金按基本保险金额的25%、30%、35%逐次给付。'}]};
  const result=normalizeChunkData({benefits:[{name:'轻症疾病保险金',page:19,amount:'基本保险金额的25%、30%、35%',summary:'分三次给付',scenarios:[
    {trigger:'确诊轻症',amount:'25%',page:19,sourceQuote:'错误的引文'},
  ]}]},chunk);
  assert.equal(result.benefits[0].amount,'基本保险金额的25%、30%、35%');
  assert.equal(result.benefits[0].scenarios.length,0);
  const invalid=normalizeChunkData({benefits:[{name:'轻症疾病保险金',page:19,amount:'基本保险金额的50%',scenarios:[
    {trigger:'确诊轻症',amount:'50%',page:19,sourceQuote:'错误的引文'},
  ]}]},chunk);
  assert.equal(invalid.benefits[0].amount,'');
});

test('split chunk results merge scenarios even when an earlier benefit has no scenario array', () => {
  const operation=new PolicyContractOperations();
  const merged=operation.mergeSplitPolicyContractResults([{data:{policy:{},benefits:[{name:'身故保险金',amount:'',page:5}]}},
    {data:{policy:{},benefits:[{name:'身故保险金',amount:'',page:5,scenarios:[{trigger:'因意外身故',amount:'20万元',page:5}]}]}}]);
  assert.equal(merged.data.benefits.length,1);
  assert.equal(merged.data.benefits[0].scenarios.length,1);
});
