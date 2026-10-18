import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDraftGenerationPrompt, buildXhsCardPlanPrompt, normalizeEditableXhsCardPlan, normalizeXhsCardPlan } from '../content-prompts.js';

test('draft generation prompt gives selected platforms distinct writing goals',() => {
  const prompt = buildDraftGenerationPrompt({title:'等待期是什么',category:'误区澄清',platforms:['知乎','小红书','公众号']});
  assert.deepEqual(prompt.platforms,['知乎','小红书','公众号']);
  assert.match(prompt.instructions,/【知乎回答】[\s\S]*直接回答问题/);
  assert.match(prompt.instructions,/【公众号文章】[\s\S]*标题、摘要和正文/);
  assert.match(prompt.instructions,/【小红书图文】[\s\S]*精炼发布配文/);
  assert.match(prompt.instructions,/避免配文与卡片整段重复/);
  assert.match(prompt.instructions,/不使用 Markdown 粗体语法或输出 \*\* 符号/);
  assert.match(prompt.input,/"selectedPlatforms":\["知乎","小红书","公众号"\]/);
});

test('draft generation prompt excludes platforms the user did not select',() => {
  const prompt = buildDraftGenerationPrompt({title:'保险责任',platforms:['知乎']});
  assert.deepEqual(prompt.platforms,['知乎']);
  assert.doesNotMatch(prompt.instructions,/【公众号文章】|【小红书图文】/);
});

test('legacy Xiaohongshu drafts get a card plan prompt without generating images',() => {
  const prompt = buildXhsCardPlanPrompt({title:'等待期是什么',body:'精炼发布配文',sources:'正式条款'});
  assert.match(prompt.instructions,/3–5 张生产用图卡规划/);
  assert.match(prompt.input,/"caption":"精炼发布配文"/);
  assert.match(prompt.input,/"verifiedSources":"正式条款"/);
  assert.doesNotMatch(prompt.instructions,/调用生图|生成图片/);
});

test('strict image plan requires 3–5 complete cards while editing can save partial cards',() => {
  const partial = [{role:'cover',headline:'',keyPoints:[],visualDirection:''}];
  assert.equal(normalizeXhsCardPlan(partial),null);
  assert.deepEqual(normalizeEditableXhsCardPlan(partial),partial);
  assert.equal(normalizeEditableXhsCardPlan(Array.from({length:6},() => partial[0])),null);
  const complete = Array.from({length:3},(_unused,index) => ({role:index === 0 ? 'cover' : 'concept',headline:`标题 ${index}`,keyPoints:['要点'],visualDirection:''}));
  assert.equal(normalizeXhsCardPlan(complete).length,3);
});
