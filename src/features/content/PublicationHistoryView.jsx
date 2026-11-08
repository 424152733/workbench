import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, EditOutlined, LinkOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { PanelHeading } from '../../components/PanelHeading.jsx';
import { CONTENT_TYPES, CASE_KIND_NAMES } from './content-types.js';

const { Title, Text, Paragraph } = Typography;
const platformOptions = ['知乎','小红书','公众号'].map((value) => ({value,label:value}));
const statusOptions = [{value:'active',label:'有效记录'},{value:'all',label:'全部记录'},{value:'voided',label:'已作废'}];
const actionNames = {created:'登记发布',corrected:'更正信息',voided:'作废记录'};
const dateTime = (value) => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
const safeExternalUrl = (value) => { try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } };
const originTag = (origin) => <Tooltip title={origin === 'legacy' ? '发布记录模块上线时，按旧稿件保存的发布日期和链接补入；当时的正文与配图无法追溯。' : '在内容工作台登记实际发布时创建，保存了登记时的稿件和选中配图。'}><Tag>{origin === 'legacy' ? '旧数据导入' : '手动登记'}</Tag></Tooltip>;

function usePublicationHistory(api,onChanged,contentTypeCode) {
  const [filters,setFilters] = useState(() => { const query = new URLSearchParams(window.location.search); return {type:query.get('type') || contentTypeCode || '',platform:'',from:query.get('from') || '',to:query.get('to') || '',keyword:'',status:'active',topicId:query.get('topicId') || '',page:1,pageSize:10}; });
  const [list,setList] = useState({items:[],total:0});
  const [selectedId,setSelectedId] = useState(null);
  const [detail,setDetail] = useState(null);
  const [loading,setLoading] = useState(false);
  const [detailLoading,setDetailLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [detailError,setDetailError] = useState('');
  const [revision,setRevision] = useState(0);
  const change = (patch) => setFilters((old) => ({...old,...patch,page:1}));
  const reload = () => setRevision((old) => old + 1);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.publications(filters).then((result) => { if (live) setList(result); }).catch((cause) => { if (live) setError(cause.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  },[api,filters,revision]);

  const loadDetail = useCallback(async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    try { setDetail(await api.publication(id)); }
    catch (cause) { setDetailError(cause.message); }
    finally { setDetailLoading(false); }
  },[api]);

  const mutate = async (operation) => {
    if (saving) return false;
    setSaving(true);
    setDetailError('');
    try {
      const updated = await operation();
      setDetail(updated);
      reload();
      try { await onChanged?.(); }
      catch { setDetailError('记录已保存，但统计刷新失败，稍后刷新页面即可'); }
      return true;
    } catch (cause) {
      setDetailError(cause.message);
      return false;
    } finally { setSaving(false); }
  };

  return {filters,change,setFilters,list,loading,error,reload,selectedId,setSelectedId,detail,setDetail,detailLoading,detailError,saving,loadDetail,mutate};
}

export function PublicationHistoryView({api,go,onChanged,contentTypeCode}) {
  const history = usePublicationHistory(api,onChanged,contentTypeCode);
  const {filters,change,setFilters,list,loading,error,reload,selectedId,setSelectedId,detail,setDetail,detailLoading,detailError,saving,loadDetail,mutate} = history;
  const [editOpen,setEditOpen] = useState(false);
  const [voidOpen,setVoidOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [voidForm] = Form.useForm();
  const clearDetail = () => { setSelectedId(null); setDetail(null); setEditOpen(false); setVoidOpen(false); };
  const openEdit = () => {
    editForm.setFieldsValue({publishedOn:detail.publishedOn,publishedTime:detail.publishedTime || '',publishUrl:detail.publishUrl || '',note:detail.note || '',assetIds:detail.assets.map((asset) => asset.id),reason:'',requestKey:crypto.randomUUID()});
    setEditOpen(true);
  };
  const saveEdit = async (values) => {
    const ok = await mutate(() => api.correctPublication(detail.id,{...values,publishedTime:values.publishedTime || null,publishUrl:values.publishUrl || null,assetIds:values.assetIds || [],requestKey:values.requestKey}));
    if (ok) setEditOpen(false);
  };
  const saveVoid = async (values) => {
    const ok = await mutate(() => api.voidPublication(detail.id,{...values,requestKey:values.requestKey}));
    if (ok) setVoidOpen(false);
  };
  const columns = [
    {title:'内容',dataIndex:'title',key:'title',render:(_value,item) => <button className="publication-title-link" onClick={() => loadDetail(item.id)}><strong>{item.title || item.topicTitle}</strong><small>{item.topicTitle}</small></button>},
    {title:'平台',dataIndex:'platform',key:'platform',width:100},
    {title:'实际发布',key:'publishedOn',width:150,render:(_value,item) => <span>{item.publishedOn}{item.publishedTime ? ` ${item.publishedTime}` : ''}</span>},
    {title:'分类 / 来源',key:'state',width:205,render:(_value,item) => <Space size={4}><Tag>{CONTENT_TYPES.find((type) => type.code === item.contentTypeCode)?.name || item.contentTypeName || '大话保险'}</Tag>{originTag(item.origin)}{item.status === 'voided' ? <Tag color="red">已作废</Tag> : null}</Space>},
    {title:'链接',key:'link',width:120,render:(_value,item) => safeExternalUrl(item.publishUrl) ? <a href={safeExternalUrl(item.publishUrl)} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>打开链接 <LinkOutlined /></a> : <Text type="secondary">未填写</Text>},
    {title:'操作',key:'actions',width:95,render:(_value,item) => <Button size="small" color="primary" variant="outlined" onClick={() => loadDetail(item.id)}>查看详情</Button>},
  ];
  return <div className="publication-page">
    <div className="page-heading publication-heading"><div><Title level={2}>发布记录</Title><Text className="muted">每次实际发布留一条记录，稿件与配图按登记时留存。</Text></div><Button color="primary" variant="outlined" icon={<ArrowLeftOutlined />} onClick={() => go('content',{type:filters.type || contentTypeCode})}>返回内容工作台</Button></div>
    <Card className="panel-card publication-list-card" title={<PanelHeading title="历史发布" subtitle="默认只显示有效记录；作废记录可通过状态筛选查看" />}>
      <div className="publication-filters">
        <Input className="publication-search-input" aria-label="搜索发布记录" allowClear prefix={<SearchOutlined />} placeholder="搜索选题或标题" value={filters.keyword} onChange={(event) => change({keyword:event.target.value})} />
        <Select aria-label="筛选内容分类" value={filters.type || ''} options={[{value:'',label:'全部分类'},...CONTENT_TYPES.map((type) => ({value:type.code,label:type.name}))]} onChange={(type) => { change({type}); const query = new URLSearchParams(window.location.search); type ? query.set('type',type) : query.delete('type'); window.history.replaceState(window.history.state,'',`${window.location.pathname}?${query}`); }} />
        <Select aria-label="筛选平台" value={filters.platform} options={[{value:'',label:'全部平台'},...platformOptions]} onChange={(platform) => change({platform})} />
        <Input aria-label="开始日期" type="date" value={filters.from} onChange={(event) => change({from:event.target.value})} />
        <Input aria-label="结束日期" type="date" value={filters.to} onChange={(event) => change({to:event.target.value})} />
        <Select aria-label="记录状态" value={filters.status} options={statusOptions} onChange={(status) => change({status})} />
        {filters.topicId ? <Button size="small" onClick={() => change({topicId:''})}>清除选题筛选</Button> : null}
      </div>
      {error ? <Alert type="error" showIcon title="加载发布记录失败" description={error} action={<Button onClick={reload}>重试</Button>} /> : null}
      <Table className="publication-table" rowKey="id" loading={loading} columns={columns} dataSource={list.items} scroll={{x:860}} locale={{emptyText:<Empty description="还没有发布记录" />}} pagination={{current:filters.page,pageSize:filters.pageSize,total:list.total,showSizeChanger:true,pageSizeOptions:[10,20,50],showTotal:(total)=>`共 ${total} 次发布`,onChange:(page,pageSize) => setFilters((old)=>({...old,page,pageSize}))}} />
      <div className="publication-mobile-list">
        {loading ? <Spin /> : list.items.map((item) => <article className="publication-mobile-card" key={item.id}>
          <button className="publication-title-link" onClick={() => loadDetail(item.id)}><strong>{item.title || item.topicTitle}</strong><small>{item.topicTitle}</small></button>
          <Space wrap size={4}><Tag>{CONTENT_TYPES.find((type) => type.code === item.contentTypeCode)?.name || item.contentTypeName || '大话保险'}</Tag><Tag>{item.platform}</Tag>{originTag(item.origin)}{item.status === 'voided' ? <Tag color="red">已作废</Tag> : null}</Space>
          <Text>{item.publishedOn}{item.publishedTime ? ` ${item.publishedTime}` : ''}</Text>
          <Space wrap>{safeExternalUrl(item.publishUrl) ? <a href={safeExternalUrl(item.publishUrl)} target="_blank" rel="noopener noreferrer">打开链接 <LinkOutlined /></a> : <Text type="secondary">未填写链接</Text>}<Button size="small" color="primary" variant="outlined" onClick={() => loadDetail(item.id)}>查看详情</Button></Space>
        </article>)}
        {!loading && !list.items.length ? <Empty description="还没有发布记录" /> : null}
        {list.total > filters.pageSize ? <Pagination simple current={filters.page} pageSize={filters.pageSize} total={list.total} onChange={(page) => setFilters((old) => ({...old,page}))} /> : null}
      </div>
      {!loading && !list.total && !error ? <Button color="primary" variant="outlined" icon={<PlusOutlined />} onClick={() => go('content')}>返回已审核稿件</Button> : null}
    </Card>
    <Drawer title="发布记录详情" open={selectedId != null} onClose={clearDetail} size="min(96vw, 760px)" destroyOnHidden>
      {detailLoading ? <Spin /> : detailError ? <Alert type="error" showIcon title={detailError} action={selectedId ? <Button onClick={() => loadDetail(selectedId)}>重试</Button> : null} /> : null}
      {detail ? <div className="publication-detail">
        <div className="publication-detail-heading"><Title level={4}>{detail.title || detail.topicTitle}</Title><Space>{originTag(detail.origin)}{detail.status === 'voided' ? <Tag color="red">已作废</Tag> : <Tag color="green">有效记录</Tag>}</Space></div>
        <Descriptions bordered size="small" column={1} items={[
          {key:'topic',label:'选题',children:detail.topicTitle},
          {key:'contentType',label:'内容分类',children:CONTENT_TYPES.find((type) => type.code === detail.contentTypeCode)?.name || detail.contentTypeName || '大话保险'},
          {key:'platform',label:'平台',children:detail.platform},
          {key:'day',label:'实际发布日期',children:`${detail.publishedOn}${detail.publishedTime ? ` ${detail.publishedTime}` : ''}`},
          {key:'recorded',label:'登记时间',children:dateTime(detail.recordedAt)},
          {key:'url',label:'发布链接',children:safeExternalUrl(detail.publishUrl) ? <a href={safeExternalUrl(detail.publishUrl)} target="_blank" rel="noopener noreferrer">打开站外页面 <LinkOutlined /></a> : '未填写或链接无效'},
          {key:'note',label:'备注',children:detail.note || '—'},
        ]} />
        {detail.status === 'active' ? <Space className="publication-detail-actions" wrap><Button size="small" color="primary" variant="outlined" icon={<EditOutlined />} onClick={openEdit}>更正发布信息</Button><Button size="small" color="danger" variant="outlined" onClick={() => { voidForm.setFieldsValue({reason:'',requestKey:crypto.randomUUID()}); setVoidOpen(true); }}>作废记录</Button></Space> : null}
        <Title level={5}>登记时的工作台稿件</Title>
        {detail.contentSnapshot ? <><Text className="muted">这是登记时工作台保存的稿件，平台上的最终内容请以发布链接为准。</Text>{detail.contentSnapshot.sourceContext?.caseKind ? <Tag color="blue">{CASE_KIND_NAMES[detail.contentSnapshot.sourceContext.caseKind] || '案例'}</Tag> : null}<Title level={5}>{detail.contentSnapshot.title}</Title>{detail.contentSnapshot.summary ? <Paragraph>{detail.contentSnapshot.summary}</Paragraph> : null}<Paragraph className="publication-snapshot-body">{detail.contentSnapshot.body}</Paragraph>{detail.contentSnapshot.hashtags ? <Paragraph>{detail.contentSnapshot.hashtags}</Paragraph> : null}{detail.contentSnapshot.sources ? <Text className="muted">资料来源：{detail.contentSnapshot.sources}</Text> : null}</> : <Alert type="info" showIcon title="历史稿件内容不可追溯" description="旧数据只保存了可确认的日期与链接，无法还原当时的正文和配图。" />}
        {detail.assets?.length ? <><Title level={5}>登记时使用的配图</Title><div className="publication-assets">{detail.assets.map((asset) => <figure key={asset.id}><img src={api.asset(asset.id)} alt={asset.fileName} loading="lazy" /><figcaption>{asset.fileName}</figcaption></figure>)}</div></> : null}
        <Title level={5}>操作记录</Title><Timeline items={(detail.events || []).map((event) => ({content:<div><Text strong>{actionNames[event.action] || event.action}</Text><Text className="muted"> · {dateTime(event.createdAt)}</Text>{event.reason ? <Paragraph>原因：{event.reason}</Paragraph> : null}{event.action === 'corrected' ? <Paragraph>更正前：{event.previous?.publishedOn || '—'} {event.previous?.publishedTime || ''} {event.previous?.publishUrl || '无链接'}<br />更正后：{event.next?.publishedOn || '—'} {event.next?.publishedTime || ''} {event.next?.publishUrl || '无链接'}{Array.isArray(event.previous?.assetIds) && Array.isArray(event.next?.assetIds) && JSON.stringify(event.previous.assetIds) !== JSON.stringify(event.next.assetIds) ? <><br />配图：{event.previous.assetIds.length} 张 → {event.next.assetIds.length} 张</> : null}</Paragraph> : null}</div>}))} />
      </div> : null}
    </Drawer>
    <Modal title="更正发布信息" open={editOpen} forceRender zIndex={1100} onCancel={() => setEditOpen(false)} onOk={() => editForm.submit()} confirmLoading={saving} okText="保存更正" cancelText="取消" cancelButtonProps={{color:'danger',variant:'outlined'}}>
      <Form form={editForm} layout="vertical" onValuesChange={(changed) => { if (!Object.hasOwn(changed,'requestKey')) editForm.setFieldValue('requestKey',crypto.randomUUID()); }} onFinish={saveEdit}>
        <Form.Item name="requestKey" hidden><Input /></Form.Item>
        <Form.Item name="publishedOn" label="实际发布日期" rules={[{required:true,message:'请选择日期'}]}><Input type="date" /></Form.Item>
        <Form.Item name="publishedTime" label="实际时间（可选）"><Input type="time" /></Form.Item>
        <Form.Item name="publishUrl" label="发布链接" rules={[{type:'url',message:'请填写有效的 http/https 链接'}]}><Input type="url" /></Form.Item>
        <Form.Item name="note" label="备注"><Input.TextArea rows={2} maxLength={1000} /></Form.Item>
        {detail?.availableAssets?.length ? <Form.Item name="assetIds" label="本次使用的配图"><Checkbox.Group options={detail.availableAssets.map((asset) => ({value:asset.id,label:asset.fileName}))} /></Form.Item> : null}
        <Form.Item name="reason" label="更正原因" rules={[{required:true,whitespace:true,message:'请填写更正原因'}]}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
      {detailError ? <Alert type="error" showIcon title={detailError} /> : null}
    </Modal>
    <Modal title="作废发布记录" open={voidOpen} forceRender zIndex={1100} onCancel={() => setVoidOpen(false)} onOk={() => voidForm.submit()} confirmLoading={saving} okText="确认作废" okButtonProps={{color:'danger',variant:'outlined'}} cancelText="取消" cancelButtonProps={{color:'danger',variant:'outlined'}}>
      <Text>作废后，这条记录仍可在历史中查看，但不再计入发布统计。</Text>
      <Form form={voidForm} layout="vertical" onFinish={saveVoid}>
        <Form.Item name="requestKey" hidden><Input /></Form.Item>
        <Form.Item name="reason" label="作废原因" rules={[{required:true,whitespace:true,message:'请填写作废原因'}]}><Input.TextArea rows={3} maxLength={500} /></Form.Item>
      </Form>
      {detailError ? <Alert type="error" showIcon title={detailError} /> : null}
    </Modal>
  </div>;
}
