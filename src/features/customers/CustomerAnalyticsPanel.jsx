import { useMemo } from 'react';
import { Alert, Button, Card, Col, DatePicker, Empty, Row, Select, Space, Spin, Statistic, Table, Tooltip, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCustomerAnalytics } from './useCustomerAnalytics.js';
import { CustomerAnalyticsCharts } from './CustomerAnalyticsCharts.jsx';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;
const percentText = (value) => value == null ? '—' : `${Number(value).toFixed(1)}%`;
const numberText = (value) => Number(value || 0).toLocaleString('zh-CN');

export function CustomerAnalyticsPanel({ api }) {
  const { range, updateRange, sourceCode, setSourceCode, data, loading, error, reload } = useCustomerAnalytics(api);
  const today = dayjs();
  const conversion = data?.conversion;
  const sourceOptions = data?.sourceOptions || [];
  const sourceColumns = useMemo(() => [
    { title: '获客来源', dataIndex: 'label', key: 'label', fixed: 'left', width: 130 },
    { title: '新线索', dataIndex: 'totalLeads', key: 'totalLeads', align: 'right', width: 90, render: numberText },
    { title: '可完整观察', dataIndex: 'eligibleLeads', key: 'eligibleLeads', align: 'right', width: 110, render: numberText },
    { title: '观察中', dataIndex: 'observingLeads', key: 'observingLeads', align: 'right', width: 90, render: numberText },
    { title: '历史待核对', dataIndex: 'historyToReview', key: 'historyToReview', align: 'right', width: 105, render: numberText },
    { title: '已联系', dataIndex: 'contacted', key: 'contacted', align: 'right', width: 80, render: numberText },
    { title: '需求了解', dataIndex: 'needs', key: 'needs', align: 'right', width: 90, render: numberText },
    { title: '转客户', dataIndex: 'converted', key: 'converted', align: 'right', width: 80, render: numberText },
    { title: '已成交', dataIndex: 'deals', key: 'deals', align: 'right', width: 80, render: numberText },
    { title: <Tooltip title="转客户 = 90 天内进入“已成交”或“已有客户”；分母为资料完整且已满 90 天的新线索。">转客户率</Tooltip>, dataIndex: 'convertedRate', key: 'convertedRate', align: 'right', width: 100, render: percentText },
    { title: <Tooltip title="成交 = 90 天内进入“已成交”；分母为资料完整且已满 90 天的新线索。">成交率</Tooltip>, dataIndex: 'dealRate', key: 'dealRate', align: 'right', width: 90, render: percentText },
  ], []);

  return <div className="customer-analytics-page">
    <Card className="panel-card customer-analytics-filters">
      <div className="customer-analytics-heading">
        <div>
          <Title level={4}>客户阶段与来源转化</Title>
          <Text className="muted">按建档日期查看当前阶段，并比较不同获客来源的 90 天转化。</Text>
        </div>
        <Space wrap>
          <RangePicker value={range} onChange={updateRange} format="YYYY-MM-DD" allowClear={false}
            disabledDate={(date) => date && date.isAfter(today, 'day')} />
          <Select className="customer-analytics-source" value={sourceCode} onChange={setSourceCode}
            options={[{ value: '', label: '全部获客来源' }, ...sourceOptions.map((item) => ({ value: item.code, label: item.label }))]} />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>
        </Space>
      </div>
    </Card>

    {error ? <Alert className="customer-analytics-alert" type="error" showIcon message={data ? '统计刷新失败，下面保留上次成功结果' : '客户分析暂时无法加载'} description={error}
      action={<Button size="small" onClick={reload}>重试</Button>} /> : null}
    {loading && !data ? <Card className="panel-card customer-analytics-loading"><Spin /></Card> : null}
    {!loading && !error && !data ? <Card className="panel-card"><Empty description="暂无客户分析数据" /></Card> : null}
    {data ? <>
      <Alert className="customer-analytics-alert" type="info" showIcon message="统计口径"
        description="仅统计建档满 90 天、获客资料已确认且保留初始阶段记录的新线索转化。未满 90 天的线索列为观察中；旧档案和缺少初始阶段记录的样本列为历史资料待核对，不进入转化率分母。" />

      <CustomerAnalyticsCharts stageDistribution={data.stageDistribution} conversion={conversion} />

      <Card className="panel-card customer-analytics-conversion" title={<div><Title level={4}>新线索 90 天转化</Title><Text className="muted">按获客来源统计；阶段跳级只记录实际进入过的阶段。</Text></div>}>
        <Row gutter={[12, 12]} className="customer-conversion-metrics">
          <Col xs={12} md={6}><Card className="customer-analytics-metric"><Statistic title="新线索" value={conversion.totalLeads} /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-metric"><Statistic title="可完整观察" value={conversion.eligibleLeads} /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-metric"><Statistic title="观察中" value={conversion.observingLeads} /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-metric"><Statistic title="历史待核对" value={conversion.historyToReview} /></Card></Col>
        </Row>
        <Row gutter={[12, 12]} className="customer-conversion-rates">
          <Col xs={12} md={6}><Card className="customer-analytics-rate"><Statistic title={<Tooltip title="进入过“已成交”或“已有客户”的人数 ÷ 可完整观察人数。">转客户率</Tooltip>} value={percentText(conversion.totals.convertedRate)} /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-rate"><Statistic title={<Tooltip title="进入过“已成交”的人数 ÷ 可完整观察人数。">成交率</Tooltip>} value={percentText(conversion.totals.dealRate)} /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-rate"><Statistic title="已联系" value={conversion.totals.contacted} suffix="位" /></Card></Col>
          <Col xs={12} md={6}><Card className="customer-analytics-rate"><Statistic title="需求了解" value={conversion.totals.needs} suffix="位" /></Card></Col>
        </Row>
        {conversion.eligibleLeads === 0 ? <Alert className="customer-analytics-alert" type="warning" showIcon
          message="当前没有可计算转化率的完整样本"
          description={conversion.historyToReview ? '请在客户详情中确认旧档案的获客身份与来源；缺少建档时的初始阶段记录仍不会纳入正式转化率。' : conversion.observingLeads ? '当前新线索尚未满 90 天，待观察窗口结束后再纳入转化率。' : '调整建档日期或来源筛选，查看已完成 90 天观察的新线索。'} /> : null}
        <Table className="customer-analytics-source-table" rowKey="code" size="small" columns={sourceColumns}
          dataSource={conversion.bySource} pagination={false} scroll={{ x: 1020 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前范围没有新线索来源数据" /> }} />
      </Card>
      <Text className="customer-analytics-asof">统计时点：{new Date(data.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 日期按上海时区计算</Text>
    </> : null}
  </div>;
}
