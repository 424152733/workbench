import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ProductCenterOperations } from '../product-center-operations.js';
import { WorkbenchService } from '../workbench.service.js';

test('product center domain operations are exposed through the shared WorkbenchService facade',() => {
  const service = new WorkbenchService({});
  for (const method of ['productCenterMeta','createInsuranceProduct','uploadProductDocument','analyzeProductDocument','generateProductCopyDraft','productCopyDraftVersions','restoreProductCopyDraftVersion']) {
    assert.equal(typeof service[method],'function',`${method} should be available on WorkbenchService`);
  }
});

test('product applicability dates are serialized as stable ISO dates',async () => {
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = {query:async () => ({rows:[{
    id:1,company_code:'xinhua',company_label:'新华保险',insurance_type_code:'life',insurance_type_label:'寿险',
    product_name:'示例产品',effective_date:new Date('2026-10-21T00:00:00.000Z'),status:'可用',
  }]})};
  const [product] = await service.listProductCenterProducts();
  assert.equal(product.effectiveDate,'2026-10-21');
});

const verifiedFact = (confirmed=false) => ({
  id:'fact-1',category:'保障责任',title:'等待期',productFact:'等待期为九十天',
  plainExplanation:'责任开始时间需要看条款',customerValue:'帮助理解责任何时开始',boundary:'以合同为准',confirmed,
  sourceRefs:[{documentId:5,documentName:'产品说明.txt',page:null,section:'等待期',quote:'等待期为九十天',verified:true}],
});

function extractionFixture({confirmed=false}={}) {
  const state = {
    id:11,product_id:2,document_id:5,positioning:'健康保障',facts:[verifiedFact(confirmed)],
    open_questions:[],status:confirmed ? '已确认' : '待核对',provider:'openai:gpt@6-luna',
    confirmed_at:confirmed ? '2026-10-17T00:00:00.000Z' : null,created_at:'2026-10-17T00:00:00.000Z',updated_at:'2026-10-17T00:00:00.000Z',
    file_name:'产品说明.txt',document_type:'product_brief',page_count:null,
  };
  const versions = [];
  const draftUpdates = [];
  const draft = {id:30,product_id:2,extraction_id:11,platform:'知乎',title:'原文案',summary:'',body:'旧正文',hashtags:'',sources:'产品说明.txt',status:'已审核',approval_checks:[true,true,true],provider:'openai:gpt@6-luna',humanized:true,html_content:'',version:3,approved_at:'2026-10-17T00:00:00.000Z'};
  const client = {query:async (sql,params=[]) => {
    if (sql.includes('SELECT e.*,doc.file_name')) return {rows:[{...state,facts:JSON.parse(JSON.stringify(state.facts))}]};
    if (sql.includes('UPDATE product_extractions SET facts=')) {
      state.facts = JSON.parse(params[1]); state.status='待核对'; state.confirmed_at=null;
      return {rows:[{...state,facts:JSON.parse(JSON.stringify(state.facts))}]};
    }
    if (sql.includes('SELECT * FROM product_copy_drafts')) return {rows:[{...draft}]};
    if (sql.includes('INSERT INTO product_copy_versions')) { versions.push({draftId:params[0],version:params[1],snapshot:JSON.parse(params[2]),changedBy:params[3]}); return {rows:[]}; }
    if (sql.includes('UPDATE product_copy_drafts SET status=')) { draftUpdates.push({draftId:params[0],version:params[1]}); return {rows:[]}; }
    if (sql.includes("SET status='已确认'")) {
      state.status='已确认'; state.confirmed_at='2026-10-17T00:00:00.000Z';
      return {rows:[{...state,facts:JSON.parse(JSON.stringify(state.facts))}]};
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  return {
    state,versions,draftUpdates,
    db:{transaction:async (work) => work(client)},
  };
}

test('saving product facts keeps server citations and atomically invalidates reviewed drafts',async () => {
  const fixture = extractionFixture({confirmed:true});
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = fixture.db;
  const result = await service.updateProductExtraction(11,{facts:[{
    ...verifiedFact(true),title:'等待期说明',sourceRefs:[{verified:true,documentName:'client supplied citation',quote:'made up'}],
  }]});
  assert.equal(result.status,'待核对');
  assert.equal(result.facts[0].title,'等待期说明');
  assert.equal(result.facts[0].sourceRefs[0].documentName,'产品说明.txt');
  assert.equal(fixture.versions.length,1);
  assert.equal(fixture.versions[0].snapshot.status,'已审核');
  assert.deepEqual(fixture.draftUpdates,[{draftId:30,version:4}]);
});

test('product facts cannot be confirmed until each fact is checked',async () => {
  const fixture = extractionFixture({confirmed:false});
  fixture.state.facts[0].confirmed=false;
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = fixture.db;
  await assert.rejects(service.confirmProductExtraction(11),BadRequestException);
  assert.equal(fixture.state.status,'待核对');
});

test('confirmed facts with verified citations can transition to confirmed status',async () => {
  const fixture = extractionFixture({confirmed:true});
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = fixture.db;
  const result = await service.confirmProductExtraction(11);
  assert.equal(result.status,'已确认');
  assert.ok(result.confirmedAt);
});

test('platform expression preferences can be edited without creating a second prompt path',async () => {
  const row = {platform:'知乎',audience:'普通读者',tone:'清楚克制',structure:'先答结论再解释',length_hint:'中长篇',updated_at:'2026-10-17T00:00:00.000Z'};
  const db = {query:async (sql,params=[]) => {
    if (sql.includes('SELECT platform,audience,tone')) return {rows:[{...row}]};
    if (sql.includes('UPDATE product_platform_settings')) return {rows:[{...row,audience:params[1],tone:params[2],structure:params[3],length_hint:params[4]}]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = db;
  const result = await service.updateProductPlatformSettings('知乎',{audience:'准备了解保险的读者',lengthHint:'简短回答'});
  assert.equal(result.audience,'准备了解保险的读者');
  assert.equal(result.lengthHint,'简短回答');
  await assert.rejects(service.updateProductPlatformSettings('抖音',{}),BadRequestException);
});

test('restoring a product copy version saves current content and returns an unapproved draft',async () => {
  const versions = [];
  const current = {
    id:30,product_id:2,extraction_id:11,platform:'知乎',title:'新版标题',summary:'',body:'新版正文',hashtags:'',sources:'条款.pdf',
    status:'已审核',approval_checks:[true,true,true],provider:'openai:gpt@6-luna',humanized:true,html_content:'',version:3,
    approved_at:'2026-10-17T00:00:00.000Z',settings_value:{content:{wechatTheme:'clean'}},platform_settings_snapshot:{tone:'precise',lengthHint:'long'},
  };
  const oldSnapshot = {title:'舊标题',summary:'',body:'原历史正文',hashtags:'',sources:'资料来源',status:'已审核',checks:[true,true,true],provider:'openai:gpt@6-luna',humanized:true,htmlContent:'',platformSettings:{tone:'warm'},version:1};
  const client = {query:async (sql,params=[]) => {
    if (sql.includes('SELECT d.*,p.product_name')) return {rows:[{...current}]};
    if (sql.includes('SELECT snapshot FROM product_copy_versions')) return {rows:[{snapshot:oldSnapshot}]};
    if (sql.includes('INSERT INTO product_copy_versions')) { versions.push({version:params[1],snapshot:JSON.parse(params[2]),changedBy:params[3]}); return {rows:[]}; }
    if (sql.includes('UPDATE product_copy_drafts SET title=')) return {rows:[{
      id:30,product_id:2,extraction_id:11,platform:'知乎',title:params[1],summary:params[2],body:params[3],hashtags:params[4],sources:params[5],
      status:'草稿',approval_checks:[false,false,false],provider:params[6],humanized:params[7],html_content:params[8],platform_settings_snapshot:JSON.parse(params[9]),version:params[10],approved_at:null,
    }]};
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const service = Object.create(ProductCenterOperations.prototype);
  service.db = {transaction:async (work) => work(client)};
  const result = await service.restoreProductCopyDraftVersion(30,1);
  assert.equal(result.title,'舊标题');
  assert.equal(result.body,'原历史正文');
  assert.equal(result.status,'草稿');
  assert.deepEqual(result.checks,[false,false,false]);
  assert.equal(result.version,4);
  assert.equal(result.approvedAt,null);
  assert.deepEqual(result.platformSettings,{tone:'warm'});
  assert.equal(versions[0].version,3);
  assert.equal(versions[0].snapshot.body,'新版正文');
});
