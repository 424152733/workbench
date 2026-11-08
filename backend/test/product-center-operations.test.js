import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductCenterOperations } from '../product-center-operations.js';
import { WorkbenchService } from '../workbench.service.js';

test('product center domain operations are exposed through the shared WorkbenchService facade',() => {
  const service = new WorkbenchService({});
  for (const method of ['productCenterMeta','createInsuranceProduct','uploadProductDocument','analyzeProductDocument','analyzeProductMaterials','generateProductCopyDraft','productCopyDraftVersions','restoreProductCopyDraftVersion']) {
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

test('product material analysis sends every parsed document once and stores all source links',async () => {
  const documents = [
    {id:17,product_id:2,file_name:'正式条款.pdf',document_type:'policy_terms',parse_status:'parsed',page_count:1,
      extracted_text:'保险责任等待期为九十天，具体保险责任以保险合同为准。'.repeat(3),extracted_pages:[{num:1,text:'保险责任等待期为九十天，具体保险责任以保险合同为准。'.repeat(3)}],extracted_char_count:60},
    {id:18,product_id:2,file_name:'费率表.pdf',document_type:'rate_table',parse_status:'needs_review',page_count:1,
      extracted_text:'保险费按照投保年龄和缴费期限确定。具体费率以正式费率表为准。'.repeat(3),extracted_pages:[{num:1,text:'保险费按照投保年龄和缴费期限确定。具体费率以正式费率表为准。'.repeat(3)}],extracted_char_count:66},
  ];
  const linkedDocuments=[];
  const insertedFacts=[
    {id:'fact-1',category:'保障责任',title:'等待期',productFact:'等待期为九十天。',plainExplanation:'等待期以条款为准',customerValue:'',boundary:'',confirmed:false,
      sourceRefs:[{documentId:17,documentName:'正式条款.pdf',page:1,section:'',quote:'保险责任等待期为九十天。',verified:true}]},
    {id:'fact-2',category:'产品特点',title:'费率依据',productFact:'保险费按照投保年龄和缴费期限确定。',plainExplanation:'',customerValue:'',boundary:'',confirmed:false,
      sourceRefs:[{documentId:18,documentName:'费率表.pdf',page:1,section:'',quote:'保险费按照投保年龄和缴费期限确定。',verified:true}]},
  ];
  const service=Object.create(ProductCenterOperations.prototype);
  service.findInsuranceProduct=async()=>({id:2,company_code:'aia-life',company_label:'友邦保险',insurance_type_code:'life',insurance_type_label:'寿险',product_name:'示例产品'});
  service.db={
    query:async (sql) => {
      assert.match(sql,/FROM product_documents WHERE product_id/);
      return {rows:documents};
    },
    transaction:async (work)=>work({query:async (sql,params=[])=>{
      if (sql.includes('INSERT INTO product_extractions')) return {rows:[{id:77,product_id:2,document_id:17,positioning:'保障产品',facts:insertedFacts,open_questions:[],status:'待核对',provider:'deepseek',created_at:'2026-10-21T00:00:00.000Z'}]};
      if (sql.includes('INSERT INTO product_extraction_documents')) { linkedDocuments.push(params[2]); return {rows:[]}; }
      if (sql.includes('UPDATE insurance_products')) return {rows:[]};
      if (sql.includes('FROM product_extractions e JOIN product_documents doc')) return {rows:[{
        id:77,product_id:2,document_id:17,file_name:'正式条款.pdf',document_type:'policy_terms',page_count:1,
        positioning:'保障产品',facts:insertedFacts,open_questions:[],status:'待核对',provider:'deepseek',
        source_documents:[{id:17,fileName:'正式条款.pdf',documentType:'policy_terms',pageCount:1},{id:18,fileName:'费率表.pdf',documentType:'rate_table',pageCount:1}],
      }]};
      throw new Error(`Unexpected SQL: ${sql}`);
    }}),
  };
  let modelCalls=0;
  service.callDeepSeekModel=async (_instructions,input,timeoutMs,modelOptions)=>{
    modelCalls+=1;
    assert.equal(timeoutMs,120_000);
    assert.deepEqual(modelOptions,{reasoningEffort:'low',maxTokens:32_768});
    const payload=JSON.parse(input);
    assert.deepEqual(payload.documents.map((item)=>item.sourceId),['doc-17','doc-18']);
    assert.match(payload.sourceText,/正式条款\.pdf/);
    assert.match(payload.sourceText,/费率表\.pdf/);
    return {positioning:'保障产品',facts:[
      {title:'等待期',productFact:'等待期为九十天。',sourceRefs:[{sourceId:'doc-17',page:1,quote:'保险责任等待期为九十天。'}]},
      {title:'费率依据',productFact:'保险费按照投保年龄和缴费期限确定。',sourceRefs:[{sourceId:'doc-18',page:1,quote:'保险费按照投保年龄和缴费期限确定。'}]},
    ],openQuestions:[]};
  };
  const result=await service.analyzeProductMaterials(2);
  assert.equal(modelCalls,1);
  assert.deepEqual(linkedDocuments,[17,18]);
  assert.equal(result.sourceDocuments.length,2);
  assert.deepEqual(result.facts.map((fact)=>fact.sourceRefs[0].documentId),[17,18]);
});

test('product material analysis refuses the whole bundle when one document is still unavailable',async()=>{
  const service=Object.create(ProductCenterOperations.prototype);
  service.findInsuranceProduct=async()=>({id:2,company_code:'aia-life',company_label:'友邦保险',insurance_type_code:'life',insurance_type_label:'寿险',product_name:'示例产品'});
  service.db={query:async()=>({rows:[
    {id:17,file_name:'已解析.pdf',document_type:'policy_terms',parse_status:'parsed',extracted_text:'保险责任等待期为九十天，具体保险责任以合同为准。',extracted_pages:[],extracted_char_count:28},
    {id:18,file_name:'待解析.pdf',document_type:'rate_table',parse_status:'processing',extracted_text:'',extracted_pages:[],extracted_char_count:0},
  ]})};
  service.callDeepSeekModel=async()=>{throw new Error('model should not be called');};
  await assert.rejects(service.analyzeProductMaterials(2),(error)=>error instanceof BadRequestException && /待解析\.pdf/.test(error.message));
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

test('restoring a legacy product copy version directs users to the shared content workspace',async () => {
  const service = Object.create(ProductCenterOperations.prototype);
  await assert.rejects(service.restoreProductCopyDraftVersion(30,1),(error) =>
    error instanceof ConflictException && /内容工作台/.test(error.message));
});

test('official material import rejects an unapproved redirect before fetching its target',async()=>{
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(url,options={})=>{
    requests.push({url:String(url),options});
    return new Response(null,{status:302,headers:{location:'https://attacker.example/private.pdf'}});
  };
  const service=Object.create(ProductCenterOperations.prototype);
  service.findInsuranceProduct=async()=>({source_type:'official_sync',company_code:'xinhua',official_product_url:'https://www.newchinalife.com/product'});
  service.db={query:async()=>({rows:[{
    id:21,product_id:8,is_current:true,source_url:'https://www.newchinalife.com/product/terms.pdf',
    source_page_url:'https://www.newchinalife.com/product',material_type:'policy_terms',label:'保险条款',
  }]})};
  try {
    await assert.rejects(service.importOfficialProductMaterial(8,21),(error)=>
      error instanceof BadRequestException && /未授权域名/.test(error.message));
    assert.equal(requests.length,1);
    assert.equal(requests[0].options.redirect,'manual');
  } finally {
    globalThis.fetch=originalFetch;
  }
});
