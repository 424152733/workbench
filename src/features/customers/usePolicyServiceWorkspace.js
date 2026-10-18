import { useEffect, useState } from 'react';
import { Form } from 'antd';
import dayjs from 'dayjs';
import { api } from '../../api.js';
import { createRequestKey } from '../../utils/request-key.js';

const dateValue = (value) => value?.format ? value.format('YYYY-MM-DD') : value || null;
const openStatuses = ['pending','in_progress','waiting_customer','waiting_insurer'];

export function usePolicyServiceWorkspace({enabled,performApiAction,messageApi,onMutation}) {
  const [serviceStatus,setServiceStatus] = useState('open');
  const [serviceRange,setServiceRange] = useState('all');
  const [serviceKind,setServiceKind] = useState('');
  const [serviceSearch,setServiceSearch] = useState('');
  const [servicePage,setServicePage] = useState(1);
  const [servicePolicyId,setServicePolicyId] = useState(null);
  const [serviceData,setServiceData] = useState({items:[],total:0});
  const [selectedService,setSelectedService] = useState(null);
  const [createPolicy,setCreatePolicy] = useState(null);
  const [createKey,setCreateKey] = useState(null);
  const [actionMode,setActionMode] = useState(null);
  const [actionKey,setActionKey] = useState(null);
  const [lifecyclePolicy,setLifecyclePolicy] = useState(null);
  const [lifecycleData,setLifecycleData] = useState(null);
  const [createForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const [lifecycleForm] = Form.useForm();

  const loadServiceItems = async () => {
    const result = await performApiAction('service-items:load',() => api.serviceItems({
      status:serviceStatus,range:serviceRange,kind:serviceKind,search:serviceSearch,
      policyId:servicePolicyId,limit:15,offset:(servicePage-1)*15,
    }));
    setServiceData(result);
    return result;
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(() => loadServiceItems().catch((error) => messageApi.error(error.message)),serviceSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  },[enabled,serviceStatus,serviceRange,serviceKind,serviceSearch,servicePage,servicePolicyId]);

  const refreshSelected = async (id=selectedService?.id) => {
    if (!id) return null;
    const item = await performApiAction(`service-item:open:${id}`,() => api.serviceItem(id));
    setSelectedService(item);
    return item;
  };

  const refreshAfterMutation = async (customerId,itemId) => {
    const tasks = [onMutation(customerId)];
    if (enabled) tasks.push(loadServiceItems());
    if (itemId && selectedService?.id === itemId) tasks.push(refreshSelected(itemId));
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === 'rejected') messageApi.error(result.reason?.message || '刷新服务数据失败');
  };

  const openService = async (id) => {
    try { await refreshSelected(id); }
    catch (error) { messageApi.error(error.message || '无法打开服务事项'); }
  };

  const showPolicyServices = (policyId) => {
    setServicePolicyId(policyId);
    setServiceStatus('all');
    setServiceRange('all');
    setServicePage(1);
  };

  const clearPolicyFilter = () => { setServicePolicyId(null); setServicePage(1); };

  const openCreateService = (policy,customerId,kind='renewal') => {
    const anchorDate = kind === 'renewal' ? policy.expiryDate : kind === 'payment' ? policy.nextPaymentDate : null;
    const nextDate = anchorDate && anchorDate >= dayjs().format('YYYY-MM-DD') ? anchorDate : dayjs().format('YYYY-MM-DD');
    setCreatePolicy({...policy,customerId});
    setCreateKey(createRequestKey());
    createForm.setFieldsValue({
      kind,title:kind === 'renewal' ? `${policy.name}续保跟进` : kind === 'payment' ? `${policy.name}缴费核对` : `${policy.name}服务事项`,
      description:'',anchorDate:anchorDate ? dayjs(anchorDate) : null,nextActionDate:dayjs(nextDate),
    });
  };

  const saveCreateService = async (values) => {
    if (!createPolicy) return;
    try {
      const item = await performApiAction('service-item:create',() => api.createServiceItem(createPolicy.id,{
        kind:values.kind,title:values.title,description:values.description || '',
        anchorDate:dateValue(values.anchorDate),nextActionDate:dateValue(values.nextActionDate),requestKey:createKey,
      }));
      setCreatePolicy(null);
      createForm.resetFields();
      setSelectedService(item);
      await refreshAfterMutation(item.customerId,item.id);
      messageApi.success('服务事项已建立');
    } catch (error) {
      const existingId = error.details?.existingServiceItemId || error.details?.message?.existingServiceItemId;
      if (existingId) {
        setCreatePolicy(null);
        await openService(existingId);
        messageApi.warning('同一周期已有进行中的事项，已打开原事项');
      } else messageApi.error(error.message || '创建失败');
    }
  };

  const openAction = (mode,item=selectedService) => {
    if (!item) return;
    setSelectedService(item);
    setActionMode(mode);
    setActionKey(createRequestKey());
    actionForm.setFieldsValue({
      title:item.title,description:item.description,nextActionDate:item.nextActionDate ? dayjs(item.nextActionDate) : null,
      status:openStatuses.includes(item.status) ? item.status : 'in_progress',note:'',changeNote:'',outcome:'',reason:'',closedOn:dayjs(),
    });
  };

  const saveAction = async (values) => {
    if (!selectedService || !actionMode) return;
    const id = selectedService.id;
    try {
      const item = await performApiAction(`service-item:${actionMode}:${id}`,() => {
        if (actionMode === 'edit') return api.updateServiceItem(id,{
          title:values.title,description:values.description || '',nextActionDate:dateValue(values.nextActionDate),changeNote:values.changeNote,
        });
        if (actionMode === 'progress') return api.recordServiceProgress(id,{
          status:values.status,note:values.note,nextActionDate:dateValue(values.nextActionDate),requestKey:actionKey,
        });
        if (actionMode === 'complete') return api.completeServiceItem(id,{outcome:values.outcome,closedOn:dateValue(values.closedOn),requestKey:actionKey});
        return api.cancelServiceItem(id,{reason:values.reason,closedOn:dateValue(values.closedOn),requestKey:actionKey});
      });
      setActionMode(null);
      actionForm.resetFields();
      setSelectedService(item);
      await refreshAfterMutation(item.customerId,id);
      messageApi.success(actionMode === 'complete' ? '服务事项已完成' : actionMode === 'cancel' ? '服务事项已取消' : '服务事项已更新');
    } catch (error) { messageApi.error(error.message || '保存失败'); }
  };

  const openLifecycle = async (policy) => {
    try {
      const record = await performApiAction(`policy:lifecycle:open:${policy.id}`,() => api.policyLifecycle(policy.id));
      setLifecyclePolicy(policy);
      setLifecycleData(record);
      lifecycleForm.setFieldsValue({
        contractStatus:record.contractStatus,effectiveDate:record.effectiveDate ? dayjs(record.effectiveDate) : null,
        expiryDate:record.expiryDate ? dayjs(record.expiryDate) : null,
        nextPaymentDate:record.nextPaymentDate ? dayjs(record.nextPaymentDate) : null,
        statusConfirmedOn:record.statusConfirmedOn ? dayjs(record.statusConfirmedOn) : null,
        statusBasis:record.statusBasis || '',reason:'',
      });
    } catch (error) { messageApi.error(error.message || '无法读取保单状态'); }
  };

  const saveLifecycle = async (values) => {
    if (!lifecyclePolicy) return;
    try {
      const customer = await performApiAction(`policy:lifecycle:save:${lifecyclePolicy.id}`,() => api.updatePolicyLifecycle(lifecyclePolicy.id,{
        contractStatus:values.contractStatus,effectiveDate:dateValue(values.effectiveDate),
        expiryDate:dateValue(values.expiryDate),nextPaymentDate:dateValue(values.nextPaymentDate),
        statusConfirmedOn:dateValue(values.statusConfirmedOn),statusBasis:values.statusBasis || '',reason:values.reason,
      }));
      const record = await api.policyLifecycle(lifecyclePolicy.id);
      setLifecycleData(record);
      setLifecyclePolicy(null);
      lifecycleForm.resetFields();
      await refreshAfterMutation(customer.id);
      messageApi.success('保单状态与日期已更新');
    } catch (error) { messageApi.error(error.message || '保存保单状态失败'); }
  };

  return {
    serviceStatus,setServiceStatus,serviceRange,setServiceRange,serviceKind,setServiceKind,
    serviceSearch,setServiceSearch,servicePage,setServicePage,servicePolicyId,setServicePolicyId,
    serviceData,selectedService,setSelectedService,createPolicy,setCreatePolicy,createForm,
    actionMode,setActionMode,actionForm,lifecyclePolicy,setLifecyclePolicy,lifecycleData,lifecycleForm,
    loadServiceItems,refreshSelected,openService,showPolicyServices,clearPolicyFilter,
    openCreateService,saveCreateService,openAction,saveAction,openLifecycle,saveLifecycle,
  };
}
