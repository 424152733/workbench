import { ArrowRightOutlined } from '@ant-design/icons';

export function XhsPlatformPreview({draft,topicTitle='',brandName='大话保险',tagline='用大白话说清楚',facts=[],disclaimer=''}) {
  const cards = Array.isArray(draft?.cardPlan) ? draft.cardPlan : [];
  const cover = cards.find((item) => item.role === 'cover') || cards[0];
  const contentCard = cards.find((item) => item.role !== 'cover') || cards[1];
  const sourceFacts = (Array.isArray(facts) ? facts : []).filter((fact) => fact.confirmed);
  const secondTitle = contentCard?.headline || sourceFacts[0]?.title || '先记住核心特点';
  const secondBody = contentCard?.keyPoints?.join('；') || sourceFacts[0]?.plainExplanation || draft?.body?.slice(0,48) || '生成后展示图文预览';
  const thirdFact = sourceFacts[1];
  const boundary = sourceFacts.find((fact) => fact.boundary)?.boundary || '具体责任和适用条件以正式合同为准';
  return (
    <div className="cards-preview" aria-label="小红书图文预览">
      <div className="mini-cover">
        <span className="cover-kicker">{brandName}</span>
        <strong>{cover?.headline || draft?.title || topicTitle || '产品解读标题'}</strong>
        <span className="cover-line" />
        <small>{tagline}</small>
        <div className="cover-sun" />
      </div>
      <div className="mini-card">
        <small>{secondTitle}</small>
        <strong>{secondBody}</strong>
        <div className="mini-illustration"><span>📄</span><ArrowRightOutlined /><span>✓</span></div>
        <small>{boundary}</small>
      </div>
      <div className="mini-card muted-mini">
        <small>{thirdFact?.title || '别只看一句话'}</small>
        <strong>{thirdFact?.plainExplanation || '产品责任和适用条件需要结合正式资料核对'}</strong>
        <div className="line-art"><span /><span /><span /></div>
      </div>
      {disclaimer ? <div className="xhs-preview-disclaimer">{disclaimer}</div> : null}
    </div>
  );
}
