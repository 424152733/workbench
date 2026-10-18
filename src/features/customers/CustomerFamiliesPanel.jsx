import { useEffect, useState } from 'react';
import { Button, Card, Empty, Form, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { ArrowRightOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons';

const {Text,Title} = Typography;

export function CustomerFamiliesPanel({customer,api,apiLoading,performApiAction,onOpenFamily,onError,onSuccess}) {
  const [families,setFamilies] = useState([]);
  const [allFamilies,setAllFamilies] = useState([]);
  const [createOpen,setCreateOpen] = useState(false);
  const [joinOpen,setJoinOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [joinForm] = Form.useForm();
  const load = async () => {
    try { setFamilies(await performApiAction(`customer:families:${customer.id}`,()=>api.customerFamilies(customer.id))); }
    catch (error) { onError(error); }
  };
  useEffect(()=>{load();},[customer.id]);

  const create = async (values) => {
    try {
      const family = await performApiAction(`customer:family:create:${customer.id}`,()=>api.createFamily({name:values.name,primaryCustomerId:customer.id}));
      setCreateOpen(false);createForm.resetFields();onSuccess('家庭档案已建立');onOpenFamily(family.id);
    } catch (error) { onError(error); }
  };
  const startJoin = async () => {
    try {
      const rows = await performApiAction(`customer:families:available:${customer.id}`,()=>api.families());
      setAllFamilies(rows.filter((family)=>!families.some((memberOf)=>memberOf.id===family.id)));
      joinForm.resetFields();setJoinOpen(true);
    } catch (error) { onError(error); }
  };
  const join = async (values) => {
    try {
      const updated = await performApiAction(`customer:family:join:${customer.id}`,()=>api.addFamilyMember(values.familyId,{customerId:customer.id}));
      setJoinOpen(false);await load();onSuccess('客户已加入家庭，请在家庭页面确认成员关系');
      if (updated?.id) onOpenFamily(updated.id);
    } catch (error) { onError(error); }
  };

  return <Card className="panel-card customer-families-panel" title={<span><TeamOutlined />　所属家庭</span>} extra={<Space><Button size="small" icon={<PlusOutlined />} onClick={startJoin} loading={Boolean(apiLoading[`customer:families:available:${customer.id}`])}>加入已有家庭</Button><Button type="primary" size="small" icon={<PlusOutlined />} onClick={()=>setCreateOpen(true)}>建立家庭</Button></Space>}>
    {apiLoading[`customer:families:${customer.id}`] && !families.length ? <Spin /> : families.length ? <div className="customer-family-list">{families.map((family)=><button className="customer-family-row" key={family.id} onClick={()=>onOpenFamily(family.id)}>
      <div><Text strong>{family.name}</Text><Text className="schedule-meta">主要联系人：{family.primaryCustomerName} · {family.memberCount} 位成员 · {family.policyCount} 份保单</Text></div><ArrowRightOutlined />
    </button>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未加入家庭" />}
    <Modal title="建立家庭档案" open={createOpen} onCancel={()=>setCreateOpen(false)} onOk={()=>createForm.submit()} confirmLoading={Boolean(apiLoading[`customer:family:create:${customer.id}`])} okText="建立家庭" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={createForm} layout="vertical" onFinish={create}><Form.Item name="name" label="家庭名称" rules={[{required:true,message:'请填写家庭名称'}]}><Input maxLength={100} placeholder={`例如：${customer.name}家庭`} /></Form.Item><Text className="muted">{customer.name}将作为主要服务联系人。</Text></Form>
    </Modal>
    <Modal title="加入已有家庭" open={joinOpen} onCancel={()=>setJoinOpen(false)} onOk={()=>joinForm.submit()} confirmLoading={Boolean(apiLoading[`customer:family:join:${customer.id}`])} okText="加入家庭" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={joinForm} layout="vertical" onFinish={join}><Form.Item name="familyId" label="选择家庭" rules={[{required:true,message:'请选择一个家庭'}]}><Select placeholder="选择家庭" options={allFamilies.map((family)=>({value:family.id,label:`${family.name} · ${family.memberCount} 位成员`}))} /></Form.Item><Text className="muted">加入后会先作为未确认关系的成员，可在家庭关系页补充与其他成员的关系。</Text></Form>
    </Modal>
  </Card>;
}
