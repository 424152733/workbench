import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beijingDate, cleanText, maskPhone, maskPolicyNumber, pgDate } from './workbench-primitives.js';

const RELATION_KINDS = new Set(['partner','parent_child','sibling','other']);
const OBJECT_KINDS = new Set(['vehicle','home','property','other']);
const COVERAGE_TAGS = new Set(['medical','critical_illness','life','accident','auto','home','other']);
const OPEN_SERVICE_STATUSES = ['pending','in_progress','waiting_customer','waiting_insurer'];

function positiveId(value,label='编号') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException(`${label}无效`);
  return id;
}

const numberId = (value) => value == null ? null : Number(value);

export class FamilyCoverageOperations {
  async listFamilies({search=''}={}) {
    const value = cleanText(search,'搜索内容',100);
    const params = value ? [`%${value}%`] : [];
    const filter = value ? 'WHERE f.name ILIKE $1 OR primary_member.display_name ILIKE $1' : '';
    const {rows} = await this.db.query(`SELECT f.id,f.name,f.primary_customer_id,f.created_at,f.updated_at,
      primary_member.display_name AS primary_customer_name,
      (SELECT COUNT(*)::int FROM family_members fm WHERE fm.family_id=f.id) AS member_count,
      (SELECT COUNT(*)::int FROM family_policies fp WHERE fp.family_id=f.id) AS policy_count,
      (SELECT COUNT(*)::int FROM family_policies fp JOIN policies p ON p.id=fp.policy_id
        WHERE fp.family_id=f.id AND p.verified=FALSE) AS unverified_count
      FROM families f
      JOIN LATERAL (
        SELECT COALESCE(c.name,fm.guest_name) AS display_name
        FROM family_members fm LEFT JOIN customers c ON c.id=fm.customer_id
        WHERE fm.family_id=f.id AND fm.customer_id=f.primary_customer_id LIMIT 1
      ) primary_member ON TRUE
      ${filter} ORDER BY f.updated_at DESC,f.id DESC`,params);
    return rows.map((row) => ({id:Number(row.id),name:row.name,primaryCustomerId:Number(row.primary_customer_id),
      primaryCustomerName:row.primary_customer_name,memberCount:row.member_count,policyCount:row.policy_count,
      unverifiedCount:row.unverified_count,createdAt:row.created_at,updatedAt:row.updated_at}));
  }

  async createFamily(body={}) {
    const name = cleanText(body.name,'家庭名称',100,{required:true});
    const customerId = positiveId(body.primaryCustomerId,'主要服务联系人');
    const id = await this.db.transaction(async (client) => {
      const customer = await client.query('SELECT id FROM customers WHERE id=$1',[customerId]);
      if (!customer.rows[0]) throw new NotFoundException('找不到主要服务联系人');
      const family = await client.query('INSERT INTO families(name,primary_customer_id) VALUES($1,$2) RETURNING id',[name,customerId]);
      await client.query('INSERT INTO family_members(family_id,customer_id) VALUES($1,$2)',[family.rows[0].id,customerId]);
      return Number(family.rows[0].id);
    });
    return this.family(id);
  }

  async family(id) {
    const familyId = positiveId(id,'家庭编号');
    const {rows:familyRows} = await this.db.query(`SELECT f.id,f.name,f.primary_customer_id,f.created_at,f.updated_at,
      c.name AS primary_customer_name FROM families f JOIN customers c ON c.id=f.primary_customer_id WHERE f.id=$1`,[familyId]);
    const row = familyRows[0];
    if (!row) throw new NotFoundException('找不到这个家庭');
    const [memberResult,relationshipResult,objectResult,policyResult] = await Promise.all([
      this.db.query(`SELECT fm.id,fm.family_id,fm.customer_id,fm.guest_name,fm.note,fm.created_at,
        c.name,c.phone,c.stage,COALESCE(sd.label,'未记录') AS source,c.contact_status
        FROM family_members fm LEFT JOIN customers c ON c.id=fm.customer_id
        LEFT JOIN source_dictionary sd ON sd.code=c.source_code
        WHERE fm.family_id=$1 ORDER BY (fm.customer_id=$2) DESC,COALESCE(c.name,fm.guest_name),fm.id`,[familyId,row.primary_customer_id]),
      this.db.query(`SELECT id,family_id,member_a_id,member_b_id,kind,label,created_at,updated_at
        FROM family_relationships WHERE family_id=$1 ORDER BY id`,[familyId]),
      this.db.query(`SELECT id,family_id,kind,display_name,note,created_at,updated_at
        FROM family_insured_objects WHERE family_id=$1 ORDER BY kind,display_name,id`,[familyId]),
      this.db.query(`SELECT p.*,c.name AS customer_name,c.source_code,c.stage,c.contact_status
        FROM family_policies fp JOIN policies p ON p.id=fp.policy_id
        JOIN customers c ON c.id=p.customer_id WHERE fp.family_id=$1 ORDER BY p.updated_at DESC,p.id DESC`,[familyId]),
    ]);
    const members = memberResult.rows.map((item) => ({id:Number(item.id),familyId:Number(item.family_id),
      customerId:numberId(item.customer_id),name:item.name || item.guest_name,isGuest:item.customer_id == null,
      guestName:item.guest_name,note:item.note || '',phone:maskPhone(item.phone),stage:item.stage || '',source:item.source || '未记录',
      contact:item.contact_status || '',isPrimary:String(item.customer_id)===String(row.primary_customer_id)}));
    const relationships = relationshipResult.rows.map((item) => ({id:Number(item.id),familyId:Number(item.family_id),
      memberAId:Number(item.member_a_id),memberBId:Number(item.member_b_id),kind:item.kind,label:item.label,
      createdAt:item.created_at,updatedAt:item.updated_at}));
    const insuredObjects = objectResult.rows.map((item) => ({id:Number(item.id),familyId:Number(item.family_id),
      kind:item.kind,name:item.display_name,note:item.note,createdAt:item.created_at,updatedAt:item.updated_at}));
    const policyIds = policyResult.rows.map((item) => Number(item.id));
    const [peopleResult,objectLinksResult,tagsResult,serviceResult] = policyIds.length ? await Promise.all([
      this.db.query(`SELECT family_id,policy_id,member_id,role FROM family_policy_people
        WHERE family_id=$1 AND policy_id=ANY($2::bigint[]) ORDER BY member_id,role`,[familyId,policyIds]),
      this.db.query(`SELECT family_id,policy_id,object_id FROM family_policy_objects
        WHERE family_id=$1 AND policy_id=ANY($2::bigint[]) ORDER BY object_id`,[familyId,policyIds]),
      this.db.query(`SELECT policy_id,tag FROM family_policy_coverage_tags WHERE family_id=$1 AND policy_id=ANY($2::bigint[]) ORDER BY tag`,[familyId,policyIds]),
      this.db.query(`SELECT s.id,s.policy_id,s.kind,s.title,s.description,s.status,s.anchor_date,s.next_action_date,
        s.created_at,p.policy_name,p.company,p.customer_id,c.name AS customer_name
        FROM policy_service_items s JOIN policies p ON p.id=s.policy_id JOIN customers c ON c.id=p.customer_id
        WHERE s.policy_id=ANY($1::bigint[]) AND s.status=ANY($2::text[])
        ORDER BY s.next_action_date,s.id`,[policyIds,OPEN_SERVICE_STATUSES]),
    ]) : [{rows:[]},{rows:[]},{rows:[]},{rows:[]}];
    const peopleByPolicy = new Map();
    for (const item of peopleResult.rows) {
      const values = peopleByPolicy.get(Number(item.policy_id)) || [];
      values.push({memberId:Number(item.member_id),role:item.role});
      peopleByPolicy.set(Number(item.policy_id),values);
    }
    const objectsByPolicy = new Map();
    for (const item of objectLinksResult.rows) {
      const values = objectsByPolicy.get(Number(item.policy_id)) || [];
      values.push(Number(item.object_id));
      objectsByPolicy.set(Number(item.policy_id),values);
    }
    const tagsByPolicy = new Map();
    for (const item of tagsResult.rows) {
      const values = tagsByPolicy.get(Number(item.policy_id)) || [];
      values.push(item.tag);
      tagsByPolicy.set(Number(item.policy_id),values);
    }
    const policies = policyResult.rows.map((item) => ({id:Number(item.id),customerId:Number(item.customer_id),
      customerName:item.customer_name,company:item.company,name:item.policy_name,type:item.insurance_type,
      policyNumber:maskPolicyNumber(item.policy_number),holderName:item.holder_name || '',insuredName:item.insured_name || '',
      premium:item.premium || '',amount:item.basic_sum_insured?.amount ? `${item.basic_sum_insured.label || '基本保险金额'}：${item.basic_sum_insured.amount}` : item.coverage_summary || '',
      basicSumInsured:item.basic_sum_insured || null,verified:Boolean(item.verified),
      state:item.verified?'已核实':'待核实',scope:item.service_scope,contractStatus:item.contract_status,
      effectiveDate:pgDate(item.effective_date),expiryDate:pgDate(item.expiry_date),nextPaymentDate:pgDate(item.next_payment_date),
      people:peopleByPolicy.get(Number(item.id)) || [],insuredObjectIds:objectsByPolicy.get(Number(item.id)) || [],
      coverageTags:tagsByPolicy.get(Number(item.id)) || []}));
    const services = serviceResult.rows.map((item) => ({id:Number(item.id),policyId:Number(item.policy_id),
      customerId:Number(item.customer_id),customerName:item.customer_name,policyName:item.policy_name,company:item.company,
      kind:item.kind,title:item.title,description:item.description,status:item.status,anchorDate:pgDate(item.anchor_date),
      nextActionDate:pgDate(item.next_action_date),bucket:item.next_action_date < beijingDate()?'overdue':
        item.next_action_date === beijingDate()?'today':'upcoming'}));
    return {id:Number(row.id),name:row.name,primaryCustomerId:Number(row.primary_customer_id),
      primaryCustomerName:row.primary_customer_name,members,relationships,insuredObjects,policies,services,
      stats:{memberCount:members.length,policyCount:policies.length,
        unverifiedCount:policies.filter((item)=>!item.verified).length,
        unassignedCount:policies.filter((item)=>!item.people.length && !item.insuredObjectIds.length).length,
        openServiceCount:services.length},createdAt:row.created_at,updatedAt:row.updated_at};
  }

  async updateFamily(id,body={}) {
    const familyId = positiveId(id,'家庭编号');
    const name = body.name === undefined ? undefined : cleanText(body.name,'家庭名称',100,{required:true});
    const customerId = body.primaryCustomerId === undefined ? undefined : positiveId(body.primaryCustomerId,'主要服务联系人');
    if (name === undefined && customerId === undefined) throw new BadRequestException('没有可保存的家庭修改');
    await this.db.transaction(async (client) => {
      const current = await client.query('SELECT id,primary_customer_id FROM families WHERE id=$1 FOR UPDATE',[familyId]);
      if (!current.rows[0]) throw new NotFoundException('找不到这个家庭');
      if (customerId !== undefined) {
        const member = await client.query('SELECT id FROM family_members WHERE family_id=$1 AND customer_id=$2',[familyId,customerId]);
        if (!member.rows[0]) throw new BadRequestException('主要服务联系人必须是本家庭的已建档成员');
      }
      await client.query('UPDATE families SET name=COALESCE($2,name),primary_customer_id=COALESCE($3,primary_customer_id),updated_at=NOW() WHERE id=$1',
        [familyId,name ?? null,customerId ?? null]);
    });
    return this.family(familyId);
  }

  async deleteFamily(id) {
    const familyId = positiveId(id,'家庭编号');
    const result = await this.db.query('DELETE FROM families WHERE id=$1 RETURNING id',[familyId]);
    if (!result.rows[0]) throw new NotFoundException('找不到这个家庭');
    return {id:familyId};
  }

  async customerFamilies(customerId) {
    const id = positiveId(customerId,'客户编号');
    const exists = await this.db.query('SELECT id FROM customers WHERE id=$1',[id]);
    if (!exists.rows[0]) throw new NotFoundException('找不到这个客户');
    const {rows} = await this.db.query(`SELECT f.id,f.name,f.primary_customer_id,
      primary_customer.name AS primary_customer_name,
      (SELECT COUNT(*)::int FROM family_members fm WHERE fm.family_id=f.id) AS member_count,
      (SELECT COUNT(*)::int FROM family_policies fp WHERE fp.family_id=f.id) AS policy_count
      FROM family_members mine JOIN families f ON f.id=mine.family_id
      JOIN customers primary_customer ON primary_customer.id=f.primary_customer_id
      WHERE mine.customer_id=$1 ORDER BY f.updated_at DESC`,[id]);
    return rows.map((item)=>({id:Number(item.id),name:item.name,primaryCustomerId:Number(item.primary_customer_id),
      primaryCustomerName:item.primary_customer_name,memberCount:item.member_count,policyCount:item.policy_count}));
  }

  async lookupCustomers({search=''}={}) {
    const value = String(search || '').trim() ? cleanText(search,'搜索内容',100,{required:true}) : '';
    const params = [];
    let where = '';
    if (value) {
      const digits = value.replace(/\D/g,'');
      params.push(`%${value}%`);
      const phoneClause = digits ? ' OR c.phone_normalized LIKE $2' : '';
      if (digits) params.push(`%${digits}%`);
      where = `WHERE c.name ILIKE $1${phoneClause}`;
    }
    const {rows} = await this.db.query(`SELECT c.id,c.name,c.stage,COALESCE(sd.label,c.source_code) AS source
      FROM customers c LEFT JOIN source_dictionary sd ON sd.code=c.source_code
      ${where} ORDER BY c.updated_at DESC,c.id DESC LIMIT 20`,params);
    return rows.map((item)=>({id:Number(item.id),name:item.name,stage:item.stage,source:item.source}));
  }

  async addFamilyMember(familyId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const customerId = body.customerId == null ? null : positiveId(body.customerId,'客户编号');
    const guestName = body.guestName == null ? null : cleanText(body.guestName,'成员称呼',100,{required:true});
    if (Boolean(customerId) === Boolean(guestName)) throw new BadRequestException('请选择一个客户档案，或填写简要成员称呼');
    const note = cleanText(body.note,'备注',500);
    const relation = body.relationship || null;
    const relationKind = relation ? String(relation.kind || '') : null;
    if (relation && !RELATION_KINDS.has(relationKind)) throw new BadRequestException('关系类型无效');
    const otherMemberId = relation ? positiveId(relation.otherMemberId,'关系成员') : null;
    if (relation && otherMemberId <= 0) throw new BadRequestException('请选择关系成员');
    const relationLabel = relation ? cleanText(relation.label,'关系说明',80,{required:relationKind==='other'}) : '';
    const memberId = await this.db.transaction(async (client) => {
      if (customerId) {
        const customer = await client.query('SELECT id FROM customers WHERE id=$1',[customerId]);
        if (!customer.rows[0]) throw new NotFoundException('找不到这个客户');
      }
      const family = await client.query('SELECT id FROM families WHERE id=$1',[id]);
      if (!family.rows[0]) throw new NotFoundException('找不到这个家庭');
      try {
        const inserted = await client.query('INSERT INTO family_members(family_id,customer_id,guest_name,note) VALUES($1,$2,$3,$4) RETURNING id',
          [id,customerId,guestName,note]);
        const createdMemberId = Number(inserted.rows[0].id);
        if (relation) {
          const other = await client.query('SELECT id FROM family_members WHERE family_id=$1 AND id=$2',[id,otherMemberId]);
          if (!other.rows[0]) throw new BadRequestException('关系另一端必须属于本家庭');
          await client.query(`INSERT INTO family_relationships(family_id,member_a_id,member_b_id,kind,label)
            VALUES($1,$2,$3,$4,$5)`,[id,createdMemberId,otherMemberId,relationKind,relationLabel]);
        }
        return createdMemberId;
      } catch (error) {
        if (error.code==='23505') throw new ConflictException('这位客户已经在本家庭中');
        throw error;
      }
    });
    return this.family(id);
  }

  async updateFamilyMember(familyId,memberId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(memberId,'成员编号');
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM family_members WHERE family_id=$1 AND id=$2 FOR UPDATE',[id,target]);
      const member = rows[0];
      if (!member) throw new NotFoundException('找不到这个家庭成员');
      const note = body.note === undefined ? member.note : cleanText(body.note,'备注',500);
      let customerId = member.customer_id;
      let guestName = member.guest_name;
      if (body.customerId !== undefined) {
        customerId = body.customerId == null ? null : positiveId(body.customerId,'客户编号');
        guestName = customerId ? null : body.guestName === undefined ? member.guest_name : cleanText(body.guestName,'成员称呼',100,{required:true});
      } else if (body.guestName !== undefined) {
        customerId = null;
        guestName = cleanText(body.guestName,'成员称呼',100,{required:true});
      }
      if ((customerId != null) === (guestName != null)) throw new BadRequestException('成员需要关联客户档案或保留简要称呼');
      if (customerId != null && customerId !== member.customer_id) {
        const customer = await client.query('SELECT id FROM customers WHERE id=$1',[customerId]);
        if (!customer.rows[0]) throw new NotFoundException('找不到这个客户');
      }
      try {
        await client.query('UPDATE family_members SET customer_id=$3,guest_name=$4,note=$5,updated_at=NOW() WHERE family_id=$1 AND id=$2',
          [id,target,customerId,guestName,note]);
      } catch (error) {
        if (error.code==='23505') throw new ConflictException('该客户已经是本家庭成员');
        throw error;
      }
    });
    return this.family(id);
  }

  async removeFamilyMember(familyId,memberId) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(memberId,'成员编号');
    const result = await this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT fm.id,fm.customer_id,f.primary_customer_id
        FROM family_members fm JOIN families f ON f.id=fm.family_id
        WHERE fm.family_id=$1 AND fm.id=$2 FOR UPDATE`,[id,target]);
      const member = rows[0];
      if (!member) throw new NotFoundException('找不到这个家庭成员');
      if (member.customer_id != null && String(member.customer_id)===String(member.primary_customer_id)) {
        throw new BadRequestException('请先指定新的主要服务联系人，再移出这位成员');
      }
      await client.query('DELETE FROM family_members WHERE family_id=$1 AND id=$2',[id,target]);
      return {id:target};
    });
    return result;
  }

  async createRelationship(familyId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const a = positiveId(body.memberAId,'关系成员');
    const b = positiveId(body.memberBId,'关系成员');
    const kind = String(body.kind || '');
    if (!RELATION_KINDS.has(kind)) throw new BadRequestException('关系类型无效');
    if (a===b) throw new BadRequestException('不能把成员与自己关联');
    const label = cleanText(body.label,'关系说明',80,{required:kind==='other'});
    try {
      await this.db.transaction(async (client) => {
        const family = await client.query('SELECT id FROM families WHERE id=$1',[id]);
        if (!family.rows[0]) throw new NotFoundException('找不到这个家庭');
        const members = await client.query('SELECT id FROM family_members WHERE family_id=$1 AND id=ANY($2::bigint[])',[id,[a,b]]);
        if (members.rowCount!==2) throw new BadRequestException('关系两端必须属于同一个家庭');
        await client.query('INSERT INTO family_relationships(family_id,member_a_id,member_b_id,kind,label) VALUES($1,$2,$3,$4,$5)',[id,a,b,kind,label]);
      });
    } catch (error) {
      if (error.code==='23505') throw new ConflictException('这两位成员已经有关联关系');
      throw error;
    }
    return this.family(id);
  }

  async updateRelationship(familyId,relationshipId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(relationshipId,'关系编号');
    const kind = body.kind === undefined ? undefined : String(body.kind);
    const label = body.label === undefined ? undefined : cleanText(body.label,'关系说明',80);
    if (kind !== undefined && !RELATION_KINDS.has(kind)) throw new BadRequestException('关系类型无效');
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM family_relationships WHERE family_id=$1 AND id=$2 FOR UPDATE',[id,target]);
      if (!rows[0]) throw new NotFoundException('找不到这条家庭关系');
      const nextKind = kind || rows[0].kind;
      const nextLabel = label === undefined ? rows[0].label : label;
      if (nextKind==='other' && !nextLabel) throw new BadRequestException('请填写关系说明');
      await client.query('UPDATE family_relationships SET kind=$3,label=$4,updated_at=NOW() WHERE family_id=$1 AND id=$2',[id,target,nextKind,nextLabel]);
    });
    return this.family(id);
  }

  async deleteRelationship(familyId,relationshipId) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(relationshipId,'关系编号');
    const result = await this.db.query('DELETE FROM family_relationships WHERE family_id=$1 AND id=$2 RETURNING id',[id,target]);
    if (!result.rows[0]) throw new NotFoundException('找不到这条家庭关系');
    return this.family(id);
  }

  async createInsuredObject(familyId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const kind = String(body.kind || '');
    if (!OBJECT_KINDS.has(kind)) throw new BadRequestException('投保对象类型无效');
    const name = cleanText(body.name,'对象名称',120,{required:true});
    const note = cleanText(body.note,'备注',500);
    const family = await this.db.query('SELECT id FROM families WHERE id=$1',[id]);
    if (!family.rows[0]) throw new NotFoundException('找不到这个家庭');
    const {rows} = await this.db.query(`INSERT INTO family_insured_objects(family_id,kind,display_name,note)
      VALUES($1,$2,$3,$4) RETURNING id`,[id,kind,name,note]);
    return this.family(id);
  }

  async updateInsuredObject(familyId,objectId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(objectId,'投保对象编号');
    const kind = body.kind === undefined ? undefined : String(body.kind);
    if (kind !== undefined && !OBJECT_KINDS.has(kind)) throw new BadRequestException('投保对象类型无效');
    const {rows} = await this.db.query(`UPDATE family_insured_objects SET kind=COALESCE($3,kind),
      display_name=COALESCE($4,display_name),note=COALESCE($5,note),updated_at=NOW()
      WHERE family_id=$1 AND id=$2 RETURNING id`,[id,target,kind ?? null,
      body.name === undefined ? null : cleanText(body.name,'对象名称',120,{required:true}),
      body.note === undefined ? null : cleanText(body.note,'备注',500)]);
    if (!rows[0]) throw new NotFoundException('找不到这个投保对象');
    return this.family(id);
  }

  async deleteInsuredObject(familyId,objectId) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(objectId,'投保对象编号');
    const result = await this.db.query('DELETE FROM family_insured_objects WHERE family_id=$1 AND id=$2 RETURNING id',[id,target]);
    if (!result.rows[0]) throw new NotFoundException('找不到这个投保对象');
    return this.family(id);
  }

  async familyPolicyCandidates(familyId) {
    const id = positiveId(familyId,'家庭编号');
    const family = await this.db.query('SELECT id FROM families WHERE id=$1',[id]);
    if (!family.rows[0]) throw new NotFoundException('找不到这个家庭');
    const {rows} = await this.db.query(`SELECT p.id,p.customer_id,c.name AS customer_name,p.company,p.policy_name,p.insurance_type,
      p.policy_number,p.verified,p.contract_status,p.expiry_date
      FROM policies p JOIN customers c ON c.id=p.customer_id
      JOIN family_members fm ON fm.family_id=$1 AND fm.customer_id=p.customer_id
      LEFT JOIN family_policies fp ON fp.family_id=$1 AND fp.policy_id=p.id
      WHERE fp.policy_id IS NULL ORDER BY p.updated_at DESC,p.id DESC`,[id]);
    return rows.map((item)=>({id:Number(item.id),customerId:Number(item.customer_id),customerName:item.customer_name,
      company:item.company,name:item.policy_name,type:item.insurance_type,policyNumber:maskPolicyNumber(item.policy_number),
      verified:Boolean(item.verified),contractStatus:item.contract_status,expiryDate:pgDate(item.expiry_date)}));
  }

  async linkFamilyPolicy(familyId,policyId,body={}) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(policyId,'保单编号');
    const people = Array.isArray(body.people) ? body.people : [];
    const objectIds = Array.isArray(body.insuredObjectIds) ? [...new Set(body.insuredObjectIds.map((value)=>positiveId(value,'投保对象编号')))] : [];
    const tags = Array.isArray(body.coverageTags) ? [...new Set(body.coverageTags.map(String))] : [];
    if (tags.some((tag)=>!COVERAGE_TAGS.has(tag))) throw new BadRequestException('保障分类无效');
    const normalizedPeople = people.map((person)=>{
      const memberId = positiveId(person.memberId,'成员编号');
      if (!['holder','insured'].includes(person.role)) throw new BadRequestException('请选择投保人或被保险人角色');
      return {memberId,role:person.role};
    }).filter((item,index,array)=>array.findIndex((entry)=>entry.memberId===item.memberId && entry.role===item.role)===index);
    await this.db.transaction(async (client) => {
      const family = await client.query('SELECT id FROM families WHERE id=$1',[id]);
      if (!family.rows[0]) throw new NotFoundException('找不到这个家庭');
      const policy = await client.query('SELECT id,customer_id FROM policies WHERE id=$1',[target]);
      if (!policy.rows[0]) throw new NotFoundException('找不到这份保单');
      const owner = await client.query('SELECT id FROM family_members WHERE family_id=$1 AND customer_id=$2',[id,policy.rows[0].customer_id]);
      if (!owner.rows[0]) throw new BadRequestException('只能纳入本家庭已建档成员名下的保单');
      if (normalizedPeople.length) {
        const valid = await client.query('SELECT id FROM family_members WHERE family_id=$1 AND id=ANY($2::bigint[])',[id,normalizedPeople.map((item)=>item.memberId)]);
        if (valid.rowCount!==new Set(normalizedPeople.map((item)=>item.memberId)).size) throw new BadRequestException('保单人员必须属于本家庭');
      }
      if (objectIds.length) {
        const valid = await client.query('SELECT id FROM family_insured_objects WHERE family_id=$1 AND id=ANY($2::bigint[])',[id,objectIds]);
        if (valid.rowCount!==objectIds.length) throw new BadRequestException('投保对象必须属于本家庭');
      }
      await client.query('INSERT INTO family_policies(family_id,policy_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,target]);
      await client.query('DELETE FROM family_policy_people WHERE family_id=$1 AND policy_id=$2',[id,target]);
      await client.query(`DELETE FROM family_contract_people fcp USING family_contracts fc,customer_policy_contracts d
        WHERE fcp.family_id=$1 AND fc.family_id=fcp.family_id AND fc.contract_id=fcp.contract_id
          AND d.id=fc.contract_id AND d.policy_id=$2`,[id,target]);
      await client.query('DELETE FROM family_policy_objects WHERE family_id=$1 AND policy_id=$2',[id,target]);
      await client.query('DELETE FROM family_policy_coverage_tags WHERE family_id=$1 AND policy_id=$2',[id,target]);
      for (const person of normalizedPeople) await client.query(`INSERT INTO family_policy_people(family_id,policy_id,member_id,role)
        VALUES($1,$2,$3,$4)`,[id,target,person.memberId,person.role]);
      await client.query(`INSERT INTO family_contract_people(family_id,contract_id,member_id,role)
        SELECT fc.family_id,fc.contract_id,fpp.member_id,fpp.role
        FROM family_contracts fc JOIN customer_policy_contracts d ON d.id=fc.contract_id
        JOIN family_policy_people fpp ON fpp.family_id=fc.family_id AND fpp.policy_id=d.policy_id
        WHERE fc.family_id=$1 AND d.policy_id=$2 ON CONFLICT DO NOTHING`,[id,target]);
      for (const objectId of objectIds) await client.query(`INSERT INTO family_policy_objects(family_id,policy_id,object_id)
        VALUES($1,$2,$3)`,[id,target,objectId]);
      for (const tag of tags) await client.query('INSERT INTO family_policy_coverage_tags(family_id,policy_id,tag) VALUES($1,$2,$3)',[id,target,tag]);
    });
    return this.family(id);
  }

  async unlinkFamilyPolicy(familyId,policyId) {
    const id = positiveId(familyId,'家庭编号');
    const target = positiveId(policyId,'保单编号');
    // WorkbenchService composes the family policy review operation; keep the
    // older endpoint aligned with the unified policy/PDF unlink behavior.
    await this.unlinkFamilyPolicySource(id,{policyId:target});
    return this.family(id);
  }
}
