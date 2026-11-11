import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageReview, formatDiseaseCounts, renderCoverageReviewHtml } from './features/customers/coverage-review.js';

test('coverage review uses contract disease totals, not the number of excerpted definitions', () => {
  const analysis=buildCoverageReview({customer:{id:1,name:'测试客户'},today:'2026-11-09',policies:[{
    id:1,name:'测试重大疾病保险',company:'测试公司',type:'重大疾病保险',insuredName:'测试客户',verified:true,
    contractStatus:'active',effectiveDate:'2020-01-01',
  }],contracts:[{id:2,policyId:1,diseaseCounts:{critical:70,light:50},localBenefits:[
    {name:'重大疾病保险金',amount:'基本保险金额'},
    {name:'轻度脑中风',summary:'合同定义',page:14},
  ]}]});
  const policy=analysis.categories.find((item)=>item.key==='critical').policies[0];
  assert.equal(formatDiseaseCounts(policy.diseaseCounts),'重疾 70 种 · 轻症 50 种');
  const html=renderCoverageReviewHtml(analysis);
  assert.match(html,/重疾 70 种 · 轻症 50 种/);
  assert.match(html,/已摘录的疾病定义/);
  assert.doesNotMatch(html,/疾病定义范围 · 1 项|轻度脑中风<\/b> · 合同第/);
});
