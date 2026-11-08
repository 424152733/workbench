import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ArticlePlatformPreview } from '../../article-preview.jsx';
import { XhsPlatformPreview } from '../content/XhsPlatformPreview.jsx';
import { useProductCenterWorkspace } from './useProductCenterWorkspace.js';
import { ProductSyncPanel } from './ProductSyncPanel.jsx';

const { Title, Text, Paragraph } = Typography;
const DOCUMENT_TYPES = [
  { value: 'policy_terms', label: '保险条款' },
  { value: 'product_brief', label: '产品说明' },
  { value: 'brochure', label: '宣传资料' },
  { value: 'rate_table', label: '费率表' },
  { value: 'cash_value', label: '现金价值表' },
  { value: 'other', label: '其他资料' },
];
const PLATFORMS = ['知乎', '小红书', '公众号'];
const DISCLAIMER =
  '本文根据已核对的产品资料整理，仅供产品介绍参考，不构成投保建议。具体保障责任、适用条件及除外责任以保险合同和保险公司正式资料为准。';
const COPY_DISCLAIMER =
  '产品介绍仅供参考，不构成投保建议；具体保障责任和适用条件以保险合同及保险公司正式资料为准。';
function ProductInterpretationWorkspace({workspace,go}) {
  const topics = workspace.contentTopics || [];
  return <Card className="product-panel" title="产品解读" extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => go('content',{type:'product_explainer',productId:workspace.product.id})}>在内容工作台新建</Button>}>
    <Alert className="product-copy-basis" type="info" showIcon message="产品资料在这里维护；跨平台选题、稿件、图卡、审核和发布记录统一在内容工作台管理。" />
    {topics.length ? <div className="product-interpretation-list">{topics.map((topic) => <div className="product-interpretation-item" key={topic.id}><div><Text strong>{topic.title}</Text><Text type="secondary">{topic.platforms.join(' · ')}</Text></div><Space><Tag>{topic.status}</Tag><Button size="small" type="link" onClick={() => go('content',{type:'product_explainer',topicId:topic.id})}>打开稿件</Button></Space></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有关联的产品解读" />}
  </Card>;
}
const formatBytes = (size) =>
  size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
const formatProductDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : value || '未填写';
};
const extractionSourcesLabel = (extraction) => {
  const sources = extraction?.sourceDocuments || [];
  if (sources.length > 1) return `${sources.length} 份资料 · ${sources[0].fileName || '产品资料'}等`;
  return extraction?.documentName || sources[0]?.fileName || '产品资料';
};

function ProductModal({ open, product, meta, onCancel, onSubmit, loading }) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      product
        ? {
            productName: product.productName,
            shortName: product.shortName,
            productVersion: product.productVersion,
            insuranceTypeCode: product.insuranceTypeCode,
            effectiveDate: product.effectiveDate || undefined,
            status: product.status,
            note: product.note,
          }
        : {
            companyCode: 'xinhua',
            insuranceTypeCode: meta.insuranceTypes[0]?.code,
            status: '整理中',
          },
    );
  }, [open, product, meta, form]);
  return (
    <Modal
      title={product ? '编辑产品档案' : '新建产品档案'}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      okText="保存档案"
      cancelText="取消"
      cancelButtonProps={{ color: 'danger', variant: 'outlined' }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item
          label="保险公司"
          name="companyCode"
          rules={[{ required: true, message: '请选择保险公司' }]}
        >
          <Select
            options={meta.companies.map((item) => ({
              value: item.code,
              label: item.label,
            }))}
            disabled={Boolean(product)}
          />
        </Form.Item>
        <Form.Item
          label="险种"
          name="insuranceTypeCode"
          rules={[{ required: true, message: '请选择险种' }]}
        >
          <Select
            options={meta.insuranceTypes.map((item) => ({
              value: item.code,
              label: item.label,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="产品名称"
          name="productName"
          rules={[
            { required: true, whitespace: true, message: '请填写产品名称' },
          ]}
        >
          <Input maxLength={120} showCount />
        </Form.Item>
        <Form.Item label="产品简称" name="shortName">
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item label="产品版本 / 适用版本" name="productVersion">
          <Input maxLength={80} placeholder="例如：2026 版" />
        </Form.Item>
        <Form.Item label="适用日期" name="effectiveDate">
          <Input type="date" />
        </Form.Item>
        <Form.Item label="档案状态" name="status">
          <Select
            options={['整理中', '可用', '已停用'].map((value) => ({
              value,
              label: value,
            }))}
          />
        </Form.Item>
        <Form.Item label="备注" name="note">
          <Input.TextArea rows={3} maxLength={1200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DocumentPanel({
  workspace,
  activeDocumentId,
  setActiveDocumentId,
  uploadDocument,
  deleteDocument,
  downloadDocument,
  analyzeMaterials,
  updateExtraction,
  confirmExtraction,
  apiLoading,
}) {
  const [documentType, setDocumentType] = useState('product_brief');
  const active = workspace.documents.find((doc) => doc.id === activeDocumentId);
  const relatedExtractions = active
    ? workspace.extractions.filter((item) => item.documentId === active.id || item.sourceDocuments?.some((source) => source.id === active.id))
    : [];
  const relatedDrafts = workspace.drafts.filter((draft) =>
    relatedExtractions.some((item) => item.id === draft.extractionId),
  );
  const busy = Boolean(apiLoading['product-center:upload']);
  const unreadyDocuments = workspace.documents.filter((doc) =>
    !['parsed','needs_review'].includes(doc.parseStatus) || Number(doc.extractedCharCount || 0) < 40,
  );
  return (
    <div className="product-document-grid">
      <Card
        className="product-panel"
        title="产品资料"
        extra={
          <Text type="secondary">PDF、DOCX、TXT · 单个文件不超过 25 MB</Text>
        }
      >
        <div className="product-upload-row">
          <Select
            aria-label="资料类型"
            value={documentType}
            options={DOCUMENT_TYPES}
            onChange={setDocumentType}
          />
          <Upload
            accept=".pdf,.docx,.txt"
            showUploadList={false}
            maxCount={1}
            beforeUpload={(file) => {
              uploadDocument(file, documentType);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={busy}>
              上传资料
            </Button>
          </Upload>
        </div>
        <div className="product-document-list">
          {workspace.documents.length ? (
            workspace.documents.map((doc) => (
              <button
                type="button"
                key={doc.id}
                className={`product-document-item ${doc.id === activeDocumentId ? 'is-active' : ''}`}
                onClick={() => setActiveDocumentId(doc.id)}
              >
                <FileTextOutlined />
                <span className="product-document-copy">
                  <strong>{doc.fileName}</strong>
                  <small>
                    {DOCUMENT_TYPES.find(
                      (item) => item.value === doc.documentType,
                    )?.label || '产品资料'}{' '}
                    · {formatBytes(doc.byteSize)}
                  </small>
                </span>
                <Tag
                  color={
                    doc.parseStatus === 'parsed'
                      ? 'green'
                      : doc.parseStatus === 'failed'
                        ? 'red'
                        : 'gold'
                  }
                >
                  {doc.parseStatus === 'parsed'
                    ? '已解析'
                    : doc.parseStatus === 'failed'
                      ? '解析失败'
                      : '需检查'}
                </Tag>
              </button>
            ))
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有产品资料"
            />
          )}
        </div>
        {active ? (
          <div className="product-document-detail">
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: 'type',
                  label: '资料类型',
                  children:
                    DOCUMENT_TYPES.find(
                      (item) => item.value === active.documentType,
                    )?.label || '其他资料',
                },
                {key:'acquired-at',label:'取得时间',children:active.createdAt ? new Date(active.createdAt).toLocaleString('zh-CN',{hour12:false}) : '未知'},
                {
                  key: 'length',
                  label: '提取文字',
                  children: `${active.extractedCharCount.toLocaleString()} 字`,
                },
                {
                  key: 'pages',
                  label: '页数',
                  children: active.pageCount
                    ? `${active.pageCount} 页`
                    : '未标页',
                },
                ...(active.sourceType==='official_sync' ? [
                  {key:'official-source',label:'官网来源',children:<a href={active.sourceUrl} target="_blank" rel="noreferrer">打开原始 PDF</a>},
                  {key:'official-hash',label:'SHA-256',children:<Text code copyable>{active.sourceSha256 || '未生成'}</Text>},
                ] : []),
              ]}
            />
            {active.parseError ? (
              <Alert type="warning" showIcon message={active.parseError} />
            ) : null}
            <Space wrap className="product-document-actions">
              <Button
                size="small"
                type="primary"
                icon={<ReloadOutlined />}
                loading={Boolean(
                  apiLoading[`product-center:analyze:${workspace.product.id}`],
                )}
                disabled={!workspace.documents.length || unreadyDocuments.length > 0}
                onClick={analyzeMaterials}
              >
                汇总提取全部资料
              </Button>
              <Button
                size="small"
                loading={Boolean(
                  apiLoading[`product-center:document:download:${active.id}`],
                )}
                onClick={() => downloadDocument(active)}
              >
                下载原文件
              </Button>
              <Popconfirm
                title="删除这份产品资料？"
                description={`将同时删除 ${relatedExtractions.length} 组产品要点、${relatedDrafts.length} 篇平台文案及其历史版本。`}
                okText="删除"
                cancelText="取消"
                cancelButtonProps={{ color: 'danger', variant: 'outlined' }}
                okButtonProps={{
                  color: 'danger',
                  variant: 'outlined',
                  loading: Boolean(
                    apiLoading[`product-center:document:delete:${active.id}`],
                  ),
                }}
                onConfirm={() => deleteDocument(active.id)}
              >
                <Button
                  size="small"
                  color="danger"
                  variant="outlined"
                  icon={<DeleteOutlined />}
                  loading={Boolean(
                    apiLoading[`product-center:document:delete:${active.id}`],
                  )}
                >
                  删除资料
                </Button>
              </Popconfirm>
            </Space>
            <Text type="secondary" className="product-source-summary-hint">
              将本产品的 {workspace.documents.length} 份资料一起整理为一组要点，每条要点保留文件和页码来源；资料冲突会列入待核实。
            </Text>
            {unreadyDocuments.length ? (
              <Alert
                className="product-source-summary-warning"
                type="warning"
                showIcon
                message={`先完成全部资料解析：${unreadyDocuments.map((doc) => doc.fileName).join('、')}`}
              />
            ) : null}
          </div>
        ) : null}
        <Alert
          className="product-no-image-alert"
          type="info"
          showIcon
          message="资料解析在本机完成。点击“汇总提取全部资料”后会调用 DeepSeek 一次性整理本产品的全部资料；本模块不会调用付费生图服务。"
        />
      </Card>
      <FactsPanel
        workspace={workspace}
        apiLoading={apiLoading}
        updateExtraction={updateExtraction}
        confirmExtraction={confirmExtraction}
      />
    </div>
  );
}

function FactsPanel({
  workspace,
  apiLoading,
  updateExtraction,
  confirmExtraction,
}) {
  const extractionChoices = workspace.extractions;
  const [activeId, setActiveId] = useState(extractionChoices[0]?.id || null);
  const extraction =
    extractionChoices.find((item) => item.id === activeId) ||
    extractionChoices[0];
  const [facts, setFacts] = useState([]);
  useEffect(() => {
    if (!extraction) {
      setActiveId(null);
      setFacts([]);
      return;
    }
    setActiveId(extraction.id);
    setFacts(
      extraction.facts.map((fact) => ({
        ...fact,
        sourceRefs: fact.sourceRefs || [],
      })),
    );
  }, [extraction?.id, workspace.extractions]);
  if (!extraction)
    return (
      <Card className="product-panel" title="产品要点">
        <Empty description="上传资料并提取要点后，在这里核对事实与来源" />
      </Card>
    );
  const setFact = (index, field, value) =>
    setFacts((current) =>
      current.map((fact, i) =>
        i === index ? { ...fact, [field]: value } : fact,
      ),
    );
  const save = async () => updateExtraction(extraction.id, facts);
  const confirm = async () => {
    const saved = await updateExtraction(extraction.id, facts);
    if (saved) await confirmExtraction(extraction.id);
  };
  return (
    <Card
      className="product-panel"
      title="产品要点与来源"
      extra={
        <Tag color={extraction.status === '已确认' ? 'green' : 'gold'}>
          {extraction.status}
        </Tag>
      }
    >
      {extractionChoices.length > 1 ? (
        <Select
          className="product-extraction-select"
          aria-label="选择产品要点版本"
          value={extraction.id}
          options={extractionChoices.map((item) => ({
            value: item.id,
            label: `${extractionSourcesLabel(item)} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}`,
          }))}
          onChange={setActiveId}
        />
      ) : null}
      {extraction.positioning ? (
        <Paragraph className="product-positioning">
          {extraction.positioning}
        </Paragraph>
      ) : null}
      {extraction.openQuestions?.length ? (
        <Alert
          className="product-open-questions"
          type="warning"
          showIcon
          message="仍需人工确认"
          description={
            <ul>
              {extraction.openQuestions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <div className="product-fact-list">
        {facts.map((fact, index) => (
          <section className="product-fact" key={fact.id}>
            <div className="product-fact-heading">
              <Tag>{fact.category}</Tag>
              <Checkbox
                checked={Boolean(fact.confirmed)}
                disabled={!fact.sourceRefs.some((source) => source.verified)}
                onChange={(event) =>
                  setFact(index, 'confirmed', event.target.checked)
                }
              >
                我已核对
              </Checkbox>
            </div>
            <Input
              className="product-fact-title"
              value={fact.title}
              maxLength={100}
              onChange={(event) => setFact(index, 'title', event.target.value)}
              aria-label={`要点 ${index + 1}标题`}
            />
            <label>
              资料事实
              <Input.TextArea
                value={fact.productFact}
                autoSize={{ minRows: 2, maxRows: 5 }}
                maxLength={1200}
                onChange={(event) =>
                  setFact(index, 'productFact', event.target.value)
                }
              />
            </label>
            <label>
              通俗解释
              <Input.TextArea
                value={fact.plainExplanation}
                autoSize={{ minRows: 2, maxRows: 4 }}
                maxLength={1200}
                onChange={(event) =>
                  setFact(index, 'plainExplanation', event.target.value)
                }
              />
            </label>
            <label>
              可能对应的需求价值
              <Input.TextArea
                value={fact.customerValue}
                autoSize={{ minRows: 2, maxRows: 3 }}
                maxLength={1000}
                onChange={(event) =>
                  setFact(index, 'customerValue', event.target.value)
                }
              />
            </label>
            <label>
              适用边界
              <Input.TextArea
                value={fact.boundary}
                autoSize={{ minRows: 2, maxRows: 3 }}
                maxLength={1000}
                onChange={(event) =>
                  setFact(index, 'boundary', event.target.value)
                }
              />
            </label>
            <div className="product-source-refs">
              <Text strong>资料出处</Text>
              {fact.sourceRefs.map((source, sourceIndex) => (
                <blockquote key={`${source.documentId}-${sourceIndex}`}>
                  <Tag color={source.verified ? 'green' : 'red'}>
                    {source.verified ? '原文已匹配' : '需人工检查'}
                  </Tag>
                  <span>
                    {source.documentName}
                    {source.page ? ` · 第 ${source.page} 页` : ''}
                    {source.section ? ` · ${source.section}` : ''}
                  </span>
                  <p>“{source.quote}”</p>
                </blockquote>
              ))}
            </div>
          </section>
        ))}
      </div>
      <Space wrap className="product-facts-actions">
        <Button
          size="small"
          loading={Boolean(
            apiLoading[`product-center:extraction:save:${extraction.id}`],
          )}
          onClick={save}
        >
          保存要点
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<CheckCircleOutlined />}
          loading={
            Boolean(
              apiLoading[`product-center:extraction:save:${extraction.id}`],
            ) ||
            Boolean(
              apiLoading[`product-center:extraction:confirm:${extraction.id}`],
            )
          }
          disabled={
            !facts.length ||
            facts.some(
              (fact) =>
                !fact.confirmed ||
                !fact.sourceRefs.some((source) => source.verified),
            )
          }
          onClick={confirm}
        >
          确认全部要点
        </Button>
      </Space>
    </Card>
  );
}

function PlatformSettingsModal({
  open,
  platform,
  setting,
  apiLoading,
  onCancel,
  onSubmit,
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (open)
      form.setFieldsValue({
        audience: setting?.audience || '',
        tone: setting?.tone || '',
        structure: setting?.structure || '',
        lengthHint: setting?.lengthHint || '',
      });
  }, [open, platform, setting, form]);
  return (
    <Modal
      title={`${platform} · 表达设置`}
      open={open}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={Boolean(
        apiLoading[`product-center:platform-settings:update:${platform}`],
      )}
      okText="保存设置"
      cancelText="取消"
      cancelButtonProps={{ color: 'danger', variant: 'outlined' }}
      destroyOnHidden
    >
      <Paragraph type="secondary">
        这些偏好只影响读者、语气、结构和篇幅，不会改变已核对的产品事实或责任边界。
      </Paragraph>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item label="目标读者" name="audience">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
        <Form.Item label="表达语气" name="tone">
          <Input.TextArea rows={3} maxLength={500} showCount />
        </Form.Item>
        <Form.Item label="内容结构" name="structure">
          <Input.TextArea rows={4} maxLength={1200} showCount />
        </Form.Item>
        <Form.Item label="篇幅建议" name="lengthHint">
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DraftVersionsModal({
  open,
  draft,
  apiLoading,
  loadDraftVersions,
  restoreDraftVersion,
  onCancel,
}) {
  const [versions, setVersions] = useState([]);
  useEffect(() => {
    let active = true;
    setVersions([]);
    if (open && draft?.id)
      loadDraftVersions(draft.id).then((result) => {
        if (active && result) setVersions(result);
      });
    return () => {
      active = false;
    };
  }, [open, draft?.id, draft?.version]);
  const changedByLabel = {
    'agent-edit': '编辑前',
    'before-regenerate': '重新生成前',
    'facts-recheck': '产品要点复核前',
    'before-restore': '恢复历史版本前',
  };
  return (
    <Modal
      title="文案历史版本"
      open={open}
      onCancel={onCancel}
      footer={null}
      width="min(96vw, 820px)"
      destroyOnHidden
    >
      {draft ? (
        <Alert
          className="product-version-current"
          type="info"
          showIcon
          message={`当前版本 v${draft.version} · ${draft.status}`}
          description={draft.title}
        />
      ) : null}
      {apiLoading[`product-center:draft:versions:${draft?.id}`] ? (
        <div className="product-version-loading">
          <Spin />
        </div>
      ) : versions.length ? (
        <Collapse
          items={versions.map((item) => ({
            key: item.version,
            label: (
              <span>
                v{item.version} ·{' '}
                {changedByLabel[item.changedBy] || item.changedBy || '历史快照'}{' '}
                · {new Date(item.createdAt).toLocaleString('zh-CN')}
              </span>
            ),
            children: (
              <div className="product-version-snapshot">
                <Title level={5}>{item.snapshot.title}</Title>
                {item.snapshot.summary ? (
                  <Paragraph>{item.snapshot.summary}</Paragraph>
                ) : null}
                <Paragraph className="product-version-body">
                  {item.snapshot.body}
                </Paragraph>
                {item.snapshot.hashtags ? (
                  <Text type="secondary">{item.snapshot.hashtags}</Text>
                ) : null}
                <Popconfirm
                  title={`恢复到版本 v${item.version}？`}
                  description="当前内容会先保存为一个新版本，恢复后文案需要重新审核。"
                  okText="恢复版本"
                  cancelText="取消"
                  cancelButtonProps={{ color: 'danger', variant: 'outlined' }}
                  okButtonProps={{
                    loading: Boolean(
                      apiLoading[`product-center:draft:restore:${draft.id}`],
                    ),
                  }}
                  onConfirm={() =>
                    restoreDraftVersion(draft.id, item.version).then(
                      (result) => {
                        if (result) onCancel();
                      },
                    )
                  }
                >
                  <Button
                    size="small"
                    className="product-version-restore"
                    icon={<HistoryOutlined />}
                  >
                    恢复此版本
                  </Button>
                </Popconfirm>
              </div>
            ),
          }))}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有历史版本；编辑、重新生成或复核产品要点后会留下版本快照"
        />
      )}
    </Modal>
  );
}

function CopyWorkspace({
  workspace,
  platform,
  setPlatform,
  platformSettings,
  apiLoading,
  generateDraft,
  saveDraft,
  approveDraft,
  copyText,
  updatePlatformSettings,
  loadDraftVersions,
  restoreDraftVersion,
}) {
  const confirmedExtractions = workspace.extractions.filter(
    (item) => item.status === '已确认',
  );
  const [extractionId, setExtractionId] = useState(
    confirmedExtractions[0]?.id || null,
  );
  useEffect(() => {
    if (!confirmedExtractions.some((item) => item.id === extractionId))
      setExtractionId(confirmedExtractions[0]?.id || null);
  }, [workspace.extractions, extractionId]);
  const extraction =
    confirmedExtractions.find((item) => item.id === extractionId) ||
    confirmedExtractions[0];
  const draft =
    workspace.drafts.find(
      (item) =>
        item.platform === platform &&
        (!extraction || item.extractionId === extraction.id),
    ) || workspace.drafts.find((item) => item.platform === platform);
  const [editor, setEditor] = useState(null);
  const [checks, setChecks] = useState([false, false, false]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  useEffect(() => {
    setEditor(draft ? { ...draft } : null);
    setChecks(draft?.checks || [false, false, false]);
  }, [draft?.id, draft?.updatedAt, draft?.version]);
  const contentChanged = Boolean(
    draft &&
    editor &&
    ['title', 'summary', 'body', 'hashtags'].some(
      (key) => String(draft[key] || '') !== String(editor[key] || ''),
    ),
  );
  const isApproved = draft?.status === '已审核' && !contentChanged;
  const update = (key, value) => {
    setEditor((current) => ({ ...current, [key]: value }));
    if (['title', 'summary', 'body', 'hashtags'].includes(key))
      setChecks([false, false, false]);
  };
  const reviewChecks = [
    '关键事实与已确认要点一致，没有额外承诺',
    '责任边界和适用条件表达清楚',
    '资料出处已核对，必要免责声明已保留',
  ];
  const approve = async () => {
    if (!editor) return;
    const saved = await saveDraft(editor.id, {
      title: editor.title,
      summary: editor.summary,
      body: editor.body,
      hashtags: editor.hashtags,
      checks,
    });
    if (saved) await approveDraft(editor.id, checks);
  };
  const previewDraft = editor || draft;
  const currentPlatformSetting = platformSettings.find(
    (item) => item.platform === platform,
  );
  return (
    <div className="product-copy-layout">
      <Card
        className="product-panel product-copy-editor"
        title="平台文案"
        extra={
          <Space wrap>
            <Tag color={isApproved ? 'green' : 'gold'}>
              {isApproved ? '已审核' : draft?.status || '待生成'}
            </Tag>
            <Tooltip title="平台表达设置">
              <Button
                type="text"
                aria-label="平台表达设置"
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
            {draft ? (
              <Tooltip title="查看历史版本">
                <Button
                  type="text"
                  aria-label="查看历史版本"
                  icon={<HistoryOutlined />}
                  onClick={() => setVersionsOpen(true)}
                />
              </Tooltip>
            ) : null}
          </Space>
        }
      >
        <Tabs
          activeKey={platform}
          onChange={setPlatform}
          items={PLATFORMS.map((item) => ({ key: item, label: item }))}
        />
        {confirmedExtractions.length > 1 ? (
          <Select
            className="product-copy-source-select"
            aria-label="文案依据的已确认要点版本"
            value={extraction?.id}
            options={confirmedExtractions.map((item) => ({
              value: item.id,
              label: `${extractionSourcesLabel(item)} · ${new Date(item.confirmedAt || item.createdAt).toLocaleDateString('zh-CN')}`,
            }))}
            onChange={setExtractionId}
          />
        ) : null}
        {extraction ? (
          <Alert
            className="product-copy-basis"
            type="info"
            showIcon
            message={`依据已确认的产品资料：${extractionSourcesLabel(extraction)}`}
          />
        ) : null}
        {!extraction ? (
          <Alert
            type="info"
            showIcon
            message="请先在“资料与要点”中核对并确认产品事实。"
          />
        ) : (
          <>
            {!draft ? (
              <div className="product-copy-empty">
                <Text type="secondary">
                  按平台分别生成产品介绍初稿，生成后可编辑、预览和审核。
                </Text>
                <Button
                  type="primary"
                  loading={Boolean(
                    apiLoading[`product-center:draft:generate:${platform}`],
                  )}
                  onClick={() => generateDraft(extraction.id, platform)}
                >
                  生成{platform}文案
                </Button>
              </div>
            ) : (
              <>
                <div className="product-copy-meta">
                  <Tag color={draft.humanized ? 'cyan' : 'gold'}>
                    {draft.humanized ? 'humanizer-zh 已润色' : '待人工润色'}
                  </Tag>
                  <Tag>{draft.provider || '文本模型'}</Tag>
                </div>
                <div className="product-copy-actions">
                  <Button
                    size="small"
                    type="primary"
                    loading={Boolean(
                      apiLoading[`product-center:draft:generate:${platform}`],
                    )}
                    onClick={() => generateDraft(extraction.id, platform)}
                  >
                    重新生成
                  </Button>
                  <Button
                    size="small"
                    loading={Boolean(
                      apiLoading[`product-center:draft:save:${draft.id}`],
                    )}
                    onClick={() =>
                      saveDraft(draft.id, {
                        title: editor.title,
                        summary: editor.summary,
                        body: editor.body,
                        hashtags: editor.hashtags,
                      })
                    }
                  >
                    保存修改
                  </Button>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    disabled={!isApproved}
                    onClick={() =>
                      copyText(
                        [
                          editor.title,
                          editor.summary,
                          editor.body,
                          COPY_DISCLAIMER,
                          editor.hashtags,
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      )
                    }
                  >
                    复制文案
                  </Button>
                </div>
                <Form layout="vertical" className="product-copy-form">
                  <Form.Item label="标题">
                    <Input
                      value={editor?.title || ''}
                      maxLength={200}
                      onChange={(event) => update('title', event.target.value)}
                    />
                  </Form.Item>
                  {platform === '公众号' ? (
                    <Form.Item label="摘要">
                      <Input.TextArea
                        value={editor?.summary || ''}
                        rows={2}
                        maxLength={500}
                        onChange={(event) =>
                          update('summary', event.target.value)
                        }
                      />
                    </Form.Item>
                  ) : null}
                  <Form.Item label={platform === '知乎' ? '回答正文' : '正文'}>
                    <Input.TextArea
                      value={editor?.body || ''}
                      autoSize={{ minRows: 14, maxRows: 28 }}
                      maxLength={40000}
                      onChange={(event) => update('body', event.target.value)}
                    />
                  </Form.Item>
                  {platform === '小红书' ? (
                    <Form.Item label="话题标签">
                      <Input
                        value={editor?.hashtags || ''}
                        maxLength={800}
                        onChange={(event) =>
                          update('hashtags', event.target.value)
                        }
                      />
                    </Form.Item>
                  ) : null}
                </Form>
                <Alert
                  className="product-disclaimer"
                  type="info"
                  showIcon
                  message={DISCLAIMER}
                />
                <div className="product-approval-checks">
                  <Text strong>人工审核</Text>
                  {reviewChecks.map((item, index) => (
                    <Checkbox
                      key={item}
                      checked={Boolean(checks[index])}
                      onChange={(event) =>
                        setChecks((current) =>
                          current.map((value, i) =>
                            i === index ? event.target.checked : value,
                          ),
                        )
                      }
                    >
                      {item}
                    </Checkbox>
                  ))}
                  <Button
                    type="primary"
                    disabled={!checks.every(Boolean) || isApproved}
                    loading={
                      Boolean(
                        apiLoading[`product-center:draft:approve:${draft.id}`],
                      ) ||
                      Boolean(
                        apiLoading[`product-center:draft:save:${draft.id}`],
                      )
                    }
                    onClick={approve}
                  >
                    {isApproved ? '已审核' : '保存并通过审核'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
        <PlatformSettingsModal
          open={settingsOpen}
          platform={platform}
          setting={currentPlatformSetting}
          apiLoading={apiLoading}
          onCancel={() => setSettingsOpen(false)}
          onSubmit={async (values) => {
            const updated = await updatePlatformSettings(platform, values);
            if (updated) setSettingsOpen(false);
          }}
        />
        <DraftVersionsModal
          open={versionsOpen}
          draft={draft}
          apiLoading={apiLoading}
          loadDraftVersions={loadDraftVersions}
          restoreDraftVersion={restoreDraftVersion}
          onCancel={() => setVersionsOpen(false)}
        />
      </Card>
      <Card
        className="product-panel product-copy-preview"
        title="平台效果预览"
        extra={<Tag>{platform}</Tag>}
      >
        {previewDraft ? (
          platform === '小红书' ? (
            <XhsPlatformPreview
              draft={{ ...previewDraft, cardPlan: [] }}
              topicTitle={workspace.product.productName}
              brandName="产品资料解读"
              tagline="把产品特点说清楚"
              facts={extraction?.facts || []}
              disclaimer={COPY_DISCLAIMER}
            />
          ) : (
            <div className="product-article-preview">
              <ArticlePlatformPreview
                platform={platform}
                draft={previewDraft}
                topicTitle={workspace.product.productName}
                brandName={`${workspace.product.company}产品解读`}
                brandSubtitle="产品资料整理 · 人工核对后发布"
                zhihuAuthor="保险顾问 · 产品解读"
                zhihuSubtitle="根据产品资料整理"
                disclaimer={DISCLAIMER}
                wechatTheme="clean"
              />
            </div>
          )
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="生成文案后，可在这里查看阅读效果"
          />
        )}
        <Paragraph className="product-preview-note" type="secondary">
          预览基于已确认的产品事实；发布前仍需核对保险公司正式资料与平台排版效果。
        </Paragraph>
      </Card>
    </div>
  );
}

export function ProductCenterPage({
  api,
  apiLoading,
  performApiAction,
  copyText,
  go,
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const workspaceState = useProductCenterWorkspace({
    api,
    performApiAction,
    messageApi,
  });
  const {
    meta,
    platformSettings,
    products,
    selectedProductId,
    workspace,
    pageLoading,
    pageError,
    loadIndex,
    selectProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    uploadDocument,
    importOfficialMaterial,
    deleteDocument,
    analyzeMaterials,
    updateExtraction,
    confirmExtraction,
    generateDraft,
    saveDraft,
    approveDraft,
    updatePlatformSettings,
    loadDraftVersions,
    restoreDraftVersion,
    platform,
    setPlatform,
    activeDocumentId,
    setActiveDocumentId,
  } = workspaceState;
  const [search, setSearch] = useState('');
  const [productFilter,setProductFilter] = useState('verified_on_sale');
  const [modalProduct, setModalProduct] = useState(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const visibleProducts = useMemo(
    () =>
      products.filter((product) =>
        (productFilter==='all' || product.officialSaleStatus===productFilter) &&
        `${product.company} ${product.productName} ${product.shortName} ${product.insuranceType}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
    [products, search, productFilter],
  );
  const submitProduct = async (values) => {
    const saved = modalProduct
      ? await updateProduct(values)
      : await createProduct(values);
    if (saved) {
      setModalOpen(false);
      setModalProduct(undefined);
      setProductFilter('all');
    }
  };
  const refreshIndex = () =>
    loadIndex().catch((error) =>
      messageApi.error(error?.message || '刷新产品档案失败'),
    );
  const downloadDocument = (document) =>
    performApiAction(`product-center:document:download:${document.id}`, () =>
      api.downloadProductDocument(document.id, document.fileName),
    ).catch((error) => messageApi.error(error?.message || '产品资料下载失败'));
  if (pageLoading)
    return (
      <div className="product-center-loading">
        <Spin size="large" />
        <Text type="secondary">正在读取产品档案…</Text>
      </div>
    );
  return (
    <div className="product-center-page">
      {contextHolder}
      <div className="page-heading product-page-heading">
        <div>
          <Title level={2}>产品中心</Title>
          <Text className="muted">
            同步各家保险公司官网在售产品，核对正式资料，再生成知乎、小红书和公众号介绍。
          </Text>
        </div>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={Boolean(apiLoading['product-center:index'])}
          onClick={refreshIndex}
        >
          刷新
        </Button>
      </div>
      {pageError ? (
        <Alert
          type="error"
          showIcon
          message="产品档案加载失败"
          description={pageError}
          action={
            <Button size="small" onClick={refreshIndex}>
              重试
            </Button>
          }
        />
      ) : null}
      <ProductSyncPanel companies={meta.companies} api={api} performApiAction={performApiAction}
        apiLoading={apiLoading} onUpdated={refreshIndex} />
      <div className="product-center-summary">
        <Card>
          <Text>产品档案</Text>
          <strong>
            {products.length}
            <small> 个</small>
          </strong>
        </Card>
        <Card>
          <Text>待核对要点</Text>
          <strong>
            {products.reduce(
              (sum, item) => sum + item.pendingExtractionCount,
              0,
            )}
            <small> 组</small>
          </strong>
        </Card>
        <Card>
          <Text>待审核文案</Text>
          <strong>
            {products.reduce((sum, item) => sum + item.pendingDraftCount, 0)}
            <small> 篇</small>
          </strong>
        </Card>
      </div>
      <div className="product-center-layout">
        <Card
          className="product-catalog product-panel"
          title="产品档案"
          extra={
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => {
                setModalProduct(undefined);
                setModalOpen(true);
              }}
            >
              新建产品
            </Button>
          }
        >
          <div className="product-catalog-toolbar">
            <Input allowClear prefix={<SearchOutlined />} value={search}
              onChange={(event) => setSearch(event.target.value)} placeholder="搜索公司、产品名称或险种" />
            <Select aria-label="产品状态" value={productFilter} onChange={setProductFilter} options={[
              {value:'verified_on_sale',label:'官网核验在售'},
              {value:'review_required',label:'状态待复核'},
              {value:'all',label:'全部档案'},
            ]} />
          </div>
          <div className="product-catalog-list">
            {visibleProducts.length ? (
              visibleProducts.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  disabled={Boolean(apiLoading['product-center:workspace'])}
                  onClick={() => selectProduct(product.id)}
                  className={`product-catalog-item ${selectedProductId === product.id ? 'is-active' : ''}`}
                >
                  <span className="product-catalog-item-title">
                    <strong>{product.productName}</strong>
                    <Tag>{product.insuranceType}</Tag>
                  </span>
                  <small>
                    {product.company} · {product.sourceType==='official_sync'?'官网同步':'手动档案'}{product.officialProductCode ? ` · ${product.officialProductCode}` : ''} · {product.documentCount} 份资料
                  </small>
                  <span className="product-catalog-counts">
                    <span>{product.officialSaleStatus==='verified_on_sale'?'官网已核验在售':product.officialSaleStatus==='review_required'?'官网状态待复核':'未核验官网状态'}</span>
                    <span>{product.pendingDraftCount} 篇待审</span>
                  </span>
                </button>
              ))
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={search ? '没有符合条件的产品' : productFilter==='verified_on_sale' ? '暂无官网核验在售产品，可先同步保险公司目录' : '还没有符合条件的产品档案'}
              />
            )}
          </div>
        </Card>
        {!workspace ? (
          <Card className="product-panel product-workspace-empty">
            {selectedProductId ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="产品档案暂时无法读取"
                  description="请重新选择该产品，或刷新列表后重试。"
                />
                <Button
                  loading={Boolean(apiLoading['product-center:workspace'])}
                  onClick={() => selectProduct(selectedProductId)}
                >
                  重新加载
                </Button>
              </>
            ) : (
              <>
                <Empty description="创建手动档案，或从官网同步在售产品" />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setModalProduct(undefined);
                    setModalOpen(true);
                  }}
                >
                  新建产品档案
                </Button>
              </>
            )}
          </Card>
        ) : (
          <div className="product-workspace">
            <Card className="product-profile product-panel">
              <div className="product-profile-heading">
                <div>
                  <Text className="eyebrow">
                    {workspace.product.company} · {workspace.product.insuranceType}
                  </Text>
                  <Title level={3}>{workspace.product.productName}</Title>
                  <Text type="secondary">
                    {workspace.product.shortName || '未设置简称'}
                    {workspace.product.productVersion
                      ? ` · ${workspace.product.productVersion}`
                      : ''}
                  </Text>
                </div>
                <Space wrap>
                  <Tag
                    color={
                      workspace.product.status === '可用'
                        ? 'green'
                        : workspace.product.status === '已停用'
                          ? 'default'
                          : 'gold'
                    }
                  >
                    {workspace.product.status}
                  </Tag>
                  {workspace.product.sourceType==='official_sync' ? <Tag color={workspace.product.officialSaleStatus==='verified_on_sale'?'green':workspace.product.officialSaleStatus==='review_required'?'orange':'default'}>
                    {workspace.product.officialSaleStatus==='verified_on_sale'?'官网已核验在售':workspace.product.officialSaleStatus==='review_required'?'官网状态待复核':'官网状态未核验'}
                  </Tag> : <Tag>手动档案</Tag>}
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setModalProduct(workspace.product);
                      setModalOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除该产品档案？"
                    description={`将同时删除 ${workspace.documents.length} 份资料、${workspace.extractions.length} 组产品要点和 ${workspace.drafts.length} 篇旧文案。已有内容工作台引用时，系统会阻止删除。`}
                    okText="删除"
                    cancelText="取消"
                    cancelButtonProps={{ color: 'danger', variant: 'outlined' }}
                    okButtonProps={{
                      color: 'danger',
                      variant: 'outlined',
                      loading: Boolean(
                        apiLoading[
                          `product-center:delete:${selectedProductId}`
                        ],
                      ),
                    }}
                    onConfirm={deleteProduct}
                  >
                    <Button
                      size="small"
                      color="danger"
                      variant="outlined"
                      icon={<DeleteOutlined />}
                      loading={Boolean(
                        apiLoading[
                          `product-center:delete:${selectedProductId}`
                        ],
                      )}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2, md: 3 }}
                items={[
                  {
                    key: 'type',
                    label: '险种',
                    children: workspace.product.insuranceType,
                  },
                  {
                    key: 'date',
                    label: '适用日期',
                    children: formatProductDate(
                      workspace.product.effectiveDate,
                    ),
                  },
                  {
                    key: 'documents',
                    label: '产品资料',
                    children: `${workspace.documents.length} 份本地资料 · ${workspace.officialMaterials?.filter((item)=>item.isCurrent).length || 0} 个官网链接`,
                  },
                  ...(workspace.product.sourceType==='official_sync' ? [{
                    key:'official-code',label:'官网产品代码',children:workspace.product.officialProductCode || '官网未提供',
                  }] : []),
                  {
                    key: 'note',
                    label: '备注',
                    children: workspace.product.note || '无',
                  },
                ]}
              />
              {workspace.product.sourceType==='official_sync' ? <div className="product-official-source">
                <div className="product-official-source-heading">
                  <Text strong>官网来源与资料</Text>
                  <Text type="secondary">最近核验：{workspace.product.lastVerifiedAt ? new Date(workspace.product.lastVerifiedAt).toLocaleString('zh-CN',{hour12:false}) : '暂无'}</Text>
                </div>
                <Space wrap size={[8,6]}>
                  <Button size="small" type="link" href={workspace.product.saleStatusEvidenceUrl} target="_blank" rel="noreferrer">查看在售依据</Button>
                  {(workspace.officialMaterials || []).filter((item)=>item.isCurrent).map((item)=><Space key={item.id} size={2}>
                    <Button size="small" type="link" href={item.sourceUrl} target="_blank" rel="noreferrer">查看{item.label}</Button>
                    <Button size="small" icon={<DownloadOutlined />} loading={Boolean(apiLoading[`product-center:official-import:${item.id}`])}
                      onClick={()=>importOfficialMaterial(item.id)}>导入</Button>
                  </Space>)}
                </Space>
                <Text type="secondary">官网在售状态不代表代理渠道或所在地区可售；正式责任与费率以保险公司资料为准。</Text>
              </div> : null}
            </Card>
            <Tabs
              className="product-workspace-tabs"
              items={[
                {
                  key: 'materials',
                  label: '资料与要点',
                  children: (
                    <DocumentPanel
                      workspace={workspace}
                      activeDocumentId={activeDocumentId}
                      setActiveDocumentId={setActiveDocumentId}
                      uploadDocument={uploadDocument}
                      deleteDocument={deleteDocument}
                      downloadDocument={downloadDocument}
                      analyzeMaterials={analyzeMaterials}
                      updateExtraction={updateExtraction}
                      confirmExtraction={confirmExtraction}
                      apiLoading={apiLoading}
                    />
                  ),
                },
                {
                  key: 'copy',
                    label: '产品解读',
                  children: (
                    <ProductInterpretationWorkspace workspace={workspace} go={go} />
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>
      <ProductModal
        open={modalOpen}
        product={modalProduct}
        meta={meta}
        onCancel={() => {
          setModalOpen(false);
          setModalProduct(undefined);
        }}
        onSubmit={submitProduct}
        loading={Boolean(
          apiLoading[
            modalProduct ? 'product-center:update' : 'product-center:create'
          ],
        )}
      />
    </div>
  );
}
