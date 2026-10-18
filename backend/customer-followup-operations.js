import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STAGES, normalizePhone, normalizePolicyNumber, maskPhone, maskPolicyNumber, dateOnly, strictDate, optionalTime, pgDate, pgTime, beijingDate, taskWhen, beijingMonthStart } from './workbench-primitives.js';

export class CustomerFollowupOperations {
  async sources() {
    const { rows } = await this.db.query('SELECT code,label FROM source_dictionary WHERE active=true ORDER BY sort_order,label');
    return rows.map((row) => row.label);
  }

  async sourceCode(value) {
    if (!value) return null;
    const { rows } = await this.db.query(`SELECT code FROM source_dictionary
      WHERE active=true AND (label=$1 OR code=$1)
      ORDER BY CASE WHEN label=$1 THEN 0 ELSE 1 END
      LIMIT 1`, [value]);
    return rows[0]?.code || null;
  }

  async listCustomers({ search = '', source = '' } = {}) {
    const params = [];
    const where = [];
    if (search.trim()) {
      const query = search.trim();
      params.push(`%${query}%`);
      const searchParam = params.length;
      const maskedPhone = query.match(/^(\d{3})\*+(\d{4})$/);
      const phoneMatch = maskedPhone
        ? (() => {
          params.push(maskedPhone[1],maskedPhone[2]);
          return `(left(c.phone_normalized,3)=$${params.length - 1} AND right(c.phone_normalized,4)=$${params.length})`;
        })()
        : 'FALSE';
      where.push(`(c.name ILIKE $${searchParam} OR c.phone ILIKE $${searchParam} OR c.concern ILIKE $${searchParam} OR sd.label ILIKE $${searchParam} OR ${phoneMatch})`);
    }
    if (source && source !== '全部来源') {
      params.push(await this.sourceCode(source) || '__unknown_source__');
      where.push(`c.source_code=$${params.length}`);
    }
    const { rows } = await this.db.query(`SELECT c.*, sd.label AS source_label,
        ca.initial_kind AS acquisition_initial_kind,ca.source_code AS acquisition_source_code,
        acsd.label AS acquisition_source_label,ca.basis AS acquisition_basis,ca.recorded_at AS acquisition_recorded_at
      FROM customers c JOIN source_dictionary sd ON sd.code=c.source_code
      LEFT JOIN customer_acquisition ca ON ca.customer_id=c.id
      LEFT JOIN source_dictionary acsd ON acsd.code=ca.source_code
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.updated_at DESC,c.id DESC`, params);
    const taskResult = rows.length ? await this.db.query(`SELECT * FROM customer_follow_up_tasks
      WHERE customer_id=ANY($1::bigint[]) AND status='pending'
      ORDER BY due_date,due_time NULLS LAST,id`,[rows.map((row) => row.id)]) : { rows: [] };
    const taskMap = new Map();
    for (const task of taskResult.rows) taskMap.set(String(task.customer_id),[...(taskMap.get(String(task.customer_id)) || []),task]);
    return Promise.all(rows.map((row) => this.serializeCustomer(row,taskMap.get(String(row.id)) || [])));
  }

  async findCustomer(id) {
    const { rows } = await this.db.query(`SELECT c.*,sd.label AS source_label,
        ca.initial_kind AS acquisition_initial_kind,ca.source_code AS acquisition_source_code,
        acsd.label AS acquisition_source_label,ca.basis AS acquisition_basis,ca.recorded_at AS acquisition_recorded_at
      FROM customers c JOIN source_dictionary sd ON sd.code=c.source_code
      LEFT JOIN customer_acquisition ca ON ca.customer_id=c.id
      LEFT JOIN source_dictionary acsd ON acsd.code=ca.source_code WHERE c.id=$1`, [id]);
    if (!rows[0]) throw new NotFoundException('找不到这位客户');
    return rows[0];
  }

  async serializeCustomer(row,taskRows=null,includeTaskEvents=false) {
    const [policyResult, followResult, historyResult, resolvedTaskRows,taskEventResult] = await Promise.all([
      this.db.query('SELECT * FROM policies WHERE customer_id=$1 ORDER BY created_at DESC,id DESC', [row.id]),
      this.db.query('SELECT * FROM follow_ups WHERE customer_id=$1 ORDER BY occurred_at DESC,id DESC', [row.id]),
      this.db.query('SELECT * FROM customer_stage_history WHERE customer_id=$1 ORDER BY changed_at DESC,id DESC', [row.id]),
      taskRows === null ? this.db.query(`SELECT * FROM customer_follow_up_tasks WHERE customer_id=$1 AND status='pending' ORDER BY due_date,due_time NULLS LAST,id`,[row.id]).then((result) => result.rows) : Promise.resolve(taskRows),
      includeTaskEvents ? this.db.query(`SELECT e.*,t.title FROM customer_follow_up_task_events e JOIN customer_follow_up_tasks t ON t.id=e.task_id
        WHERE t.customer_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,[row.id]) : Promise.resolve({rows:[]}),
    ]);
    const next = resolvedTaskRows[0];
    return {
      id: Number(row.id), name: row.name, phone: maskPhone(row.phone), stage: row.stage,
      source: row.source_label || '未记录', concern: row.concern || '待了解',
      next: next ? taskWhen(pgDate(next.due_date),pgTime(next.due_time)) : '未安排', nextFollowup: next ? pgDate(next.due_date) : null,
      last: row.last_contact_at ? new Date(row.last_contact_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未联系',
      contact: row.contact_status, preferredContact: row.preferred_contact || '', consentAt: row.consent_at,
      kind: row.kind, contentRef: row.content_ref || '', createdAt: row.created_at,
      acquisition: row.acquisition_source_code ? {
        initialKind: row.acquisition_initial_kind,
        sourceCode: row.acquisition_source_code,
        source: row.acquisition_source_label || '未记录',
        basis: row.acquisition_basis,
        recordedAt: row.acquisition_recorded_at,
      } : null,
      followUpTasks: resolvedTaskRows.map((item) => this.publicFollowUpTask(item)),
      followUpTaskEvents: taskEventResult.rows.map((item) => ({id:Number(item.id),taskId:Number(item.task_id),title:item.title,action:item.action,fromDate:pgDate(item.from_due_date),toDate:pgDate(item.to_due_date),note:item.note,at:item.created_at})),
      policies: policyResult.rows.map((item) => ({
        id: Number(item.id), company: item.company, name: item.policy_name, type: item.insurance_type,
        premium: item.premium || '待核实', amount: item.coverage_summary || '待核实',
        state: item.verified ? '已核实' : '待核实', expiry: dateOnly(item.expiry_date) || '待核实',
        expiryDate:pgDate(item.expiry_date) || null,effectiveDate:pgDate(item.effective_date) || null,
        nextPaymentDate:pgDate(item.next_payment_date) || null,contractStatus:item.contract_status || 'unknown',
        statusConfirmedOn:pgDate(item.status_confirmed_on) || null,statusBasis:item.status_basis || '',
        renewedFromPolicyId:item.renewed_from_policy_id ? Number(item.renewed_from_policy_id) : null,
        scope: item.service_scope, policyNumber: maskPolicyNumber(item.policy_number || ''),
      })),
      notes: followResult.rows.map((item) => `${item.contact_method}：${item.note}`),
      followUps: followResult.rows.map((item) => ({ id: Number(item.id), method: item.contact_method, note: item.note, occurredAt: item.occurred_at, next: dateOnly(item.next_followup),serviceItemId:item.service_item_id ? Number(item.service_item_id) : null })),
      stageHistory: historyResult.rows.map((item) => ({ from: item.from_stage, to: item.to_stage, at: item.changed_at })),
    };
  }

  async createCustomer(body) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('请填写客户称呼');
    const sourceLabel = body.source || '未记录';
    const source = await this.sourceCode(sourceLabel);
    if (!source) throw new BadRequestException('客户来源不在后端字典中');
    const digits = normalizePhone(body.phone);
    if (digits.length >= 7) {
      const duplicate = await this.db.query('SELECT id,name FROM customers WHERE phone_normalized=$1 LIMIT 1', [digits]);
      if (duplicate.rows[0] && !body.allowDuplicate) throw new ConflictException({ message: '这个联系方式已存在，请先核对客户档案', duplicate: duplicate.rows[0] });
    }
    const kind = body.kind === '已有客户' ? '已有客户' : '新线索';
    const stage = kind === '已有客户' ? '已有客户' : '新线索';
    const contact = body.contactAllowed ? '已确认可按所选方式联系' : '待确认联系偏好';
    const preferred = body.preferredContact || null;
    const nextDate = body.next ? strictDate(body.next) : null;
    const result = await this.db.transaction(async (client) => {
      const inserted = await client.query(`INSERT INTO customers(name,phone,phone_normalized,kind,stage,source_code,concern,contact_status,preferred_contact,consent_at,content_ref)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10 THEN NOW() ELSE NULL END,$11) RETURNING id`,
      [name, digits || null, digits || null, kind, stage, source, String(body.concern || '待了解').trim(), contact, preferred, Boolean(body.contactAllowed), body.contentRef || null]);
      await client.query('INSERT INTO customer_stage_history(customer_id,from_stage,to_stage) VALUES($1,NULL,$2)', [inserted.rows[0].id, stage]);
      if (nextDate) await this.insertFollowUpTask(client,inserted.rows[0].id,{
        title:String(body.nextTitle || '初次联系').trim(),method:preferred || '其他',note:'',dueDate:nextDate,dueTime:null,
        source:'customer_create',requestKey:body.taskRequestKey || null,
      });
      return inserted.rows[0].id;
    });
    return this.customer(result);
  }

  async customer(id) {
    return this.serializeCustomer(await this.findCustomer(id),null,true);
  }

  async updateCustomer(id, body) {
    const current = await this.findCustomer(id);
    const allowed = ['name', 'concern', 'source', 'stage', 'kind', 'contact', 'preferredContact', 'contentRef'];
    const updates = {};
    for (const key of allowed) if (body[key] !== undefined) updates[key] = body[key];
    if (updates.stage && !STAGES.includes(updates.stage)) throw new BadRequestException('客户阶段无效');
    if (!Object.keys(updates).length) return this.customer(id);
    const sourceCode = updates.source ? await this.sourceCode(updates.source) : current.source_code;
    if (updates.source) {
      if (!sourceCode) throw new BadRequestException('客户来源不在后端字典中');
    }
    const nextStage = updates.stage || current.stage;
    const nextContactStatus = updates.contact || current.contact_status;
    await this.db.transaction(async (client) => {
      if (nextStage !== current.stage) await client.query('INSERT INTO customer_stage_history(customer_id,from_stage,to_stage) VALUES($1,$2,$3)', [id, current.stage, nextStage]);
      await client.query(`UPDATE customers SET name=$2,concern=$3,source_code=$4,stage=$5,kind=$6,
        contact_status=$7,preferred_contact=$8,content_ref=$9,
        consent_at=CASE WHEN $7 LIKE '已确认%' THEN COALESCE(consent_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=$1`,
      [id, updates.name || current.name, updates.concern || current.concern, sourceCode, nextStage,
        updates.kind || current.kind, nextContactStatus,
        updates.preferredContact ?? current.preferred_contact, updates.contentRef ?? current.content_ref]);
      if (nextContactStatus === '已拒绝联系' && current.contact_status !== '已拒绝联系') {
        const pending = await client.query(`SELECT id,due_date FROM customer_follow_up_tasks WHERE customer_id=$1 AND status='pending' FOR UPDATE`,[id]);
        await client.query(`UPDATE customer_follow_up_tasks SET status='cancelled',updated_at=NOW() WHERE customer_id=$1 AND status='pending'`,[id]);
        for (const task of pending.rows) await client.query(`INSERT INTO customer_follow_up_task_events(task_id,action,from_due_date,note) VALUES($1,'cancelled',$2,'客户联系状态改为已拒绝联系')`,[task.id,task.due_date]);
      }
    });
    return this.customer(id);
  }

  async createPolicy(customerId, body) {
    const customer = await this.findCustomer(customerId);
    if (!body.company || !body.name || !body.type) throw new BadRequestException('保险公司、保单名称和险种为必填项');
    const effectiveDate = body.effectiveDate ? strictDate(body.effectiveDate,'起保日期') : null;
    const expiryDate = body.expiry ? strictDate(body.expiry,'到期日期') : null;
    const nextPaymentDate = body.nextPaymentDate ? strictDate(body.nextPaymentDate,'下次缴费日期') : null;
    if (effectiveDate && expiryDate && expiryDate < effectiveDate) throw new BadRequestException('到期日期不能早于起保日期');
    const renewedFromId = body.renewedFromPolicyId || null;
    const id = await this.db.transaction(async (client) => {
      if (renewedFromId) {
        const prior = await client.query('SELECT customer_id FROM policies WHERE id=$1',[renewedFromId]);
        if (!prior.rows[0] || String(prior.rows[0].customer_id) !== String(customerId)) throw new BadRequestException('续保来源保单不属于这位客户');
      }
      const result = await client.query(`INSERT INTO policies(customer_id,company,policy_name,insurance_type,policy_number,holder_name,insured_name,
        premium,coverage_summary,verified,service_scope,expiry_date,effective_date,next_payment_date,renewed_from_policy_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [customer.id,body.company,body.name,body.type,normalizePolicyNumber(body.policyNumber) || null,
        body.holderName || null,body.insuredName || null,body.premium || null,body.amount || null,
        body.state === '已核实' || Boolean(body.verified),body.scope === 'owned' ? 'owned' : 'external',
        expiryDate,effectiveDate,nextPaymentDate,renewedFromId]);
      await client.query(`INSERT INTO policy_lifecycle_events(policy_id,action,after_data,reason)
        VALUES($1,'created',$2::jsonb,$3)`,[result.rows[0].id,JSON.stringify({contractStatus:'unknown',effectiveDate,expiryDate,nextPaymentDate,renewedFromPolicyId:renewedFromId}),
        renewedFromId ? '根据已核对的续保资料新增保单' : '录入保单资料']);
      return Number(result.rows[0].id);
    });
    return this.customer(customerId).then((record) => ({ policy: record.policies.find((item) => item.id === id), customer: record }));
  }

  async verifyPolicy(policyId, verified) {
    const result = await this.db.query('UPDATE policies SET verified=$2,updated_at=NOW() WHERE id=$1 RETURNING customer_id', [policyId, Boolean(verified)]);
    if (!result.rowCount) throw new NotFoundException('找不到这份保单');
    return this.customer(result.rows[0].customer_id);
  }

  publicFollowUpTask(row) {
    const dueDate = pgDate(row.due_date);
    const dueTime = pgTime(row.due_time);
    const today = beijingDate();
    const bucket = row.status === 'completed' ? 'completed' : row.status === 'cancelled' ? 'cancelled' : dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'upcoming';
    return {
      id:Number(row.id),customerId:Number(row.customer_id),customerName:row.customer_name || '',
      contactStatus:row.contact_status || '',title:row.title,method:row.planned_method,note:row.note || '',
      dueDate,dueTime,status:row.status,bucket,when:taskWhen(dueDate,dueTime),source:row.source,
      serviceItemId:row.service_item_id ? Number(row.service_item_id) : null,
      createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at,
    };
  }

  async insertFollowUpTask(executor,customerId,input) {
    const title = String(input.title || '').trim();
    if (!title) throw new BadRequestException('请填写跟进目的');
    if (title.length > 120) throw new BadRequestException('跟进目的不能超过 120 个字');
    const method = String(input.method || '其他').trim() || '其他';
    if (method.length > 40) throw new BadRequestException('联系方式不能超过 40 个字');
    const note = String(input.note || '').trim();
    if (note.length > 500) throw new BadRequestException('待办备注不能超过 500 个字');
    const dueDate = strictDate(input.dueDate);
    const dueTime = optionalTime(input.dueTime);
    const requestKey = input.requestKey ? String(input.requestKey).trim() : null;
    if (requestKey && requestKey.length > 128) throw new BadRequestException('请求标识无效');
    const serviceItemId = input.serviceItemId || null;
    if (serviceItemId) await this.assertServiceItemCustomer(executor,serviceItemId,customerId);
    if (requestKey) {
      const prior = await executor.query('SELECT id,customer_id FROM customer_follow_up_tasks WHERE request_key=$1',[requestKey]);
      if (prior.rows[0]) {
        if (String(prior.rows[0].customer_id) !== String(customerId)) throw new ConflictException('请求标识已用于另一项待办');
        return Number(prior.rows[0].id);
      }
    }
    if (!input.allowDuplicate) {
      const duplicate = await executor.query(`SELECT id FROM customer_follow_up_tasks
        WHERE customer_id=$1 AND status='pending' AND due_date=$2 AND lower(title)=lower($3) LIMIT 1`,[customerId,dueDate,title]);
      if (duplicate.rows[0]) throw new ConflictException({message:'这位客户已有同日同目的的未完成待办',duplicateTaskId:Number(duplicate.rows[0].id)});
    }
    const inserted = await executor.query(`INSERT INTO customer_follow_up_tasks(customer_id,title,planned_method,note,due_date,due_time,source,source_follow_up_id,request_key,service_item_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(request_key) DO NOTHING RETURNING id`,
    [customerId,title,method,note,dueDate,dueTime,input.source || 'manual',input.sourceFollowUpId || null,requestKey,serviceItemId]);
    const taskId = inserted.rows[0]?.id;
    if (!taskId && requestKey) {
      const replay = await executor.query('SELECT id FROM customer_follow_up_tasks WHERE request_key=$1',[requestKey]);
      if (replay.rows[0]) return Number(replay.rows[0].id);
    }
    if (!taskId) throw new ConflictException('待办创建冲突，请刷新后重试');
    await executor.query(`INSERT INTO customer_follow_up_task_events(task_id,action,to_due_date,note) VALUES($1,'created',$2,$3)`,[taskId,dueDate,input.eventNote || '手动安排跟进']);
    return Number(taskId);
  }

  async assertServiceItemCustomer(executor,serviceItemId,customerId) {
    const {rows} = await executor.query(`SELECT p.customer_id,s.status FROM policy_service_items s JOIN policies p ON p.id=s.policy_id WHERE s.id=$1`,[serviceItemId]);
    if (!rows[0] || String(rows[0].customer_id) !== String(customerId)) throw new BadRequestException('服务事项不属于这位客户');
    if (!['pending','in_progress','waiting_customer','waiting_insurer'].includes(rows[0].status)) throw new ConflictException('服务事项已经结案，不能安排新联系');
  }

  async followUpTask(id) {
    const {rows} = await this.db.query(`SELECT t.*,c.name AS customer_name,c.contact_status,sd.label AS source_label
      FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id
      JOIN source_dictionary sd ON sd.code=c.source_code WHERE t.id=$1`,[id]);
    if (!rows[0]) throw new NotFoundException('找不到这项跟进待办');
    return this.publicFollowUpTask({...rows[0],source:rows[0].source_label});
  }

  async listFollowUpTasks({status='pending',range='all',search='',customerId='',limit=100,offset=0}={}) {
    const params = [];
    const where = [];
    if (['pending','completed','cancelled'].includes(status)) {
      params.push(status); where.push(`t.status=$${params.length}`);
    }
    if (customerId) { params.push(customerId); where.push(`t.customer_id=$${params.length}`); }
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      where.push(`(c.name ILIKE $${params.length} OR t.title ILIKE $${params.length} OR t.note ILIKE $${params.length})`);
    }
    const today = `(NOW() AT TIME ZONE 'Asia/Shanghai')::date`;
    if (status === 'pending') {
      if (range === 'overdue') where.push(`t.due_date < ${today}`);
      if (range === 'today') where.push(`t.due_date = ${today}`);
      if (range === 'upcoming7') where.push(`t.due_date > ${today} AND t.due_date <= ${today} + 7`);
      if (range === 'urgent') where.push(`t.due_date <= ${today}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await this.db.query(`SELECT COUNT(*)::int AS total FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id ${clause}`,params);
    const safeLimit = Math.min(200,Math.max(1,Number(limit) || 100));
    const safeOffset = Math.max(0,Number(offset) || 0);
    const dataParams = [...params,safeLimit,safeOffset];
    const {rows} = await this.db.query(`SELECT t.*,c.name AS customer_name,c.contact_status,sd.label AS source,
        CASE WHEN t.status='completed' THEN 'completed' WHEN t.status='cancelled' THEN 'cancelled'
          WHEN t.due_date < ${today} THEN 'overdue' WHEN t.due_date=${today} THEN 'today' ELSE 'upcoming' END AS bucket
      FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id
      JOIN source_dictionary sd ON sd.code=c.source_code ${clause}
      ORDER BY CASE WHEN t.status='pending' AND t.due_date < ${today} THEN 0
        WHEN t.status='pending' AND t.due_date=${today} THEN 1
        WHEN t.status='pending' THEN 2 ELSE 3 END,t.due_date,t.due_time NULLS LAST,t.id
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,dataParams);
    return {items:rows.map((row) => this.publicFollowUpTask(row)),total:countResult.rows[0].total,limit:safeLimit,offset:safeOffset};
  }

  async createFollowUpTask(customerId,body) {
    const customer = await this.findCustomer(customerId);
    if (customer.contact_status === '已拒绝联系') throw new BadRequestException('客户已拒绝联系，不能安排客户联系待办');
    const id = await this.db.transaction((client) => this.insertFollowUpTask(client,customerId,{...body,source:'manual'}));
    return this.followUpTask(id);
  }

  async updateFollowUpTask(taskId,body) {
    const fields = {
      title:String(body.title || '').trim(),method:String(body.method || '其他').trim() || '其他',
      note:String(body.note || '').trim(),dueDate:strictDate(body.dueDate),dueTime:optionalTime(body.dueTime),
    };
    if (!fields.title || fields.title.length > 120) throw new BadRequestException('请填写 120 个字以内的跟进目的');
    if (fields.note.length > 500) throw new BadRequestException('待办备注不能超过 500 个字');
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM customer_follow_up_tasks WHERE id=$1 FOR UPDATE',[taskId]);
      const task = rows[0];
      if (!task) throw new NotFoundException('找不到这项跟进待办');
      if (task.status !== 'pending') throw new ConflictException('这项待办已处理，请刷新列表');
      const duplicate = await client.query(`SELECT id FROM customer_follow_up_tasks WHERE customer_id=$1 AND status='pending'
        AND due_date=$2 AND lower(title)=lower($3) AND id<>$4 LIMIT 1`,[task.customer_id,fields.dueDate,fields.title,taskId]);
      if (duplicate.rows[0]) throw new ConflictException({message:'这位客户已有同日同目的的未完成待办',duplicateTaskId:Number(duplicate.rows[0].id)});
      const oldDate = pgDate(task.due_date);
      await client.query(`UPDATE customer_follow_up_tasks SET title=$2,planned_method=$3,note=$4,due_date=$5,due_time=$6,updated_at=NOW() WHERE id=$1`,[taskId,fields.title,fields.method,fields.note,fields.dueDate,fields.dueTime]);
      if (oldDate !== fields.dueDate || pgTime(task.due_time) !== fields.dueTime) {
        await client.query(`INSERT INTO customer_follow_up_task_events(task_id,action,from_due_date,to_due_date,note) VALUES($1,'rescheduled',$2,$3,$4)`,[taskId,oldDate,fields.dueDate,String(body.changeNote || '调整跟进时间').slice(0,300)]);
      }
    });
    return this.followUpTask(taskId);
  }

  async completeFollowUpTask(taskId,body) {
    const rawSummary = String(body.note || '').trim();
    if (!rawSummary) throw new BadRequestException('请填写本次联系结果');
    if (rawSummary.length > 500) throw new BadRequestException('联系结果不能超过 500 个字');
    const summary = body.outcome === 'not_reached' ? `未接通：${rawSummary}` : rawSummary;
    const method = String(body.method || '其他').trim() || '其他';
    const nextInput = body.nextTask || null;
    if (nextInput && !nextInput.dueDate) throw new BadRequestException('安排下一次跟进时请填写日期');
    const outcome = await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM customer_follow_up_tasks WHERE id=$1 FOR UPDATE',[taskId]);
      const task = rows[0];
      if (!task) throw new NotFoundException('找不到这项跟进待办');
      if (task.status !== 'pending') throw new ConflictException('这项待办已处理，请刷新列表');
      const customer = await client.query('SELECT contact_status FROM customers WHERE id=$1 FOR UPDATE',[task.customer_id]);
      if (!customer.rows[0]) throw new NotFoundException('找不到这位客户');
      if (customer.rows[0].contact_status === '已拒绝联系') throw new ConflictException('客户已拒绝联系，这项待办不能完成为联系记录');
      const nextDate = nextInput?.dueDate ? strictDate(nextInput.dueDate,'下次跟进日期') : null;
      const follow = await client.query(`INSERT INTO follow_ups(customer_id,contact_method,note,next_followup,service_item_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[task.customer_id,method,summary,nextDate,task.service_item_id]);
      await client.query(`UPDATE customer_follow_up_tasks SET status='completed',completed_follow_up_id=$2,completed_at=NOW(),updated_at=NOW() WHERE id=$1`,[taskId,follow.rows[0].id]);
      await client.query(`INSERT INTO customer_follow_up_task_events(task_id,action,from_due_date,note) VALUES($1,'completed',$2,$3)`,[taskId,task.due_date,summary]);
      let nextTaskId = null;
      if (nextInput?.dueDate) nextTaskId = await this.insertFollowUpTask(client,task.customer_id,{
        title:nextInput.title || '继续跟进',method:nextInput.method || '其他',note:nextInput.note || '',
        dueDate:nextInput.dueDate,dueTime:nextInput.dueTime || null,source:'follow_up',requestKey:nextInput.requestKey || null,
        serviceItemId:task.service_item_id,
      });
      await client.query('UPDATE customers SET last_contact_at=NOW(),updated_at=NOW() WHERE id=$1',[task.customer_id]);
      return {customerId:Number(task.customer_id),nextTaskId};
    });
    return {task:await this.followUpTask(taskId),customer:await this.customer(outcome.customerId),nextTask:outcome.nextTaskId ? await this.followUpTask(outcome.nextTaskId) : null};
  }

  async cancelFollowUpTask(taskId,body={}) {
    const note = String(body.note || '').trim();
    if (!note) throw new BadRequestException('请填写取消原因');
    await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM customer_follow_up_tasks WHERE id=$1 FOR UPDATE',[taskId]);
      const task = rows[0];
      if (!task) throw new NotFoundException('找不到这项跟进待办');
      if (task.status !== 'pending') throw new ConflictException('这项待办已处理，请刷新列表');
      await client.query(`UPDATE customer_follow_up_tasks SET status='cancelled',updated_at=NOW() WHERE id=$1`,[taskId]);
      await client.query(`INSERT INTO customer_follow_up_task_events(task_id,action,from_due_date,note) VALUES($1,'cancelled',$2,$3)`,[taskId,task.due_date,note.slice(0,300)]);
    });
    return this.followUpTask(taskId);
  }

  async createFollowUp(customerId, body) {
    const customer = await this.findCustomer(customerId);
    if (customer.contact_status === '已拒绝联系' && body.next) throw new BadRequestException('客户已拒绝联系，不能安排后续联系提醒');
    if (!body.note || !String(body.note).trim()) throw new BadRequestException('请填写沟通记录');
    if (String(body.note).trim().length > 500) throw new BadRequestException('沟通记录不能超过 500 个字');
    const nextDate = body.next ? strictDate(body.next,'下次跟进日期') : null;
    await this.db.transaction(async (client) => {
      if (body.serviceItemId) await this.assertServiceItemCustomer(client,body.serviceItemId,customerId);
      if (body.taskRequestKey && nextDate) {
        const existing = await client.query('SELECT customer_id FROM customer_follow_up_tasks WHERE request_key=$1',[String(body.taskRequestKey)]);
        if (existing.rows[0]) {
          if (String(existing.rows[0].customer_id) !== String(customerId)) throw new ConflictException('请求标识已用于另一项待办');
          return;
        }
      }
      const result = await client.query('INSERT INTO follow_ups(customer_id,contact_method,note,next_followup,service_item_id) VALUES($1,$2,$3,$4,$5) RETURNING id', [customerId, body.method || '其他', String(body.note).trim(), nextDate,body.serviceItemId || null]);
      if (nextDate) await this.insertFollowUpTask(client,customerId,{
        title:body.nextTitle || '继续跟进',method:body.nextMethod || body.method || '其他',note:body.nextNote || '',dueDate:nextDate,
        dueTime:body.nextTime || null,source:'follow_up',requestKey:body.taskRequestKey || null,sourceFollowUpId:result.rows[0].id,
        eventNote:'根据本次沟通安排',serviceItemId:body.serviceItemId || null,
      });
      await client.query('UPDATE customers SET last_contact_at=NOW(),updated_at=NOW() WHERE id=$1', [customerId]);
    });
    return this.customer(customerId);
  }

  async dashboard({ month } = {}) {
    const monthStart = /^\d{4}-\d{2}$/.test(month || '') ? `${month}-01` : beijingMonthStart();
    const today = `(NOW() AT TIME ZONE 'Asia/Shanghai')::date`;
    const [customerRows, policyRows, followRows, sourceRows, concernRows, topicRows, taskMetricRows] = await Promise.all([
      this.db.query(`SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE kind='新线索')::int AS leads,
        COUNT(*) FILTER (WHERE stage IN ('已成交','已有客户'))::int AS customers,
        COUNT(*) FILTER (WHERE created_at >= $1::date AND created_at < $1::date + INTERVAL '1 month')::int AS added
        FROM customers`, [monthStart]),
      this.db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE verified)::int AS verified,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN ${today} AND ${today} + 30)::int AS renewal30,
        COUNT(*) FILTER (WHERE expiry_date BETWEEN ${today} AND ${today} + 60)::int AS renewal60
        FROM policies`),
      this.db.query(`SELECT * FROM (
          SELECT t.*,c.id AS customer_id,c.name,c.contact_status,c.source_code,c.concern,sd.label AS source,
            CASE WHEN t.due_date < ${today} THEN 'overdue' WHEN t.due_date=${today} THEN 'today' ELSE 'upcoming' END AS bucket,
            ROW_NUMBER() OVER (PARTITION BY CASE WHEN t.due_date < ${today} THEN 'overdue' WHEN t.due_date=${today} THEN 'today' ELSE 'upcoming' END
              ORDER BY t.due_date,t.due_time NULLS LAST,t.id) AS bucket_rank
          FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id JOIN source_dictionary sd ON sd.code=c.source_code
          WHERE t.status='pending' AND t.due_date <= ${today} + 7 AND c.contact_status <> '已拒绝联系'
        ) ranked_tasks WHERE bucket_rank <= 12
        ORDER BY CASE bucket WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 ELSE 2 END,due_date,due_time NULLS LAST,id`),
      this.db.query(`SELECT sd.label AS name,COUNT(*)::int AS count FROM customers c JOIN source_dictionary sd ON sd.code=c.source_code
        WHERE c.kind='新线索' AND c.created_at >= $1::date AND c.created_at < $1::date + INTERVAL '1 month' GROUP BY sd.label ORDER BY count DESC,sd.label`, [monthStart]),
      this.db.query(`SELECT concern,COUNT(*)::int AS count FROM customers WHERE NULLIF(TRIM(concern),'') IS NOT NULL GROUP BY concern ORDER BY count DESC,concern LIMIT 8`),
      this.db.query(`SELECT
        (SELECT COUNT(*)::int FROM drafts WHERE status IN ('待审核','草稿')) AS pending,
        (SELECT COUNT(DISTINCT draft_id)::int FROM content_publications
          WHERE status='active' AND published_on >= $1::date
            AND published_on < $1::date + INTERVAL '1 month') AS published`,[monthStart]),
      this.db.query(`SELECT
          COUNT(*) FILTER (WHERE t.due_date < ${today})::int AS overdue,
          COUNT(*) FILTER (WHERE t.due_date = ${today})::int AS due_today,
          COUNT(*) FILTER (WHERE t.due_date > ${today} AND t.due_date <= ${today}+7)::int AS upcoming,
          COUNT(DISTINCT t.customer_id) FILTER (WHERE t.due_date <= ${today}+7)::int AS customers_due
        FROM customer_follow_up_tasks t JOIN customers c ON c.id=t.customer_id
        WHERE t.status='pending' AND t.due_date <= ${today}+7 AND c.contact_status <> '已拒绝联系'`),
    ]);
    const customers = customerRows.rows[0];
    const policies = policyRows.rows[0];
    const followUps = followRows.rows;
    const taskMetrics = taskMetricRows.rows[0];
    const tasks = followUps.map((row) => ({
      ...this.publicFollowUpTask({...row,source:row.source}),customerId:Number(row.customer_id),name:row.name,concern:row.concern,
      sourceLabel:row.source,note:row.note,next:taskWhen(pgDate(row.due_date),pgTime(row.due_time)),
    }));
    const [serviceMetricRows,serviceDueRows,policyReminderRows] = await Promise.all([
      this.db.query(`SELECT COUNT(*) FILTER (WHERE next_action_date < ${today})::int AS overdue,
        COUNT(*) FILTER (WHERE next_action_date = ${today})::int AS due_today,
        COUNT(*) FILTER (WHERE next_action_date > ${today} AND next_action_date <= ${today}+7)::int AS upcoming,
        COUNT(*)::int AS open_total
        FROM policy_service_items WHERE status IN ('pending','in_progress','waiting_customer','waiting_insurer')`),
      this.db.query(`SELECT s.*,p.customer_id,p.policy_name,p.company,p.policy_number,p.service_scope,
        c.name AS customer_name,c.contact_status FROM policy_service_items s
        JOIN policies p ON p.id=s.policy_id JOIN customers c ON c.id=p.customer_id
        WHERE s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')
        AND s.next_action_date <= ${today}+7
        AND NOT EXISTS (SELECT 1 FROM customer_follow_up_tasks t WHERE t.service_item_id=s.id
          AND t.status='pending' AND t.due_date=s.next_action_date)
        ORDER BY s.next_action_date,s.id LIMIT 12`),
      this.db.query(`SELECT p.id AS policy_id,p.customer_id,p.policy_name,p.company,p.verified,p.expiry_date,p.next_payment_date,
        p.expiry_date BETWEEN ${today} AND ${today}+30
          AND NOT EXISTS (SELECT 1 FROM policy_service_items s WHERE s.policy_id=p.id AND s.kind='renewal'
            AND s.anchor_date=p.expiry_date AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')) AS renewal_due,
        p.next_payment_date BETWEEN ${today} AND ${today}+7
          AND NOT EXISTS (SELECT 1 FROM policy_service_items s WHERE s.policy_id=p.id AND s.kind='payment'
            AND s.anchor_date=p.next_payment_date AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')) AS payment_due,
        c.name AS customer_name FROM policies p JOIN customers c ON c.id=p.customer_id
        WHERE (p.expiry_date BETWEEN ${today} AND ${today}+30
          AND NOT EXISTS (SELECT 1 FROM policy_service_items s WHERE s.policy_id=p.id AND s.kind='renewal'
            AND s.anchor_date=p.expiry_date AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')))
          OR (p.next_payment_date BETWEEN ${today} AND ${today}+7
          AND NOT EXISTS (SELECT 1 FROM policy_service_items s WHERE s.policy_id=p.id AND s.kind='payment'
            AND s.anchor_date=p.next_payment_date AND s.status IN ('pending','in_progress','waiting_customer','waiting_insurer')))
        ORDER BY COALESCE(p.expiry_date,p.next_payment_date),p.id LIMIT 8`),
    ]);
    const serviceItems = serviceDueRows.rows.map((row) => this.publicServiceItem(row));
    const serviceMetrics = serviceMetricRows.rows[0];
    return {
      month: monthStart.slice(0, 7),
      metrics: {
        customers: customers.count, leads: customers.leads, converted: customers.customers, addedThisMonth: customers.added,
        dueFollowUps: taskMetrics.customers_due, overdueTasks:taskMetrics.overdue,todayTasks:taskMetrics.due_today,upcoming7Tasks:taskMetrics.upcoming,
        renewal30: policies.renewal30, renewal60: policies.renewal60,
        pendingContent: topicRows.rows[0].pending, publishedThisMonth: topicRows.rows[0].published,
        verifiedPolicies: policies.verified, unverifiedPolicies: policies.total - policies.verified,
        overdueServices:serviceMetrics.overdue,todayServices:serviceMetrics.due_today,
        upcoming7Services:serviceMetrics.upcoming,openServices:serviceMetrics.open_total,
      },
      tasks,
      urgentTasks:tasks.filter((item) => item.bucket === 'overdue' || item.bucket === 'today'),
      serviceItems,
      urgentServiceItems:serviceItems.filter((item) => item.bucket === 'overdue' || item.bucket === 'today'),
      policyReminders:policyReminderRows.rows.map((row) => ({
        policyId:Number(row.policy_id),customerId:Number(row.customer_id),customerName:row.customer_name,
        policyName:row.policy_name,company:row.company,verified:row.verified,
        expiryDate:pgDate(row.expiry_date) || null,nextPaymentDate:pgDate(row.next_payment_date) || null,
        renewalDue:row.renewal_due === true,paymentDue:row.payment_due === true,
      })),
      sources: sourceRows.rows,
      concerns: concernRows.rows,
      policySamples: Number(policies.total),
    };
  }

  async exportCustomers() {
    const customers = await this.listCustomers({});
    const escape = (value) => `"${String(value ?? '').replaceAll('"','""')}"`;
    const lines = [['姓名','联系电话（脱敏）','客户阶段','来源','关注问题','联系偏好','下次跟进','保单数','已核实保单数'], ...customers.map((item) => [
      item.name,item.phone,item.stage,item.source,item.concern,item.contact,item.next,item.policies.length,item.policies.filter((p) => p.state === '已核实').length,
    ])].map((row) => row.map(escape).join(','));
    return `\uFEFF${lines.join('\r\n')}`;
  }
}
