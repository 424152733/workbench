import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Row, Col, Select, Space, Spin, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';

const {Text,Title} = Typography;

export function FamilyListPanel({api,apiLoading,performApiAction,onError,onSuccess,onOpenFamily,clients=[],primaryCustomerId=null}) {
  const [families,setFamilies] = useState([]);
  const [search,setSearch] = useState('');
  const [createOpen,setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const listKey = 'families:list';
  const createKey = 'families:create';

  const load = async () => {
    try {
      const result = await performApiAction(listKey,() => api.families({search}));
      setFamilies(result);
    } catch (error) { onError(error); }
  };

  useEffect(() => { load(); },[search]);

  const create = async (values) => {
    try {
      const family = await performApiAction(createKey,() => api.createFamily({
        name:values.name,primaryCustomerId:primaryCustomerId || values.primaryCustomerId,
      }));
      setCreateOpen(false);
      form.resetFields();
      onSuccess('家庭档案已建立');
      onOpenFamily(family.id);
    } catch (error) { onError(error); }
  };

  const remove = async (family) => {
    try {
      await performApiAction(`families:delete:${family.id}`,() => api.deleteFamily(family.id));
      setFamilies((current) => current.filter((item)=>item.id!==family.id));
      onSuccess('家庭档案及其关系与保单关联已删除');
    } catch (error) { onError(error); }
  };

  return <div className="family-list-panel">
    <div className="page-heading family-list-heading">
      <div><Title level={3}>家庭规划</Title><Text className="muted">先把家庭成员和已有保障整理清楚，后续可继续补充财务与风险资料。</Text></div>
    </div>
    {primaryCustomerId ? <Alert className="family-context-alert" type="info" showIcon message="此客户会作为家庭的主要服务联系人。" /> : null}
    <div className="family-list-toolbar">
      <Input allowClear prefix={<SearchOutlined />} suffix={apiLoading[listKey] ? <Spin size="small" /> : null} value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="搜索家庭名称" />
      <Button type="primary" icon={<PlusOutlined />} onClick={()=>{form.resetFields();if(primaryCustomerId)form.setFieldValue('primaryCustomerId',primaryCustomerId);setCreateOpen(true);}}>建立家庭</Button>
    </div>
    {apiLoading[listKey] && !families.length ? <div className="page-loading"><Spin /></div> : families.length ? <Row gutter={[14,14]}>
      {families.map((family)=><Col xs={24} md={12} xl={8} key={family.id}>
        <Card className="panel-card family-list-card" actions={[
          <Button key="open" size="small" onClick={()=>onOpenFamily(family.id)}>查看家庭规划</Button>,
          <Popconfirm key="delete" title="删除这个家庭？" description="成员关系、投保对象和家庭保单关联会一并删除，客户与保单档案会保留。" okText="删除家庭" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} okButtonProps={{color:"danger",variant:"outlined"}} onConfirm={()=>remove(family)}>
            <Button size="small" color="danger" variant="outlined" aria-label={`删除${family.name}`} loading={Boolean(apiLoading[`families:delete:${family.id}`])} icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>,
        ]}>
          <div className="family-list-card-title"><TeamOutlined /><Text strong>{family.name}</Text></div>
          <Text className="muted">主要联系人：{family.primaryCustomerName}</Text>
          <div className="family-list-stats"><span>{family.memberCount} 位成员</span><span>{family.policyCount} 份保单</span><span>{family.unverifiedCount} 份待核实</span></div>
        </Card>
      </Col>)}
    </Row> : <Card className="panel-card family-empty-card"><Empty description="还没有家庭档案"><Button onClick={load}>重新加载</Button></Empty></Card>}

    <Modal title="建立家庭档案" open={createOpen} onCancel={()=>setCreateOpen(false)} onOk={()=>form.submit()} confirmLoading={Boolean(apiLoading[createKey])} okText="建立家庭" cancelText="取消" cancelButtonProps={{color:"danger",variant:"outlined"}} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={create}>
        <Form.Item name="name" label="家庭名称" rules={[{required:true,message:'请填写家庭名称'}]}><Input maxLength={100} placeholder="例如：林女士家庭" /></Form.Item>
        {!primaryCustomerId ? <Form.Item name="primaryCustomerId" label="主要服务联系人" rules={[{required:true,message:'请选择一位已建档客户'}]}><Select showSearch optionFilterProp="label" options={clients.map((client)=>({value:client.id,label:`${client.name} · ${client.phone || client.source}`}))} placeholder="选择已有客户档案" /></Form.Item> : null}
      </Form>
    </Modal>
  </div>;
}
