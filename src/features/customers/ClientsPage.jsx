import { Typography, Button, Card, Col, Empty, Input, Row, Select, Spin, Space, Table, Tabs, Tag } from 'antd';
import { ArrowRightOutlined, CalendarOutlined, DownloadOutlined, FileTextOutlined, PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { PanelHeading } from '../../components/PanelHeading.jsx';
import { FollowUpTaskActions } from '../../components/FollowUpTaskActions.jsx';
import { CustomerRouteLink } from '../../components/CustomerRouteLink.jsx';
import dayjs from 'dayjs';
import { ServiceItemsPanel } from './ServiceItemsPanel.jsx';
import { FamilyListPanel } from './FamilyListPanel.jsx';
import { CustomerAnalyticsPanel } from './CustomerAnalyticsPanel.jsx';
const { Title, Text } = Typography;

export function ClientsPage(props) {
  const { clients, dashboard, clientView, changeClientView, filteredClients, apiLoading, clientQuery, setClientQuery, sourceFilter, setSourceFilter, sourceOptions, followUpTaskSearch, setFollowUpTaskSearch, setFollowUpTaskPage, followUpTaskFilter, setFollowUpTaskFilter, followUpTaskPageData, followUpTaskPage, topicForm, setTopicModalOpen, channelNames, setClientModalOpen, performApiAction, handleApiError, api, changeStage, openCustomer, openCompleteTaskModal, openRescheduleTaskModal, cancelFollowUpTask, serviceWorkspace,go,showSuccess } = props;
    const clientColumns = [
    { title: '客户', dataIndex: 'name', key: 'name', render: (_, record) => <CustomerRouteLink customerId={record.id} className="customer-link" loading={Boolean(apiLoading[`customer:open:${record.id}`])} onOpen={() => performApiAction(`customer:open:${record.id}`,() => openCustomer(record.id))}>{record.name}<Text className="table-phone">{record.phone}</Text></CustomerRouteLink> },
    { title: '阶段', dataIndex: 'stage', key: 'stage', render: (value,record) => <Select size="small" value={value} loading={Boolean(apiLoading[`customer:stage:${record.id}`])} onChange={(stage) => performApiAction(`customer:stage:${record.id}`,() => changeStage(record,stage))} options={['新线索','已联系','需求了解中','已成交','已有客户','暂缓跟进'].map((stage) => ({value:stage,label:stage}))} className="stage-select" /> },
    { title: '来源', dataIndex: 'source', key: 'source', render: (value) => <span className="source-cell">{value}{value === '小红书' || value === '公众号' || value === '知乎' ? <span className="source-dot online" /> : <span className="source-dot offline" />}</span> },
    { title: '关注问题', dataIndex: 'concern', key: 'concern' },
    { title: '下一次跟进', dataIndex: 'next', key: 'next', render: (value,record) => <span className={record.nextFollowup && record.nextFollowup < dayjs().format('YYYY-MM-DD') ? 'due-overdue' : value.includes('今天') ? 'due-today' : ''}><CalendarOutlined />　{value}</span> },
    { title: '操作', key: 'actions', align: 'right', render: (_, record) => <Button size="small" loading={Boolean(apiLoading[`customer:open:${record.id}`])} onClick={() => performApiAction(`customer:open:${record.id}`,() => openCustomer(record.id))}>查看档案 <ArrowRightOutlined /></Button> },
  ];

  const followUpTaskColumns = [
    {title:'客户',dataIndex:'customerName',key:'customerName',render:(value,record)=><CustomerRouteLink customerId={record.customerId} className="customer-link" loading={Boolean(apiLoading[`customer:open:${record.customerId}`])} onOpen={() => performApiAction(`customer:open:${record.customerId}`,() => openCustomer(record.customerId))}>{value}<Text className="table-phone">{record.contactStatus === '待确认联系偏好' ? '待确认联系偏好' : record.source || ''}</Text></CustomerRouteLink>},
    {title:'跟进目的',dataIndex:'title',key:'title',render:(value,record)=><div><Text strong>{value}</Text>{record.note ? <Text className="task-description">{record.note}</Text> : null}</div>},
    {title:'计划时间',dataIndex:'when',key:'when',render:(value,record)=><Tag color={record.bucket==='overdue'?'red':record.bucket==='today'?'gold':'default'}>{record.status==='completed'?'已完成':value}</Tag>},
    {title:'方式',dataIndex:'method',key:'method'},
    {title:'操作',key:'actions',align:'right',render:(_,record)=><FollowUpTaskActions task={record} status={record.status} cancelLoading={Boolean(apiLoading[`followup-task:cancel:${record.id}`])} onComplete={openCompleteTaskModal} onReschedule={openRescheduleTaskModal} onCancel={cancelFollowUpTask} onOpenCustomer={(task) => performApiAction(`customer:open:${task.customerId}`,() => openCustomer(task.customerId))} />},
  ];
  return (
    <>
      <div className="page-heading mb-[21px] flex items-center justify-between gap-4"><div><Title level={2}>客户与保单</Title><Text className="muted">把每次沟通和服务提醒留在同一份档案里。</Text></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setClientModalOpen(true)}>新增客户 / 线索</Button></div>
      <Row gutter={[14, 14]} className="mb-4">
        <Col xs={12} md={6}><Card className="small-metric"><Text>客户与线索</Text><strong>{clients.length}<span>位</span></strong></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>已逾期待办</Text><strong className="text-danger">{dashboard.metrics.overdueTasks || 0}<span>项</span></strong></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>今天待办</Text><strong>{dashboard.metrics.todayTasks || 0}<span>项</span></strong></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>未来 7 天待办</Text><strong>{dashboard.metrics.upcoming7Tasks || 0}<span>项</span></strong></Card></Col>
      </Row>
      <Tabs className="client-view-tabs" activeKey={clientView} onChange={changeClientView} items={[
        {key:'customers',label:'客户列表'},
        {key:'tasks',label:<span>跟进待办{dashboard.metrics.overdueTasks ? <Tag color="red" className="tab-count-tag">{dashboard.metrics.overdueTasks}</Tag> : null}</span>},
        {key:'services',label:<span>保单服务{dashboard.metrics.overdueServices ? <Tag color="red" className="tab-count-tag">{dashboard.metrics.overdueServices}</Tag> : null}</span>},
        {key:'families',label:'家庭规划'},
        {key:'analysis',label:'客户分析'},
      ]} />
      {clientView === 'customers' ? <>
        <Card className="panel-card customer-table-card" styles={{ body: { padding: 0 } }}>
          <div className="table-toolbar flex items-center justify-between gap-4 px-5 py-[18px]"><div><Title level={4}>客户列表</Title><Text className="muted">线下客户和内容渠道线索都可以独立录入。</Text></div><Space wrap><Input allowClear prefix={<SearchOutlined />} suffix={apiLoading['customers:load'] ? <Spin size="small" /> : null} placeholder="搜索姓名、电话或关注问题" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} className="customer-search" /><Select value={sourceFilter} loading={Boolean(apiLoading['customers:load'])} onChange={setSourceFilter} options={[{ value: '全部来源', label: '全部来源' }, ...sourceOptions.map((value) => ({ value, label: value }))]} className="source-select" /><Button size="small" icon={<DownloadOutlined />} loading={Boolean(apiLoading['customers:export'])} onClick={() => performApiAction('customers:export',api.exportCustomers).catch(handleApiError)}>导出 CSV</Button></Space></div>
          <Table rowKey="id" columns={clientColumns} dataSource={filteredClients} pagination={{ pageSize: 6, showSizeChanger: false, showTotal: (total) => `共 ${total} 位` }} onRow={(record) => ({ onDoubleClick: () => performApiAction(`customer:open:${record.id}`,() => openCustomer(record.id)) })} locale={{ emptyText: <Empty description="没有找到客户" /> }} />
        </Card>
        <Row gutter={[16, 16]} className="mt-4">
          <Col xs={24} xl={12}><Card className="panel-card" title={<PanelHeading title="高频关注问题" subtitle={`匿名汇总 · ${dashboard.concerns.reduce((sum,item) => sum + item.count,0)} 条客户记录`} />}><div className="interest-list">{dashboard.concerns.slice(0,5).map((item,index) => <button key={item.concern} className="interest-button" onClick={() => { topicForm.setFieldsValue({ title:`${item.concern}，先看哪几项？`,category:'误区澄清',insuranceType:'未分类',platforms:channelNames }); setTopicModalOpen(true); }}><span className="interest-rank">{String(index+1).padStart(2,'0')}</span><span>{item.concern}</span><Tag>{item.count} 次</Tag></button>)}</div></Card></Col>
          <Col xs={24} xl={12}><Card className="panel-card" title={<PanelHeading title="服务提醒" subtitle="跟进待办与保单服务" />}><div className="reminder-grid grid grid-cols-3 gap-[10px]"><div><CalendarOutlined /><Text>未来 7 天跟进</Text><strong>{dashboard.metrics.dueFollowUps || 0} 位</strong></div><div><SyncOutlined /><Text>30 天内续保</Text><strong>{dashboard.metrics.renewal30 || 0} 份</strong></div><div><FileTextOutlined /><Text>资料待核实</Text><strong>{dashboard.metrics.unverifiedPolicies || 0} 份</strong></div></div><Text className="small-note">已核实样本 {dashboard.metrics.verifiedPolicies || 0} 份，待核实 {dashboard.metrics.unverifiedPolicies || 0} 份。</Text></Card></Col>
        </Row>
      </> : null}
      {clientView === 'tasks' ? <Card className="panel-card follow-up-task-table" styles={{body:{padding:0}}}>
        <div className="table-toolbar flex items-center justify-between gap-4 px-5 py-[18px]"><div><Title level={4}>跟进待办</Title><Text className="muted">先处理逾期事项；完成后记录结果并安排下一次联系。</Text></div><Space wrap><Input allowClear prefix={<SearchOutlined />} placeholder="搜索客户或待办" value={followUpTaskSearch} onChange={(event) => {setFollowUpTaskSearch(event.target.value);setFollowUpTaskPage(1);}} /><Select value={followUpTaskFilter} onChange={(value) => {setFollowUpTaskFilter(value);setFollowUpTaskPage(1);}} options={[{value:'pending',label:'全部未完成'},{value:'overdue',label:'已逾期'},{value:'today',label:'今天'},{value:'upcoming7',label:'未来 7 天'},{value:'completed',label:'已完成'}]} /></Space></div>
        <Table rowKey="id" columns={followUpTaskColumns} dataSource={followUpTaskPageData.items} loading={Boolean(apiLoading['followup-tasks:load'])} pagination={{current:followUpTaskPage,pageSize:15,total:followUpTaskPageData.total,showSizeChanger:false,showTotal:(total)=>`共 ${total} 项`,onChange:(page)=>setFollowUpTaskPage(page)}} locale={{emptyText:<Empty description={followUpTaskFilter==='completed'?'还没有已完成的跟进记录':'当前筛选下没有待办'} />}} />
      </Card> : null}
      {clientView === 'services' ? <ServiceItemsPanel workspace={serviceWorkspace} apiLoading={apiLoading} /> : null}
      {clientView === 'families' ? <FamilyListPanel api={api} apiLoading={apiLoading} performApiAction={performApiAction} onError={handleApiError} onSuccess={showSuccess} onOpenFamily={(id)=>go('clients',{familyId:id})} clients={clients} /> : null}
      {clientView === 'analysis' ? <CustomerAnalyticsPanel api={api} /> : null}
    </>
  );
}
