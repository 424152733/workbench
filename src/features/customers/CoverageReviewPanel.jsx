import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Collapse, Descriptions, Empty, Form, InputNumber, Modal, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { DownloadOutlined, EditOutlined, FileSearchOutlined, PhoneOutlined } from '@ant-design/icons';
import { buildCoverageReview, COVERAGE_CATEGORIES, COVERAGE_PROFILE_LABELS, DEFAULT_COVERAGE_PROFILE, downloadCoverageReviewHtml } from './coverage-review.js';
import './coverage-review.css';

const {Text,Title}=Typography;
const PRIORITY_LABEL={high:'优先沟通',medium:'需要确认',low:'服务提醒'};
const PRIORITY_COLOR={high:'volcano',medium:'gold',low:'green'};
const CATEGORY_STATUS={current:['已有有效记录','green'],review:['有待核对记录','gold'],inactive:['有非在保记录','default'],none:['档案未查到','default']};
const RESPONSIBILITY_ONLY_LABEL={medical:'附带医疗责任',critical:'附带重疾给付',accident:'附带意外责任',life:'附带身故责任',annuity:'附带年金责任'};
const RESPONSIBILITY_ONLY_NOTE={
  medical:'保单仍按产品类型归类；此处只列合同中识别出的医疗责任。',
  critical:'保单仍按产品类型归类；此处只列合同中识别出的重疾给付责任。',
  accident:'保单仍按产品类型归类；此处只列合同中识别出的意外责任。',
  life:'产品仍按险种归类；此处只列合同中的身故给付，不代表该产品属于寿险。',
  annuity:'保单仍按产品类型归类；此处只列合同中识别出的年金责任。',
};
const formatMoney=(value)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
const statusLabel=(policy)=>policy.isProvisional?'合同待归档 · 状态待核':policy.status==='current'?'已核实有效':policy.status==='inactive'?'非在保 / 已终止':policy.verified && policy.contractStatus==='unknown'?'资料已核实 · 状态待确认':policy.verified && policy.contractStatus==='pending_effective'?'资料已核实 · 待生效':policy.verified?'资料已核实 · 状态需复核':'资料待核实';

export function CoverageReviewPanel({customer,api,apiLoading,performApiAction,onError,onSuccess,onFollowUp,onCustomerUpdated,contractRevision=0}) {
  const [review,setReview]=useState(null);
  const [profileOpen,setProfileOpen]=useState(false);
  const [form]=Form.useForm();
  const loadKey=`coverage-review:${customer.id}`;
  const saveKey=`coverage-profile:save:${customer.id}`;
  const policyRevision=(customer.policies || []).map((policy)=>`${policy.id}:${policy.state}:${policy.contractStatus}:${policy.expiryDate || ''}`).join('|');

  const refresh=async()=>{
    const result=await performApiAction(loadKey,()=>api.customerCoverageReview(customer.id));
    setReview(result);
    return result;
  };
  useEffect(()=>{
    let active=true;
    performApiAction(loadKey,()=>api.customerCoverageReview(customer.id))
      .then((result)=>{if(active)setReview(result);})
      .catch((error)=>{if(active)onError(error);});
    return ()=>{active=false;};
  },[customer.id,policyRevision,contractRevision]);

  const analysis=useMemo(()=>review ? buildCoverageReview({customer:review.customer,policies:review.policies,contracts:review.contracts,profile:review.profile}) : null,[review]);
  const openProfile=()=>{
    form.setFieldsValue({...DEFAULT_COVERAGE_PROFILE,...review?.profile,longTermGoals:review?.profile?.longTermGoals || []});
    setProfileOpen(true);
  };
  const saveProfile=async(values)=>{
    try {
      const result=await performApiAction(saveKey,()=>api.saveCustomerCoverageProfile(customer.id,values));
      setReview(result);
      setProfileOpen(false);
      onSuccess('家庭保障情况已保存，初筛已更新');
    } catch(error) { onError(error); }
  };
  const syncContractFacts=async(policy)=>{
    const key=`coverage-review:sync-contract:${customer.id}:${policy.contractId}`;
    try {
      const result=await performApiAction(key,()=>api.syncPolicyContractScheduleFacts(customer.id,policy.contractId));
      setReview(result.review);
      onCustomerUpdated?.(result.customer);
      onSuccess(`已从合同第 ${result.basicSumInsured.page} 页提取${result.basicSumInsured.label}：${result.basicSumInsured.amount}`);
    } catch(error) { onError(error); }
  };
  const scrollToContracts=()=>document.querySelector('.policy-contract-organizer')?.scrollIntoView({behavior:'smooth',block:'start'});

  if (!analysis) return <Card className="panel-card customer-detail-section coverage-review-card" title={<div><Title level={4}>保障检视</Title><Text className="muted">多份保单合并查看医疗、家庭兜底与年金安排</Text></div>}><div className="coverage-review-loading"><Spin /> 正在整理客户保障档案</div></Card>;

  const categoryStatus=(category)=>{
    if(category.currentCount)return CATEGORY_STATUS.current;
    if(category.reviewCount)return CATEGORY_STATUS.review;
    if(category.inactiveCount)return CATEGORY_STATUS.inactive;
    return CATEGORY_STATUS.none;
  };
  const categoryCards=analysis.categories.map((category)=>{
    const [label,color]=categoryStatus(category);
    const personGroups=category.policies.reduce((groups,policy)=>{
      const key=policy.insuredName || '被保险人待确认';
      const group=groups.find((item)=>item.name===key);
      if(group)group.policies.push(policy);else groups.push({name:key,policies:[policy]});
      return groups;
    },[]);
    const details=category.policies.length ? <div className="coverage-insured-groups">{personGroups.map((group)=><section className="coverage-insured-group" key={`${category.key}-${group.name}`}>
      <Text className="coverage-insured-heading">被保险人：{group.name}</Text><Collapse className="coverage-policy-detail-collapse" items={group.policies.map((policy)=>{
        const mainBenefits=policy.benefits.filter((benefit)=>benefit.kind!=='definition');
        const definitions=policy.benefits.filter((benefit)=>benefit.kind==='definition');
        const detailCount=mainBenefits.length+definitions.length;
        const summaryItems=[policy.company,policy.premium?`保费 ${policy.premium}`:'',policy.basicSumInsured?.amount?`${policy.basicSumInsured.label || '基本保额'} ${policy.basicSumInsured.amount}`:''].filter(Boolean);
        return {key:`${category.key}-${policy.id}`,label:<div className="coverage-policy-detail-head"><div className="coverage-policy-detail-title"><Text strong>{policy.name}</Text><Text className="coverage-policy-detail-meta">{summaryItems.join(' · ')}</Text></div><Space wrap size={[6,4]}><Text className="coverage-count">{detailCount} 项条款要点{definitions.length?` · ${definitions.length} 项疾病定义`:''}</Text><Tag color={policy.status==='current'?'green':policy.status==='review'?(policy.verified?'blue':'gold'):'default'}>{statusLabel(policy)}</Tag></Space></div>,children:<div className="coverage-policy-main">
            {policy.responsibilityOnly ? <div className="coverage-responsibility-note"><Tag color="blue">{RESPONSIBILITY_ONLY_LABEL[category.key] || '附带责任'}</Tag><Text>{RESPONSIBILITY_ONLY_NOTE[category.key] || '保单仍按产品类型归类；此处只展示对应合同责任。'}</Text></div> : null}
            {policy.evidenceSource==='original' ? <Text className="coverage-responsibility-source">责任依据：上传的原合同；保单效力和实际缴费仍需核对。</Text> : null}
            {!policy.responsibilityOnly && policy.basicSumInsured?.amount ? <div className="coverage-basic-sum"><strong>{policy.basicSumInsured.label || '基本保险金额'}</strong><span>{policy.basicSumInsured.amount}</span>{policy.basicSumInsured.page ? <small>原 PDF 第 {policy.basicSumInsured.page} 页</small> : null}</div> : null}
            {!policy.responsibilityOnly && policy.coverageSummary ? <Text className="coverage-policy-summary">{policy.coverageSummary}</Text> : null}
            {!policy.responsibilityOnly && policy.premium ? <Text className="schedule-meta">缴费：{policy.premium}</Text> : null}
            {policy.status==='review' && policy.expiryDate ? <Text className="coverage-responsibility-source">原合同保险期间至 {policy.expiryDate}；后续续保和当前效力需另行核对。</Text> : null}
            {mainBenefits.length ? <div className="coverage-benefit-list">{mainBenefits.map((benefit,index)=><div className="coverage-benefit-row" key={`${benefit.name}-${benefit.page}-${index}`}>
              <span>{benefit.name || '保障责任'}</span>{benefit.amount ? <strong>{benefit.amount}</strong> : null}{benefit.paymentMethod ? <small>{benefit.paymentMethod}</small> : null}
              {benefit.pages?.length ? <small>原 PDF 第 {benefit.pages.join('、')} 页</small> : benefit.page ? <small>原 PDF 第 {benefit.page} 页</small> : null}
              {benefit.note ? <small className="coverage-benefit-note">{benefit.note}</small> : null}
              {benefit.unclassified ? <small className="coverage-benefit-unclassified">合同其他权益 · 暂未自动归类</small> : null}
              {benefit.summary ? <small className="coverage-benefit-detail">{benefit.summary}</small> : null}
              {benefit.conditions ? <small className="coverage-benefit-detail"><b>给付条件：</b>{benefit.conditions}</small> : null}
            </div>)}</div> : null}
            {definitions.length ? <div className="coverage-definition-summary"><Text strong>疾病定义范围 · {definitions.length} 项</Text><div className="coverage-benefit-list">{definitions.map((benefit,index)=><div className="coverage-benefit-row" key={`definition-${benefit.name}-${benefit.page}-${index}`}>
              <span>{benefit.name || '疾病定义'}</span>{benefit.pages?.length ? <small>原 PDF 第 {benefit.pages.join('、')} 页</small> : benefit.page ? <small>原 PDF 第 {benefit.page} 页</small> : null}
              {benefit.summary ? <small className="coverage-benefit-detail">{benefit.summary}</small> : null}
              {benefit.conditions ? <small className="coverage-benefit-detail"><b>认定条件：</b>{benefit.conditions}</small> : null}
            </div>)}</div></div> : null}
            {!policy.responsibilityOnly && policy.contractId && !policy.basicSumInsured?.amount ? <Button size="small" loading={Boolean(apiLoading[`coverage-review:sync-contract:${customer.id}:${policy.contractId}`])} onClick={()=>syncContractFacts(policy)}>从原合同补提基本保额</Button> : null}
          </div>};
      })} /></section>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前档案未查到相关保单；请确认系统外保单和单位福利。" />;
    return {key:category.key,label:category.label,children:<div className="coverage-category-content">{details}<Text className="coverage-category-hint">{category.description} · 不同责任金额不合并</Text></div>,extra:<Space size={6}><Text className="coverage-count">{category.currentCount} 份有效 · {category.reviewCount} 份待核</Text><Tag color={color}>{label}</Tag></Space>};
  });
  const unsavedCount=analysis.metrics.unfiledContractCount;

  return <>
    <Card className="panel-card customer-detail-section coverage-review-card" title={<div><Title level={4}>保障检视</Title><Text className="muted">按已登记保单、上传合同和客户情况，整理服务重点</Text></div>}
      extra={<Space wrap><Button size="small" icon={<EditOutlined />} onClick={openProfile}>补充家庭情况</Button><Button size="small" icon={<DownloadOutlined />} disabled={!analysis.metrics.policyCount} onClick={()=>downloadCoverageReviewHtml(analysis)}>下载摘要</Button></Space>}>
      <Alert className="coverage-review-scope" type="info" showIcon message="初筛依据当前档案，帮助找到下一步服务重点" description="未录入不等于没有保障。建议先核对系统外保单、医保和单位福利，再与客户讨论需求。具体责任以正式合同为准。" />
      <Row gutter={[10,10]} className="coverage-review-metrics">
        <Col xs={24} md={12}><div className="coverage-metric"><span>保单档案</span><strong>{analysis.metrics.policyCount} 份</strong><small>{analysis.metrics.currentPolicyCount} 份已核实有效 · {analysis.metrics.pendingPolicyCount} 份待核对{analysis.metrics.inactivePolicyCount ? ` · ${analysis.metrics.inactivePolicyCount} 份非在保` : ''}{analysis.metrics.provisionalContractCount ? ` · 另有 ${analysis.metrics.provisionalContractCount} 份合同待归档` : ''}</small></div></Col>
        <Col xs={24} md={12}><div className="coverage-metric"><span>服务建议</span><strong>{analysis.recommendations.length} 项</strong><small>{analysis.metrics.policyCount ? '基于已登记保单和客户资料初筛' : '无已登记保单时不生成服务重点'}</small></div></Col>
      </Row>

      {unsavedCount ? <Alert className="coverage-review-unsaved" type="warning" showIcon message={`${unsavedCount} 份合同尚未归档；从原件识别的责任仅列为待核，不代表当前有效保障`} action={<Button size="small" onClick={scrollToContracts}>去整理合同</Button>} /> : null}

      <div className="coverage-review-section-head"><div><Title level={5}>初筛出的服务重点</Title><Text className="muted">把保障问题变成可核对、可跟进的客户沟通</Text></div></div>
      {!analysis.metrics.policyCount ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={analysis.metrics.provisionalContractCount ? '暂无已登记保单，待归档合同整理后再生成服务重点。' : '暂无已登记保单，服务重点已清空；新增保单后会重新初筛。'} /> : analysis.recommendations.length ? <div className="coverage-recommendation-grid">{analysis.recommendations.map((item,index)=><article className={`coverage-recommendation is-${item.priority}`} key={`${item.kind}-${index}`}>
        <div className="coverage-recommendation-head"><Tag color={PRIORITY_COLOR[item.priority]}>{PRIORITY_LABEL[item.priority]}</Tag><Text className="coverage-recommendation-kind">{item.kind}</Text></div>
        <Text strong>{item.title}</Text><Text className="coverage-recommendation-reason">{item.reason}</Text>
        <div className="coverage-recommendation-next"><b>下一步</b><span>{item.next}</span></div>
        {customer.contact!=='已拒绝联系' && onFollowUp ? <Button size="small" icon={<PhoneOutlined />} onClick={()=>onFollowUp(customer,null,{title:item.title,note:`保障检视建议：${item.next}`})}>安排跟进</Button> : null}
      </article>)}</div> : <Alert type="success" showIcon message="当前资料暂未触发明显的服务提醒" description="这只是对已录入信息的初筛，可在客户情况变化或补充新保单后重新查看。" />}

      <div className="coverage-review-section-head coverage-review-category-heading"><div><Title level={5}>关键金额汇总</Title><Text className="muted">只汇总口径明确的年交保费和重疾基本保额；其他责任按类型核对</Text></div></div>
      <div className="coverage-overview-totals">
        <article className="coverage-overview-total"><span>档案识别年交保费（含待核）</span><strong>{formatMoney(analysis.metrics.annualPremiumRecognizedTotal)}</strong><small>已核实有效 {formatMoney(analysis.metrics.annualPremiumTotal)} · 待核对 {formatMoney(analysis.metrics.pendingAnnualPremiumTotal)}</small><small>{analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount ? `${analysis.metrics.unknownPremiumCount+analysis.metrics.pendingUnknownPremiumCount} 份保单无法可靠换算成年交，未计入。` : '仅统计能明确换算成年缴的记录。'}</small></article>
        <article className="coverage-overview-total"><span>已识别重疾基本保额（含待核）</span><strong>{analysis.metrics.criticalRecognizedBasicSumInsuredCount ? formatMoney(analysis.metrics.criticalRecognizedBasicSumInsuredTotal) : '待核实'}</strong><small>已确认有效 {formatMoney(analysis.metrics.criticalCurrentBasicSumInsuredTotal)} · 待核对 {formatMoney(analysis.metrics.criticalPendingBasicSumInsuredTotal)}</small><small>{analysis.metrics.criticalRecognizedBasicSumInsuredCount ? `共识别 ${analysis.metrics.criticalRecognizedBasicSumInsuredCount} 份可读取金额的重疾类保单。` : '暂未识别到可读取金额的重疾类保单。'}{analysis.metrics.criticalCurrentBasicSumInsuredUnknownCount ? `另有 ${analysis.metrics.criticalCurrentBasicSumInsuredUnknownCount} 份有效保单金额待补。` : ''}</small></article>
      </div>
      <div className="coverage-overview-total-note"><strong>金额口径</strong><span>医疗年度限额、重疾保额、意外与身故责任、年金领取分别核对，不合并成一个总保额；详情以合同为准。</span></div>
      <div className="coverage-review-section-head coverage-review-category-heading"><div><Title level={5}>按保障类型查看明细</Title><Text className="muted">先展开单份保单，再查看责任金额、给付条件和疾病定义</Text></div></div>
      <Collapse className="coverage-category-collapse" items={categoryCards} defaultActiveKey={analysis.categories.filter((category)=>category.policies.length).map((category)=>category.key)} />
      <div className="coverage-review-footnote">保障金额、保费和状态仅在资料能够确认时汇总。年金领取、现金价值、分红演示和身故责任分开呈现；非保证利益不作为确定保障。</div>
    </Card>

    <Modal title="补充客户保障情况" open={profileOpen} onCancel={()=>setProfileOpen(false)} onOk={()=>form.submit()} okText="保存并重新初筛" cancelText="取消" confirmLoading={Boolean(apiLoading[saveKey])} destroyOnHidden>
      <Alert className="coverage-profile-note" type="info" showIcon message="只填写判断服务重点需要的信息" description="不清楚的项目可保持待确认；家庭具体保障仍需逐份核对被保险人和合同责任。" />
      <Form form={form} layout="vertical" initialValues={{...DEFAULT_COVERAGE_PROFILE}} onFinish={saveProfile}>
        <Form.Item name="medicalInsuranceStatus" label="基本医保"><Select options={Object.entries(COVERAGE_PROFILE_LABELS.medicalInsuranceStatus).map(([value,label])=>({value,label}))} /></Form.Item>
        <Form.Item name="employerMedicalStatus" label="单位补充医疗"><Select options={Object.entries(COVERAGE_PROFILE_LABELS.employerMedicalStatus).map(([value,label])=>({value,label}))} /></Form.Item>
        <Form.Item name="incomeResponsibility" label="家庭收入责任"><Select options={Object.entries(COVERAGE_PROFILE_LABELS.incomeResponsibility).map(([value,label])=>({value,label}))} /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item name="dependentCount" label="经济依赖人数"><InputNumber min={0} max={20} precision={0} placeholder="未知可留空" style={{width:'100%'}} /></Form.Item></Col><Col span={12}><Form.Item name="mortgageStatus" label="是否有房贷"><Select options={Object.entries(COVERAGE_PROFILE_LABELS.mortgageStatus).map(([value,label])=>({value,label}))} /></Form.Item></Col></Row>
        <Form.Item noStyle shouldUpdate={(before,after)=>before.mortgageStatus!==after.mortgageStatus}>{({getFieldValue})=>getFieldValue('mortgageStatus')==='yes' ? <Form.Item name="mortgageBand" label="剩余房贷区间"><Select options={Object.entries(COVERAGE_PROFILE_LABELS.mortgageBand).filter(([value])=>value!=='unknown').map(([value,label])=>({value,label}))} /></Form.Item> : null}</Form.Item>
        <Form.Item name="longTermGoals" label="长期现金流目标"><Checkbox.Group options={[{value:'retirement',label:'养老'},{value:'education',label:'子女教育'},{value:'other',label:'其他长期目标'}]} /></Form.Item>
      </Form>
    </Modal>
  </>;
}
