import { BadRequestException, NotFoundException } from '@nestjs/common';
import { pgDate } from './workbench-primitives.js';
import { normalizedPolicyName } from './policy-contract-export-facts.js';
import { loadPolicyContractLocalEvidence } from './policy-contract-local-evidence.js';

const DEFAULT_PROFILE = Object.freeze({
  medicalInsuranceStatus:'unknown',
  employerMedicalStatus:'unknown',
  incomeResponsibility:'unknown',
  dependentCount:null,
  mortgageStatus:'unknown',
  mortgageBand:'unknown',
  longTermGoals:[],
});
const PROFILE_ENUMS = {
  medicalInsuranceStatus:new Set(['unknown','employee','resident','none']),
  employerMedicalStatus:new Set(['unknown','yes','no']),
  incomeResponsibility:new Set(['unknown','primary','shared','not_primary']),
  mortgageStatus:new Set(['unknown','yes','no']),
  mortgageBand:new Set(['unknown','under50','50_150','150_300','over300']),
};
const LONG_TERM_GOALS = new Set(['retirement','education','other']);

function positiveCustomerId(value) {
  const id=Number(value);
  if (!Number.isSafeInteger(id) || id<=0) throw new BadRequestException('客户编号无效');
  return id;
}

function parseJson(value,fallback) {
  if (value && typeof value==='object') return value;
  if (typeof value==='string') { try { return JSON.parse(value); } catch { return fallback; } }
  return fallback;
}

function normalizeProfile(input={}) {
  const source=input && typeof input==='object' && !Array.isArray(input) ? input : {};
  const profile={...DEFAULT_PROFILE};
  for (const [key,values] of Object.entries(PROFILE_ENUMS)) {
    const value=source[key] ?? profile[key];
    if (!values.has(value)) throw new BadRequestException(`保障检视资料中的${key}无效`);
    profile[key]=value;
  }
  if (source.dependentCount==='' || source.dependentCount==null) profile.dependentCount=null;
  else {
    const count=Number(source.dependentCount);
    if (!Number.isInteger(count) || count<0 || count>20) throw new BadRequestException('经济依赖人数请填写 0 至 20 的整数');
    profile.dependentCount=count;
  }
  const goals=Array.isArray(source.longTermGoals) ? source.longTermGoals : [];
  if (goals.some((goal)=>!LONG_TERM_GOALS.has(goal))) throw new BadRequestException('长期目标选项无效');
  profile.longTermGoals=[...new Set(goals)];
  return profile;
}

function safeExtraction(value,localFacts={}) {
  const extraction=parseJson(value,null);
  if (!extraction || typeof extraction!=='object') return null;
  const policy=extraction.policy && typeof extraction.policy==='object' ? extraction.policy : {};
  const facts=parseJson(localFacts,{});
  return {
    complete:Boolean(extraction.completeness?.complete),
    policy:{
      productName:String(policy.productName || '').slice(0,160),
      insuranceType:String(policy.insuranceType || '').slice(0,100),
      premium:String(policy.premium || '').slice(0,120),
      paymentTerm:String(policy.paymentTerm || '').slice(0,100),
      coveragePeriod:String(policy.coveragePeriod || '').slice(0,100),
      claimSummary:String(policy.claimSummary || '').slice(0,600),
      basicSumInsured:policy.basicSumInsured || facts.basicSumInsured || null,
    },
    benefits:(Array.isArray(extraction.benefits) ? extraction.benefits : []).slice(0,30).map((benefit)=>({
      name:String(benefit?.name || '').slice(0,100),summary:String(benefit?.summary || '').slice(0,240),
      amount:String(benefit?.amount || '').slice(0,140),paymentMethod:String(benefit?.paymentMethod || '').slice(0,100),
      conditions:String(benefit?.conditions || '').slice(0,240),page:Number.isInteger(Number(benefit?.page)) ? Number(benefit.page) : null,
    })),
    uncertainties:(Array.isArray(extraction.uncertainties) ? extraction.uncertainties : []).slice(0,15).map((item)=>String(item).slice(0,200)),
  };
}

export class CustomerCoverageOperations {
  async customerCoverageReview(customerIdValue) {
    const customerId=positiveCustomerId(customerIdValue);
    const customer=await this.db.query('SELECT id,name FROM customers WHERE id=$1',[customerId]);
    if (!customer.rows[0]) throw new NotFoundException('找不到这位客户');
    const [profileResult,policyResult,contractResult]=await Promise.all([
      this.db.query('SELECT profile_data,updated_at FROM customer_coverage_profiles WHERE customer_id=$1',[customerId]),
      this.db.query(`SELECT id,company,policy_name,insurance_type,premium,coverage_summary,verified,insured_name,holder_name,
        basic_sum_insured,contract_status,effective_date,expiry_date,next_payment_date,service_scope,updated_at
        FROM policies WHERE customer_id=$1 ORDER BY created_at DESC,id DESC`,[customerId]),
      this.db.query(`SELECT id,policy_id,file_name,storage_name,parse_status,analysis_status,extraction_data,local_facts,created_at
        FROM customer_policy_contracts WHERE customer_id=$1 AND coverage_excluded_at IS NULL ORDER BY created_at DESC,id DESC`,[customerId]),
    ]);
    const contracts=await Promise.all(contractResult.rows.map(async(row)=>{
      let evidence={facts:{},benefits:[]};
      try {
        evidence=await loadPolicyContractLocalEvidence({storageName:row.storage_name,fileName:row.file_name,parseStatus:row.parse_status});
      } catch {
        // Saved policy data stays visible if the original file is unavailable.
      }
      const facts=evidence.facts;
      const candidates=!row.policy_id && facts.productName && facts.effectiveDate
        ? policyResult.rows.filter((policy)=>normalizedPolicyName(policy.policy_name)===normalizedPolicyName(facts.productName)
          && pgDate(policy.effective_date)===facts.effectiveDate)
        : [];
      return {
        id:Number(row.id),policyId:row.policy_id ? Number(row.policy_id) : null,
        matchedPolicyId:candidates.length===1 ? Number(candidates[0].id) : null,
        fileName:row.file_name,analysisStatus:row.analysis_status,
        extraction:safeExtraction(row.extraction_data,row.local_facts),
        localPolicy:facts.productName ? {
          productName:facts.productName,company:facts.company || '',holderName:facts.holderName || '',
          insuredName:facts.insuredName || '',premium:facts.premium || '',effectiveDate:facts.effectiveDate || '',
          expiryDate:facts.expiryDate || '',basicSumInsured:facts.basicSumInsured || null,
        } : null,
        localBenefits:evidence.benefits,
        createdAt:row.created_at,
      };
    }));
    const contractByPolicy=new Map();
    for (const item of contracts) if (item.matchedPolicyId && !contractByPolicy.has(item.matchedPolicyId)) contractByPolicy.set(item.matchedPolicyId,item);
    for (const item of contracts) if (item.policyId) contractByPolicy.set(item.policyId,item);
    return {
      customer:{id:Number(customer.rows[0].id),name:customer.rows[0].name},
      profile:normalizeProfile(profileResult.rows[0]?.profile_data || {}),
      profileUpdatedAt:profileResult.rows[0]?.updated_at || null,
      policies:policyResult.rows.map((row)=>({
        id:Number(row.id),company:row.company,name:row.policy_name,type:row.insurance_type,
        premium:row.premium || '',coverageSummary:row.coverage_summary || '',verified:Boolean(row.verified),
        basicSumInsured:parseJson(row.basic_sum_insured,null) || contractByPolicy.get(Number(row.id))?.localPolicy?.basicSumInsured || contractByPolicy.get(Number(row.id))?.extraction?.policy?.basicSumInsured || null,
        contractId:contractByPolicy.get(Number(row.id))?.id || null,
        insuredName:row.insured_name || contractByPolicy.get(Number(row.id))?.localPolicy?.insuredName || '',
        holderName:row.holder_name || contractByPolicy.get(Number(row.id))?.localPolicy?.holderName || '',
        contractStatus:row.contract_status || 'unknown',
        effectiveDate:pgDate(row.effective_date),expiryDate:pgDate(row.expiry_date),nextPaymentDate:pgDate(row.next_payment_date),
        scope:row.service_scope,updatedAt:row.updated_at,
      })),
      contracts,
    };
  }

  async saveCustomerCoverageProfile(customerIdValue,body={}) {
    const customerId=positiveCustomerId(customerIdValue);
    const profile=normalizeProfile(body.profile || body);
    const customer=await this.db.query('SELECT id FROM customers WHERE id=$1',[customerId]);
    if (!customer.rows[0]) throw new NotFoundException('找不到这位客户');
    await this.db.query(`INSERT INTO customer_coverage_profiles(customer_id,profile_data,updated_at)
      VALUES($1,$2::jsonb,NOW()) ON CONFLICT(customer_id) DO UPDATE SET profile_data=EXCLUDED.profile_data,updated_at=NOW()`,
    [customerId,JSON.stringify(profile)]);
    return this.customerCoverageReview(customerId);
  }
}
