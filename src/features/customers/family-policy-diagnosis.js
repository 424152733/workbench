export const PERSONAL_COVERAGE_CATEGORIES = [
  {key:'medical',label:'医疗'},
  {key:'critical_illness',label:'重疾'},
  {key:'life',label:'寿险'},
  {key:'accident',label:'意外'},
];

const isCurrentVerifiedPolicy = (policy,today) => policy.verified && policy.contractStatus==='active' &&
  (!policy.effectiveDate || policy.effectiveDate<=today) && (!policy.expiryDate || policy.expiryDate>=today);
const needsReview = (policy,today) => !policy.verified || ['unknown','pending_effective'].includes(policy.contractStatus) ||
  (policy.contractStatus==='active' && ((policy.effectiveDate && policy.effectiveDate>today) || (policy.expiryDate && policy.expiryDate<today)));
const hasPersonalCoverage = (policy) => policy.coverageTags?.some((tag)=>PERSONAL_COVERAGE_CATEGORIES.some((category)=>category.key===tag));

export function buildFamilyPolicyDiagnosis(family,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())) {
  const policies=family?.policies || [];
  const members=(family?.members || []).map((member)=>{
    const insuredPolicies=policies.filter((policy)=>policy.people?.some((person)=>person.memberId===member.id && person.role==='insured'));
    const coverages=PERSONAL_COVERAGE_CATEGORIES.map((category)=>{
      const matching=insuredPolicies.filter((policy)=>policy.coverageTags?.includes(category.key));
      const verifiedCount=matching.filter((policy)=>isCurrentVerifiedPolicy(policy,today)).length;
      const pendingCount=matching.filter((policy)=>needsReview(policy,today)).length;
      const nonCurrentCount=matching.length-verifiedCount-pendingCount;
      return {...category,status:verifiedCount?'recorded':pendingCount?'review':nonCurrentCount?'noncurrent':'none',verifiedCount,pendingCount,nonCurrentCount};
    });
    return {...member,insuredPolicyCount:insuredPolicies.length,coverages};
  });
  const unassignedInsuredPolicyCount=policies.filter((policy)=>hasPersonalCoverage(policy) && !policy.people?.some((person)=>person.role==='insured')).length;
  const unclassifiedPolicyCount=policies.filter((policy)=>!policy.coverageTags?.length).length;
  const reviewPolicyCount=policies.filter((policy)=>!isCurrentVerifiedPolicy(policy,today)).length;
  const propertyPolicies=policies.filter((policy)=>policy.coverageTags?.some((tag)=>tag==='auto' || tag==='home'));
  const unlinkedPropertyPolicyCount=propertyPolicies.filter((policy)=>!policy.insuredObjectIds?.length).length;
  return {members,policyCount:policies.length,unassignedInsuredPolicyCount,unclassifiedPolicyCount,reviewPolicyCount,
    propertyPolicyCount:propertyPolicies.length,unlinkedPropertyPolicyCount};
}
