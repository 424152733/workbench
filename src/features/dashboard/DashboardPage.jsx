import { useState } from 'react';
import { Typography, Button, Card, Col, Divider, Empty, Row, Select, Space, Spin, Statistic, Tag } from 'antd';
import { ArrowRightOutlined, CalendarOutlined, FileTextOutlined, TeamOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { PanelHeading } from '../../components/PanelHeading.jsx';
import { FollowUpTaskActions } from '../../components/FollowUpTaskActions.jsx';
import { localMonth } from '../../utils/date.js';
const { Title, Text } = Typography;

export function DashboardPage(props) {
  const { dashboard, topics, settings, go, dashboardMonth, apiLoading, setDashboardMonth, chooseTopic, selectedTopic, performApiAction, openCustomer, openCompleteTaskModal, openRescheduleTaskModal, clients, openServiceFromDashboard, openPolicyReminder } = props;
  const [activeSource, setActiveSource] = useState(null);
  const metrics = dashboard.metrics || {};
  const sourceTotal = dashboard.sources.reduce((sum, item) => sum + item.count, 0);
  const sourceColors = ['#39866d', '#6087ad', '#d19a4e', '#bd7569', '#8a75a8', '#4e9ca2', '#aa8a63', '#7c9b65'];
  const sourceSlices = dashboard.sources.filter((item) => item.count > 0).map((item, index) => ({
    ...item,
    color: sourceColors[index % sourceColors.length],
  }));
  const activeSourceItem = sourceSlices.find((item) => item.name === activeSource);
  let consumedSourceLength = 0;
  const sourceCircumference = 2 * Math.PI * 39;
  const monthOptions = Array.from({ length: 6 }, (_, index) => {
    const value = new Date();
    value.setMonth(value.getMonth() - index);
    return { value: localMonth(value), label: value.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) };
  });
  const taskItems = dashboard.tasks;
    return <div className="dashboard-page">
      <div className="welcome-banner">
        <div><Text className="eyebrow">{new Date().toLocaleDateString('zh-CN',{weekday:'long',month:'long',day:'numeric'})}</Text><Title level={2}>早上好，{settings.preferences?.displayName || '保险顾问'}，今天先把重要的事处理好。</Title><Text className="muted">{metrics.dueFollowUps || 0} 位客户有近期跟进，{metrics.overdueTasks || 0} 项联系待办、{metrics.overdueServices || 0} 项保单服务已逾期，{metrics.pendingContent || 0} 篇内容待审核。</Text></div>
        <div className="banner-art"><div className="sun" /><div className="leaf leaf-a" /><div className="leaf leaf-b" /><div className="banner-line" /></div>
      </div>
      <Row gutter={[16,16]} className="mb-[15px]">
        <Col xs={12} xl={6}><Card className="metric-card"><Statistic title="待跟进客户" value={metrics.dueFollowUps || 0} suffix={<span className="stat-suffix">位</span>} prefix={<span className="metric-icon green"><TeamOutlined /></span>} /><Text className="metric-hint">逾期 {metrics.overdueTasks || 0} 项 · 今天 {metrics.todayTasks || 0} 项</Text></Card></Col>
        <Col xs={12} xl={6}><Card className="metric-card"><Statistic title="未来 30 天续保" value={metrics.renewal30 || 0} suffix={<span className="stat-suffix">份</span>} prefix={<span className="metric-icon amber"><CalendarOutlined /></span>} /><Text className="metric-hint">资料待核实 {metrics.unverifiedPolicies || 0} 份</Text></Card></Col>
        <Col xs={12} xl={6}><Card className="metric-card"><Statistic title="待审核内容" value={metrics.pendingContent || 0} suffix={<span className="stat-suffix">篇</span>} prefix={<span className="metric-icon rose"><FileTextOutlined /></span>} /><Text className="metric-hint">各平台版本分别审核</Text></Card></Col>
        <Col xs={12} xl={6}><Card className="metric-card"><Statistic title={`${dashboardMonth.slice(5)} 月新增线索`} value={metrics.addedThisMonth || 0} suffix={<span className="stat-suffix">位</span>} prefix={<span className="metric-icon blue"><ThunderboltOutlined /></span>} /><Text className="metric-hint">共 {dashboard.sources.length} 种来源</Text></Card></Col>
      </Row>
      <div className="dashboard-content-masonry">
        <div className="dashboard-column dashboard-column-left">
          <Card className="panel-card" title={<PanelHeading title="客户跟进待办" subtitle="逾期优先；完成后可记录结果并安排下次联系" />} extra={<Button size="small" onClick={() => go('clients',{view:'tasks'})}>查看全部 <ArrowRightOutlined /></Button>}>
            <div className="grid gap-[15px]">{[
              {key:'overdue',title:'已逾期',items:taskItems.filter((item) => item.bucket==='overdue')},
              {key:'today',title:'今天',items:taskItems.filter((item) => item.bucket==='today')},
              {key:'upcoming',title:'未来 7 天',items:taskItems.filter((item) => item.bucket==='upcoming')},
            ].map((group) => <section className="follow-up-group" key={group.key}><div className="follow-up-group-heading"><Text strong>{group.title}</Text><Tag>{group.key==='overdue' ? metrics.overdueTasks || 0 : group.key==='today' ? metrics.todayTasks || 0 : metrics.upcoming7Tasks || 0}</Tag></div>{group.items.slice(0,4).map((item) => <div className="follow-up-task-row" key={item.id}><div className="follow-up-task-copy"><div><Button size="small" className="follow-up-customer" onClick={() => performApiAction(`customer:open:${item.customerId}`,() => openCustomer(item.customerId))}>{item.name}</Button><Tag color={group.key==='overdue'?'red':group.key==='today'?'gold':'default'}>{item.next}</Tag></div><Text strong>{item.title}</Text>{item.note ? <Text className="task-description">{item.note}</Text> : null}</div><FollowUpTaskActions task={item} onComplete={openCompleteTaskModal} onReschedule={openRescheduleTaskModal} /></div>)}{!group.items.length ? <Text className="muted follow-up-empty">暂无</Text> : null}</section>)}</div>
          </Card>
          <Card className="panel-card source-performance" title={<PanelHeading title="客户来源" subtitle={`${dashboardMonth} 新增线索 · ${sourceTotal} 位`} />} extra={<Select aria-label="统计月份" value={dashboardMonth} onChange={setDashboardMonth} loading={Boolean(apiLoading['dashboard:month'])} options={monthOptions} size="small" style={{width:130}} />}>
            {sourceSlices.length ? <div className="source-chart-layout flex min-h-0 flex-col items-center gap-[18px]">
              <div className="source-donut">
                <svg className="source-donut-svg" viewBox="0 0 100 100" role="group" aria-label={`客户来源饼图，共 ${sourceTotal} 位线索`}>
                  <circle className="source-donut-track" cx="50" cy="50" r="39" fill="none" strokeWidth="12" />
                  {sourceSlices.map((item) => {
                    const length = (item.count / sourceTotal) * sourceCircumference;
                    const offset = consumedSourceLength;
                    consumedSourceLength += length;
                    const isActive = activeSource === item.name;
                    return <circle key={item.name} className={`source-donut-segment${isActive ? ' is-active' : ''}`}
                      cx="50" cy="50" r="39" fill="none" stroke={item.color} strokeWidth={isActive ? 16 : 12}
                      strokeDasharray={`${length} ${sourceCircumference - length}`} strokeDashoffset={-offset}
                      transform="rotate(-90 50 50)" role="img" tabIndex={0}
                      aria-label={`${item.name}，${item.count}位，占${Math.round(item.count * 100 / sourceTotal)}%`}
                      onMouseEnter={() => setActiveSource(item.name)} onMouseLeave={() => setActiveSource(null)}
                      onFocus={() => setActiveSource(item.name)} onBlur={() => setActiveSource(null)}>
                      <title>{`${item.name}：${item.count}位（${Math.round(item.count * 100 / sourceTotal)}%）`}</title>
                    </circle>;
                  })}
                </svg>
                <div className={`source-donut-center${activeSourceItem ? ' is-active' : ''}`} aria-live="polite">
                  {activeSourceItem ? <><strong>{activeSourceItem.count}</strong><span>{activeSourceItem.name} · {Math.round(activeSourceItem.count * 100 / sourceTotal)}%</span></> :
                    <><strong>{sourceTotal}</strong><span>位线索</span></>}
                </div>
              </div>
              <div className="source-legend" onMouseLeave={() => setActiveSource(null)}>{sourceSlices.map((item) => <div className={`source-legend-row${activeSource === item.name ? ' is-active' : ''}`} key={item.name}
                style={{'--slice-color':item.color}} onMouseEnter={() => setActiveSource(item.name)}>
                <span className="source-legend-name"><i />{item.name}</span><span>{item.count} 位</span><span className="source-legend-percent">{Math.round(item.count * 100 / sourceTotal)}%</span>
              </div>)}</div>
            </div> : <Empty description="该月份暂无线索" />}
            <Text className="small-note">统计仅包含线索；直接建档的已有客户单独保留。</Text>
          </Card>
        </div>
        <div className="dashboard-column dashboard-column-right">
          <Card className="panel-card service-dashboard-card" title={<PanelHeading title="保单服务" subtitle={`今天 ${metrics.todayServices || 0} 项 · 已逾期 ${metrics.overdueServices || 0} 项`} />} extra={<Button size="small" onClick={()=>go('clients',{view:'services'})}>查看全部 <ArrowRightOutlined /></Button>}>
            {(dashboard.serviceItems || []).slice(0,4).map((item)=><div className="service-dashboard-row" key={item.id}><div><Tag color={item.bucket==='overdue'?'red':item.bucket==='today'?'gold':'default'}>{item.bucket==='overdue'?'已逾期':item.bucket==='today'?'今天':item.nextActionDate}</Tag><Text strong>{item.title}</Text><Text className="schedule-meta">{item.customerName} · {item.policyName}</Text></div><Button size="small" loading={Boolean(apiLoading[`service-item:open:${item.id}`])} onClick={()=>openServiceFromDashboard(item.id)}>处理</Button></div>)}
            {!(dashboard.serviceItems || []).length ? <Empty description="目前没有待处理的保单服务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
            {(dashboard.policyReminders || []).length ? <><Divider /><Text strong>可发起的保单提醒</Text>{dashboard.policyReminders.slice(0,3).map((item)=><div className="service-dashboard-row" key={item.policyId}><div><Text strong>{item.customerName} · {item.policyName}</Text><Text className="schedule-meta">{[item.renewalDue ? `到期 ${item.expiryDate}` : '',item.paymentDue ? `缴费 ${item.nextPaymentDate}` : '',!item.verified ? '资料待核实' : ''].filter(Boolean).join(' · ')}</Text></div><Space size={4}>{item.renewalDue ? <Button size="small" loading={Boolean(apiLoading[`policy:reminder:${item.policyId}`])} onClick={()=>openPolicyReminder(item,'renewal')}>续保</Button> : null}{item.paymentDue ? <Button size="small" loading={Boolean(apiLoading[`policy:reminder:${item.policyId}`])} onClick={()=>openPolicyReminder(item,'payment')}>缴费</Button> : null}</Space></div>)}</> : null}
          </Card>
          <Card className="panel-card content-today" title={<PanelHeading title="内容排期" subtitle="大话保险 · 按选题日期排列" />} extra={<Button size="small" onClick={() => go('content')}>进入内容池 <ArrowRightOutlined /></Button>}>
            {topics.slice(0,2).map((item,index) => <button className={`schedule-card schedule-card-button ${index ? 'muted-schedule' : ''}`} key={item.id} disabled={Boolean(apiLoading['draft:save']) && selectedTopic?.id !== item.id} onClick={() => { chooseTopic(item); go('content'); }}><div className="schedule-date"><strong>{item.dueDate?.slice(-2) || '—'}</strong><span>{item.due || '待排期'}</span></div><div><Tag color={item.status === '待审核' ? 'gold' : 'default'}>{item.status}</Tag><Text strong>{item.title}</Text><Text className="schedule-meta">{item.platforms.join(' · ')}</Text></div>{apiLoading['draft:save'] && selectedTopic?.id !== item.id ? <Spin size="small" /> : <ArrowRightOutlined />}</button>)}
            {!topics.length ? <Empty description="选题池还没有内容" /> : null}<Divider /><div className="readable-reminder"><span className="reminder-bulb">✳</span><div><Text strong>写给普通人看</Text><Text className="schedule-meta">大白话、少术语，关键限制讲清楚。</Text></div></div>
          </Card>
          <Card className="panel-card" title={<PanelHeading title="待核实保单" subtitle="核实后纳入保障汇总和服务提醒" />}>
            <div className="mini-policy-list" role="list">{clients.flatMap((client) => client.policies.filter((policy) => policy.state === '待核实').map((policy) => ({ ...policy,customerId:client.id,owner:client.name }))).slice(0,3).map((item) => <button className="mini-policy-row mini-policy-button" role="listitem" key={`${item.customerId}-${item.id}`} disabled={Boolean(apiLoading[`customer:open:${item.customerId}`])} onClick={() => performApiAction(`customer:open:${item.customerId}`,() => openCustomer(item.customerId))}><div className="mini-policy-main"><span className="policy-mini-icon"><FileTextOutlined /></span><div className="mini-policy-copy"><Text strong>{item.name}</Text><Text className="schedule-meta">{item.owner} · {item.company}</Text></div></div>{apiLoading[`customer:open:${item.customerId}`] ? <Spin size="small" /> : <Tag color="orange">待核实</Tag>}</button>)}</div>
            {!clients.some((client) => client.policies.some((policy) => policy.state === '待核实')) ? <Empty description="暂无待核实保单" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
          </Card>
        </div>
      </div>
    </div>;
}
