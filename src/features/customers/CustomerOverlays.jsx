import { Alert, Avatar, Button, Checkbox, Col, DatePicker, Descriptions, Divider, Drawer, Empty, Form, Input, Modal, Row, Select, Space, Tag, TimePicker, Typography } from 'antd';
import { CalendarOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { customerStageColors } from './customer-options.js';
import { PolicyCard } from './PolicyCard.jsx';
const { Title, Text } = Typography;

export function CustomerOverlays({ workspace,serviceWorkspace,showPolicyServices }) {
  const { selectedClient, setSelectedClient, openClientEdit, apiLoading, performApiAction, verifyPolicy, setPolicyModalOpen, openFollowUpTaskModal, openCompleteTaskModal, openRescheduleTaskModal, cancelFollowUpTask, setFollowUpModalOpen, clientEditOpen, setClientEditOpen, clientEditForm, saveClientEdit, clientModalOpen, setClientModalOpen, clientForm, saveClient, sourceOptions, policyModalOpen, policyForm, savePolicy, followUpModalOpen, followUpForm, saveFollowUp, followUpTaskMode, followUpTaskModalOpen, setFollowUpTaskModalOpen, followUpTaskForm, saveFollowUpTaskForm, activeFollowUpTask, completeTaskModalOpen, setCompleteTaskModalOpen, completeTaskForm, completeFollowUpTask, cancelTaskModalOpen, setCancelTaskModalOpen, cancelTaskTarget, cancelTaskForm, saveCancelFollowUpTask,showCustomerDrawer=true } = workspace;
  return (
    <>
      {showCustomerDrawer ? <Drawer title={<div className="drawer-title"><Avatar className="drawer-avatar">{selectedClient?.name?.slice(0, 1) || '客'}</Avatar><div><Title level={4}>{selectedClient?.name}</Title><Text className="muted">{selectedClient?.phone}</Text></div></div>} open={Boolean(selectedClient)} onClose={() => setSelectedClient(null)} size={560} extra={<Button size="small" icon={<EditOutlined />} onClick={openClientEdit}>编辑档案</Button>}>
        {selectedClient ? <>
          <div className="profile-tags"><Tag color={customerStageColors[selectedClient.stage]}>{selectedClient.stage}</Tag><Tag>{selectedClient.source}</Tag><Tag color={selectedClient.contact.includes('待确认') ? 'orange' : 'green'}>{selectedClient.contact}</Tag></div>
          <Descriptions size="small" column={2} className="profile-descriptions"><Descriptions.Item label="关注问题">{selectedClient.concern}</Descriptions.Item><Descriptions.Item label="下次跟进">{selectedClient.next}</Descriptions.Item><Descriptions.Item label="最近联系">{selectedClient.last}</Descriptions.Item><Descriptions.Item label="沟通偏好">{selectedClient.preferredContact || '待确认'}</Descriptions.Item><Descriptions.Item label="内容关联">{selectedClient.contentRef || (selectedClient.source === '线下拜访' ? '无（可选）' : '未关联')}</Descriptions.Item><Descriptions.Item label="创建时间">{new Date(selectedClient.createdAt).toLocaleDateString('zh-CN')}</Descriptions.Item></Descriptions>
          {selectedClient.stageHistory?.length ? <div className="small-note">阶段变更记录：{selectedClient.stageHistory.map((item) => `${item.from || '新建'} → ${item.to}`).join('；')}</div> : null}
          <Divider />
          <div className="drawer-section-head"><Title level={5}>已有保单</Title><Button size="small" icon={<PlusOutlined />} onClick={() => setPolicyModalOpen(true)}>新增保单</Button></div>
          {selectedClient.policies.length ? selectedClient.policies.map((policy) => <PolicyCard key={policy.id} policy={policy} apiLoading={apiLoading}
            onVerify={(item)=>performApiAction(`policy:verify:${item.id}`,()=>verifyPolicy(item))}
            onLifecycle={serviceWorkspace.openLifecycle}
            onCreateService={(item)=>serviceWorkspace.openCreateService(item,selectedClient.id)}
            onViewServices={showPolicyServices} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未录入保单" />}
          <Divider />
          <div className="drawer-section-head"><Title level={5}>跟进待办</Title><Button type="primary" size="small" icon={<PlusOutlined />} disabled={selectedClient.contact === '已拒绝联系'} onClick={() => openFollowUpTaskModal(selectedClient)}>安排跟进</Button></div>
          {selectedClient.contact === '待确认联系偏好' ? <Alert className="contact-status-alert" type="warning" showIcon title="联系偏好待确认" description="安排前请核对客户愿意使用的联系方式。" /> : null}
          {selectedClient.followUpTasks?.length ? <div className="profile-task-list">{selectedClient.followUpTasks.map((task) => <div className="profile-task-card" key={task.id}><div className="profile-task-main"><Tag color={task.bucket==='overdue'?'red':task.bucket==='today'?'gold':'default'}>{task.bucket==='overdue'?'已逾期':task.bucket==='today'?'今天':task.when}</Tag><Text strong>{task.title}</Text><Text className="schedule-meta">{task.method}{task.note ? ` · ${task.note}` : ''}</Text></div><Space size={4}><Button size="small" type="primary" onClick={() => openCompleteTaskModal(task)}>完成并记录</Button><Button size="small" onClick={() => openRescheduleTaskModal(task)}>延期</Button><Button size="small" color="danger" variant="outlined" loading={Boolean(apiLoading[`followup-task:cancel:${task.id}`])} onClick={() => cancelFollowUpTask(task)}>取消</Button></Space></div>)}</div> : <Text className="muted">暂无未完成待办，可为客户安排下一次联系。</Text>}
          {selectedClient.followUpTaskEvents?.length ? <div className="task-event-history"><Text strong>待办变更记录</Text>{selectedClient.followUpTaskEvents.slice(0,12).map((event) => <div className="task-event-row" key={event.id}><span>{event.action==='created'?'安排了':event.action==='rescheduled'?'调整了':event.action==='completed'?'完成了':'取消了'}「{event.title}」</span><Text className="schedule-meta">{event.action==='rescheduled' ? `${event.fromDate} → ${event.toDate} · ` : ''}{event.note} · {new Date(event.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}</Text></div>)}</div> : null}
          <Divider />
          <div className="drawer-section-head"><Title level={5}>跟进记录</Title><Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setFollowUpModalOpen(true)}>记录跟进</Button></div>
          <div className="note-timeline">{selectedClient.followUps?.length ? selectedClient.followUps.map((item) => <div className="note-row" key={item.id}><span className="timeline-dot" /><div><Text>{item.method}：{item.note}</Text><Text className="schedule-meta">{item.occurredAt ? new Date(item.occurredAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}) : '记录时间未知'}</Text></div></div>) : <Text className="muted">还没有跟进记录。</Text>}</div>
          <Divider />
          <div className="profile-next"><span className="metric-icon amber"><CalendarOutlined /></span><div><Text strong>下一步建议</Text><Text className="schedule-meta">围绕“{selectedClient.concern}”确认客户想解决的具体问题，并核对已录入资料。</Text></div></div>
        </> : null}
      </Drawer> : null}

      <Modal title="编辑客户档案" open={clientEditOpen} forceRender zIndex={1200} onCancel={() => setClientEditOpen(false)} onOk={() => clientEditForm.submit()} confirmLoading={Boolean(apiLoading['customer:update'])} okText="保存修改" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Form form={clientEditForm} layout="vertical" onFinish={(values) => performApiAction('customer:update',() => saveClientEdit(values))}>
          <Form.Item name="name" label="姓名 / 称呼" rules={[{required:true}]}><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="stage" label="客户阶段"><Select options={['新线索','已联系','需求了解中','已成交','已有客户','暂缓跟进'].map((value) => ({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="source" label="客户来源"><Select options={sourceOptions.map((value) => ({value,label:value}))} /></Form.Item></Col></Row>
          <Form.Item name="concern" label="关注问题"><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="preferredContact" label="联系偏好"><Select allowClear options={['电话','微信','线下拜访','其他'].map((value) => ({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="contact" label="联系授权状态"><Select options={['待确认联系偏好','已确认可按所选方式联系','已拒绝联系'].map((value) => ({value,label:value}))} /></Form.Item></Col></Row>
          <Form.Item name="contentRef" label="关联内容主题 / 链接（可选）"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="新增客户 / 线索" open={clientModalOpen} forceRender onCancel={() => { setClientModalOpen(false); clientForm.resetFields(); }} onOk={() => clientForm.submit()} confirmLoading={Boolean(apiLoading['customer:create'])} okText="保存档案" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">线下认识的客户也可以直接建档，来源和内容关联都可以单独记录。</Text>
        <Form form={clientForm} layout="vertical" onFinish={(values) => performApiAction('customer:create',() => saveClient(values))} initialValues={{ kind: '新线索', source: '线下拜访' }}>
          <Form.Item name="kind" label="建档类型" rules={[{ required: true }]}><Select options={[{ value: '新线索', label: '新线索' }, { value: '已有客户', label: '直接建档为已有客户' }]} /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="name" label="姓名 / 称呼" rules={[{ required: true, message: '请填写称呼' }]}><Input placeholder="如：林女士" /></Form.Item></Col><Col span={12}><Form.Item name="phone" label="联系电话"><Input placeholder="可暂不填写" /></Form.Item></Col></Row>
          <Row gutter={12}><Col span={12}><Form.Item name="source" label="客户来源" rules={[{ required: true }]}><Select options={sourceOptions.map((value) => ({ value, label: value }))} /></Form.Item></Col><Col span={12}><Form.Item name="next" label="下次跟进"><DatePicker className="full-width" /></Form.Item></Col></Row>
          <Form.Item name="concern" label="客户关注问题"><Input placeholder="如：家庭医疗保障" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="preferredContact" label="联系偏好"><Select allowClear options={['电话','微信','线下拜访','其他'].map((value) => ({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="contentRef" label="内容主题 / 链接（可选）"><Input placeholder="仅内容渠道线索需要" /></Form.Item></Col></Row>
          <Form.Item name="contactAllowed" valuePropName="checked"><Checkbox>已向客户说明联系用途，并确认可按约定方式联系</Checkbox></Form.Item>
          <Alert type="info" showIcon title="来源选项从后端字典读取；线下客户可直接建档，不需要关联内容。" />
        </Form>
      </Modal>

      <Modal title="新增保单" open={policyModalOpen} forceRender zIndex={1200} onCancel={() => { setPolicyModalOpen(false); policyForm.resetFields(); }} onOk={() => policyForm.submit()} confirmLoading={Boolean(apiLoading['policy:create'])} okText="保存保单" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">先记录客户提供的信息；未核对的责任、保费和日期可以标记为待核实。</Text>
        <Form form={policyForm} layout="vertical" onFinish={(values) => performApiAction('policy:create',() => savePolicy(values))} initialValues={{ company: '人保财险', state: '待核实',scope:'external' }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="company" label="保险公司" rules={[{ required: true }]}><Select options={['新华保险', '人保财险', '客户自有 / 其他'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="type" label="险种" rules={[{ required: true, message: '请填写险种' }]}><Input placeholder="如：车险、家财险" /></Form.Item></Col>
          </Row>
          <Form.Item name="name" label="产品 / 保单名称" rules={[{ required: true, message: '请填写保单名称' }]}><Input placeholder="以保单或保险合同记载为准" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="scope" label="服务关系"><Select options={[{value:'owned',label:'本人代理保单'},{value:'external',label:'客户自有 / 外部保单'}]} /></Form.Item></Col><Col span={12}><Form.Item name="policyNumber" label="保单号（可选）"><Input placeholder="保存时仅显示脱敏号码" /></Form.Item></Col></Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="premium" label="保费"><Input placeholder="可暂不填写" /></Form.Item></Col>
            <Col span={12}><Form.Item name="amount" label="保额 / 责任摘要"><Input placeholder="可暂不填写" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="expiry" label="续保 / 到期日"><DatePicker className="full-width" /></Form.Item></Col>
            <Col span={12}><Form.Item name="state" label="资料状态"><Select options={['待核实', '已核实'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="effectiveDate" label="起保日（可选）"><DatePicker className="full-width" /></Form.Item></Col>
            <Col span={12}><Form.Item name="nextPaymentDate" label="下次缴费日（可选）"><DatePicker className="full-width" /></Form.Item></Col>
          </Row>
          <Form.Item name="renewedFromPolicyId" label="续保来源保单（可选）"><Select allowClear placeholder="新合同由哪份保单续保而来" options={(selectedClient?.policies || []).map((policy)=>({value:policy.id,label:`${policy.company} · ${policy.name}`}))} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="记录跟进" open={followUpModalOpen} forceRender zIndex={1200} onCancel={() => { setFollowUpModalOpen(false); followUpForm.resetFields(); }} onOk={() => followUpForm.submit()} confirmLoading={Boolean(apiLoading['followup:create'])} okText="保存记录" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">只记录展业和服务所需的信息，避免写入与服务无关的敏感内容。</Text>
        <Form form={followUpForm} layout="vertical" onFinish={(values) => performApiAction('followup:create',() => saveFollowUp(values))} initialValues={{ method: '电话' }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="method" label="联系方式"><Select options={['电话', '微信', '线下拜访', '其他'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="next" label="下次跟进"><DatePicker className="full-width" /></Form.Item></Col>
          </Row>
          <Form.Item name="note" label="沟通记录" rules={[{ required: true, message: '请简要记录本次沟通' }]}><Input.TextArea rows={4} placeholder="客户主要关注什么，约定了什么下一步？" maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title={followUpTaskMode==='create'?'安排客户跟进':'调整跟进时间'} open={followUpTaskModalOpen} forceRender zIndex={1200} onCancel={() => {setFollowUpTaskModalOpen(false);followUpTaskForm.resetFields();}} onOk={() => followUpTaskForm.submit()} confirmLoading={Boolean(apiLoading['followup-task:create']) || Boolean(activeFollowUpTask && apiLoading[`followup-task:update:${activeFollowUpTask.id}`])} okText={followUpTaskMode==='create'?'保存待办':'保存调整'} cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">日期必填，时间可选。只写日期的待办会在当天显示为“今天”。</Text>
        <Form form={followUpTaskForm} layout="vertical" onFinish={saveFollowUpTaskForm}>
          <Form.Item name="title" label="跟进目的" rules={[{required:true,message:'请填写跟进目的'}]}><Input maxLength={120} showCount placeholder="例如：确认车险续保需求" /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="method" label="计划联系方式"><Select options={['电话','微信','线下拜访','其他'].map((value)=>({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="dueDate" label="跟进日期" rules={[{required:true,message:'请选择日期'}]}><DatePicker className="full-width" /></Form.Item></Col></Row>
          <Form.Item name="dueTime" label="计划时间（可选）"><TimePicker className="full-width" format="HH:mm" minuteStep={15} /></Form.Item>
          <Form.Item name="note" label="补充说明"><Input.TextArea rows={3} maxLength={500} showCount placeholder="这次要确认什么，或需要准备什么？" /></Form.Item>
          {followUpTaskMode==='reschedule' ? <Form.Item name="changeNote" label="延期原因" rules={[{required:true,message:'请简要说明调整原因'}]}><Input maxLength={300} placeholder="例如：客户希望改到周五联系" /></Form.Item> : null}
        </Form>
      </Modal>

      <Modal title={`完成跟进 · ${activeFollowUpTask?.customerName || ''}`} open={completeTaskModalOpen} forceRender zIndex={1200} onCancel={() => {setCompleteTaskModalOpen(false);completeTaskForm.resetFields();}} onOk={() => completeTaskForm.submit()} confirmLoading={Boolean(activeFollowUpTask && apiLoading[`followup-task:complete:${activeFollowUpTask.id}`])} okText="完成并记录" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">记录实际联系结果后，这项待办会完成并进入客户沟通时间线。</Text>
        <Form form={completeTaskForm} layout="vertical" onFinish={completeFollowUpTask}>
          <Row gutter={12}><Col span={12}><Form.Item name="method" label="实际联系方式" rules={[{required:true,message:'请选择联系方式'}]}><Select options={['电话','微信','线下拜访','其他'].map((value)=>({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="outcome" label="联系结果" rules={[{required:true,message:'请选择联系结果'}]}><Select options={[{value:'contacted',label:'已联系'},{value:'not_reached',label:'未接通'}]} /></Form.Item></Col></Row>
          <Form.Item name="note" label="联系情况" rules={[{required:true,message:'请填写本次联系结果'}]}><Input.TextArea rows={4} maxLength={500} showCount placeholder="例如：已沟通续保时间，客户希望先核对车辆信息。未接通时记录尝试情况。" /></Form.Item>
          <Form.Item name="scheduleNext" valuePropName="checked"><Checkbox>同时安排下一次跟进</Checkbox></Form.Item>
          <Form.Item noStyle shouldUpdate={(previous,current)=>previous.scheduleNext!==current.scheduleNext}>{({getFieldValue})=>getFieldValue('scheduleNext') ? <div className="next-task-fields"><Form.Item name="nextTitle" label="下一次跟进目的" rules={[{required:true,message:'请填写下一次跟进目的'}]}><Input maxLength={120} placeholder="例如：确认最终方案" /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="nextMethod" label="计划联系方式"><Select options={['电话','微信','线下拜访','其他'].map((value)=>({value,label:value}))} /></Form.Item></Col><Col span={12}><Form.Item name="nextDate" label="跟进日期" rules={[{required:true,message:'请选择日期'}]}><DatePicker className="full-width" /></Form.Item></Col></Row><Form.Item name="nextTime" label="计划时间（可选）"><TimePicker className="full-width" format="HH:mm" minuteStep={15} /></Form.Item><Form.Item name="nextNote" label="补充说明"><Input.TextArea rows={2} maxLength={500} /></Form.Item></div> : null}</Form.Item>
        </Form>
      </Modal>

      <Modal title="取消跟进待办" open={cancelTaskModalOpen} forceRender zIndex={1200} onCancel={() => {setCancelTaskModalOpen(false);setCancelTaskTarget(null);cancelTaskForm.resetFields();}} onOk={() => cancelTaskForm.submit()} confirmLoading={Boolean(cancelTaskTarget && apiLoading[`followup-task:cancel:${cancelTaskTarget.id}`])} okText="确认取消" okButtonProps={{color:'danger',variant:'outlined'}} cancelText="返回" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">取消记录会留在待办变更历史中，不再触发提醒。</Text>
        <Form form={cancelTaskForm} layout="vertical" onFinish={saveCancelFollowUpTask}><Form.Item name="note" label="取消原因" rules={[{required:true,message:'请填写取消原因'}]}><Input.TextArea rows={3} maxLength={300} showCount placeholder="例如：客户暂不需要继续跟进" /></Form.Item></Form>
      </Modal>
    </>
  );
}
