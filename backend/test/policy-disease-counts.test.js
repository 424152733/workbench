import test from 'node:test';
import assert from 'node:assert/strict';
import { countPolicyDiseases } from '../policy-disease-counts.js';

test('counts complete numbered major and minor illness definitions without relying on extracted excerpts', () => {
  const pages=[
    {num:1,text:'6.6 本合同所指的轻症疾病 6.8 本合同所指的重大疾病'},
    {num:10,text:'6.6.1 轻度疾病甲 6.6.2 轻度疾病乙 6.6.3 轻度疾病丙'},
    {num:11,text:'6.8.1 重大疾病甲 6.8.2 重大疾病乙'},
  ];
  assert.deepEqual(countPolicyDiseases(pages),{critical:2,light:3});
});

test('incomplete numbering and standard-definition references do not become coverage counts', () => {
  assert.deepEqual(countPolicyDiseases([{num:1,text:'标准定义包括25种重大疾病。6.6 本合同所指的轻症疾病 6.6.1 疾病甲 6.6.3 疾病丙'}]),
    {critical:null,light:null});
});
