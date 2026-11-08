import assert from 'node:assert/strict';
import test from 'node:test';
import { hasConfirmedBenefitFacts, recommendProductTopics, topicAngleOptions } from './topic-recommendations.js';

test('product topic recommendations require a linked product and confirmed source',() => {
  assert.deepEqual(recommendProductTopics({contentTypeCode:'product_explainer',angle:'benefits',productName:'安心年金'}),[]);
  assert.deepEqual(recommendProductTopics({contentTypeCode:'product_explainer',angle:'benefits',productName:'安心年金',hasVerifiedExtraction:true}),[]);
  const topics = recommendProductTopics({contentTypeCode:'product_explainer',angle:'benefits',productName:'安心年金',hasVerifiedExtraction:true,hasBenefitFacts:true});
  assert.equal(topics.length,3);
  assert.ok(topics.every((item) => item.title.includes('安心年金') && item.category === '产品解读'));
  assert.ok(topics.some((item) => item.title.includes('回报率')));
});

test('benefit angles are offered only when confirmed product facts support them',() => {
  const facts = [{title:'现金价值',productFact:'第 10 个保单年度的现金价值以利益演示表为准'}];
  assert.equal(hasConfirmedBenefitFacts(facts),true);
  assert.ok(topicAngleOptions('product_explainer',facts).some((item) => item.value === 'benefits'));
  assert.ok(!topicAngleOptions('product_explainer',[{title:'等待期'}]).some((item) => item.value === 'benefits'));
  assert.deepEqual(recommendProductTopics({contentTypeCode:'customer_case',angle:'benefits',productName:'医疗险',hasVerifiedExtraction:true,hasBenefitFacts:false,caseSummary:'脱敏摘要'}),[]);
});

test('case recommendations require case facts and authorization for real cases',() => {
  const common = {contentTypeCode:'customer_case',angle:'budget',productName:'家庭守护险',hasVerifiedExtraction:true,caseSummary:'已脱敏的预算和保障需求摘要'};
  assert.deepEqual(recommendProductTopics({...common,caseKind:'authorized_real'}),[]);
  const topics = recommendProductTopics({...common,caseKind:'authorized_real',authorizationConfirmed:true,anonymizationConfirmed:true});
  assert.equal(topics.length,3);
  assert.ok(topics.every((item) => item.title.includes('家庭守护险') && item.category === '客户案例'));
  assert.deepEqual(recommendProductTopics({...common,caseSummary:''}),[]);
});
