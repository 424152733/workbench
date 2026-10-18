import { Button, Card, Empty, Input, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { serviceKindOptions,serviceStatusOptions,optionLabel } from './policy-service-options.js';

const { Text } = Typography;

export function ServiceItemsPanel({workspace,apiLoading}) {
  const {
    serviceStatus,setServiceStatus,serviceRange,setServiceRange,serviceKind,setServiceKind,
    serviceSearch,setServiceSearch,servicePage,setServicePage,servicePolicyId,clearPolicyFilter,
    serviceData,openService,
  } = workspace;
  const columns = [
    {title:'服务事项',dataIndex:'title',key:'title',render:(value,item)=>{
      const loading = Boolean(apiLoading[`service-item:open:${item.id}`]);
      return <div className="service-table-title"><a href="/clients?view=services" className="service-title-link" aria-busy={loading || undefined}
        onClick={(event)=>{const modified=event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0;if(modified)return;event.preventDefault();if(!loading)openService(item.id);}}>
        {value}{loading ? <Spin size="small" /> : null}
      </a><Text className="schedule-meta">{optionLabel(serviceKindOptions,item.kind)} · {item.company} · {item.policyName}</Text></div>;
    }},
    {title:'客户',dataIndex:'customerName',key:'customerName'},
    {title:'状态',dataIndex:'status',key:'status',render:(value)=><Tag color={value==='completed'?'green':value==='cancelled'?'default':value.startsWith('waiting')?'gold':'blue'}>{optionLabel(serviceStatusOptions,value)}</Tag>},
    {title:'处理日期',dataIndex:'nextActionDate',key:'nextActionDate',render:(value,item)=><Tag color={item.bucket==='overdue'?'red':item.bucket==='today'?'gold':'default'}>{item.closedOn ? `结案 · ${item.closedOn}` : `${item.bucket==='overdue'?'已逾期 · ':item.bucket==='today'?'今天 · ':''}${value || '—'}`}</Tag>},
    {title:'操作',key:'action',align:'right',render:(_,item)=><Button size="small" onClick={()=>openService(item.id)} loading={Boolean(apiLoading[`service-item:open:${item.id}`])}>查看进展</Button>},
  ];
  return <Card className="panel-card service-list-panel">
    <div className="service-filter-row">
      <Input allowClear prefix={<SearchOutlined />} placeholder="搜索客户、保单或事项" value={serviceSearch} onChange={(event)=>{setServiceSearch(event.target.value);setServicePage(1);}} />
      <Select aria-label="服务状态" value={serviceStatus} onChange={(value)=>{setServiceStatus(value);setServiceRange('all');setServicePage(1);}} options={[{value:'open',label:'全部未完成'},{value:'completed',label:'已完成'},{value:'cancelled',label:'已取消'},{value:'all',label:'全部'}]} />
      <Select aria-label="服务时间范围" value={serviceRange} disabled={serviceStatus==='completed'||serviceStatus==='cancelled'} onChange={(value)=>{setServiceRange(value);setServicePage(1);}} options={[{value:'all',label:'全部日期'},{value:'overdue',label:'已逾期'},{value:'today',label:'今天'},{value:'upcoming7',label:'未来 7 天'}]} />
      <Select aria-label="服务类型" value={serviceKind} onChange={(value)=>{setServiceKind(value);setServicePage(1);}} options={[{value:'',label:'全部类型'},...serviceKindOptions]} />
    </div>
    {servicePolicyId ? <div className="service-filter-note"><Text>正在查看保单 #{servicePolicyId} 的服务记录</Text><Button size="small" onClick={clearPolicyFilter}>清除筛选</Button></div> : null}
    <Table rowKey="id" columns={columns} dataSource={serviceData.items} loading={Boolean(apiLoading['service-items:load'])}
      scroll={{x:720}} pagination={{current:servicePage,pageSize:15,total:serviceData.total,showSizeChanger:false,showTotal:(total)=>`共 ${total} 项`,onChange:setServicePage}}
      locale={{emptyText:<Empty description="当前筛选下没有服务事项，可从客户保单卡片发起" />}} />
  </Card>;
}
