import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverageReview } from './coverage-review.js';

test('原合同责任按给付类型展示，未归档合同只计入待核记录', () => {
  const review=buildCoverageReview({
    customer:{id:1,name:'测试客户'},today:'2026-11-08',
    policies:[
      {id:1,name:'某重大疾病保险',type:'重大疾病保险',premium:'每年1000元',insuredName:'测试客户',verified:false,contractStatus:'unknown',basicSumInsured:{amount:'100,000元'}},
      {id:2,name:'某医疗保险',type:'费用补偿型医疗保险',premium:'一次交清200元',insuredName:'测试客户',verified:false,contractStatus:'unknown'},
    ],
    contracts:[
      {id:11,matchedPolicyId:1,policyId:null,localBenefits:[
        {name:'重大疾病保险金',amount:'基本保额10万元',summary:'因意外或等待期后确诊按条款给付',page:'5'},
        {name:'身故保险金',amount:'基本保额或实交保费',summary:'因意外或等待期后身故按条款给付',page:'5'},
      ]},
      {id:12,matchedPolicyId:2,policyId:null,localBenefits:[
        {name:'一般医疗费用保险金',amount:'年度限额200万元',summary:'因意外或疾病住院时按条款报销',page:'4'},
      ]},
      {id:13,policyId:null,localPolicy:{productName:'另一重大疾病保险',insuredName:'测试客户',premium:'每年3000元',basicSumInsured:{amount:'200,000元'}},localBenefits:[
        {name:'重大疾病保险金',amount:'依合同约定计算',page:'6'},
        {name:'身故保险金',amount:'依合同约定计算',page:'6'},
        {name:'前10年关爱保险金',amount:'基本保额的50%',summary:'前10年发生符合条件的重大疾病或身故时附加给付',page:'7'},
      ]},
    ],
  });
  assert.deepEqual(Object.fromEntries(review.categories.map((item)=>[item.key,[item.currentCount,item.reviewCount]])),{
    medical:[0,1],critical:[0,2],accident:[0,0],life:[0,2],annuity:[0,0],
  });
  assert.equal(review.metrics.policyCount,2);
  assert.equal(review.metrics.provisionalContractCount,1);
  assert.equal(review.metrics.criticalPendingBasicSumInsuredTotal,300000);
  assert.equal(review.categories.find((item)=>item.key==='life').policies.every((item)=>item.responsibilityOnly),true);
  assert.ok(review.categories.find((item)=>item.key==='life').benefits.some((item)=>item.name==='前10年关爱保险金'));
  assert.equal(review.categories.find((item)=>item.key==='accident').policies.length,0);
});
