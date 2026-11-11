import {
  BadRequestException, Controller, Delete, Get, Inject, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { WorkbenchService } from './workbench.service.js';
import { MAX_IMAGE_BYTES } from './image-utils.js';
import { PRODUCT_DOCUMENT_UPLOAD_DIR } from './product-center-operations.js';
import { PRODUCT_DOCUMENT_EXTENSIONS, PRODUCT_DOCUMENT_MAX_BYTES } from './product-document-parser.js';
import { POLICY_CONTRACT_EXTENSIONS, POLICY_CONTRACT_MAX_BYTES } from './policy-contract-parser.js';
import { POLICY_CONTRACT_UPLOAD_DIR } from './policy-contract-operations.js';
import { beijingDate } from './workbench-primitives.js';

const uploadDir = path.resolve('backend/uploads');
mkdirSync(uploadDir,{ recursive: true });
mkdirSync(PRODUCT_DOCUMENT_UPLOAD_DIR,{ recursive: true });
mkdirSync(POLICY_CONTRACT_UPLOAD_DIR,{ recursive: true });

export class ApiController {
  constructor(service) { this.service = service; }
  health() { return this.service.health(); }
  sources() { return this.service.sources(); }
  customerAcquisitionSources() { return this.service.customerAcquisitionSources(); }
  dashboard(req) { return this.service.dashboard({ month: req.query.month }); }
  calendar(req) { return this.service.calendar(req.query.month); }
  workCalendarEvents(req) { return this.service.listWorkCalendarEvents(req.query.month); }
  createWorkCalendarEvent(req) { return this.service.createWorkCalendarEvent(req.body); }
  updateWorkCalendarEvent(req) { return this.service.updateWorkCalendarEvent(req.params.eventId,req.body); }
  settings() { return this.service.getSettings(); }
  updateSettings(req) { return this.service.updateSettings(req.body); }
  async notifications() {
    const [dashboard,topics] = await Promise.all([this.service.dashboard(),this.service.listTopics()]);
    const output = dashboard.urgentTasks.map((item) => ({ id: `follow-${item.id}`,type:'followup',title:`${item.bucket === 'overdue' ? '已逾期' : '今天'} · ${item.name} · ${item.title}`,detail:item.note || item.concern,customerId:item.customerId,taskId:item.id,date:item.next,bucket:item.bucket }));
    for (const item of dashboard.urgentServiceItems || []) output.push({
      id:`service-${item.id}`,type:'service',title:`${item.bucket === 'overdue' ? '已逾期' : '今天'} · ${item.customerName} · ${item.title}`,
      detail:`${item.company} · ${item.policyName}`,customerId:item.customerId,serviceItemId:item.id,date:item.nextActionDate,bucket:item.bucket,
    });
    for (const topic of topics) for (const platform of ['知乎','小红书','公众号']) {
      const draft = topic.drafts[platform];
      if (draft && draft.status === '待审核') output.push({ id: `draft-${topic.id}-${platform}`,type: 'draft',title: `${platform}稿件待审核`,detail: topic.title,topicId: topic.id,platform });
    }
    return output;
  }
  async exportCustomers(req,response) {
    const csv = await this.service.exportCustomers();
    response.setHeader('Content-Type','text/csv; charset=utf-8');
    response.setHeader('Content-Disposition',`attachment; filename="insurance-customers-${beijingDate()}.csv"`);
    response.send(csv);
  }
  customers(req) { return this.service.listCustomers({ search: req.query.search || '', source: req.query.source || '' }); }
  customerAnalytics(req) { return this.service.customerAnalytics({from:req.query.from,to:req.query.to,sourceCode:req.query.sourceCode}); }
  updateCustomerAcquisition(req) { return this.service.updateCustomerAcquisition(req.params.id,req.body); }
  createCustomer(req) { return this.service.createCustomer(req.body); }
  updateCustomer(req) { return this.service.updateCustomer(req.params.id,req.body); }
  lookupCustomers(req) { return this.service.lookupCustomers({search:req.query.search || ''}); }
  customer(req) { return this.service.customer(req.params.id); }
  customerCoverageReview(req) { return this.service.customerCoverageReview(req.params.id); }
  saveCustomerCoverageProfile(req) { return this.service.saveCustomerCoverageProfile(req.params.id,req.body); }
  customerFamilies(req) { return this.service.customerFamilies(req.params.customerId); }
  families(req) { return this.service.listFamilies({search:req.query.search || ''}); }
  createFamily(req) { return this.service.createFamily(req.body); }
  family(req) { return this.service.family(req.params.familyId); }
  updateFamily(req) { return this.service.updateFamily(req.params.familyId,req.body); }
  deleteFamily(req) { return this.service.deleteFamily(req.params.familyId); }
  addFamilyMember(req) { return this.service.addFamilyMember(req.params.familyId,req.body); }
  updateFamilyMember(req) { return this.service.updateFamilyMember(req.params.familyId,req.params.memberId,req.body); }
  removeFamilyMember(req) { return this.service.removeFamilyMember(req.params.familyId,req.params.memberId); }
  createFamilyRelationship(req) { return this.service.createRelationship(req.params.familyId,req.body); }
  updateFamilyRelationship(req) { return this.service.updateRelationship(req.params.familyId,req.params.relationshipId,req.body); }
  deleteFamilyRelationship(req) { return this.service.deleteRelationship(req.params.familyId,req.params.relationshipId); }
  createInsuredObject(req) { return this.service.createInsuredObject(req.params.familyId,req.body); }
  updateInsuredObject(req) { return this.service.updateInsuredObject(req.params.familyId,req.params.objectId,req.body); }
  deleteInsuredObject(req) { return this.service.deleteInsuredObject(req.params.familyId,req.params.objectId); }
  familyPolicyCandidates(req) { return this.service.familyPolicyCandidates(req.params.familyId); }
  linkFamilyPolicy(req) { return this.service.linkFamilyPolicy(req.params.familyId,req.params.policyId,req.body); }
  unlinkFamilyPolicy(req) { return this.service.unlinkFamilyPolicy(req.params.familyId,req.params.policyId); }
  familyPolicyReview(req) { return this.service.familyPolicyReview(req.params.familyId); }
  familyContractCandidates(req) { return this.service.familyContractCandidates(req.params.familyId); }
  uploadFamilyContract(req,file) { return this.service.uploadFamilyContract(req.params.familyId,req.body,file); }
  linkFamilyContract(req) { return this.service.linkFamilyContract(req.params.familyId,req.params.contractId,req.body); }
  unlinkFamilyContract(req) { return this.service.unlinkFamilyContract(req.params.familyId,req.params.contractId); }
  unlinkFamilyPolicySource(req) { return this.service.unlinkFamilyPolicySource(req.params.familyId,req.body); }
  saveFamilyCoverageContext(req) { return this.service.saveFamilyCoverageContext(req.params.familyId,req.body); }
  saveFamilyMemberCoverageProfile(req) { return this.service.saveFamilyMemberCoverageProfile(req.params.familyId,req.params.memberId,req.body); }
  async exportFamilyPolicyOrganizer(req,response) {
    const file=await this.service.exportFamilyPolicyOrganizer(req.params.familyId);
    this.sendPolicyOrganizerFile(response,file);
  }
  async exportFamilyPolicyOrganizerWithDiagnosis(req,response) {
    const file=await this.service.exportFamilyPolicyOrganizer(req.params.familyId,{withDiagnosis:true});
    this.sendPolicyOrganizerFile(response,file);
  }
  sendPolicyOrganizerFile(response,file) {
    response.setHeader('Content-Type',file.mimeType);
    response.setHeader('Content-Length',String(file.buffer.length));
    response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    response.setHeader('X-Content-Type-Options','nosniff');
    response.send(file.buffer);
  }
  followUpTasks(req) { return this.service.listFollowUpTasks({status:req.query.status,range:req.query.range,search:req.query.search || '',customerId:req.query.customerId || '',limit:req.query.limit,offset:req.query.offset}); }
  createFollowUpTask(req) { return this.service.createFollowUpTask(req.params.id,req.body); }
  updateFollowUpTask(req) { return this.service.updateFollowUpTask(req.params.taskId,req.body); }
  completeFollowUpTask(req) { return this.service.completeFollowUpTask(req.params.taskId,req.body); }
  cancelFollowUpTask(req) { return this.service.cancelFollowUpTask(req.params.taskId,req.body); }
  createPolicy(req) { return this.service.createPolicy(req.params.id,req.body); }
  deletePolicy(req) { return this.service.deletePolicy(req.params.id,req.params.policyId); }
  listPolicyContracts(req) { return this.service.listPolicyContracts(req.params.id); }
  uploadPolicyContract(req,file) { return this.service.uploadPolicyContract(req.params.id,file); }
  analyzePolicyContract(req) { return this.service.analyzePolicyContract(req.params.id,req.params.documentId,req.body); }
  deletePolicyContract(req) { return this.service.deletePolicyContract(req.params.id,req.params.documentId); }
  savePolicyContractAsPolicy(req) { return this.service.savePolicyContractAsPolicy(req.params.id,req.params.documentId,req.body); }
  syncPolicyContractScheduleFacts(req) { return this.service.syncPolicyContractScheduleFacts(req.params.id,req.params.documentId); }
  async exportPolicyOrganizer(req,response) {
    const file=await this.service.exportPolicyOrganizer(req.params.id);
    this.sendPolicyOrganizerFile(response,file);
  }
  async exportPolicyOrganizerWithDiagnosis(req,response) {
    const file=await this.service.exportPolicyOrganizer(req.params.id,{withDiagnosis:true});
    this.sendPolicyOrganizerFile(response,file);
  }
  verifyPolicy(req) { return this.service.verifyPolicy(req.params.policyId,req.body.verified); }
  policyLifecycle(req) { return this.service.policyLifecycle(req.params.policyId); }
  updatePolicyLifecycle(req) { return this.service.updatePolicyLifecycle(req.params.policyId,req.body); }
  serviceItems(req) { return this.service.listServiceItems(req.query); }
  serviceItem(req) { return this.service.serviceItem(req.params.itemId); }
  createServiceItem(req) { return this.service.createServiceItem(req.params.policyId,req.body); }
  updateServiceItem(req) { return this.service.updateServiceItem(req.params.itemId,req.body); }
  recordServiceProgress(req) { return this.service.recordServiceProgress(req.params.itemId,req.body); }
  completeServiceItem(req) { return this.service.completeServiceItem(req.params.itemId,req.body); }
  cancelServiceItem(req) { return this.service.cancelServiceItem(req.params.itemId,req.body); }
  createFollowUp(req) { return this.service.createFollowUp(req.params.id,req.body); }
  contentTypes() { return this.service.listContentTypes(); }
  topics(req) { return this.service.listTopics({type:req.query.type || ''}); }
  createTopic(req) { return this.service.createTopic(req.body); }
  deleteTopic(req) { return this.service.deleteTopic(req.params.id); }
  updateTopic(req) { return this.service.updateTopic(req.params.id,req.body); }
  generateDrafts(req) { return this.service.generateDrafts(req.params.id); }
  suggestTopics(req) { return this.service.suggestTopics(req.query.insuranceType,req.query.exclude || ''); }
  draftVersions(req) { return this.service.listDraftVersions(req.params.id,req.params.platform); }
  restoreDraftVersion(req) { return this.service.restoreDraftVersion(req.params.id,req.params.platform,req.params.version); }
  saveDraft(req) { return this.service.saveDraft(req.params.id,req.params.platform,req.body); }
  humanizeDraft(req) { return this.service.humanizeDraft(req.params.id,req.params.platform); }
  generateCardPlan(req) { return this.service.generateXhsCardPlan(req.params.id,req.params.platform); }
  approveDraft(req) { return this.service.approveDraft(req.params.id,req.params.platform,req.body); }
  publishDraft(req) { return this.service.publishDraft(req.params.id,req.params.platform,req.body); }
  publications(req) { return this.service.listPublications(req.query); }
  publication(req) { return this.service.publication(req.params.publicationId); }
  correctPublication(req) { return this.service.correctPublication(req.params.publicationId,req.body); }
  voidPublication(req) { return this.service.voidPublication(req.params.publicationId,req.body); }
  uploadAsset(req,file) { return this.service.uploadAsset(req.params.id,req.body.platform,file); }
  deleteAsset(req) { return this.service.deleteAsset(req.params.id); }
  generateImage(req) { return this.service.generateImage(req.params.id,req.body.platform,req.body.imageOptions); }
  productCenterMeta() { return this.service.productCenterMeta(); }
  updateProductSyncCompany(req) { return this.service.updateProductSyncCompany(req.params.companyCode,req.body); }
  startProductSync(req) { return this.service.startProductSync(req.body); }
  listProductSyncRuns() { return this.service.listProductSyncRuns(); }
  getProductSyncRun(req) { return this.service.getProductSyncRun(req.params.runId); }
  productCenterPlatformSettings() { return this.service.productCenterPlatformSettings(); }
  updateProductPlatformSettings(req) { return this.service.updateProductPlatformSettings(req.params.platform,req.body); }
  listProductCenterProducts(req) { return this.service.listProductCenterProducts({search:req.query.search || '',status:req.query.status || '',officialSaleStatus:req.query.officialSaleStatus || ''}); }
  createInsuranceProduct(req) { return this.service.createInsuranceProduct(req.body); }
  productCenterWorkspace(req) { return this.service.productCenterWorkspace(req.params.productId); }
  updateInsuranceProduct(req) { return this.service.updateInsuranceProduct(req.params.productId,req.body); }
  deleteInsuranceProduct(req) { return this.service.deleteInsuranceProduct(req.params.productId); }
  uploadProductDocument(req,file) { return this.service.uploadProductDocument(req.params.productId,req.body.documentType,file); }
  importOfficialProductMaterial(req) { return this.service.importOfficialProductMaterial(req.params.productId,req.params.materialId); }
  deleteProductDocument(req) { return this.service.deleteProductDocument(req.params.documentId); }
  analyzeProductDocument(req) { return this.service.analyzeProductDocument(req.params.documentId); }
  analyzeProductMaterials(req) { return this.service.analyzeProductMaterials(req.params.productId); }
  updateProductExtraction(req) { return this.service.updateProductExtraction(req.params.extractionId,req.body); }
  confirmProductExtraction(req) { return this.service.confirmProductExtraction(req.params.extractionId); }
  generateProductCopyDraft(req) { return this.service.generateProductCopyDraft(req.params.extractionId,req.params.platform); }
  saveProductCopyDraft(req) { return this.service.saveProductCopyDraft(req.params.draftId,req.body); }
  approveProductCopyDraft(req) { return this.service.approveProductCopyDraft(req.params.draftId,req.body); }
  productCopyDraftVersions(req) { return this.service.productCopyDraftVersions(req.params.draftId); }
  restoreProductCopyDraftVersion(req) { return this.service.restoreProductCopyDraftVersion(req.params.draftId,req.params.version); }
  async getProductDocumentFile(req,response) {
    const file = await this.service.productDocumentFile(req.params.documentId);
    response.setHeader('Content-Type',file.mime_type || 'application/octet-stream');
    response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    response.setHeader('X-Content-Type-Options','nosniff');
    response.sendFile(file.path);
  }
  async getPolicyContractFile(req,response) {
    const file = await this.service.policyContractFile(req.params.id,req.params.documentId);
    response.setHeader('Content-Type',file.mime_type || 'application/pdf');
    response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    response.setHeader('X-Content-Type-Options','nosniff');
    response.sendFile(file.path);
  }
  async getAsset(req,response) {
    const asset = await this.service.asset(req.params.id);
    response.setHeader('Content-Type',asset.mime_type);
    response.setHeader('Content-Length',String(asset.byte_size));
    response.setHeader('Content-Disposition',`${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(asset.file_name)}`);
    response.sendFile(asset.path);
  }
}

Controller('api')(ApiController);
Inject(WorkbenchService)(ApiController,undefined,0);

function route(decorator,path,method,parameters=[0]) {
  const descriptor = Object.getOwnPropertyDescriptor(ApiController.prototype,method);
  decorator(path)(ApiController.prototype,method,descriptor);
  for (const index of parameters) Req()(ApiController.prototype,method,index);
}
route(Get,'health','health',[]);
route(Get,'sources','sources',[]);
route(Get,'dashboard','dashboard');
route(Get,'calendar','calendar');
route(Get,'work-calendar/events','workCalendarEvents');
route(Post,'work-calendar/events','createWorkCalendarEvent');
route(Patch,'work-calendar/events/:eventId','updateWorkCalendarEvent');
route(Get,'settings','settings',[]);
route(Patch,'settings','updateSettings');
route(Get,'notifications','notifications',[]);
route(Get,'customers/export','exportCustomers',[0]);
Res()(ApiController.prototype,'exportCustomers',1);
route(Get,'customers/lookup','lookupCustomers');
route(Get,'customers/acquisition-sources','customerAcquisitionSources',[]);
route(Get,'customers/analytics','customerAnalytics');
route(Get,'families','families');
route(Post,'families','createFamily');
route(Get,'customers','customers');
route(Get,'follow-up-tasks','followUpTasks');
route(Post,'customers','createCustomer');
route(Patch,'customers/:id/acquisition','updateCustomerAcquisition');
route(Get,'customers/:id','customer');
route(Get,'customers/:id/coverage-review','customerCoverageReview');
route(Put,'customers/:id/coverage-profile','saveCustomerCoverageProfile');
route(Patch,'customers/:id','updateCustomer');
route(Get,'customers/:customerId/families','customerFamilies');
route(Get,'families/:familyId','family');
route(Patch,'families/:familyId','updateFamily');
route(Delete,'families/:familyId','deleteFamily');
route(Post,'families/:familyId/members','addFamilyMember');
route(Patch,'families/:familyId/members/:memberId','updateFamilyMember');
route(Delete,'families/:familyId/members/:memberId','removeFamilyMember');
route(Post,'families/:familyId/relationships','createFamilyRelationship');
route(Patch,'families/:familyId/relationships/:relationshipId','updateFamilyRelationship');
route(Delete,'families/:familyId/relationships/:relationshipId','deleteFamilyRelationship');
route(Post,'families/:familyId/insured-objects','createInsuredObject');
route(Patch,'families/:familyId/insured-objects/:objectId','updateInsuredObject');
route(Delete,'families/:familyId/insured-objects/:objectId','deleteInsuredObject');
route(Get,'families/:familyId/policy-candidates','familyPolicyCandidates');
route(Put,'families/:familyId/policies/:policyId','linkFamilyPolicy');
route(Delete,'families/:familyId/policies/:policyId','unlinkFamilyPolicy');
route(Get,'families/:familyId/policy-review','familyPolicyReview');
route(Get,'families/:familyId/policy-contract-candidates','familyContractCandidates');
route(Post,'families/:familyId/policy-contracts','uploadFamilyContract');
route(Put,'families/:familyId/policy-contracts/:contractId','linkFamilyContract');
route(Delete,'families/:familyId/policy-contracts/:contractId','unlinkFamilyContract');
route(Delete,'families/:familyId/policy-review/source','unlinkFamilyPolicySource');
route(Put,'families/:familyId/coverage-context','saveFamilyCoverageContext');
route(Put,'families/:familyId/members/:memberId/coverage-profile','saveFamilyMemberCoverageProfile');
route(Get,'families/:familyId/policy-organizer/export','exportFamilyPolicyOrganizer',[0]);
route(Post,'families/:familyId/policy-organizer/export-with-diagnosis','exportFamilyPolicyOrganizerWithDiagnosis',[0]);
Res()(ApiController.prototype,'exportFamilyPolicyOrganizer',1);
Res()(ApiController.prototype,'exportFamilyPolicyOrganizerWithDiagnosis',1);
route(Post,'customers/:id/follow-up-tasks','createFollowUpTask');
route(Patch,'follow-up-tasks/:taskId','updateFollowUpTask');
route(Post,'follow-up-tasks/:taskId/complete','completeFollowUpTask');
route(Post,'follow-up-tasks/:taskId/cancel','cancelFollowUpTask');
route(Post,'customers/:id/policies','createPolicy');
route(Delete,'customers/:id/policies/:policyId','deletePolicy');
route(Get,'customers/:id/policy-contracts','listPolicyContracts');
route(Get,'customers/:id/policy-organizer/export','exportPolicyOrganizer',[0]);
route(Post,'customers/:id/policy-organizer/export-with-diagnosis','exportPolicyOrganizerWithDiagnosis',[0]);
Res()(ApiController.prototype,'exportPolicyOrganizer',1);
Res()(ApiController.prototype,'exportPolicyOrganizerWithDiagnosis',1);
route(Post,'customers/:id/policy-contracts','uploadPolicyContract');
route(Post,'customers/:id/policy-contracts/:documentId/analyze','analyzePolicyContract');
route(Delete,'customers/:id/policy-contracts/:documentId','deletePolicyContract');
route(Post,'customers/:id/policy-contracts/:documentId/save-policy','savePolicyContractAsPolicy');
route(Post,'customers/:id/policy-contracts/:documentId/sync-schedule-facts','syncPolicyContractScheduleFacts');
route(Get,'customers/:id/policy-contracts/:documentId/file','getPolicyContractFile',[0]);
Res()(ApiController.prototype,'getPolicyContractFile',1);
route(Post,'customers/:id/followups','createFollowUp');
route(Patch,'policies/:policyId','verifyPolicy');
route(Get,'policies/:policyId/lifecycle','policyLifecycle');
route(Patch,'policies/:policyId/lifecycle','updatePolicyLifecycle');
route(Get,'service-items','serviceItems');
route(Get,'service-items/:itemId','serviceItem');
route(Post,'policies/:policyId/service-items','createServiceItem');
route(Patch,'service-items/:itemId','updateServiceItem');
route(Post,'service-items/:itemId/progress','recordServiceProgress');
route(Post,'service-items/:itemId/complete','completeServiceItem');
route(Post,'service-items/:itemId/cancel','cancelServiceItem');
route(Get,'topics','topics');
route(Get,'content/types','contentTypes',[]);
route(Post,'topics','createTopic');
route(Delete,'topics/:id','deleteTopic');
route(Get,'topics/suggest','suggestTopics');
route(Patch,'topics/:id','updateTopic');
route(Post,'topics/:id/generate','generateDrafts');
route(Get,'topics/:id/drafts/:platform/versions','draftVersions');
route(Post,'topics/:id/drafts/:platform/versions/:version/restore','restoreDraftVersion');
route(Patch,'topics/:id/drafts/:platform','saveDraft');
route(Post,'topics/:id/drafts/:platform/humanize','humanizeDraft');
route(Post,'topics/:id/drafts/:platform/card-plan/generate','generateCardPlan');
route(Post,'topics/:id/drafts/:platform/approve','approveDraft');
route(Post,'topics/:id/drafts/:platform/publish','publishDraft');
route(Get,'publications','publications');
route(Get,'publications/:publicationId','publication');
route(Patch,'publications/:publicationId','correctPublication');
route(Post,'publications/:publicationId/void','voidPublication');
route(Post,'topics/:id/images/generate','generateImage');
route(Post,'topics/:id/assets','uploadAsset');
route(Delete,'assets/:id','deleteAsset');
route(Get,'assets/:id','getAsset',[0]);
Res()(ApiController.prototype,'getAsset',1);

route(Get,'product-center/meta','productCenterMeta',[]);
route(Get,'product-center/platform-settings','productCenterPlatformSettings',[]);
route(Patch,'product-center/platform-settings/:platform','updateProductPlatformSettings');
route(Get,'product-center/products','listProductCenterProducts');
route(Patch,'product-center/companies/:companyCode','updateProductSyncCompany');
route(Post,'product-center/sync-runs','startProductSync');
route(Get,'product-center/sync-runs','listProductSyncRuns');
route(Get,'product-center/sync-runs/:runId','getProductSyncRun');
route(Post,'product-center/products','createInsuranceProduct');
route(Get,'product-center/products/:productId','productCenterWorkspace');
route(Patch,'product-center/products/:productId','updateInsuranceProduct');
route(Delete,'product-center/products/:productId','deleteInsuranceProduct');
route(Post,'product-center/products/:productId/documents','uploadProductDocument');
route(Post,'product-center/products/:productId/analyze','analyzeProductMaterials');
route(Post,'product-center/products/:productId/official-materials/:materialId/import','importOfficialProductMaterial');
route(Get,'product-center/documents/:documentId/file','getProductDocumentFile',[0]);
Res()(ApiController.prototype,'getProductDocumentFile',1);
route(Delete,'product-center/documents/:documentId','deleteProductDocument');
route(Post,'product-center/documents/:documentId/analyze','analyzeProductDocument');
route(Patch,'product-center/extractions/:extractionId','updateProductExtraction');
route(Post,'product-center/extractions/:extractionId/confirm','confirmProductExtraction');
route(Post,'product-center/extractions/:extractionId/drafts/:platform/generate','generateProductCopyDraft');
route(Patch,'product-center/drafts/:draftId','saveProductCopyDraft');
route(Post,'product-center/drafts/:draftId/approve','approveProductCopyDraft');
route(Get,'product-center/drafts/:draftId/versions','productCopyDraftVersions');
route(Post,'product-center/drafts/:draftId/versions/:version/restore','restoreProductCopyDraftVersion');

const upload = FileInterceptor('file',{
  storage: diskStorage({
    destination: (_req,_file,callback) => callback(null,uploadDir),
    filename: (_req,file,callback) => callback(null,`${randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0,12)}`),
  }),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req,file,callback) => callback(null,String(file.mimetype).startsWith('image/')),
});
const uploadDescriptor = Object.getOwnPropertyDescriptor(ApiController.prototype,'uploadAsset');
UseInterceptors(upload)(ApiController.prototype,'uploadAsset',uploadDescriptor);
UploadedFile()(ApiController.prototype,'uploadAsset',1);

const productDocumentUpload = FileInterceptor('file',{
  storage:diskStorage({
    destination:(_req,_file,callback) => callback(null,PRODUCT_DOCUMENT_UPLOAD_DIR),
    filename:(_req,file,callback) => callback(null,`${randomUUID()}${path.extname(file.originalname).toLowerCase().slice(0,8)}`),
  }),
  limits:{fileSize:PRODUCT_DOCUMENT_MAX_BYTES,files:1},
  fileFilter:(_req,file,callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowed = PRODUCT_DOCUMENT_EXTENSIONS.includes(extension);
    callback(allowed ? null : new BadRequestException('仅支持 PDF、DOCX 和 TXT 文件'),allowed);
  },
});
const productDocumentUploadDescriptor = Object.getOwnPropertyDescriptor(ApiController.prototype,'uploadProductDocument');
UseInterceptors(productDocumentUpload)(ApiController.prototype,'uploadProductDocument',productDocumentUploadDescriptor);
UploadedFile()(ApiController.prototype,'uploadProductDocument',1);

const policyContractUpload = FileInterceptor('file',{
  storage:diskStorage({
    destination:(_req,_file,callback)=>callback(null,POLICY_CONTRACT_UPLOAD_DIR),
    filename:(_req,file,callback)=>callback(null,`${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits:{fileSize:POLICY_CONTRACT_MAX_BYTES,files:1},
  fileFilter:(_req,file,callback)=>{
    const extension=path.extname(file.originalname || '').toLowerCase();
    const allowed=POLICY_CONTRACT_EXTENSIONS.includes(extension);
    callback(allowed ? null : new BadRequestException('保单整理目前仅支持 PDF 合同'),allowed);
  },
});
const policyContractUploadDescriptor=Object.getOwnPropertyDescriptor(ApiController.prototype,'uploadPolicyContract');
UseInterceptors(policyContractUpload)(ApiController.prototype,'uploadPolicyContract',policyContractUploadDescriptor);
UploadedFile()(ApiController.prototype,'uploadPolicyContract',1);
const familyContractUploadDescriptor=Object.getOwnPropertyDescriptor(ApiController.prototype,'uploadFamilyContract');
UseInterceptors(policyContractUpload)(ApiController.prototype,'uploadFamilyContract',familyContractUploadDescriptor);
UploadedFile()(ApiController.prototype,'uploadFamilyContract',1);

