import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractPolicyContractExportFacts } from '../policy-contract-export-facts.js';
import { policyCoverageAmounts, buildPolicyOrganizerWorkbook, PolicyOrganizerExportOperations, normalizeBenefits, combinedBenefits, policyOrganizerMemberSnapshots, generatePolicyOrganizerDiagnoses, preferDetailedPremium } from '../policy-organizer-export-operations.js';
import { contractResponsibilities } from '../policy-organizer-responsibilities.js';
import { responsibilityBlocks, responsibilityLines } from '../policy-responsibility-format.js';

test('policy schedule keeps applicant, insured and beneficiary as separate roles', () => {
  const facts=extractPolicyContractExportFacts([{num:1,text:[
    '投 保 人：张三 身份证：000000000000000000',
    '被 保 险 人：李四 身份证：000000000000000000',
    '身故保险金受益人 证件号码 受益顺序 受益份额',
    '法定继承人 -- -- --',
    '险种名称：某重大疾病保险',
    '保险合同号：AB0012345678',
    '基本保险金额：200000.00元',
    '合同生效日期：2020年01月01日',
    '交费期间：20年',
  ].join('\n')}]);
  assert.equal(facts.holderName,'张三');
  assert.equal(facts.insuredName,'李四');
  assert.equal(facts.beneficiary,'法定继承人');
  assert.equal(facts.policyNumber,'AB0012345678');
  assert.equal(facts.insuredBirthDate,undefined);
});

test('export combines a supplemental clause with the same benefit without erasing its payout', () => {
  const benefits=combinedBenefits([], [
    {name:'重大疾病保险金',amount:'基本保险金额',summary:'分组给付',scenarios:[]},
    {name:'重大疾病保险金',amount:'',summary:'与身故责任择一',scenarios:[{trigger:'首次确诊',amount:'基本保险金额',page:20}]},
    {name:'身故保险金',amount:'账户价值',scenarios:[]},
  ]);
  assert.equal(benefits.length,2);
  assert.equal(benefits[0].amount,'基本保险金额');
  assert.equal(benefits[0].scenarios.length,1);
});

test('annuity basic amount is not mistaken for a fixed death benefit', () => {
  const amounts=policyCoverageAmounts({name:'如意来年金保险',insuranceType:'年金保险',basicSumInsured:'2,996.7元',
    benefits:[{name:'身故保险金',amount:'已交保险费与现金价值较大者'}]});
  assert.equal(amounts.financial,2996.7);
  assert.equal(amounts.life,undefined);
});

test('annual main and rider premiums count once in the annual total', () => {
  assert.equal(preferDetailedPremium('主险3507.50元；附加险1630.70元；合计5138.20元','',
    '年交 RMB3507.50；附加险年交 RMB1630.70'),'每年5138.20元（主附险合计）');
  assert.equal(preferDetailedPremium('主险3507.50元；附加险1630.70元；合计5138.20元','',
    '年交：主险RMB3507.50；附加险RMB1630.70'),'每年5138.20元（主附险合计）');
});

test('a contract birthday benefit remains visible in the exported responsibilities', () => {
  const benefits=normalizeBenefits({benefits:[{name:'祝寿金',amount:'已交保险费',summary:'88周岁后的首个保单周年日仍生存时给付'}]});
  assert.equal(benefits.length,1);
  assert.equal(benefits[0].name,'祝寿金');
});

test('Excel export stops when an uploaded contract has not completed AI extraction', async () => {
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户'}]
    :sql.includes('FROM customer_policy_contracts')?[{id:2,analysis_status:'待整理',extraction_data:null}]:[]})};
  await assert.rejects(exporter.preparePolicyOrganizerData(1),/还有 1 份合同未完成最新版 AI 整理/);
});

test('contract liability summary requires clause evidence and uses policy-specific basic amount', () => {
  const facts={productName:'健康无忧C款重大疾病保险',basicSumInsured:{amount:'200,000元'}};
  assert.deepEqual(contractResponsibilities([],facts),[]);
  const clauses='2.3.1 轻 症 疾 病 保 险 金 180 日 按基本保险金额的 20%给付。重大疾病保险金按实交保险费的 1.1 倍。身故保险金';
  const benefits=contractResponsibilities([{num:5,text:clauses}],facts);
  assert.equal(benefits.length,3);
  assert.match(benefits[0].main,/4万元/);
  assert.match(benefits[1].main,/20万元/);
  assert.equal(benefits[1].scenarios.length,2);
  assert.match(benefits[1].scenarios[1].amount,/20万元/);
});

test('six verified benefits of a multi-claim critical policy fit in one Excel row', () => {
  const benefits=contractResponsibilities([
    {num:5,text:'单一组别给付限额，90 日内因疾病确诊的轻症疾病保险金'},
    {num:6,text:'重大疾病保险金、身故保险金，85 周岁保单生效对应日'},
    {num:7,text:'前 10 年关爱保险金为基本保险金额的50%；特定严重疾病保险金为基本保险金额的20%'},
  ],{productName:'多倍保障重大疾病保险',basicSumInsured:{amount:'100,000元'}});
  assert.equal(benefits.length,6);
  const blocks=responsibilityBlocks({benefits,diseaseCounts:{critical:70,light:50}});
  assert.equal(blocks.length,1);
  assert.ok(blocks[0].height<=405);
  assert.match(blocks[0].text,/6、豁免保险费/);
});

test('export ignores disease definitions and claim procedures misread as benefits', () => {
  const extracted=normalizeBenefits({benefits:[
    {name:'重大疾病保险金',amount:'',scenarios:[]},
    {name:'轻症疾病保险金-冠状动脉介入手术',amount:'',scenarios:[{amount:'',evidenceVerified:true}]},
    {name:'疾病保险金',summary:'申请书及证明和资料',amount:''},
    {name:'身故保险金',amount:'',scenarios:[{trigger:'受益人未指定',amount:'',evidenceVerified:true}]},
    {name:'第一组癌症保障',amount:'单一组别给付限额为基本保额的300%',scenarios:[{trigger:'癌症',amount:'300%基本保额',evidenceVerified:true}]},
    {name:'重大疾病保险金',amount:'基本保额与组别限额余额取较小者',scenarios:[{trigger:'85周岁前确诊',amount:'基本保额与组别限额余额取较小者',evidenceVerified:true}]},
  ]});
  assert.deepEqual(extracted.map((item)=>item.name),['重大疾病保险金']);
  const local=[{name:'重大疾病保险金',amount:'按条款计算',scenarios:[{trigger:'85周岁前确诊',amount:'基本保额与组别限额余额取较小者',evidenceVerified:true}]}];
  assert.equal(combinedBenefits(local,extracted).length,1);
  assert.equal(combinedBenefits(local,extracted)[0].scenarios.length,1);
});

test('responsibility text follows a concise amount-first list and keeps distinct payout scenarios', () => {
  const benefit={name:'身故保险金',page:5,conditions:'被保险人年龄以合同约定为准',scenarios:[
    {trigger:'等待期内因疾病身故',amount:'已交保费的1.1倍',relation:'与重疾保险金择一给付',evidenceVerified:true},
    {trigger:'因意外身故',amount:'基本保险金额20万元',conditions:'合同终止',evidenceVerified:true},
    {trigger:'无原文依据',amount:'100万元',evidenceVerified:false},
  ]};
  const record={diseaseCounts:{critical:70,light:50},benefits:[benefit,{name:'轻症疾病保险金',amount:'基本保额的20%',page:6},
    {name:'特定严重疾病保险金',amount:'基本保额的20%',page:7},...Array.from({length:20},(_,index)=>({
    name:`第${index+1}项责任`,amount:'按合同所列金额给付',summary:'满足合同约定的发生条件时给付，具体次数及限额应对照原合同核对。',page:index+6,
  }))]};
  const lines=responsibilityLines(record);
  assert.match(lines.join('\n'),/身价金/);
  assert.doesNotMatch(lines.join('\n'),/身故保险金/);
  assert.match(lines.join('\n'),/等待期内因疾病身故：已交保费的1.1倍/);
  assert.match(lines.join('\n'),/因意外身故：基本保额20万元/);
  assert.doesNotMatch(lines.join('\n'),/通用说明/);
  assert.match(lines.join('\n'),/50种轻症疾病保险金：基本保额的20%/);
  assert.doesNotMatch(lines.join('\n'),/70种特定严重疾病保险金/);
  assert.doesNotMatch(lines.join('\n'),/合同第\d+页/);
  assert.doesNotMatch(lines.join('\n'),/无原文依据|100万元/);
  const blocks=responsibilityBlocks(record);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].text,lines.join('\n'));
  assert.ok(blocks[0].height<=405);
});

test('long policy responsibilities stay in one product row without losing any item', async () => {
  const benefits=Array.from({length:24},(_,index)=>({name:`第${index+1}项保险金`,amount:'基本保额的20%',
    summary:'确诊符合合同约定的疾病后按约定给付；同一疾病责任可能与其他给付择一，请核对具体条款。',page:index+4}));
  const {workbook}=buildPolicyOrganizerWorkbook({customer:{name:'测试客户'},preparedOn:'2026-11-09',records:[{
    name:'多责任保单',insuredName:'测试客户',premium:'每年1000元',benefits,
  }]});
  const bytes=await workbook.xlsx.writeBuffer();
  const reopened=new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  assert.deepEqual(reopened.worksheets.map((sheet)=>sheet.name),['家庭保单整理']);
  const sheet=reopened.getWorksheet('家庭保单整理');
  const responsibility=String(sheet.getCell('K9').value || '');
  assert.equal((responsibility.match(/第\d+项保险金/g)||[]).length,24);
  assert.ok(sheet.getRow(9).height<=405);
  assert.equal(sheet.getCell('K9').note,undefined);
  assert.equal(sheet.getCell('A10').value,'已识别年交保费小计');
  assert.equal(sheet.getCell('E10').value,'¥1,000.00 / 年');
  assert.equal(sheet.pageSetup.printArea,'A1:P10');
});

test('a single verified payout leads with amount and retains key limits without repeating its summary', () => {
  const lines=responsibilityLines({benefits:[{
    name:'中症疾病保险金',amount:'基本保险金额的50%',
    summary:'按基本保险金额50%给付，每种一次，累计两次',
    scenarios:[{trigger:'90日后初次患中症',amount:'基本保险金额的50%',
      limit:'每种一次；累计两次',evidenceVerified:true}],
  }]});
  assert.deepEqual(lines,['1、中症疾病保险金：基本保额的50%（90日后初次患中症；每种限1次；最多2次）']);
});

test('medical responsibility shows the selected annual cap and shared scope without unrelated plan details', () => {
  const lines=responsibilityLines({benefits:[{
    name:'一般医疗费用保险金',amount:'年度限额200万元（计划二）',
    summary:'包括住院和住院前后门急诊合理医疗费用，共用一般医疗限额；年度免赔额1万元。',
    scenarios:[{trigger:'住院医疗费用',amount:'按赔付比例计算',conditions:'计划三特需床位费每日限1500元',evidenceVerified:true}],
  }]});
  assert.deepEqual(lines,['1、一般医疗费用保险金：年度限额200万元（计划二）；包括住院和住院前后门急诊合理医疗费用，共用一般医疗限额；年度免赔额1万元']);
  assert.doesNotMatch(lines.join('\n'),/计划三|通用说明/);
});

test('identical death and disability schedules share one customer-facing entry', () => {
  const death={name:'身故保险金',scenarios:[
    {trigger:'90日内因疾病身故',amount:'已交保险费',relation:'合同终止',evidenceVerified:true},
    {trigger:'90日后因疾病身故',amount:'基本保险金额',relation:'合同终止',evidenceVerified:true},
  ]};
  const disability={name:'全残保险金',scenarios:[
    {trigger:'90日内因疾病全残',amount:'已交保险费',relation:'合同终止',evidenceVerified:true},
    {trigger:'90日后因疾病全残',amount:'基本保险金额',relation:'合同终止',evidenceVerified:true},
  ]};
  const combined=responsibilityLines({benefits:[death,disability]}).join('\n');
  assert.match(combined,/1、身价金\/全残保险金/);
  assert.match(combined,/身故或全残/);
  assert.match(combined,/已交保费/);
  assert.match(combined,/基本保额/);
  assert.doesNotMatch(combined,/2、全残保险金/);
  const separate=responsibilityLines({benefits:[death,{...disability,scenarios:[
    {...disability.scenarios[0],amount:'已交保险费的2倍'},disability.scenarios[1],
  ]}]}).join('\n');
  assert.match(separate,/2、全残保险金/);
});

test('policy detail shows contract number, short company and a compact footer', async () => {
  const {workbook}=buildPolicyOrganizerWorkbook({customer:{name:'测试客户'},preparedOn:'2026-11-10',records:[{
    name:'健康无忧重大疾病保险',insuredName:'测试客户',policyNumber:'000123456789',
    company:'新华人寿保险股份有限公司',premium:'保费2490元',basicSumInsured:'10万元',
    benefits:[{name:'身故保险金',amount:'基本保险金额10万元'}],
  }]});
  const sheet=workbook.getWorksheet('家庭保单整理');
  assert.equal(sheet.getCell('I8').value,'保额');
  assert.equal(sheet.getCell('J8').value,'保费');
  assert.equal(sheet.getCell('K8').value,'保险责任');
  assert.match(sheet.getCell('E9').value,/健康无忧重大疾病保险\n合同编号：000123456789/);
  assert.equal(sheet.getCell('P9').value,'新华人寿');
  assert.match(sheet.getCell('K9').value,/身价金/);
  assert.doesNotMatch(sheet.getCell('K9').value,/身故保险金/);
  assert.equal(sheet.getCell('I9').value,'10万元');
  assert.equal(sheet.getCell('J9').value,'保费2490元');
  assert.equal(sheet.getCell('A10').value,'已识别年交保费小计');
  assert.doesNotMatch(String(sheet.getCell('E10').value),/只统计|频率未明/);
  assert.equal(sheet.getCell('A11').value,null);
  assert.equal(sheet.pageSetup.printArea,'A1:P10');
  const reopened=new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(reopened.getWorksheet('家庭保单整理').getCell('P9').value,'新华人寿');
});

test('overview separates shared medical cap, death benefit and independent accident cover', () => {
  const critical=policyCoverageAmounts({name:'某重大疾病保险',insuranceType:'重大疾病保险',basicSumInsured:'100,000元（基本保险金额）',
    benefits:[{name:'身故保险金',amount:'基本保险金额（本单10万元）或实交保费的1.1倍',summary:'因意外身故按条款给付'}]});
  assert.equal(critical.critical,100000);
  assert.equal(critical.life,100000);
  assert.equal(critical.accidentAmount,100000);
  const scenarioDeath=policyCoverageAmounts({name:'某重大疾病保险',basicSumInsured:'10万元',benefits:[
    {name:'身故保险金',amount:'基本保额或已交保费',summary:'给付后合同终止',scenarios:[
      {trigger:'因意外身故',amount:'基本保额',evidenceVerified:true},
    ]},
  ]});
  assert.equal(scenarioDeath.accidentAmount,100000);
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
    {id:1,policy_name:'甲重大疾病保险',policy_number:'000123456789',insurance_type:'重大疾病保险',insured_name:'测试客户',basic_sum_insured:{amount:'100,000元'},verified:true,contract_status:'active'},
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
  assert.match(overview.getCell('E9').value,/合同编号：000123456789/);
  assert.ok(overview.getColumn('I').width>=15);
  assert.ok(overview.getColumn('M').width>=17);
  exporter.policyOrganizerDiagnosisModel=async()=>({results:[{index:0,points:[
    '已有重疾和住院医疗保障。','家庭身故兜底仍需结合家庭责任考虑。']} ]});
  const diagnosed=await exporter.exportPolicyOrganizer(1,{withDiagnosis:true});
  const diagnosedBook=new ExcelJS.Workbook();
  await diagnosedBook.xlsx.load(diagnosed.buffer);
  assert.match(diagnosedBook.getWorksheet('家庭保单整理').getCell('A5').value,/诊断建议：\n1\. 已有重疾和住院医疗保障。/);
});

test('expired cover is visible as a historical contract amount', async () => {
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户',phone:''}]
    :sql.includes('FROM policies')?[{id:1,policy_name:'某医疗保险',insurance_type:'医疗保险',insured_name:'测试客户',
      basic_sum_insured:{amount:'4,000,000元'},effective_date:'2021-07-18',expiry_date:'2022-07-17'}]:[]})};
  const result=await exporter.exportPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const cell=workbook.getWorksheet('家庭保单整理').getCell('M4');
  assert.equal(cell.value,4000000);
  assert.equal(cell.font.color.argb,'FF6E7772');
  assert.match(String(cell.note),/原保期已过/);
  exporter.policyOrganizerDiagnosisModel=async()=>({results:[{index:0,points:[
    '已有住院医疗保障。','当前资料未见重疾和家庭身故兜底配置。']} ]});
  const diagnosed=await exporter.exportPolicyOrganizer(1,{withDiagnosis:true});
  const diagnosedBook=new ExcelJS.Workbook();
  await diagnosedBook.xlsx.load(diagnosed.buffer);
  const diagnosedSheet=diagnosedBook.getWorksheet('家庭保单整理');
  assert.equal(diagnosedSheet.getCell('M4').font.color.argb,'FF167A65');
  assert.doesNotMatch(String(diagnosedSheet.getCell('M4').note),/原保期已过|待核/);
});

test('unverified cover is visible in the overview with a pending status', async () => {
  const exporter=new PolicyOrganizerExportOperations();
  exporter.db={query:async(sql)=>({rows:sql.includes('FROM customers')?[{id:1,name:'测试客户',phone:''}]
    :sql.includes('FROM policies')?[{id:1,policy_name:'某重大疾病保险',insurance_type:'重大疾病保险',insured_name:'测试客户',
      basic_sum_insured:{amount:'100,000元'},verified:false,contract_status:'unknown',effective_date:'2020-01-01'}]:[]})};
  const result=await exporter.exportPolicyOrganizer(1);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);
  const overview=workbook.getWorksheet('家庭保单整理');
  assert.equal(overview.getCell('I4').value,100000);
  assert.equal(overview.getCell('I4').font.color.argb,'FFAA6B17');
  assert.match(String(overview.getCell('I4').note),/状态待核/);
  assert.match(String(overview.getCell('I9').value),/100,000/);
});

test('confirmed and pending amounts stay separate when both exist', () => {
  const {workbook}=buildPolicyOrganizerWorkbook({customer:{name:'测试客户'},preparedOn:'2026-11-10',records:[
    {name:'甲重大疾病保险',insuredName:'测试客户',basicSumInsured:'100,000元',verified:true,contractStatus:'active'},
    {name:'乙重大疾病保险',insuredName:'测试客户',basicSumInsured:'200,000元',verified:false,contractStatus:'unknown'},
  ]});
  const cell=workbook.getWorksheet('家庭保单整理').getCell('I4');
  assert.equal(cell.value,100000);
  assert.match(String(cell.note),/200,000 元，未并入/);
});

test('AI diagnosis treats provided policies as existing cover and stays concise below each member', async () => {
  const customer={name:'测试家庭',phone:'13800000000'};
  const members=[{id:1,displayName:'甲',phone:'13800000001',profile:{medicalInsuranceStatus:'employee'}},
    {id:2,displayName:'乙',phone:'13800000002',profile:{medicalInsuranceStatus:'unknown'}}];
  const records=[
    {name:'甲重大疾病保险',insuredName:'甲',insuredMemberNames:['甲'],basicSumInsured:'10万元',verified:true,contractStatus:'active'},
    {name:'乙医疗保险',insuredName:'乙',insuredMemberNames:['乙'],basicSumInsured:'200万元',verified:false,contractStatus:'unknown'},
  ];
  const snapshots=policyOrganizerMemberSnapshots({customer,members,records,preparedOn:'2026-11-10',assumeProvided:true,
    context:{mainIncomeMemberIds:[1],dependentMemberIds:[2],debtStatus:'yes'}});
  let modelInput='';
  const diagnoses=await generatePolicyOrganizerDiagnoses(snapshots,async(_instructions,input)=>{
    modelInput=input;
    return {results:[{index:0,points:['已有重疾保障。','医疗和家庭身故兜底尚未见配置。','可结合家庭责任安排保障。']},
      {index:1,points:['已有住院医疗保障。','重疾和意外保障仍有空白。']}]};
  });
  assert.doesNotMatch(modelInput,/甲|乙|1380000000/);
  assert.doesNotMatch(modelInput,/pending|expired|核实|续保/);
  assert.match(modelInput,/"住院医疗报销":\{"count":1,"amount":2000000\}/);
  assert.match(modelInput,/"mainIncome":true/);
  const {workbook}=buildPolicyOrganizerWorkbook({customer,members,records,preparedOn:'2026-11-10',diagnoses});
  const sheet=workbook.getWorksheet('家庭保单整理');
  assert.equal(sheet.getCell('A4').value,'甲');
  assert.match(sheet.getCell('A5').value,/^诊断建议：\n1\. 已有重疾保障。\n2\. 医疗/);
  assert.equal(sheet.getCell('A5').font.color.argb,'FFD22B38');
  assert.ok(sheet.getRow(5).height>=82);
  assert.equal(sheet.getCell('A6').value,'乙');
  assert.match(sheet.getCell('A7').value,/^诊断建议：\n1\. 已有住院医疗保障。/);
  assert.equal(sheet.getCell('I4').value,100000);
  assert.equal(sheet.getCell('M6').value,2000000);
  assert.equal(sheet.getCell('M6').font.color.argb,'FF167A65');
  const reopened=new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.match(reopened.getWorksheet('家庭保单整理').getCell('A7').value,/已有住院医疗保障/);
});
