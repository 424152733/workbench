async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const rawMessage = typeof payload === 'string' ? payload : payload.message || '请求失败';
    const message = rawMessage && typeof rawMessage === 'object' ? rawMessage.message || '请求失败' : rawMessage;
    const error = new Error(Array.isArray(message) ? message.join('；') : message);
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return payload;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => request('/health'),
  sources: () => request('/sources'),
  dashboard: (month) => request(`/dashboard${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  customers: ({ search = '', source = '' } = {}) => {
    const query = new URLSearchParams();
    if (search) query.set('search',search);
    if (source && source !== '全部来源') query.set('source',source);
    return request(`/customers${query.size ? `?${query}` : ''}`);
  },
  customerAnalytics: ({ from = '', to = '', sourceCode = '' } = {}) => {
    const query = new URLSearchParams();
    if (from) query.set('from',from);
    if (to) query.set('to',to);
    if (sourceCode) query.set('sourceCode',sourceCode);
    return request(`/customers/analytics${query.size ? `?${query}` : ''}`);
  },
  customerAcquisitionSources: () => request('/customers/acquisition-sources'),
  customer: (id) => request(`/customers/${id}`),
  customerCoverageReview: (id) => request(`/customers/${id}/coverage-review`),
  saveCustomerCoverageProfile: (id,profile) => request(`/customers/${id}/coverage-profile`,json('PUT',{profile})),
  updateCustomerAcquisition: (id,body) => request(`/customers/${id}/acquisition`,json('PATCH',body)),
  lookupCustomers: (search) => request(`/customers/lookup?search=${encodeURIComponent(search || '')}`),
  customerFamilies: (customerId) => request(`/customers/${customerId}/families`),
  families: ({search=''}={}) => request(`/families${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  family: (id) => request(`/families/${id}`),
  createFamily: (body) => request('/families',json('POST',body)),
  updateFamily: (id,body) => request(`/families/${id}`,json('PATCH',body)),
  deleteFamily: (id) => request(`/families/${id}`,{method:'DELETE'}),
  addFamilyMember: (id,body) => request(`/families/${id}/members`,json('POST',body)),
  updateFamilyMember: (familyId,memberId,body) => request(`/families/${familyId}/members/${memberId}`,json('PATCH',body)),
  removeFamilyMember: (familyId,memberId) => request(`/families/${familyId}/members/${memberId}`,{method:'DELETE'}),
  createFamilyRelationship: (familyId,body) => request(`/families/${familyId}/relationships`,json('POST',body)),
  updateFamilyRelationship: (familyId,relationshipId,body) => request(`/families/${familyId}/relationships/${relationshipId}`,json('PATCH',body)),
  deleteFamilyRelationship: (familyId,relationshipId) => request(`/families/${familyId}/relationships/${relationshipId}`,{method:'DELETE'}),
  createInsuredObject: (familyId,body) => request(`/families/${familyId}/insured-objects`,json('POST',body)),
  updateInsuredObject: (familyId,objectId,body) => request(`/families/${familyId}/insured-objects/${objectId}`,json('PATCH',body)),
  deleteInsuredObject: (familyId,objectId) => request(`/families/${familyId}/insured-objects/${objectId}`,{method:'DELETE'}),
  familyPolicyCandidates: (familyId) => request(`/families/${familyId}/policy-candidates`),
  linkFamilyPolicy: (familyId,policyId,body) => request(`/families/${familyId}/policies/${policyId}`,json('PUT',body)),
  unlinkFamilyPolicy: (familyId,policyId) => request(`/families/${familyId}/policies/${policyId}`,{method:'DELETE'}),
  familyPolicyReview: (familyId) => request(`/families/${familyId}/policy-review`),
  familyContractCandidates: (familyId) => request(`/families/${familyId}/policy-contract-candidates`),
  linkFamilyContract: (familyId,contractId,body) => request(`/families/${familyId}/policy-contracts/${contractId}`,json('PUT',body)),
  unlinkFamilyContract: (familyId,contractId) => request(`/families/${familyId}/policy-contracts/${contractId}`,{method:'DELETE'}),
  unlinkFamilyPolicySource: (familyId,source) => request(`/families/${familyId}/policy-review/source`,json('DELETE',source)),
  uploadFamilyContract: (familyId,file,body={}) => {
    const form=new FormData();
    form.append('file',file);
    form.append('customerId',String(body.customerId||''));
    for(const role of ['holderMemberIds','insuredMemberIds']) form.append(role,JSON.stringify(body[role]||[]));
    return request(`/families/${familyId}/policy-contracts`,{method:'POST',body:form});
  },
  saveFamilyCoverageContext: (familyId,body) => request(`/families/${familyId}/coverage-context`,json('PUT',body)),
  saveFamilyMemberCoverageProfile: (familyId,memberId,body) => request(`/families/${familyId}/members/${memberId}/coverage-profile`,json('PUT',body)),
  exportFamilyPolicyOrganizer: async (familyId,familyName='家庭') => {
    const response=await fetch(`/api/families/${familyId}/policy-organizer/export`);
    if(!response.ok) {
      const payload=await response.json().catch(()=>({}));
      throw new Error(Array.isArray(payload.message)?payload.message.join('；'):payload.message||'家庭保单整理表导出失败');
    }
    const blob=await response.blob();
    const encodedName=(response.headers.get('content-disposition')||'').match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    let fileName=`${String(familyName).replace(/[\\/:*?"<>|]/g,'_')}_家庭保单整理.xlsx`;
    if(encodedName) {try{fileName=decodeURIComponent(encodedName);}catch{}}
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  createCustomer: (body) => request('/customers',json('POST',body)),
  updateCustomer: (id,body) => request(`/customers/${id}`,json('PATCH',body)),
  createPolicy: (id,body) => request(`/customers/${id}/policies`,json('POST',body)),
  deletePolicy: (customerId,policyId) => request(`/customers/${customerId}/policies/${policyId}`,{method:'DELETE'}),
  policyContracts: (customerId) => request(`/customers/${customerId}/policy-contracts`),
  uploadPolicyContract: (customerId,file) => {
    const body=new FormData();
    body.append('file',file);
    return request(`/customers/${customerId}/policy-contracts`,{method:'POST',body});
  },
  analyzePolicyContract: (customerId,documentId,consent) => request(`/customers/${customerId}/policy-contracts/${documentId}/analyze`,json('POST',{consent})),
  deletePolicyContract: (customerId,documentId) => request(`/customers/${customerId}/policy-contracts/${documentId}`,{method:'DELETE'}),
  savePolicyContractAsPolicy: (customerId,documentId,body) => request(`/customers/${customerId}/policy-contracts/${documentId}/save-policy`,json('POST',body)),
  syncPolicyContractScheduleFacts: (customerId,documentId) => request(`/customers/${customerId}/policy-contracts/${documentId}/sync-schedule-facts`,json('POST',{})),
  exportPolicyOrganizer: async (customerId,customerName='客户') => {
    const response=await fetch(`/api/customers/${customerId}/policy-organizer/export`);
    if (!response.ok) {
      const contentType=response.headers.get('content-type') || '';
      let message='保单整理表导出失败';
      if (contentType.includes('application/json')) {
        const payload=await response.json();
        message=Array.isArray(payload.message)?payload.message.join('；'):payload.message || message;
      } else message=(await response.text()) || message;
      throw new Error(message);
    }
    const blob=await response.blob();
    const disposition=response.headers.get('content-disposition') || '';
    const encodedName=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    let fileName=`${String(customerName || '客户').replace(/[\\/:*?"<>|]/g,'_')}_家庭保单整理_${today}.xlsx`;
    if (encodedName) { try { fileName=decodeURIComponent(encodedName); } catch {} }
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=fileName;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  policyContractFileUrl: (customerId,documentId) => `/api/customers/${customerId}/policy-contracts/${documentId}/file`,
  verifyPolicy: (id,verified) => request(`/policies/${id}`,json('PATCH',{verified})),
  policyLifecycle: (id) => request(`/policies/${id}/lifecycle`),
  updatePolicyLifecycle: (id,body) => request(`/policies/${id}/lifecycle`,json('PATCH',body)),
  serviceItems: ({status='open',range='all',kind='',search='',customerId='',policyId='',limit=20,offset=0}={}) => {
    const query = new URLSearchParams({status,range,limit:String(limit),offset:String(offset)});
    if (kind) query.set('kind',kind);
    if (search) query.set('search',search);
    if (customerId) query.set('customerId',String(customerId));
    if (policyId) query.set('policyId',String(policyId));
    return request(`/service-items?${query}`);
  },
  serviceItem: (id) => request(`/service-items/${id}`),
  createServiceItem: (policyId,body) => request(`/policies/${policyId}/service-items`,json('POST',body)),
  updateServiceItem: (id,body) => request(`/service-items/${id}`,json('PATCH',body)),
  recordServiceProgress: (id,body) => request(`/service-items/${id}/progress`,json('POST',body)),
  completeServiceItem: (id,body) => request(`/service-items/${id}/complete`,json('POST',body)),
  cancelServiceItem: (id,body) => request(`/service-items/${id}/cancel`,json('POST',body)),
  createFollowUp: (id,body) => request(`/customers/${id}/followups`,json('POST',body)),
  followUpTasks: ({status='pending',range='all',search='',customerId='',limit=100,offset=0}={}) => {
    const query = new URLSearchParams({status,range,limit:String(limit),offset:String(offset)});
    if (search) query.set('search',search);
    if (customerId) query.set('customerId',String(customerId));
    return request(`/follow-up-tasks?${query}`);
  },
  createFollowUpTask: (customerId,body) => request(`/customers/${customerId}/follow-up-tasks`,json('POST',body)),
  updateFollowUpTask: (taskId,body) => request(`/follow-up-tasks/${taskId}`,json('PATCH',body)),
  completeFollowUpTask: (taskId,body) => request(`/follow-up-tasks/${taskId}/complete`,json('POST',body)),
  cancelFollowUpTask: (taskId,body) => request(`/follow-up-tasks/${taskId}/cancel`,json('POST',body)),
  exportCustomers: async () => {
    const response = await fetch('/api/customers/export');
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || '客户导出失败');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `insurance-customers-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  },
  contentTypes: () => request('/content/types'),
  topics: (type='') => request(`/topics${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  createTopic: (body) => request('/topics',json('POST',body)),
  deleteTopic: (id) => request(`/topics/${id}`,{method:'DELETE'}),
  updateTopic: (id,body) => request(`/topics/${id}`,json('PATCH',body)),
  suggestTopics: (insuranceType = '不限',excludeTitles = []) => {
    const query = new URLSearchParams();
    if (insuranceType && insuranceType !== '不限') query.set('insuranceType',insuranceType);
    if (excludeTitles.length) query.set('exclude',JSON.stringify(excludeTitles));
    return request(`/topics/suggest${query.size ? `?${query}` : ''}`);
  },
  generateDrafts: (id) => request(`/topics/${id}/generate`,json('POST',{})),
  draftVersions: (id,platform) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/versions`),
  restoreDraftVersion: (id,platform,version) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/versions/${version}/restore`,json('POST',{})),
  saveDraft: (id,platform,body) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}`,json('PATCH',body)),
  humanizeDraft: (id,platform) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/humanize`,json('POST',{})),
  generateCardPlan: (id,platform) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/card-plan/generate`,json('POST',{})),
  approveDraft: (id,platform,checks) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/approve`,json('POST',{checks})),
  publishDraft: (id,platform,body) => request(`/topics/${id}/drafts/${encodeURIComponent(platform)}/publish`,json('POST',body)),
  publications: (filters={}) => {
    const query = new URLSearchParams();
    for (const [key,value] of Object.entries(filters)) if (value !== '' && value !== null && value !== undefined) query.set(key,String(value));
    return request(`/publications${query.size ? `?${query}` : ''}`);
  },
  publication: (id) => request(`/publications/${id}`),
  correctPublication: (id,body) => request(`/publications/${id}`,json('PATCH',body)),
  voidPublication: (id,body) => request(`/publications/${id}/void`,json('POST',body)),
  generateImage: (id,platform,imageOptions) => request(`/topics/${id}/images/generate`,json('POST',{platform,imageOptions})),
  productCenterMeta: () => request('/product-center/meta'),
  productCenterPlatformSettings: () => request('/product-center/platform-settings'),
  updateProductPlatformSettings: (platform,body) => request(`/product-center/platform-settings/${encodeURIComponent(platform)}`,json('PATCH',body)),
  productCenterProducts: ({search='',status='',officialSaleStatus=''}={}) => {
    const query = new URLSearchParams();
    if (search) query.set('search',search);
    if (status) query.set('status',status);
    if (officialSaleStatus) query.set('officialSaleStatus',officialSaleStatus);
    return request(`/product-center/products${query.size ? `?${query}` : ''}`);
  },
  updateProductSyncCompany: (companyCode,syncEnabled) => request(`/product-center/companies/${encodeURIComponent(companyCode)}`,json('PATCH',{syncEnabled})),
  startProductSync: (companyCodes) => request('/product-center/sync-runs',json('POST',{companyCodes})),
  productSyncRuns: () => request('/product-center/sync-runs'),
  productSyncRun: (runId) => request(`/product-center/sync-runs/${encodeURIComponent(runId)}`),
  createInsuranceProduct: (body) => request('/product-center/products',json('POST',body)),
  productCenterWorkspace: (id) => request(`/product-center/products/${id}`),
  updateInsuranceProduct: (id,body) => request(`/product-center/products/${id}`,json('PATCH',body)),
  deleteInsuranceProduct: (id) => request(`/product-center/products/${id}`,{method:'DELETE'}),
  uploadProductDocument: (productId,file,documentType) => {
    const form = new FormData();
    form.set('file',file);
    form.set('documentType',documentType);
    return request(`/product-center/products/${productId}/documents`,{method:'POST',body:form});
  },
  importOfficialProductMaterial: (productId,materialId) => request(`/product-center/products/${productId}/official-materials/${materialId}/import`,json('POST',{})),
  productDocumentUrl: (id) => `/api/product-center/documents/${id}/file`,
  downloadProductDocument: async (id,fileName) => {
    const response = await fetch(`/api/product-center/documents/${id}/file`);
    if (!response.ok) throw new Error(await response.text() || '产品资料下载失败');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `product-document-${id}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  },
  deleteProductDocument: (id) => request(`/product-center/documents/${id}`,{method:'DELETE'}),
  analyzeProductDocument: (id) => request(`/product-center/documents/${id}/analyze`,json('POST',{})),
  analyzeProductMaterials: (productId) => request(`/product-center/products/${productId}/analyze`,json('POST',{})),
  updateProductExtraction: (id,facts) => request(`/product-center/extractions/${id}`,json('PATCH',{facts})),
  confirmProductExtraction: (id) => request(`/product-center/extractions/${id}/confirm`,json('POST',{})),
  generateProductCopyDraft: (extractionId,platform) => request(`/product-center/extractions/${extractionId}/drafts/${encodeURIComponent(platform)}/generate`,json('POST',{})),
  saveProductCopyDraft: (id,body) => request(`/product-center/drafts/${id}`,json('PATCH',body)),
  approveProductCopyDraft: (id,checks) => request(`/product-center/drafts/${id}/approve`,json('POST',{checks})),
  productCopyDraftVersions: (id) => request(`/product-center/drafts/${id}/versions`),
  restoreProductCopyDraftVersion: (id,version) => request(`/product-center/drafts/${id}/versions/${version}/restore`,json('POST',{})),
  downloadAsset: async (id,fileName) => {
    const response = await fetch(`/api/assets/${id}?download=1`);
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `insurance-image-${id}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  },
  uploadAsset: async (id,platform,file) => {
    const form = new FormData();
    form.append('platform',platform);
    form.append('file',file);
    return request(`/topics/${id}/assets`,{method:'POST',body:form});
  },
  deleteAsset: (id) => request(`/assets/${id}`,{method:'DELETE'}),
  asset: (id,download = false) => `/api/assets/${id}${download ? '?download=1' : ''}`,
  calendar: (month) => request(`/calendar${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  workCalendarEvents: (month) => request(`/work-calendar/events?month=${encodeURIComponent(month)}`),
  createWorkCalendarEvent: (body) => request('/work-calendar/events',json('POST',body)),
  updateWorkCalendarEvent: (id,body) => request(`/work-calendar/events/${encodeURIComponent(id)}`,json('PATCH',body)),
  notifications: () => request('/notifications'),
  settings: () => request('/settings'),
  updateSettings: (body) => request('/settings',json('PATCH',body)),
};

