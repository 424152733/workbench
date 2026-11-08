import ExcelJS from 'exceljs';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beijingDate } from './workbench-primitives.js';
import { normalizedPolicyName } from './policy-contract-export-facts.js';
import { loadPolicyContractLocalEvidence } from './policy-contract-local-evidence.js';

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
const displayProductName = (value) => nonempty(value).replace(/\s*[（(](?:原合同待核对|已整理待核对|整理未完成|待核实|已核实)[）)]\s*$/,'');

function preferDetailedPremium(stored,fromContract) {
  if (!stored) return fromContract || '';
  if (!fromContract) return stored;
  const hasFrequency=/(每年|年交|年缴|每月|月交|一次交清|趸交)/.test(stored);
  const storedAmount=String(stored).match(/[\d,]+(?:\.\d+)?/g)?.at(-1)?.replaceAll(',','');
  const contractAmount=String(fromContract).match(/[\d,]+(?:\.\d+)?/g)?.at(-1)?.replaceAll(',','');
  return !hasFrequency && storedAmount && storedAmount===contractAmount ? fromContract : stored;
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

function normalizeBenefits(extraction) {
  return (Array.isArray(extraction?.benefits) ? extraction.benefits : []).map((item)=>({
    name:nonempty(item?.name),amount:nonempty(item?.amount),paymentMethod:nonempty(item?.paymentMethod),
    summary:nonempty(item?.summary),conditions:nonempty(item?.conditions),page:item?.page == null ? '' : String(item.page),
  })).filter((item)=>item.name || item.amount || item.paymentMethod || item.summary || item.conditions);
}

function summarizeResponsibility(record) {
  const extraction=record.extraction || {};
  const benefits=record.benefits || [];
  if (benefits.length) return benefits.map((item)=>`• ${item.main || [item.name,item.amount].filter(Boolean).join('：')}`).join('\n');
  return record.contractFacts?.productName
    ? '原合同保单页已识别基本信息；保障责任条款待整理。'
    : nonempty(extraction.policy?.claimSummary || record.coverageSummary) || '';
}

function summaryChunks(value) {
  const text=nonempty(value);
  if (!text) return [];
  return text.split(/[；;]\s*/).map((part)=>part.trim()).filter((part)=>part && !/申请时|申请书|提交合同|疾病定义/.test(part));
}

export function plannedRemainingPremiums(record,asOfDate) {
  const term=nonempty(record.paymentTerm || record.extraction?.policy?.paymentTerm);
  if (/一次交清|趸交/.test(term)) return '0期（该合同一次交清）';
  const years=Number(term.match(/^(\d+)\s*年/)?.[1]);
  const effective=dateText(record.effectiveDate || record.contractFacts?.effectiveDate);
  const asOf=dateText(asOfDate);
  if (!Number.isSafeInteger(years) || years<1 || years>100 || !/^\d{4}-\d{2}-\d{2}$/.test(effective) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return '';
  const startYear=Number(effective.slice(0,4));
  const endDate=dateText(record.paymentEndDate);
  const endYear=endDate ? Number(endDate.slice(0,4)) : startYear+years-1;
  const dueMonthDay=record.contractFacts?.renewalDueMonthDay || effective.slice(5);
  if (endYear<startYear || endYear>startYear+years) return '';
  let remaining=0;
  for (let year=startYear;year<=endYear;year++) if (`${year}-${dueMonthDay}`>asOf) remaining++;
  return `${remaining}期（合同计划）`;
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
  const coveragePeriod=nonempty(policy.coveragePeriod || record.contractFacts?.coveragePeriod);
  if (effectiveDate && expiryDate) return `${effectiveDate} 至 ${expiryDate}`;
  if (effectiveDate && /终身|终生/.test(coveragePeriod)) return `${effectiveDate} 起，${coveragePeriod}`;
  if (effectiveDate) return `${effectiveDate} 起${coveragePeriod ? `，${coveragePeriod}` : ''}`;
  if (expiryDate) return `至 ${expiryDate}`;
  return coveragePeriod;
}

const COVERAGE_COLUMNS={critical:'I',life:'J',accidentAmount:'K',accidentMedical:'L',hospitalization:'M',allowance:'N',financial:'O'};
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

// One policy contributes at most once to each column. Named sub-benefits that
// share an annual cap or the same basic sum insured are never added together.
export function policyCoverageAmounts(record) {
  const product=displayProductName(record.contractFacts?.productName || record.name || record.extraction?.policy?.productName);
  const type=nonempty(record.insuranceType || record.extraction?.policy?.insuranceType);
  const benefits=record.benefits || [];
  const basic=moneyValue((record.basicSumInsured && typeof record.basicSumInsured==='object'
    ? record.basicSumInsured.amount : record.basicSumInsured) || basicSumInsured(record,record.localFacts));
  const medicalProduct=/医疗|住院|费用补偿/.test(`${product} ${type}`);
  const criticalProduct=/重疾|重大疾病|中症|轻症/.test(`${product} ${type}`) && !medicalProduct;
  const lifeProduct=/终身寿|定期寿|寿险/.test(`${product} ${type}`) && !criticalProduct && !medicalProduct;
  const accidentProduct=/意外(?:伤害|身故|伤残)(?:保险|险)/.test(product) && !medicalProduct;
  const result={};

  if (criticalProduct || benefitNamed(benefits,/^(?:轻症|中症|重疾|重大疾病).*保险金$/)) result.critical=basic;
  const death=benefitNamed(benefits,/^(?!意外)(?:身故|死亡).*保险金$/);
  if (lifeProduct || death) result.life=basic || benefitAmount(death);
  const accidentDeath=benefitNamed(benefits,/^意外(?:身故|伤残|伤害).*保险金$/);
  const deathCoversAccident=death && /因意外|意外伤害原因/.test(nonempty(death.summary)) &&
    !/因意外.{0,12}(?:不赔|不承担|除外)/.test(nonempty(death.summary)) &&
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
  if (/增额.{0,8}终身寿|年金/.test(`${product} ${type}`)) result.financial=basic;
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

export function buildPolicyOrganizerWorkbook({customer,records,preparedOn,members=null}) {
  const insuredNames=unique(records.map((record)=>record.insuredName));
  const allMemberNames=members ? members.map((member)=>member.displayName || member.name) : unique([customer.name,...insuredNames]);
  const memberRows=members ? allMemberNames : allMemberNames.slice(0,3);
  const overviewRows=Math.max(3,memberRows.length);
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
  const amountRows=memberRows.length ? memberRows : [customer.name];
  const amountsByMember=new Map(amountRows.map((name)=>[name,{current:[],pending:[],expired:[],future:[]}]));
  for (const record of records) {
    const targets=Array.isArray(record.insuredMemberNames)
      ? record.insuredMemberNames.length===1?record.insuredMemberNames:[]
      : [nonempty(record.insuredName)];
    for (const target of targets) if (amountsByMember.has(target)) {
      const timing=coverageTiming(record,preparedOn);
      amountsByMember.get(target)[timing].push(policyCoverageAmounts(record));
    }
  }
  for (let offset=0;offset<overviewRows;offset++) {
    const row=4+offset;
    const name=amountRows[offset] || '';
    const memberAmounts=amountsByMember.get(name) || {current:[],pending:[],expired:[],future:[]};
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
      const known=entries.filter((amounts)=>Number.isFinite(amounts[category]) && amounts[category]>0);
      const bases=new Set(known.map((amounts)=>category==='allowance' && amounts.allowanceBasis==='daily'?'daily':'total'));
      if (known.length && bases.size===1) {
        cell.value=known.reduce((sum,amounts)=>sum+amounts[category],0);
        const showCents=!Number.isInteger(cell.value);
        cell.numFmt=bases.has('daily')
          ? (showCents?'#,##0.00"元/日"':'#,##0"元/日"')
          : (showCents?'#,##0.00"元"':'#,##0"元"');
        cell.font={name:'PingFang SC',size:9,bold:true,color:{argb:teal}};
      }
      if (entries.length || pending.length || expired.length || future.length) {
        const notes=[`${entries.length} 份已核实且有效的合同；${known.length} 份金额可识别。`];
        if (pending.length) notes.push(`${pending.length} 份资料或合同状态待核实，金额暂不计入；请在下方保单明细核对。`);
        if (expired.length) notes.push(`${expired.length} 份合同已过原保期，未计入；请核对是否续保。`);
        if (future.length) notes.push(`${future.length} 份合同尚未生效，未计入。`);
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

  const overviewNote=members
    ? '家庭成员逐人列示；只汇总已核实且确认有效的合同。多人共用限额及归属未确认的合同不计入个人金额；待核实金额见下方明细。空白不代表没有保障。'
    : allMemberNames.length>3
    ? '概览仅列示前 3 位被保险人；其余见保单明细。金额只计入已核实且确认有效的合同；待核实金额见下方明细，不同分类不能相加。'
    : '金额只计入已核实且确认有效的合同；已过原保期或状态待核实的合同暂不计入。空白不代表没有保障；不同分类不能相加。';
  setMerged(sheet,`A${overviewNoteRow}:P${overviewNoteRow}`,overviewNote,{fill:soft,fontColor:muted,size:9,align:'left'});
  sheet.getRow(overviewNoteRow).height=36;

  const policyHeaders=[
    [`A${policyHeaderRow}:B${policyHeaderRow}`,'投保人'],[`C${policyHeaderRow}`,'被保险人'],[`D${policyHeaderRow}`,'受益人'],[`E${policyHeaderRow}:F${policyHeaderRow}`,'险种名称'],[`G${policyHeaderRow}`,'有效日期'],
    [`H${policyHeaderRow}`,'交费期限'],[`I${policyHeaderRow}`,'计划余交期数'],[`J${policyHeaderRow}`,'保额'],[`K${policyHeaderRow}`,'保费'],[`L${policyHeaderRow}:O${policyHeaderRow}`,'保险责任'],[`P${policyHeaderRow}`,'公司'],
  ];
  for (const [range,label] of policyHeaders) {
    if (range.includes(':')) setMerged(sheet,range,label,{fill:red,fontColor:white,bold:true,size:10});
    else { const cell=sheet.getCell(range);styleCell(cell,{fill:red,fontColor:white,bold:true,size:10});cell.value=label; }
  }
  sheet.getRow(policyHeaderRow).height=34;

  const annualValues=[];
  let unknownAnnualPremiumCount=0;
  records.forEach((record,index)=>{
    const rowIndex=firstPolicyRow+index;
    for (const range of [`A${rowIndex}:B${rowIndex}`,`E${rowIndex}:F${rowIndex}`,`L${rowIndex}:O${rowIndex}`]) applyMergedStyle(sheet,range,{fill:index%2?'FFF9FBF9':white,fontColor:ink,size:9,align:'left'});
    for (let column=1;column<=16;column++) {
      if (sheet.getCell(rowIndex,column).isMerged) continue;
      styleCell(sheet.getCell(rowIndex,column),{fill:index%2?'FFF9FBF9':white,fontColor:ink,size:9,align:column===12?'left':'center'});
    }
    const productName=displayProductName(record.contractFacts?.productName || record.name || record.extraction?.policy?.productName || '未识别产品');
    const premium=record.premium || record.extraction?.policy?.premium || '';
    const annual=explicitAnnualPremium(premium);
    if (annual===null) { if (premium) unknownAnnualPremiumCount++; }
    else annualValues.push(annual);
    const extraction=record.extraction || {};
    const coverageAmount=record.basicSumInsured || basicSumInsured({},record.localFacts) ||
      (extraction.policy?.basicSumInsured?.amount ? `${extraction.policy.basicSumInsured.amount}${extraction.policy.basicSumInsured.label ? `（${extraction.policy.basicSumInsured.label}）` : ''}` : '');
    const values={
      [`A${rowIndex}`]:record.holderName || '',[`C${rowIndex}`]:record.insuredName || '',[`D${rowIndex}`]:record.beneficiary || '',
      [`E${rowIndex}`]:productName,[`G${rowIndex}`]:formatCoveragePeriod(record),
      [`H${rowIndex}`]:record.paymentTerm || extraction.policy?.paymentTerm || '',
      [`I${rowIndex}`]:plannedRemainingPremiums(record,preparedOn),
      [`J${rowIndex}`]:coverageAmount,[`K${rowIndex}`]:premium,[`L${rowIndex}`]:summarizeResponsibility(record),
      [`P${rowIndex}`]:record.company || extraction.policy?.company || '',
    };
    for (const [address,value] of Object.entries(values)) sheet.getCell(address).value=address.startsWith('L') ? cleanMultilineText(value) : cleanText(value,500);
    const responsibilityLines=summarizeResponsibility(record).split('\n');
    sheet.getRow(rowIndex).height=Math.max(58,Math.min(192,18+responsibilityLines.reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/48))*18,0)));
    sheet.getCell(`E${rowIndex}`).font={name:'PingFang SC',size:9,bold:true,color:{argb:record.verified?teal:'FFB26A15'}};
  });

  const footerRow=firstPolicyRow+records.length;
  applyMergedStyle(sheet,`A${footerRow}:D${footerRow}`,{fill:soft,fontColor:ink,bold:true,size:10});
  applyMergedStyle(sheet,`E${footerRow}:H${footerRow}`,{fill:soft,fontColor:teal,bold:true,size:11});
  applyMergedStyle(sheet,`I${footerRow}:P${footerRow}`,{fill:soft,fontColor:muted,size:9,align:'left'});
  sheet.getCell(`A${footerRow}`).value='已识别年交保费小计';
  const annualTotal=annualValues.reduce((sum,value)=>sum+value,0);
  sheet.getCell(`E${footerRow}`).value=annualValues.length ? `¥${annualTotal.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})} / 年` : '未能确认';
  sheet.getCell(`I${footerRow}`).value=unknownAnnualPremiumCount
    ? `只统计明确标注年交频率的保费；另有 ${unknownAnnualPremiumCount} 份频率未明，未计入。`
    : '只统计明确标注年交频率的保费；不同缴费频率与责任金额不合并。';
  sheet.getRow(footerRow).height=36;
  const noteRow=footerRow+1;
  setMerged(sheet,`A${noteRow}:P${noteRow}`,records.length
    ? `说明：本表结合客户档案、已整理结果和本机原合同。受益人以原合同保单页为准；出生日期由有效身份证号校验推得。计划余交期数按 ${preparedOn} 之后合同约定的年交日期计算，不代表实际已缴、欠费或保单仍有效；一次交清保单续保情况另核。`
    : '当前客户尚无可导出的保单或可识别的原合同。填写和核对后的保单会显示在本表。',
  {fill:white,fontColor:muted,size:9,align:'left'});
  sheet.getRow(noteRow).height=38;
  sheet.autoFilter={from:`A${policyHeaderRow}`,to:`P${Math.max(policyHeaderRow,footerRow-1)}`};
  sheet.printArea=`A1:P${noteRow}`;

  const detail=workbook.addWorksheet('保障责任明细',{views:[{state:'frozen',ySplit:1,showGridLines:false}]});
  detail.columns=[{width:15},{width:22},{width:22},{width:26},{width:24},{width:24},{width:54},{width:54},{width:13},{width:16}];
  detail.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
  const detailHeaders=['被保险人','保险公司','产品名称','保障责任 / 权益','保额或限额','给付方式','责任摘要','给付条件','原PDF页码','核对状态'];
  detailHeaders.forEach((value,index)=>{const cell=detail.getCell(1,index+1);cell.value=value;styleCell(cell,{fill:red,fontColor:white,bold:true,size:10});});
  detail.getRow(1).height=32;
  let detailRow=2;
  for (const record of records) {
    const benefits=record.benefits || [];
    const summary=record.coverageSummary || record.extraction?.policy?.claimSummary || '';
    const chunks=summaryChunks(summary);
    const details=benefits.length ? benefits : chunks.length
      ? chunks.map((part,index)=>({name:chunks.length===1?'保障责任摘要':`保障责任摘要 ${index+1}/${chunks.length}`,amount:'',paymentMethod:'',summary:part,conditions:'',page:''}))
      : [{name:'保障责任待整理',amount:'',paymentMethod:'',summary:'原合同保单页已识别基本信息；具体保障责任仍需对照条款整理。',conditions:'',page:''}];
    for (const item of details) {
      const row=detail.getRow(detailRow);
      const values=[record.insuredName,record.company || record.extraction?.policy?.company,
        displayProductName(record.contractFacts?.productName || record.name || record.extraction?.policy?.productName),item.name,item.amount,item.paymentMethod,item.summary,item.conditions,
        item.page ? `PDF 第 ${item.page} 页` : '',record.verified?'已核实':record.analysisStatus==='部分完成'?'整理未完成':'待核实'];
      values.forEach((value,index)=>{row.getCell(index+1).value=cleanText(value,index===6 || index===7?2000:600);styleCell(row.getCell(index+1),{fill:detailRow%2?'FFF9FBF9':white,fontColor:ink,size:9,align:index>=6?'left':'center'});});
      row.height=Math.max(32,Math.min(110,28+Math.ceil(Math.max(String(item.summary || '').length,String(item.conditions || '').length)/80)*14));
      detailRow++;
    }
  }
  if (detailRow===2) {
    detail.mergeCells('A2:J2');
    detail.getCell('A2').value='当前没有已提取的保障责任明细。';
    styleCell(detail.getCell('A2'),{fill:white,fontColor:muted,size:10,align:'left'});
  }
  detail.autoFilter={from:'A1',to:`J${Math.max(1,detailRow-1)}`};
  detail.printArea=`A1:J${Math.max(1,detailRow-1)}`;
  return {workbook,mimeType:XLSX_MIME};
}

export class PolicyOrganizerExportOperations {
  async preparePolicyOrganizerData(customerIdValue) {
    const customerId=Number(customerIdValue);
    if (!Number.isSafeInteger(customerId) || customerId<=0) throw new BadRequestException('客户编号无效');
    const [customerResult,policyResult,contractResult]=await Promise.all([
      this.db.query('SELECT id,name,phone FROM customers WHERE id=$1',[customerId]),
      this.db.query(`SELECT id,company,policy_name,insurance_type,holder_name,insured_name,premium,coverage_summary,
        basic_sum_insured,verified,contract_status,effective_date,expiry_date
        FROM policies WHERE customer_id=$1 ORDER BY created_at,id`,[customerId]),
      this.db.query(`SELECT id,policy_id,file_name,storage_name,parse_status,analysis_status,extraction_data,local_facts
        FROM customer_policy_contracts WHERE customer_id=$1 AND coverage_excluded_at IS NULL ORDER BY created_at,id`,[customerId]),
    ]);
    const customer=customerResult.rows[0];
    if (!customer) throw new NotFoundException('找不到这位客户');
    const contracts=[];
    for (const row of contractResult.rows) {
      const extraction=parseJson(row.extraction_data,null);
      const localFacts=parseJson(row.local_facts,{});
      let contractFacts={};
      if (row.parse_status!=='needs_ocr' && row.storage_name) {
        try {
          const evidence=await loadPolicyContractLocalEvidence({storageName:row.storage_name,fileName:row.file_name,parseStatus:row.parse_status});
          contractFacts={...evidence.facts,verifiedResponsibilities:evidence.benefits};
        } catch {
          // A missing or unreadable original does not discard saved policy facts.
        }
      }
      const contract={
        id:Number(row.id),policyId:row.policy_id ? Number(row.policy_id) : null,analysisStatus:row.analysis_status,
        extraction,localFacts,contractFacts,benefits:normalizeBenefits(extraction),
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
        holderName:facts.holderName || row.holder_name || '',insuredName:facts.insuredName || row.insured_name || '',
        beneficiary:facts.beneficiary || '',insuredSex:facts.insuredSex || '',insuredBirthDate:facts.insuredBirthDate || '',
        premium:preferDetailedPremium(row.premium || extraction.policy?.premium || '',facts.premium),
        coverageSummary:row.coverage_summary || extraction.coverageSummary || '',
        basicSumInsured:basicSumInsured(row,contract?.localFacts) || basicSumInsured(facts),verified:Boolean(row.verified),contractStatus:row.contract_status || 'unknown',
        effectiveDate:dateText(row.effective_date) || facts.effectiveDate || extraction.policy?.effectiveDate || '',
        expiryDate:dateText(row.expiry_date) || facts.expiryDate || extraction.policy?.expiryDate || '',
        paymentTerm:facts.paymentTerm || '',paymentEndDate:facts.paymentEndDate || '',
        extraction,localFacts:contract?.localFacts || {},contractFacts:facts,benefits:facts.verifiedResponsibilities?.length ? facts.verifiedResponsibilities : normalizeBenefits(extraction),
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
        insuranceType:policy.insuranceType || '',holderName:facts.holderName || '',insuredName:facts.insuredName || '',
        beneficiary:facts.beneficiary || '',insuredSex:facts.insuredSex || '',insuredBirthDate:facts.insuredBirthDate || '',
        premium:preferDetailedPremium(policy.premium || '',facts.premium),coverageSummary:extraction.coverageSummary || '',
        basicSumInsured:basicSumInsured({},contract.localFacts) || basicSumInsured(facts) ||
          (policy.basicSumInsured?.amount ? `${policy.basicSumInsured.amount}${policy.basicSumInsured.label ? `（${policy.basicSumInsured.label}）` : ''}` : ''),
        verified:false,contractStatus:'unknown',effectiveDate:policy.effectiveDate || facts.effectiveDate || '',expiryDate:policy.expiryDate || facts.expiryDate || '',
        paymentTerm:facts.paymentTerm || '',paymentEndDate:facts.paymentEndDate || '',
        extraction,localFacts:contract.localFacts,contractFacts:facts,benefits:facts.verifiedResponsibilities?.length ? facts.verifiedResponsibilities : contract.benefits,analysisStatus:contract.analysisStatus,
      });
    }
    return {customer:{id:customerId,name:customer.name,phone:customer.phone || ''},records};
  }

  async exportPolicyOrganizer(customerIdValue) {
    const {customer,records}=await this.preparePolicyOrganizerData(customerIdValue);
    const {workbook}=buildPolicyOrganizerWorkbook({customer,records,preparedOn:beijingDate()});
    return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),mimeType:XLSX_MIME,fileName:`${filenameSafe(customer.name)}_家庭保单整理_${beijingDate()}.xlsx`};
  }
}
