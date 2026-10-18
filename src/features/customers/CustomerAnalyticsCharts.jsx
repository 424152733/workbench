import { useState } from 'react';
import { Card, Empty, Typography } from 'antd';

const { Text, Title } = Typography;

const STAGE_COLORS = {
  '新线索': '#4d9b7c',
  '已联系': '#5b8db8',
  '需求了解中': '#c6914f',
  '已成交': '#8173a8',
  '已有客户': '#66a49b',
  '暂缓跟进': '#9a9f98',
};

function StageDistributionChart({ distribution }) {
  const [activeStage, setActiveStage] = useState(null);
  const radius = 37;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  const total = Number(distribution.total || 0);
  const activeItem = distribution.items.find((item) => item.stage === activeStage);

  return <Card className="panel-card customer-analytics-stage-chart" title={<div>
    <Title level={4}>当前阶段分布</Title>
    <Text className="muted">{total.toLocaleString('zh-CN')} 位客户 · 按当前档案阶段</Text>
  </div>}>
    <div className="customer-stage-chart-content">
      <div className="customer-stage-donut-wrap">
        <svg className="customer-stage-donut" viewBox="0 0 100 100" role="group" aria-label={`当前阶段共${total}位客户`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--customer-chart-track)" strokeWidth="12" />
          {total > 0 ? distribution.items.map((item) => {
            const value = Number(item.count || 0);
            const length = (value / total) * circumference;
            const offset = consumed;
            consumed += length;
            if (!value) return null;
            const isActive = activeStage === item.stage;
            return <circle key={item.stage} className={`customer-stage-donut-segment${isActive ? ' is-active' : ''}`}
              cx="50" cy="50" r={radius} fill="none" stroke={STAGE_COLORS[item.stage] || '#8a9690'}
              strokeWidth={isActive ? 16 : 12} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset}
              transform="rotate(-90 50 50)" role="img" tabIndex={0}
              aria-label={`${item.stage}，${value}位，占${Number(item.percent || 0).toFixed(1)}%`}
              onMouseEnter={() => setActiveStage(item.stage)} onMouseLeave={() => setActiveStage(null)}
              onFocus={() => setActiveStage(item.stage)} onBlur={() => setActiveStage(null)}>
              <title>{`${item.stage}：${value}位（${Number(item.percent || 0).toFixed(1)}%）`}</title>
            </circle>;
          }) : null}
        </svg>
        <div className={`customer-stage-donut-center${activeItem ? ' is-active' : ''}`} aria-live="polite">
          {activeItem ? <><strong>{Number(activeItem.count || 0).toLocaleString('zh-CN')}</strong><span>{activeItem.stage} · {Number(activeItem.percent || 0).toFixed(1)}%</span></> :
            <><strong>{total.toLocaleString('zh-CN')}</strong><span>位客户</span></>}
        </div>
      </div>
      <div className="customer-stage-legend" onMouseLeave={() => setActiveStage(null)}>
        {distribution.items.map((item) => <div className={`customer-stage-legend-row${activeStage === item.stage ? ' is-active' : ''}`} key={item.stage}
          onMouseEnter={() => setActiveStage(item.stage)}>
          <span className="customer-stage-legend-dot" style={{ backgroundColor: STAGE_COLORS[item.stage] || '#8a9690' }} />
          <Text>{item.stage}</Text>
          <strong>{Number(item.count || 0).toLocaleString('zh-CN')}</strong>
          <span>{Number(item.percent || 0).toFixed(1)}%</span>
        </div>)}
      </div>
    </div>
  </Card>;
}

function SourceConversionChart({ conversion }) {
  const samples = conversion.bySource.filter((item) => item.eligibleLeads > 0);
  return <Card className="panel-card customer-source-conversion-chart" title={<div>
    <Title level={4}>各来源转化率对比</Title>
    <Text className="muted">仅比较可完整观察样本，横轴为百分比</Text>
  </div>}>
    {samples.length ? <div className="customer-source-chart-rows">
      {samples.map((item) => <div className="customer-source-chart-row" key={item.code}>
        <div className="customer-source-chart-heading">
          <Text strong>{item.label}</Text>
          <Text className="muted">完整样本 {item.eligibleLeads} 位</Text>
        </div>
        {[
          { key: 'convertedRate', label: '转客户率', className: 'is-converted' },
          { key: 'dealRate', label: '成交率', className: 'is-deal' },
        ].map((metric) => {
          const value = item[metric.key];
          return <div className="customer-source-rate-row" key={metric.key}>
            <span>{metric.label}</span>
            <div className="customer-source-rate-track" aria-label={`${item.label}${metric.label}${value == null ? '暂无数据' : `${value}%`}`}>
              <i className={metric.className} style={{ width: `${Math.max(0, Math.min(100, Number(value || 0)))}%` }} />
            </div>
            <strong>{value == null ? '—' : `${Number(value).toFixed(1)}%`}</strong>
          </div>;
        })}
      </div>)}
    </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="暂无可比较的完整样本；线索满 90 天且获客资料核对后会显示在这里。" />}
  </Card>;
}

export function CustomerAnalyticsCharts({ stageDistribution, conversion }) {
  return <div className="customer-analytics-chart-grid">
    <StageDistributionChart distribution={stageDistribution} />
    <SourceConversionChart conversion={conversion} />
  </div>;
}
