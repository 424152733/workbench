import { Typography, Alert, Button, Card, Checkbox, Col, Divider, Empty, Form, Input, Modal, Row, Select, Spin, Space, Tabs, Tag, Tooltip, Upload } from 'antd';
import { ArrowRightOutlined, CalendarOutlined, CheckCircleFilled, CheckOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, ExpandOutlined, FileImageOutlined, HeartOutlined, LeftOutlined, PlusOutlined, RightOutlined, SendOutlined, SettingOutlined, SyncOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { PanelHeading } from '../../components/PanelHeading.jsx';
import { ArticlePlatformPreview } from '../../article-preview.jsx';
import { XhsPlatformPreview } from './XhsPlatformPreview.jsx';
import { PublicationHistoryView } from './PublicationHistoryView.jsx';
import { platformsForTopic } from '../../platforms.js';
const { Title, Text } = Typography;

export function ContentPage(props) {
  const { api, contentView, onPublicationsChanged, selectedTopic, drafts, platform, platformStatus, checks, settings, apiLoading, generationBusy, assetBusy, imagePreviewOpen, imagePreviewIndex, articlePreviewOpen, setImagePreviewIndex, setImagePreviewOpen, downloadAsset, removeAsset, downloadAssetsAsZip, switchPlatform, generateDrafts, performApiAction, humanizeDraft, updateDraft, generateCardPlan, updateCardPlan, removeCardPlanItem, addCardPlanItem, updateCheck, copyText, approvePlatform, openImageStyles, setArticlePreviewOpen, generateImage, uploadImage, openPublishForm, topics, dashboard, dashboardMonth, channelNames, openCalendar, setTopicModalOpen, chooseTopic, go, confirmDeleteTopic, openTopicSuggestions, scheduleForm, setScheduleOpen, voiceForm, setVoiceOpen, insuranceTypeOptions, xhsCardRoleOptions } = props;
  const renderTopicEditor = () => {
    if (!selectedTopic) return <Card className="panel-card"><Empty description="先从左侧选题池选择一个主题，或新建选题" /></Card>;
    const topicPlatforms = platformsForTopic(selectedTopic);
    const current = drafts[platform];
    const currentStatus = platformStatus[platform] || '草稿';
    const currentChecks = checks[platform] || current?.checks || [false,false,false];
    const isApproved = currentStatus === '已审核' || currentStatus === '已发布';
    const currentAssets = current?.assets || [];
    const cardPlan = Array.isArray(current?.cardPlan) ? current.cardPlan : [];
    const cardPlanReady = cardPlan.length >= 3 && cardPlan.length <= 5 && cardPlan.every((card) =>
      xhsCardRoleOptions.some((option) => option.value === card.role) && Boolean(card.headline?.trim()) &&
      Array.isArray(card.keyPoints) && card.keyPoints.length >= 1 && card.keyPoints.length <= 4 &&
      card.keyPoints.every((point) => Boolean(String(point).trim()))
    );
    const renderAssetGallery = () => (
      <>
        <div className="image-gallery-hint">点击图片查看大图</div>
        <div className="generated-image-gallery">{currentAssets.map((asset,index) => <figure className="generated-image-item" key={asset.id}><button type="button" className="image-preview-trigger" aria-label={`放大预览${platform}配图 ${index+1}`} onClick={() => { setImagePreviewIndex(index); setImagePreviewOpen(true); }}><img className="content-image-preview" src={api.asset(asset.id)} alt={`${platform}配图 ${index+1}`} /></button><figcaption><span title={asset.fileName || `第 ${index+1} 张`}>{asset.fileName || `第 ${index+1} 张`}</span><Space size={2} className="generated-image-actions"><Tooltip title="下载图片"><Button className="generated-image-icon-button" type="text" variant="text" size="small" shape="circle" aria-label={`下载${platform}配图 ${index+1}`} icon={<DownloadOutlined />} loading={Boolean(apiLoading[`asset:download:${asset.id}`])} onClick={() => downloadAsset(asset)} /></Tooltip><Tooltip title="从当前稿件移除"><Button className="generated-image-icon-button" type="text" size="small" shape="circle" color="danger" variant="text" aria-label={`删除${platform}配图 ${index+1}`} icon={<DeleteOutlined />} loading={Boolean(apiLoading[`asset:delete:${asset.id}`])} onClick={() => removeAsset(asset)} /></Tooltip></Space></figcaption></figure>)}</div>
        <Modal className="image-preview-modal" title={`${platform}配图预览 · ${imagePreviewIndex + 1} / ${currentAssets.length}`} open={imagePreviewOpen && Boolean(currentAssets[imagePreviewIndex])} onCancel={() => setImagePreviewOpen(false)} width="min(96vw, 1180px)" footer={<div className="image-preview-footer"><Button aria-label="上一张" icon={<LeftOutlined />} disabled={currentAssets.length < 2} onClick={() => setImagePreviewIndex((index) => (index - 1 + currentAssets.length) % currentAssets.length)}>上一张</Button><Text className="image-preview-filename">{currentAssets[imagePreviewIndex]?.fileName || `第 ${imagePreviewIndex + 1} 张`}</Text><Space><Button aria-label="下一张" icon={<RightOutlined />} disabled={currentAssets.length < 2} onClick={() => setImagePreviewIndex((index) => (index + 1) % currentAssets.length)}>下一张</Button>{currentAssets[imagePreviewIndex] ? <Button type="primary" icon={<DownloadOutlined />} loading={Boolean(apiLoading[`asset:download:${currentAssets[imagePreviewIndex].id}`])} onClick={() => downloadAsset(currentAssets[imagePreviewIndex])}>下载图片</Button> : null}</Space></div>} destroyOnHidden><div className="image-preview-stage">{currentAssets[imagePreviewIndex] ? <img className="image-preview-full" src={api.asset(currentAssets[imagePreviewIndex].id)} alt={`${platform}配图 ${imagePreviewIndex + 1}`} /> : null}</div></Modal>
      </>
    );
    return (
      <div className="editor-layout">
        <Card className="panel-card editor-main-card">
          <div className="editor-topline"><div><Text className="eyebrow">{selectedTopic.id} · {selectedTopic.category}{selectedTopic.insuranceType && selectedTopic.insuranceType !== '未分类' ? ` · ${selectedTopic.insuranceType}` : ''}</Text><Title level={3}>{selectedTopic.title}</Title></div><Tag color={currentStatus === '已审核' ? 'green' : currentStatus === '已发布' ? 'blue' : 'gold'}>{currentStatus}</Tag></div>
          <Tabs activeKey={platform} onChange={switchPlatform} items={topicPlatforms.map((name) => ({ key: name, disabled:Boolean(apiLoading['draft:save']) && name !== platform, label: <span>{name}{platformStatus[name] === '已审核' ? <CheckCircleFilled className="tab-check" /> : null}</span> }))} />
          {!current ? <><Alert className="demo-alert" type="info" showIcon title="这个选题还没有平台稿件。生成后可编辑、润色、上传素材并逐个平台审核。" /><Button type="primary" loading={generationBusy} onClick={generateDrafts}>生成所选平台草稿</Button></> : <>
            <div className="draft-toolbar"><Space><Tag color={current.provider === 'demo' ? 'gold' : 'green'}><ThunderboltOutlined /> {current.provider === 'demo' ? '演示草稿' : 'GPT 草稿'}</Tag>{current.humanized ? <Tag color="cyan">已做大白话润色</Tag> : <Tag>待润色</Tag>}</Space><Space><Button size="small" icon={<SyncOutlined />} loading={generationBusy} onClick={generateDrafts}>重新生成</Button><Button size="small" icon={<HeartOutlined />} loading={Boolean(apiLoading['draft:humanize'])} onClick={() => performApiAction('draft:humanize',humanizeDraft)}>大白话润色</Button></Space></div>
            {current.provider === 'demo' ? <Alert className="demo-alert" type="warning" showIcon title="当前为演示生成内容；配置 RUNWARE_API_KEY 后将由 GPT 生成。演示稿同样可编辑和走通审核流程。" /> : null}
            <Form layout="vertical" className="draft-form">
              <Form.Item label="标题"><Input value={current.title} onChange={(e) => updateDraft('title',e.target.value)} maxLength={platform === '小红书' ? 20 : undefined} showCount={platform === '小红书'} /></Form.Item>
              {platform === '公众号' ? <Form.Item label="摘要"><Input value={current.summary ?? current.extra ?? ''} onChange={(e) => updateDraft('summary',e.target.value)} maxLength={120} showCount /></Form.Item> : null}
              <Form.Item label={platform === '知乎' ? '回答正文' : '正文'}><Input.TextArea value={current.body} onChange={(e) => updateDraft('body',e.target.value)} autoSize={{ minRows:9,maxRows:18 }} /></Form.Item>
              {platform === '小红书' ? <Form.Item label="话题标签"><Input value={current.hashtags ?? current.extra ?? ''} onChange={(e) => updateDraft('hashtags',e.target.value)} /></Form.Item> : null}
              {platform === '小红书' ? <Form.Item label="图卡规划">
                <div className="xhs-card-plan-editor">
                  <div className="xhs-card-plan-heading">
                    <Text className="muted">配文负责补充说明，图卡负责展开核心信息。</Text>
                    <Space size={6}>
                      {cardPlan.length ? <Tag color={cardPlanReady ? 'green' : 'orange'}>{cardPlan.length} 张{cardPlanReady ? '' : ' · 待补全'}</Tag> : null}
                      <Button size="small" icon={<SyncOutlined />} loading={Boolean(apiLoading['draft:card-plan'])} onClick={() => cardPlan.length ? Modal.confirm({title:'重新生成图卡规划？',content:'现有规划和手动修改将被新规划替换。此操作只调用文本模型，不会生成图片。',okText:'重新生成',cancelText:'取消',cancelButtonProps:{color:'danger',variant:'outlined'},onOk:generateCardPlan}) : generateCardPlan()}>
                        {cardPlan.length ? '重新生成规划' : '生成图卡规划'}
                      </Button>
                    </Space>
                  </div>
                  {!cardPlanReady ? <Alert className="xhs-plan-alert" type={cardPlan.length ? 'warning' : 'info'} showIcon title={cardPlan.length ? '图卡规划还未达到生图要求，请补齐 3–5 张有效卡片。' : '该稿件还没有图卡规划。生成规划会调用文本模型，不会调用生图模型。'} /> : null}
                  {cardPlan.map((card,index) => <Card className="xhs-plan-card" size="small" key={`xhs-card-${index}`}>
                    <div className="xhs-plan-card-heading">
                      <Text strong>卡片 {index + 1}</Text>
                      <Button aria-label={`删除图卡 ${index + 1}`} color="danger" variant="text" icon={<DeleteOutlined />} disabled={cardPlan.length <= 3} onClick={() => removeCardPlanItem(index)} />
                    </div>
                    <div className="xhs-plan-fields">
                      <label>内容角色<Select aria-label={`图卡 ${index + 1}内容角色`} value={card.role} options={xhsCardRoleOptions} onChange={(value) => updateCardPlan(index,'role',value)} /></label>
                      <label>卡片标题<Input aria-label={`图卡 ${index + 1}标题`} value={card.headline} maxLength={60} showCount onChange={(e) => updateCardPlan(index,'headline',e.target.value)} /></label>
                      <label>图上要点<Input.TextArea aria-label={`图卡 ${index + 1}要点`} value={(card.keyPoints || []).join('\n')} rows={3} maxLength={640} placeholder="每行填写一个要点，最多 4 条" onChange={(e) => updateCardPlan(index,'keyPoints',e.target.value.split(/\r?\n/).map((point) => point.trim()).filter(Boolean).slice(0,4))} /></label>
                      <label>画面说明<Input.TextArea aria-label={`图卡 ${index + 1}画面说明`} value={card.visualDirection || ''} rows={2} maxLength={600} placeholder="说明插画、图示或版面重点" onChange={(e) => updateCardPlan(index,'visualDirection',e.target.value)} /></label>
                    </div>
                  </Card>)}
                  {cardPlan.length < 5 ? <Button className="xhs-add-card" icon={<PlusOutlined />} disabled={cardPlan.length >= 5} onClick={addCardPlanItem}>添加图卡</Button> : null}
                  <Text className="xhs-plan-footnote">测试模式只按封面规划生成 1 张图；生产模式按完整规划生成 3–5 张图。</Text>
                </div>
              </Form.Item> : null}
              <Form.Item label="资料来源 / 条款链接"><Input.TextArea value={current.sources || ''} onChange={(e) => updateDraft('sources',e.target.value)} rows={2} placeholder="填写法规、保险公司正式文件或已核实资料链接；没有来源时先标记待补充" /></Form.Item>
            </Form>
            <div className="plain-language-hint"><span className="hint-star">✳</span><span>写给普通人看：术语先解释，责任边界讲清楚，别把“可能”说成“肯定”。</span></div>
            <Divider />
            <div className="review-checks"><Text strong>发布前核对</Text><Checkbox checked={currentChecks[0]} onChange={(e) => updateCheck(0,e.target.checked)}>关键事实有资料来源，未确认信息已标注</Checkbox><Checkbox checked={currentChecks[1]} onChange={(e) => updateCheck(1,e.target.checked)}>术语已解释，免责和适用条件没有省略</Checkbox><Checkbox checked={currentChecks[2]} onChange={(e) => updateCheck(2,e.target.checked)}>图片文字清楚准确，素材来源和署名已核对</Checkbox></div>
        <div className="editor-footer"><Text className="muted">{apiLoading['draft:save'] || apiLoading['draft:checks'] ? <><Spin size="small" />　正在保存所选平台稿件</> : '所选平台的稿件和审核状态分别保存'}</Text><Space wrap><Button size="small" icon={<CopyOutlined />} disabled={!isApproved} onClick={() => copyText(current.title)}>复制标题</Button><Button size="small" icon={<CopyOutlined />} disabled={!isApproved} onClick={() => copyText(current.body)}>复制正文</Button>{platform === '小红书' ? <Button size="small" icon={<CopyOutlined />} disabled={!isApproved} onClick={() => copyText(current.hashtags || '')}>复制标签</Button> : null}{platform === '公众号' ? <><Button size="small" icon={<CopyOutlined />} disabled={!isApproved} onClick={() => copyText(current.summary || '')}>复制摘要</Button><Button size="small" disabled={!isApproved} onClick={() => copyText(current.htmlContent || current.body)}>复制排版正文</Button><Button disabled={!isApproved} onClick={() => { const blob = new Blob([current.htmlContent || current.body],{type:'text/html;charset=utf-8'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download=`${current.title}.html`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }} size="small">下载 HTML</Button></> : null}<Button type="primary" size="small" icon={<CheckOutlined />} loading={Boolean(apiLoading['draft:approve'])} onClick={() => performApiAction('draft:approve',approvePlatform)} disabled={isApproved}>{isApproved ? '已审核' : '审核通过'}</Button></Space></div>
          </>}
        </Card>
        <div className="editor-side-column">
          <Card className="panel-card preview-card" title={<PanelHeading title="图文预览" subtitle={`${platform} · ${currentAssets.length ? `${currentAssets.length} 张素材` : '当前素材'}`} />} extra={<Space size={4} className="preview-actions">
            <Tooltip title="样式设置"><Button type="text" shape="circle" aria-label="样式设置" icon={<SettingOutlined />} onClick={openImageStyles} /></Tooltip>
            {platform !== '小红书' ? <Tooltip title={`展开${platform}阅读预览`}><Button type="text" shape="circle" aria-label={`展开${platform}阅读预览`} icon={<ExpandOutlined />} onClick={() => setArticlePreviewOpen(true)} /></Tooltip> : null}
            <Tooltip title={platform === '小红书' && !cardPlanReady ? '请先准备完整的 3–5 张图卡规划' : current?.body?.trim() ? '调用 baoyu 生成' : '请先生成该平台草稿'}><Button type="text" shape="circle" aria-label="调用 baoyu 生成" icon={<FileImageOutlined />} loading={assetBusy} disabled={!current?.body?.trim() || (platform === '小红书' && !cardPlanReady)} onClick={generateImage} /></Tooltip>
            {currentAssets.length ? <Tooltip title={`打包下载当前${platform}的全部 ${currentAssets.length} 张配图`}><Button type="text" shape="circle" aria-label={`打包下载当前${platform}的全部 ${currentAssets.length} 张配图`} icon={<DownloadOutlined />} loading={Boolean(apiLoading['assets:download-zip'])} onClick={() => downloadAssetsAsZip(currentAssets, `${selectedTopic.id}-${platform}-配图.zip`)} /></Tooltip> : null}
          </Space>}>
            {platform === '小红书'
              ? currentAssets.length ? renderAssetGallery() : <XhsPlatformPreview draft={current} topicTitle={selectedTopic.title} />
              : <>
                <Tabs key={`${selectedTopic.id}:${platform}`} className="article-preview-tabs" defaultActiveKey="article" items={[
                  {key:'article',label:'阅读预览',children:<div className="article-preview-pane"><div className="article-preview-compact"><ArticlePlatformPreview platform={platform} draft={current} topicTitle={selectedTopic.title} compact wechatTheme={settings.content?.wechatTheme || 'clean'} /></div><Button block icon={<ExpandOutlined />} onClick={() => setArticlePreviewOpen(true)}>展开完整阅读预览</Button></div>},
                  ...(currentAssets.length ? [{key:'assets',label:`配图 ${currentAssets.length}`,children:renderAssetGallery()}] : []),
                ]} />
                <Modal className="article-reader-modal" title={`${platform} · 阅读效果预览`} open={articlePreviewOpen} onCancel={() => setArticlePreviewOpen(false)} width="min(96vw, 1040px)" footer={null} destroyOnHidden>
                  <div className={`article-reading-stage ${platform === '公众号' ? 'wechat-reading-stage' : 'zhihu-reading-stage'}`}><ArticlePlatformPreview platform={platform} draft={current} topicTitle={selectedTopic.title} wechatTheme={settings.content?.wechatTheme || 'clean'} /></div>
                </Modal>
              </>}
            <div className="asset-note"><FileImageOutlined /><span>{platform === '小红书' || currentAssets.length ? '图卡需核对文字、图意、素材来源和署名；当前图片保存在本机工作区。' : '正文按富文本样式渲染；实际平台展示可能因设备和平台版本略有差异。'}</span></div>
          </Card>
          <Card className="panel-card workflow-card" title={<PanelHeading title="本篇生产流程" subtitle={`${topicPlatforms.length} 个平台可独立审核`} />}>
            <div className="workflow-list"><div className={`workflow-step ${current ? 'done' : ''}`}><CheckCircleFilled /><span>GPT 生成文案</span><small>{current ? (current.provider === 'demo' ? '演示稿' : '完成') : '待生成'}</small></div><div className={`workflow-step ${current?.humanized ? 'done' : ''}`}><span className="workflow-num">2</span><span>humanizer-zh / 大白话润色</span><small>{current?.humanized ? '完成' : '待处理'}</small></div><div className={`workflow-step ${currentAssets.length ? 'done' : ''}`}><span className="workflow-num">3</span><span>{platform === '小红书' ? 'baoyu 小红书图卡' : 'baoyu 文章插画'}</span><small>{currentAssets.length ? `${currentAssets.length} 张` : '待生成'}</small></div><div className={`workflow-step ${isApproved ? 'done' : ''}`}><span className="workflow-num">4</span><span>人工审核后复制</span><small>{isApproved ? '可复制' : '待审核'}</small></div></div>
            <Divider />
            <div className="asset-actions"><Button block icon={<CopyOutlined />} disabled={!isApproved || !current} onClick={() => copyText(current?.body || '')}>复制当前平台正文</Button><Upload showUploadList={false} accept="image/*" beforeUpload={(file) => { uploadImage(file); return false; }}><Button block icon={<UploadOutlined />} loading={assetBusy}>上传 / 替换图片</Button></Upload>{platformStatus[platform] === '已审核' || platformStatus[platform] === '已发布' ? <Button block type="primary" icon={<SendOutlined />} loading={Boolean(apiLoading['draft:save'])} onClick={openPublishForm}>{platformStatus[platform] === '已发布' ? '新增一条发布记录' : '记录已发布'}</Button> : null}</div>
          </Card>
        </div>
      </div>
    );
  };

  if (contentView === 'publications') return <PublicationHistoryView api={api} go={go} onChanged={onPublicationsChanged} />;

  return (
    <>
      <div className="page-heading mb-[21px] flex items-center justify-between gap-4"><div><Title level={2}>大话保险</Title><Text className="muted">用大家能听懂的话，科普保险，也把常见误区说清楚。</Text></div><Space wrap><Button size="small" color="primary" variant="outlined" onClick={() => go('content',{view:'publications'})}>发布记录</Button><Button size="small" icon={<CalendarOutlined />} loading={Boolean(apiLoading.calendar)} onClick={() => performApiAction('calendar',openCalendar)}>内容日历</Button><Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setTopicModalOpen(true)}>新建选题</Button></Space></div>
      <Row gutter={[14, 14]} className="mb-4">
        <Col xs={12} md={6}><Card className="small-metric"><Text>待审核</Text><strong>{topics.reduce((sum,topic) => sum + channelNames.filter((channel) => topic.drafts?.[channel]?.status === '待审核').length,0)}<span>篇</span></strong></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>本月已发布</Text><Button type="link" className="publication-metric-link" onClick={() => { const [year,month] = dashboardMonth.split('-').map(Number); go('content',{view:'publications',from:`${dashboardMonth}-01`,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)}); }}><strong>{dashboard.metrics.publishedThisMonth || 0}<span>篇</span></strong></Button></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>选题池</Text><strong>{topics.length}<span>个</span></strong></Card></Col>
        <Col xs={12} md={6}><Card className="small-metric"><Text>平台版本</Text><strong>3<span>个平台</span></strong></Card></Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={7}>
          <Card className="panel-card topic-card" title={<PanelHeading title="选题池" subtitle="默认每两天一个主题" />} extra={<Button type="text" icon={<PlusOutlined />} onClick={() => setTopicModalOpen(true)} aria-label="新建选题" />}>
            <div className="topic-list">{topics.map((topic) => {
              const publishedPlatforms = (topic.platforms || []).filter((name) => topic.drafts?.[name]?.publishedAt);
              return <div className="topic-item-shell" key={topic.id}><button disabled={Boolean(apiLoading['draft:save']) && selectedTopic?.id !== topic.id} className={`topic-item ${selectedTopic?.id === topic.id ? 'selected' : ''}`} onClick={() => chooseTopic(topic)}><div className="topic-item-top"><span><Tag>{topic.category}</Tag>{topic.insuranceType && topic.insuranceType !== '未分类' ? <Tag color="cyan">{topic.insuranceType}</Tag> : null}</span><Text className="topic-date">{topic.due}</Text></div><Text strong>{topic.title}</Text>{publishedPlatforms.length ? <div className="topic-publication-status" aria-label={`已发布平台：${publishedPlatforms.join('、')}`}>{publishedPlatforms.map((name) => <Tag key={name} color="green">{name} 已发布</Tag>)}</div> : null}<div className="topic-bottom"><Text className="muted">{topic.id}</Text><span>{topic.platforms.join(' · ')}</span></div>{selectedTopic?.id === topic.id && apiLoading['draft:save'] ? <span className="topic-saving"><Spin size="small" /> 保存中</span> : null}{topic.generationStatus === 'failed' ? <Text type="danger">上次生成失败：{topic.generationError}</Text> : null}</button><Tooltip title="删除选题"><Button className="topic-delete" color="danger" variant="text" icon={<DeleteOutlined />} aria-label={`删除选题：${topic.title}`} loading={Boolean(apiLoading[`topic:delete:${topic.id}`])} onClick={() => confirmDeleteTopic(topic)} /></Tooltip></div>;
            })}</div>
            <Button block className="topic-add" icon={<PlusOutlined />} onClick={() => setTopicModalOpen(true)}>添加新选题</Button>
            <div className="auto-run-note"><SyncOutlined /><span>{settings.content?.autoEnabled && settings.content?.nextRunAt ? `下次生成：${new Date(settings.content.nextRunAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}` : '自动生成已暂停'}</span><Button size="small" onClick={() => { scheduleForm.setFieldsValue(settings.content); setScheduleOpen(true); }}>设置</Button></div>
          </Card>
          <Card className="panel-card voice-card" title={<PanelHeading title="大话保险表达设定" subtitle="自动带入每次生成" />}>
            {settings.content?.voice?.trim() ? settings.content.voice.split(/[；\n]/).filter(Boolean).slice(0,5).map((rule) => <div className="voice-rule" key={rule}><CheckCircleFilled /> {rule}</div>) : <Text className="voice-empty">当前没有自定义表达设定，将使用栏目默认规则。</Text>}
            <Button size="small" icon={<EditOutlined />} onClick={() => { voiceForm.setFieldsValue({voice:settings.content?.voice || ''}); setVoiceOpen(true); }}>编辑设定</Button>
          </Card>
        </Col>
        <Col xs={24} xl={17}>
          <div className="generation-strip"><div className="generation-copy"><Text strong><ThunderboltOutlined /> 从选题生成一组待审核内容</Text><Text className="muted">GPT 写稿，按大白话原则润色，图卡和排版按平台生成。</Text></div><Space wrap className="generation-actions"><Button size="small" className="suggest-topic-button" onClick={openTopicSuggestions}>GPT 推荐选题</Button><Button type="primary" size="small" loading={generationBusy} disabled={!selectedTopic} onClick={generateDrafts}>生成所选平台草稿 <ArrowRightOutlined /></Button></Space></div>
          {renderTopicEditor()}
        </Col>
      </Row>
    </>
  );
}
