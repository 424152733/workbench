import { Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { contractStatusOptions,optionLabel } from './policy-service-options.js';

const { Text } = Typography;
const todayInShanghai = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());

export function PolicyCard({policy,apiLoading,onVerify,onLifecycle,onCreateService,onViewServices,onDelete}) {
  const datePassed = policy.expiryDate && policy.expiryDate < todayInShanghai();
  return <div className="policy-card service-policy-card">
    <div className="policy-card-head">
      <div><Text strong>{policy.name}</Text><Text className="schedule-meta">{policy.company} · {policy.type} · {policy.scope==='owned'?'本人代理':'客户自有 / 外部保单'}</Text></div>
      <Space wrap><Tag color={policy.state==='已核实'?'green':'orange'}>{policy.state}</Tag><Tag color={policy.contractStatus==='active'?'green':'default'}>{optionLabel(contractStatusOptions,policy.contractStatus)}</Tag></Space>
    </div>
    <div className="policy-facts"><span>保费　{policy.premium}</span><span>保额/责任　{policy.amount}</span><span>起保　{policy.effectiveDate || '待核实'}</span><span>续保/到期　{policy.expiry}</span><span>下次缴费　{policy.nextPaymentDate || '未录入'}</span></div>
    {datePassed && !['expired','terminated'].includes(policy.contractStatus) ? <Text className="service-policy-warning">记录的到期日已过，请核对合同状态</Text> : null}
    <div className="service-policy-actions"><Space wrap>
      <Button size="small" loading={Boolean(apiLoading[`policy:verify:${policy.id}`])} onClick={()=>onVerify(policy)}>{policy.state==='已核实'?'改为待核实':'核实资料'}</Button>
      <Button size="small" loading={Boolean(apiLoading[`policy:lifecycle:open:${policy.id}`])} onClick={()=>onLifecycle(policy)}>核对状态</Button>
      <Button size="small" onClick={()=>onViewServices(policy)}>服务记录</Button>
      <Button size="small" type="primary" onClick={()=>onCreateService(policy)}>发起服务</Button>
      {onDelete ? <Popconfirm title="确定删除这份保单？" description="保障检视中的对应记录、家庭保单关联、状态历史和服务事项会一并移除；客户跟进与沟通记录、原合同文件和整理结果会保留，之后可重新归档。" okText="删除保单" cancelText="取消" okButtonProps={{danger:true,loading:Boolean(apiLoading[`policy:delete:${policy.id}`])}} onConfirm={()=>onDelete(policy)}>
        <Button size="small" danger icon={<DeleteOutlined />} loading={Boolean(apiLoading[`policy:delete:${policy.id}`])}>删除保单</Button>
      </Popconfirm> : null}
    </Space></div>
  </div>;
}
