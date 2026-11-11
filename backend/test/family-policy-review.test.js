import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { FamilyPolicyReviewOperations } from '../family-policy-review-operations.js';
import { CustomerFollowupOperations } from '../customer-followup-operations.js';
import { PolicyOrganizerExportOperations } from '../policy-organizer-export-operations.js';

function fixture() {
  const service=new FamilyPolicyReviewOperations();
  service.family=async()=>({id:1,name:'测试家庭',primaryCustomerId:1,members:[
    {id:1,customerId:1,name:'家长',isGuest:false},
    {id:2,customerId:2,name:'配偶',isGuest:false},
    {id:3,customerId:null,name:'孩子',isGuest:true},
    {id:4,customerId:null,name:'祖父',isGuest:true},
  ],policies:[
    {id:11,customerId:1,name:'重疾保险',type:'重大疾病保险',people:[{memberId:3,role:'insured'},{memberId:1,role:'holder'}]},
    {id:12,customerId:1,name:'住院医疗保险',type:'医疗保险',people:[{memberId:1,role:'insured'},{memberId:2,role:'insured'}]},
  ]});
  service.customerCoverageReview=async(customerId)=>customerId===1?{
    customer:{id:1},profile:{medicalInsuranceStatus:'employee'},
    policies:[
      {id:11,name:'重疾保险',type:'重大疾病保险',company:'甲公司',premium:'每年2000元',
        basicSumInsured:{amount:'100000元'},verified:true,contractStatus:'active',effectiveDate:'2020-01-01'},
      {id:12,name:'住院医疗保险',type:'医疗保险',company:'甲公司',premium:'一次交清500元',
        basicSumInsured:{amount:'4000000元'},verified:true,contractStatus:'active',effectiveDate:'2020-01-01'},
    ],contracts:[
      {id:20,policyId:11,fileName:'未关联的旧版.pdf',localBenefits:[]},
      {id:21,policyId:11,fileName:'重疾.pdf',localBenefits:[{name:'重大疾病保险金',amount:'基本保额10万元',page:5}]},
      {id:23,policyId:11,fileName:'重疾补充.pdf',localBenefits:[]},
    ],
  }:{customer:{id:2},profile:{medicalInsuranceStatus:'resident'},policies:[],contracts:[
    {id:22,policyId:null,fileName:'养老.pdf',localPolicy:{productName:'增额终身寿保险',premium:'每年500元',basicSumInsured:{amount:'200000元'}},localBenefits:[]},
  ]};
  service.preparePolicyOrganizerData=async(customerId)=>customerId===1?{
    customer:{id:1,name:'家长',phone:'13800000000'},records:[
      {id:11,sourceContractIds:[21],name:'重疾保险',insuranceType:'重大疾病保险',company:'甲公司',
        premium:'每年2000元',basicSumInsured:'100000元',verified:true,contractStatus:'active',effectiveDate:'2020-01-01',
        benefits:[{name:'重大疾病保险金',amount:'基本保额10万元',page:5}]},
      {id:12,sourceContractIds:[],name:'住院医疗保险',insuranceType:'医疗保险',company:'甲公司',
        premium:'一次交清500元',basicSumInsured:'4000000元',verified:true,contractStatus:'active',effectiveDate:'2020-01-01'},
    ],
  }:{customer:{id:2,name:'配偶',phone:'13900000000'},records:[
    {id:'contract-22',sourceContractIds:[22],name:'增额终身寿保险',insuranceType:'终身寿险',company:'乙公司',
      premium:'每年500元',basicSumInsured:'200000元',verified:false,effectiveDate:'2020-01-01'},
  ]};
  service.db={query:async(sql)=>{
    if(sql.includes('FROM family_contracts'))return {rows:[{contract_id:21},{contract_id:22},{contract_id:23}]};
    if(sql.includes('FROM family_contract_people'))return {rows:[
      {contract_id:21,member_id:3,role:'insured'},
      {contract_id:21,member_id:1,role:'holder'},
      {contract_id:22,member_id:2,role:'insured'},
    ]};
    if(sql.includes('FROM family_coverage_context'))return {rows:[{context_data:{mainIncomeMemberIds:[1],dependentMemberIds:[3],longTermGoals:['retirement']}}]};
    if(sql.includes('FROM family_member_coverage_profiles'))return {rows:[]};
    throw new Error(`unexpected query: ${sql}`);
  }};
  return service;
}

test('family review deduplicates archived policy and PDF, attributes by member ID, and keeps shared caps pending',async()=>{
  const review=await fixture().familyPolicyReview(1);
  assert.equal(review.records.length,3);
  assert.equal(review.records.filter((item)=>item.id===11).length,1);
  assert.equal(review.records.find((item)=>item.id===11).contractId,21);
  assert.deepEqual(review.records.find((item)=>item.id===11).linkedContractIds,[21,23]);
  const child=review.members.find((item)=>item.id===3);
  const parent=review.members.find((item)=>item.id===1);
  assert.equal(child.coverages.find((item)=>item.key==='critical').amount,100000);
  assert.equal(parent.coverages.find((item)=>item.key==='critical').amount,null);
  assert.equal(parent.coverages.find((item)=>item.key==='hospitalization').amount,null);
  assert.equal(parent.coverages.find((item)=>item.key==='hospitalization').pendingAmount,4000000);
  assert.equal(review.summary.annualPremiumTotal,2000);
  assert.equal(review.records.find((item)=>item.contractId===22).status,'pending');
});

test('edited family policy people override older PDF assignments',async()=>{
  const service=fixture();
  const originalFamily=service.family;
  service.family=async()=>{
    const family=await originalFamily();
    family.policies[0].people=[{memberId:2,role:'insured'}];
    return family;
  };
  const review=await service.familyPolicyReview(1);
  assert.deepEqual(review.records.find((item)=>item.id===11).insuredMemberIds,[2]);
  assert.equal(review.members.find((item)=>item.id===2).coverages.find((item)=>item.key==='critical').amount,100000);
  assert.equal(review.members.find((item)=>item.id===3).coverages.find((item)=>item.key==='critical').amount,null);
});

test('family workbook reuses the personal template and extraction rules for every member',async()=>{
  const file=await fixture().exportFamilyPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const overview=workbook.getWorksheet('家庭保单整理');
  assert.deepEqual(workbook.worksheets.map((sheet)=>sheet.name),['家庭保单整理']);
  assert.equal(overview.getCell('A4').value,'家长');
  assert.equal(overview.getCell('A5').value,'配偶');
  assert.equal(overview.getCell('A6').value,'孩子');
  assert.equal(overview.getCell('A7').value,'祖父');
  assert.equal(overview.getCell('I6').value,100000);
  assert.equal(overview.getCell('I4').value,null);
  assert.equal(overview.getCell('M4').value,null); // shared medical limit cannot be assigned to one member
  assert.equal(overview.getCell('O5').value,200000); // spouse's pending contract amount remains visible
  assert.match(String(overview.getCell('O5').note),/状态待核/);
  assert.equal(overview.getCell('G4').value,'13800000000');
  assert.equal(overview.getCell('G5').value,'13900000000');
  assert.equal(overview.getCell('A9').value,'投保人');
  assert.equal(overview.getCell('E9').value,'险种名称');
  assert.equal(overview.getCell('C10').value,'孩子');
  assert.equal(overview.getCell('C11').value,'家长、配偶');
  assert.equal(overview.getCell('C12').value,'配偶');
  assert.equal(overview.getCell('E13').value,'¥2,500.00 / 年');
  assert.match(overview.getCell('K10').value,/重大疾病保险金：基本保额10万元/);
});

test('family diagnosis export adds one AI conclusion beneath every member',async()=>{
  const service=fixture();
  service.policyOrganizerDiagnoses=PolicyOrganizerExportOperations.prototype.policyOrganizerDiagnoses;
  let received='';
  service.policyOrganizerDiagnosisModel=async(_instructions,input)=>{
    received=input;
    return {results:[0,1,2,3].map((index)=>({index,points:[
      `第${index+1}位成员已有的保障按保单列示。`,
      '当前资料未见的保障项目可结合家庭责任补充。',
    ]}))};
  };
  const file=await service.exportFamilyPolicyOrganizer(1,{withDiagnosis:true});
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const sheet=workbook.getWorksheet('家庭保单整理');
  assert.deepEqual([4,6,8,10].map((row)=>sheet.getCell(`A${row}`).value),['家长','配偶','孩子','祖父']);
  assert.ok([5,7,9,11].every((row)=>String(sheet.getCell(`A${row}`).value).startsWith('诊断建议：\n1. ')));
  assert.equal(sheet.getCell('A13').value,'投保人');
  assert.doesNotMatch(received,/家长|配偶|孩子|祖父|13800000000|13900000000/);
  assert.match(received,/"hasDependents":true/);
});

test('unlinking a household source removes policy and PDF links together without deleting originals',async()=>{
  const statements=[];
  const service=new FamilyPolicyReviewOperations();
  service.db={transaction:async(work)=>work({query:async(sql,values)=>{
    statements.push({sql,values});
    if(sql.includes('DELETE FROM family_contracts fc'))return {rows:[{contract_id:21},{contract_id:23}]};
    if(sql.includes('DELETE FROM family_policies'))return {rows:[{policy_id:11}]};
    if(sql.includes('DELETE FROM family_contracts WHERE'))return {rows:[]};
    throw new Error(`unexpected query: ${sql}`);
  }})};
  const result=await service.unlinkFamilyPolicySource(1,{policyId:11,contractIds:[21,23]});
  assert.deepEqual(result,{unlinked:true,removedContracts:2,removedPolicies:1});
  assert.equal(statements.length,3);
  assert.deepEqual(statements[2].values,[1,[21,23]]);
  assert.ok(statements.every(({sql})=>!sql.includes('DELETE FROM customer_policy_contracts')&&!sql.includes('DELETE FROM policies')));
});

test('family contract link rejects member IDs outside the family before writing',async()=>{
  const service=new FamilyPolicyReviewOperations();
  let writes=0;
  service.db={transaction:async(work)=>work({query:async(sql)=>{
    if(sql.includes('FROM customer_policy_contracts'))return {rows:[{id:21,policy_id:null}]};
    if(sql.includes('FROM family_members'))return {rows:[{id:1}]};
    writes++;
    return {rows:[]};
  }})};
  await assert.rejects(()=>service.linkFamilyContract(1,21,{holderMemberIds:[1],insuredMemberIds:[999]}),
    /当前家庭成员/);
  assert.equal(writes,0);
});

test('deleting an individual policy clears its linked household PDFs before excluding the source',async()=>{
  const statements=[];
  const service=new CustomerFollowupOperations();
  service.findCustomer=async()=>({id:1});
  service.customer=async()=>({id:1});
  service.db={
    query:async(sql)=>{
      if(sql.startsWith('SELECT id,policy_name,effective_date FROM policies WHERE id='))return {rows:[{id:11,policy_name:'重疾保险',effective_date:'2020-01-01'}]};
      if(sql.startsWith('SELECT id,policy_name,effective_date FROM policies WHERE customer_id='))return {rows:[{id:11,policy_name:'重疾保险',effective_date:'2020-01-01'}]};
      if(sql.includes('FROM customer_policy_contracts'))return {rows:[]};
      throw new Error(`unexpected query: ${sql}`);
    },
    transaction:async(work)=>work({query:async(sql,values)=>{
      statements.push({sql,values});
      if(sql.includes('FOR UPDATE'))return {rows:[{policy_name:'重疾保险',effective_date:'2020-01-01'}]};
      if(sql.startsWith('SELECT id FROM policy_service_items'))return {rows:[]};
      return {rows:[]};
    }}),
  };
  await service.deletePolicy(1,11);
  const unlinkIndex=statements.findIndex(({sql})=>sql.startsWith('DELETE FROM family_contracts'));
  const excludeIndex=statements.findIndex(({sql})=>sql.startsWith('UPDATE customer_policy_contracts'));
  assert.ok(unlinkIndex>=0 && excludeIndex>unlinkIndex);
  assert.deepEqual(statements[unlinkIndex].values,[1,11,[]]);
});
