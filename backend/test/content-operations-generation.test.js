import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentOperations } from '../content-operations.js';
import { deepseekTextModel } from '../deepseek-client.js';

test('all content categories use DeepSeek for drafts and humanizer routing',async () => {
  for (const contentTypeCode of ['insurance_education','product_explainer','customer_case']) {
    const topic = {id:`T-${contentTypeCode}`,title:'示例内容主题',category:'保险基础',platforms:['知乎'],content_type_code:contentTypeCode};
    const inserts = [];
    const apiQueries = [];
    const client = {query:async (sql,params=[]) => {
      if (sql.includes('SELECT * FROM drafts')) return {rows:[]};
      if (sql.includes('INSERT INTO drafts')) { inserts.push({sql,params}); return {rows:[]}; }
      if (sql.includes("UPDATE topics SET status='待审核'")) return {rows:[]};
      throw new Error(`Unexpected transactional SQL: ${sql}`);
    }};
    const service = Object.create(ContentOperations.prototype);
    service.db = {
      query:async (sql,params=[]) => { apiQueries.push({sql,params}); return {rows:[]}; },
      transaction:async (callback) => callback(client),
    };
    service.loadTopicGenerationContext = async () => ({topic,material:'已确认的资料出处'});
    service.getSettings = async () => ({content:{}});
    let modelCalls = 0;
    service.callDeepSeekModel = async (instructions,input) => {
      modelCalls += 1;
      assert.match(instructions,/资料/);
      assert.match(input,/已确认的资料出处/);
      return {drafts:[{platform:'知乎',title:'生成的内容标题',body:'根据已确认资料整理的正文。'}]};
    };
    let humanizerRequest;
    service.runSkill = async (request) => {
      humanizerRequest = request;
      return {drafts:[{platform:'知乎',text:'DeepSeek humanizer 润色后的正文。'}]};
    };
    service.listTopics = async () => [topic];

    const result = await service.generateDrafts(topic.id);

    assert.equal(modelCalls,1,`${contentTypeCode} should call DeepSeek once`);
    assert.equal(result.mode,'deepseek');
    assert.equal(result.provider,deepseekTextModel());
    assert.equal(humanizerRequest.provider,'deepseek');
    assert.equal(inserts.length,1);
    assert.equal(inserts[0].params[8],deepseekTextModel());
    assert.equal(inserts[0].params[4],'DeepSeek humanizer 润色后的正文。');
    assert.ok(apiQueries.some(({sql}) => sql.includes("generation_status='running'")));
  }
});

test('product explainer generation receives confirmed facts without internal citations',async () => {
  const service = Object.create(ContentOperations.prototype);
  service.db = {query:async (sql) => sql.startsWith('SELECT * FROM topics')
    ? {rows:[{id:'T-PRODUCT',content_type_code:'product_explainer'}]}
    : {rows:[{status:'已确认',source_snapshot:{
      productName:'传世安心医疗险',shortName:'安心医疗',productVersion:'2026版',effectiveDate:'2026-01-01',
      positioning:'高端医疗保障',documentName:'保险条款.pdf',openQuestions:['需要核实精确费率表'],
      facts:[
        {confirmed:true,category:'保障责任',title:'免赔额',productFact:'计划包含不同免赔额选项。',plainExplanation:'免赔额会影响由个人承担的费用。',customerValue:'可根据费用承受能力了解计划差别。',boundary:'具体档位以投保方案为准。',sourceRefs:[{documentName:'保险条款.pdf',page:4,quote:'原文内容'}]},
        {confirmed:false,category:'价格',title:'具体费率',productFact:'尚未核实的价格。',sourceRefs:[{documentName:'费率表.pdf',page:2,quote:'未核实内容'}]},
      ],
    }}]},
  };

  const result = await service.loadTopicGenerationContext('T-PRODUCT');
  const material = JSON.parse(result.material);
  assert.equal(material.productName,'传世安心医疗险');
  assert.equal(material.facts.length,1);
  assert.equal(material.facts[0].productFact,'计划包含不同免赔额选项。');
  assert.equal('sourceRefs' in material.facts[0],false);
  assert.equal('openQuestions' in material,false);
  assert.equal('documentName' in material,false);
});
