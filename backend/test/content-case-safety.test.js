import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCaseKindLabels, hasCaseKindLabels } from '../content-case-safety.js';

test('composite and scenario cases keep their label on body and Xiaohongshu cover',() => {
  for (const [caseKind,label] of [['composite','综合案例'],['scenario','情景示例']]) {
    const result = ensureCaseKindLabels({caseKind,body:'案例正文',cardPlan:[{headline:'主题标题'},{headline:'解释要点'}]});
    assert.equal(result.body,`【${label}】\n\n案例正文`);
    assert.equal(result.cardPlan[0].headline,`【${label}】｜主题标题`);
    assert.equal(result.cardPlan[1].headline,'解释要点');
    assert.equal(hasCaseKindLabels({caseKind,body:result.body,platform:'小红书',cardPlan:result.cardPlan}),true);
  }
});

test('case labels are idempotent and real cases are not marked as examples',() => {
  const labeled = ensureCaseKindLabels({caseKind:'scenario',body:'【情景示例】\n\n案例正文',cardPlan:[{headline:'【情景示例】｜主题'}]});
  assert.equal(labeled.body,'【情景示例】\n\n案例正文');
  assert.equal(labeled.cardPlan[0].headline,'【情景示例】｜主题');
  assert.deepEqual(ensureCaseKindLabels({caseKind:'authorized_real',body:'真实案例正文',cardPlan:[]}),{body:'真实案例正文',cardPlan:[]});
  assert.equal(hasCaseKindLabels({caseKind:'composite',body:'【综合案例】正文',platform:'小红书',cardPlan:[]}),true);
  assert.equal(hasCaseKindLabels({caseKind:'scenario',body:'正文',platform:'公众号',cardPlan:[]}),false);
});
