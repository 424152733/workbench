export const COVERAGE_CATEGORIES = [
  {key:'medical',label:'医疗费用',description:'医保与住院医疗费用补偿'},
  {key:'critical',label:'重疾给付',description:'疾病发生后的现金支持'},
  {key:'accident',label:'意外保障',description:'意外医疗、伤残与身故责任'},
  {key:'life',label:'身故责任',description:'寿险产品与重疾险等附带的身故责任分开看'},
  {key:'annuity',label:'年金现金流',description:'养老、教育等长期领取安排'},
];

export const DEFAULT_COVERAGE_PROFILE = {
  medicalInsuranceStatus:'unknown',employerMedicalStatus:'unknown',incomeResponsibility:'unknown',
  dependentCount:null,mortgageStatus:'unknown',mortgageBand:'unknown',longTermGoals:[],
};

export const COVERAGE_PROFILE_LABELS = {
  medicalInsuranceStatus:{unknown:'待确认',employee:'职工医保',resident:'居民医保',none:'目前未参保'},
  employerMedicalStatus:{unknown:'待确认',yes:'有单位补充医疗',no:'没有单位补充医疗'},
  incomeResponsibility:{unknown:'待确认',primary:'主要收入承担者',shared:'共同承担收入',not_primary:'非主要收入承担者'},
  mortgageStatus:{unknown:'待确认',yes:'有房贷',no:'无房贷'},
  mortgageBand:{unknown:'待确认',under50:'50 万元以下','50_150':'50–150 万元','150_300':'150–300 万元',over300:'300 万元以上'},
};

function policyCategories(text='') {
  const value=String(text).toLowerCase();
  const result=[];
  const specificDiseaseMedical=/特定疾病/.test(value) && /医疗|住院|门诊|费用补偿|医疗费用|报销/.test(value);
  if (/年金|养老金|教育金|生存金|养老年金/.test(value)) result.push('annuity');
  if (/重疾|重大疾病|中症|中度疾病|癌症保险金|疾病保险金/.test(value) || (/特定疾病/.test(value) && !specificDiseaseMedical)) result.push('critical');
  if (/意外|伤残|意外伤害/.test(value)) result.push('accident');
  // 产品分类只看险种/产品名称；不能因为重疾险、意外险带有身故给付，就把整份保单称为寿险。
  if (/寿险|终身寿|定期寿|增额寿|分红型寿/.test(value)) result.push('life');
  if (/医疗|住院|门诊|费用补偿|百万医|防癌医疗/.test(value)) result.push('medical');
  return [...new Set(result)];
}

function benefitCategories(benefit={}) {
  const name=String(benefit.name || '').toLowerCase();
  const summary=String(benefit.summary || '').toLowerCase();
  const result=[];
  if (/年金|养老金|教育金|生存金|养老年金/.test(name)) result.push('annuity');
  if (/重疾|重大疾病|中症|中度疾病|轻症|疾病保险金|特定严重疾病/.test(name) && !/医疗|费用/.test(name)) result.push('critical');
  if (/意外(?:医疗|伤害保险金|身故保险金|伤残保险金|津贴)|伤残保险金/.test(name)) result.push('accident');
  if (/身故责任|身故保险金|身故给付|死亡给付/.test(name)) result.push('life');
  if (/医疗|住院|门诊|费用补偿|医疗费用/.test(name)) result.push('medical');
  if (/前\s*10\s*年关爱保险金/.test(name)) {
    if (/重大疾病/.test(summary)) result.push('critical');
    if (/身故/.test(summary)) result.push('life');
  }
  // "因意外" in a payout condition describes a cause, not separate accident cover.
  if (!result.length) {
    if (/身故保险金|身故给付/.test(summary)) result.push('life');
    if (/一般医疗费用保险金|特定疾病医疗费用保险金/.test(summary)) result.push('medical');
  }
  return [...new Set(result)];
}

function isClaimProcedureOnly(benefit) {
  if (benefit?.amount || benefit?.paymentMethod) return false;
  const name=String(benefit?.name || '');
  // Only suppress items whose title itself describes an administrative claim step.
  // Coverage conditions often mention hospitals, diagnosis certificates or claim
  // procedures; using those details to classify the whole item drops real benefits.
  return /理赔申请|保险金申请材料|申请材料|所需资料|理赔资料|报案流程|索赔流程|申请流程|受益人资料/.test(name);
}

function isDiseaseDefinitionOnly(benefit) {
  const name=String(benefit?.name || '');
  if (benefit?.amount || benefit?.paymentMethod || /保险金|给付|医疗费用|津贴|年金|豁免|补偿|返还/.test(name)) return false;
  return /病|症|肿瘤|癌|失明|失聪|梗塞|中风|昏迷|肢体缺失|衰竭|失代偿|移植/.test(name);
}

function benefitQuality(benefit) {
  return (benefit.amount?8:0)+(benefit.paymentMethod?4:0)+(benefit.summary?2:0)+(benefit.conditions?1:0);
}

function deduplicateBenefits(benefits) {
  const unique=[];
  for (const benefit of benefits) {
    const normalize=(value)=>String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
    const nameKey=normalize(benefit.name) || `${normalize(benefit.amount)}|${normalize(benefit.summary)}|${normalize(benefit.conditions)}`;
    const existingIndex=unique.findIndex((item)=>String(item.name || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')===nameKey
      && (!item.amount || !benefit.amount || item.amount===benefit.amount));
    if (existingIndex<0) unique.push(benefit);
    else {
      const existing=unique[existingIndex];
      const preferred=benefitQuality(benefit)>benefitQuality(existing)?benefit:existing;
      const pages=[...new Set([...(existing.pages || []),existing.page,...(benefit.pages || []),benefit.page].filter(Boolean))].sort((a,b)=>a-b);
      unique[existingIndex]={
        ...preferred,
        amount:preferred.amount || existing.amount || benefit.amount || '',
        paymentMethod:preferred.paymentMethod || existing.paymentMethod || benefit.paymentMethod || '',
        summary:[...new Set([existing.summary,benefit.summary].filter(Boolean))].join('；'),
        conditions:[...new Set([existing.conditions,benefit.conditions].filter(Boolean))].join('；'),
        page:pages[0] || preferred.page || null,
        pages,
      };
    }
  }
  return unique.map((benefit)=>({...benefit,kind:isDiseaseDefinitionOnly(benefit)?'definition':'benefit'}));
}

export function summarizeDiseaseDefinitions(benefits=[]) {
  if (!benefits.length) return '';
  const names=benefits.slice(0,4).map((benefit)=>benefit.name).filter(Boolean);
  const extra=benefits.length>names.length ? `等${benefits.length}项` : '';
  const pages=[...new Set(benefits.flatMap((benefit)=>benefit.pages || [benefit.page]).filter(Boolean))].sort((a,b)=>a-b);
  return `合同疾病定义：${names.join('、')}${extra}${pages.length?`（合同第 ${pages.join('、')} 页）`:''}`;
}

function responsibilityOnlyLabel(categoryKey) {
  return ({medical:'附带医疗责任',critical:'附带重疾给付',accident:'附带意外责任',life:'附带身故责任',annuity:'附带年金责任'})[categoryKey] || '合同责任';
}

function responsibilityOnlyNote(categoryKey) {
  if (categoryKey==='life') return '产品仍按险种归类；此处只列合同中的身故给付，不代表该产品属于寿险。';
  const label=responsibilityOnlyLabel(categoryKey).replace('附带','');
  return `保单仍按产品类型归类；此处只列合同中识别出的${label}。`;
}

function currentPolicyStatus(policy,today) {
  if (!policy.verified) return 'review';
  if (['suspended','expired','terminated'].includes(policy.contractStatus)) return 'inactive';
  if (policy.contractStatus!=='active') return 'review';
  if (policy.effectiveDate && policy.effectiveDate>today) return 'review';
  if (policy.expiryDate && policy.expiryDate<today) return 'review';
  return 'current';
}

function policyStatusLabel(policy) {
  if (policy.status==='current') return '已核实有效';
  if (policy.status==='inactive') return '非在保 / 已终止';
  if (policy.verified && policy.contractStatus==='unknown') return '资料已核实 · 状态待确认';
  if (policy.verified && policy.contractStatus==='pending_effective') return '资料已核实 · 待生效';
  if (policy.verified) return '资料已核实 · 状态需复核';
  return '资料待核实';
}

function parseRecurringAnnualPremium(value) {
  const text=String(value || '').replaceAll(',','').trim();
  if (!text) return null;
  const annual=text.match(/(?:每年(?:交费|缴费|交|缴|保费)?|年交(?:保费)?|年缴(?:保费)?)\s*[:：]?\s*(?:￥|¥|人民币)?\s*(\d+(?:\.\d+)?)\s*(?:元|人民币|$|[，,；;])/);
  if (annual) return {amount:Number(annual[1]),basis:'annual'};
  const monthly=text.match(/(?:每月(?:交费|缴费|交|缴|保费)?|月交保费|月缴保费)\s*[:：]?\s*(?:￥|¥|人民币)?\s*(\d+(?:\.\d+)?)\s*(?:元|人民币|$|[，,；;])/);
  if (monthly) return {amount:Number(monthly[1])*12,basis:'monthly_annualized'};
  const slash=text.match(/(?:￥|¥|人民币)?\s*(\d+(?:\.\d+)?)\s*元?\s*\/\s*(年|月)/);
  if (slash) return {amount:Number(slash[1])*(slash[2]==='月'?12:1),basis:slash[2]==='月'?'monthly_annualized':'annual'};
  return null;
}

function parseExplicitCurrencyAmount(value) {
  const match=String(value || '').trim().match(/^(?:人民币\s*)?(?:[￥¥]\s*)?(\d[\d,]*(?:\.\d{1,2})?)\s*(元|万元|万)$/);
  if (!match) return null;
  const amount=Number(match[1].replaceAll(',',''))*(match[2]==='万'||match[2]==='万元'?10_000:1);
  return Number.isFinite(amount)?amount:null;
}

function policyDisplayName(policy) {
  return policy.name || policy.type || '未命名保单';
}

function benefitPageLabel(benefit) {
  const pages=[...new Set(benefit.pages || (benefit.page?[benefit.page]:[]))].sort((a,b)=>a-b);
  return pages.length ? `合同第 ${pages.join('、')} 页` : '';
}

export function summarizeCoveragePolicy(policy,categoryKey) {
  const lines=[];
  if (!policy.responsibilityOnly && policy.basicSumInsured?.amount) {
    lines.push({label:policy.basicSumInsured.label || '基本保险金额',value:policy.basicSumInsured.amount,
      source:policy.basicSumInsured.page?`合同第 ${policy.basicSumInsured.page} 页`:''});
  }
  for (const benefit of policy.benefits || []) {
    if (benefit.kind==='definition') continue;
    const name=String(benefit.name || '保障责任');
    let value=benefit.amount || benefit.paymentMethod || '';
    if (!value && ['life','annuity'].includes(categoryKey) && /身故|死亡|领取|年金|生存金|养老金/.test(name) && benefit.summary) {
      const summary=String(benefit.summary).trim();
      value=summary.length>70?`${summary.slice(0,70)}…`:summary;
    }
    if (!value) continue;
    const source=benefitPageLabel(benefit);
    const key=`${name}:${value}`;
    if (!lines.some((line)=>`${line.label}:${line.value}`===key)) lines.push({label:name,value,source,note:benefit.note || ''});
  }
  if (!lines.length && categoryKey==='annuity' && policy.coverageSummary) {
    const summary=String(policy.coverageSummary).trim();
    lines.push({label:'领取安排',value:summary.length>70?`${summary.slice(0,70)}…`:summary,source:''});
  }
  return lines.length?lines:[{label:categoryKey==='annuity'?'领取安排':'保障金额 / 给付安排',value:'待核实',source:''}];
}

function categoryEvidence(categoryKey,policy,contract) {
  const localBenefits=Array.isArray(contract?.localBenefits) ? contract.localBenefits : [];
  const benefits=(localBenefits.length ? localBenefits : contract?.extraction?.complete ? contract.extraction.benefits || [] : [])
    .filter((benefit)=>!isClaimProcedureOnly(benefit));
  if (!benefits.length) return [];
  const benefitCategory=(benefit)=>benefitCategories(benefit);
  const matched=benefits.filter((benefit)=>benefitCategory(benefit).includes(categoryKey));
  // 产品所属险种下也保留未能自动分类的权益，避免只显示少数带有明确关键词的责任。
  const unclassified=policy.productCategories?.includes(categoryKey)?benefits.filter((benefit)=>benefitCategory(benefit).length===0).map((benefit)=>({...benefit,unclassified:!localBenefits.length})):[];
  const selected=[...matched,...unclassified];
  const rows=deduplicateBenefits(selected).map((benefit)=>({
    name:benefit.name || '保障责任',amount:benefit.amount || '',summary:benefit.summary || '',kind:benefit.kind,
    paymentMethod:benefit.paymentMethod || '',conditions:benefit.conditions || '',page:benefit.page || null,pages:benefit.pages || (benefit.page?[benefit.page]:[]),
    source:contract.fileName || '',unclassified:Boolean(benefit.unclassified),
  }));
  if (categoryKey!=='medical') return rows;
  const generalRows=rows.filter((benefit)=>benefit.name.trim()==='一般医疗费用保险金' && benefit.amount);
  const componentNames=new Set(['住院医疗费用保险金','住院前后门急诊医疗费用保险金']);
  const components=rows.filter((benefit)=>componentNames.has(benefit.name.trim()));
  if (!generalRows.length || !components.length) return rows;
  const componentPages=[...new Set(components.flatMap((benefit)=>benefit.pages || (benefit.page?[benefit.page]:[])))].sort((a,b)=>a-b);
  for (const general of generalRows) {
    general.note='包含住院医疗及住院前后30日门急诊费用；合计使用上述一般医疗费用年限额。';
    general.pages=[...new Set([...(general.pages || []),...componentPages])].sort((a,b)=>a-b);
    general.page=general.pages[0] || general.page;
  }
  return rows.filter((benefit)=>!componentNames.has(benefit.name.trim()));
}

function makeRecommendations({profile,categories}) {
  const byKey=Object.fromEntries(categories.map((item)=>[item.key,item]));
  const results=[];
  const medical=byKey.medical;
  if (medical.currentCount) {
    results.push({priority:'low',kind:'医疗保障',title:'复核医疗责任细节',reason:`已找到 ${medical.currentCount} 份已核实有效的医疗类保单，但医保、单位福利和合同条件仍需分别确认。`,next:'核对医保与单位补充医疗，并查看免赔额、报销范围、年度限额、续保条件及既往症限制。'});
  } else {
    const hasUnconfirmedMedical=medical.reviewCount || medical.unassignedCount;
    const baseMedicalUnknown=profile.medicalInsuranceStatus==='unknown' || profile.employerMedicalStatus==='unknown';
    const baseMedicalMissing=profile.medicalInsuranceStatus==='none';
    const title=baseMedicalMissing
      ? '确认基础医保与住院医疗保障'
      : hasUnconfirmedMedical ? '核对已有医疗保单' : '补问医保与住院医疗保障';
    const reasonParts=[];
    if(baseMedicalMissing) reasonParts.push('客户资料显示目前未参加基础医保');
    else if(baseMedicalUnknown) reasonParts.push('医保或单位补充医疗情况待确认');
    if(hasUnconfirmedMedical) reasonParts.push(`另有 ${medical.reviewCount} 份保单状态待核、${medical.unassignedCount} 份被保险人待确认`);
    else reasonParts.push('当前档案未查到已核实有效的医疗费用补偿责任');
    results.push({priority:baseMedicalMissing?'high':'medium',kind:'医疗保障',title,reason:`${reasonParts.join('；')}。这不代表客户现实中没有保障。`,next:baseMedicalMissing
      ? '先了解基础医保办理情况，再核对单位福利和系统外商业医疗保单。'
      : '确认医保参保状态、单位福利、被保险人和保单是否在保，再核对医疗责任与续保条件。'});
  }

  const hasDependencyOrDebt=(profile.dependentCount ?? 0)>0 || profile.mortgageStatus==='yes';
  const hasFamilyResponsibility=['primary','shared'].includes(profile.incomeResponsibility) && hasDependencyOrDebt;
  const familyResponsibilityUnknown=profile.incomeResponsibility==='unknown'
    || ((profile.dependentCount==null || profile.mortgageStatus==='unknown') && profile.incomeResponsibility!=='not_primary');
  const life=byKey.life;
  const lifeProductCurrentCount=life.productCurrentCount ?? life.currentCount;
  if (hasFamilyResponsibility && !lifeProductCurrentCount) {
    const attachedCount=(life.responsibilityCurrentCount || 0)+(life.responsibilityReviewCount || 0);
    const hasUnconfirmedLife=life.productReviewCount || life.productUnassignedCount;
    results.push({priority:'high',kind:'家庭兜底',title:'核实主要经济责任人的寿险安排',reason:attachedCount
      ? `档案发现 ${life.responsibilityCurrentCount || 0} 份有效、${life.responsibilityReviewCount || 0} 份待核的其他险种附带身故责任；这类责任可作为补充，但不能直接视为已配置独立寿险兜底。${life.responsibilityUnassignedCount ? `另有 ${life.responsibilityUnassignedCount} 份相关保单的被保险人待确认。` : ''}`
      : hasUnconfirmedLife
        ? `档案有 ${life.productReviewCount || 0} 份寿险类产品待核，${life.productUnassignedCount || 0} 份相关保单的被保险人待确认，暂时无法判断家庭身故兜底是否有效。`
        : '客户承担主要或共同家庭收入责任，档案中暂未查到已核实有效的寿险类产品。',
      next:'核对现有身故责任的金额、期限和给付条件；再确认系统外定期寿险、终身寿、增额终身寿或分红型终身寿，并结合负债、家庭支出和责任期限讨论兜底安排。'});
  } else if (familyResponsibilityUnknown) {
    results.push({priority:'medium',kind:'家庭兜底',title:'了解家庭经济责任',reason:'目前不清楚客户是否承担主要收入、是否有经济依赖者或房贷。',next:'补问家庭主要收入来源、经济依赖人数和房贷情况，再核对寿险身故责任。'});
  } else if (lifeProductCurrentCount) {
    results.push({priority:'low',kind:'家庭兜底',title:'整理现有寿险责任',reason:`已找到 ${lifeProductCurrentCount} 份已核实有效的寿险类产品。`,next:'分别核对保证身故利益、保障期限、保额变化规则；增额/分红型产品的现金价值和非保证利益单独查看。'});
  }

  if (profile.longTermGoals.length) {
    const annuity=byKey.annuity;
    results.push(annuity.currentCount
      ? {priority:'low',kind:'长期现金流',title:'对照长期目标梳理年金领取',reason:`已找到 ${annuity.currentCount} 份已核实有效的年金类记录。`,next:'核对缴费与领取时间表、保证领取利益和非保证利益，看看是否匹配养老或教育目标。'}
      : {priority:'low',kind:'长期现金流',title:annuity.unassignedCount?'核对年金被保险人和领取安排':'了解已有长期现金流安排',reason:annuity.unassignedCount
        ? `有 ${annuity.unassignedCount} 份年金类记录未确认被保险人，暂时无法判断是否对应客户目标。`
        : '客户提到长期目标，当前档案未查到已核实有效的年金类保单。',next:'先确认领取对象、社保养老金、单位福利和系统外年金，再讨论目标和预算。'});
  }
  return results;
}

export function buildCoverageReview({customer,policies=[],contracts=[],profile={},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())}) {
  const normalizedProfile={...DEFAULT_COVERAGE_PROFILE,...profile,longTermGoals:Array.isArray(profile.longTermGoals)?profile.longTermGoals:[]};
  const contractByPolicy=new Map();
  for (const item of contracts) if (item.matchedPolicyId && !contractByPolicy.has(Number(item.matchedPolicyId))) contractByPolicy.set(Number(item.matchedPolicyId),item);
  for (const item of contracts) if (item.policyId) contractByPolicy.set(Number(item.policyId),item);
  const provisionalContracts=contracts.filter((item)=>!item.policyId && !item.matchedPolicyId && item.localPolicy?.productName);
  const candidatePolicies=[...policies,...provisionalContracts.map((contract)=>({
    id:`contract-${contract.id}`,company:contract.localPolicy.company,name:contract.localPolicy.productName,type:'',
    premium:contract.localPolicy.premium,coverageSummary:'',verified:false,contractStatus:'unknown',
    insuredName:contract.localPolicy.insuredName,holderName:contract.localPolicy.holderName,
    basicSumInsured:contract.localPolicy.basicSumInsured,effectiveDate:contract.localPolicy.effectiveDate,
    expiryDate:contract.localPolicy.expiryDate,contract,isProvisional:true,
  }))];
  const records=candidatePolicies.map((policy)=>{
    const status=currentPolicyStatus(policy,today);
    const contract=policy.contract || contractByPolicy.get(Number(policy.id));
    const productNameCategories=policyCategories([policy.name,contract?.extraction?.policy?.productName].join(' '));
    const productCategories=productNameCategories.length ? productNameCategories : policyCategories([policy.type,contract?.extraction?.policy?.insuranceType].join(' '));
    const sourceBenefits=contract?.localBenefits?.length ? contract.localBenefits : contract?.extraction?.complete ? contract.extraction.benefits || [] : [];
    const responsibilityCategories=sourceBenefits.filter((benefit)=>!isClaimProcedureOnly(benefit)).flatMap((benefit)=>benefitCategories(benefit));
    const categories=[...new Set([...productCategories,...responsibilityCategories])];
    return {...policy,status,categories,productCategories,responsibilityCategories,contract,fileName:contract?.fileName || ''};
  });
  const categories=COVERAGE_CATEGORIES.map((category)=>{
    const related=records.filter((record)=>record.categories.includes(category.key));
    const productRelated=related.filter((record)=>record.productCategories.includes(category.key));
    const responsibilityOnly=related.filter((record)=>!record.productCategories.includes(category.key));
    const current=related.filter((record)=>record.status==='current');
    const review=related.filter((record)=>record.status==='review');
    const inactive=related.filter((record)=>record.status==='inactive');
    const benefits=related.flatMap((record)=>categoryEvidence(category.key,record,record.contract).map((benefit)=>({...benefit,
      policyId:record.id,policyName:policyDisplayName(record),company:record.company,status:record.status,insuredName:record.insuredName || '被保险人待确认'})));
    return {...category,currentCount:current.length,reviewCount:review.length,inactiveCount:inactive.length,
      productCurrentCount:productRelated.filter((record)=>record.status==='current').length,
      productReviewCount:productRelated.filter((record)=>record.status==='review').length,
      productUnassignedCount:productRelated.filter((record)=>!record.insuredName.trim()).length,
      responsibilityCurrentCount:responsibilityOnly.filter((record)=>record.status==='current').length,
      responsibilityReviewCount:responsibilityOnly.filter((record)=>record.status==='review').length,
      responsibilityUnassignedCount:responsibilityOnly.filter((record)=>!record.insuredName.trim()).length,
      unassignedCount:related.filter((record)=>!record.insuredName.trim()).length,
      policies:related.map((record)=>({id:record.id,name:policyDisplayName(record),company:record.company,insuredName:record.insuredName || '被保险人待确认',
        status:record.status,premium:record.premium,coverageSummary:record.contract?.localBenefits?.length || record.contract?.extraction?.complete && record.contract.extraction.benefits?.length ? '' : record.coverageSummary,effectiveDate:record.effectiveDate,expiryDate:record.expiryDate,
        verified:record.verified,contractStatus:record.contractStatus,contractId:record.contract?.id || null,
        isProvisional:Boolean(record.isProvisional),evidenceSource:record.contract?.localBenefits?.length ? 'original' : record.contract?.extraction?.complete ? 'ai' : '',
        responsibilityOnly:!record.productCategories.includes(category.key),
        basicSumInsured:record.basicSumInsured || record.contract?.extraction?.policy?.basicSumInsured || null,
        fileName:record.fileName,benefits:categoryEvidence(category.key,record,record.contract)})),benefits};
  });
  const customerNameKey=String(customer?.name || '').replace(/\s/g,'').toLowerCase();
  const customerCategories=categories.map((category)=>{
    const personal=category.policies.filter((policy)=>String(policy.insuredName || '').replace(/\s/g,'').toLowerCase()===customerNameKey);
    const currentCount=personal.filter((policy)=>policy.status==='current').length;
    const reviewCount=personal.filter((policy)=>policy.status==='review').length;
    const unassignedCount=category.policies.filter((policy)=>policy.insuredName==='被保险人待确认').length;
    const productPolicies=personal.filter((policy)=>!policy.responsibilityOnly);
    const responsibilityPolicies=personal.filter((policy)=>policy.responsibilityOnly);
    return {...category,currentCount,reviewCount,unassignedCount,
      productCurrentCount:productPolicies.filter((policy)=>policy.status==='current').length,
      productReviewCount:productPolicies.filter((policy)=>policy.status==='review').length,
      productUnassignedCount:category.policies.filter((policy)=>!policy.responsibilityOnly && policy.insuredName==='被保险人待确认').length,
      responsibilityCurrentCount:responsibilityPolicies.filter((policy)=>policy.status==='current').length,
      responsibilityReviewCount:responsibilityPolicies.filter((policy)=>policy.status==='review').length,
      responsibilityUnassignedCount:category.policies.filter((policy)=>policy.responsibilityOnly && policy.insuredName==='被保险人待确认').length};
  });
  const activePolicies=records.filter((record)=>record.status==='current');
  const pendingPolicies=records.filter((record)=>record.status==='review');
  const parsedPremiums=activePolicies.map((policy)=>({policy,parsed:parseRecurringAnnualPremium(policy.premium)})).filter((item)=>item.parsed);
  const pendingParsedPremiums=pendingPolicies.map((policy)=>({policy,parsed:parseRecurringAnnualPremium(policy.premium)})).filter((item)=>item.parsed);
  const unknownPremiumCount=activePolicies.length-parsedPremiums.length;
  const annualPremiumTotal=parsedPremiums.reduce((sum,item)=>sum+item.parsed.amount,0);
  const pendingAnnualPremiumTotal=pendingParsedPremiums.reduce((sum,item)=>sum+item.parsed.amount,0);
  const criticalCategory=categories.find((category)=>category.key==='critical');
  const criticalProductPolicies=(criticalCategory?.policies || []).filter((policy)=>!policy.responsibilityOnly);
  const criticalCurrentAmounts=criticalProductPolicies.filter((policy)=>policy.status==='current').map((policy)=>({policy,amount:parseExplicitCurrencyAmount(policy.basicSumInsured?.amount)})).filter((item)=>item.amount!==null);
  const criticalPendingAmounts=criticalProductPolicies.filter((policy)=>policy.status==='review').map((policy)=>({policy,amount:parseExplicitCurrencyAmount(policy.basicSumInsured?.amount)})).filter((item)=>item.amount!==null);
  const criticalCurrentBasicSumInsuredTotal=criticalCurrentAmounts.reduce((sum,item)=>sum+item.amount,0);
  const criticalPendingBasicSumInsuredTotal=criticalPendingAmounts.reduce((sum,item)=>sum+item.amount,0);
  const criticalRecognizedBasicSumInsuredTotal=criticalCurrentBasicSumInsuredTotal+criticalPendingBasicSumInsuredTotal;
  const criticalRecognizedBasicSumInsuredCount=criticalCurrentAmounts.length+criticalPendingAmounts.length;
  // Service focus cards are derived from registered policy records. Once all
  // policies are deleted, do not leave profile-only recommendations behind.
  const recommendations=policies.length ? makeRecommendations({profile:normalizedProfile,categories:customerCategories}) : [];
  const diagnosisCount=recommendations.filter((item)=>item.priority==='high').length;
  return {
    generatedAt:new Date().toISOString(),customer,profile:normalizedProfile,policies:records,categories,recommendations,
    metrics:{policyCount:policies.length,provisionalContractCount:provisionalContracts.length,
      currentPolicyCount:activePolicies.filter((record)=>!record.isProvisional).length,
      pendingPolicyCount:pendingPolicies.filter((record)=>!record.isProvisional).length,
      inactivePolicyCount:records.filter((record)=>!record.isProvisional && record.status==='inactive').length,
      linkedContractCount:contracts.filter((item)=>item.policyId).length,
      unfiledContractCount:contracts.filter((item)=>!item.policyId).length,annualPremiumTotal,parsedPremiumCount:parsedPremiums.length,
      pendingAnnualPremiumTotal,pendingParsedPremiumCount:pendingParsedPremiums.length,
      pendingUnknownPremiumCount:pendingPolicies.length-pendingParsedPremiums.length,
      annualPremiumRecognizedTotal:annualPremiumTotal+pendingAnnualPremiumTotal,
      criticalCurrentBasicSumInsuredTotal,criticalCurrentBasicSumInsuredCount:criticalCurrentAmounts.length,
      criticalCurrentBasicSumInsuredUnknownCount:criticalProductPolicies.filter((policy)=>policy.status==='current'&&!parseExplicitCurrencyAmount(policy.basicSumInsured?.amount)).length,
      criticalPendingBasicSumInsuredTotal,criticalPendingBasicSumInsuredCount:criticalPendingAmounts.length,
      criticalRecognizedBasicSumInsuredTotal,criticalRecognizedBasicSumInsuredCount,
      unknownPremiumCount,diagnosisCount},
  };
}

const escapeHtml=(value)=>String(value ?? '').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=(value)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
const statusText=policyStatusLabel;

export function renderCoverageReviewHtml(analysis) {
  const profile=analysis.profile;
  const medicalLabel=COVERAGE_PROFILE_LABELS.medicalInsuranceStatus[profile.medicalInsuranceStatus] || '待确认';
  const goalLabels={retirement:'养老',education:'教育',other:'其他长期目标'};
  const goalText=profile.longTermGoals.map((goal)=>goalLabels[goal] || goal).join('、') || '未填写';
  const premiumSummaryHtml=`<section class="totals"><h2>年度保费与保障金额汇总</h2><div class="total-grid"><article><small>档案识别年交保费（含待核）</small><b>${money(analysis.metrics.annualPremiumRecognizedTotal)}</b><p>已核实有效：${money(analysis.metrics.annualPremiumTotal)} · 待核对：${money(analysis.metrics.pendingAnnualPremiumTotal)}</p><p>${analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount?`${analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount} 份保单无法可靠换算成年交，未计入。`:''}</p></article><article><small>已识别重疾基本保额（含待核）</small><b>${analysis.metrics.criticalRecognizedBasicSumInsuredCount?money(analysis.metrics.criticalRecognizedBasicSumInsuredTotal):'待核实'}</b><p>已确认有效：${money(analysis.metrics.criticalCurrentBasicSumInsuredTotal)} · 待核对：${money(analysis.metrics.criticalPendingBasicSumInsuredTotal)}</p></article></div><p class="total-note">医疗限额、重疾保额、意外与身故责任、年金领取口径不同，不跨类型合并为一个“总保额”；其余金额按保单和责任分别列示。</p></section>`;
  const categoryBlocks=analysis.categories.map((category)=>{
    if (!category.policies.length) return `<section><h3>${escapeHtml(category.label)}</h3><p>当前档案未查到记录；请先确认系统外保单及单位福利。</p></section>`;
    return `<section><h3>${escapeHtml(category.label)}</h3>${category.policies.map((policy)=>{
      const benefitRows=policy.benefits.filter((benefit)=>benefit.kind!=='definition');
      const definitions=policy.benefits.filter((benefit)=>benefit.kind==='definition');
      const benefitHtml=benefitRows.map((benefit)=>`<p class="benefit">${escapeHtml(benefit.name)}${benefit.amount?`：${escapeHtml(benefit.amount)}`:''}${benefit.paymentMethod?` · ${escapeHtml(benefit.paymentMethod)}`:''}${benefitPageLabel(benefit)?` · ${escapeHtml(benefitPageLabel(benefit))}`:''}${benefit.unclassified?' · 合同其他权益（暂未自动归类）':''}${benefit.note?`<br>${escapeHtml(benefit.note)}`:''}${benefit.summary?`<br>${escapeHtml(benefit.summary)}`:''}${benefit.conditions?`<br><b>给付条件：</b>${escapeHtml(benefit.conditions)}`:''}</p>`).join('');
      const definitionHtml=definitions.map((benefit)=>`<p class="benefit"><b>${escapeHtml(benefit.name || '疾病定义')}</b>${benefitPageLabel(benefit)?` · ${escapeHtml(benefitPageLabel(benefit))}`:''}${benefit.summary?`<br>${escapeHtml(benefit.summary)}`:''}${benefit.conditions?`<br><b>认定条件：</b>${escapeHtml(benefit.conditions)}`:''}</p>`).join('');
      return `<article><strong>${escapeHtml(policy.company)} · ${escapeHtml(policy.name)}</strong><p>${escapeHtml(policy.insuredName)} · ${escapeHtml(statusText(policy))}${policy.responsibilityOnly?` · ${escapeHtml(responsibilityOnlyNote(category.key))}`:''}</p>${!policy.responsibilityOnly&&policy.basicSumInsured?.amount?`<p class="benefit"><b>${escapeHtml(policy.basicSumInsured.label || '基本保险金额')}：${escapeHtml(policy.basicSumInsured.amount)}</b>${policy.basicSumInsured.page?` · 合同第 ${policy.basicSumInsured.page} 页`:''}</p>`:''}${!policy.responsibilityOnly&&policy.coverageSummary?`<p>${escapeHtml(policy.coverageSummary)}</p>`:''}${benefitHtml}${definitions.length?`<div><p class="benefit"><b>疾病定义范围 · ${definitions.length} 项</b></p>${definitionHtml}</div>`:''}</article>`;
    }).join('')}</section>`;
  }).join('');
  const categorizedPolicyIds=new Set(analysis.categories.flatMap((category)=>category.policies.map((policy)=>policy.id)));
  const uncategorizedRows=analysis.policies.filter((policy)=>!categorizedPolicyIds.has(policy.id)).map((policy)=>`<tr><td>${escapeHtml(policy.insuredName || '被保险人待确认')}</td><td>${escapeHtml(policy.company)} · ${escapeHtml(policyDisplayName(policy))}</td><td>${escapeHtml(policy.type || '待分类')}</td><td>${escapeHtml(statusText(policy))}</td><td>${escapeHtml(policy.premium || '待核实')}</td><td>${escapeHtml(policy.coverageSummary || '请补充保障类型或合同责任')}</td></tr>`).join('');
  const uncategorizedBlock=uncategorizedRows?`<h2>待补充分类的保单</h2><table><thead><tr><th>被保险人</th><th>保单</th><th>分类</th><th>状态</th><th>保费</th><th>摘要</th></tr></thead><tbody>${uncategorizedRows}</tbody></table>`:'';
  const recommendations=analysis.recommendations.map((item)=>`<article class="recommendation"><b>${escapeHtml(item.kind)} · ${escapeHtml(item.title)}</b><p>${escapeHtml(item.reason)}</p><p>下一步：${escapeHtml(item.next)}</p></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(analysis.customer?.name || '客户')}保障检视摘要</title><style>
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#263a30;background:#f3f6f3}body{margin:0;padding:32px}.sheet{max-width:1000px;margin:auto;padding:36px;background:#fff;border:1px solid #e1e8e2;border-radius:20px;box-shadow:0 12px 38px #263a3010}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:1px solid #e8eee9;padding-bottom:20px}h1{font-size:28px;margin:0 0 8px}.muted,small{color:#74837a}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.metric{padding:14px 18px;background:#f4f8f5;border-radius:12px;min-width:140px}.metric b{display:block;font-size:20px;margin-top:5px}.callout{padding:16px 18px;background:#f8faf7;border-left:4px solid #37836e;border-radius:10px;margin:18px 0}section{margin:26px 0}.total-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.total-grid article{margin:0;background:#fbfdfb}.total-grid b{display:block;font-size:22px;margin:8px 0;color:#246f57}.total-note{color:#74837a;font-size:12px;line-height:1.7}h2{font-size:20px;margin:24px 0 14px}h3{font-size:16px;margin:0 0 12px}article{border:1px solid #e5ebe6;border-radius:12px;padding:14px;margin:9px 0;break-inside:avoid}article p{line-height:1.65;margin:6px 0}.benefit{color:#53645a}.recommendation{border-color:#dbe8df;background:#fbfdfb}.overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.overview-card{margin:0;background:#fbfdfb}.overview-heading,.overview-policy{display:flex;flex-direction:column;gap:5px}.overview-heading{flex-direction:row;justify-content:space-between}.overview-policy{margin-top:10px;padding-top:9px;border-top:1px solid #e7ece8}.overview-policy p{margin:3px 0;font-size:12px}.overview-policy p small{white-space:normal}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #e7ece8;overflow-wrap:anywhere}th{background:#f5f8f5}.foot{margin-top:28px;padding-top:16px;border-top:1px solid #e7ece8;color:#75827a;font-size:12px;line-height:1.7}@media(max-width:700px){.overview-grid,.total-grid{grid-template-columns:1fr}}@media print{body{padding:0;background:#fff}.sheet{max-width:none;border:0;border-radius:0;box-shadow:none;padding:16mm}header,section,article{break-inside:avoid}@page{size:A4;margin:12mm}}
    </style></head><body><main class="sheet"><header><div><small>客户保障检视 · 内部服务摘要</small><h1>${escapeHtml(analysis.customer?.name || '客户')}保障概览</h1><div class="muted">整理日期：${escapeHtml(new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium'}).format(new Date(analysis.generatedAt)))}</div></div><div class="muted">多份保单汇总 · 需人工核对</div></header><div class="metrics"><div class="metric">保单记录<b>${analysis.metrics.policyCount} 份</b></div><div class="metric">已核实且有效<b>${analysis.metrics.currentPolicyCount} 份</b></div><div class="metric">待核对<b>${analysis.metrics.pendingPolicyCount} 份</b></div><div class="metric">已确认有效年交保费<b>${money(analysis.metrics.annualPremiumTotal)}</b></div></div><div class="callout"><b>初筛重点</b><p>医保状态：${escapeHtml(medicalLabel)}；经济责任：${escapeHtml(COVERAGE_PROFILE_LABELS.incomeResponsibility[profile.incomeResponsibility] || '待确认')}；经济依赖人数：${profile.dependentCount==null?'待确认':profile.dependentCount}；房贷：${escapeHtml(COVERAGE_PROFILE_LABELS.mortgageStatus[profile.mortgageStatus] || '待确认')}；长期目标：${escapeHtml(goalText)}。</p><p>${analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount?`有 ${analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount} 份保单的缴费频率或金额无法可靠换算，未计入年交保费汇总。`:''}</p></div>${premiumSummaryHtml}<h2>分类型保障与现金流明细</h2>${categoryBlocks}${uncategorizedBlock}<h2>下一步服务建议</h2>${recommendations || '<p>补充客户需求后，再进行保障检视。</p>'}<div class="foot">本摘要根据当前工作台档案及已整理合同生成，用于客户服务沟通。缺少记录不代表客户现实中没有保障；保单状态、责任、金额和给付条件需对照正式合同及保险公司信息核实。医疗、重疾、寿险、年金等不同金额口径不合并为单一总额。本摘要不构成投保、退保、理赔或具体产品适配结论。</div></main></body></html>`;
}

export function downloadCoverageReviewHtml(analysis) {
  const blob=new Blob([renderCoverageReviewHtml(analysis)],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=`${String(analysis.customer?.name || '客户').replace(/[\\/:*?"<>|]/g,'_')}_保障检视_${new Date().toISOString().slice(0,10)}.html`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
