import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Col, DatePicker, Divider, Empty, Form, Input, Modal, Row, Select, Space, Spin, Tag, TimePicker, Typography } from 'antd';
import { ArrowRightOutlined, DeleteOutlined, SyncOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { CASE_KIND_NAMES, CONTENT_TYPES } from './content-types.js';
import { hasConfirmedBenefitFacts, recommendProductTopics, topicAngleOptions } from './topic-recommendations.js';
const { Title, Text } = Typography;

export function ContentOverlays({ workspace }) {
  const { contentTypeCode,contentProductPrefill,topicModalOpen, setTopicModalOpen, topicForm, createTopic, apiLoading, performApiAction, channelNames, insuranceTypeOptions, platform, scheduleOpen, setScheduleOpen, scheduleForm, updateSchedule, settings, voiceOpen, setVoiceOpen, voiceForm, updateVoice, confirmDeleteVoice, imageStylesOpen, setImageStylesOpen, imageStylesForm, updateImageStyles, xhsStyleOptions, xhsLayoutOptions, paletteOptions, articleTypeOptions, articleStyleOptions, wechatHtmlThemes, preferencesOpen, setPreferencesOpen, preferencesForm, updatePreferences, calendarOpen, setCalendarOpen, calendarMonth, setCalendarMonth, calendarItems, setCalendarItems, api, handleApiError, topics, chooseTopic, go, notificationsOpen, setNotificationsOpen, notifications, openCustomer, suggestionsOpen, setSuggestionsOpen, suggestions, setSuggestions, suggestionInsuranceType, setSuggestionInsuranceType, suggestionsGenerated, setSuggestionsGenerated, loadSuggestions, createTopicFromSuggestion, publishOpen, setPublishOpen, publishForm, markPublished, assets } = workspace;
  const selectedProductId = Form.useWatch('productId',topicForm);
  const selectedExtractionId = Form.useWatch('extractionId',topicForm);
  const caseSummary = Form.useWatch('caseSummary',topicForm);
  const caseKind = Form.useWatch('caseKind',topicForm);
  const authorizationConfirmed = Form.useWatch('authorizationConfirmed',topicForm);
  const anonymizationConfirmed = Form.useWatch('anonymizationConfirmed',topicForm);
  const [productOptions,setProductOptions] = useState([]);
  const [showUnverifiedProducts,setShowUnverifiedProducts] = useState(false);
  const [extractionOptions,setExtractionOptions] = useState([]);
  const [productsLoading,setProductsLoading] = useState(false);
  const [extractionsLoading,setExtractionsLoading] = useState(false);
  const [topicAngle,setTopicAngle] = useState('coverage');
  const handleApiErrorRef = useRef(handleApiError);
  const extractionRequestRef = useRef(0);
  handleApiErrorRef.current = handleApiError;
  useEffect(() => {
    if (!topicModalOpen) return;
    topicForm.setFieldsValue({category:contentTypeCode === 'product_explainer' ? '产品解读' : contentTypeCode === 'customer_case' ? '客户案例' : '误区澄清',insuranceType:'未分类',platforms:channelNames,caseKind:'scenario',authorizationConfirmed:false,anonymizationConfirmed:false,productId:contentProductPrefill || undefined,extractionId:undefined,caseSummary:undefined,caseNeeds:undefined,caseAnalysis:undefined,caseOutcome:undefined,caseFinancialDetails:undefined});
    setExtractionOptions([]);
  },[topicModalOpen,contentTypeCode,contentProductPrefill,topicForm,channelNames]);
  useEffect(() => {
    if (!topicModalOpen || !['product_explainer','customer_case'].includes(contentTypeCode)) return;
    let live = true;
    setProductsLoading(true);
    api.productCenterProducts().then((items) => { if (live) setProductOptions(items); }).catch((error) => handleApiErrorRef.current(error)).finally(() => { if (live) setProductsLoading(false); });
    return () => { live = false; };
  },[topicModalOpen,contentTypeCode,api]);
  const loadProductExtractions = useCallback(async (productId) => {
    const requestId = ++extractionRequestRef.current;
    setExtractionOptions([]);
    if (!productId) { setExtractionsLoading(false); return; }
    setExtractionsLoading(true);
    try {
      const product = await api.productCenterWorkspace(productId);
      if (requestId === extractionRequestRef.current) setExtractionOptions((product.extractions || []).filter((item) => item.status === '已确认'));
    } catch (error) { if (requestId === extractionRequestRef.current) handleApiErrorRef.current(error); }
    finally { if (requestId === extractionRequestRef.current) setExtractionsLoading(false); }
  },[api]);
  useEffect(() => {
    if (topicModalOpen && ['product_explainer','customer_case'].includes(contentTypeCode)) loadProductExtractions(selectedProductId);
    else { extractionRequestRef.current += 1; setExtractionsLoading(false); }
  },[topicModalOpen,contentTypeCode,selectedProductId,loadProductExtractions]);
  useEffect(() => {
    setTopicAngle(topicAngleOptions(contentTypeCode)[0].value);
  },[contentTypeCode,topicModalOpen]);
  const selectedProduct = productOptions.find((item) => Number(item.id) === Number(selectedProductId));
  const selectableProductOptions = productOptions.filter((item) => showUnverifiedProducts || item.officialSaleStatus==='verified_on_sale' ||
    Number(item.id)===Number(selectedProductId) || Number(item.id)===Number(contentProductPrefill));
  const selectedExtraction = extractionOptions.find((item) => Number(item.id) === Number(selectedExtractionId));
  const productFieldsRequired = contentTypeCode === 'product_explainer' || contentTypeCode === 'customer_case';
  const availableTopicAngles = topicAngleOptions(contentTypeCode,selectedExtraction?.facts);
  const canRecommendCase = contentTypeCode !== 'customer_case' || (String(caseSummary || '').trim() && (caseKind !== 'authorized_real' || (authorizationConfirmed && anonymizationConfirmed)));
  const topicRecommendations = useMemo(() => recommendProductTopics({
    contentTypeCode,angle:topicAngle,productName:selectedProduct?.productName || selectedProduct?.name,
    hasVerifiedExtraction:selectedExtraction?.status === '已确认',hasBenefitFacts:hasConfirmedBenefitFacts(selectedExtraction?.facts),caseSummary,caseKind,
    authorizationConfirmed:Boolean(authorizationConfirmed),anonymizationConfirmed:Boolean(anonymizationConfirmed),
  }),[contentTypeCode,topicAngle,selectedProduct?.productName,selectedProduct?.name,selectedExtraction?.status,selectedExtraction?.facts,caseSummary,caseKind,authorizationConfirmed,anonymizationConfirmed]);
  useEffect(() => {
    if (!availableTopicAngles.some((item) => item.value === topicAngle)) setTopicAngle(availableTopicAngles[0].value);
  },[contentTypeCode,selectedExtractionId,topicAngle]);
  const productSourceFields = productFieldsRequired ? <div className="content-category-fields">
    <Alert showIcon type="info" title={contentTypeCode === 'customer_case' ? '先关联产品和已确认资料版本。产品名称、版本与事实由产品中心提供。' : '产品名称、版本和事实由产品中心提供；选题建议只生成标题模板，不会推算产品结论。'} />
    <Form.Item name="productId" label="关联产品档案" rules={[{required:true,message:'请选择产品'}]}>
      <Select showSearch loading={productsLoading} optionFilterProp="label" options={selectableProductOptions.map((item) => ({value:item.id,label:`${item.company} · ${item.productName}${item.productVersion ? ` · ${item.productVersion}` : ''}${item.officialSaleStatus==='verified_on_sale'?' · 官网已核验在售':' · 手动/待复核'}`}))} onChange={() => topicForm.setFieldValue('extractionId',undefined)} placeholder="优先选择官网已核验在售的产品" />
    </Form.Item>
    <Checkbox checked={showUnverifiedProducts} onChange={(event)=>setShowUnverifiedProducts(event.target.checked)}>显示手动档案和待复核产品</Checkbox>
    {contentProductPrefill && !productsLoading && !productOptions.some((item) => item.id === Number(contentProductPrefill)) ? <Alert type="warning" showIcon title="没有找到对应的产品档案，请返回产品中心检查状态。" /> : null}
    <Form.Item name="extractionId" label="已确认资料版本" rules={[{required:true,message:'请选择已确认的资料版本'}]}>
      <Select loading={extractionsLoading} disabled={!selectedProductId} options={extractionOptions.map((item) => ({value:item.id,label:`${item.documentName || '产品资料'} · 确认于 ${item.confirmedAt ? new Date(item.confirmedAt).toLocaleDateString('zh-CN') : '—'}`}))} placeholder="只显示已确认的资料版本" />
    </Form.Item>
    {selectedProduct && selectedExtraction ? <Text className="small-note">当前来源：{selectedProduct.company} · {selectedProduct.productName}{selectedProduct.productVersion ? ` · ${selectedProduct.productVersion}` : ''} · {selectedExtraction.documentName || '已确认资料'}{selectedProduct.officialSaleStatus==='verified_on_sale'?' · 官网在售状态已核验':' · 官网在售状态待核验'}</Text> : null}
    {!extractionsLoading && selectedProductId && !extractionOptions.length ? <Alert type="warning" showIcon title="该产品还没有已确认的资料版本" description={<Button type="link" onClick={() => go('products')}>前往产品中心核对资料</Button>} /> : null}
    {!productsLoading && !productOptions.length ? <Button type="link" onClick={() => go('products')}>前往产品中心整理资料</Button> : null}
  </div> : null;
  const caseFields = contentTypeCode === 'customer_case' ? <div className="content-category-fields">
    <Form.Item name="caseKind" label="案例性质" rules={[{required:true}]}>
      <Select options={Object.entries(CASE_KIND_NAMES).map(([value,label]) => ({value,label}))} onChange={() => topicForm.setFieldsValue({authorizationConfirmed:false,anonymizationConfirmed:false})} />
    </Form.Item>
    <Alert showIcon type="warning" title="只填写已脱敏摘要，不输入姓名、电话、保单号、证件号或精确地址。" />
    <Form.Item name="caseSummary" label="案例摘要" rules={[{required:true,message:'请填写脱敏后的案例摘要'}]}>
      <Input.TextArea rows={4} maxLength={3000} showCount placeholder="说明已确认的背景与经过，不要补充未经确认的信息。" onChange={() => { if (caseKind === 'authorized_real') topicForm.setFieldsValue({authorizationConfirmed:false,anonymizationConfirmed:false}); }} />
    </Form.Item>
    <Form.Item name="caseNeeds" label="需求要点"><Input.TextArea rows={2} maxLength={1200} showCount /></Form.Item>
    <Form.Item name="caseFinancialDetails" label="保费或利益数据与来源（可选）">
      <Input.TextArea rows={2} maxLength={1200} showCount placeholder="仅填写已核实数值，并注明对应方案、条件、年度和资料来源；没有可靠依据可留空。系统不会自行推算收益率。" />
    </Form.Item>
    <Form.Item name="caseAnalysis" label="分析思路"><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
    <Form.Item name="caseOutcome" label="结果或启示"><Input.TextArea rows={2} maxLength={1200} showCount /></Form.Item>
    <Form.Item noStyle shouldUpdate={(prev,next) => prev.caseKind !== next.caseKind}>{({getFieldValue}) => getFieldValue('caseKind') === 'authorized_real' ? <div className="case-confirmations">
      <Form.Item name="authorizationConfirmed" valuePropName="checked" rules={[{validator:(_,value) => value ? Promise.resolve() : Promise.reject(new Error('真实案例需确认已获得授权'))}]}><Checkbox>已取得该案例的内容使用授权</Checkbox></Form.Item>
      <Form.Item name="anonymizationConfirmed" valuePropName="checked" rules={[{validator:(_,value) => value ? Promise.resolve() : Promise.reject(new Error('真实案例需确认已完成脱敏'))}]}><Checkbox>已检查并移除可识别个人身份的信息</Checkbox></Form.Item>
    </div> : null}</Form.Item>
  </div> : null;
  const recommendationFields = productFieldsRequired ? <section className="topic-recommendations">
    <div className="topic-recommendations-heading"><div><Text strong>按产品推荐选题</Text><Text className="small-note">选择内容角度后自动显示标题模板，点选标题即可填入下方选题。</Text></div></div>
    <Form.Item label="内容角度" className="topic-angle-item"><Select size="small" value={topicAngle} onChange={setTopicAngle} options={availableTopicAngles.map((item) => ({value:item.value,label:item.label}))} /></Form.Item>
    <Text className="small-note">利益演示相关角度仅在已确认资料包含对应事实时提供。</Text>
    {!selectedExtraction ? <Text className="small-note">请选择产品和已确认资料版本后再推荐。</Text> : contentTypeCode === 'customer_case' && !String(caseSummary || '').trim() ? <Text className="small-note">补充脱敏案例摘要后再推荐主题。</Text> : contentTypeCode === 'customer_case' && caseKind === 'authorized_real' && (!authorizationConfirmed || !anonymizationConfirmed) ? <Text className="small-note">真实案例需先确认已获得授权并完成脱敏。</Text> : null}
    {topicRecommendations.length ? <div className="topic-recommendation-list">{topicRecommendations.map((item) => <button type="button" className="topic-recommendation-item" key={item.title} onClick={() => topicForm.setFieldsValue({title:item.title,category:item.category})}><span>{item.title}</span><ArrowRightOutlined /></button>)}</div> : null}
  </section> : null;
  const titleField = <Form.Item name="title" label="选题" rules={[{ required: true, message: '请填写选题' }]}><Input placeholder={contentTypeCode === 'product_explainer' ? '例如：这款产品的保障范围和适用条件' : contentTypeCode === 'customer_case' ? '例如：一个家庭如何梳理医疗保障需求' : '例如：买了保险，为什么还要看免责条款？'} /></Form.Item>;
  return (
    <>
      <Modal className="topic-create-modal" width={620} title={`新建${CONTENT_TYPES.find((item) => item.code === contentTypeCode)?.name || '内容'}选题`} open={topicModalOpen} forceRender onCancel={() => { setTopicModalOpen(false); topicForm.resetFields(); }} onOk={() => topicForm.submit()} confirmLoading={Boolean(apiLoading['topic:create'])} okText="加入选题池" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">按当前分类填写内容。产品解读和客户案例需要关联产品中心的已确认资料版本。</Text>
        <Form form={topicForm} layout="vertical" onFinish={(values) => performApiAction('topic:create',() => createTopic(values))} initialValues={{ category: '误区澄清', insuranceType:'未分类', platforms: channelNames,caseKind:'scenario' }}>
          {contentTypeCode === 'insurance_education' ? <>{titleField}<Form.Item name="category" label="选题标签"><Select options={['保险基础', '误区澄清', '条款翻译', '办事指南'].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="insuranceType" label="险种分类"><Select options={[{value:'未分类',label:'暂不分类'},...insuranceTypeOptions.filter((value) => value !== '不限').map((value) => ({value,label:value}))]} /></Form.Item></> : null}
          {productSourceFields}
          {caseFields}
          {recommendationFields}
          {productFieldsRequired ? titleField : null}
          <Form.Item name="dueDate" label="计划日期（可选）"><DatePicker className="full-width" /></Form.Item>
          <Form.Item name="platforms" label="本次生成平台"><Select mode="multiple" options={channelNames.map((value) => ({ value, label: value }))} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="内容生成计划" open={scheduleOpen} forceRender onCancel={() => setScheduleOpen(false)} onOk={() => scheduleForm.submit()} confirmLoading={Boolean(apiLoading['settings:schedule'])} okText="保存计划" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">启用后，后台按设定频率生成新选题和三平台待审核稿件。实际发布仍由你审核、复制并自行完成。</Text>
        <Form form={scheduleForm} layout="vertical" onFinish={(values) => performApiAction('settings:schedule',() => updateSchedule(values))} initialValues={{autoEnabled:false,frequencyDays:2,runAt:'09:00'}}>
          <Form.Item name="autoEnabled" valuePropName="checked"><Checkbox>开启后台自动生成</Checkbox></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="frequencyDays" label="生成频率"><Select options={[1,2,3,7,14].map((value) => ({value,label:`每 ${value} 天`}))} /></Form.Item></Col><Col span={12}><Form.Item name="runAt" label="运行时间"><Select options={['08:00','09:00','10:00','14:00','18:00'].map((value) => ({value,label:value}))} /></Form.Item></Col></Row>
        </Form>
        <Text className="small-note">后台进程运行期间会检查到期任务。未配置 DeepSeek 密钥时，任务会显示失败或使用明确标记的演示草稿，不会伪装成真实模型输出。</Text>
      </Modal>

      <Modal title={`${CONTENT_TYPES.find((item) => item.code === contentTypeCode)?.name || '内容'}表达设定`} open={voiceOpen} forceRender onCancel={() => setVoiceOpen(false)} onOk={() => voiceForm.submit()} confirmLoading={Boolean(apiLoading['settings:voice'])} okText="保存设定" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        {(contentTypeCode === 'insurance_education' ? settings.content?.voice : settings.content?.categoryVoices?.[contentTypeCode])?.trim() ? <div className="voice-delete-action"><Text className="muted">移除自定义补充后，仍会保留当前分类的默认表达要求。</Text><Button size="small" color="danger" variant="outlined" icon={<DeleteOutlined />} loading={Boolean(apiLoading['settings:voice:delete'])} onClick={confirmDeleteVoice}>删除设定</Button></div> : null}
        <Form form={voiceForm} layout="vertical" onFinish={(values) => performApiAction('settings:voice',() => updateVoice(values))}><Form.Item name="voice" label="自动带入每次生成的补充要求"><Input.TextArea rows={6} maxLength={1000} showCount placeholder="补充该分类的语气、结构或篇幅偏好；分类安全和事实要求仍会自动带入。" /></Form.Item></Form>
      </Modal>

      <Modal title="平台图文生成样式" open={imageStylesOpen} forceRender onCancel={() => setImageStylesOpen(false)} onOk={() => imageStylesForm.submit()} confirmLoading={Boolean(apiLoading['settings:images'])} okText="保存样式" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} width={620}>
        <Text className="modal-intro">设置会保存到工作台，并用于之后生成的新图片。选择“自动推荐”时，DeepSeek 会根据选题和正文规划适合的图片方案，图片由 GPT Image 生成。</Text>
        <Form form={imageStylesForm} layout="vertical" onFinish={(values) => performApiAction('settings:images',() => updateImageStyles(values))}>
          <Title level={5}>小红书图卡</Title>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="xhsImageMode" label="生图模式"><Select options={[{value:'test',label:'测试：生成 1 张'},{value:'production',label:'生产：生成 3–5 张'}]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','style']} label="视觉风格"><Select options={xhsStyleOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','layout']} label="卡片布局"><Select options={xhsLayoutOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','palette']} label="配色"><Select options={paletteOptions} /></Form.Item></Col>
          </Row>
          <Text className="small-note">测试模式固定生成 1 张；生产模式由 DeepSeek 按内容信息量规划 3–5 张卡片，再由 GPT Image 生成图片。</Text>
          <Divider />
          <Title level={5}>公众号正文排版</Title>
          <Form.Item name="wechatTheme" label="公众号 HTML 样式"><Select options={wechatHtmlThemes} /></Form.Item>
          <Text className="small-note">此样式用于复制或下载的公众号排版正文；保存后，后续生成、润色或保存的稿件会采用新样式。</Text>
          <Divider />
          <Title level={5}>公众号 / 知乎文章插图</Title>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name={['article','type']} label="图示类型"><Select options={articleTypeOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['article','style']} label="视觉风格"><Select options={articleStyleOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['article','palette']} label="配色"><Select options={paletteOptions} /></Form.Item></Col>
          </Row>
          <Text className="small-note">文章插图配置也会用于知乎。小红书“布局”是单张卡片的信息结构；文章插图通过图示类型选择结构。</Text>
        </Form>
      </Modal>

      <Modal title="DeepSeek 推荐选题" open={suggestionsOpen} onCancel={() => setSuggestionsOpen(false)} footer={<Button onClick={() => setSuggestionsOpen(false)}>关闭</Button>} destroyOnHidden>
        <Text className="modal-intro">选择险种后生成 5 条候选。换一批会避开当前标题；点击候选项即可加入选题池。</Text>
        <div className="suggestion-controls"><Select aria-label="推荐选题险种" value={suggestionInsuranceType} disabled={Boolean(apiLoading['topics:suggest'])} onChange={(value) => { setSuggestionInsuranceType(value); setSuggestions([]); setSuggestionsGenerated(false); }} options={insuranceTypeOptions.map((value) => ({value,label:value === '不限' ? '不限险种' : value}))} /><Button type="primary" icon={suggestionsGenerated ? <SyncOutlined /> : <ThunderboltOutlined />} loading={Boolean(apiLoading['topics:suggest'])} onClick={() => performApiAction('topics:suggest',() => loadSuggestions({excludeCurrent:suggestionsGenerated}))}>{suggestionsGenerated ? '换一批' : '生成推荐'}</Button></div>
        {suggestions.length ? <div className="suggestion-list">{suggestions.map((item,index) => { const actionKey = `topic:suggestion:${item.title}`; return <button className="suggestion-item" key={`${item.title}-${index}`} disabled={Boolean(apiLoading[actionKey])} onClick={() => performApiAction(actionKey,() => createTopicFromSuggestion(item))}><span className="suggestion-tags"><Tag color="cyan">{item.insuranceType || suggestionInsuranceType}</Tag><Tag>{item.category}</Tag></span><Text strong>{item.title}</Text>{apiLoading[actionKey] ? <Spin size="small" /> : <ArrowRightOutlined />}</button>; })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择险种后，点击生成推荐" />}
      </Modal>

      <Modal title={`新增一条${platform}发布记录`} open={publishOpen} forceRender onCancel={() => setPublishOpen(false)} onOk={() => publishForm.submit()} confirmLoading={Boolean(apiLoading['draft:publish'])} okText="保存发布记录" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">仅记录已经在站外实际发布的内容，不会登录或代发到社交平台。登记时会留存当前稿件和选中的配图。</Text>
        <Form form={publishForm} layout="vertical" onValuesChange={(changed) => { if (!Object.hasOwn(changed,'requestKey')) publishForm.setFieldValue('requestKey',crypto.randomUUID()); }} onFinish={(values) => performApiAction('draft:publish',() => markPublished(values))}>
          <Form.Item name="requestKey" hidden><Input /></Form.Item>
          <Row gutter={12}><Col xs={24} sm={12}><Form.Item name="publishedOn" label="实际发布日期" rules={[{required:true,message:'请选择实际发布日期'}]}><Input type="date" /></Form.Item></Col><Col xs={24} sm={12}><Form.Item name="publishedTime" label="实际时间（可选）"><Input type="time" /></Form.Item></Col></Row>
          <Form.Item name="publishUrl" label="发布链接（可后补）" rules={[{type:'url',message:'请填写 http:// 或 https:// 链接'}]}><Input type="url" placeholder="https://..." /></Form.Item>
          <Form.Item name="note" label="备注（可选）"><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
          {assets.length ? <Form.Item name="assetIds" label="本次使用的配图（默认全选，请按实际发布核对）"><Checkbox.Group options={assets.map((asset,index) => ({value:asset.id,label:asset.fileName || `配图 ${index+1}`}))} /></Form.Item> : null}
        </Form>
      </Modal>
    </>
  );
}
