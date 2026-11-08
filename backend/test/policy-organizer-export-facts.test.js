import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractPolicyContractExportFacts } from '../policy-contract-export-facts.js';
import { plannedRemainingPremiums, policyCoverageAmounts, PolicyOrganizerExportOperations } from '../policy-organizer-export-operations.js';
import { contractResponsibilities } from '../policy-organizer-responsibilities.js';

test('policy schedule keeps applicant, insured and beneficiary as separate roles', () => {
  const facts=extractPolicyContractExportFacts([{num:1,text:[
    '投 保 人：张三 身份证：000000000000000000',
    '被 保 险 人：李四 身份证：000000000000000000',
    '身故保险金受益人 证件号码 受益顺序 受益份额',
    '法定继承人 -- -- --',
    '险种名称：某重大疾病保险',
    '基本保险金额：200000.00元',
    '合同生效日期：2020年01月01日',
    '交费期间：20年',
  ].join('\n')}]);
  assert.equal(facts.holderName,'张三');
  assert.equal(facts.insuredName,'李四');
  assert.equal(facts.beneficiary,'法定继承人');
  assert.equal(facts.insuredBirthDate,undefined);
});

test('remaining payment count follows future scheduled due dates, not elapsed years alone', () => {
  assert.equal(plannedRemainingPremiums({paymentTerm:'20年',effectiveDate:'2016-02-25',contractFacts:{renewalDueMonthDay:'02-25'}},'2026-11-08'),'9期（合同计划）');
  assert.equal(plannedRemainingPremiums({paymentTerm:'20年',effectiveDate:'2018-08-08',paymentEndDate:'2037-08-08',contractFacts:{renewalDueMonthDay:'08-08'}},'2026-11-08'),'11期（合同计划）');
  assert.equal(plannedRemainingPremiums({paymentTerm:'一次交清',effectiveDate:'2021-07-18'},'2026-11-08'),'0期（该合同一次交清）');
});

test('contract liability summary requires clause evidence and uses policy-specific basic amount', () => {
  const facts={productName:'健康无忧C款重大疾病保险',basicSumInsured:{amount:'200,000元'}};
  assert.deepEqual(contractResponsibilities([],facts),[]);
  const clauses='2.3.1 轻 症 疾 病 保 险 金 180 日 按基本保险金额的 20%给付。重大疾病保险金按实交保险费的 1.1 倍。身故保险金';
  const benefits=contractResponsibilities([{num:5,text:clauses}],facts);
  assert.equal(benefits.length,3);
  assert.match(benefits[0].main,/4万元/);
  assert.match(benefits[1].main,/20万元/);
});

test('overview separates shared medical cap, death benefit and independent accident cover', () => {
  const critical=policyCoverageAmounts({name:'某重大疾病保险',insuranceType:'重大疾病保险',basicSumInsured:'100,000元（基本保险金额）',
    benefits:[{name:'身故保险金',amount:'基本保险金额（本单10万元）或实交保费的1.1倍',summary:'因意外身故按条款给付'}]});
  assert.equal(critical.critical,100000);
  assert.equal(critical.life,100000);
  assert.equal(critical.accidentAmount,100000);
  const multipleCritical=policyCoverageAmounts({name:'多倍保障重大疾病保险',basicSumInsured:'10万元',benefits:[
    {name:'身故保险金',amount:'基本保额扣减已给付疾病保险金',summary:'90日内因意外身故或90日后身故，按基本保额扣减累计已给付疾病保险金。'},
    {name:'前10年关爱保险金',amount:'基本保额的50%',summary:'符合条件的身故时附加给付。'},
  ]});
  assert.equal(multipleCritical.accidentAmount,100000);
  assert.equal(policyCoverageAmounts({name:'某重大疾病保险',basicSumInsured:'10万元',benefits:[
    {name:'身故保险金',amount:'基本保额',summary:'因疾病身故按基本保额给付。'},
  ]}).accidentAmount,undefined);
  const medical=policyCoverageAmounts({name:'某医疗保险',insuranceType:'费用补偿型医疗保险',basicSumInsured:'4,000,000元（合同保险金额）',
    benefits:[{name:'一般医疗费用保险金',amount:'年度限额200万元',summary:'因意外或疾病住院'},
      {name:'特定疾病医疗费用保险金',amount:'年度限额400万元'},
      {name:'年度总给付上限',amount:'400万元'}]});
  assert.equal(medical.hospitalization,4000000);
  assert.equal(medical.accidentMedical,undefined);
  const accidentMedicalOnly=policyCoverageAmounts({name:'某意外医疗保险',insuranceType:'意外险',basicSumInsured:'5万元'});
  assert.equal(accidentMedicalOnly.accidentAmount,undefined);
  const withoutSharedCap=policyCoverageAmounts({name:'某医疗保险',insuranceType:'医疗保险',benefits:[
    {name:'一般医疗费用保险金',amount:'200万元'},
    {name:'特定疾病医疗费用保险金',amount:'400万元'},
  ]});
  assert.equal(withoutSharedCap.hospitalization,null);
  assert.equal(policyCoverageAmounts({name:'某分红型重大疾病保险',insuranceType:'重大疾病保险',basicSumInsured:'10万元'}).financial,undefined);
  assert.equal(policyCoverageAmounts({name:'某增额终身寿保险',basicSumInsured:'30万元'}).financial,300000);
});

test('exported overview contains numeric category totals instead of registration labels', async () => {
  const policies=[
    {id:1,policy_name:'甲重大疾病保险',insurance_type:'重大疾病保险',insured_name:'测试客户',basic_sum_insured:{amount:'100,000元'},verified:true,contract_status:'active'},
    {id:2,policy_name:'乙重大疾病保险',insurance_type:'重大疾病保险',insured_name:'测试客户',basic_sum_insured:{amount:'200,000元'},verified:true,contract_status:'active'},
    {id:3,policy_name:'某医疗保险',insurance_type:'医疗保险',insured_name:'测试客户',basic_sum_insured:{amount:'4,000,000元'},verified:true,contract_status:'active'},
    {id:4,policy_name:'某增额终身寿保险',insurance_type:'终身寿险',insured_name:'测试客户',basic_sum_insured:{amount:'300,000元'},verified:true,contract_status:'active'},
  ];
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户',phone:''}]
    :sql.includes('FROM policies')?policies:[]})};
  const result=await exporter.exportPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const overview=workbook.getWorksheet('家庭保单整理');
  assert.equal(overview.getCell('I4').value,300000);
  assert.equal(overview.getCell('J4').value,300000);
  assert.equal(overview.getCell('M4').value,4000000);
  assert.equal(overview.getCell('O4').value,300000);
  assert.equal(overview.getCell('L4').value,null);
  assert.equal(overview.getCell('I4').numFmt,'#,##0"元"');
  assert.ok(overview.getColumn('I').width>=15);
  assert.ok(overview.getColumn('M').width>=17);
});

test('expired coverage is not counted as current insured amount', async () => {
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户',phone:''}]
    :sql.includes('FROM policies')?[{id:1,policy_name:'某医疗保险',insurance_type:'医疗保险',insured_name:'测试客户',
      basic_sum_insured:{amount:'4,000,000元'},effective_date:'2021-07-18',expiry_date:'2022-07-17'}]:[]})};
  const result=await exporter.exportPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const cell=workbook.getWorksheet('家庭保单整理').getCell('M4');
  assert.equal(cell.value,null);
  assert.match(String(cell.note),/已过原保期/);
});

test('unverified cover remains in policy detail but not in confirmed overview total', async () => {
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户',phone:''}]
    :sql.includes('FROM policies')?[{id:1,policy_name:'某重大疾病保险',insurance_type:'重大疾病保险',insured_name:'测试客户',
      basic_sum_insured:{amount:'100,000元'},verified:false,contract_status:'unknown',effective_date:'2020-01-01'}]:[]})};
  const result=await exporter.exportPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const overview=workbook.getWorksheet('家庭保单整理');
  assert.equal(overview.getCell('I4').value,null);
  assert.match(String(overview.getCell('I4').note),/待核实/);
  assert.match(String(overview.getCell('J9').value),/100,000/);
});
