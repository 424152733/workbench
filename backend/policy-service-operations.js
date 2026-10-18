import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beijingDate, cleanText, maskPolicyNumber, pgDate, strictDate } from './workbench-primitives.js';

export const POLICY_CONTRACT_STATUSES = ['unknown','pending_effective','active','suspended','expired','terminated'];
export const POLICY_SERVICE_KINDS = ['payment','renewal','endorsement','claim_inquiry','other'];
export const POLICY_SERVICE_OPEN_STATUSES = ['pending','in_progress','waiting_customer','waiting_insurer'];
const ALL_SERVICE_STATUSES = [...POLICY_SERVICE_OPEN_STATUSES,'completed','cancelled'];
const TODAY_SQL = "(NOW() AT TIME ZONE 'Asia/Shanghai')::date";

const optionalDate = (value,label) => value ? strictDate(value,label) : null;
const dateValue = (value) => value ? pgDate(value) : null;

export class PolicyServiceOperations {
  async findPolicy(policyId,executor=this.db) {
    const {rows} = await executor.query(`SELECT p.*,c.name AS customer_name,c.contact_status
      FROM policies p JOIN customers c ON c.id=p.customer_id WHERE p.id=$1`,[policyId]);
    if (!rows[0]) throw new NotFoundException('找不到这份保单');
    return rows[0];
  }

  async policyLifecycle(policyId) {
    const policy = await this.findPolicy(policyId);
    const {rows} = await this.db.query(`SELECT id,action,before_data,after_data,reason,recorded_at
      FROM policy_lifecycle_events WHERE policy_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 100`,[policyId]);
    return {
      policyId:Number(policy.id),customerId:Number(policy.customer_id),policyName:policy.policy_name,
      contractStatus:policy.contract_status,effectiveDate:dateValue(policy.effective_date),
      expiryDate:dateValue(policy.expiry_date),nextPaymentDate:dateValue(policy.next_payment_date),
      statusConfirmedOn:dateValue(policy.status_confirmed_on),statusBasis:policy.status_basis || '',
      events:rows.map((row) => ({id:Number(row.id),action:row.action,before:row.before_data,after:row.after_data,reason:row.reason,at:row.recorded_at})),
    };
  }

  async updatePolicyLifecycle(policyId,body={}) {
    const reason = cleanText(body.reason,'变更依据',500,{required:true});
    const result = await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM policies WHERE id=$1 FOR UPDATE',[policyId]);
      const policy = rows[0];
      if (!policy) throw new NotFoundException('找不到这份保单');
      const status = body.contractStatus === undefined ? policy.contract_status : String(body.contractStatus);
      if (!POLICY_CONTRACT_STATUSES.includes(status)) throw new BadRequestException('合同状态无效');
      const next = {
        contractStatus:status,
        effectiveDate:body.effectiveDate === undefined ? dateValue(policy.effective_date) : optionalDate(body.effectiveDate,'起保日期'),
        expiryDate:body.expiryDate === undefined ? dateValue(policy.expiry_date) : optionalDate(body.expiryDate,'到期日期'),
        nextPaymentDate:body.nextPaymentDate === undefined ? dateValue(policy.next_payment_date) : optionalDate(body.nextPaymentDate,'下次缴费日期'),
        statusConfirmedOn:body.statusConfirmedOn === undefined ? dateValue(policy.status_confirmed_on) : optionalDate(body.statusConfirmedOn,'状态确认日期'),
        statusBasis:body.statusBasis === undefined ? (policy.status_basis || '') : cleanText(body.statusBasis,'状态依据',500),
      };
      if (status !== policy.contract_status) {
        if (status !== 'unknown' && !cleanText(body.statusBasis,'状态依据',500)) throw new BadRequestException('确认合同状态时请填写依据');
        if (!next.statusConfirmedOn) next.statusConfirmedOn = beijingDate();
      }
      if (next.effectiveDate && next.expiryDate && next.expiryDate < next.effectiveDate) throw new BadRequestException('到期日期不能早于起保日期');
      const before = {
        contractStatus:policy.contract_status,effectiveDate:dateValue(policy.effective_date),expiryDate:dateValue(policy.expiry_date),
        nextPaymentDate:dateValue(policy.next_payment_date),statusConfirmedOn:dateValue(policy.status_confirmed_on),statusBasis:policy.status_basis || '',
      };
      if (JSON.stringify(before) === JSON.stringify(next)) return Number(policy.customer_id);
      await client.query(`UPDATE policies SET contract_status=$2,effective_date=$3,expiry_date=$4,next_payment_date=$5,
        status_confirmed_on=$6,status_basis=$7,updated_at=NOW() WHERE id=$1`,
      [policyId,next.contractStatus,next.effectiveDate,next.expiryDate,next.nextPaymentDate,next.statusConfirmedOn,next.statusBasis || null]);
      await client.query(`INSERT INTO policy_lifecycle_events(policy_id,action,before_data,after_data,reason)
        VALUES($1,'updated',$2::jsonb,$3::jsonb,$4)`,[policyId,JSON.stringify(before),JSON.stringify(next),reason]);
      return Number(policy.customer_id);
    });
    return this.customer(result);
  }

  publicServiceItem(row) {
    const date = dateValue(row.next_action_date);
    const today = beijingDate();
    const open = POLICY_SERVICE_OPEN_STATUSES.includes(row.status);
    return {
      id:Number(row.id),policyId:Number(row.policy_id),customerId:Number(row.customer_id),
      customerName:row.customer_name,policyName:row.policy_name,company:row.company,
      policyNumber:maskPolicyNumber(row.policy_number),scope:row.service_scope,
      kind:row.kind,title:row.title,description:row.description || '',status:row.status,
      anchorDate:dateValue(row.anchor_date),nextActionDate:date,
      bucket:open ? date < today ? 'overdue' : date === today ? 'today' : 'upcoming' : row.status,
      outcome:row.outcome || '',closedOn:dateValue(row.closed_on),closedAt:row.closed_at,
      createdAt:row.created_at,updatedAt:row.updated_at,contactStatus:row.contact_status,
    };
  }

  async serviceItem(id) {
    const {rows} = await this.db.query(`SELECT s.*,p.customer_id,p.policy_name,p.company,p.policy_number,p.service_scope,
      c.name AS customer_name,c.contact_status
      FROM policy_service_items s JOIN policies p ON p.id=s.policy_id JOIN customers c ON c.id=p.customer_id
      WHERE s.id=$1`,[id]);
    if (!rows[0]) throw new NotFoundException('找不到这项保单服务');
    const [eventRows,taskRows,followRows] = await Promise.all([
      this.db.query(`SELECT * FROM policy_service_item_events WHERE service_item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[id]),
      this.db.query(`SELECT * FROM customer_follow_up_tasks WHERE service_item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[id]),
      this.db.query(`SELECT id,contact_method,note,occurred_at FROM follow_ups WHERE service_item_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 100`,[id]),
    ]);
    return {
      ...this.publicServiceItem(rows[0]),
      events:eventRows.rows.map((row) => ({id:Number(row.id),action:row.action,fromStatus:row.from_status,toStatus:row.to_status,
        fromDate:dateValue(row.from_next_action_date),toDate:dateValue(row.to_next_action_date),note:row.note,at:row.created_at})),
      followUpTasks:taskRows.rows.map((row) => this.publicFollowUpTask(row)),
      followUps:followRows.rows.map((row) => ({id:Number(row.id),method:row.contact_method,note:row.note,at:row.occurred_at})),
    };
  }

  async listServiceItems({status='open',range='all',kind='',search='',customerId='',policyId='',limit=20,offset=0}={}) {
    const where = [];
    const params = [];
    if (status === 'open') where.push(`s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')`);
    else if (ALL_SERVICE_STATUSES.includes(status)) { params.push(status); where.push(`s.status=$${params.length}`); }
    else if (status !== 'all') throw new BadRequestException('服务事项状态无效');
    if (kind) {
      if (!POLICY_SERVICE_KINDS.includes(kind)) throw new BadRequestException('服务事项类型无效');
      params.push(kind); where.push(`s.kind=$${params.length}`);
    }
    if (customerId) { params.push(customerId); where.push(`p.customer_id=$${params.length}`); }
    if (policyId) { params.push(policyId); where.push(`s.policy_id=$${params.length}`); }
    if (search.trim()) {
      params.push(`%${search.trim().slice(0,100)}%`);
      where.push(`(c.name ILIKE $${params.length} OR p.policy_name ILIKE $${params.length} OR s.title ILIKE $${params.length})`);
    }
    if (range === 'overdue') where.push(`s.next_action_date < ${TODAY_SQL} AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')`);
    else if (range === 'today') where.push(`s.next_action_date = ${TODAY_SQL} AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')`);
    else if (range === 'upcoming7') where.push(`s.next_action_date > ${TODAY_SQL} AND s.next_action_date <= ${TODAY_SQL}+7 AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')`);
    else if (range !== 'all') throw new BadRequestException('服务事项日期范围无效');
    const from = `FROM policy_service_items s JOIN policies p ON p.id=s.policy_id JOIN customers c ON c.id=p.customer_id`;
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await this.db.query(`SELECT COUNT(*)::int AS total ${from} ${clause}`,params);
    const safeLimit = Math.min(100,Math.max(1,Number(limit) || 20));
    const safeOffset = Math.max(0,Number(offset) || 0);
    const {rows} = await this.db.query(`SELECT s.*,p.customer_id,p.policy_name,p.company,p.policy_number,p.service_scope,
      c.name AS customer_name,c.contact_status ${from} ${clause}
      ORDER BY CASE WHEN s.status IN ('pending','in_progress','waiting_customer','waiting_insurer') THEN 0 ELSE 1 END,
        s.next_action_date,s.id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,safeLimit,safeOffset]);
    return {items:rows.map((row) => this.publicServiceItem(row)),total:count.rows[0].total,limit:safeLimit,offset:safeOffset};
  }

  async createServiceItem(policyId,body={}) {
    const policy = await this.findPolicy(policyId);
    const kind = String(body.kind || '');
    if (!POLICY_SERVICE_KINDS.includes(kind)) throw new BadRequestException('请选择服务事项类型');
    const title = cleanText(body.title,'事项标题',120,{required:true});
    const description = cleanText(body.description,'事项说明',1000);
    const nextActionDate = strictDate(body.nextActionDate,'下一步处理日期');
    const inferredAnchor = kind === 'renewal' ? policy.expiry_date : kind === 'payment' ? policy.next_payment_date : null;
    const anchorDate = body.anchorDate === undefined ? dateValue(inferredAnchor) : optionalDate(body.anchorDate,'周期日期');
    const requestKey = body.requestKey ? cleanText(body.requestKey,'请求标识',128) : null;
    const id = await this.db.transaction(async (client) => {
      if (requestKey) {
        const prior = await client.query('SELECT id,policy_id FROM policy_service_items WHERE request_key=$1',[requestKey]);
        if (prior.rows[0]) {
          if (String(prior.rows[0].policy_id) !== String(policyId)) throw new ConflictException('请求标识已用于另一项服务');
          return Number(prior.rows[0].id);
        }
      }
      if (anchorDate) {
        const duplicate = await client.query(`SELECT id FROM policy_service_items WHERE policy_id=$1 AND kind=$2 AND anchor_date=$3
          AND status IN ('pending','in_progress','waiting_customer','waiting_insurer') LIMIT 1`,[policyId,kind,anchorDate]);
        if (duplicate.rows[0]) throw new ConflictException({message:'这份保单已有同周期的进行中事项',existingServiceItemId:Number(duplicate.rows[0].id)});
      }
      const inserted = await client.query(`INSERT INTO policy_service_items(policy_id,kind,title,description,anchor_date,next_action_date,request_key)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [policyId,kind,title,description,anchorDate,nextActionDate,requestKey]);
      if (!inserted.rows[0]) {
        if (requestKey) {
          const prior = await client.query('SELECT id,policy_id FROM policy_service_items WHERE request_key=$1',[requestKey]);
          if (prior.rows[0] && String(prior.rows[0].policy_id) === String(policyId)) return Number(prior.rows[0].id);
        }
        const duplicate = anchorDate ? await client.query(`SELECT id FROM policy_service_items WHERE policy_id=$1 AND kind=$2 AND anchor_date=$3
          AND status IN ('pending','in_progress','waiting_customer','waiting_insurer') LIMIT 1`,[policyId,kind,anchorDate]) : {rows:[]};
        throw new ConflictException({message:'这份保单已有同周期的进行中事项',existingServiceItemId:Number(duplicate.rows[0]?.id || 0)});
      }
      await client.query(`INSERT INTO policy_service_item_events(service_item_id,action,to_status,to_next_action_date,note)
        VALUES($1,'created','pending',$2,$3)`,[inserted.rows[0].id,nextActionDate,'创建服务事项']);
      return Number(inserted.rows[0].id);
    });
    return this.serviceItem(id);
  }

  async updateServiceItem(id,body={}) {
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM policy_service_items WHERE id=$1 FOR UPDATE',[id]);
      const item = rows[0];
      if (!item) throw new NotFoundException('找不到这项保单服务');
      if (!POLICY_SERVICE_OPEN_STATUSES.includes(item.status)) throw new ConflictException('这项服务已经结案，请刷新');
      const title = body.title === undefined ? item.title : cleanText(body.title,'事项标题',120,{required:true});
      const description = body.description === undefined ? item.description : cleanText(body.description,'事项说明',1000);
      const nextActionDate = body.nextActionDate === undefined ? dateValue(item.next_action_date) : strictDate(body.nextActionDate,'下一步处理日期');
      if (title === item.title && description === item.description && nextActionDate === dateValue(item.next_action_date)) return;
      const note = cleanText(body.changeNote || '调整服务事项','变更说明',500);
      await client.query(`UPDATE policy_service_items SET title=$2,description=$3,next_action_date=$4,updated_at=NOW() WHERE id=$1`,[id,title,description,nextActionDate]);
      await client.query(`INSERT INTO policy_service_item_events(service_item_id,action,from_status,to_status,from_next_action_date,to_next_action_date,note)
        VALUES($1,'updated',$2,$2,$3,$4,$5)`,[id,item.status,item.next_action_date,nextActionDate,note]);
    });
    return this.serviceItem(id);
  }

  async recordServiceProgress(id,body={}) {
    const note = cleanText(body.note,'处理进展',1000,{required:true});
    const nextStatus = String(body.status || 'in_progress');
    if (!POLICY_SERVICE_OPEN_STATUSES.includes(nextStatus)) throw new BadRequestException('处理状态无效');
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM policy_service_items WHERE id=$1 FOR UPDATE',[id]);
      const item = rows[0];
      if (!item) throw new NotFoundException('找不到这项保单服务');
      if (!POLICY_SERVICE_OPEN_STATUSES.includes(item.status)) throw new ConflictException('这项服务已经结案，请刷新');
      const nextActionDate = body.nextActionDate === undefined ? dateValue(item.next_action_date) : strictDate(body.nextActionDate,'下一步处理日期');
      const requestKey = body.requestKey ? cleanText(body.requestKey,'请求标识',128) : null;
      if (requestKey) {
        const prior = await client.query('SELECT service_item_id FROM policy_service_item_events WHERE request_key=$1',[requestKey]);
        if (prior.rows[0]) {
          if (String(prior.rows[0].service_item_id) !== String(id)) throw new ConflictException('请求标识已用于另一项服务');
          return;
        }
      }
      await client.query(`UPDATE policy_service_items SET status=$2,next_action_date=$3,updated_at=NOW() WHERE id=$1`,[id,nextStatus,nextActionDate]);
      await client.query(`INSERT INTO policy_service_item_events(service_item_id,action,from_status,to_status,from_next_action_date,to_next_action_date,note,request_key)
        VALUES($1,'progress',$2,$3,$4,$5,$6,$7)`,[id,item.status,nextStatus,item.next_action_date,nextActionDate,note,requestKey]);
    });
    return this.serviceItem(id);
  }

  async closeServiceItem(id,body={},action) {
    const note = cleanText(action === 'completed' ? body.outcome : body.reason,action === 'completed' ? '处理结果' : '取消原因',1000,{required:true});
    const closedOn = body.closedOn ? strictDate(body.closedOn,'结案日期') : beijingDate();
    const requestKey = body.requestKey ? cleanText(body.requestKey,'请求标识',128) : null;
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM policy_service_items WHERE id=$1 FOR UPDATE',[id]);
      const item = rows[0];
      if (!item) throw new NotFoundException('找不到这项保单服务');
      if (requestKey) {
        const prior = await client.query('SELECT service_item_id,action FROM policy_service_item_events WHERE request_key=$1',[requestKey]);
        if (prior.rows[0]) {
          if (String(prior.rows[0].service_item_id) === String(id) && prior.rows[0].action === action) return;
          throw new ConflictException('请求标识已用于另一项操作');
        }
      }
      if (!POLICY_SERVICE_OPEN_STATUSES.includes(item.status)) throw new ConflictException('这项服务已经结案，请刷新');
      await client.query(`UPDATE policy_service_items SET status=$2,outcome=$3,closed_on=$4,closed_at=NOW(),updated_at=NOW() WHERE id=$1`,[id,action,note,closedOn]);
      await client.query(`INSERT INTO policy_service_item_events(service_item_id,action,from_status,to_status,from_next_action_date,note,request_key)
        VALUES($1,$2,$3,$2,$4,$5,$6)`,[id,action,item.status,item.next_action_date,note,requestKey]);
      const pendingTasks = await client.query(`SELECT id,due_date FROM customer_follow_up_tasks
        WHERE service_item_id=$1 AND status='pending' FOR UPDATE`,[id]);
      if (pendingTasks.rows.length) {
        await client.query(`UPDATE customer_follow_up_tasks SET status='cancelled',updated_at=NOW()
          WHERE service_item_id=$1 AND status='pending'`,[id]);
        for (const task of pendingTasks.rows) await client.query(`INSERT INTO customer_follow_up_task_events(task_id,action,from_due_date,note)
          VALUES($1,'cancelled',$2,$3)`,[task.id,task.due_date,'关联的保单服务事项已结案']);
      }
    });
    return this.serviceItem(id);
  }

  completeServiceItem(id,body) { return this.closeServiceItem(id,body,'completed'); }
  cancelServiceItem(id,body) { return this.closeServiceItem(id,body,'cancelled'); }
}
