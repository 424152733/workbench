import { Alert, Button, DatePicker, Descriptions, Divider, Drawer, Empty, Form, Input, Modal, Select, Space, Tag, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { contractStatusOptions,optionLabel,serviceIsOpen,serviceKindOptions,serviceStatusOptions } from './policy-service-options.js';

const { Text,Title } = Typography;
const openStatusOptions = serviceStatusOptions.filter((item)=>serviceIsOpen(item.value));
const eventNames = {created:'创建事项',updated:'调整事项',progress:'记录进展',completed:'完成事项',cancelled:'取消事项'};
const policyFieldNames = {contractStatus:'合同状态',effectiveDate:'起保日期',expiryDate:'到期日期',nextPaymentDate:'下次缴费日期',statusConfirmedOn:'状态确认日期',statusBasis:'状态依据'};
const formatValue = (key,value) => key === 'contractStatus' ? optionLabel(contractStatusOptions,value) : value || '未填写';
const lifecycleSummary = (event) => {
  if (event.action === 'created') return '录入保单资料';
  return Object.keys(policyFieldNames).filter((key)=>event.before?.[key] !== event.after?.[key])
    .map((key)=>`${policyFieldNames[key]}：${formatValue(key,event.before?.[key])} → ${formatValue(key,event.after?.[key])}`).join('；') || '资料已核对';
};

export function PolicyServiceOverlays({workspace,apiLoading,onScheduleContact,onOpenCustomer,onCreateRenewalPolicy,onCompleteContact,onRescheduleContact}) {
  const {
    selectedService,setSelectedService,createPolicy,setCreatePolicy,createForm,saveCreateService,
    actionMode,setActionMode,actionForm,openAction,saveAction,
    lifecyclePolicy,setLifecyclePolicy,lifecycleData,lifecycleForm,saveLifecycle,openLifecycle,
  } = workspace;
  const actionTitles = {edit:'调整服务事项',progress:'记录处理进展',complete:'完成服务事项',cancel:'取消服务事项'};
  const actionLoading = selectedService && actionMode ? Boolean(apiLoading[`service-item:${actionMode}:${selectedService.id}`]) : false;
  return <>
    <Drawer title="保单服务事项" open={Boolean(selectedService)} onClose={()=>setSelectedService(null)} size={620} zIndex={1100}>
      {selectedService ? <div className="service-detail">
        <div className="service-detail-heading"><div><Text className="eyebrow">{optionLabel(serviceKindOptions,selectedService.kind)} · {selectedService.company}</Text><Title level={4}>{selectedService.title}</Title></div><Tag color={selectedService.status==='completed'?'green':selectedService.status==='cancelled'?'default':'blue'}>{optionLabel(serviceStatusOptions,selectedService.status)}</Tag></div>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="客户"><Button size="small" onClick={()=>onOpenCustomer(selectedService.customerId)}>{selectedService.customerName}</Button></Descriptions.Item>
          <Descriptions.Item label="保单">{selectedService.policyName} · {selectedService.policyNumber}</Descriptions.Item>
          <Descriptions.Item label="服务关系">{selectedService.scope==='owned'?'本人代理':'客户自有 / 外部保单'}</Descriptions.Item>
          <Descriptions.Item label="下一步处理日">{selectedService.nextActionDate}{selectedService.bucket==='overdue'?' · 已逾期':selectedService.bucket==='today'?' · 今天':''}</Descriptions.Item>
          {selectedService.anchorDate ? <Descriptions.Item label="周期日期">{selectedService.anchorDate}</Descriptions.Item> : null}
          {selectedService.closedOn ? <Descriptions.Item label="结案日期">{selectedService.closedOn}</Descriptions.Item> : null}
        </Descriptions>
        {selectedService.description ? <p className="service-description">{selectedService.description}</p> : null}
        {selectedService.outcome ? <Alert type={selectedService.status==='completed'?'success':'info'} showIcon title="处理结果" description={selectedService.outcome} /> : null}
        {serviceIsOpen(selectedService.status) ? <div className="service-detail-actions"><Space wrap>
          <Button type="primary" size="small" onClick={()=>openAction('progress')}>记录进展</Button>
          <Button size="small" onClick={()=>onScheduleContact(selectedService)} disabled={selectedService.contactStatus==='已拒绝联系'}>安排联系</Button>
          <Button size="small" onClick={()=>openAction('edit')}>调整事项</Button>
          <Button size="small" onClick={()=>openAction('complete')}>完成</Button>
          <Button size="small" color="danger" variant="outlined" onClick={()=>openAction('cancel')}>取消</Button>
        </Space></div> : null}
        {selectedService.contactStatus==='已拒绝联系' && serviceIsOpen(selectedService.status) ? <Alert type="warning" showIcon title="客户已拒绝联系" description="可以记录非联系性质的服务进展，不能安排新的联系待办。" /> : null}
        <div className="service-detail-actions"><Space wrap><Button size="small" onClick={()=>openLifecycle({id:selectedService.policyId})} loading={Boolean(apiLoading[`policy:lifecycle:open:${selectedService.policyId}`])}>核对保单状态</Button>{selectedService.kind==='renewal' ? <Button size="small" onClick={()=>onCreateRenewalPolicy(selectedService)}>录入续保新保单</Button> : null}</Space></div>
        <Divider />
        <Title level={5}>处理进展</Title>
        {selectedService.events?.length ? <Timeline items={selectedService.events.map((event)=>({content:<div><Text strong>{eventNames[event.action] || event.action}</Text><Text className="schedule-meta">{new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</Text><div>{event.note}</div>{event.fromStatus && event.toStatus && event.fromStatus!==event.toStatus ? <Text className="schedule-meta">{optionLabel(serviceStatusOptions,event.fromStatus)} → {optionLabel(serviceStatusOptions,event.toStatus)}</Text> : null}</div>}))} /> : <Empty description="尚无处理进展" />}
        <Divider />
        <Title level={5}>关联联系</Title>
        {selectedService.followUpTasks?.length ? <div className="service-contact-list">{selectedService.followUpTasks.map((task)=><div className="service-contact-row" key={task.id}><div><Tag color={task.status==='pending'?'blue':'default'}>{task.status==='pending'?'待联系':task.status==='completed'?'已完成':'已取消'}</Tag><Text strong>{task.title}</Text><Text className="schedule-meta">{task.when}</Text></div>{task.status==='pending' ? <Space><Button size="small" onClick={()=>onCompleteContact({...task,customerName:selectedService.customerName})}>完成并记录</Button><Button size="small" onClick={()=>onRescheduleContact({...task,customerName:selectedService.customerName})}>延期</Button></Space> : null}</div>)}</div> : <Text className="muted">尚未安排关联的客户联系。</Text>}
        {selectedService.followUps?.length ? <div className="service-contact-history">{selectedService.followUps.map((record)=><p key={record.id}><Text strong>{record.method}</Text> · {record.note}<Text className="schedule-meta">{new Date(record.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</Text></p>)}</div> : null}
      </div> : null}
    </Drawer>

    <Modal title={`为「${createPolicy?.name || ''}」发起服务`} open={Boolean(createPolicy)} onCancel={()=>{setCreatePolicy(null);createForm.resetFields();}} onOk={()=>createForm.submit()} confirmLoading={Boolean(apiLoading['service-item:create'])} okText="建立事项" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} zIndex={1250} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={saveCreateService}>
        <Form.Item name="kind" label="服务类型" rules={[{required:true,message:'请选择服务类型'}]}><Select options={serviceKindOptions} onChange={(kind)=>{
          const anchor = kind==='renewal'?createPolicy?.expiryDate:kind==='payment'?createPolicy?.nextPaymentDate:null;
          createForm.setFieldsValue({title:`${createPolicy?.name || '保单'}${optionLabel(serviceKindOptions,kind)}跟进`,anchorDate:anchor?dayjs(anchor):null});
        }} /></Form.Item>
        <Form.Item name="title" label="事项标题" rules={[{required:true,message:'请填写事项标题'}]}><Input maxLength={120} showCount /></Form.Item>
        <Form.Item name="nextActionDate" label="下一步处理日" rules={[{required:true,message:'请选择下一步处理日'}]}><DatePicker className="full-width" /></Form.Item>
        <Form.Item name="anchorDate" label="对应缴费 / 到期日（可选）"><DatePicker className="full-width" /></Form.Item>
        <Form.Item name="description" label="需要办理什么"><Input.TextArea rows={3} maxLength={1000} showCount placeholder="简要记录当前需求和下一步" /></Form.Item>
        {createPolicy?.scope==='external' ? <Alert type="info" showIcon title="客户自有 / 外部保单" description="请根据客户提供的资料和保险公司正式信息核对进展。" /> : null}
      </Form>
    </Modal>

    <Modal title={actionTitles[actionMode] || '处理事项'} open={Boolean(actionMode)} onCancel={()=>{setActionMode(null);actionForm.resetFields();}} onOk={()=>actionForm.submit()} confirmLoading={actionLoading} okText={actionMode==='complete'?'确认完成':actionMode==='cancel'?'确认取消':'保存'} okButtonProps={actionMode==='cancel'?{color:'danger',variant:'outlined'}:undefined} cancelText="返回" cancelButtonProps={{color:"danger",variant:"outlined"}} zIndex={1250} destroyOnHidden>
      <Form form={actionForm} layout="vertical" onFinish={saveAction}>
        {actionMode==='edit' ? <><Form.Item name="title" label="事项标题" rules={[{required:true}]}><Input maxLength={120} /></Form.Item><Form.Item name="description" label="事项说明"><Input.TextArea rows={3} maxLength={1000} /></Form.Item><Form.Item name="nextActionDate" label="下一步处理日" rules={[{required:true}]}><DatePicker className="full-width" /></Form.Item><Form.Item name="changeNote" label="调整原因"><Input maxLength={500} placeholder="如：客户要求改期" /></Form.Item></> : null}
        {actionMode==='progress' ? <><Form.Item name="status" label="目前进度" rules={[{required:true}]}><Select options={openStatusOptions} /></Form.Item><Form.Item name="nextActionDate" label="下次回看日期" rules={[{required:true}]}><DatePicker className="full-width" /></Form.Item><Form.Item name="note" label="本次进展" rules={[{required:true,message:'请记录本次进展'}]}><Input.TextArea rows={4} maxLength={1000} showCount /></Form.Item></> : null}
        {actionMode==='complete' || actionMode==='cancel' ? <><Form.Item name="closedOn" label="处理日期" rules={[{required:true}]}><DatePicker className="full-width" /></Form.Item><Form.Item name={actionMode==='complete'?'outcome':'reason'} label={actionMode==='complete'?'实际处理结果':'取消原因'} rules={[{required:true,message:'请填写处理结果或原因'}]}><Input.TextArea rows={4} maxLength={1000} showCount /></Form.Item></> : null}
      </Form>
    </Modal>

    <Modal title={`核对保单状态 · ${lifecycleData?.policyName || ''}`} open={Boolean(lifecyclePolicy)} onCancel={()=>{setLifecyclePolicy(null);lifecycleForm.resetFields();}} onOk={()=>lifecycleForm.submit()} confirmLoading={Boolean(lifecyclePolicy && apiLoading[`policy:lifecycle:save:${lifecyclePolicy.id}`])} okText="保存核对结果" cancelText="关闭" cancelButtonProps={{color:"danger",variant:"outlined"}} width={650} zIndex={1300} destroyOnHidden>
      <Alert type="info" showIcon title="日期提醒与合同状态分别记录" description="到期日已过只提示核对；合同状态请依据正式资料确认。" />
      <Form form={lifecycleForm} layout="vertical" onFinish={saveLifecycle} className="service-lifecycle-form">
        <Form.Item name="contractStatus" label="合同状态" rules={[{required:true}]}><Select options={contractStatusOptions} /></Form.Item>
        <div className="service-date-grid"><Form.Item name="effectiveDate" label="起保日"><DatePicker className="full-width" /></Form.Item><Form.Item name="expiryDate" label="到期日"><DatePicker className="full-width" /></Form.Item><Form.Item name="nextPaymentDate" label="下次缴费日"><DatePicker className="full-width" /></Form.Item><Form.Item name="statusConfirmedOn" label="状态确认日期"><DatePicker className="full-width" /></Form.Item></div>
        <Form.Item name="statusBasis" label="合同状态依据"><Input maxLength={500} placeholder="如：已核对保险公司正式记录" /></Form.Item>
        <Form.Item name="reason" label="本次变更说明" rules={[{required:true,message:'请填写本次核对或变更说明'}]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
      <Divider />
      <Text strong>变更历史</Text>
      <div className="service-lifecycle-history">{lifecycleData?.events?.length ? lifecycleData.events.map((event)=><div key={event.id}><Text>{lifecycleSummary(event)}</Text><Text className="schedule-meta">{event.reason} · {new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</Text></div>) : <Text className="muted">尚无变更记录</Text>}</div>
    </Modal>
  </>;
}
