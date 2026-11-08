import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDraftGenerationPrompt, buildXhsCardPlanPrompt, demoXhsCardPlan, normalizeEditableXhsCardPlan, normalizeXhsCardPlan } from '../content-prompts.js';
import { ContentOperations } from '../content-operations.js';

test('draft generation prompt gives selected platforms distinct writing goals',() => {
  const prompt = buildDraftGenerationPrompt({title:'等待期是什么',category:'误区澄清',platforms:['知乎','小红书','公众号']});
  assert.deepEqual(prompt.platforms,['知乎','小红书','公众号']);
  assert.match(prompt.instructions,/【知乎回答】[\s\S]*直接回答问题/);
  assert.match(prompt.instructions,/【公众号文章】[\s\S]*标题、摘要和正文/);
  assert.match(prompt.instructions,/【小红书图文】[\s\S]*精炼发布配文/);
  assert.match(prompt.instructions,/避免配文与卡片整段重复/);
  assert.match(prompt.instructions,/解释类内容卡建议 2–3 条 keyPoints，每条约 20–35 个汉字/);
  assert.match(prompt.instructions,/不要只写关键词或口号/);
  assert.match(prompt.instructions,/不使用 Markdown 粗体语法或输出 \*\* 符号/);
  assert.match(prompt.input,/"selectedPlatforms":\["知乎","小红书","公众号"\]/);
});

test('draft generation prompt excludes platforms the user did not select',() => {
  const prompt = buildDraftGenerationPrompt({title:'保险责任',platforms:['知乎']});
  assert.deepEqual(prompt.platforms,['知乎']);
  assert.doesNotMatch(prompt.instructions,/【公众号文章】|【小红书图文】/);
});

test('product and customer case prompts include category safeguards and supplied source material',() => {
  const product = buildDraftGenerationPrompt({title:'保障范围解读',platforms:['知乎'],contentTypeCode:'product_explainer',contentTypeName:'产品解读',materials:'产品版本：2026版；已确认责任：以资料为准'});
  assert.match(product.instructions,/已确认资料/);
  assert.match(product.instructions,/待核实/);
  assert.match(product.instructions,/不承诺收益或理赔结果/);
  assert.match(product.input,/2026版/);
  assert.match(product.instructions,/不自行换算或推导年化收益率、IRR/);
  assert.match(product.instructions,/不是资料摘要/);
  assert.match(product.instructions,/3–5 条与问题最相关的已确认产品事实/);
  assert.match(product.instructions,/sources 字段留空/);
  assert.match(product.instructions,/sourceRefs、文件名、页码、原文摘录和 openQuestions 是内部核对信息/);
  assert.match(product.instructions,/现有资料不足以给出准确金额/);

  const customerCase = buildDraftGenerationPrompt({title:'保障需求整理',platforms:['公众号'],contentTypeCode:'customer_case',contentTypeName:'客户案例',materials:'情景示例：家庭希望梳理医疗保障'});
  assert.match(customerCase.instructions,/姓名、电话、保单号/);
  assert.match(customerCase.instructions,/情景示例/);
  assert.match(customerCase.instructions,/不泛化为普遍结果/);
  assert.match(customerCase.instructions,/注明来源的数值/);
});

test('generation context blocks a real case without confirmed authorization and anonymization',async () => {
  const operations = new ContentOperations();
  operations.db = {query:async (sql) => {
    if (sql.startsWith('SELECT * FROM topics')) return {rows:[{id:'T-CASE',content_type_code:'customer_case'}]};
    return {rows:[{case_kind:'authorized_real',summary:'已脱敏摘要',needs:'',analysis:'',outcome:'',authorization_confirmed:false,anonymization_confirmed:true}]};
  }};
  await assert.rejects(() => operations.loadTopicGenerationContext('T-CASE'),/授权并完成脱敏/);
});

test('case authorization and anonymization require explicit boolean confirmations',async () => {
  const operations = new ContentOperations();
  let confirmations;
  let productLink;
  let caseValues;
  operations.db = {
    transaction:async (work) => work({query:async (sql,params) => {
      if (sql.includes('INSERT INTO content_topic_products')) productLink = params.slice(1,3);
      if (sql.includes('INSERT INTO content_topic_cases')) { caseValues = params; confirmations = params.slice(6,8); }
      return {rows:[]};
    }}),
    query:async (sql) => sql.includes('FROM product_extractions') ? {rows:[{
      product_id:7,product_name:'家庭安心计划',short_name:'安心计划',product_version:'2026版',effective_date:'2026-01-01',product_status:'在售',insurance_type:'寿险',
      extraction_id:17,extraction_status:'已确认',confirmed_at:'2026-10-01',positioning:'家庭保障',facts:[],open_questions:[],document_id:3,document_name:'产品条款.pdf',
    }]} : {rows:[]},
  };
  await operations.createTopic({title:'脱敏案例说明',contentTypeCode:'customer_case',productId:7,extractionId:17,caseKind:'authorized_real',caseSummary:'仅包含已确认的脱敏摘要',caseFinancialDetails:'对应方案：资料中的年缴保费；来源：产品条款.pdf',platforms:['知乎'],authorizationConfirmed:'true',anonymizationConfirmed:true});
  assert.deepEqual(productLink,[7,17]);
  assert.deepEqual(confirmations,[false,true]);
  assert.equal(caseValues[8],'对应方案：资料中的年缴保费；来源：产品条款.pdf');
});

test('customer case topic creation requires a linked product source',async () => {
  const operations = new ContentOperations();
  operations.db = {query:async () => { throw new Error('database should not be queried without a product selection'); }};
  await assert.rejects(() => operations.createTopic({title:'保障需求案例',contentTypeCode:'customer_case',caseSummary:'已脱敏摘要'}),/具体产品及已确认的资料版本/);
});

test('legacy Xiaohongshu drafts get a card plan prompt without generating images',() => {
  const prompt = buildXhsCardPlanPrompt({title:'等待期是什么',body:'精炼发布配文',sources:'正式条款'});
  assert.match(prompt.instructions,/3–5 张生产用图卡规划/);
  assert.match(prompt.instructions,/解释类卡片建议提供 2–3 条 keyPoints，每条约 20–35 个汉字/);
  assert.match(prompt.instructions,/意思完整的短句/);
  assert.match(prompt.input,/"caption":"精炼发布配文"/);
  assert.match(prompt.input,/"verifiedSources":"正式条款"/);
  assert.doesNotMatch(prompt.instructions,/调用生图|生成图片/);
});

test('demo Xiaohongshu card copy includes enough context without turning into paragraphs',() => {
  const plan = demoXhsCardPlan('等待期是什么','了解等待期时要先看合同中的具体约定。不同产品设置可能不同，请结合合同责任、期限和免责条件一起理解。');
  assert.equal(plan.length,4);
  assert.ok(plan[0].keyPoints.some((point) => point.length >= 20));
  for (const card of plan.slice(1)) {
    assert.equal(card.keyPoints.length,2);
    const totalTextLength = card.keyPoints.reduce((sum,point) => sum + point.length,0);
    assert.ok(totalTextLength >= 50 && totalTextLength <= 110,`${card.role} card has ${totalTextLength} characters of supporting copy`);
  }
});

test('strict image plan requires 3–5 complete cards while editing can save partial cards',() => {
  const partial = [{role:'cover',headline:'',keyPoints:[],visualDirection:''}];
  assert.equal(normalizeXhsCardPlan(partial),null);
  assert.deepEqual(normalizeEditableXhsCardPlan(partial),partial);
  assert.equal(normalizeEditableXhsCardPlan(Array.from({length:6},() => partial[0])),null);
  const complete = Array.from({length:3},(_unused,index) => ({role:index === 0 ? 'cover' : 'concept',headline:`标题 ${index}`,keyPoints:['要点'],visualDirection:''}));
  assert.equal(normalizeXhsCardPlan(complete).length,3);
});
