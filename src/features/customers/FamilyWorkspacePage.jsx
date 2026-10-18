import { useEffect, useRef, useState } from 'react';
import { Alert, Breadcrumb, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';
import FamilyRelationshipGraph from './FamilyRelationshipGraph.jsx';
import { FamilyPolicyDiagnosis } from './FamilyPolicyDiagnosis.jsx';
import { PolicyCard } from './PolicyCard.jsx';
import { normalizeFamilyMemberIdentity } from './family-member-form.js';

const {Title,Text} = Typography;
const kindLabels = {partner:'配偶 / 伴侣',parent_child:'父母与子女',sibling:'兄弟姐妹',other:'其他关系'};
const objectLabels = {vehicle:'车辆',home:'房屋',property:'家庭财产',other:'其他财产'};
const coverageLabels = {medical:'医疗',critical_illness:'重疾',life:'寿险',accident:'意外',auto:'车险',home:'家财险',other:'其他'};

export function FamilyWorkspacePage({familyId,api,apiLoading,performApiAction,onBack,onHome,onClients,onOpenCustomer,onViewPolicyServices,serviceWorkspace,onError,onSuccess}) {
  const [family,setFamily] = useState(null);
  const [selectedMemberId,setSelectedMemberId] = useState(null);
  const [loadError,setLoadError] = useState('');
  const [memberOpen,setMemberOpen] = useState(false);
  const [memberEditOpen,setMemberEditOpen] = useState(false);
  const [familyEditOpen,setFamilyEditOpen] = useState(false);
  const [relationshipOpen,setRelationshipOpen] = useState(false);
  const [editingRelationship,setEditingRelationship] = useState(null);
  const [objectOpen,setObjectOpen] = useState(false);
  const [editingObject,setEditingObject] = useState(null);
  const [associateOpen,setAssociateOpen] = useState(false);
  const [editingPolicy,setEditingPolicy] = useState(null);
  const [candidatePolicies,setCandidatePolicies] = useState([]);
  const [customerOptions,setCustomerOptions] = useState([]);
  const [customerSearch,setCustomerSearch] = useState('');
  const customerLookupSequence = useRef(0);
  const [associateCustomerMember,setAssociateCustomerMember] = useState(null);
  const [memberForm] = Form.useForm();
  const [memberEditForm] = Form.useForm();
  const [relationshipForm] = Form.useForm();
  const [objectForm] = Form.useForm();
  const [policyForm] = Form.useForm();
  const [customerLinkForm] = Form.useForm();
  const [familyEditForm] = Form.useForm();
  const loadKey = `family:load:${familyId}`;

  const load = async () => {
    try {
      const result = await performApiAction(loadKey,()=>api.family(familyId));
      setFamily(result);setLoadError('');
      setSelectedMemberId((current)=>result.members.some((member)=>member.id===current)?current:result.members[0]?.id || null);
    } catch (error) { setLoadError(error.message || '家庭资料加载失败');onError(error); }
  };
  useEffect(()=>{load();},[familyId]);

  const mutate = async (key,action,successText='家庭资料已更新') => {
    try {
      const result = await performApiAction(key,action);
      if (result?.members && result?.relationships) setFamily(result);
      else await load();
      onSuccess(successText);
      return result;
    } catch (error) { onError(error);return null; }
  };

  const darkTheme = document.documentElement.dataset.theme==='dark';
  const memberOptions = family?.members.map((member)=>({value:member.id,label:member.name})) || [];
  const existingFamilyCustomerIds = new Set((family?.members || []).filter((member)=>!member.isGuest).map((member)=>String(member.customerId)));
  const availableCustomerOptions = customerOptions.filter((item)=>!existingFamilyCustomerIds.has(String(item.id)));
  const searchCustomers = async (value) => {
    const sequence=++customerLookupSequence.current;
    const text=String(value||'').trim();
    setCustomerSearch(text);
    try {
      const rows=await performApiAction('family:customer-lookup',()=>api.lookupCustomers(text));
      if(sequence===customerLookupSequence.current) setCustomerOptions(rows);
    } catch(error){if(sequence===customerLookupSequence.current)onError(error);}
  };
  const customerLookupEmpty=apiLoading['family:customer-lookup']?<Spin size="small" />:customerSearch?'没有匹配的可关联客户档案':customerOptions.length?'本家庭已关联这些客户档案':'暂无客户档案，可录入简要成员';

  const addMember = async (values) => {
    const identity=normalizeFamilyMemberIdentity(values);
    if (!identity.customerId && !identity.guestName) {
      onError(new Error('请选择一个已有客户，或填写简要成员称呼'));
      return;
    }
    if (Boolean(values.relationshipKind) !== Boolean(values.otherMemberId)) {
      onError(new Error('确认成员关系时，请同时选择关系类型和另一位成员'));
      return;
    }
    const body={...identity,note:values.note || ''};
    if (values.relationshipKind && values.otherMemberId) body.relationship={otherMemberId:values.otherMemberId,kind:values.relationshipKind,label:values.relationshipLabel || ''};
    const result=await mutate(`family:member:add:${familyId}`,()=>api.addFamilyMember(familyId,body),'家庭成员已添加');
    if(result){setMemberOpen(false);memberForm.resetFields();}
  };

  const saveMemberProfile = async (values) => {
    const body={note:values.note || ''};
    if(selectedMember?.isGuest) body.guestName=values.guestName;
    const result=await mutate(`family:member:update:${selectedMember?.id}`,()=>api.updateFamilyMember(familyId,selectedMember.id,body),'成员资料已更新');
    if(result){setMemberEditOpen(false);memberEditForm.resetFields();}
  };

  const saveRelationship = async (values) => {
    if (values.memberAId === values.memberBId) {onError(new Error('请选择两位不同的家庭成员'));return;}
    const body={memberAId:values.memberAId,memberBId:values.memberBId,kind:values.kind,label:values.label || ''};
    const result=editingRelationship
      ? await mutate(`family:relationship:update:${editingRelationship.id}`,()=>api.updateFamilyRelationship(familyId,editingRelationship.id,{kind:body.kind,label:body.label}),'成员关系已更新')
      : await mutate(`family:relationship:create:${familyId}`,()=>api.createFamilyRelationship(familyId,body),'成员关系已添加');
    if(result){setRelationshipOpen(false);setEditingRelationship(null);relationshipForm.resetFields();}
  };
  const selectRelationship = (relationshipId) => {
    const relationship=family?.relationships.find((item)=>String(item.id)===String(relationshipId));
    if(!relationship)return;
    setEditingRelationship(relationship);
    relationshipForm.setFieldsValue({memberAId:relationship.memberAId,memberBId:relationship.memberBId,kind:relationship.kind,label:relationship.label});
    setRelationshipOpen(true);
  };

  const saveObject = async (values) => {
    const body={kind:values.kind,name:values.name,note:values.note || ''};
    const result=editingObject
      ? await mutate(`family:object:update:${editingObject.id}`,()=>api.updateInsuredObject(familyId,editingObject.id,body),'投保对象已更新')
      : await mutate(`family:object:create:${familyId}`,()=>api.createInsuredObject(familyId,body),'投保对象已添加');
    if(result){setObjectOpen(false);setEditingObject(null);objectForm.resetFields();}
  };

  const saveFamily = async (values) => {
    const result=await mutate(`family:update:${family.id}`,()=>api.updateFamily(family.id,{name:values.name,primaryCustomerId:values.primaryCustomerId}),'家庭信息已更新');
    if(result){setFamilyEditOpen(false);familyEditForm.resetFields();}
  };

  const openAssociate = async () => {
    try {
      const rows=await performApiAction(`family:policy-candidates:${familyId}`,()=>api.familyPolicyCandidates(familyId));
      setEditingPolicy(null);setCandidatePolicies(rows);policyForm.resetFields();
      if(rows[0]) policyForm.setFieldValue('policyId',rows[0].id);
      setAssociateOpen(true);
    } catch(error){onError(error);}
  };
  const openEditPolicy = (policy) => {
    setEditingPolicy(policy);
    setCandidatePolicies([policy]);
    policyForm.setFieldsValue({
      policyId:policy.id,
      holderMemberIds:policy.people.filter((person)=>person.role==='holder').map((person)=>person.memberId),
      insuredMemberIds:policy.people.filter((person)=>person.role==='insured').map((person)=>person.memberId),
      insuredObjectIds:policy.insuredObjectIds,
      coverageTags:policy.coverageTags,
    });
    setAssociateOpen(true);
  };
  const associatePolicy = async (values) => {
    const people=[...(values.holderMemberIds || []).map((memberId)=>({memberId,role:'holder'})),
      ...(values.insuredMemberIds || []).map((memberId)=>({memberId,role:'insured'}))];
    const result=await mutate(`family:policy:link:${values.policyId}`,()=>api.linkFamilyPolicy(familyId,values.policyId,{
      people,insuredObjectIds:values.insuredObjectIds || [],coverageTags:values.coverageTags || [],
    }),editingPolicy?'家庭保单归属已更新':'保单已关联到家庭');
    if(result){setAssociateOpen(false);setEditingPolicy(null);policyForm.resetFields();}
  };

  const openCustomerLink = (member) => {
    setAssociateCustomerMember(member);customerLinkForm.resetFields();setCustomerOptions([]);setCustomerSearch('');setMemberOpen(false);
    // Reuse the same customer search field and provide a separate modal for linking a guest record.
    setAssociateOpen(false);setLinkCustomerOpen(true);
    void searchCustomers('');
  };
  const [linkCustomerOpen,setLinkCustomerOpen] = useState(false);
  const linkGuest = async (values) => {
    const result=await mutate(`family:member:link:${associateCustomerMember?.id}`,()=>api.updateFamilyMember(familyId,associateCustomerMember.id,{customerId:values.customerId}),'成员已关联客户档案');
    if(result){setLinkCustomerOpen(false);setAssociateCustomerMember(null);customerLinkForm.resetFields();}
  };

  if (!family) return <Card className="panel-card">{apiLoading[loadKey] ? <div className="page-loading"><Spin /></div> : <Empty description={loadError || '家庭资料暂不可用'}><Space><Button onClick={load}>重新加载</Button><Button onClick={onBack}>返回家庭列表</Button></Space></Empty>}</Card>;
  const selectedMember=family.members.find((member)=>member.id===selectedMemberId) || null;
  const graphHasNodes=family.members.length>0;
  return <div className="family-workspace-page">
    <Breadcrumb items={[
      {title:<button className="breadcrumb-link" onClick={onHome}>工作台</button>},
      {title:<button className="breadcrumb-link" onClick={onClients}>客户与保单</button>},
      {title:<button className="breadcrumb-link" onClick={onBack}>家庭规划</button>},
      {title:family.name},
    ]} />
    <div className="page-heading family-workspace-heading"><div><Title level={2}>{family.name}</Title><Text className="muted">家庭关系、已有保障和服务事项整理</Text></div><Space wrap>
      <Button size="small" icon={<EditOutlined />} onClick={()=>{familyEditForm.setFieldsValue({name:family.name,primaryCustomerId:family.primaryCustomerId});setFamilyEditOpen(true);}}>编辑家庭</Button>
      <Popconfirm title="删除这个家庭？" description="关系、投保对象和家庭保单关联会删除，客户与保单档案会保留。" okText="删除家庭" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:"danger",variant:"outlined"}} onConfirm={async()=>{try{await performApiAction(`family:delete:${family.id}`,()=>api.deleteFamily(family.id));onSuccess('家庭档案已删除');onBack();}catch(error){onError(error);}}}>
        <Button size="small" color="danger" variant="outlined" icon={<DeleteOutlined />} loading={Boolean(apiLoading[`family:delete:${family.id}`])}>删除家庭</Button>
      </Popconfirm>
    </Space></div>
    <Alert className="family-scope-alert" type="info" showIcon message="当前页面整理成员关系、已有保单与投保对象；资产估值、现金流和投资持仓将在后续阶段接入。" />
    <Row gutter={[16,16]} className="family-stats-row">
      <Col xs={12} md={6}><Card className="small-metric"><Text>家庭成员</Text><strong>{family.stats.memberCount}<span>位</span></strong></Card></Col>
      <Col xs={12} md={6}><Card className="small-metric"><Text>已关联保单</Text><strong>{family.stats.policyCount}<span>份</span></strong></Card></Col>
      <Col xs={12} md={6}><Card className="small-metric"><Text>资料待核实</Text><strong>{family.stats.unverifiedCount}<span>份</span></strong></Card></Col>
      <Col xs={12} md={6}><Card className="small-metric"><Text>开放服务事项</Text><strong>{family.stats.openServiceCount}<span>项</span></strong></Card></Col>
    </Row>
    <div className="family-overview-grid">
      <FamilyPolicyDiagnosis family={family} />
      <div className="family-relationship-column">
        <Card className="panel-card family-graph-card" title={<div><Title level={4}>家庭关系</Title><Text className="muted">关系需经人工确认；图谱不会根据姓名推断。</Text></div>} extra={<Space wrap>
          <Button size="small" icon={<PlusOutlined />} onClick={()=>{memberForm.resetFields();setCustomerOptions([]);setCustomerSearch('');setMemberOpen(true);void searchCustomers('');}}>添加成员</Button>
          <Button size="small" icon={<PlusOutlined />} onClick={()=>{relationshipForm.resetFields();setEditingRelationship(null);setRelationshipOpen(true);}}>添加关系</Button>
        </Space>}>
          {graphHasNodes ? <FamilyRelationshipGraph family={family} selectedMemberId={selectedMemberId} onSelect={setSelectedMemberId} onRelationSelect={selectRelationship} darkTheme={darkTheme} /> : <Empty description="家庭还没有成员" />}
          <div className="family-member-list" aria-label="家庭成员列表">{family.members.map((member)=><button key={member.id} className={`family-member-list-item ${selectedMemberId===member.id?'selected':''}`} onClick={()=>setSelectedMemberId(member.id)}>
            <span className="family-member-avatar">{member.name?.slice(0,1) || '客'}</span><span><strong>{member.name}</strong><small>{member.isGuest?'简要成员':member.isPrimary?'主要服务联系人':member.stage || '客户档案'}</small></span>
          </button>)}</div>
        </Card>
        <Card className="panel-card family-relations-card" title={<Title level={4}>已确认关系</Title>}>
          {family.relationships.length ? <div className="family-relation-list">{family.relationships.map((relation)=>{
            const memberA=family.members.find((member)=>member.id===relation.memberAId)?.name || '成员';
            const memberB=family.members.find((member)=>member.id===relation.memberBId)?.name || '成员';
            return <div className="family-relation-row" key={relation.id}><Text>{relation.kind==='parent_child'?<>{memberA}（父母） → {memberB}（子女）</>:<>{memberA} <Tag>{relation.kind==='other'?relation.label:kindLabels[relation.kind]}</Tag> {memberB}</>}</Text><Space><Button size="small" icon={<EditOutlined />} onClick={()=>{setEditingRelationship(relation);relationshipForm.setFieldsValue({memberAId:relation.memberAId,memberBId:relation.memberBId,kind:relation.kind,label:relation.label});setRelationshipOpen(true);}}>编辑</Button><Popconfirm title="解除这条关系？" description="只删除关系连线，不会移除成员。" okText="解除关系" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:'danger',variant:'outlined'}} onConfirm={()=>mutate(`family:relationship:delete:${relation.id}`,()=>api.deleteFamilyRelationship(familyId,relation.id),'关系已解除')}><Button size="small" color="danger" variant="outlined" loading={Boolean(apiLoading[`family:relationship:delete:${relation.id}`])}>解除</Button></Popconfirm></Space></div>;
          })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有确认的成员关系" />}
        </Card>
        <Card className="panel-card family-policy-card" title={<div><Title level={4}>家庭保单</Title><Text className="muted">只纳入家庭成员名下并人工确认归属的保单。</Text></div>} extra={<Button type="primary" icon={<PlusOutlined />} loading={Boolean(apiLoading[`family:policy-candidates:${familyId}`])} onClick={openAssociate}>关联已有保单</Button>}>
          {family.policies.length ? family.policies.map((policy)=><div className="family-policy-entry" key={policy.id}>
            <PolicyCard policy={policy} apiLoading={apiLoading} onVerify={(item)=>performApiAction(`policy:verify:${item.id}`,async()=>{await api.verifyPolicy(item.id,!item.verified);const updated=await api.family(familyId);setFamily(updated);onSuccess(item.verified?'保单已标记为待核实':'保单资料已核实');}).catch(onError)}
              onLifecycle={()=>serviceWorkspace?.openLifecycle(policy)}
              onCreateService={()=>serviceWorkspace?.openCreateService(policy,policy.customerId)}
              onViewServices={()=>onViewPolicyServices?.(policy)} />
            <div className="family-policy-meta">
              <div className="family-policy-details"><Text>管理客户：{policy.customerName}</Text><Text>人员：{policy.people.length ? policy.people.map((entry)=>`${family.members.find((member)=>member.id===entry.memberId)?.name || '成员'}（${entry.role==='holder'?'投保人':'被保险人'}）`).join('、') : '待关联'}</Text><Text>投保对象：{policy.insuredObjectIds.length ? policy.insuredObjectIds.map((id)=>family.insuredObjects.find((object)=>object.id===id)?.name || '对象').join('、') : '待关联'}</Text><Text>分类：{policy.coverageTags.length ? policy.coverageTags.map((tag)=>coverageLabels[tag]).join('、') : '待分类'}</Text></div>
              <Space className="family-policy-actions" size={8} wrap>
                <Button size="small" icon={<EditOutlined />} loading={Boolean(apiLoading[`family:policy:link:${policy.id}`])} onClick={()=>openEditPolicy(policy)}>编辑归属</Button>
                <Popconfirm title="解除这份家庭保单关联？" description="原客户保单和相关服务事项会保留。" okText="解除关联" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:'danger',variant:'outlined'}} onConfirm={()=>mutate(`family:policy:unlink:${policy.id}`,()=>api.unlinkFamilyPolicy(familyId,policy.id),'保单已从家庭解绑')}><Button color="danger" variant="outlined" size="small" loading={Boolean(apiLoading[`family:policy:unlink:${policy.id}`])}>解除关联</Button></Popconfirm>
              </Space>
            </div>
          </div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联家庭保单" />}
        </Card>
      </div>
      <div className="family-details-column">
        <Card className="panel-card family-member-detail" title={<Title level={4}>成员信息</Title>}>
          {selectedMember ? <>
            <div className="family-selected-member-head"><span className="family-member-avatar large">{selectedMember.name?.slice(0,1)}</span><div><Title level={4}>{selectedMember.name}</Title><Text className="muted">{selectedMember.isGuest?'简要成员':selectedMember.isPrimary?'主要服务联系人':selectedMember.stage || '客户档案'}</Text></div></div>
            <Space className="family-member-actions" size={[8,8]} wrap>
              {selectedMember.isGuest ? <Button size="small" onClick={()=>openCustomerLink(selectedMember)}>关联客户档案</Button> : <Button size="small" loading={Boolean(apiLoading[`customer:open:${selectedMember.customerId}`])} onClick={()=>onOpenCustomer(selectedMember.customerId,familyId)}>查看客户详情 <TeamOutlined /></Button>}
              <Popconfirm title="移出这位成员？" description="相关关系连线和保单人员归属会清理，客户档案本身会保留。" okText="移出成员" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:"danger",variant:"outlined",disabled:selectedMember.isPrimary}} onConfirm={()=>mutate(`family:member:remove:${selectedMember.id}`,()=>api.removeFamilyMember(familyId,selectedMember.id),'成员已移出家庭')}>
                <Button size="small" color="danger" variant="outlined" disabled={selectedMember.isPrimary} loading={Boolean(apiLoading[`family:member:remove:${selectedMember.id}`])}>移出家庭</Button>
              </Popconfirm>
              <Button size="small" icon={<EditOutlined />} onClick={()=>{memberEditForm.setFieldsValue({guestName:selectedMember.isGuest?selectedMember.name:undefined,note:selectedMember.note || ''});setMemberEditOpen(true);}}>编辑成员资料</Button>
            </Space>
            {selectedMember.isPrimary ? <Text className="muted">先调整主要服务联系人，才能移出该成员。</Text> : null}
            {selectedMember.isGuest ? <Text className="muted">简要成员 · {selectedMember.note || '尚无补充备注'}</Text> : <Descriptions size="small" column={1} className="family-member-descriptions"><Descriptions.Item label="联系电话">{selectedMember.phone || '未填写'}</Descriptions.Item><Descriptions.Item label="客户阶段">{selectedMember.stage || '未记录'}</Descriptions.Item><Descriptions.Item label="客户来源">{selectedMember.source || '未记录'}</Descriptions.Item><Descriptions.Item label="联系状态">{selectedMember.contact || '未记录'}</Descriptions.Item></Descriptions>}
            <Divider />
            <Title level={5}>直接关系</Title>
            {family.relationships.filter((relation)=>relation.memberAId===selectedMember.id || relation.memberBId===selectedMember.id).length ? family.relationships.filter((relation)=>relation.memberAId===selectedMember.id || relation.memberBId===selectedMember.id).map((relation)=>{
              const otherId=relation.memberAId===selectedMember.id?relation.memberBId:relation.memberAId;
              const other=family.members.find((member)=>member.id===otherId);
              return <div className="family-direct-relation" key={relation.id}>{relation.kind==='parent_child'?(relation.memberAId===selectedMember.id?`父母 → ${other?.name}`:`子女 ← ${other?.name}`):relation.kind==='other'?`${relation.label} · ${other?.name}`:`${kindLabels[relation.kind]} · ${other?.name}`}</div>;
            }) : <Text className="muted">关系待确认</Text>}
            <Divider />
            <Title level={5}>关联保单</Title>
            {family.policies.filter((policy)=>policy.people.some((entry)=>entry.memberId===selectedMember.id)).length ? family.policies.filter((policy)=>policy.people.some((entry)=>entry.memberId===selectedMember.id)).map((policy)=><div className="family-mini-policy" key={policy.id}><Text strong>{policy.name}</Text><Text className="schedule-meta">{policy.company} · {policy.type} · {policy.people.filter((entry)=>entry.memberId===selectedMember.id).map((entry)=>entry.role==='holder'?'投保人':'被保险人').join(' / ')}</Text></div>) : <Text className="muted">未录入该成员的保单关联</Text>}
          </> : <Empty description="选择一位成员查看资料" />}
        </Card>
        <Card className="panel-card family-object-card" title={<div><Title level={4}>财产保障</Title><Text className="muted">这里记录财险保单对应的房屋、车辆等投保对象。</Text></div>} extra={<Button size="small" icon={<PlusOutlined />} onClick={()=>{setEditingObject(null);objectForm.resetFields();setObjectOpen(true);}}>添加对象</Button>}>
          {family.insuredObjects.length ? <div className="family-object-list">{family.insuredObjects.map((object)=><div className="family-object-row" key={object.id}><div><Tag>{objectLabels[object.kind]}</Tag><Text strong>{object.name}</Text><Text className="schedule-meta">{object.note || '没有补充说明'}</Text></div><Space className="family-object-actions" wrap={false}><Button size="small" icon={<EditOutlined />} onClick={()=>{setEditingObject(object);objectForm.setFieldsValue({kind:object.kind,name:object.name,note:object.note});setObjectOpen(true);}}>编辑</Button><Popconfirm title="删除这个投保对象？" description="与其关联的家庭保单会保留，并进入待关联状态。" okText="删除" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:'danger',variant:'outlined'}} onConfirm={()=>mutate(`family:object:delete:${object.id}`,()=>api.deleteInsuredObject(familyId,object.id),'投保对象已删除')}><Button color="danger" variant="outlined" size="small" loading={Boolean(apiLoading[`family:object:delete:${object.id}`])}>删除</Button></Popconfirm></Space></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有财产投保对象" />}
        </Card>
        <Card className="panel-card family-service-card" title={<div><Title level={4}>待处理服务事项</Title><Text className="muted">只汇总已纳入家庭的保单服务事项，按事项记录展示。</Text></div>}>
          {family.services.length ? <div className="family-service-list">{family.services.map((service)=><div className="family-service-row" key={service.id}><Tag color={service.bucket==='overdue'?'red':service.bucket==='today'?'gold':'default'}>{service.bucket==='overdue'?'已逾期':service.bucket==='today'?'今天':'待处理'}</Tag><Text strong>{service.title}</Text><Text className="schedule-meta">{service.customerName} · {service.company} · {service.policyName} · {service.nextActionDate}</Text><Button size="small" loading={Boolean(apiLoading[`customer:open:${service.customerId}`])} onClick={()=>onOpenCustomer(service.customerId,familyId)}>打开客户档案</Button></div>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无开放的保单服务事项" />}
        </Card>
      </div>
    </div>

    <Modal title="编辑成员资料" open={memberEditOpen} onCancel={()=>setMemberEditOpen(false)} onOk={()=>memberEditForm.submit()} confirmLoading={Boolean(apiLoading[`family:member:update:${selectedMember?.id}`])} okText="保存资料" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={memberEditForm} layout="vertical" onFinish={saveMemberProfile}>
        {selectedMember?.isGuest ? <Form.Item name="guestName" label="家庭称呼" rules={[{required:true,message:'请填写称呼'}]}><Input maxLength={100} /></Form.Item> : null}
        <Form.Item name="note" label="家庭备注"><Input.TextArea rows={3} maxLength={500} placeholder="仅记录家庭关系整理所需的信息" /></Form.Item>
      </Form>
    </Modal>
    <Modal title="编辑家庭档案" open={familyEditOpen} onCancel={()=>setFamilyEditOpen(false)} onOk={()=>familyEditForm.submit()} confirmLoading={Boolean(apiLoading[`family:update:${family?.id}`])} okText="保存修改" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={familyEditForm} layout="vertical" onFinish={saveFamily}><Form.Item name="name" label="家庭名称" rules={[{required:true,message:'请填写家庭名称'}]}><Input maxLength={100} /></Form.Item><Form.Item name="primaryCustomerId" label="主要服务联系人" rules={[{required:true,message:'请选择已建档成员'}]}><Select options={family.members.filter((member)=>!member.isGuest).map((member)=>({value:member.customerId,label:member.name}))} /></Form.Item></Form>
    </Modal>
    <Modal title="添加家庭成员" open={memberOpen} onCancel={()=>setMemberOpen(false)} onOk={()=>memberForm.submit()} confirmLoading={Boolean(apiLoading[`family:member:add:${familyId}`])} okText="添加成员" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={memberForm} layout="vertical" onFinish={addMember}>
        <Form.Item name="customerId" label="关联已有客户（可选）"><Select showSearch filterOption={false} loading={Boolean(apiLoading['family:customer-lookup'])} notFoundContent={customerLookupEmpty} onSearch={searchCustomers} onChange={(value)=>{if(value)memberForm.setFieldValue('guestName',undefined);}} options={availableCustomerOptions.map((item)=>({value:item.id,label:`${item.name} · ${item.stage || '阶段未记录'} · ${item.source || '来源未记录'}`}))} placeholder="选择近期客户，或输入姓名、电话搜索" /></Form.Item>
        <Text className="muted family-customer-search-hint">打开时显示最近更新的客户档案，也可按姓名或电话搜索；本家庭已有成员不会重复显示。没有档案时，可只录入称呼。</Text>
        <Form.Item noStyle shouldUpdate={(previous,current)=>previous.customerId!==current.customerId}>{({getFieldValue})=>getFieldValue('customerId') ? <Text className="muted family-customer-search-hint">已关联客户档案，成员姓名以档案为准。</Text> : <Form.Item name="guestName" label="简要成员称呼"><Input maxLength={100} placeholder="例如：孩子、父亲" /></Form.Item>}</Form.Item>
        <Form.Item name="note" label="备注"><Input.TextArea maxLength={500} rows={2} /></Form.Item>
        <Divider />
        <Text strong>可同时确认与一位现有成员的关系</Text>
        <Form.Item name="otherMemberId" label="关系成员"><Select allowClear options={memberOptions} /></Form.Item>
        <Form.Item name="relationshipKind" label="关系类型"><Select allowClear options={Object.entries(kindLabels).map(([value,label])=>({value,label}))} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(prev,current)=>prev.relationshipKind!==current.relationshipKind}>{({getFieldValue})=>getFieldValue('relationshipKind')==='other' ? <Form.Item name="relationshipLabel" label="关系说明" rules={[{required:true,message:'请填写关系说明'}]}><Input maxLength={80} /></Form.Item> : null}</Form.Item>
      </Form>
    </Modal>
    <Modal title={editingRelationship?'编辑成员关系':'添加成员关系'} open={relationshipOpen} onCancel={()=>{setRelationshipOpen(false);setEditingRelationship(null);}} onOk={()=>relationshipForm.submit()} confirmLoading={Boolean(apiLoading[editingRelationship?`family:relationship:update:${editingRelationship.id}`:`family:relationship:create:${familyId}`])} okText="保存关系" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={relationshipForm} layout="vertical" onFinish={saveRelationship}>
        <Row gutter={12}><Col span={12}><Form.Item name="memberAId" label="成员 A" rules={[{required:true,message:'请选择成员'}]}><Select disabled={Boolean(editingRelationship)} options={memberOptions} /></Form.Item></Col><Col span={12}><Form.Item name="memberBId" label="成员 B" rules={[{required:true,message:'请选择成员'}]}><Select disabled={Boolean(editingRelationship)} options={memberOptions} /></Form.Item></Col></Row>
        <Form.Item name="kind" label="关系类型" rules={[{required:true,message:'请选择关系类型'}]}><Select options={Object.entries(kindLabels).map(([value,label])=>({value,label}))} /></Form.Item>
        <Form.Item noStyle shouldUpdate={(prev,current)=>prev.kind!==current.kind}>{({getFieldValue})=>getFieldValue('kind')==='other' ? <Form.Item name="label" label="关系说明" rules={[{required:true,message:'请填写关系说明'}]}><Input maxLength={80} /></Form.Item> : null}</Form.Item>
        <Text className="muted">父母与子女关系中，成员 A 表示父母，成员 B 表示子女。</Text>
      </Form>
    </Modal>
    <Modal title={editingObject?'编辑投保对象':'添加财产投保对象'} open={objectOpen} onCancel={()=>{setObjectOpen(false);setEditingObject(null);}} onOk={()=>objectForm.submit()} confirmLoading={Boolean(apiLoading[editingObject?`family:object:update:${editingObject.id}`:`family:object:create:${familyId}`])} okText="保存" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={objectForm} layout="vertical" onFinish={saveObject}><Form.Item name="kind" label="对象类型" rules={[{required:true,message:'请选择对象类型'}]}><Select options={Object.entries(objectLabels).map(([value,label])=>({value,label}))} /></Form.Item><Form.Item name="name" label="对象名称" rules={[{required:true,message:'请填写对象名称'}]}><Input maxLength={120} placeholder="例如：家庭自住房、家庭用车" /></Form.Item><Form.Item name="note" label="备注"><Input.TextArea maxLength={500} rows={3} /></Form.Item></Form>
    </Modal>
    <Modal title={editingPolicy?'编辑家庭保单归属':'关联家庭保单'} open={associateOpen} onCancel={()=>{setAssociateOpen(false);setEditingPolicy(null);}} onOk={()=>policyForm.submit()} confirmLoading={Boolean(apiLoading[`family:policy:link:${policyForm.getFieldValue('policyId')}`])} okText={editingPolicy?'保存归属':'确认关联'} cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      {candidatePolicies.length ? <Form form={policyForm} layout="vertical" onFinish={associatePolicy}>
        <Form.Item name="policyId" label="选择保单" rules={[{required:true,message:'请选择保单'}]}><Select disabled={Boolean(editingPolicy)} options={candidatePolicies.map((item)=>({value:item.id,label:`${item.company} · ${item.name} · ${item.customerName}`}))} onChange={()=>{policyForm.setFieldsValue({holderMemberIds:[],insuredMemberIds:[],insuredObjectIds:[],coverageTags:[]});}} /></Form.Item>
        <Form.Item name="holderMemberIds" label="投保人"><Select mode="multiple" allowClear options={memberOptions} placeholder="可暂不确认" /></Form.Item>
        <Form.Item name="insuredMemberIds" label="被保险人"><Select mode="multiple" allowClear options={memberOptions} placeholder="可暂不确认" /></Form.Item>
        <Form.Item name="insuredObjectIds" label="财产投保对象"><Select mode="multiple" allowClear options={family.insuredObjects.map((item)=>({value:item.id,label:`${objectLabels[item.kind]} · ${item.name}`}))} placeholder="可暂不关联" /></Form.Item>
        <Form.Item name="coverageTags" label="保障展示分类"><Select mode="multiple" options={Object.entries(coverageLabels).map(([value,label])=>({value,label}))} placeholder="选择便于整理的分类" /></Form.Item>
      </Form> : <Empty description="没有可关联的保单。候选范围是本家庭已建档客户名下、尚未纳入家庭的保单。" />}
    </Modal>
    <Modal title={`将“${associateCustomerMember?.name || '成员'}”关联到客户档案`} open={linkCustomerOpen} onCancel={()=>setLinkCustomerOpen(false)} onOk={()=>customerLinkForm.submit()} confirmLoading={Boolean(apiLoading[`family:member:link:${associateCustomerMember?.id}`])} okText="关联档案" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={customerLinkForm} layout="vertical" onFinish={linkGuest}><Form.Item name="customerId" label="选择客户档案" rules={[{required:true,message:'请选择客户档案'}]}><Select showSearch filterOption={false} loading={Boolean(apiLoading['family:customer-lookup'])} notFoundContent={customerLookupEmpty} onSearch={searchCustomers} options={availableCustomerOptions.map((item)=>({value:item.id,label:`${item.name} · ${item.stage || '阶段未记录'} · ${item.source || '来源未记录'}`}))} placeholder="选择近期客户，或输入姓名、电话搜索" /></Form.Item><Text className="muted family-customer-search-hint">打开时显示最近更新的客户档案；本家庭已有成员不会重复显示。</Text></Form>
    </Modal>
  </div>;
}
