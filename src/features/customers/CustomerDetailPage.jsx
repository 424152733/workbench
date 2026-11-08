import { useEffect, useState } from 'react';
import { Avatar, Alert, Breadcrumb, Button, Card, Collapse, Descriptions, Divider, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, CalendarOutlined, EditOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import { PolicyCard } from './PolicyCard.jsx';
import { CustomerFamiliesPanel } from './CustomerFamiliesPanel.jsx';
import { PolicyContractOrganizer } from './PolicyContractOrganizer.jsx';
import { CoverageReviewPanel } from './CoverageReviewPanel.jsx';
import { customerStageColors } from './customer-options.js';

const {Title,Text} = Typography;

export function CustomerDetailPage({customer,loading,returnFamilyId,onBack,onHome,onClients,onEdit,onPolicy,onFollowUp,onCompleteTask,onRescheduleTask,onCancelTask,onService,onVerify,serviceWorkspace,apiLoading,performApiAction,api,onError,onSuccess,onCustomerUpdated,onOpenFamily}) {
  const [acquisitionOpen,setAcquisitionOpen] = useState(false);
  const [acquisitionSources,setAcquisitionSources] = useState([]);
  const [contractRevision,setContractRevision] = useState(0);
  const [acquisitionForm] = Form.useForm();
  const acquisitionActionKey = `customer:acquisition:${customer?.id}`;
  const sourceLoading = Boolean(apiLoading['customer:acquisition-sources']);

  useEffect(() => {
    if (!acquisitionOpen) return undefined;
    let active = true;
    performApiAction('customer:acquisition-sources',api.customerAcquisitionSources)
      .then((sources) => { if (active) setAcquisitionSources(sources); })
      .catch((error) => { if (active) onError(error); });
    acquisitionForm.setFieldsValue({
      initialKind: customer?.acquisition?.initialKind || (customer?.kind === '已有客户' ? '已有客户' : '新线索'),
      sourceCode: customer?.acquisition?.sourceCode || '',
      reason: '',
    });
    return () => { active = false; };
  }, [acquisitionOpen,customer?.id]);

  const saveAcquisition = async (values) => {
    try {
      const updated = await performApiAction(acquisitionActionKey,async () => {
        await api.updateCustomerAcquisition(customer.id,values);
        return api.customer(customer.id);
      });
      onCustomerUpdated?.(updated);
      setAcquisitionOpen(false);
      onSuccess('获客资料已确认，相关分析已按新资料重新统计');
    } catch (error) { onError(error); }
  };

  const deletePolicy = async (policy) => {
    try {
      const updated=await performApiAction(`policy:delete:${policy.id}`,()=>api.deletePolicy(customer.id,policy.id));
      onCustomerUpdated?.(updated);
      onSuccess('保单和保障检视记录已删除；原合同仍保留在合同整理中，可重新归档');
    } catch(error) { onError(error); }
  };

  if (loading && !customer) return <div className="page-loading"><Spin /></div>;
  if (!customer) return <Card className="panel-card"><Empty description="找不到这位客户档案"><Button onClick={onBack}>返回客户列表</Button></Empty></Card>;
  return <div className="customer-detail-page">
    <Breadcrumb items={[
      {title:<button className="breadcrumb-link" onClick={onHome}>工作台</button>},
      {title:<button className="breadcrumb-link" onClick={onClients}>客户与保单</button>},
      returnFamilyId ? {title:<button className="breadcrumb-link" onClick={onBack}>家庭规划</button>} : {title:<button className="breadcrumb-link" onClick={onBack}>客户列表</button>},
      {title:customer.name},
    ]} />
    <Card className="panel-card customer-detail-hero">
      <div className="customer-detail-heading"><Avatar size={58} icon={<UserOutlined />} className="customer-detail-avatar">{customer.name?.slice(0,1)}</Avatar><div className="customer-detail-title"><Title level={2}>{customer.name}</Title><Space wrap><Tag color={customerStageColors[customer.stage]}>{customer.stage}</Tag><Tag>{customer.source}</Tag><Tag color={customer.contact?.includes('待确认')?'orange':customer.contact==='已拒绝联系'?'red':'green'}>{customer.contact}</Tag></Space></div><Space wrap className="customer-detail-actions"><Button size="small" icon={<EditOutlined />} onClick={onEdit}>编辑档案</Button><Button size="small" icon={<PlusOutlined />} onClick={onPolicy}>新增保单</Button><Button type="primary" size="small" disabled={customer.contact==='已拒绝联系'} icon={<CalendarOutlined />} onClick={onFollowUp}>安排跟进</Button></Space></div>
      <Divider />
      <Descriptions column={{xs:1,sm:2,lg:3}} size="small">
        <Descriptions.Item label="联系电话">{customer.phone || '未录入'}</Descriptions.Item>
        <Descriptions.Item label="关注问题">{customer.concern || '待了解'}</Descriptions.Item>
        <Descriptions.Item label="沟通偏好">{customer.preferredContact || '待确认'}</Descriptions.Item>
        <Descriptions.Item label="最近联系">{customer.last || '暂无记录'}</Descriptions.Item>
        <Descriptions.Item label="下次跟进">{customer.next || '未安排'}</Descriptions.Item>
        <Descriptions.Item label="内容关联">{customer.contentRef || '无'}</Descriptions.Item>
      </Descriptions>
      {customer.contact==='待确认联系偏好' ? <Alert className="contact-status-alert" type="warning" showIcon title="联系偏好待确认" description="安排前请核对客户愿意使用的联系方式。" /> : null}
    </Card>

    <Card className="panel-card customer-detail-section" title={<Title level={4}>获客归因</Title>} extra={<Button size="small" onClick={()=>setAcquisitionOpen(true)}>更正 / 确认获客资料</Button>}>
      <Descriptions column={{xs:1,sm:2,lg:3}} size="small">
        <Descriptions.Item label="当前来源">{customer.source || '未记录'}</Descriptions.Item>
        <Descriptions.Item label="获客来源">{customer.acquisition?.source || '待确认'}</Descriptions.Item>
        <Descriptions.Item label="建档时身份">{customer.acquisition?.initialKind || '待确认'}</Descriptions.Item>
        <Descriptions.Item label="归因资料状态">{{captured:'创建时记录',legacy_snapshot:'旧档案快照 · 待人工核对',manually_confirmed:'人工确认'}[customer.acquisition?.basis] || '待确认'}</Descriptions.Item>
      </Descriptions>
      {customer.acquisition?.source && customer.source !== customer.acquisition.source ? <Alert className="contact-status-alert" type="info" showIcon message="当前来源与获客来源不同" description="当前来源用于客户档案维护；分析统计使用建档时的获客来源。修改获客归因会影响历史统计。" /> : null}
    </Card>

    <Modal title="更正 / 确认获客资料" open={acquisitionOpen} onCancel={()=>setAcquisitionOpen(false)} onOk={()=>acquisitionForm.submit()}
      okText="保存并确认" confirmLoading={Boolean(apiLoading[acquisitionActionKey])} destroyOnHidden>
      <Alert className="contact-status-alert" type="info" showIcon message="该资料用于来源转化分析" description="请按原始登记核对建档时身份和获客来源。此操作会记录原因；缺少建档时的初始阶段记录仍不会纳入正式转化率。" />
      <Form form={acquisitionForm} layout="vertical" onFinish={saveAcquisition}>
        <Form.Item name="initialKind" label="建档时身份" rules={[{required:true,message:'请选择建档时身份'}]}>
          <Select options={[{value:'新线索',label:'新线索'},{value:'已有客户',label:'已有客户'}]} />
        </Form.Item>
        <Form.Item name="sourceCode" label="获客来源" rules={[{required:true,message:'请选择获客来源'}]}>
          <Select loading={sourceLoading} options={acquisitionSources.map((item)=>({value:item.code,label:item.label}))} />
        </Form.Item>
        <Form.Item name="reason" label="更正 / 确认原因" rules={[{required:true,message:'请填写原因'},{max:500,message:'原因不能超过 500 个字'}]}>
          <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：核对原始登记后确认" />
        </Form.Item>
      </Form>
    </Modal>

    <CustomerFamiliesPanel customer={customer} api={api} apiLoading={apiLoading} performApiAction={performApiAction}
      onOpenFamily={onOpenFamily} onError={onError} onSuccess={onSuccess} />

    <CoverageReviewPanel customer={customer} api={api} apiLoading={apiLoading} performApiAction={performApiAction}
      onError={onError} onSuccess={onSuccess} onFollowUp={onFollowUp} onCustomerUpdated={onCustomerUpdated} contractRevision={contractRevision} />

    <PolicyContractOrganizer customer={customer} api={api} apiLoading={apiLoading} performApiAction={performApiAction}
      onError={onError} onSuccess={onSuccess} onCustomerUpdated={onCustomerUpdated} onContractsChanged={()=>setContractRevision((revision)=>revision+1)} />

    <Card className="panel-card customer-detail-section" title={<div><Title level={4}>保单档案</Title><Text className="muted">这里用于核对状态和维护保单；保障责任详情见上方保障检视。</Text></div>} extra={<Button type="primary" icon={<PlusOutlined />} onClick={onPolicy}>新增保单</Button>}>
      {customer.policies?.length ? <Collapse className="customer-policy-management-collapse" items={[{key:'policies',label:<Space wrap><Text strong>管理已登记保单</Text><Text className="muted">{customer.policies.length} 份 · 展开后可核实、记录服务或删除</Text></Space>,children:<div className="customer-policy-management-list">{customer.policies.map((policy)=><PolicyCard key={policy.id} policy={policy} apiLoading={apiLoading}
        onVerify={(item)=>performApiAction(`policy:verify:${item.id}`,()=>onVerify(item))}
        onLifecycle={serviceWorkspace.openLifecycle}
        onCreateService={(item)=>serviceWorkspace.openCreateService(item,customer.id)}
        onViewServices={onService} onDelete={deletePolicy} />)}</div>}]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未录入保单" />}
    </Card>

    <Card className="panel-card customer-detail-section" title={<Title level={4}>跟进与沟通</Title>}>
      {customer.followUpTasks?.length ? <div className="profile-task-list">{customer.followUpTasks.map((task)=><div className="profile-task-card" key={task.id}><div className="profile-task-main"><Tag color={task.bucket==='overdue'?'red':task.bucket==='today'?'gold':'default'}>{task.bucket==='overdue'?'已逾期':task.bucket==='today'?'今天':task.when}</Tag><Text strong>{task.title}</Text><Text className="schedule-meta">{task.method}{task.note ? ` · ${task.note}` : ''}</Text></div><Space wrap><Button size="small" type="primary" onClick={()=>onCompleteTask(task)}>完成并记录</Button><Button size="small" onClick={()=>onRescheduleTask(task)}>延期</Button><Button size="small" color="danger" variant="outlined" loading={Boolean(apiLoading[`followup-task:cancel:${task.id}`])} onClick={()=>onCancelTask(task)}>取消</Button></Space></div>)}</div> : <Text className="muted">暂无未完成的跟进待办。</Text>}
      <Divider />
      {customer.followUps?.length ? <div className="note-timeline">{customer.followUps.map((item)=><div className="note-row" key={item.id}><span className="timeline-dot" /><div><Text>{item.method}：{item.note}</Text><Text className="schedule-meta">{item.occurredAt ? new Date(item.occurredAt).toLocaleString('zh-CN') : '记录时间未知'}</Text></div></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有沟通记录" />}
    </Card>
    <Button size="small" className="customer-detail-back" icon={<ArrowLeftOutlined />} onClick={onBack}>{returnFamilyId ? '返回家庭规划' : '返回客户列表'}</Button>
  </div>;
}
