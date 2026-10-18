import assert from 'node:assert/strict';
import { access,mkdir,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cleanGeneratedCopy, WorkbenchService } from '../workbench.service.js';
import { demoXhsCardPlan } from '../content-prompts.js';

test('generated copy uses natural list markers instead of markdown bold and rigid step labels',() => {
  const source = '先看合同约定。\n\n**第一步：确认保障对象。**\n第二步：核对保障责任。\n\n1. 看适用条件\n2、核对免责内容';
  assert.equal(cleanGeneratedCopy(source),'先看合同约定。\n\n① 确认保障对象。\n② 核对保障责任。\n\n① 看适用条件\n② 核对免责内容');
  assert.doesNotMatch(cleanGeneratedCopy(source),/\*\*|第[一二三四五六七八九十\d]+步/);
});

test('topic recommendations can be filtered by insurance type and refreshed without repeated titles',async () => {
  const previousKey = process.env.RUNWARE_API_KEY;
  delete process.env.RUNWARE_API_KEY;
  const service = new WorkbenchService({query:async () => ({rows:[]})});
  try {
    const first = await service.suggestTopics('财险');
    assert.equal(first.provider,'demo');
    assert.equal(first.topics.length,5);
    assert.ok(first.topics.every((topic) => topic.insuranceType === '财险'));
    const second = await service.suggestTopics('财险',JSON.stringify(first.topics.map((topic) => topic.title)));
    assert.equal(second.topics.length,5);
    assert.ok(second.topics.every((topic) => topic.insuranceType === '财险'));
    assert.ok(second.topics.every((topic) => !first.topics.some((item) => item.title === topic.title)));
    await assert.rejects(service.suggestTopics('不支持的险种'),(error) => error.getStatus?.() === 400);
  } finally {
    if (previousKey === undefined) delete process.env.RUNWARE_API_KEY;
    else process.env.RUNWARE_API_KEY = previousKey;
  }
});

test('WeChat export preserves rich-text structure and escapes raw HTML',() => {
  const html = new WorkbenchService({}).renderWechatHtml('保障范围怎么读','先看合同约定','## 责任范围\n\n请核对 **保险责任** 和适用条件。\n\n- 保障责任\n- 责任免除\n\n<script>alert(1)</script>','warm');
  assert.match(html,/data-theme="warm"/);
  assert.match(html,/<h2[^>]*>责任范围<\/h2>/);
  assert.match(html,/<strong[^>]*>保险责任<\/strong>/);
  assert.match(html,/<ul[^>]*><li[^>]*>保障责任<\/li><li[^>]*>责任免除<\/li><\/ul>/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
});

test('topic deletion also removes its associated image files',async () => {
  const storageName = `codex-delete-test-${process.pid}-${Date.now()}.png`;
  const storagePath = path.resolve('backend/uploads',storageName);
  await mkdir(path.dirname(storagePath),{recursive:true});
  await writeFile(storagePath,'temporary test image');
  const queries = [];
  const db = {
    async transaction(work) { return work({query:this.query.bind(this)}); },
    async query(sql,params) {
      queries.push({sql,params});
      if (sql.startsWith('SELECT id FROM topics')) return {rows:[{id:params[0]}]};
      if (sql.startsWith('SELECT p.id FROM content_publications')) return {rows:[],rowCount:0};
      if (sql.startsWith('SELECT storage_name FROM assets')) return {rows:[{storage_name:storageName}]};
      if (sql.startsWith('DELETE FROM topics')) return {rows:[]};
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  try {
    const result = await new WorkbenchService(db).deleteTopic('T-TEST');
    assert.deepEqual(result,{id:'T-TEST'});
    assert.equal(queries.length,4);
    assert.deepEqual(queries[0].params,['T-TEST']);
    assert.deepEqual(queries[1].params,['T-TEST']);
    assert.deepEqual(queries[2].params,['T-TEST']);
    assert.deepEqual(queries[3].params,['T-TEST']);
    await assert.rejects(access(storagePath),{code:'ENOENT'});
  } finally {
    await rm(storagePath,{force:true});
  }
});

test('topic deletion preserves publication history',async () => {
  const db = {
    async transaction(work) { return work({query:this.query.bind(this)}); },
    async query(sql) {
      if (sql.startsWith('SELECT id FROM topics')) return {rows:[{id:'T-TEST'}]};
      if (sql.startsWith('SELECT p.id FROM content_publications')) return {rows:[{id:1}],rowCount:1};
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  await assert.rejects(new WorkbenchService(db).deleteTopic('T-TEST'),(error) => error.getStatus?.() === 409);
});

test('topic deletion reports a missing topic',async () => {
  const db = {
    async transaction(work) { return work({query:this.query.bind(this)}); },
    async query(sql) {
      if (sql.startsWith('SELECT id FROM topics')) return {rows:[]};
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  await assert.rejects(new WorkbenchService(db).deleteTopic('T-MISSING'),(error) => error.getStatus?.() === 404);
});

function createSettingsService() {
  let content;
  const db = {
    async query(sql,params = []) {
      if (sql.includes("SELECT key,value FROM settings")) {
        return {rows:content ? [{key:'content',value:content}] : []};
      }
      if (sql.includes("SELECT value FROM settings WHERE key='content'")) {
        return {rows:content ? [{value:content}] : []};
      }
      if (sql.includes("INSERT INTO settings(key,value) VALUES('content',$1)")) {
        content = JSON.parse(params[0]);
        return {rows:[]};
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  return new WorkbenchService(db);
}

test('Xiaohongshu image mode defaults to test and persists the selected mode',async () => {
  const service = createSettingsService();
  const defaults = await service.getSettings();
  assert.equal(defaults.content.xhsImageMode,'test');

  const updated = await service.updateSettings({content:{xhsImageMode:'production'}});
  assert.equal(updated.content.xhsImageMode,'production');
  assert.equal((await service.getSettings()).content.xhsImageMode,'production');
});

test('Xiaohongshu image mode only accepts test or production',async () => {
  const service = createSettingsService();
  for (const xhsImageMode of ['preview','test-mode',1,null]) {
    await assert.rejects(
      service.updateSettings({content:{xhsImageMode}}),
      (error) => error.getStatus?.() === 400,
    );
  }
});

test('old Xiaohongshu card-count setting is ignored and removed when settings are saved',async () => {
  const service = createSettingsService();
  await service.updateSettings({content:{xhsImageCount:4}});
  const settings = await service.getSettings();
  assert.equal(settings.content.xhsImageMode,'test');
  assert.equal('xhsImageCount' in settings.content,false);
  const saved = await service.updateSettings({content:{xhsImageMode:'production'}});
  assert.equal('xhsImageCount' in saved.content,false);
});

test('Xiaohongshu card plan can be saved while a card is still being edited',async () => {
  const currentPlan = demoXhsCardPlan('等待期是什么');
  const editedPlan = currentPlan.map((card,index) => index === 0 ? {...card,headline:''} : card);
  let updateParams;
  let snapshotCount = 0;
  const service = new WorkbenchService({async query(sql,params) {
    if (sql.startsWith('SELECT * FROM drafts')) return {rows:[{
      id:3,topic_id:12,platform:'小红书',title:'等待期是什么',summary:'',body:'正文',hashtags:'',sources:'',
      xhs_card_plan:currentPlan,approval_checks:[true,true,true],status:'已审核',
    }]};
    if (sql.startsWith('UPDATE drafts')) { updateParams = params; return {rows:[]}; }
    throw new Error(`Unexpected test query: ${sql}`);
  }});
  service.snapshotVersionWithPool = async () => { snapshotCount += 1; };
  service.getSettings = async () => ({content:{}});
  service.getDraft = async () => ({cardPlan:JSON.parse(updateParams[7]),status:updateParams[9],checks:JSON.parse(updateParams[8])});

  const saved = await service.saveDraft(12,'小红书',{cardPlan:editedPlan});
  assert.equal(saved.cardPlan[0].headline,'');
  assert.equal(saved.status,'草稿');
  assert.deepEqual(saved.checks,[false,false,false]);
  assert.equal(snapshotCount,1);
});

test('Xiaohongshu Baoyu request requires a complete plan and sends one cover in test mode',async () => {
  let sentPayload;
  const service = new WorkbenchService({async query(sql) {
    if (sql.startsWith('SELECT * FROM topics')) return {rows:[{id:12,title:'等待期是什么'}]};
    throw new Error(`Unexpected test query: ${sql}`);
  }});
  service.getSettings = async () => ({content:{xhsImageMode:'test'}});
  service.runSkill = async (payload) => { sentPayload = payload; return {artifacts:[]}; };
  const draft = {
    title:'等待期是什么',body:'精炼的发布配文',cardPlan:demoXhsCardPlan('等待期是什么'),
  };
  service.getDraft = async () => ({...draft,cardPlan:[]});
  await assert.rejects(service.generateImage(12,'小红书'),(error) => error.getStatus?.() === 400);
  assert.equal(sentPayload,undefined);

  service.getDraft = async () => draft;
  await assert.rejects(service.generateImage(12,'小红书'),(error) => error.getStatus?.() === 503);
  assert.equal(sentPayload.imageMode,'test');
  assert.equal(sentPayload.cardPlan.length,1);
  assert.equal(sentPayload.cardPlan[0].role,'cover');
  assert.equal('text' in sentPayload,false);
});

test('Xiaohongshu production Baoyu request sends the entire approved card plan',async () => {
  let sentPayload;
  const plan = demoXhsCardPlan('等待期是什么');
  const service = new WorkbenchService({async query(sql) {
    if (sql.startsWith('SELECT * FROM topics')) return {rows:[{id:12,title:'等待期是什么'}]};
    throw new Error(`Unexpected test query: ${sql}`);
  }});
  service.getSettings = async () => ({content:{xhsImageMode:'production'}});
  service.getDraft = async () => ({title:'等待期是什么',body:'精炼发布配文',cardPlan:plan});
  service.runSkill = async (payload) => { sentPayload = payload; return {artifacts:[]}; };
  await assert.rejects(service.generateImage(12,'小红书'),(error) => error.getStatus?.() === 503);
  assert.equal(sentPayload.imageMode,'production');
  assert.deepEqual(sentPayload.cardPlan,plan);
  assert.equal('text' in sentPayload,false);
});

test('draft version snapshots retain the Xiaohongshu card plan',async () => {
  let inserted;
  const client = {async query(sql,params) {
    if (sql.startsWith('SELECT COALESCE(MAX(version)')) return {rows:[{version:5}]};
    if (sql.startsWith('INSERT INTO draft_versions')) { inserted = params; return {rows:[]}; }
    throw new Error(`Unexpected test query: ${sql}`);
  }};
  const plan = demoXhsCardPlan('等待期是什么');
  const service = new WorkbenchService({});
  await service.snapshotVersion(client,{id:7,topic_id:'T-7',platform:'小红书',title:'等待期是什么',summary:'',body:'配文',hashtags:'',sources:'',xhs_card_plan:plan,status:'草稿',humanized:true,approval_checks:[false,false,false],provider:'gpt'},'before-edit');
  assert.equal(inserted[1],5);
  assert.deepEqual(JSON.parse(inserted[2]).cardPlan,plan);
});

test('legacy Xiaohongshu draft can generate and persist a card plan with the text model',async () => {
  const plan = demoXhsCardPlan('等待期是什么');
  let updateParams;
  let modelCall;
  const service = new WorkbenchService({async query(sql,params) {
    if (sql.startsWith('SELECT * FROM topics')) return {rows:[{id:'T-7',title:'等待期是什么'}]};
    if (sql.startsWith('SELECT * FROM drafts')) return {rows:[{id:7,topic_id:'T-7',platform:'小红书',title:'等待期是什么',body:'精炼配文',sources:'',xhs_card_plan:[]}]};
    if (sql.startsWith('UPDATE drafts')) { updateParams = params; return {rows:[]}; }
    throw new Error(`Unexpected test query: ${sql}`);
  }});
  service.callModel = async (instructions,input) => { modelCall = {instructions,input}; return {cardPlan:plan}; };
  service.getDraft = async () => ({cardPlan:JSON.parse(updateParams[2])});
  const result = await service.generateXhsCardPlan('T-7','小红书');
  assert.match(modelCall.instructions,/3–5 张生产用图卡规划/);
  assert.match(modelCall.input,/"caption":"精炼配文"/);
  assert.deepEqual(result.cardPlan,plan);
});
