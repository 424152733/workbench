import 'reflect-metadata';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { access,mkdir,rm,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { WorkbenchModule } from '../app.module.js';
import { DatabaseService } from '../database.service.js';

let app;
let baseUrl;
let db;
let mockRunner;
let priorRunwareKey;
let priorRunwareTextModel;
let priorSkillRunner;
let skillRequests = [];
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
const phone = `139${String(Date.now()).slice(-8)}`;
let customerId;
let policyId;
let topicId;
let singlePlatformTopicId;
let customDictionaryCode;
let customCustomerId;

async function call(path,options = {}) {
  const response = await fetch(`${baseUrl}/api${path}`,options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response,payload };
}

const json = (method,body) => ({ method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body) });

before(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to a disposable PostgreSQL test database');
  priorRunwareKey = process.env.RUNWARE_API_KEY;
  priorRunwareTextModel = process.env.RUNWARE_TEXT_MODEL;
  priorSkillRunner = process.env.SKILL_RUNNER_URL;
  delete process.env.RUNWARE_API_KEY;
  delete process.env.RUNWARE_TEXT_MODEL;
  const samplePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2sAAAAASUVORK5CYII=';
  skillRequests = [];
  mockRunner = createServer(async (request,response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    skillRequests.push(payload);
    response.setHeader('Content-Type','application/json');
    if (payload.skill === 'humanizer-zh') {
      if (Array.isArray(payload.drafts)) response.end(JSON.stringify({drafts:payload.drafts.map((item) => ({platform:item.platform,text:`${item.text} [humanizer-zh]`,...(item.cardPlan ? {cardPlan:item.cardPlan} : {})}))}));
      else response.end(JSON.stringify({text:`${payload.text} [humanizer-zh]`,...(payload.cardPlan ? {cardPlan:payload.cardPlan} : {})}));
      return;
    }
    const artifactCount = payload.platform === '小红书' ? (payload.imageMode === 'production' ? 4 : 1) : 2;
    const artifacts = Array.from({length:artifactCount},(_,index) => ({
      name:`${String(index + 1).padStart(2,'0')}-card-test.png`,mimeType:'image/png',base64:samplePng,
    }));
    response.end(JSON.stringify({skill:payload.skill,provider:'baoyu-skills',artifacts}));
  });
  await new Promise((resolve) => mockRunner.listen(0,'127.0.0.1',resolve));
  process.env.SKILL_RUNNER_URL = `http://127.0.0.1:${mockRunner.address().port}`;
  app = await NestFactory.create(WorkbenchModule,{logger:false});
  await app.listen(0,'127.0.0.1');
  baseUrl = await app.getUrl();
  db = app.get(DatabaseService);
});

after(async () => {
  if (db && customerId) await db.query('DELETE FROM customers WHERE id=$1',[customerId]);
  if (db && customCustomerId) await db.query('DELETE FROM customers WHERE id=$1',[customCustomerId]);
  if (db && customDictionaryCode) await db.query('DELETE FROM source_dictionary WHERE code=$1',[customDictionaryCode]);
  if (db && topicId) {
    const assets = await db.query('SELECT storage_name FROM assets WHERE topic_id=$1',[topicId]);
    await Promise.all(assets.rows.map((item) => rm(path.resolve('backend/uploads',item.storage_name),{force:true})));
    await db.query('DELETE FROM content_publication_events WHERE publication_id IN (SELECT p.id FROM content_publications p JOIN drafts d ON d.id=p.draft_id WHERE d.topic_id=$1)',[topicId]);
    await db.query('DELETE FROM content_publication_assets WHERE publication_id IN (SELECT p.id FROM content_publications p JOIN drafts d ON d.id=p.draft_id WHERE d.topic_id=$1)',[topicId]);
    await db.query('DELETE FROM content_publications WHERE draft_id IN (SELECT id FROM drafts WHERE topic_id=$1)',[topicId]);
    await db.query('DELETE FROM topics WHERE id=$1',[topicId]);
  }
  if (db && singlePlatformTopicId) await db.query('DELETE FROM topics WHERE id=$1',[singlePlatformTopicId]);
  if (app) await app.close();
  if (mockRunner) await new Promise((resolve) => mockRunner.close(resolve));
  if (priorRunwareKey !== undefined) process.env.RUNWARE_API_KEY = priorRunwareKey;
  if (priorRunwareTextModel !== undefined) process.env.RUNWARE_TEXT_MODEL = priorRunwareTextModel;
  if (priorSkillRunner !== undefined) process.env.SKILL_RUNNER_URL = priorSkillRunner;
});

test('health and source dictionary come from the backend',async () => {
  const {response:healthResponse,payload:health} = await call('/health');
  assert.equal(healthResponse.status,200);
  assert.equal(health.database,'connected');
  const {response,payload:sources} = await call('/sources');
  assert.equal(response.status,200);
  assert.ok(sources.includes('线下拜访'));
  assert.ok(sources.includes('人保财险') === false,'insurers are not customer sources');
  const migrated = await db.query(`SELECT t.source,t.status FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id WHERE c.name='林女士' AND c.source_code='offline_visit' AND c.concern='家庭医疗保障' ORDER BY t.id LIMIT 1`);
  assert.equal(migrated.rows[0]?.source,'legacy_migration','the latest legacy follow-up date is migrated to one pending task');
  assert.equal(migrated.rows[0]?.status,'pending');
});

test('customer sources added to the backend dictionary work without code changes',async () => {
  customDictionaryCode = `test_${Date.now()}`;
  const label = `测试来源${suffix}`;
  await db.query('INSERT INTO source_dictionary(code,label,sort_order) VALUES($1,$2,999)',[customDictionaryCode,label]);
  const {payload:sources} = await call('/sources');
  assert.ok(sources.includes(label));
  const created = await call('/customers',json('POST',{name:`字典来源客户${suffix}`,source:label,kind:'新线索'}));
  assert.equal(created.response.status,201);
  customCustomerId = created.payload.id;
  const filtered = await call(`/customers?source=${encodeURIComponent(label)}`);
  assert.ok(filtered.payload.some((item) => item.id === customCustomerId));
  const searchedBySource = await call(`/customers?search=${encodeURIComponent(label)}`);
  assert.ok(searchedBySource.payload.some((item) => item.id === customCustomerId));
  const updated = await call(`/customers/${customCustomerId}`,json('PATCH',{source:'其他'}));
  assert.equal(updated.payload.source,'其他');
});

test('customer create, exact duplicate warning, edits, policy verification and follow-up persist',async () => {
  const create = await call('/customers',json('POST',{name:`测试客户${suffix}`,phone,kind:'新线索',source:'线下拜访',concern:'等待期',preferredContact:'电话',contactAllowed:true,next:'2026-12-01'}));
  assert.equal(create.response.status,201);
  customerId = create.payload.id;
  assert.match(create.payload.phone,/\*\*\*\*/);
  const fetched = await call(`/customers/${customerId}`);
  assert.equal(fetched.response.status,200);
  assert.equal(fetched.payload.id,customerId);
  assert.equal(fetched.payload.nextFollowup,'2026-12-01');
  const duplicate = await call('/customers',json('POST',{name:'重复客户',phone,source:'线下拜访'}));
  assert.equal(duplicate.response.status,409);
  const search = await call(`/customers?search=${encodeURIComponent(`测试客户${suffix}`)}&source=${encodeURIComponent('线下拜访')}`);
  assert.equal(search.response.status,200);
  assert.ok(search.payload.some((item) => item.id === customerId));
  const maskedPhoneSearch = await call(`/customers?search=${encodeURIComponent(create.payload.phone)}`);
  assert.ok(maskedPhoneSearch.payload.some((item) => item.id === customerId),'the masked phone shown in the UI can be searched');
  const stage = await call(`/customers/${customerId}`,json('PATCH',{stage:'已联系',concern:'家庭医疗保障'}));
  assert.equal(stage.response.status,200);
  assert.equal(stage.payload.stage,'已联系');
  assert.equal(stage.payload.stageHistory[0].to,'已联系');
  const policy = await call(`/customers/${customerId}/policies`,json('POST',{company:'人保财险',name:'测试保单',type:'家财险',scope:'external',policyNumber:'ABCD-1234-X9',expiry:'2026-12-15'}));
  assert.equal(policy.response.status,201);
  policyId = policy.payload.policy.id;
  assert.equal(policy.payload.policy.state,'待核实');
  assert.equal(policy.payload.policy.expiry,'2026-12-15');
  assert.equal(policy.payload.policy.policyNumber,'ABC****4-X9','policy numbers keep letters while masking the middle');
  const verified = await call(`/policies/${policy.payload.policy.id}`,json('PATCH',{verified:true}));
  assert.equal(verified.payload.policies[0].state,'已核实');
  const followup = await call(`/customers/${customerId}/followups`,json('POST',{method:'电话',note:'测试跟进',next:'2026-12-02'}));
  assert.equal(followup.response.status,201);
  assert.ok(followup.payload.notes[0].includes('测试跟进'));
});

test('policy lifecycle and service items track progress separately from customer contact',async () => {
  const initial = await call(`/policies/${policyId}/lifecycle`);
  assert.equal(initial.payload.contractStatus,'unknown');
  const missingBasis = await call(`/policies/${policyId}/lifecycle`,json('PATCH',{contractStatus:'active',reason:'核对资料'}));
  assert.equal(missingBasis.response.status,400);
  const lifecycle = await call(`/policies/${policyId}/lifecycle`,json('PATCH',{
    contractStatus:'active',statusBasis:'已核对保险公司正式记录',effectiveDate:'2026-01-01',
    expiryDate:'2026-12-15',nextPaymentDate:'2026-11-15',reason:'录入核实后的合同日期',
  }));
  assert.equal(lifecycle.response.status,200);
  assert.equal(lifecycle.payload.policies[0].contractStatus,'active');
  const history = await call(`/policies/${policyId}/lifecycle`);
  assert.equal(history.payload.statusConfirmedOn?.length,10);
  assert.ok(history.payload.events.some((event)=>event.action==='updated'));

  const requestKey = `service-renewal-${suffix}`;
  const created = await call(`/policies/${policyId}/service-items`,json('POST',{
    kind:'renewal',title:'确认保单续保',nextActionDate:'2026-11-20',requestKey,
  }));
  assert.equal(created.response.status,201);
  const itemId = created.payload.id;
  assert.equal(created.payload.customerId,customerId);
  assert.equal(created.payload.anchorDate,'2026-12-15');
  const replay = await call(`/policies/${policyId}/service-items`,json('POST',{
    kind:'renewal',title:'确认保单续保',nextActionDate:'2026-11-20',requestKey,
  }));
  assert.equal(replay.payload.id,itemId);
  const duplicate = await call(`/policies/${policyId}/service-items`,json('POST',{
    kind:'renewal',title:'另一个续保事项',nextActionDate:'2026-11-20',requestKey:`service-dupe-${suffix}`,
  }));
  assert.equal(duplicate.response.status,409);
  const list = await call(`/service-items?status=open&customerId=${customerId}`);
  assert.ok(list.payload.items.some((item)=>item.id===itemId));

  const progressKey = `service-progress-${suffix}`;
  const progress = await call(`/service-items/${itemId}/progress`,json('POST',{
    status:'waiting_customer',note:'已发送续保信息，等待客户确认',nextActionDate:'2026-11-21',requestKey:progressKey,
  }));
  assert.equal(progress.payload.status,'waiting_customer');
  const progressReplay = await call(`/service-items/${itemId}/progress`,json('POST',{
    status:'waiting_customer',note:'已发送续保信息，等待客户确认',nextActionDate:'2026-11-21',requestKey:progressKey,
  }));
  assert.equal(progressReplay.payload.events.filter((event)=>event.action==='progress').length,1);

  const wrongCustomer = await call(`/customers/${customCustomerId}/follow-up-tasks`,json('POST',{
    title:'错误关联',dueDate:'2026-11-21',serviceItemId:itemId,
  }));
  assert.equal(wrongCustomer.response.status,400);
  const linked = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',{
    title:'确认续保意向',method:'电话',dueDate:'2026-11-21',serviceItemId:itemId,requestKey:`linked-service-${suffix}`,
  }));
  assert.equal(linked.response.status,201);
  assert.equal(linked.payload.serviceItemId,itemId);
  const contacted = await call(`/follow-up-tasks/${linked.payload.id}/complete`,json('POST',{
    method:'电话',outcome:'contacted',note:'客户希望继续核对资料',
  }));
  assert.equal(contacted.response.status,201);
  const afterContact = await call(`/service-items/${itemId}`);
  assert.equal(afterContact.payload.status,'waiting_customer','one completed contact must not close the service item');
  assert.equal(afterContact.payload.followUps.length,1);

  const pending = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',{
    title:'再次确认续保',dueDate:'2026-11-22',serviceItemId:itemId,requestKey:`linked-service-next-${suffix}`,
  }));
  assert.equal(pending.response.status,201);
  const closeKey = `service-close-${suffix}`;
  const closed = await call(`/service-items/${itemId}/complete`,json('POST',{
    outcome:'客户确认已通过正式渠道办理续保',closedOn:'2026-11-23',requestKey:closeKey,
  }));
  assert.equal(closed.payload.status,'completed');
  const closeReplay = await call(`/service-items/${itemId}/complete`,json('POST',{
    outcome:'客户确认已通过正式渠道办理续保',closedOn:'2026-11-23',requestKey:closeKey,
  }));
  assert.equal(closeReplay.payload.events.filter((event)=>event.action==='completed').length,1);
  const cancelledLinkedTask = await db.query('SELECT status FROM customer_follow_up_tasks WHERE id=$1',[pending.payload.id]);
  assert.equal(cancelledLinkedTask.rows[0].status,'cancelled');
  const unchangedPolicy = await call(`/customers/${customerId}`);
  assert.equal(unchangedPolicy.payload.policies[0].contractStatus,'active','service completion must not infer contract status');

  const endorsement = await call(`/policies/${policyId}/service-items`,json('POST',{
    kind:'endorsement',title:'核对受益人变更',nextActionDate:'2026-11-25',requestKey:`service-endorsement-${suffix}`,
  }));
  assert.equal(endorsement.response.status,201);
  const cancelled = await call(`/service-items/${endorsement.payload.id}/cancel`,json('POST',{
    reason:'客户暂不办理',requestKey:`service-cancel-${suffix}`,
  }));
  assert.equal(cancelled.payload.status,'cancelled');
});

test('policy service data cascades when its customer is deleted',async () => {
  const created = await call('/customers',json('POST',{name:`级联测试${suffix}`,source:'线下拜访',kind:'已有客户',contactAllowed:true}));
  const id = created.payload.id;
  const policy = await call(`/customers/${id}/policies`,json('POST',{company:'新华保险',name:'级联保单',type:'寿险'}));
  const item = await call(`/policies/${policy.payload.policy.id}/service-items`,json('POST',{
    kind:'other',title:'级联服务',nextActionDate:'2026-11-30',
  }));
  await call(`/customers/${id}/follow-up-tasks`,json('POST',{title:'关联联系',dueDate:'2026-11-30',serviceItemId:item.payload.id}));
  await db.query('DELETE FROM customers WHERE id=$1',[id]);
  const remaining = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM policies WHERE id=$1) AS policies,
    (SELECT COUNT(*)::int FROM policy_service_items WHERE id=$2) AS services,
    (SELECT COUNT(*)::int FROM policy_service_item_events WHERE service_item_id=$2) AS events,
    (SELECT COUNT(*)::int FROM customer_follow_up_tasks WHERE service_item_id=$2) AS tasks`,[policy.payload.policy.id,item.payload.id]);
  assert.deepEqual(remaining.rows[0],{policies:0,services:0,events:0,tasks:0});
});

test('follow-up tasks can be filtered, rescheduled, completed, cancelled and blocked after contact refusal',async () => {
  const body = {title:'确认续保资料',method:'电话',note:'先核对保单资料',dueDate:'2026-12-20',requestKey:`task-${suffix}`};
  const created = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',body));
  assert.equal(created.response.status,201);
  const taskId = created.payload.id;
  assert.equal(created.payload.customerId,customerId);
  const duplicate = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',{...body,requestKey:`duplicate-${suffix}`}));
  assert.equal(duplicate.response.status,409);
  assert.ok(duplicate.payload.duplicateTaskId || duplicate.payload.message?.duplicateTaskId);
  const allowedDuplicate = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',{...body,requestKey:`allowed-${suffix}`,allowDuplicate:true}));
  assert.equal(allowedDuplicate.response.status,201);

  const rescheduled = await call(`/follow-up-tasks/${taskId}`,json('PATCH',{title:'确认续保资料',method:'微信',note:'改期后核对保单',dueDate:'2000-01-01',dueTime:'15:30',changeNote:'客户另约时间'}));
  assert.equal(rescheduled.response.status,200);
  assert.equal(rescheduled.payload.dueDate,'2000-01-01');
  assert.equal(rescheduled.payload.dueTime,'15:30');
  assert.equal(rescheduled.payload.bucket,'overdue');
  const overdue = await call(`/follow-up-tasks?status=pending&range=overdue&customerId=${customerId}`);
  assert.ok(overdue.payload.items.some((item) => item.id === taskId));

  const completed = await call(`/follow-up-tasks/${taskId}/complete`,json('POST',{method:'微信',outcome:'not_reached',note:'无人接听',nextTask:{title:'再次确认续保资料',method:'电话',note:'约定后重拨',dueDate:'2026-12-24',requestKey:`next-${suffix}`}}));
  assert.equal(completed.response.status,201);
  assert.equal(completed.payload.task.status,'completed');
  assert.equal(completed.payload.nextTask.status,'pending');
  assert.ok(completed.payload.customer.followUps[0].note.includes('未接通：无人接听'));
  const repeatedComplete = await call(`/follow-up-tasks/${taskId}/complete`,json('POST',{method:'微信',note:'重复提交'}));
  assert.equal(repeatedComplete.response.status,409);

  const cancelled = await call(`/follow-up-tasks/${allowedDuplicate.payload.id}/cancel`,json('POST',{note:'客户暂不需要'}));
  assert.equal(cancelled.payload.status,'cancelled');
  const refused = await call(`/customers/${customerId}`,json('PATCH',{contact:'已拒绝联系'}));
  assert.equal(refused.response.status,200);
  assert.ok(refused.payload.followUpTasks.length === 0);
  const blocked = await call(`/customers/${customerId}/follow-up-tasks`,json('POST',{title:'再次联系',dueDate:'2026-12-28'}));
  assert.equal(blocked.response.status,400);
  await call(`/customers/${customerId}`,json('PATCH',{contact:'已确认可按所选方式联系'}));
});

test('topic drafts save per platform, require review checks, support publication records and keep versions',async () => {
  const created = await call('/topics',json('POST',{title:`测试选题${suffix}`,category:'条款翻译',insuranceType:'财险',platforms:['知乎','小红书','公众号'],dueDate:'2026-12-04'}));
  assert.equal(created.response.status,201);
  topicId = created.payload.id;
  assert.equal(created.payload.dueDate,'2026-12-04');
  assert.equal(created.payload.insuranceType,'财险');
  const generated = await call(`/topics/${topicId}/generate`,json('POST',{}));
  assert.equal(generated.response.status,201);
  assert.equal(generated.payload.mode,'demo');
  assert.ok(generated.payload.topic.drafts['知乎'].body.includes('测试选题'));
  assert.ok(generated.payload.topic.drafts['知乎'].body.includes('[humanizer-zh]'));
  assert.equal(generated.payload.topic.drafts['知乎'].humanized,true);
  assert.equal(generated.payload.humanizer,'humanizer-zh');
  assert.ok(generated.payload.topic.drafts['公众号'].htmlContent.includes('<article data-theme="clean">'));
  assert.equal(generated.payload.topic.drafts['小红书'].status,'待审核');
  const edit = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}`,json('PATCH',{title:'修改后的测试标题',body:'修改后的正文',sources:'https://example.test/source',checks:[true,true,true]}));
  assert.equal(edit.payload.title,'修改后的测试标题');
  const humanized = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/humanize`,json('POST',{}));
  assert.equal(humanized.payload.provider,'humanizer-zh');
  assert.match(humanized.payload.body,/\[humanizer-zh\]/);
  const priorWechatTheme = (await call('/settings')).payload.content.wechatTheme;
  await call('/settings',json('PATCH',{content:{wechatTheme:'warm'}}));
  const wechatHumanized = await call(`/topics/${topicId}/drafts/${encodeURIComponent('公众号')}/humanize`,json('POST',{}));
  assert.match(wechatHumanized.payload.body,/\[humanizer-zh\]/);
  assert.match(wechatHumanized.payload.htmlContent,/\[humanizer-zh\]/);
  assert.match(wechatHumanized.payload.htmlContent,/data-theme="warm"/);
  await call('/settings',json('PATCH',{content:{wechatTheme:priorWechatTheme}}));
  const denied = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/approve`,json('POST',{checks:[true,false,true]}));
  assert.equal(denied.response.status,400);
  const approved = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/approve`,json('POST',{checks:[true,true,true]}));
  assert.equal(approved.payload.status,'已审核');
  const revised = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}`,json('PATCH',{body:'审核后又改过的正文',checks:[true,true,true]}));
  assert.equal(revised.payload.status,'草稿');
  assert.deepEqual(revised.payload.checks,[false,false,false]);
  const blockedPublish = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/publish`,json('POST',{publishUrl:'https://zhihu.example/post/1'}));
  assert.equal(blockedPublish.response.status,400);
  await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}`,json('PATCH',{checks:[true,true,true]}));
  const reapproved = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/approve`,json('POST',{checks:[true,true,true]}));
  assert.equal(reapproved.payload.status,'已审核');
  const publicationKey = randomUUID();
  const published = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/publish`,json('POST',{publishedOn:'2026-12-05',publishUrl:'https://zhihu.example/post/1',requestKey:publicationKey}));
  assert.equal(published.payload.draft.status,'已发布');
  assert.equal(published.payload.publication.publishUrl,'https://zhihu.example/post/1');
  assert.equal(published.payload.publication.contentSnapshot.body,'审核后又改过的正文');
  const retried = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/publish`,json('POST',{publishedOn:'2026-12-05',publishUrl:'https://zhihu.example/post/1',requestKey:publicationKey}));
  assert.equal(retried.payload.publication.id,published.payload.publication.id);
  const records = await call(`/publications?topicId=${topicId}`);
  assert.equal(records.payload.total,1);
  const duplicate = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/publish`,json('POST',{publishedOn:'2026-12-05',publishUrl:'https://zhihu.example/post/1',requestKey:randomUUID()}));
  assert.equal(duplicate.response.status,409);
  const second = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}/publish`,json('POST',{publishedOn:'2026-12-07',publishUrl:'https://zhihu.example/post/another',requestKey:randomUUID()}));
  assert.equal(second.payload.publication.publishedOn,'2026-12-07');
  const protectedTopic = await call(`/topics/${topicId}`,{method:'DELETE'});
  assert.equal(protectedTopic.response.status,409);
  const correctionKey = randomUUID();
  const corrected = await call(`/publications/${published.payload.publication.id}`,json('PATCH',{publishedOn:'2026-12-06',publishUrl:'https://zhihu.example/post/2',reason:'链接填错',requestKey:correctionKey}));
  assert.equal(corrected.payload.publishedOn,'2026-12-06');
  assert.equal(corrected.payload.events.at(-1).action,'corrected');
  const correctionRetry = await call(`/publications/${published.payload.publication.id}`,json('PATCH',{publishedOn:'2026-12-06',publishUrl:'https://zhihu.example/post/2',reason:'链接填错',requestKey:correctionKey}));
  assert.equal(correctionRetry.payload.events.length,corrected.payload.events.length);
  const wrongRetry = await call(`/publications/${published.payload.publication.id}`,json('PATCH',{publishedOn:'2026-12-08',reason:'不同内容',requestKey:correctionKey}));
  assert.equal(wrongRetry.response.status,409);
  const editAfterPublish = await call(`/topics/${topicId}/drafts/${encodeURIComponent('知乎')}`,json('PATCH',{body:'发布后新改的工作稿'}));
  assert.equal(editAfterPublish.payload.status,'草稿');
  const historical = await call(`/publications/${published.payload.publication.id}`);
  assert.equal(historical.payload.contentSnapshot.body,'审核后又改过的正文');
  const voided = await call(`/publications/${published.payload.publication.id}/void`,json('POST',{reason:'实际未发布',requestKey:randomUUID()}));
  assert.equal(voided.payload.status,'voided');
  const activeRecords = await call(`/publications?topicId=${topicId}`);
  assert.equal(activeRecords.payload.total,1);
  const allRecords = await call(`/publications?topicId=${topicId}&status=all`);
  assert.equal(allRecords.payload.total,2);
  const datedRecords = await call(`/publications?topicId=${topicId}&from=2026-12-07&to=2026-12-07`);
  assert.equal(datedRecords.payload.total,1);
  const history = await db.query('SELECT COUNT(*)::int AS count FROM draft_versions v JOIN drafts d ON d.id=v.draft_id WHERE d.topic_id=$1',[topicId]);
  assert.ok(history.rows[0].count >= 1);
  const topics = await call('/topics');
  assert.ok(topics.payload.find((item) => item.id === topicId).drafts['知乎']);
});

test('topic generation only creates drafts for the selected platforms',async () => {
  const created = await call('/topics',json('POST',{title:`单平台测试选题${suffix}`,category:'保险基础',platforms:['小红书']}));
  assert.equal(created.response.status,201);
  singlePlatformTopicId = created.payload.id;
  assert.deepEqual(created.payload.platforms,['小红书']);
  const generated = await call(`/topics/${singlePlatformTopicId}/generate`,json('POST',{}));
  assert.equal(generated.response.status,201);
  const drafts = generated.payload.topic.drafts;
  assert.ok(drafts['小红书']);
  assert.equal(drafts['知乎'],null);
  assert.equal(drafts['公众号'],null);
});

test('deleting a topic also deletes its pending draft, review history, asset row and image file',async () => {
  const created = await call('/topics',json('POST',{title:`级联删除测试${suffix}`,category:'保险基础',platforms:['知乎']}));
  assert.equal(created.response.status,201);
  const id = created.payload.id;
  const draft = await db.query("INSERT INTO drafts(topic_id,platform,title,body,status) VALUES($1,'知乎','待审核稿件','测试正文','待审核') RETURNING id",[id]);
  await db.query("INSERT INTO draft_versions(draft_id,version,snapshot) VALUES($1,1,$2::jsonb)",[draft.rows[0].id,JSON.stringify({body:'测试正文',status:'待审核'})]);
  const storageName = `delete-topic-${suffix}.png`;
  const storagePath = path.resolve('backend/uploads',storageName);
  await mkdir(path.dirname(storagePath),{recursive:true});
  await writeFile(storagePath,'temporary cascade test image');
  await db.query("INSERT INTO assets(topic_id,platform,file_name,storage_name,mime_type,byte_size) VALUES($1,'知乎','待删除素材.png',$2,'image/png',0)",[id,storageName]);
  try {
    const removed = await call(`/topics/${id}`,{method:'DELETE'});
    assert.equal(removed.response.status,200);
    assert.deepEqual(removed.payload,{id});
    const [drafts,versions,assets] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM drafts WHERE topic_id=$1',[id]),
      db.query('SELECT COUNT(*)::int AS count FROM draft_versions WHERE draft_id=$1',[draft.rows[0].id]),
      db.query('SELECT COUNT(*)::int AS count FROM assets WHERE topic_id=$1',[id]),
    ]);
    assert.equal(drafts.rows[0].count,0);
    assert.equal(versions.rows[0].count,0);
    assert.equal(assets.rows[0].count,0);
    await assert.rejects(access(storagePath),{code:'ENOENT'});
  } finally {
    await db.query('DELETE FROM topics WHERE id=$1',[id]);
    await rm(storagePath,{force:true});
  }
});

test('GPT network failures return an actionable error and mark generation failed',async () => {
  const originalFetch = globalThis.fetch;
  process.env.RUNWARE_API_KEY = 'test-api-key';
  globalThis.fetch = async (input,options) => {
    if (String(input) === 'https://api.runware.ai/v1/responses') throw new TypeError('fetch failed');
    return originalFetch(input,options);
  };
  try {
    const {response,payload} = await call(`/topics/${topicId}/generate`,json('POST',{}));
    assert.equal(response.status,503);
    assert.match(payload.message,/无法连接 Runware GPT 服务/);
    assert.match(payload.message,/DNS/);
    const state = await db.query('SELECT generation_status FROM topics WHERE id=$1',[topicId]);
    assert.equal(state.rows[0].generation_status,'failed');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RUNWARE_API_KEY;
  }
});

test('GPT structured-output requests include json in the model input',async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.RUNWARE_API_KEY;
  process.env.RUNWARE_API_KEY = 'test-api-key';
  const modelRequests = [];
  globalThis.fetch = async (input,options) => {
    if (String(input) === 'https://api.runware.ai/v1/responses') {
      const requestBody = JSON.parse(options.body);
      modelRequests.push(requestBody);
      assert.equal(options.headers.Authorization,'Bearer test-api-key');
      assert.equal(requestBody.model,'openai:gpt@6-luna');
      assert.equal(requestBody.text.format.type,'json_object');
      assert.match(JSON.stringify(requestBody.input),/json/i);
      const title = String(requestBody.input).includes('选定险种：财险') ? '车险三者责任保障怎么读' : '等待期怎么理解';
      const insuranceType = String(requestBody.input).includes('选定险种：财险') ? '财险' : '健康险';
      return new Response(JSON.stringify({output_text:JSON.stringify({topics:[{title,category:'保险基础',insuranceType}]})}),{
        status:200,headers:{'Content-Type':'application/json'},
      });
    }
    return originalFetch(input,options);
  };
  try {
    const {response,payload} = await call('/topics/suggest');
    assert.equal(response.status,200);
    assert.equal(payload.provider,'openai:gpt@6-luna');
    assert.equal(payload.topics[0].title,'等待期怎么理解');
    assert.equal(payload.topics[0].insuranceType,'健康险');
    const filtered = await call(`/topics/suggest?insuranceType=${encodeURIComponent('财险')}&exclude=${encodeURIComponent(JSON.stringify(['不要重复这个标题']))}`);
    assert.equal(filtered.response.status,200);
    assert.equal(filtered.payload.topics[0].insuranceType,'财险');
    assert.equal(filtered.payload.topics[0].title,'车险三者责任保障怎么读');
    assert.match(JSON.stringify(modelRequests.at(-1).input),/选定险种：财险/);
    assert.match(JSON.stringify(modelRequests.at(-1).input),/不要重复这个标题/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.RUNWARE_API_KEY;
    else process.env.RUNWARE_API_KEY = previousKey;
  }
});

test('schedule settings, dashboard aggregation, calendar and CSV export are functional',async () => {
  const settings = await call('/settings');
  assert.equal(settings.response.status,200);
  assert.deepEqual(settings.payload.content.imageStyles.xhs,{style:'sketch-notes',layout:'auto',palette:'macaron'});
  assert.deepEqual(settings.payload.content.imageStyles.article,{type:'auto',style:'notion',palette:'macaron'});
  assert.equal(settings.payload.content.wechatTheme,'clean');
  assert.equal(settings.payload.content.xhsImageMode,'test');
  const configured = await call('/settings',json('PATCH',{content:{autoEnabled:true,frequencyDays:2,runAt:'09:00'}}));
  assert.equal(configured.response.status,200);
  assert.ok(configured.payload.content.nextRunAt);
  const disabled = await call('/settings',json('PATCH',{content:{autoEnabled:false,frequencyDays:2,runAt:'09:00'}}));
  assert.equal(disabled.payload.content.nextRunAt,null);
  const dashboard = await call('/dashboard');
  assert.equal(dashboard.response.status,200);
  assert.ok(dashboard.payload.metrics.customers >= 1);
  assert.ok(dashboard.payload.tasks.every((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.next)),'dashboard task dates use readable labels');
  const calendar = await call('/calendar?month=2026-12');
  assert.equal(calendar.payload.find((item) => item.id === topicId)?.date,'2026-12-04');
  const notificationList = await call('/notifications');
  assert.equal(notificationList.response.status,200);
  assert.ok(Array.isArray(notificationList.payload));
  const preferenceUpdate = await call('/settings',json('PATCH',{preferences:{displayName:`测试称呼${suffix}`,startPage:'content',notifications:false}}));
  assert.equal(preferenceUpdate.payload.preferences.displayName,`测试称呼${suffix}`);
  assert.equal(preferenceUpdate.payload.preferences.startPage,'content');
  assert.equal(preferenceUpdate.payload.preferences.notifications,false);
  const preferenceRestore = await call('/settings',json('PATCH',{preferences:settings.payload.preferences}));
  assert.deepEqual(preferenceRestore.payload.preferences,settings.payload.preferences);
  const imageStylesUpdated = await call('/settings',json('PATCH',{content:{imageStyles:{xhs:{style:'bold',layout:'comparison',palette:'neon'}}}}));
  assert.equal(imageStylesUpdated.payload.content.imageStyles.xhs.style,'bold');
  const imageModeUpdated = await call('/settings',json('PATCH',{content:{xhsImageMode:'production'}}));
  assert.equal(imageModeUpdated.payload.content.xhsImageMode,'production');
  const invalidImageMode = await call('/settings',json('PATCH',{content:{xhsImageMode:'preview'}}));
  assert.equal(invalidImageMode.response.status,400);
  await call('/settings',json('PATCH',{content:{xhsImageMode:settings.payload.content.xhsImageMode}}));
  const invalidImageStyles = await call('/settings',json('PATCH',{content:{imageStyles:{xhs:{layout:'not-a-layout'}}}}));
  assert.equal(invalidImageStyles.response.status,400);
  const skillRequestCount = skillRequests.length;
  const invalidImageRequest = await call(`/topics/${topicId}/images/generate`,json('POST',{platform:'小红书',imageOptions:{style:'not-a-style'}}));
  assert.equal(invalidImageRequest.response.status,400,'invalid image preferences fail before reaching the paid runner');
  assert.equal(skillRequests.length,skillRequestCount);
  const wechatThemeUpdated = await call('/settings',json('PATCH',{content:{wechatTheme:'editorial'}}));
  assert.equal(wechatThemeUpdated.payload.content.wechatTheme,'editorial');
  const invalidWechatTheme = await call('/settings',json('PATCH',{content:{wechatTheme:'unknown'}}));
  assert.equal(invalidWechatTheme.response.status,400);
  await call('/settings',json('PATCH',{content:{imageStyles:settings.payload.content.imageStyles,wechatTheme:settings.payload.content.wechatTheme}}));
  const exported = await call('/customers/export');
  assert.equal(exported.response.status,200,JSON.stringify(exported.payload));
  assert.match(exported.payload,/联系电话（脱敏）/);
});

test('image asset upload and inline/download retrieval work',async () => {
  const humanized = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}/humanize`,json('POST',{}));
  assert.equal(humanized.response.status,201);
  assert.equal(humanized.payload.humanized,true);
  assert.equal(humanized.payload.provider,'humanizer-zh');
  const generated = await call(`/topics/${topicId}/images/generate`,json('POST',{platform:'知乎'}));
  assert.equal(generated.response.status,201);
  assert.equal(generated.payload.provider,'baoyu-skills+runware');
  assert.equal(generated.payload.skill,'baoyu-article-illustrator');
  assert.equal(generated.payload.assets.length,2);
  const image = await call(`/assets/${generated.payload.assets[0].id}`);
  assert.equal(image.response.status,200);
  assert.match(image.response.headers.get('content-type'),/image\/png/);

  const originalSettings = await call('/settings');
  await call('/settings',json('PATCH',{content:{xhsImageMode:'production',imageStyles:{xhs:{style:'bold',layout:'comparison',palette:'neon'},article:{type:'timeline',style:'watercolor',palette:'warm'}}}}));
  const initialXhsImages = await call(`/topics/${topicId}/images/generate`,json('POST',{platform:'小红书',imageOptions:{style:'fresh',layout:'flow',palette:'warm'}}));
  assert.equal(initialXhsImages.response.status,201);
  assert.equal(initialXhsImages.payload.assets.length,4);
  assert.equal(skillRequests.at(-1).imageMode,'production');
  assert.deepEqual(skillRequests.at(-1).imageOptions,{style:'fresh',layout:'flow',palette:'warm'});
  const configuredArticleImages = await call(`/topics/${topicId}/images/generate`,json('POST',{platform:'公众号'}));
  assert.equal(configuredArticleImages.response.status,201);
  assert.equal(skillRequests.at(-1).imageMode,undefined);
  assert.deepEqual(skillRequests.at(-1).imageOptions,{type:'timeline',style:'watercolor',palette:'warm'});
  await call('/settings',json('PATCH',{content:{xhsImageMode:originalSettings.payload.content.xhsImageMode,imageStyles:originalSettings.payload.content.imageStyles}}));
  const checked = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}`,json('PATCH',{checks:[true,true,true]}));
  assert.equal(checked.payload.assets.length,4,'saving a draft keeps its uploaded/generated assets in the response');
  const approved = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}/approve`,json('POST',{checks:[true,true,true]}));
  assert.equal(approved.payload.status,'已审核');
  assert.equal(approved.payload.assets.length,4,'approval responses keep their assets');
  const xhsImages = await call(`/topics/${topicId}/images/generate`,json('POST',{platform:'小红书'}));
  assert.equal(xhsImages.response.status,201);
  const afterGeneration = await call('/topics');
  const xhsAfterGeneration = afterGeneration.payload.find((item) => item.id === topicId).drafts['小红书'];
  assert.equal(xhsAfterGeneration.status,'草稿','new images invalidate the prior platform review');
  assert.deepEqual(xhsAfterGeneration.checks,[false,false,false]);
  assert.equal(xhsAfterGeneration.assets.length,5);

  const form = new FormData();
  form.append('platform','小红书');
  form.append('file',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],{type:'image/svg+xml'}),'test.svg');
  const uploaded = await call(`/topics/${topicId}/assets`,{method:'POST',body:form});
  assert.equal(uploaded.response.status,201);
  assert.equal(uploaded.payload.fileName,'test.svg');
  const afterUpload = await call('/topics');
  const xhsAfterUpload = afterUpload.payload.find((item) => item.id === topicId).drafts['小红书'];
  assert.equal(xhsAfterUpload.status,'草稿','uploaded images keep the platform unapproved');
  assert.deepEqual(xhsAfterUpload.checks,[false,false,false]);
  assert.equal(xhsAfterUpload.assets.length,6);
  const savedWithAssets = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}`,json('PATCH',{body:`${xhsAfterUpload.body}\n补充一行`,checks:[true,true,true]}));
  assert.equal(savedWithAssets.payload.assets.length,6);
  const xhsReapproved = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}/approve`,json('POST',{checks:[true,true,true]}));
  assert.equal(xhsReapproved.payload.assets.length,6);
  const xhsPublished = await call(`/topics/${topicId}/drafts/${encodeURIComponent('小红书')}/publish`,json('POST',{publishedOn:'2026-12-05',requestKey:randomUUID()}));
  assert.equal(xhsPublished.payload.draft.assets.length,6);
  assert.equal(xhsPublished.payload.publication.assets.length,6);
  const downloaded = await call(`/assets/${uploaded.payload.id}?download=1`);
  assert.equal(downloaded.response.status,200);
  assert.match(downloaded.response.headers.get('content-disposition'),/attachment/);
  assert.match(downloaded.payload,/svg/);
});
