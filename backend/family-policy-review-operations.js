import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beijingDate, pgDate } from './workbench-primitives.js';
import { buildPolicyOrganizerWorkbook, policyCoverageAmounts } from './policy-organizer-export-operations.js';

const categoryLabels={
  critical:'重疾',life:'身故责任',accidentAmount:'意外身故',accidentMedical:'意外门急诊',
  hospitalization:'住院报销',allowance:'住院津贴',financial:'长期资金',
};
const categoryKeys=Object.keys(categoryLabels);
const id=(value,label)=>{
  const result=Number(value);
  if (!Number.isSafeInteger(result)||result<=0) throw new BadRequestException(`${label}无效`);
  return result;
};
const ids=(values,label)=>{
  if (!Array.isArray(values)) throw new BadRequestException(`请选择${label}`);
  return [...new Set(values.map((value)=>id(value,label)))];
};
const json=(value,fallback={})=>{
  if (value && typeof value==='object') return value;
  if (typeof value==='string') {try{return JSON.parse(value);}catch{return fallback;}}
  return fallback;
};
const clean=(value,length=120)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,length);
const filename=(value)=>clean(value,60).replace(/[\\/:*?"<>|]/g,'_')||'家庭';
const annualPremium=(value)=>{
  const text=String(value||'').replaceAll(',','');
  const match=text.match(/(?:每年|年交|年缴)\s*(\d+(?:\.\d+)?)\s*元/);
  return match?Number(match[1]):null;
};
const timing=(record,today)=>{
  if (record.contractStatus==='terminated'||record.contractStatus==='suspended'||record.contractStatus==='expired') return 'inactive';
  if (record.expiryDate&&record.expiryDate<today) return 'inactive';
  if (record.effectiveDate&&record.effectiveDate>today) return 'pending';
  return record.verified&&record.contractStatus==='active'?'current':'pending';
};
const sourceCategories=(record)=>{
  const keys=categoryKeys.filter((key)=>Number.isFinite(record.amounts[key])&&record.amounts[key]>0);
  const type=`${record.name} ${record.type}`;
  if (/重疾|重大疾病|轻症|中症/.test(type)) keys.push('critical');
  if (/终身寿|定期寿|寿险/.test(type)) keys.push('life');
  if (/意外/.test(type)&&!/医疗|门诊/.test(type)) keys.push('accidentAmount');
  if (/意外.*(?:门诊|门急诊|医疗)/.test(type)) keys.push('accidentMedical');
  if (/医疗|住院/.test(type)) keys.push('hospitalization');
  if (/年金|增额.*终身寿/.test(type)) keys.push('financial');
  return [...new Set(keys)];
};

export class FamilyPolicyReviewOperations {
  async familyContractCandidates(familyIdValue) {
    const family=await this.family(id(familyIdValue,'家庭编号'));
    const customerIds=family.members.map((item)=>item.customerId).filter(Boolean);
    if (!customerIds.length) return [];
    const {rows}=await this.db.query(`SELECT d.id,d.customer_id,d.file_name,d.analysis_status,d.policy_id,
      fc.contract_id IS NOT NULL AS linked
      FROM customer_policy_contracts d
      LEFT JOIN family_contracts fc ON fc.contract_id=d.id AND fc.family_id=$1
      WHERE d.customer_id=ANY($2::bigint[]) AND d.coverage_excluded_at IS NULL
      ORDER BY d.created_at DESC,d.id DESC`,[family.id,customerIds]);
    return rows.map((row)=>({id:Number(row.id),customerId:Number(row.customer_id),fileName:row.file_name,
      analysisStatus:row.analysis_status,policyId:row.policy_id?Number(row.policy_id):null,linked:row.linked}));
  }

  async linkFamilyContract(familyIdValue,contractIdValue,body={}) {
    const familyId=id(familyIdValue,'家庭编号'),contractId=id(contractIdValue,'合同编号');
    const holderMemberIds=ids(body.holderMemberIds||[],'投保人'),insuredMemberIds=ids(body.insuredMemberIds||[],'被保险人');
    await this.db.transaction(async(client)=>{
      const contract=await client.query(`SELECT d.id,d.policy_id FROM customer_policy_contracts d
        JOIN family_members fm ON fm.family_id=$1 AND fm.customer_id=d.customer_id
        WHERE d.id=$2 AND d.coverage_excluded_at IS NULL`,[familyId,contractId]);
      if (!contract.rows[0]) throw new NotFoundException('合同不属于本家庭已建档成员，或已从保障检视移除');
      const memberIds=[...new Set([...holderMemberIds,...insuredMemberIds])];
      if (memberIds.length) {
        const valid=await client.query('SELECT id FROM family_members WHERE family_id=$1 AND id=ANY($2::bigint[])',[familyId,memberIds]);
        if (valid.rows.length!==memberIds.length) throw new BadRequestException('投保人和被保险人必须是当前家庭成员');
      }
      await client.query('INSERT INTO family_contracts(family_id,contract_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[familyId,contractId]);
      await client.query('DELETE FROM family_contract_people WHERE family_id=$1 AND contract_id=$2',[familyId,contractId]);
      for (const [role,values] of [['holder',holderMemberIds],['insured',insuredMemberIds]]) {
        for (const memberId of values) await client.query(
          'INSERT INTO family_contract_people(family_id,contract_id,member_id,role) VALUES($1,$2,$3,$4)',
          [familyId,contractId,memberId,role]);
      }
      if (contract.rows[0].policy_id) {
        const policyId=Number(contract.rows[0].policy_id);
        await client.query('INSERT INTO family_policies(family_id,policy_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[familyId,policyId]);
        await client.query('DELETE FROM family_policy_people WHERE family_id=$1 AND policy_id=$2',[familyId,policyId]);
        for (const [role,values] of [['holder',holderMemberIds],['insured',insuredMemberIds]]) {
          for (const memberId of values) await client.query(
            'INSERT INTO family_policy_people(family_id,policy_id,member_id,role) VALUES($1,$2,$3,$4)',
            [familyId,policyId,memberId,role]);
        }
      }
    });
    return {linked:true,contractId};
  }

  async unlinkFamilyContract(familyIdValue,contractIdValue) {
    const familyId=id(familyIdValue,'家庭编号'),contractId=id(contractIdValue,'合同编号');
    const {rows}=await this.db.query('DELETE FROM family_contracts WHERE family_id=$1 AND contract_id=$2 RETURNING contract_id',[familyId,contractId]);
    if (!rows[0]) throw new NotFoundException('这份合同尚未纳入该家庭');
    return {linked:false,contractId};
  }

  async unlinkFamilyPolicySource(familyIdValue,body={}) {
    const familyId=id(familyIdValue,'家庭编号');
    const policyId=body.policyId==null?null:id(body.policyId,'保单编号');
    const contractId=body.contractId==null?null:id(body.contractId,'合同编号');
    const contractIds=[...new Set([...ids(body.contractIds||[],'合同编号'),...(contractId?[contractId]:[])])];
    if (!policyId&&!contractIds.length) throw new BadRequestException('请选择要取消关联的家庭保单或合同');
    return this.db.transaction(async(client)=>{
      let removedContracts=0,removedPolicies=0;
      if (policyId) {
        const contracts=await client.query(`DELETE FROM family_contracts fc USING customer_policy_contracts d
          WHERE fc.family_id=$1 AND fc.contract_id=d.id AND d.policy_id=$2 RETURNING fc.contract_id`,[familyId,policyId]);
        removedContracts+=contracts.rows.length;
        const policies=await client.query('DELETE FROM family_policies WHERE family_id=$1 AND policy_id=$2 RETURNING policy_id',[familyId,policyId]);
        removedPolicies=policies.rows.length;
      }
      if (contractIds.length) {
        const contracts=await client.query('DELETE FROM family_contracts WHERE family_id=$1 AND contract_id=ANY($2::bigint[]) RETURNING contract_id',[familyId,contractIds]);
        removedContracts+=contracts.rows.length;
      }
      if (!removedContracts&&!removedPolicies) throw new NotFoundException('这份保单或合同尚未关联到该家庭');
      return {unlinked:true,removedContracts,removedPolicies};
    });
  }

  async uploadFamilyContract(familyIdValue,body,file) {
    const family=await this.family(id(familyIdValue,'家庭编号'));
    const customerId=id(body?.customerId||family.primaryCustomerId,'资料所属客户');
    if (!family.members.some((member)=>member.customerId===customerId)) throw new BadRequestException('资料所属客户须属于本家庭');
    const uploaded=await this.uploadPolicyContract(customerId,file);
    try {
      const multipartIds=(value)=>{
        if(Array.isArray(value)) return value;
        try{return JSON.parse(value||'[]');}catch{throw new BadRequestException('成员归属格式无效');}
      };
      await this.linkFamilyContract(family.id,uploaded.id,{
        holderMemberIds:multipartIds(body?.holderMemberIds),insuredMemberIds:multipartIds(body?.insuredMemberIds)});
    } catch(error) {
      await this.deletePolicyContract(customerId,uploaded.id).catch(()=>{});
      throw error;
    }
    return uploaded;
  }

  async saveFamilyCoverageContext(familyIdValue,body={}) {
    const family=await this.family(id(familyIdValue,'家庭编号'));
    const mainIncomeMemberIds=ids(body.mainIncomeMemberIds||[],'主要收入承担成员');
    const dependentMemberIds=ids(body.dependentMemberIds||[],'经济依赖成员');
    const valid=new Set(family.members.map((member)=>member.id));
    if ([...mainIncomeMemberIds,...dependentMemberIds].some((memberId)=>!valid.has(memberId))) throw new BadRequestException('请选择当前家庭成员');
    const context={mainIncomeMemberIds,dependentMemberIds,debtStatus:['yes','no','unknown'].includes(body.debtStatus)?body.debtStatus:'unknown',
      longTermGoals:[...new Set((Array.isArray(body.longTermGoals)?body.longTermGoals:[]).filter((goal)=>['retirement','education','other'].includes(goal)))]};
    await this.db.query(`INSERT INTO family_coverage_context(family_id,context_data) VALUES($1,$2::jsonb)
      ON CONFLICT(family_id) DO UPDATE SET context_data=EXCLUDED.context_data,updated_at=NOW()`,[family.id,JSON.stringify(context)]);
    return context;
  }

  async saveFamilyMemberCoverageProfile(familyIdValue,memberIdValue,body={}) {
    const family=await this.family(id(familyIdValue,'家庭编号'));
    const member=family.members.find((item)=>item.id===id(memberIdValue,'成员编号'));
    if (!member) throw new NotFoundException('找不到这个家庭成员');
    if (!member.isGuest) throw new BadRequestException('已建档成员请在客户详情更新个人保障资料');
    const profile={medicalInsuranceStatus:['unknown','employee','resident','none'].includes(body.medicalInsuranceStatus)
      ? body.medicalInsuranceStatus:'unknown',employerMedicalStatus:['unknown','yes','no'].includes(body.employerMedicalStatus)
      ? body.employerMedicalStatus:'unknown'};
    await this.db.query(`INSERT INTO family_member_coverage_profiles(family_id,member_id,profile_data) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(family_id,member_id) DO UPDATE SET profile_data=EXCLUDED.profile_data,updated_at=NOW()`,
    [family.id,member.id,JSON.stringify(profile)]);
    return profile;
  }

  async familyPolicyReview(familyIdValue) {
    const family=await this.family(id(familyIdValue,'家庭编号'));
    const today=beijingDate(),customerIds=[...new Set(family.members.map((member)=>member.customerId).filter(Boolean))];
    const [linksResult,peopleResult,contextResult,guestProfilesResult,customerReviews]=await Promise.all([
      this.db.query('SELECT contract_id FROM family_contracts WHERE family_id=$1',[family.id]),
      this.db.query('SELECT contract_id,member_id,role FROM family_contract_people WHERE family_id=$1',[family.id]),
      this.db.query('SELECT context_data FROM family_coverage_context WHERE family_id=$1',[family.id]),
      this.db.query('SELECT member_id,profile_data FROM family_member_coverage_profiles WHERE family_id=$1',[family.id]),
      Promise.all(customerIds.map((customerId)=>this.customerCoverageReview(customerId))),
    ]);
    const reviews=new Map(customerReviews.map((review)=>[review.customer.id,review]));
    const contracts=new Map(customerReviews.flatMap((review)=>review.contracts.map((contract)=>[contract.id,contract])));
    const linkedContracts=new Set(linksResult.rows.map((row)=>Number(row.contract_id)));
    const peopleByContract=new Map();
    for(const row of peopleResult.rows) {
      const entries=peopleByContract.get(Number(row.contract_id))||[];
      entries.push({memberId:Number(row.member_id),role:row.role});
      peopleByContract.set(Number(row.contract_id),entries);
    }
    const sources=new Map();
    const makeSource=(policy,contract,people,ownerCustomerId)=>{
      const record={id:policy?.id||`contract-${contract.id}`,contractId:contract?.id||null,
        familyContractLinked:Boolean(contract&&linkedContracts.has(contract.id)),
        linkedContractIds:contract&&linkedContracts.has(contract.id)?[contract.id]:[],
        customerId:policy?.customerId||contract?.customerId||ownerCustomerId||null,
        name:policy?.name||contract?.localPolicy?.productName||contract?.extraction?.policy?.productName||'待识别产品',
        type:policy?.type||contract?.extraction?.policy?.insuranceType||'',
        company:policy?.company||contract?.localPolicy?.company||'',
        insuredMemberIds:[...new Set(people.filter((item)=>item.role==='insured').map((item)=>item.memberId))],
        holderMemberIds:[...new Set(people.filter((item)=>item.role==='holder').map((item)=>item.memberId))],
        premium:policy?.premium||contract?.localPolicy?.premium||'',
        basicSumInsured:policy?.basicSumInsured||contract?.localPolicy?.basicSumInsured||null,
        effectiveDate:policy?.effectiveDate||contract?.localPolicy?.effectiveDate||'',
        expiryDate:policy?.expiryDate||contract?.localPolicy?.expiryDate||'',
        verified:Boolean(policy?.verified),contractStatus:policy?.contractStatus||'unknown',
        benefits:contract?.localBenefits?.length?contract.localBenefits:contract?.extraction?.benefits||[],
        fileName:contract?.fileName||'',isProvisional:!policy};
      record.insuranceType=record.type;
      record.status=timing(record,today);
      record.amounts=policyCoverageAmounts(record);
      record.categories=sourceCategories(record);
      record.sharedInsuredLimit=record.insuredMemberIds.length>1;
      return record;
    };
    for(const linked of family.policies) {
      const review=reviews.get(linked.customerId);
      const policy=review?.policies.find((item)=>item.id===linked.id);
      const matchingContracts=review?.contracts.filter((item)=>item.policyId===linked.id||item.matchedPolicyId===linked.id)||[];
      const contract=matchingContracts.find((item)=>linkedContracts.has(item.id))||matchingContracts[0];
      // The archived policy assignment is authoritative after it is edited in
      // the family workspace. A linked PDF can carry an older assignment.
      const source=makeSource(policy||linked,contract,linked.people,linked.customerId);
      source.linkedContractIds=matchingContracts.filter((item)=>linkedContracts.has(item.id)).map((item)=>item.id);
      sources.set(`policy:${linked.id}`,source);
    }
    for(const contractId of linkedContracts) {
      const contract=contracts.get(contractId);
      if (!contract) continue;
      const ownerReview=customerReviews.find((review)=>review.contracts.some((item)=>item.id===contractId));
      const policyId=contract.policyId||contract.matchedPolicyId;
      const policy=policyId?ownerReview?.policies.find((item)=>item.id===policyId):null;
      const key=policyId?`policy:${policyId}`:`contract:${contractId}`;
      if (!sources.has(key)) sources.set(key,makeSource(policy,contract,peopleByContract.get(contractId)||[],ownerReview?.customer.id));
      else {
        const source=sources.get(key);
        if (!source.linkedContractIds.includes(contractId)) source.linkedContractIds.push(contractId);
      }
    }
    const records=[...sources.values()];
    const guestProfiles=new Map(guestProfilesResult.rows.map((row)=>[Number(row.member_id),json(row.profile_data)]));
    const memberNameCounts=new Map();
    for(const member of family.members) memberNameCounts.set(member.name,(memberNameCounts.get(member.name)||0)+1);
    const members=family.members.map((member)=>{
      const profile=member.customerId?reviews.get(member.customerId)?.profile||{}:guestProfiles.get(member.id)||{};
      const related=records.filter((record)=>record.insuredMemberIds.includes(member.id));
      const coverages=categoryKeys.map((key)=>{
        const matching=related.filter((record)=>record.categories.includes(key));
        const current=matching.filter((record)=>record.status==='current'&&!record.sharedInsuredLimit);
        const pending=matching.filter((record)=>record.status==='pending'||record.sharedInsuredLimit&&record.status==='current');
        // A daily allowance and a long-term cash-flow product have different
        // payout bases; their policy face values are not a household cash sum.
        const amountIsAdditive=key!=='allowance'&&key!=='financial';
        const total=amountIsAdditive?current.reduce((sum,record)=>sum+(Number(record.amounts[key])||0),0):0;
        return {key,label:categoryLabels[key],currentCount:current.length,pendingCount:pending.length,
          inactiveCount:matching.length-current.length-pending.length,amount:total||null,
          pendingAmount:amountIsAdditive?pending.reduce((sum,record)=>sum+(Number(record.amounts[key])||0),0)||null:null};
      });
      return {...member,displayName:memberNameCounts.get(member.name)>1?`${member.name}（成员 ${member.id}）`:member.name,
        profile,coverages,sourceCount:related.length};
    });
    const context={mainIncomeMemberIds:[],dependentMemberIds:[],debtStatus:'unknown',longTermGoals:[],
      ...json(contextResult.rows[0]?.context_data)};
    const currentMemberIds=new Set(members.map((member)=>member.id));
    context.mainIncomeMemberIds=(Array.isArray(context.mainIncomeMemberIds)?context.mainIncomeMemberIds:[]).filter((memberId)=>currentMemberIds.has(memberId));
    context.dependentMemberIds=(Array.isArray(context.dependentMemberIds)?context.dependentMemberIds:[]).filter((memberId)=>currentMemberIds.has(memberId));
    const recommendations=[];
    if(records.length) {
      for(const member of members) {
        const medical=member.coverages.find((item)=>item.key==='hospitalization');
        if(['unknown','none'].includes(member.profile.medicalInsuranceStatus)||!medical?.currentCount) recommendations.push({
          memberId:member.id,kind:'medical',title:`核对${member.name}的医保和住院医疗`,
          reason:member.profile.medicalInsuranceStatus==='none'?'当前资料记录为未参保医保，需确认是否还有其他医疗费用保障。':'当前家庭资料未同时确认医保状态及有效住院医疗费用保障。',
          next:'确认医保、单位福利、系统外保单及医疗合同续保状态。'});
        const life=member.coverages.find((item)=>item.key==='life');
        if(context.mainIncomeMemberIds.includes(member.id)&&context.dependentMemberIds.length&&!life?.currentCount)
          recommendations.push({memberId:member.id,kind:'life',title:`核对${member.name}的家庭兜底`,
            reason:'已标记为主要收入承担者，当前没有已确认有效的身故责任记录。',
            next:'核对现有保单状态、家庭必要支出和负债，再讨论兜底安排。'});
      }
      if(context.longTermGoals.length&&!records.some((record)=>record.status==='current'&&record.categories.includes('financial')))
        recommendations.push({kind:'financial',title:'核对长期现金流安排',
          reason:'家庭已记录长期目标，当前没有已确认有效的年金或增额寿记录。',
          next:'先核对领取对象、目标时间、社保及系统外安排。'});
    }
    const uniqueCurrent=records.filter((record)=>record.status==='current');
    const annual=uniqueCurrent.map((record)=>annualPremium(record.premium)).filter((value)=>value!==null);
    return {family:{id:family.id,name:family.name,primaryCustomerId:family.primaryCustomerId},
      members,records,context,recommendations,summary:{sourceCount:records.length,
        currentCount:uniqueCurrent.length,pendingCount:records.filter((record)=>record.status==='pending').length,
        inactiveCount:records.filter((record)=>record.status==='inactive').length,
        unassignedCount:records.filter((record)=>!record.insuredMemberIds.length).length,
        annualPremiumTotal:annual.reduce((sum,value)=>sum+value,0),annualPremiumCount:annual.length},asOfDate:today};
  }

  async exportFamilyPolicyOrganizer(familyIdValue) {
    const review=await this.familyPolicyReview(familyIdValue);
    const customerIds=[...new Set(review.members.map((member)=>member.customerId).filter(Boolean))];
    const prepared=await Promise.all(customerIds.map((customerId)=>this.preparePolicyOrganizerData(customerId)));
    const byPolicy=new Map(review.records.filter((record)=>Number.isSafeInteger(record.id))
      .map((record)=>[record.id,record]));
    const byContract=new Map(review.records.filter((record)=>record.contractId)
      .map((record)=>[record.contractId,record]));
    const selected=new Map();
    for (const bundle of prepared) for (const record of bundle.records) {
      const familyRecord=byPolicy.get(record.id) || record.sourceContractIds.map((contractId)=>byContract.get(contractId)).find(Boolean);
      if (!familyRecord) continue;
      const insuredMemberNames=familyRecord.insuredMemberIds.map((memberId)=>review.members.find((member)=>member.id===memberId)?.displayName).filter(Boolean);
      const holderMemberNames=familyRecord.holderMemberIds.map((memberId)=>review.members.find((member)=>member.id===memberId)?.displayName).filter(Boolean);
      selected.set(record.id,{
        ...record,insuredMemberNames,
        insuredName:insuredMemberNames.length?insuredMemberNames.join('、'):record.insuredName || '被保险人待确认',
        holderName:holderMemberNames.length?holderMemberNames.join('、'):record.holderName,
      });
    }
    const members=review.members.map((member)=>({
      ...member,phone:prepared.find((bundle)=>bundle.customer.id===member.customerId)?.customer.phone || '',
    }));
    const {workbook}=buildPolicyOrganizerWorkbook({
      customer:{name:review.family.name,phone:''},members,records:[...selected.values()],preparedOn:review.asOfDate,
    });
    return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName:`${filename(review.family.name)}_家庭保单整理_${review.asOfDate}.xlsx`};
  }

}
