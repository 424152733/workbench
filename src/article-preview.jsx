import { RichText } from './richText.js';

export function ArticlePlatformPreview({ platform, draft, topicTitle, compact = false, wechatTheme = 'clean', brandName = '大话保险', brandSubtitle = '保险顾问 · 科普内容', zhihuAuthor = '保险顾问', zhihuSubtitle = '大话保险 · 用白话解释保险', disclaimer = '' }) {
  const title = draft?.title?.trim() || topicTitle || '文章标题';
  const body = draft?.body || '';
  const isWechat = platform === '公众号';

  if (isWechat) {
    return (
      <div className={`platform-article-preview wechat-reading-preview theme-${wechatTheme} ${compact ? 'is-compact' : 'is-full'}`}>
        <div className="article-platform-toolbar"><span className="toolbar-back">‹</span><span>公众号文章</span><span className="toolbar-more">···</span></div>
        <article className="wechat-reading-page">
          <div className="platform-preview-label">公众号 · 阅读预览</div>
          <h1>{title}</h1>
          <div className="wechat-preview-byline">
            <span className="preview-avatar">保</span>
            <span><strong>{brandName}</strong><small>{brandSubtitle}</small></span>
            <span className="preview-meta-muted">预览</span>
          </div>
          {draft?.summary?.trim() ? <p className="wechat-preview-summary">{draft.summary}</p> : null}
          <RichText value={body} className="wechat-article-rich-text" />
          {draft?.sources?.trim() ? <div className="article-source-note"><strong>资料来源</strong><p>{draft.sources}</p></div> : null}
          <div className="article-disclaimer">{disclaimer || '本文仅作一般保险知识说明，具体保障和处理结果以保险合同及保险公司正式文件为准。'}</div>
          <div className="wechat-reader-actions"><span>♡　赞</span><span>☆　收藏</span><span>↗　转发</span></div>
        </article>
        {compact ? <div className="article-preview-fade" aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <div className={`platform-article-preview zhihu-reading-preview ${compact ? 'is-compact' : 'is-full'}`}>
      <div className="zhihu-preview-toolbar"><span className="zhihu-wordmark">知</span><strong>知乎</strong><span>回答预览</span><span className="toolbar-more">···</span></div>
      <article className="zhihu-reading-page">
        <div className="zhihu-topic-label">保险 · 保障与理赔</div>
        <h1>{title}</h1>
        <div className="zhihu-preview-byline">
          <span className="preview-avatar">保</span>
          <span><strong>{zhihuAuthor}</strong><small>{zhihuSubtitle}</small></span>
          <span className="zhihu-follow-label">关注</span>
        </div>
        <RichText value={body} className="zhihu-article-rich-text" />
        {draft?.sources?.trim() ? <div className="article-source-note"><strong>资料来源</strong><p>{draft.sources}</p></div> : null}
        {disclaimer ? <div className="article-disclaimer">{disclaimer}</div> : null}
        <div className="zhihu-reader-actions"><span>↑　赞同</span><span>♡　喜欢</span><span>评论</span><span>↗　分享</span></div>
      </article>
      {compact ? <div className="article-preview-fade" aria-hidden="true" /> : null}
    </div>
  );
}
