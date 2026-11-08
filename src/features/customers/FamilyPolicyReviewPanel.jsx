import { useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Form, Modal, Popconfirm, Select, Space, Spin, Tag, Typography, Upload } from 'antd';
import { DownloadOutlined, FilePdfOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import './family-policy-review.css';

const {Text,Title}=Typography;
const currency=(value)=>value==null?'—':`¥${Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const statusLabel={current:'已确认有效',pending:'待核对',inactive:'非在保 / 已过期'};
const statusColor={current:'green',pending:'gold',inactive:'default'};
const goalOptions=[{value:'retirement',label:'养老'},{value:'education',label:'教育'},{value:'other',label:'其他'}];
function CoverageCell({entry,memberName,onClick}) {
  return <button type="button" className="family-policy-review-cell" onClick={onClick} aria-label={`查看${memberName}的${entry.label}明细`}>
    {entry.currentCount?<><strong>{entry.amount!=null?currency(entry.amount):'有有效责任'}</strong><small>{entry.currentCount} 份已确认{entry.key==='allowance'||entry.key==='financial'?' · 分合同查看给付':''}</small></>:<span className="family-policy-review-cell-empty">暂无已确认金额</span>}
    {entry.pendingCount?<small className="family-policy-review-pending">{entry.pendingCount} 份待核对{entry.pendingAmount?` · 参考 ${currency(entry.pendingAmount)}`:''}</small>:null}
    {entry.inactiveCount?<small>{entry.inactiveCount} 份非在保</small>:null}
  </button>;
}

export function FamilyPolicyReviewPanel({family,api,apiLoading,performApiAction,onError,onSuccess,onLinkPolicy,onFollowUp,onFamilyChanged}) {
  const [review,setReview]=useState(null);
  const [candidates,setCandidates]=useState([]);
  const [linkContractId,setLinkContractId]=useState(null);
  const [linkOpen,setLinkOpen]=useState(false);
  const [uploadOpen,setUploadOpen]=useState(false);
  const [contextOpen,setContextOpen]=useState(false);
  const [guestMember,setGuestMember]=useState(null);
  const [detail,setDetail]=useState(null);
  const [file,setFile]=useState(null);
  const [linkForm]=Form.useForm();
  const [uploadForm]=Form.useForm();
  const [contextForm]=Form.useForm();
  const [guestForm]=Form.useForm();
  const familyId=family.id;
  const loadKey=`family:policy-review:${familyId}`;
  const memberOptions=family.members.map((member)=>({value:member.id,label:member.name}));
  const customerOptions=family.members.filter((member)=>member.customerId).map((member)=>({value:member.customerId,label:member.name}));
  const followUpContact=(item)=>{
    const member=family.members.find((entry)=>entry.id===item.memberId);
    return member?.customerId?member:family.members.find((entry)=>entry.customerId===family.primaryCustomerId);
  };
  const followUpFor=(item)=>{
    const contactMember=followUpContact(item);
    if(!contactMember||contactMember.contact==='已拒绝联系')return;
    onFollowUp?.({id:contactMember.customerId,contact:contactMember.contact},{title:item.title,note:`家庭保障检视：${item.reason} 下一步：${item.next}`});
  };

  const refresh=async()=>{
    const result=await performApiAction(loadKey,()=>api.familyPolicyReview(familyId));
    setReview(result);
    return result;
  };
  useEffect(()=>{
    let mounted=true;
    performApiAction(loadKey,()=>api.familyPolicyReview(familyId))
      .then((result)=>{if(mounted)setReview(result);})
      .catch((error)=>{if(mounted)onError(error);});
    return ()=>{mounted=false;};
  },[familyId,family]);

  const openLink=async()=>{
    try {
      const result=await performApiAction(`family:contract-candidates:${familyId}`,()=>api.familyContractCandidates(familyId));
      setCandidates(result);
      linkForm.resetFields();
      setLinkContractId(null);
      setLinkOpen(true);
    } catch(error){onError(error);}
  };
  const link=async(values)=>{
    const key=`family:contract-link:${values.contractId}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.linkFamilyContract(familyId,values.contractId,values));
      await onFamilyChanged?.();await refresh();setLinkOpen(false);onSuccess('合同已纳入家庭保障检视');
    } catch(error){onError(error);}
  };
  const upload=async(values)=>{
    if(!file){onError(new Error('请选择 PDF 合同'));return;}
    if(!/\.pdf$/i.test(file.name)||file.size>25*1024*1024){onError(new Error('请选择不超过 25 MB 的 PDF 合同'));return;}
    const key=`family:contract-upload:${familyId}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.uploadFamilyContract(familyId,file,values));
      await onFamilyChanged?.();await refresh();setUploadOpen(false);setFile(null);uploadForm.resetFields();
      onSuccess('合同已在本地解析并纳入家庭，尚未调用 AI');
    } catch(error){onError(error);}
  };
  const unlink=async(record)=>{
    const key=`family:source-unlink:${record.id}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.unlinkFamilyPolicySource(familyId,{
        policyId:Number.isSafeInteger(record.id)?record.id:undefined,
        contractIds:record.linkedContractIds,
      }));
      await onFamilyChanged?.();await refresh();onSuccess('已取消家庭关联，原客户保单和合同仍保留');
    } catch(error){onError(error);}
  };
  const saveContext=async(values)=>{
    const key=`family:coverage-context:${familyId}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.saveFamilyCoverageContext(familyId,values));
      await refresh();setContextOpen(false);onSuccess('家庭责任与目标已保存');
    } catch(error){onError(error);}
  };
  const saveGuest=async(values)=>{
    const key=`family:guest-profile:${guestMember?.id}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.saveFamilyMemberCoverageProfile(familyId,guestMember.id,values));
      await refresh();setGuestMember(null);onSuccess('成员医保资料已保存');
    } catch(error){onError(error);}
  };
  const exportXlsx=async()=>{
    const key=`family:policy-export:${familyId}`;
    if(apiLoading[key])return;
    try {
      await performApiAction(key,()=>api.exportFamilyPolicyOrganizer(familyId,family.name));
      onSuccess('家庭保单整理表已导出');
    } catch(error){onError(error);}
  };

  return <Card className="panel-card family-policy-review" title={<div><Title level={4}>家庭保单整理与保障检视</Title><Text className="muted">按被保险人逐一核对合同、责任和服务重点</Text></div>} extra={<Space wrap>
    <Button size="small" icon={<PlusOutlined />} loading={Boolean(apiLoading[`family:policy-candidates:${familyId}`])} onClick={onLinkPolicy}>关联已有保单</Button>
    <Button size="small" icon={<PlusOutlined />} loading={Boolean(apiLoading[`family:contract-candidates:${familyId}`])} onClick={openLink}>关联 / 调整 PDF</Button>
    <Button size="small" icon={<UploadOutlined />} onClick={()=>{uploadForm.setFieldsValue({customerId:family.primaryCustomerId,insuredMemberIds:[]});setFile(null);setUploadOpen(true);}}>上传合同</Button>
    <Button size="small" disabled={!review} onClick={()=>{contextForm.setFieldsValue(review.context);setContextOpen(true);}}>家庭责任与目标</Button>
    <Button size="small" icon={<DownloadOutlined />} disabled={!review} loading={Boolean(apiLoading[`family:policy-export:${familyId}`])} onClick={exportXlsx}>导出 Excel</Button>
  </Space>}>
    {!review ? <div className="family-policy-review-loading"><Spin description="正在整理家庭保单" /></div> : <>
      <div className="family-policy-review-stats">
        <div><small>已纳入来源</small><strong>{review.summary.sourceCount}</strong></div>
        <div><small>已确认有效</small><strong>{review.summary.currentCount}</strong></div>
        <div><small>待核对 / 待分配</small><strong>{review.summary.pendingCount} / {review.summary.unassignedCount}</strong></div>
        <div><small>已识别年交保费 · 续缴待核</small><strong>{currency(review.summary.annualPremiumTotal)}</strong></div>
      </div>
      <Alert type="info" showIcon title="按成员和责任分别看" description="待核对合同不计入已确认保障；身故与意外身价可能是同一责任，不能相加。没有记录不等于没有保障。" />
      <div className="family-policy-review-scroll"><table className="family-policy-review-matrix"><thead><tr><th>成员</th>
        {review.members[0]?.coverages.map((entry)=><th key={entry.key}>{entry.label}</th>)}
      </tr></thead><tbody>{review.members.map((member)=><tr key={member.id}><th scope="row"><strong>{member.displayName}</strong>
        {member.isGuest?<Button type="link" size="small" onClick={()=>{guestForm.setFieldsValue(member.profile);setGuestMember(member);}}>医保资料</Button>:null}
      </th>{member.coverages.map((entry)=><td key={entry.key}>
        <CoverageCell entry={entry} memberName={member.displayName} onClick={()=>setDetail({memberId:member.id,key:entry.key})} />
      </td>)}</tr>)}</tbody></table></div>
      <div className="family-policy-review-mobile-members">{review.members.map((member)=><section key={member.id}>
        <header><strong>{member.displayName}</strong>{member.isGuest?<Button type="link" size="small" onClick={()=>{guestForm.setFieldsValue(member.profile);setGuestMember(member);}}>医保资料</Button>:null}</header>
        <div>{member.coverages.map((entry)=><div key={entry.key}><span>{entry.label}</span>
          <CoverageCell entry={entry} memberName={member.displayName} onClick={()=>setDetail({memberId:member.id,key:entry.key})} />
        </div>)}</div>
      </section>)}</div>
      {review.recommendations.length?<div className="family-policy-review-recommendations"><h4>初筛出的服务重点</h4>
        <div>{review.recommendations.map((item,index)=><article key={`${item.memberId||'family'}-${item.kind}-${index}`}>
          <Tag color={item.kind==='life'?'orange':'green'}>{item.kind==='medical'?'医疗核对':item.kind==='life'?'家庭兜底':'长期安排'}</Tag>
          <strong>{item.title}</strong><p>{item.reason}</p><small>下一步：{item.next}</small>
          {onFollowUp?<Button size="small" className="family-policy-review-followup" disabled={!followUpContact(item)||followUpContact(item).contact==='已拒绝联系'} onClick={()=>followUpFor(item)}>安排跟进</Button>:null}
        </article>)}</div>
      </div>:review.records.length?<Text className="muted">当前没有新增服务提醒；仍需按合同核对保障状态和需求。</Text>:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="先纳入家庭保单或 PDF 合同，才能形成检视结果" />}
      <div className="family-policy-review-sources"><h4>纳入的合同与保单</h4>
        {review.records.length?review.records.map((record)=><div className="family-policy-review-source" key={record.id}>
          <FilePdfOutlined /><div><strong>{record.name}</strong><small>{record.insuredMemberIds.length?record.insuredMemberIds.map((memberId)=>review.members.find((member)=>member.id===memberId)?.displayName).join('、'):'被保险人待分配'} · {record.company||'公司待核对'} · {record.expiryDate?`到期 ${record.expiryDate}`:'期限待核对'}</small></div>
          <Tag color={statusColor[record.status]}>{record.sharedInsuredLimit?'多人限额待核对':statusLabel[record.status]}</Tag>
          <Popconfirm title="取消这份家庭保单合同关联？" description="只从当前家庭移除，客户档案中的保单和 PDF 仍保留。" okText="取消关联" cancelText="返回" onConfirm={()=>unlink(record)}>
            <Button size="small" color="danger" variant="outlined" loading={Boolean(apiLoading[`family:source-unlink:${record.id}`])}>取消关联</Button>
          </Popconfirm>
        </div>):<Text className="muted">尚未纳入合同</Text>}
      </div>
    </>}
    <Drawer title={detail?`${review?.members.find((item)=>item.id===detail.memberId)?.displayName||'成员'} · ${review?.members.find((item)=>item.id===detail.memberId)?.coverages.find((item)=>item.key===detail.key)?.label||'保障'}明细`:''}
      open={Boolean(detail)} onClose={()=>setDetail(null)} size="large">
      {detail&&review?(()=>{
        const sources=review.records.filter((record)=>record.insuredMemberIds.includes(detail.memberId)&&record.categories.includes(detail.key));
        return sources.length?sources.map((record)=><article className="family-policy-review-detail" key={record.id}>
          <strong>{record.name}</strong><Tag color={statusColor[record.status]}>{record.status==='current'&&record.sharedInsuredLimit?'多人共用限额':statusLabel[record.status]}</Tag>
          <p>{record.company||'公司待核对'} · {record.fileName||'保单档案'}</p>
          <p>{detail.key==='financial'?'合同基本保额（非现金价值）':detail.key==='allowance'?'单项津贴金额':'责任金额'}：{record.amounts[detail.key]!=null?currency(record.amounts[detail.key]):'待核对'}{record.sharedInsuredLimit?'（多人共用，暂不计入个人已确认金额）':''}</p>
          {record.benefits.length?<div className="family-policy-review-benefits">{record.benefits.map((benefit,index)=><div key={`${record.id}-${index}`}>
            <strong>{benefit.name||'保险责任'}</strong>{benefit.amount?<span>{benefit.amount}</span>:null}
            {benefit.summary||benefit.conditions?<p>{benefit.summary||benefit.conditions}</p>:null}
            {benefit.page?<small>合同第 {benefit.page} 页</small>:null}
          </div>)}</div>:<Text className="muted">尚无可展示的责任条款；请对照原合同核实。</Text>}
        </article>):<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这位成员暂无该类保单记录" />;
      })():null}
    </Drawer>
    <Modal title="关联或调整 PDF 合同" open={linkOpen} forceRender onCancel={()=>setLinkOpen(false)} onOk={()=>linkForm.submit()}
      confirmLoading={Boolean(apiLoading[`family:contract-link:${linkContractId}`])} okText="纳入家庭">
      <Form form={linkForm} layout="vertical" onFinish={link}>
        <Form.Item name="contractId" label="选择合同" rules={[{required:true,message:'请选择合同'}]}><Select options={candidates.map((item)=>({value:item.id,label:`${item.linked?'已关联 · ':''}${item.fileName}`}))} placeholder="家庭成员客户档案中的 PDF"
          onChange={(contractId)=>{setLinkContractId(contractId);const record=review?.records.find((item)=>item.contractId===contractId);
            linkForm.setFieldsValue({holderMemberIds:record?.holderMemberIds||[],insuredMemberIds:record?.insuredMemberIds||[]});}} /></Form.Item>
        <Form.Item name="holderMemberIds" label="投保人"><Select mode="multiple" options={memberOptions} placeholder="可稍后确认" /></Form.Item>
        <Form.Item name="insuredMemberIds" label="被保险人"><Select mode="multiple" options={memberOptions} placeholder="可稍后确认；未确认不计入成员保障" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="上传家庭合同" open={uploadOpen} forceRender onCancel={()=>setUploadOpen(false)} onOk={()=>uploadForm.submit()}
      confirmLoading={Boolean(apiLoading[`family:contract-upload:${familyId}`])} okText="上传并纳入">
      <Form form={uploadForm} layout="vertical" onFinish={upload}>
        <Form.Item name="customerId" label="资料所属客户" rules={[{required:true,message:'请选择客户'}]}><Select options={customerOptions} /></Form.Item>
        <Form.Item label="PDF 合同"><Upload accept=".pdf,application/pdf" maxCount={1} beforeUpload={(next)=>{setFile(next);return false;}} onRemove={()=>setFile(null)}><Button icon={<UploadOutlined />}>选择 PDF</Button></Upload></Form.Item>
        <Form.Item name="holderMemberIds" label="投保人"><Select mode="multiple" options={memberOptions} placeholder="可稍后确认" /></Form.Item>
        <Form.Item name="insuredMemberIds" label="被保险人"><Select mode="multiple" options={memberOptions} placeholder="可稍后确认" /></Form.Item>
        <Text className="muted">只在本地解析合同；不会自动调用 AI。</Text>
      </Form>
    </Modal>
    <Modal title="家庭责任与目标" open={contextOpen} forceRender onCancel={()=>setContextOpen(false)} onOk={()=>contextForm.submit()}
      confirmLoading={Boolean(apiLoading[`family:coverage-context:${familyId}`])} okText="保存">
      <Form form={contextForm} layout="vertical" onFinish={saveContext}>
        <Form.Item name="mainIncomeMemberIds" label="主要收入承担成员"><Select mode="multiple" options={memberOptions} /></Form.Item>
        <Form.Item name="dependentMemberIds" label="经济依赖成员"><Select mode="multiple" options={memberOptions} /></Form.Item>
        <Form.Item name="debtStatus" label="家庭负债"><Select options={[{value:'unknown',label:'待确认'},{value:'yes',label:'有负债'},{value:'no',label:'无负债'}]} /></Form.Item>
        <Form.Item name="longTermGoals" label="长期目标"><Select mode="multiple" options={goalOptions} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`核对${guestMember?.name||'成员'}的医保资料`} open={Boolean(guestMember)} forceRender onCancel={()=>setGuestMember(null)} onOk={()=>guestForm.submit()}
      confirmLoading={Boolean(apiLoading[`family:guest-profile:${guestMember?.id}`])} okText="保存">
      <Form form={guestForm} layout="vertical" onFinish={saveGuest}>
        <Form.Item name="medicalInsuranceStatus" label="基本医保"><Select options={[{value:'unknown',label:'待确认'},{value:'employee',label:'职工医保'},{value:'resident',label:'居民医保'},{value:'none',label:'目前未参保'}]} /></Form.Item>
        <Form.Item name="employerMedicalStatus" label="单位补充医疗"><Select options={[{value:'unknown',label:'待确认'},{value:'yes',label:'有'},{value:'no',label:'无'}]} /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
