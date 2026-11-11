import ExcelJS from 'exceljs';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { beijingDate } from './workbench-primitives.js';
import { normalizedPolicyName } from './policy-contract-export-facts.js';
import { loadPolicyContractLocalEvidence } from './policy-contract-local-evidence.js';
import { responsibilityBlocks } from './policy-responsibility-format.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const parseJson = (value,fallback=null) => {
  if (value && typeof value==='object') return value;
  if (typeof value==='string') { try { return JSON.parse(value); } catch { return fallback; } }
  return fallback;
};
const cleanText = (value,max=5000) => {
  const text=String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const nonempty = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values.map((value)=>nonempty(value)).filter(Boolean))];
const filenameSafe = (value) => String(value || '客户').replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_').slice(0,60);
const cleanMultilineText = (value,max=4000) => {
  const result=String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,' ')
    .split(/\r?\n/).map((line)=>line.replace(/[ \t]+/g,' ').trim()).filter(Boolean).join('\n').slice(0,max);
  return /^[=+\-@]/.test(result) ? `'${result}` : result;
};
const displayProductName = (value) => nonempty(value)
  .replace(/(?:[，,\n\s]*)合同(?:编号|号码|号)\s*[:：]?\s*[A-Za-z0-9-]{6,40}[\s\S]*$/i,'')
  .replace(/\s*[（(](?:原合同待核对|已整理待核对|整理未完成|待核实|已核实)[）)]\s*$/,'');
const shortCompanyName = (value) => {
  const name=nonempty(value);
  if (/新华/.test(name)) return '新华人寿';
  if (/平安/.test(name)) return '中国平安';
  if (/中国人寿|国寿/.test(name)) return '中国人寿';
  return name.replace(/保险(?:股份)?有限公司$|保险有限责任公司$|股份有限公司$|有限责任公司$/,'');
};

export function preferDetailedPremium(stored,fromContract,fromAi='') {
  if (/(每年|年交|年缴|每月|月交|一次交清|趸交)/.test(stored)) return stored;
  const amount=(value)=>String(value || '').match(/[\d,]+(?:\.\d+)?/g)?.at(-1)?.replaceAll(',','');
  for (const candidate of [fromAi,fromContract]) {
    if (!candidate || !/(每年|年交|年缴|每月|月交|一次交清|趸交)/.test(candidate)) continue;
    if (!stored || amount(stored)===amount(candidate)) return candidate;
    const currencyParts=[...String(candidate).matchAll(/(?:RMB|人民币|[￥¥])\s*([\d,]+(?:\.\d{1,2})?)/gi)]
      .map((match)=>Number(match[1].replaceAll(',','')));
    const annualParts=currencyParts.length>1 ? currencyParts : [...String(candidate).matchAll(/(?:每年|年交|年缴)[^\d]{0,15}([\d,]+(?:\.\d{1,2})?)/g)]
      .map((match)=>Number(match[1].replaceAll(',','')));
    const storedAmount=Number(amount(stored));
    if (annualParts.length>1 && annualParts.every(Number.isFinite) &&
        Number.isFinite(storedAmount) && Math.abs(annualParts.reduce((sum,value)=>sum+value,0)-storedAmount)<0.01) {
      return `每年${storedAmount.toFixed(2)}元（主附险合计）`;
    }
  }
  return stored || fromAi || fromContract || '';
}

function dateText(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0,10);
  const text=String(value).trim();
  const match=text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || text;
}

function basicSumInsured(policy={},localFacts={}) {
  const value=parseJson(policy.basic_sum_insured,null) || parseJson(policy.basicSumInsured,null) ||
    parseJson(localFacts.basicSumInsured,null) || parseJson(policy.basic_sum_insured_fact,null);
  if (!value || typeof value!=='object') return '';
  const amount=nonempty(value.amount);
  if (!amount) return '';
  const label=nonempty(value.label);
  return `${amount}${label ? `（${label}）` : ''}`;
}

export function normalizeBenefits(extraction) {
  return (Array.isArray(extraction?.benefits) ? extraction.benefits : []).map((item)=>({
    name:nonempty(item?.name),amount:nonempty(item?.amount),paymentMethod:nonempty(item?.paymentMethod),
    summary:nonempty(item?.summary),conditions:nonempty(item?.conditions),page:item?.page == null ? '' : String(item.page),
    scenarios:Array.isArray(item?.scenarios)?item.scenarios.filter((scenario)=>scenario?.evidenceVerified && nonempty(scenario.amount)):[],
  })).filter((item)=>{
    const name=item.name;
    if (!name || /理赔申请|申请材料|申请资料|受益人指定|报案流程|索赔流程/.test(name)) return false;
    if (/^(?:轻症疾病保险金|重大疾病保险金)[-—－：:]/.test(name)) return false;
    if (!/保险金|给付|豁免|津贴|补偿|返还|年金|领取|报销|医疗责任|医疗费用|身故责任|祝寿金|满期金|生存金/.test(name)) return false;
    if (/申请书|提交.*资料|证明和资料|受益人.*指定|给付情形与金额待对照原合同核对/.test(item.summary)) return false;
    return Boolean(item.amount || item.scenarios.length || item.summary || item.paymentMethod);
  });
}

export function combinedBenefits(local=[],extracted=[]) {
  if (!local.length) {
    const merged=[];
    for (const item of extracted) {
      const name=nonempty(item.name).replace(/\s+/g,'');
      const existing=merged.find((candidate)=>nonempty(candidate.name).replace(/\s+/g,'')===name &&
        (!candidate.amount || !item.amount || candidate.amount===item.amount));
      if (!existing) { merged.push({...item,scenarios:[...(item.scenarios || [])]}); continue; }
      for (const field of ['amount','summary','paymentMethod','conditions']) if (!existing[field] && item[field]) existing[field]=item[field];
      for (const scenario of item.scenarios || []) if (!existing.scenarios.some((saved)=>
        `${saved.trigger}|${saved.amount}|${saved.page}`===`${scenario.trigger}|${scenario.amount}|${scenario.page}`)) existing.scenarios.push(scenario);
    }
    return merged;
  }
  const name=(item)=>nonempty(item.name).replace(/\s+/g,'');
  return [...local.map((item)=>{
    const scenarios=[...(item.scenarios || [])];
    if (!scenarios.length) for (const matching of extracted.filter((candidate)=>name(candidate)===name(item))) {
      for (const scenario of matching.scenarios || []) if (!scenarios.some((existing)=>
        existing.trigger===scenario.trigger && existing.amount===scenario.amount)) scenarios.push(scenario);
    }
    return {...item,scenarios};
  }),...[...new Map(extracted.filter((item)=>!local.some((candidate)=>name(candidate)===name(item)))
    .map((item)=>[`${name(item)}|${nonempty(item.amount)}`,item])).values()]];
}

function explicitAnnualPremium(value) {
  const text=String(value || '').replace(/[，,]/g,'');
  if (!/(每年|年交|年缴|年付|按年|\/年|元\/年)/.test(text)) return null;
  const patterns=[
    /(?:每年|年交|年缴|年付|按年)[^\d¥￥]{0,8}[¥￥]?\s*(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*元?\s*\/\s*年/,
    /[¥￥]\s*(\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match=text.match(pattern);
    if (match) {
      const amount=Number(match[1]);
      if (Number.isFinite(amount) && amount>=0) return amount;
    }
  }
  return null;
}

function formatCoveragePeriod(record) {
  const policy=record.extraction?.policy || {};
  const effectiveDate=dateText(record.effectiveDate || policy.effectiveDate);
  const expiryDate=dateText(record.expiryDate || policy.expiryDate);
  const contractDate=dateText(record.contractDate || record.contractFacts?.contractDate || policy.contractDate);
  const coveragePeriod=nonempty(policy.coveragePeriod || record.contractFacts?.coveragePeriod);
  if (effectiveDate && expiryDate) return `${effectiveDate} 至 ${expiryDate}`;
  if (effectiveDate && /终身|终生/.test(coveragePeriod)) return `${effectiveDate} 起，${coveragePeriod}`;
  if (effectiveDate) return `${effectiveDate} 起${coveragePeriod ? `，${coveragePeriod}` : ''}`;
  if (expiryDate) return `至 ${expiryDate}`;
  if (contractDate) return `合同成立：${contractDate}${coveragePeriod ? `；保障期限：${coveragePeriod}` : ''}`;
  return coveragePeriod;
}

function formatPaymentTerm(record) {
  const policy=record.extraction?.policy || {};
  const term=nonempty(record.paymentTerm || policy.paymentTerm);
  const endDate=dateText(record.paymentEndDate || record.contractFacts?.paymentEndDate || policy.paymentEndDate);
  if (term && endDate) return `${term}；交费期满：${endDate}`;
  if (endDate) return `交费期满：${endDate}`;
  return term;
}

const COVERAGE_COLUMNS={critical:'I',life:'J',accidentAmount:'K',accidentMedical:'L',hospitalization:'M',allowance:'N',financial:'O'};
const COVERAGE_LABELS={critical:'重疾',life:'身故责任',accidentAmount:'意外身故/伤残',accidentMedical:'意外门急诊',hospitalization:'住院医疗报销',allowance:'住院津贴',financial:'增额终身寿/年金'};
const moneyValue=(value)=>{
  const matches=[...String(value || '').replaceAll(',','').matchAll(/(\d+(?:\.\d+)?)\s*(万元|万|元)/g)];
  if (matches.length!==1) return null;
  const amount=Number(matches[0][1])*(matches[0][2]==='元'?1:10_000);
  return Number.isFinite(amount) && amount>0 ? amount : null;
};
const benefitNamed=(benefits,pattern)=>benefits.find((benefit)=>pattern.test(nonempty(benefit.name)));
const benefitAmount=(benefit)=>moneyValue(benefit?.amount);
const isCoverageDate=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(value);

function coverageTiming(record,asOfDate) {
  const effective=dateText(record.effectiveDate || record.contractFacts?.effectiveDate);
  const expiry=dateText(record.expiryDate || record.contractFacts?.expiryDate);
  if (['terminated','suspended','expired'].includes(record.contractStatus)) return 'expired';
  if (isCoverageDate(expiry) && expiry<asOfDate) return 'expired';
  if (isCoverageDate(effective) && effective>asOfDate) return 'future';
  if (record.verified===false || record.contractStatus && record.contractStatus!=='active') return 'pending';
  return 'current';
}

export function policyOrganizerMemberSnapshots({customer,records,preparedOn,members=null,context=null,assumeProvided=false}) {
  const insuredNames=unique(records.map((record)=>record.insuredName));
  const names=members ? members.map((member)=>member.displayName || member.name)
    : unique([customer.name,...insuredNames]);
  return names.map((name,index)=>{
    const byStatus={current:[],pending:[],expired:[],future:[]};
    for (const record of records) {
      const targets=Array.isArray(record.insuredMemberNames)
        ? record.insuredMemberNames.length===1?record.insuredMemberNames:[]
        : [nonempty(record.insuredName)];
      if (targets.includes(name)) byStatus[assumeProvided?'current':coverageTiming(record,preparedOn)].push(policyCoverageAmounts(record));
    }
    const categories=Object.fromEntries(Object.keys(COVERAGE_COLUMNS).map((category)=>[
      category,Object.fromEntries(Object.entries(byStatus).map(([status,amounts])=>[status,{
        count:amounts.filter((item)=>Object.hasOwn(item,category)).length,
        amount:amounts.reduce((sum,item)=>sum+(Number.isFinite(item[category])&&item[category]>0?item[category]:0),0),
      }])),
    ]));
    const member=members?.[index];
    return {index,name,byStatus,categories,policyCount:Object.values(byStatus).reduce((sum,items)=>sum+items.length,0),
      medicalInsuranceStatus:member?.profile?.medicalInsuranceStatus || (name===customer.name?customer.profile?.medicalInsuranceStatus:'') || 'unknown',
      mainIncome:Boolean(member ? context?.mainIncomeMemberIds?.includes(member.id) : name===customer.name && customer.profile?.incomeResponsibility==='primary'),
      hasDependents:Boolean(member ? context?.dependentMemberIds?.length : name===customer.name && customer.profile?.dependentCount>0),
      debtStatus:context?.debtStatus || (name===customer.name?customer.profile?.mortgageStatus:'') || 'unknown'};
  });
}

const DIAGNOSIS_INSTRUCTIONS=`你是保险顾问工作台的保单整理助手。根据匿名化的保单摘要，为每位被保险人写2至3条简短的中文诊断建议。返回严格 JSON：{"results":[{"index":0,"points":["已有保障概况","主要保障缺口","下一步建议"]}]}。每条尽量控制在25至55字，不加序号、不换行；第三条没有有用内容时只写两条。
第1条概括现有保障，第2条指出最重要的保障缺口，第3条可写具体服务动作或长期资金安排。重点看住院医疗费用补偿、重疾、意外和身故兜底；主要收入者还要考虑家庭责任。增额终身寿与年金属于长期资金安排，不代替医疗或重疾保障。
按用户约定，本次纳入的保单都作为现有配置；不要讨论核实状态、有效性、到期或续保。没有记录只说“当前保单资料未见该项保障”，不要断言客户现实中没有保障。重疾险身故与意外身故可能共用一份金额，不能相加；医疗年度限额与给付型保额也不能相加。不要照抄示例中的税优、养老金、体检或产品优劣判断；输入没有相应事实时不能写。不要推销产品、给精确投保额度或编造家庭收入、健康状况、医保状态和赔付结论。只依据输入事实，不输出姓名。`;

export async function generatePolicyOrganizerDiagnoses(snapshots,callModel) {
  const diagnoses=new Map();
  for (let start=0;start<snapshots.length;start+=4) {
    const group=snapshots.slice(start,start+4);
    const input={members:group.map((snapshot)=>({index:snapshot.index,policyCount:snapshot.policyCount,
      medicalInsuranceStatus:snapshot.medicalInsuranceStatus,mainIncome:snapshot.mainIncome,
      hasDependents:snapshot.hasDependents,debtStatus:snapshot.debtStatus,
      categories:Object.fromEntries(Object.entries(snapshot.categories).map(([key,statuses])=>[
        COVERAGE_LABELS[key],statuses.current,
      ]))}))};
    const result=await callModel(DIAGNOSIS_INSTRUCTIONS,JSON.stringify(input),90_000,{thinking:'disabled',maxTokens:1400});
    if (!Array.isArray(result?.results)) throw new ServiceUnavailableException('AI 未返回完整的保障诊断，请稍后重试');
    for (const snapshot of group) {
      const matches=result.results.filter((item)=>item?.index===snapshot.index);
      const points=matches[0]?.points;
      if (matches.length!==1 || !Array.isArray(points) || points.length<2 || points.length>3) {
        throw new ServiceUnavailableException('AI 诊断结果不完整，请稍后重试');
      }
      if (points.some((point)=>typeof point!=='string')) throw new ServiceUnavailableException('AI 诊断内容不完整，请稍后重试');
      const cleaned=points.map((point)=>nonempty(point).replace(/^[①②③1-3][.、．\s]*/,'').replace(/[\r\n]+/g,' ').trim());
      if (cleaned.some((point)=>point.length<6 || point.length>100)) throw new ServiceUnavailableException('AI 诊断内容不完整，请稍后重试');
      diagnoses.set(snapshot.name,cleaned);
    }
  }
  return diagnoses;
}

// One policy contributes at most once to each column. Named sub-benefits that
// share an annual cap or the same basic sum insured are never added together.
export function policyCoverageAmounts(record) {
  const product=displayProductName(record.name || record.extraction?.policy?.productName || record.contractFacts?.productName);
  const type=nonempty(record.insuranceType || record.extraction?.policy?.insuranceType);
  const benefits=record.benefits || [];
  const basic=moneyValue((record.basicSumInsured && typeof record.basicSumInsured==='object'
    ? record.basicSumInsured.amount : record.basicSumInsured) || basicSumInsured(record,record.localFacts));
  const medicalProduct=/医疗|住院|费用补偿/.test(`${product} ${type}`);
  const criticalProduct=/重疾|重大疾病|中症|轻症/.test(`${product} ${type}`) && !medicalProduct;
  const lifeProduct=/终身寿|定期寿|寿险/.test(`${product} ${type}`) && !criticalProduct && !medicalProduct;
  const financialProduct=/增额.{0,8}终身寿|年金/.test(`${product} ${type}`);
  const accidentProduct=/意外(?:伤害|身故|伤残)(?:保险|险)/.test(product) && !medicalProduct;
  const result={};

  if (criticalProduct || benefitNamed(benefits,/^(?:轻症|中症|重疾|重大疾病).*保险金$/)) result.critical=basic;
  const death=benefitNamed(benefits,/^(?!意外)(?:身故|死亡).*保险金$/);
  if (lifeProduct) result.life=basic || benefitAmount(death);
  else if (death && !financialProduct) result.life=benefitAmount(death) || (criticalProduct ? basic : null);
  const accidentDeath=benefitNamed(benefits,/^意外(?:身故|伤残|伤害).*保险金$/);
  const deathEvidence=[death?.summary,death?.conditions,...(death?.scenarios || []).flatMap((scenario)=>[scenario.trigger,scenario.amount])]
    .map(nonempty).join(' ');
  const deathCoversAccident=death && /因意外|意外伤害原因/.test(deathEvidence) &&
    !/因意外.{0,12}(?:不赔|不承担|除外)/.test(deathEvidence) &&
    /基本保额|基本保险金额|\d+(?:\.\d+)?\s*(?:万元|万|元)/.test(nonempty(death.amount));
  if (accidentProduct || accidentDeath || deathCoversAccident) {
    result.accidentAmount=benefitAmount(accidentDeath) || (accidentProduct ? basic : null) ||
      (deathCoversAccident ? benefitAmount(death) || basic : null);
  }
  const accidentOutpatient=benefitNamed(benefits,/^意外.*(?:门急诊|门诊|医疗费用).*保险金$/);
  if (accidentOutpatient || /意外.*(?:门急诊|门诊)医疗/.test(product)) {
    result.accidentMedical=benefitAmount(accidentOutpatient) || (/意外.*(?:门急诊|门诊)医疗/.test(product) ? basic : null);
  }
  const totalMedical=benefitNamed(benefits,/^年度总给付上限$/);
  const inpatientBenefits=benefits.filter((benefit)=>/^(?:住院|一般医疗|特定疾病医疗).*费用保险金$/.test(nonempty(benefit.name)));
  if (medicalProduct || inpatientBenefits.length) result.hospitalization=benefitAmount(totalMedical) || (medicalProduct ? basic : null)
    || (inpatientBenefits.length===1 ? benefitAmount(inpatientBenefits[0]) : null);
  const allowance=benefitNamed(benefits,/^(?:住院|重症监护).*?(?:津贴|日额).*保险金$/);
  if (allowance) {
    result.allowance=benefitAmount(allowance);
    if (result.allowance && /每天|每日|每住院日|元\s*\/\s*(?:日|天)/.test(`${allowance.amount} ${allowance.summary}`)) result.allowanceBasis='daily';
  }
  // Product identity, not a mention of dividends or a death benefit, decides
  // whether this is an accumulating whole-life or annuity product.
  if (financialProduct) result.financial=basic;
  return result;
}

function styleCell(cell,{fill,fontColor='FF24332D',bold=false,size=10,align='center',wrap=true}={}) {
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};
  cell.font={name:'PingFang SC',size,bold,color:{argb:fontColor}};
  cell.alignment={horizontal:align,vertical:'middle',wrapText:wrap};
  cell.border={
    top:{style:'thin',color:{argb:'FFD8E2DC'}},bottom:{style:'thin',color:{argb:'FFD8E2DC'}},
    left:{style:'thin',color:{argb:'FFD8E2DC'}},right:{style:'thin',color:{argb:'FFD8E2DC'}},
  };
}

function applyMergedStyle(sheet,range,options) {
  sheet.mergeCells(range);
  const [start]=range.split(':');
  styleCell(sheet.getCell(start),options);
}

function setMerged(sheet,range,value,options) {
  applyMergedStyle(sheet,range,options);
  const [start]=range.split(':');
  sheet.getCell(start).value=cleanText(value,4000);
}

export function buildPolicyOrganizerWorkbook({customer,records,preparedOn,members=null,diagnoses=null}) {
  const insuredNames=unique(records.map((record)=>record.insuredName));
  const allMemberNames=members ? members.map((member)=>member.displayName || member.name) : unique([customer.name,...insuredNames]);
  const memberRows=allMemberNames;
  const overviewRows=Math.max(3,memberRows.length*(diagnoses?2:1));
  const overviewNoteRow=4+overviewRows;
  const policyHeaderRow=overviewNoteRow+1;
  const firstPolicyRow=policyHeaderRow+1;
  const workbook=new ExcelJS.Workbook();
  workbook.creator='保险顾问工作台';
  workbook.subject='客户保单整理';
  workbook.title='家庭保单整理诊断分析卡';
  workbook.created=new Date();
  workbook.modified=new Date();
  const sheet=workbook.addWorksheet('家庭保单整理',{views:[{state:'frozen',ySplit:policyHeaderRow,showGridLines:false}]});
  sheet.properties.defaultRowHeight=25;
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.25,right:0.25,top:0.35,bottom:0.35,header:0.15,footer:0.15}};
  sheet.headerFooter.oddFooter='&L家庭保单整理&C第 &P 页，共 &N 页';
  sheet.columns=[3,12,12,14,11,12,15,12,15,16,15,16,17,16,16,17].map((width)=>({width}));
  const ink='FF24332D',teal='FF167A65',red='FFC81742',pale='FFF4E6EA',soft='FFF4F7F4',white='FFFFFFFF',muted='FF63746C';
  const overviewStatusStyle={
    current:{label:diagnoses?'已纳入':'已核实有效',color:teal,fill:white},
    pending:{label:'状态待核',color:'FFAA6B17',fill:'FFFFF7E8'},
    expired:{label:'原保期已过',color:'FF6E7772',fill:'FFF3F5F3'},
    future:{label:'尚未生效',color:'FF477D99',fill:'FFF0F6FA'},
  };

  applyMergedStyle(sheet,'A1:P1',{fill:red,fontColor:white,bold:true,size:22});
  sheet.getCell('A1').value='家庭保单整理诊断分析卡';
  sheet.getRow(1).height=48;
  setMerged(sheet,'A2:G2',`客户：${customer.name}`,{fill:white,fontColor:ink,bold:true,size:11,align:'left'});
  setMerged(sheet,'H2:J2',`整理时间：${preparedOn}`,{fill:white,fontColor:ink,size:10});
  setMerged(sheet,'K2:L2','整理人：未记录',{fill:white,fontColor:muted,size:9});
  setMerged(sheet,'M2:P2','服务电话：未记录',{fill:white,fontColor:muted,size:9});
  sheet.getRow(2).height=31;

  const memberHeaders=[
    ['A3:C3','家庭成员'],['D3','性别'],['E3:F3','出生日期'],['G3','联系方式'],['H3','职业'],
    ['I3','重疾'],['J3','寿险身价'],['K3','意外身价'],['L3','意外门急诊'],['M3','住院报销'],['N3','住院津贴'],['O3:P3','理财'],
  ];
  for (const [range,label] of memberHeaders) {
    if (range.includes(':')) setMerged(sheet,range,label,{fill:pale,fontColor:ink,bold:true,size:9});
    else { const cell=sheet.getCell(range);styleCell(cell,{fill:pale,fontColor:ink,bold:true,size:9});cell.value=label; }
  }
  const snapshots=policyOrganizerMemberSnapshots({customer,records,preparedOn,members,assumeProvided:Boolean(diagnoses)});
  for (let offset=0;offset<overviewRows;offset++) {
    const row=4+offset;
    const snapshot=snapshots[diagnoses?Math.floor(offset/2):offset];
    const isDiagnosisRow=Boolean(diagnoses && offset%2===1 && snapshot);
    if (isDiagnosisRow) {
      const points=diagnoses.get(snapshot.name);
      if (!Array.isArray(points) || points.length<2) throw new ServiceUnavailableException('AI 诊断结果不完整，请稍后重试');
      const lines=['诊断建议：',...points.map((point,index)=>`${index+1}. ${point}`)];
      applyMergedStyle(sheet,`A${row}:P${row}`,{fill:white,fontColor:'FFD22B38',bold:true,size:11,align:'left'});
      sheet.getCell(`A${row}`).value=cleanMultilineText(lines.join('\n'),600);
      const visualLines=lines.reduce((total,line)=>total+Math.max(1,Math.ceil([...line].reduce((width,char)=>width+(/[\u0000-\u00ff]/.test(char)?1:2),0)/175)),0);
      sheet.getRow(row).height=Math.min(180,Math.max(82,12+visualLines*21));
      continue;
    }
    const name=snapshot?.name || '';
    const memberAmounts=snapshot?.byStatus || {current:[],pending:[],expired:[],future:[]};
    for (const range of [`A${row}:C${row}`,`E${row}:F${row}`,`O${row}:P${row}`]) applyMergedStyle(sheet,range,{fill:white,fontColor:ink,size:9});
    for (let column=1;column<=16;column++) {
      if (sheet.getCell(row,column).isMerged) continue;
      styleCell(sheet.getCell(row,column),{fill:white,fontColor:ink,size:9});
    }
    sheet.getCell(`A${row}`).value=cleanText(name,100);
    const personRecords=records.filter((record)=>Array.isArray(record.insuredMemberNames)
      ? record.insuredMemberNames.length===1 && record.insuredMemberNames[0]===name
      : record.insuredName===name);
    const sexes=unique(personRecords.map((record)=>record.insuredSex));
    const births=unique(personRecords.map((record)=>record.insuredBirthDate));
    sheet.getCell(`D${row}`).value=sexes.length===1 ? sexes[0] : '';
    sheet.getCell(`E${row}`).value=births.length===1 ? births[0] : '';
    if (births.length===1) sheet.getCell(`E${row}`).note='依据原合同载明、校验通过的身份证号推得出生日期；请与客户核对。';
    sheet.getCell(`G${row}`).value=members
      ? cleanText(members.find((member)=>(member.displayName || member.name)===name)?.phone || '',40)
      : name===customer.name ? cleanText(customer.phone || '',40) : '';
    for (const [category,column] of Object.entries(COVERAGE_COLUMNS)) {
      const cell=sheet.getCell(`${column}${row}`);
      const entries=memberAmounts.current.filter((amounts)=>Object.hasOwn(amounts,category));
      const pending=memberAmounts.pending.filter((amounts)=>Object.hasOwn(amounts,category));
      const expired=memberAmounts.expired.filter((amounts)=>Object.hasOwn(amounts,category));
      const future=memberAmounts.future.filter((amounts)=>Object.hasOwn(amounts,category));
      const knownByStatus={current:entries,pending,expired,future};
      for (const status of Object.keys(knownByStatus)) knownByStatus[status]=knownByStatus[status]
        .filter((amounts)=>Number.isFinite(amounts[category]) && amounts[category]>0);
      const displayStatus=['current','pending','expired','future'].find((status)=>knownByStatus[status].length);
      const displayed=displayStatus ? knownByStatus[displayStatus] : [];
      const bases=new Set(displayed.map((amounts)=>category==='allowance' && amounts.allowanceBasis==='daily'?'daily':'total'));
      if (displayed.length && bases.size===1) {
        cell.value=displayed.reduce((sum,amounts)=>sum+amounts[category],0);
        const showCents=!Number.isInteger(cell.value);
        cell.numFmt=bases.has('daily')
          ? (showCents?'#,##0.00"元/日"':'#,##0"元/日"')
          : (showCents?'#,##0.00"元"':'#,##0"元"');
        cell.font={name:'PingFang SC',size:9,bold:true,color:{argb:overviewStatusStyle[displayStatus].color}};
        cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:overviewStatusStyle[displayStatus].fill}};
      }
      if (entries.length || pending.length || expired.length || future.length) {
        const notes=[displayStatus
          ? `显示 ${knownByStatus[displayStatus].length} 份${overviewStatusStyle[displayStatus].label}的合同载明金额。`
          : '当前相关合同未识别到可计金额。'];
        for (const status of ['current','pending','expired','future']) {
          if (status===displayStatus || !knownByStatus[status].length) continue;
          const subtotal=knownByStatus[status].reduce((sum,amounts)=>sum+amounts[category],0);
          notes.push(`另有 ${knownByStatus[status].length} 份${overviewStatusStyle[status].label}的合同，金额合计 ${subtotal.toLocaleString('zh-CN')} 元，未并入本格显示值。`);
        }
        if (pending.length) notes.push('待核金额不代表当前已确认有效保障；请核对合同状态、被保险人和给付条件。');
        if (expired.length) notes.push('原保期已过的金额为历史合同载明值；请核对续保后再判断当前保障。');
        if (future.length) notes.push('尚未生效的金额不代表当前保障。');
        if (category==='life') notes.push('本列包含重疾险附带的身故责任，并非均为独立寿险；实际身故给付可能随等待期、既往理赔等条件变化，此处仅按合同基本保额或明确金额列示。');
        if (category==='accidentAmount') notes.push('含因意外身故可给付的普通身故责任，与“寿险身价”可能是同一份保额，不可相加；有条件的额外关爱金未计入基本保额。');
        if (category==='hospitalization') notes.push('住院报销按合同年度共用上限或明确的住院医疗限额计一次，分项限额不叠加。');
        if (category==='financial') notes.push('仅包含增额终身寿或年金产品的明确基本保额；不把现金价值、演示分红或未来领取额相加。');
        if (bases.size>1) notes.push('同时存在每日津贴和一次性金额，口径不同，未合并。');
        cell.note=notes.join('\n');
      }
    }
    sheet.getRow(row).height=28;
  }

  const overviewNote=diagnoses
    ? `${members?'家庭成员逐人列示；多人共用限额或归属未明确的合同不计入个人金额。':''}按本次纳入的保单列示已有配置；不同保障类别的金额不能相加，空白表示当前资料未记录。`
    : `${members?'家庭成员逐人列示；多人共用限额或归属未确认的合同不计入个人金额。':''}绿色：已核实有效；橙色：状态待核；灰色：原保期已过；蓝色：尚未生效。只显示一种状态的金额，不跨状态或保障类别相加；空白不代表没有保障。`;
  setMerged(sheet,`A${overviewNoteRow}:P${overviewNoteRow}`,overviewNote,{fill:soft,fontColor:muted,size:9,align:'left'});
  sheet.getRow(overviewNoteRow).height=36;

  const policyHeaders=[
    [`A${policyHeaderRow}:B${policyHeaderRow}`,'投保人'],[`C${policyHeaderRow}`,'被保险人'],[`D${policyHeaderRow}`,'受益人'],[`E${policyHeaderRow}:F${policyHeaderRow}`,'险种名称'],[`G${policyHeaderRow}`,'保险期间'],
    [`H${policyHeaderRow}`,'交费期限'],[`I${policyHeaderRow}`,'保额'],[`J${policyHeaderRow}`,'保费'],[`K${policyHeaderRow}:O${policyHeaderRow}`,'保险责任'],[`P${policyHeaderRow}`,'公司'],
  ];
  for (const [range,label] of policyHeaders) {
    if (range.includes(':')) setMerged(sheet,range,label,{fill:red,fontColor:white,bold:true,size:10});
    else { const cell=sheet.getCell(range);styleCell(cell,{fill:red,fontColor:white,bold:true,size:10});cell.value=label; }
  }
  sheet.getRow(policyHeaderRow).height=34;

  const annualValues=[];
  let rowIndex=firstPolicyRow;
  records.forEach((record,index)=>{
    const [responsibility]=responsibilityBlocks(record);
    if (responsibility.text.length>32000) throw new BadRequestException('单份保单的保险责任超过 Excel 单元格可容纳的文字上限，请先精简责任描述。');
    for (const range of [`A${rowIndex}:B${rowIndex}`,`E${rowIndex}:F${rowIndex}`,`K${rowIndex}:O${rowIndex}`]) applyMergedStyle(sheet,range,{fill:index%2?'FFF9FBF9':white,fontColor:ink,size:9,align:'left'});
    for (let column=1;column<=16;column++) {
      if (sheet.getCell(rowIndex,column).isMerged) continue;
      styleCell(sheet.getCell(rowIndex,column),{fill:index%2?'FFF9FBF9':white,fontColor:ink,size:9,align:column===11?'left':'center'});
    }
    const productName=displayProductName(record.name || record.extraction?.policy?.productName || record.contractFacts?.productName || '未识别产品');
    const policyNumber=nonempty(record.policyNumber || record.contractFacts?.policyNumber);
    const premium=record.premium || record.extraction?.policy?.premium || '';
    const annual=explicitAnnualPremium(premium);
    if (annual!==null) annualValues.push(annual);
    const extraction=record.extraction || {};
    const coverageAmount=record.basicSumInsured || basicSumInsured(extraction.policy) || basicSumInsured({},record.localFacts);
    const values={
      [`A${rowIndex}`]:record.holderName || '',[`C${rowIndex}`]:record.insuredName || '',[`D${rowIndex}`]:record.beneficiary || '',
      [`E${rowIndex}`]:policyNumber?`${productName}\n合同编号：${policyNumber}`:productName,[`G${rowIndex}`]:formatCoveragePeriod(record),
      [`H${rowIndex}`]:formatPaymentTerm(record),
      [`I${rowIndex}`]:coverageAmount,[`J${rowIndex}`]:premium,[`K${rowIndex}`]:responsibility.text,
      [`P${rowIndex}`]:shortCompanyName(record.company || extraction.policy?.company || ''),
    };
    for (const [address,value] of Object.entries(values)) sheet.getCell(address).value=address.startsWith('E') || address.startsWith('K') ? cleanMultilineText(value,address.startsWith('K')?32000:4000) : cleanText(value,500);
    sheet.getRow(rowIndex).height=Math.max(responsibility.height,policyNumber?78:0);
    const responsibilityCell=sheet.getCell(`K${rowIndex}`);
    responsibilityCell.font={name:'PingFang SC',size:responsibility.fontSize,color:{argb:ink}};
    responsibilityCell.alignment={horizontal:'left',vertical:'top',wrapText:true};
    if (responsibility.overflow) responsibilityCell.note=`保险责任已完整保存在本单元格。内容较长时，请单击单元格，在编辑栏查看全部文字。\n\n${responsibility.text}`;
    sheet.getCell(`E${rowIndex}`).font={name:'PingFang SC',size:9,bold:true,color:{argb:diagnoses||record.verified?teal:'FFB26A15'}};
    rowIndex++;
  });

  const footerRow=rowIndex;
  applyMergedStyle(sheet,`A${footerRow}:D${footerRow}`,{fill:soft,fontColor:ink,bold:true,size:10});
  applyMergedStyle(sheet,`E${footerRow}:P${footerRow}`,{fill:soft,fontColor:teal,bold:true,size:11});
  sheet.getCell(`A${footerRow}`).value='已识别年交保费小计';
  const annualTotal=annualValues.reduce((sum,value)=>sum+value,0);
  sheet.getCell(`E${footerRow}`).value=annualValues.length ? `¥${annualTotal.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})} / 年` : '未能确认';
  sheet.getRow(footerRow).height=36;
  sheet.autoFilter={from:`A${policyHeaderRow}`,to:`P${Math.max(policyHeaderRow,footerRow-1)}`};
  sheet.pageSetup.printArea=`A1:P${footerRow}`;

  return {workbook,mimeType:XLSX_MIME};
}

export class PolicyOrganizerExportOperations {
  async preparePolicyOrganizerData(customerIdValue) {
    const customerId=Number(customerIdValue);
    if (!Number.isSafeInteger(customerId) || customerId<=0) throw new BadRequestException('客户编号无效');
    const [customerResult,policyResult,contractResult,profileResult]=await Promise.all([
      this.db.query('SELECT id,name,phone FROM customers WHERE id=$1',[customerId]),
      this.db.query(`SELECT id,company,policy_name,insurance_type,policy_number,holder_name,insured_name,premium,coverage_summary,
        basic_sum_insured,verified,contract_status,effective_date,expiry_date
        FROM policies WHERE customer_id=$1 ORDER BY created_at,id`,[customerId]),
      this.db.query(`SELECT id,policy_id,file_name,storage_name,parse_status,analysis_status,extraction_data,local_facts
        FROM customer_policy_contracts WHERE customer_id=$1 AND coverage_excluded_at IS NULL ORDER BY created_at,id`,[customerId]),
      this.db.query('SELECT profile_data FROM customer_coverage_profiles WHERE customer_id=$1',[customerId]),
    ]);
    const customer=customerResult.rows[0];
    if (!customer) throw new NotFoundException('找不到这位客户');
    const incompleteContracts=contractResult.rows.filter((row)=>{
      const result=parseJson(row.extraction_data,null);
      return !['已整理','已归档'].includes(row.analysis_status) ||
        Number(result?.schemaVersion || 0)<10 || result?.completeness?.complete!==true;
    });
    if (incompleteContracts.length) throw new BadRequestException(
      `还有 ${incompleteContracts.length} 份合同未完成最新版 AI 整理，请先逐份整理，再导出 Excel。`);
    const contracts=[];
    for (const row of contractResult.rows) {
      const extraction=parseJson(row.extraction_data,null);
      const localFacts=parseJson(row.local_facts,{});
      let contractFacts={};
      let diseaseCounts={critical:null,light:null};
      if (row.parse_status!=='needs_ocr' && row.storage_name) {
        try {
          const evidence=await loadPolicyContractLocalEvidence({storageName:row.storage_name,fileName:row.file_name,parseStatus:row.parse_status});
          contractFacts={...evidence.facts,verifiedResponsibilities:evidence.benefits};
          diseaseCounts=evidence.diseaseCounts;
        } catch {
          // A missing or unreadable original does not discard saved policy facts.
        }
      }
      const contract={
        id:Number(row.id),policyId:row.policy_id ? Number(row.policy_id) : null,analysisStatus:row.analysis_status,
        extraction,localFacts,contractFacts,diseaseCounts,benefits:normalizeBenefits(extraction),
      };
      contracts.push(contract);
    }
    const usedContractIds=new Set();
    const records=policyResult.rows.map((row)=>{
      const direct=contracts.filter((item)=>item.policyId===Number(row.id));
      const matching=direct.length ? direct : contracts.filter((item)=>{
        if (item.policyId) return false;
        const extractedName=item.contractFacts.productName || item.extraction?.policy?.productName;
        const extractedDate=item.contractFacts.effectiveDate || item.extraction?.policy?.effectiveDate;
        return normalizedPolicyName(extractedName) && normalizedPolicyName(extractedName)===normalizedPolicyName(row.policy_name)
          && extractedDate && extractedDate===dateText(row.effective_date);
      });
      matching.forEach((item)=>usedContractIds.add(item.id));
      const contract=matching.find((item)=>item.extraction?.benefits?.length) || matching[0];
      const extraction=contract?.extraction || {};
      const facts=contract?.contractFacts || {};
      return {
        id:Number(row.id),sourceContractIds:matching.map((item)=>item.id),company:row.company || facts.company,name:row.policy_name || facts.productName,insuranceType:row.insurance_type,
        policyNumber:facts.policyNumber || row.policy_number || '',
        holderName:facts.holderName || row.holder_name || '',insuredName:facts.insuredName || row.insured_name || '',
        beneficiary:facts.beneficiary || '',insuredSex:facts.insuredSex || '',insuredBirthDate:facts.insuredBirthDate || '',
        premium:preferDetailedPremium(row.premium || '',facts.premium,extraction.policy?.premium || ''),
        coverageSummary:row.coverage_summary || extraction.coverageSummary || '',
        basicSumInsured:basicSumInsured(row) || basicSumInsured(extraction.policy) || basicSumInsured(facts) || basicSumInsured({},contract?.localFacts),verified:Boolean(row.verified),contractStatus:row.contract_status || 'unknown',
        effectiveDate:dateText(row.effective_date) || facts.effectiveDate || extraction.policy?.effectiveDate || '',
        contractDate:facts.contractDate || extraction.policy?.contractDate || '',
        expiryDate:dateText(row.expiry_date) || facts.expiryDate || extraction.policy?.expiryDate || '',
        paymentTerm:extraction.policy?.paymentTerm || facts.paymentTerm || '',paymentEndDate:extraction.policy?.paymentEndDate || facts.paymentEndDate || '',
        extraction,localFacts:contract?.localFacts || {},contractFacts:facts,diseaseCounts:contract?.diseaseCounts,
        benefits:combinedBenefits(facts.verifiedResponsibilities,normalizeBenefits(extraction)),
        analysisStatus:contract?.analysisStatus || '',
      };
    });
    for (const contract of contracts) {
      if (usedContractIds.has(contract.id)) continue;
      const extraction=contract.extraction || {};
      const facts=contract.contractFacts || {};
      if (!facts.productName && !Object.keys(extraction.policy || {}).length && !contract.benefits.length) continue;
      const policy=extraction.policy || {};
      records.push({
        id:`contract-${contract.id}`,sourceContractIds:[contract.id],company:policy.company || facts.company || '',name:policy.productName || facts.productName || '未识别产品',
        policyNumber:facts.policyNumber || '',
        insuranceType:policy.insuranceType || '',holderName:facts.holderName || '',insuredName:facts.insuredName || '',
        beneficiary:facts.beneficiary || '',insuredSex:facts.insuredSex || '',insuredBirthDate:facts.insuredBirthDate || '',
        premium:preferDetailedPremium('',facts.premium,policy.premium || ''),coverageSummary:extraction.coverageSummary || '',
        basicSumInsured:basicSumInsured(policy) || basicSumInsured(facts) || basicSumInsured({},contract.localFacts),
        verified:false,contractStatus:'unknown',effectiveDate:policy.effectiveDate || facts.effectiveDate || '',expiryDate:policy.expiryDate || facts.expiryDate || '',
        contractDate:facts.contractDate || policy.contractDate || '',
        paymentTerm:policy.paymentTerm || facts.paymentTerm || '',paymentEndDate:policy.paymentEndDate || facts.paymentEndDate || '',
        extraction,localFacts:contract.localFacts,contractFacts:facts,diseaseCounts:contract.diseaseCounts,
        benefits:combinedBenefits(facts.verifiedResponsibilities,contract.benefits),analysisStatus:contract.analysisStatus,
      });
    }
    return {customer:{id:customerId,name:customer.name,phone:customer.phone || '',profile:parseJson(profileResult.rows[0]?.profile_data,{})},records};
  }

  async policyOrganizerDiagnoses({customer,records,preparedOn,members=null,context=null}) {
    if (!process.env.DEEPSEEK_API_KEY && !this.policyOrganizerDiagnosisModel) {
      throw new ServiceUnavailableException('AI 诊断服务未配置，请先配置 DeepSeek');
    }
    const snapshots=policyOrganizerMemberSnapshots({customer,records,preparedOn,members,context,assumeProvided:true});
    return generatePolicyOrganizerDiagnoses(snapshots,this.policyOrganizerDiagnosisModel || ((...args)=>this.callDeepSeekModel(...args)));
  }

  async exportPolicyOrganizer(customerIdValue,{withDiagnosis=false}={}) {
    const {customer,records}=await this.preparePolicyOrganizerData(customerIdValue);
    const preparedOn=beijingDate();
    const diagnoses=withDiagnosis?await this.policyOrganizerDiagnoses({customer,records,preparedOn}):null;
    const {workbook}=buildPolicyOrganizerWorkbook({customer,records,preparedOn,diagnoses});
    return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),mimeType:XLSX_MIME,fileName:`${filenameSafe(customer.name)}_家庭保单整理_${beijingDate()}.xlsx`};
  }
}
