import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Empty, Form, Input, Modal, Popconfirm, Space, Spin, Tag, Typography, Upload } from 'antd';
import { DeleteOutlined, DownloadOutlined, FilePdfOutlined, FileSearchOutlined, UploadOutlined } from '@ant-design/icons';
import { extractPolicyContractDates } from './policy-contract-dates.js';

const {Text,Title} = Typography;
const formatBytes = (value) => value > 1024*1024 ? `${(value/1024/1024).toFixed(1)} MB` : `${Math.max(1,Math.round(value/1024))} KB`;
const statusColor = (status) => status==='已整理' || status==='已归档' ? 'green' : status==='部分完成' ? 'orange' : 'default';

function prepareBenefitsForDisplay(benefits=[],policy={}) {
  const medical=/医疗|住院/.test(`${policy.insuranceType || ''} ${policy.productName || ''}`);
  const generalLimit=medical
    ? benefits.find((item)=>item.name?.trim()==='一般医疗费用保险金' && item.amount)?.amount
    : '';
  const sharedMedicalBenefits=new Set(['住院医疗费用保险金','住院前后门急诊医疗费用保险金']);
  return benefits
    .map((item)=>medical && generalLimit && sharedMedicalBenefits.has(item.name?.trim())
      ? {...item,sharedLimit:generalLimit}
      : item);
}

export function PolicyContractOrganizer({customer,api,apiLoading,performApiAction,onError,onSuccess,onCustomerUpdated,onContractsChanged}) {
  const [documents,setDocuments] = useState([]);
  const [activeId,setActiveId] = useState(null);
  const [selectedFile,setSelectedFile] = useState(null);
  const [consent,setConsent] = useState(false);
  const [saveOpen,setSaveOpen] = useState(false);
  const [policyForm] = Form.useForm();
  const activeDocument = documents.find((item)=>item.id===activeId) || documents[0] || null;
  const loadKey = `policy-contracts:list:${customer.id}`;
  const uploadKey = `policy-contracts:upload:${customer.id}`;
  const analyzeKey = `policy-contracts:analyze:${customer.id}:${activeDocument?.id}`;
  const saveKey = `policy-contracts:save:${customer.id}:${activeDocument?.id}`;
  const exportKey = `policy-contracts:export:${customer.id}`;
  const loading = Boolean(apiLoading[loadKey]);
  const hasExportableData = Boolean(customer.policies?.length || documents.length);

  const refresh = async () => {
    const result = await performApiAction(loadKey,()=>api.policyContracts(customer.id));
    setDocuments(result);
    setActiveId((current)=>result.some((item)=>item.id===current) ? current : result[0]?.id || null);
    return result;
  };

  useEffect(()=>{
    let active=true;
    performApiAction(loadKey,()=>api.policyContracts(customer.id))
      .then((result)=>{if(active){setDocuments(result);setActiveId((current)=>result.some((item)=>item.id===current)?current:result[0]?.id || null);}})
      .catch((error)=>{if(active)onError(error);});
    return ()=>{active=false;};
  },[customer.id]);

  const upload = async () => {
    if (!selectedFile) return;
    if (!/\.pdf$/i.test(selectedFile.name)) { onError(new Error('请选择 PDF 合同')); return; }
    if (selectedFile.size>25*1024*1024) { onError(new Error('PDF 不能超过 25 MB')); return; }
    try {
      const result=await performApiAction(uploadKey,()=>api.uploadPolicyContract(customer.id,selectedFile));
      setSelectedFile(null);
      setConsent(false);
      await refresh();
      setActiveId(result.id);
      onContractsChanged?.();
      onSuccess(result.parseStatus==='needs_ocr' ? '已保存文件；本机 OCR 未能识别文字' : '合同已在本地解析，AI 尚未调用');
    } catch(error) { onError(error); }
  };

  const analyze = async () => {
    if (!activeDocument || !consent) return;
    try {
      const result=await performApiAction(analyzeKey,()=>api.analyzePolicyContract(customer.id,activeDocument.id,true));
      setDocuments((old)=>old.map((item)=>item.id===result.id?result:item));
      onContractsChanged?.();
      onSuccess(result.analysisStatus==='已整理' ? `合同整理完成，AI 实际使用约 ${result.usage.totalTokens} tokens` : '已返回部分结果；未完成的片段可再次整理');
    } catch(error) { onError(error); }
  };

  const removeDocument = async (document) => {
    try {
      await performApiAction(`policy-contracts:delete:${document.id}`,()=>api.deletePolicyContract(customer.id,document.id));
      setDocuments((old)=>old.filter((item)=>item.id!==document.id));
      setActiveId((current)=>current===document.id?null:current);
      onContractsChanged?.();
      onSuccess('合同及整理结果已删除');
    } catch(error) { onError(error); }
  };

  const exportOrganizer = async () => {
    const pending=documents.filter((document)=>!['已整理','已归档'].includes(document.analysisStatus) ||
      Number(document.extraction?.schemaVersion || 0)<10 || document.extraction?.completeness?.complete!==true);
    if (pending.length) { onError(new Error(`还有 ${pending.length} 份合同未完成最新版 AI 整理，请先逐份整理再导出。`)); return; }
    try {
      await performApiAction(exportKey,()=>api.exportPolicyOrganizer(customer.id,customer.name,true));
      onSuccess('含 AI 保障诊断的保单整理表已导出');
    } catch(error) { onError(error); }
  };

  const openSave = () => {
    const extracted=activeDocument?.extraction?.policy || {};
    const contractDates=extractPolicyContractDates(extracted);
    policyForm.setFieldsValue({
      company:extracted.company || '',name:extracted.productName || '',type:extracted.insuranceType || '',
      premium:extracted.premium || '',holderName:extracted.holderName || '',insuredName:extracted.insuredName || '',
      coverageSummary:activeDocument?.extraction?.coverageSummary || '',
      effectiveDate:contractDates.effectiveDate,expiry:contractDates.expiryDate,nextPaymentDate:contractDates.nextPaymentDate,
    });
    setSaveOpen(true);
  };

  const savePolicy = async (values) => {
    try {
      const result=await performApiAction(saveKey,()=>api.savePolicyContractAsPolicy(customer.id,activeDocument.id,{
        ...values,effectiveDate:values.effectiveDate || null,expiry:values.expiry || null,nextPaymentDate:values.nextPaymentDate || null,
      }));
      onCustomerUpdated?.(result.customer);
      setDocuments((old)=>old.map((item)=>item.id===activeDocument.id?{...item,analysisStatus:'已归档',policyId:result.policy?.id}:item));
      onContractsChanged?.();
      setSaveOpen(false);
      onSuccess('已保存为待核实保单；请再对照原合同确认');
    } catch(error) { onError(error); }
  };

  const result=activeDocument?.extraction;
  const needsFullTextUpdate=Boolean(activeDocument) && (
    Number(activeDocument.parserVersion || 0)<4 || (Boolean(result) && Number(result.schemaVersion || 0)<10)
  );
  const contractDates=extractPolicyContractDates(result?.policy || {});
  const warnings=activeDocument?.warnings || [];
  const benefits=prepareBenefitsForDisplay(result?.benefits || [],result?.policy || {});

  return <Card className="panel-card customer-detail-section policy-contract-organizer"
    title={<div><Title level={4}>保单合同整理</Title><Text className="muted">上传客户提供的 PDF，整理保障责任与需要核对的信息。</Text></div>}>
    <Alert type="info" showIcon message="本地逐页提取文字，AI 逐段整理整份合同" description="合同原件保存在本地工作台。图片页面先由本机 OCR 识别，再遮盖常见身份信息；取得客户授权后，合同文字按页分段发送至当前配置的 AI 服务。" />
    <div className="policy-contract-upload-row">
      <div className="policy-contract-upload-actions">
        <Upload accept=".pdf,application/pdf" maxCount={1} fileList={selectedFile?[{uid:'selected-contract',name:selectedFile.name,status:'done'}]:[]}
          beforeUpload={(file)=>{setSelectedFile(file);return false;}} onRemove={()=>{setSelectedFile(null);return true;}}>
          <Button icon={<UploadOutlined />}>选择 PDF 合同</Button>
        </Upload>
        <Button type="primary" loading={Boolean(apiLoading[uploadKey])} disabled={!selectedFile} onClick={upload}>上传并提取文本</Button>
        <Button icon={<DownloadOutlined />} loading={Boolean(apiLoading[exportKey])} disabled={!hasExportableData} onClick={exportOrganizer}>AI 诊断并导出 Excel</Button>
      </div>
      <Text className="muted">最大 25 MB、300 页；文字上限 120,000 字。图片页面在本机识别；全部合同整理完成后可导出，诊断会另行调用 AI。</Text>
    </div>

    {loading ? <div className="policy-contract-loading"><Spin /> 正在读取合同档案</div> : documents.length ? <div className="policy-contract-list">
      {documents.map((document)=><button type="button" className={`policy-contract-row ${activeDocument?.id===document.id?'is-active':''}`} key={document.id} onClick={()=>{setActiveId(document.id);setConsent(false);}}>
        <FilePdfOutlined /><span className="policy-contract-row-copy"><strong>{document.fileName}</strong><small>{document.pageCount ?? '页数未知'} 页 · {formatBytes(document.byteSize)}</small></span>
        <Tag color={statusColor(document.analysisStatus)}>{document.analysisStatus}</Tag>
      </button>)}
    </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有上传保单合同" />}

    {activeDocument ? <div className="policy-contract-active">
      <div className="policy-contract-active-head"><div className="policy-contract-active-copy"><Text strong title={activeDocument.fileName}>{activeDocument.fileName}</Text><Text className="schedule-meta">{activeDocument.pageCount ?? '页数未知'} 页{needsFullTextUpdate?' · 旧版整理结果，更新时将重读全部可提取文字':` · AI 整理 ${activeDocument.selectedPageCount} 页 · ${activeDocument.selectedChars.toLocaleString()} 字 · 预计输入约 ${activeDocument.estimatedInputTokens.toLocaleString()} tokens · ${activeDocument.chunkCount} 个小段`}</Text></div>
        <Space className="policy-contract-head-actions" size={8}>
          <Button size="small" icon={<FileSearchOutlined />} onClick={()=>window.open(api.policyContractFileUrl(customer.id,activeDocument.id),'_blank','noopener,noreferrer')}>下载原合同</Button>
          <Popconfirm title="删除这份合同和整理结果？" description="删除后不能从工作台恢复。" okText="删除" cancelText="取消" onConfirm={()=>removeDocument(activeDocument)}>
            <Button size="small" danger icon={<DeleteOutlined />} loading={Boolean(apiLoading[`policy-contracts:delete:${activeDocument.id}`])}>删除</Button>
          </Popconfirm>
        </Space>
      </div>
      {!activeDocument.policyId && activeDocument.localFacts?.basicSumInsured ? <Alert className="policy-contract-warning" type="success" showIcon message={`${activeDocument.localFacts.basicSumInsured.label}：${activeDocument.localFacts.basicSumInsured.amount}（合同第 ${activeDocument.localFacts.basicSumInsured.page} 页）`} description="此金额由本地规则读取合同明确字段，没有额外调用 AI。" /> : null}
      {!activeDocument.policyId ? warnings.map((warning,index)=><Alert key={`${activeDocument.id}-warning-${index}`} className="policy-contract-warning" type="warning" showIcon message={warning} />) : null}
      {activeDocument.parseStatus==='needs_ocr' ? <Alert type="warning" showIcon message="合同图片文字尚未识别" description="点击下方整理时会先在本机运行 OCR；仍无法读取时请上传更清晰的 PDF。" /> : null}
      {activeDocument.policyId ? <>
        <Alert className="policy-contract-warning" type="success" showIcon message="这份合同已归档到客户保单档案" description="保单状态、关键金额和分类责任统一在上方“保障检视”中查看；这里保留原合同与完整整理结果。" />
        {needsFullTextUpdate || activeDocument.analysisStatus==='部分完成' ? <>
          {needsFullTextUpdate ? <Alert type="info" showIcon message="旧结果可能漏项，建议按新流程重新整理" description="更新时会从本机原合同重新提取所有可提取页面的文字（含本机 OCR），进行常见身份信息遮盖后分段发送给 AI；单份合同上限为 120,000 字、16 个基础分段，超出会提示拆分，不会静默截掉后半部分。" /> : null}
          <div className="policy-contract-actions"><Checkbox checked={consent} onChange={(event)=>setConsent(event.target.checked)}>我已取得客户授权，同意将整份合同可读取文字的脱敏分段发送至当前配置的 AI 服务。</Checkbox><Button loading={Boolean(apiLoading[analyzeKey])} disabled={!consent} onClick={analyze}>{needsFullTextUpdate?'重新整理整份合同':'继续整理未完成部分'}</Button><Text className="muted">此操作会重新调用 AI；导出 Excel 不调用保单整理模型。</Text></div>
        </> : null}
      </> : <>
        <Alert className="policy-contract-scope" type="info" showIcon message="本次输入范围" description={needsFullTextUpdate
          ? `旧版文本筛选计划会在整理时重建。AI 将接收合同所有可提取页面的脱敏文字（含本机 OCR）分段，最多 120,000 字、16 个基础请求；超出上限会提示拆分，不会只处理前半份。`
          : `AI 将接收合同所有可提取页面的脱敏文字（含本机 OCR）：${activeDocument.selectedPageCount}/${activeDocument.pageCount} 页，约 ${activeDocument.selectedChars.toLocaleString()} 字，预计输入约 ${activeDocument.estimatedInputTokens.toLocaleString()} tokens、${activeDocument.chunkCount} 个分段；每段输出上限为 2,000 tokens，超限会拆小重试。`} />
        <Checkbox checked={consent} onChange={(event)=>setConsent(event.target.checked)}>我已取得客户授权，同意将整份合同可读取文字的脱敏分段发送至当前配置的 AI 服务。</Checkbox>
        <div className="policy-contract-actions"><Button type="primary" loading={Boolean(apiLoading[analyzeKey])} disabled={!consent || (!needsFullTextUpdate && activeDocument.analysisStatus==='已整理' && Number(result?.schemaVersion || 0)>=10)} onClick={analyze}>{activeDocument.analysisStatus==='部分完成'&&!needsFullTextUpdate?'继续整理未完成部分':needsFullTextUpdate&&result?'重新整理整份合同':activeDocument.analysisStatus==='已整理'?'更新整理结果':'开始 AI 整理'}</Button><Text className="muted">开始后按页码分段读取全部可提取文字；完成后显示服务实际用量。</Text></div>
      </>}

      {result ? <Collapse className="policy-contract-result-collapse" key={`contract-result-${activeDocument.id}-${activeDocument.policyId?'archived':'review'}`}
        defaultActiveKey={activeDocument.policyId?[]:['result']} items={[{key:'result',label:<Space wrap><Text strong>{activeDocument.policyId?'查看合同整理详情':'整理结果'}</Text><Tag color={statusColor(activeDocument.analysisStatus)}>{activeDocument.policyId?'已归档到已有保单':activeDocument.analysisStatus}</Tag>{activeDocument.usage.totalTokens ? <Text className="schedule-meta">实际 {activeDocument.usage.totalTokens.toLocaleString()} tokens · {activeDocument.usage.model}</Text> : null}</Space>,children:<div className="policy-contract-result">
        {!result.completeness?.complete ? <Alert type="warning" showIcon message={`部分结果：已完成 ${result.completeness?.completedChunks || 0}/${result.completeness?.totalChunks || activeDocument.chunkCount} 段；请修复后继续整理，或对照原合同补充。`} /> : null}
        {activeDocument.chunkFailures?.map((failure)=><Alert key={`chunk-failure-${failure.index}`} type="error" showIcon message={`第 ${failure.index} 段整理失败`} description={failure.message} />)}
        <Descriptions size="small" column={{xs:1,sm:2,lg:3}}>
          <Descriptions.Item label="保险公司">{result.policy?.company || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="产品名称">{result.policy?.productName || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="保障类型">{result.policy?.insuranceType || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="基本保险金额">{result.policy?.basicSumInsured ? `${result.policy.basicSumInsured.amount}（第 ${result.policy.basicSumInsured.page} 页）` : '合同未明确识别'}</Descriptions.Item>
          <Descriptions.Item label="保费">{result.policy?.premium || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="缴费期间">{result.policy?.paymentTerm || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="保障期间">{result.policy?.coveragePeriod || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="生效日期">{contractDates.effectiveDate || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="固定到期日">{contractDates.expiryDate || (contractDates.lifetimeCoverage?'终身，无固定日期':'未识别')}</Descriptions.Item>
          <Descriptions.Item label="下次缴费日">{contractDates.nextPaymentDate || '合同未载明，需核对缴费记录'}</Descriptions.Item>
        </Descriptions>
        <Alert className="policy-contract-claim-summary" type={result.policy?.claimSummary?'info':'warning'} showIcon message="保险金计算与给付方式" description={result.policy?.claimSummary || (Number(result.schemaVersion || 0)<2?'当前结果尚未包含此项总结；请确认授权后点击“更新整理结果”。':'未能从已筛选的合同片段中归纳出统一规则，请查看下方各项保险金及给付方式。')} />
        <Title level={5}>保障责任与权益</Title>
        {benefits.length ? <div className="policy-contract-benefits">{benefits.map((item,index)=><div className="policy-contract-benefit" key={`${item.name}-${item.page}-${index}`}>
          <div className="policy-contract-benefit-head"><Text strong>{item.name || '保障责任'}</Text><Tag color="blue">第 {item.page || '待核对'} 页</Tag></div>
          {item.amount ? <Text className="policy-contract-benefit-amount">保险金：{item.amount}</Text> : null}
          {item.sharedLimit ? <Text className="policy-contract-benefit-shared-limit">共用一般医疗年度限额：{item.sharedLimit}（按保障计划适用，不是单项额外额度）</Text> : null}
          {item.paymentMethod ? <Text className="muted">给付方式：{item.paymentMethod}</Text> : null}
          {item.summary ? <Text>{item.summary}</Text> : null}{item.conditions ? <Text className="muted">条件：{item.conditions}</Text> : null}
          {item.scenarios?.some((scenario)=>scenario.evidenceVerified) ? <div className="policy-contract-scenarios">
            {item.scenarios.filter((scenario)=>scenario.evidenceVerified).map((scenario,scenarioIndex)=><div className="policy-contract-scenario" key={`${scenario.trigger}-${scenario.page}-${scenarioIndex}`}>
              <strong>{scenario.trigger || '合同约定情形'}</strong><span>{scenario.amount || '金额待核对'}</span>
              {[scenario.limit,scenario.conditions,scenario.relation].filter(Boolean).map((detail,detailIndex)=><small key={detailIndex}>{detail}</small>)}
              {scenario.page ? <small>合同第 {scenario.page} 页</small> : null}
            </div>)}
          </div> : null}
        </div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有提取到明确的保障责任；请检查合同或重新整理" />}
        {!activeDocument.policyId ? <><Title level={5}>保存前核对</Title><Alert className="policy-contract-suggestion" type="info" showIcon message="核对产品信息、被保险人、保障责任和缴费情况后，再保存到客户保单档案；保存后会纳入整体保障检视。" /></> : <Alert className="policy-contract-suggestion" type="success" showIcon message="已归档到已有保单；保障汇总与分类明细见上方“保障检视”。" />}
        {result.uncertainties?.length ? <div className="policy-contract-uncertainties"><Text strong>还需核对</Text>{result.uncertainties.map((item,index)=><Text key={`uncertainty-${index}`}>· {item}</Text>)}</div> : null}
        <Text className="policy-contract-disclaimer">以上仅整理合同文字和当前已核实档案提示，不代表完整保障评估、理赔结论或购买建议；最终以正式保险合同及保险公司确认为准。</Text>
        {!activeDocument.policyId ? <Button type="primary" onClick={openSave}>核对后保存为待核实保单</Button> : null}
      </div>}]} /> : null}
    </div> : null}

    <Modal title="核对合同信息并保存保单" open={saveOpen} onCancel={()=>setSaveOpen(false)} onOk={()=>policyForm.submit()}
      okText="保存为待核实保单" confirmLoading={Boolean(apiLoading[saveKey])} destroyOnHidden>
      <Alert className="policy-contract-save-alert" type="warning" showIcon message="保存后会进入客户保单档案，状态为“待核实”" description="识别到的合同日期会预填，请逐项对照原合同。终身保障没有固定到期日；下次缴费日要结合实际缴费记录，不能只按缴费年限推算。" />
      <Form form={policyForm} layout="vertical" onFinish={savePolicy}>
        <Form.Item name="company" label="保险公司" rules={[{required:true,message:'请填写保险公司'}]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="name" label="产品 / 保单名称" rules={[{required:true,message:'请填写产品或保单名称'}]}><Input maxLength={160} /></Form.Item>
        <Form.Item name="type" label="保障类型" rules={[{required:true,message:'请填写保障类型'}]}><Input maxLength={80} /></Form.Item>
        <Form.Item name="holderName" label="投保人（可选）"><Input maxLength={80} placeholder="合同中的投保人" /></Form.Item>
        <Form.Item name="insuredName" label="被保险人（可选）"><Input maxLength={80} placeholder="保障实际属于谁；不确定可先留空" /></Form.Item>
        <Form.Item name="premium" label="保费"><Input maxLength={100} /></Form.Item>
        <Form.Item name="coverageSummary" label="保障摘要"><Input.TextArea rows={3} maxLength={700} showCount /></Form.Item>
        <Form.Item name="effectiveDate" label="生效日期" extra={contractDates.effectiveDate?'已按合同保障期间预填，请核对。':'请对照合同填写明确的生效日期。'}><Input placeholder="YYYY-MM-DD" /></Form.Item>
        <Form.Item name="expiry" label="固定到期日" extra={contractDates.lifetimeCoverage?'合同约定终身保障，无需填写固定到期日。':'只在合同载明固定日期时填写。'}><Input placeholder={contractDates.lifetimeCoverage?'终身保障留空':'YYYY-MM-DD'} /></Form.Item>
        <Form.Item name="nextPaymentDate" label="下次缴费日" extra={contractDates.nextPaymentDate?'已从合同提取，请核对。':'合同未载明当前下一次缴费日，需结合缴费记录确认。'}><Input placeholder="YYYY-MM-DD" /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
