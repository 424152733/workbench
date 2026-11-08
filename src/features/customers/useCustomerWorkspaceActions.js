import { useEffect, useMemo } from 'react';
import { Modal } from 'antd';
import dayjs from 'dayjs';
import { createRequestKey } from '../../utils/request-key.js';

export function useCustomerWorkspaceActions({
  api, performApiAction, messageApi, workspace, dashboardState, route,
  serviceWorkspace, dateValue, handleApiError, showSuccess, reloadDashboard,
  backendStatus, setBackendError,
}) {
  const {
    clients, setClients, selectedClient, setSelectedClient, clientQuery, sourceFilter,
    clientView, followUpTaskFilter, followUpTaskSearch, followUpTaskPage,
    followUpTaskPageData, setFollowUpTaskPageData, followUpTaskModalOpen,
    setFollowUpTaskModalOpen, followUpTaskMode, setFollowUpTaskMode,
    followUpTaskCustomerId, setFollowUpTaskCustomerId, followUpTaskServiceItemId,
    setFollowUpTaskServiceItemId, activeFollowUpTask, setActiveFollowUpTask,
    followUpTaskForm, completeTaskModalOpen, setCompleteTaskModalOpen,
    completeTaskForm, cancelTaskModalOpen, setCancelTaskModalOpen,
    cancelTaskTarget, setCancelTaskTarget, cancelTaskForm, clientModalOpen,
    setClientModalOpen, clientForm, clientEditOpen, setClientEditOpen,
    clientEditForm, policyModalOpen, setPolicyModalOpen, policyForm,
    followUpModalOpen, setFollowUpModalOpen, followUpForm, setClientView,
  } = workspace;
  const { dashboardMonth, setDashboard, setNotifications } = dashboardState;
  const { activeNav, go } = route;

  const reloadCustomers = async () => {
    const records = await api.customers({ search: clientQuery, source: sourceFilter });
    setClients(records);
    if (selectedClient) setSelectedClient(records.find((item) => item.id === selectedClient.id) || null);
  };

  useEffect(() => {
    if (backendStatus !== 'ok') return undefined;
    const timer = setTimeout(() => {
      performApiAction('customers:load', reloadCustomers).catch((error) => setBackendError(error.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [backendStatus, clientQuery, sourceFilter]);

  useEffect(() => {
    if (backendStatus !== 'ok' || activeNav !== 'clients' || clientView !== 'tasks') return undefined;
    performApiAction('followup-tasks:load', loadFollowUpTaskList).catch(handleApiError);
    return undefined;
  }, [backendStatus, activeNav, clientView, followUpTaskFilter, followUpTaskSearch, followUpTaskPage]);

  const filteredClients = useMemo(() => clients.filter((client) => {
    const q = clientQuery.trim().toLowerCase();
    const matchesQuery = !q || [client.name, client.phone, client.concern, client.source].some((value) => String(value || '').toLowerCase().includes(q));
    const matchesSource = sourceFilter === '全部来源' || client.source === sourceFilter;
    return matchesQuery && matchesSource;
  }), [clients, clientQuery, sourceFilter]);

  const openCustomer = async (customerId,{fromFamilyId}={}) => {
    try {
      const customer = await api.customer(customerId);
      setSelectedClient(customer);
      go('clients',{customerId,fromFamilyId});
      return customer;
    }
    catch (error) { handleApiError(error); }
  };

  const showPolicyServices = (policy) => {
    serviceWorkspace.showPolicyServices(policy.id);
    setSelectedClient(null);
    go('clients',{view:'services'});
  };

  const openServiceFromDashboard = (itemId) => {
    go('clients',{view:'services'});
    serviceWorkspace.openService(itemId);
  };

  const openPolicyReminder = async (reminder,kind) => {
    try {
      const customer = await performApiAction(`policy:reminder:${reminder.policyId}`,() => api.customer(reminder.customerId));
      const policy = customer.policies.find((entry) => entry.id === reminder.policyId);
      if (!policy) throw new Error('找不到提醒对应的保单');
      go('clients',{view:'services'});
      serviceWorkspace.openCreateService(policy,customer.id,kind);
    } catch (error) { handleApiError(error); }
  };

  const scheduleServiceContact = async (item) => {
    try {
      const customer = await performApiAction(`service:contact:${item.id}`,() => api.customer(item.customerId));
      openFollowUpTaskModal(customer,item.id);
    } catch (error) { handleApiError(error); }
  };

  const createRenewalPolicyForService = async (item) => {
    try {
      const customer = await performApiAction(`service:renewed-policy:${item.id}`,() => api.customer(item.customerId));
      const original = customer.policies.find((policy) => policy.id === item.policyId);
      setSelectedClient(customer);
      serviceWorkspace.setSelectedService(null);
      policyForm.setFieldsValue({
        company:original?.company || '人保财险',type:original?.type || '',scope:original?.scope || 'external',
        name:original?.name || '',state:'待核实',renewedFromPolicyId:item.policyId,
        effectiveDate:null,expiry:null,nextPaymentDate:null,
      });
      setPolicyModalOpen(true);
    } catch (error) { handleApiError(error); }
  };

  const saveClient = async (values,allowDuplicate = false) => {
    try {
      const customer = await api.createCustomer({ ...values,next:dateValue(values.next),preferredContact:values.preferredContact || null,allowDuplicate,taskRequestKey:values.next ? createRequestKey() : undefined });
      setClients((old) => [customer,...old]);
      setClientModalOpen(false);
      clientForm.resetFields();
      reloadDashboard();
      loadFollowUpTaskList().catch(() => {});
      api.notifications().then(setNotifications).catch(() => {});
      showSuccess(values.kind === '已有客户' ? '客户档案已建立' : '线索已添加');
    } catch (error) {
      if (error.status === 409 && !allowDuplicate) {
        Modal.confirm({
          title:'发现相同联系电话',
          content:`${error.details?.duplicate?.name || '已有客户'}的档案中记录了相同联系方式。请确认这是不同客户后再继续。`,
          okText:'确认仍要新增',cancelText:'返回核对',cancelButtonProps:{color:'danger',variant:'outlined'},
          onOk:() => performApiAction('customer:create',() => saveClient(values,true)),
        });
        return;
      }
      handleApiError(error);
    }
  };

  const openClientEdit = () => {
    clientEditForm.setFieldsValue({ name:selectedClient.name,source:selectedClient.source,stage:selectedClient.stage,concern:selectedClient.concern,contact:selectedClient.contact,preferredContact:selectedClient.preferredContact,contentRef:selectedClient.contentRef });
    setClientEditOpen(true);
  };

  const saveClientEdit = async (values) => {
    try {
      const updated = await api.updateCustomer(selectedClient.id,values);
      setClients((old) => old.map((item) => item.id === updated.id ? updated : item));
      setSelectedClient(updated);
      setClientEditOpen(false);
      reloadDashboard();
      loadFollowUpTaskList().catch(() => {});
      api.notifications().then(setNotifications).catch(() => {});
      showSuccess('客户档案已更新');
    } catch (error) { handleApiError(error); }
  };

  const changeStage = async (record,stage) => {
    try {
      const updated = await api.updateCustomer(record.id,{ stage });
      setClients((old) => old.map((item) => item.id === updated.id ? updated : item));
      if (selectedClient?.id === updated.id) setSelectedClient(updated);
      showSuccess('客户阶段已更新，变更已留档');
      reloadDashboard();
    } catch (error) { handleApiError(error); }
  };

  const savePolicy = async (values) => {
    if (!selectedClient) return;
    try {
      const result = await api.createPolicy(selectedClient.id,{ ...values,
        expiry:dateValue(values.expiry),effectiveDate:dateValue(values.effectiveDate),
        nextPaymentDate:dateValue(values.nextPaymentDate),scope:values.scope || 'external',
      });
      setClients((old) => old.map((client) => client.id === result.customer.id ? result.customer : client));
      setSelectedClient(result.customer);
      setPolicyModalOpen(false);
      policyForm.resetFields();
      reloadDashboard();
      showSuccess('保单已添加');
    } catch (error) { handleApiError(error); }
  };

  const verifyPolicy = async (policy) => {
    try {
      const updated = await api.verifyPolicy(policy.id,policy.state !== '已核实');
      setClients((old) => old.map((client) => client.id === updated.id ? updated : client));
      setSelectedClient(updated);
      reloadDashboard();
      showSuccess(policy.state === '已核实' ? '保单已标记为待核实' : '保单已核实');
    } catch (error) { handleApiError(error); }
  };

  const saveFollowUp = async (values) => {
    if (!selectedClient) return;
    try {
      const updated = await api.createFollowUp(selectedClient.id,{ ...values,next:dateValue(values.next),nextTitle:values.next ? '继续跟进' : undefined,taskRequestKey:values.next ? createRequestKey() : undefined });
      setClients((old) => old.map((client) => client.id === updated.id ? updated : client));
      setSelectedClient(updated);
      setFollowUpModalOpen(false);
      followUpForm.resetFields();
      reloadDashboard();
      loadFollowUpTaskList().catch(handleApiError);
      api.notifications().then(setNotifications).catch(() => {});
      showSuccess('跟进记录已保存');
    } catch (error) { handleApiError(error); }
  };

  const loadFollowUpTaskList = async () => {
    const status = followUpTaskFilter === 'completed' ? 'completed' : 'pending';
    const range = ['overdue','today','upcoming7'].includes(followUpTaskFilter) ? followUpTaskFilter : 'all';
    const result = await api.followUpTasks({status,range,search:followUpTaskSearch,limit:15,offset:(followUpTaskPage - 1) * 15});
    setFollowUpTaskPageData(result);
    return result;
  };

  const refreshAfterTaskChange = async (customerId) => {
    const [customer,summary,notificationList] = await Promise.all([api.customer(customerId),api.dashboard(dashboardMonth),api.notifications()]);
    setClients((old) => old.map((item) => item.id === customer.id ? customer : item));
    setSelectedClient((old) => old?.id === customer.id ? customer : old);
    setDashboard(summary);
    setNotifications(notificationList);
    if (activeNav === 'clients' && clientView === 'tasks') await loadFollowUpTaskList();
  };

  const refreshServiceAfterContact = async (serviceItemId) => {
    if (!serviceItemId) return;
    if (serviceWorkspace.selectedService?.id === serviceItemId) await serviceWorkspace.refreshSelected(serviceItemId);
    if (activeNav === 'clients' && clientView === 'services') await serviceWorkspace.loadServiceItems();
  };

  const openFollowUpTaskModal = (customer = selectedClient,serviceItemId=null,context=null) => {
    if (!customer) return;
    if (customer.contact === '已拒绝联系') { messageApi.warning('客户已拒绝联系，不能安排联系待办'); return; }
    setFollowUpTaskMode('create');
    setFollowUpTaskCustomerId(customer.id);
    setFollowUpTaskServiceItemId(serviceItemId);
    setActiveFollowUpTask(null);
    followUpTaskForm.setFieldsValue({title:context?.title || '跟进客户',method:customer.preferredContact || '电话',dueDate:null,dueTime:null,note:context?.note || ''});
    setFollowUpTaskModalOpen(true);
  };

  const openRescheduleTaskModal = (task) => {
    setFollowUpTaskMode('reschedule');
    setFollowUpTaskCustomerId(task.customerId);
    setActiveFollowUpTask(task);
    followUpTaskForm.setFieldsValue({title:task.title,method:task.method,dueDate:task.dueDate ? dayjs(task.dueDate) : null,dueTime:task.dueTime ? dayjs(`2000-01-01T${task.dueTime}`) : null,note:task.note,changeNote:''});
    setFollowUpTaskModalOpen(true);
  };

  const openCompleteTaskModal = (task) => {
    setActiveFollowUpTask(task);
    completeTaskForm.setFieldsValue({method:task.method || '其他',outcome:'contacted',note:'',scheduleNext:false,nextTitle:'继续跟进',nextMethod:task.method || '电话',nextDate:null,nextTime:null,nextNote:''});
    setCompleteTaskModalOpen(true);
  };

  const saveFollowUpTaskForm = async (values) => {
    const customerId = followUpTaskCustomerId;
    if (!customerId) return;
    const body = {title:values.title,method:values.method,note:values.note || '',dueDate:dateValue(values.dueDate),dueTime:values.dueTime?.format?.('HH:mm') || null,requestKey:createRequestKey(),changeNote:values.changeNote || '',allowDuplicate:Boolean(values.allowDuplicate),serviceItemId:followUpTaskMode==='create'?followUpTaskServiceItemId:undefined};
    try {
      await performApiAction(followUpTaskMode === 'create' ? 'followup-task:create' : `followup-task:update:${activeFollowUpTask?.id}`,() => followUpTaskMode === 'create' ? api.createFollowUpTask(customerId,body) : api.updateFollowUpTask(activeFollowUpTask.id,body));
      setFollowUpTaskModalOpen(false);
      followUpTaskForm.resetFields();
      await refreshAfterTaskChange(customerId);
      await refreshServiceAfterContact(followUpTaskMode === 'create' ? followUpTaskServiceItemId : activeFollowUpTask?.serviceItemId);
      showSuccess(followUpTaskMode === 'create' ? '跟进待办已安排' : '跟进时间已调整');
    } catch (error) {
      const duplicateId = error.details?.duplicateTaskId || error.details?.message?.duplicateTaskId;
      if (followUpTaskMode === 'create' && duplicateId && !values.allowDuplicate) {
        Modal.confirm({title:'发现相似的待办',content:'这位客户已有同一天、同一目的的未完成待办。仍要再安排一项吗？',okText:'仍要创建',cancelText:'返回核对',cancelButtonProps:{color:'danger',variant:'outlined'},onOk:() => saveFollowUpTaskForm({...values,allowDuplicate:true})});
        return;
      }
      handleApiError(error);
    }
  };

  const completeFollowUpTask = async (values) => {
    if (!activeFollowUpTask) return;
    const nextTask = values.scheduleNext ? {
      title:values.nextTitle || '继续跟进',method:values.nextMethod || '其他',note:values.nextNote || '',
      dueDate:dateValue(values.nextDate),dueTime:values.nextTime?.format?.('HH:mm') || null,requestKey:createRequestKey(),
    } : null;
    try {
      await performApiAction(`followup-task:complete:${activeFollowUpTask.id}`,() => api.completeFollowUpTask(activeFollowUpTask.id,{method:values.method,outcome:values.outcome,note:values.note,nextTask}));
      const customerId = activeFollowUpTask.customerId;
      setCompleteTaskModalOpen(false);
      completeTaskForm.resetFields();
      await refreshAfterTaskChange(customerId);
      await refreshServiceAfterContact(activeFollowUpTask.serviceItemId);
      showSuccess('待办已完成，联系结果已记入客户档案');
    } catch (error) { handleApiError(error); }
  };

  const cancelFollowUpTask = (task) => {
    setCancelTaskTarget(task);
    cancelTaskForm.resetFields();
    setCancelTaskModalOpen(true);
  };

  const saveCancelFollowUpTask = async (values) => {
    if (!cancelTaskTarget) return;
    try {
      await performApiAction(`followup-task:cancel:${cancelTaskTarget.id}`,() => api.cancelFollowUpTask(cancelTaskTarget.id,{note:values.note}));
      const customerId = cancelTaskTarget.customerId;
      setCancelTaskModalOpen(false);
      setCancelTaskTarget(null);
      await refreshAfterTaskChange(customerId);
      await refreshServiceAfterContact(cancelTaskTarget.serviceItemId);
      showSuccess('跟进待办已取消');
    } catch (error) { handleApiError(error); }
  };

  const changeClientView = (view) => {
    setClientView(view);
    go('clients',{view});
  };


  return { reloadCustomers, filteredClients, openCustomer, showPolicyServices, openServiceFromDashboard, openPolicyReminder, scheduleServiceContact, createRenewalPolicyForService, saveClient, openClientEdit, saveClientEdit, changeStage, savePolicy, verifyPolicy, saveFollowUp, loadFollowUpTaskList, refreshAfterTaskChange, refreshServiceAfterContact, openFollowUpTaskModal, openRescheduleTaskModal, openCompleteTaskModal, saveFollowUpTaskForm, completeFollowUpTask, cancelFollowUpTask, saveCancelFollowUpTask, changeClientView };
}
