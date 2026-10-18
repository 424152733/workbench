import { Alert, Button, Checkbox, Col, DatePicker, Divider, Empty, Form, Input, Modal, Row, Select, Space, Spin, Tag, TimePicker, Typography } from 'antd';
import { ArrowRightOutlined, DeleteOutlined, SyncOutlined, ThunderboltOutlined } from '@ant-design/icons';
const { Title, Text } = Typography;

export function ContentOverlays({ workspace }) {
  const { topicModalOpen, setTopicModalOpen, topicForm, createTopic, apiLoading, performApiAction, channelNames, insuranceTypeOptions, platform, scheduleOpen, setScheduleOpen, scheduleForm, updateSchedule, settings, voiceOpen, setVoiceOpen, voiceForm, updateVoice, confirmDeleteVoice, imageStylesOpen, setImageStylesOpen, imageStylesForm, updateImageStyles, xhsStyleOptions, xhsLayoutOptions, paletteOptions, articleTypeOptions, articleStyleOptions, wechatHtmlThemes, preferencesOpen, setPreferencesOpen, preferencesForm, updatePreferences, calendarOpen, setCalendarOpen, calendarMonth, setCalendarMonth, calendarItems, setCalendarItems, api, handleApiError, topics, chooseTopic, go, notificationsOpen, setNotificationsOpen, notifications, openCustomer, suggestionsOpen, setSuggestionsOpen, suggestions, setSuggestions, suggestionInsuranceType, setSuggestionInsuranceType, suggestionsGenerated, setSuggestionsGenerated, loadSuggestions, createTopicFromSuggestion, publishOpen, setPublishOpen, publishForm, markPublished, assets } = workspace;
  return (
    <>
      <Modal title="添加“大话保险”选题" open={topicModalOpen} forceRender onCancel={() => { setTopicModalOpen(false); topicForm.resetFields(); }} onOk={() => topicForm.submit()} confirmLoading={Boolean(apiLoading['topic:create'])} okText="加入选题池" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">可以自己输入，也可以在内容页让 GPT 根据栏目和历史选题推荐。</Text>
        <Form form={topicForm} layout="vertical" onFinish={(values) => performApiAction('topic:create',() => createTopic(values))} initialValues={{ category: '误区澄清', insuranceType:'未分类', platforms: channelNames }}>
          <Form.Item name="title" label="选题" rules={[{ required: true, message: '请填写选题' }]}><Input placeholder="例如：买了保险，为什么还要看免责条款？" /></Form.Item>
          <Form.Item name="category" label="栏目"><Select options={['保险基础', '误区澄清', '条款翻译', '办事指南'].map((value) => ({ value, label: value }))} /></Form.Item>
          <Form.Item name="insuranceType" label="险种分类"><Select options={[{value:'未分类',label:'暂不分类'},...insuranceTypeOptions.filter((value) => value !== '不限').map((value) => ({value,label:value}))]} /></Form.Item>
          <Form.Item name="dueDate" label="计划发布日期（可选）"><DatePicker className="full-width" /></Form.Item>
          <Form.Item name="platforms" label="本次生成平台"><Select mode="multiple" options={channelNames.map((value) => ({ value, label: value }))} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="内容生成计划" open={scheduleOpen} forceRender onCancel={() => setScheduleOpen(false)} onOk={() => scheduleForm.submit()} confirmLoading={Boolean(apiLoading['settings:schedule'])} okText="保存计划" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        <Text className="modal-intro">启用后，后台按设定频率生成新选题和三平台待审核稿件。实际发布仍由你审核、复制并自行完成。</Text>
        <Form form={scheduleForm} layout="vertical" onFinish={(values) => performApiAction('settings:schedule',() => updateSchedule(values))} initialValues={{autoEnabled:false,frequencyDays:2,runAt:'09:00'}}>
          <Form.Item name="autoEnabled" valuePropName="checked"><Checkbox>开启后台自动生成</Checkbox></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item name="frequencyDays" label="生成频率"><Select options={[1,2,3,7,14].map((value) => ({value,label:`每 ${value} 天`}))} /></Form.Item></Col><Col span={12}><Form.Item name="runAt" label="运行时间"><Select options={['08:00','09:00','10:00','14:00','18:00'].map((value) => ({value,label:value}))} /></Form.Item></Col></Row>
        </Form>
        <Text className="small-note">后台进程运行期间会检查到期任务。无 GPT 密钥时，任务会显示失败或使用明确标记的演示草稿，不会伪装成真实 GPT 输出。</Text>
      </Modal>

      <Modal title="大话保险表达设定" open={voiceOpen} forceRender onCancel={() => setVoiceOpen(false)} onOk={() => voiceForm.submit()} confirmLoading={Boolean(apiLoading['settings:voice'])} okText="保存设定" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}}>
        {settings.content?.voice?.trim() ? <div className="voice-delete-action"><Text className="muted">移除自定义规则后，仍会保留栏目默认表达要求。</Text><Button size="small" color="danger" variant="outlined" icon={<DeleteOutlined />} loading={Boolean(apiLoading['settings:voice:delete'])} onClick={confirmDeleteVoice}>删除设定</Button></div> : null}
        <Form form={voiceForm} layout="vertical" onFinish={(values) => performApiAction('settings:voice',() => updateVoice(values))}><Form.Item name="voice" label="每次生成都附带的写作要求" rules={[{required:true}]}><Input.TextArea rows={7} maxLength={1000} showCount placeholder="用大白话解释术语；先回答读者问题；不编造案例、数字和亲身经历；说明适用边界；引用可核对资料。" /></Form.Item></Form>
      </Modal>

      <Modal title="平台图文生成样式" open={imageStylesOpen} forceRender onCancel={() => setImageStylesOpen(false)} onOk={() => imageStylesForm.submit()} confirmLoading={Boolean(apiLoading['settings:images'])} okText="保存样式" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} width={620}>
        <Text className="modal-intro">设置会保存到工作台，并用于之后生成的新图片。选择“自动推荐”时，GPT 会根据选题和正文选择适合的方案。</Text>
        <Form form={imageStylesForm} layout="vertical" onFinish={(values) => performApiAction('settings:images',() => updateImageStyles(values))}>
          <Title level={5}>小红书图卡</Title>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="xhsImageMode" label="生图模式"><Select options={[{value:'test',label:'测试：生成 1 张'},{value:'production',label:'生产：生成 3–5 张'}]} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','style']} label="视觉风格"><Select options={xhsStyleOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','layout']} label="卡片布局"><Select options={xhsLayoutOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name={['xhs','palette']} label="配色"><Select options={paletteOptions} /></Form.Item></Col>
          </Row>
          <Text className="small-note">测试模式固定生成 1 张；生产模式由 GPT 按内容信息量规划 3–5 张卡片。</Text>
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

      <Modal title="GPT 推荐选题" open={suggestionsOpen} onCancel={() => setSuggestionsOpen(false)} footer={<Button onClick={() => setSuggestionsOpen(false)}>关闭</Button>} destroyOnHidden>
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
