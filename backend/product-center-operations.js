import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { cleanGeneratedCopy, runwareTextModel } from './content-generation-helpers.js';
import { cleanText, pgDate, strictDate } from './workbench-primitives.js';
import { PRODUCT_DOCUMENT_MAX_BYTES, PRODUCT_DOCUMENT_MAX_TEXT_CHARS, extractProductDocumentText } from './product-document-parser.js';
import { buildProductAnalysisPrompt, buildProductCopyPrompt, normalizeProductAnalysis, normalizeProductCopy, productCopySources, PRODUCT_COPY_PLATFORMS } from './product-center-prompts.js';

export const PRODUCT_DOCUMENT_TYPES = Object.freeze(['policy_terms','product_brief','brochure','other']);
export const PRODUCT_DOCUMENT_UPLOAD_DIR = path.resolve('backend/uploads/product-documents');
const MAX_PRODUCT_NAME = 120;
const MAX_PRODUCT_NOTE = 1200;
const MAX_PRODUCT_TEXT = PRODUCT_DOCUMENT_MAX_TEXT_CHARS;
const safeStoragePath = (storageName) => path.resolve(PRODUCT_DOCUMENT_UPLOAD_DIR,path.basename(String(storageName || '')));
const jsonValue = (value,fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
};
const publicProduct = (row) => ({
  id:Number(row.id),companyCode:row.company_code,company:row.company_label || row.company_name || '新华保险',
  insuranceTypeCode:row.insurance_type_code,insuranceType:row.insurance_type_label || row.insurance_type_name || '',
  productName:row.product_name,shortName:row.short_name || '',productVersion:row.product_version || '',
  effectiveDate:row.effective_date ? pgDate(row.effective_date) : null,
  status:row.status,note:row.note || '',tags:jsonValue(row.tags,[]),documentCount:Number(row.document_count || 0),
  pendingExtractionCount:Number(row.pending_extraction_count || 0),pendingDraftCount:Number(row.pending_draft_count || 0),
  createdAt:row.created_at,updatedAt:row.updated_at,
});
const publicDocument = (row) => ({
  id:Number(row.id),productId:Number(row.product_id),documentType:row.document_type,fileName:row.file_name,
  mimeType:row.mime_type,byteSize:Number(row.byte_size),parseStatus:row.parse_status,parseError:row.parse_error || '',
  pageCount:row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
  extractedCharCount:Number(row.extracted_char_count || 0),warnings:jsonValue(row.warnings,[]),createdAt:row.created_at,
});
const publicExtraction = (row) => ({
  id:Number(row.id),productId:Number(row.product_id),documentId:Number(row.document_id),documentName:row.file_name || '',
  documentType:row.document_type || '',pageCount:row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
  positioning:row.positioning || '',facts:jsonValue(row.facts,[]),openQuestions:jsonValue(row.open_questions,[]),
  status:row.status,provider:row.provider,confirmedAt:row.confirmed_at,createdAt:row.created_at,updatedAt:row.updated_at,
});
const publicProductDraft = (row) => ({
  id:Number(row.id),productId:Number(row.product_id),extractionId:Number(row.extraction_id),platform:row.platform,
  title:row.title,summary:row.summary,body:row.body,hashtags:row.hashtags,sources:row.sources,
  status:row.status,checks:jsonValue(row.approval_checks,[false,false,false]).map(Boolean).slice(0,3),
  provider:row.provider,humanized:Boolean(row.humanized),htmlContent:row.html_content || '',version:Number(row.version || 1),
  platformSettings:jsonValue(row.platform_settings_snapshot,{}),
  approvedAt:row.approved_at,createdAt:row.created_at,updatedAt:row.updated_at,
});
const parseJsonArray = (value,fallback=[]) => {
  const result = jsonValue(value,fallback);
  return Array.isArray(result) ? result : fallback;
};
const snapshotDraft = (row) => ({
  title:row.title,summary:row.summary,body:row.body,hashtags:row.hashtags,sources:row.sources,status:row.status,
  checks:jsonValue(row.approval_checks,[false,false,false]),provider:row.provider,humanized:Boolean(row.humanized),
  htmlContent:row.html_content || '',platformSettings:jsonValue(row.platform_settings_snapshot,{}),version:Number(row.version || 1),
});

export class ProductCenterOperations {
  async productCenterPlatformSettings() {
    const {rows} = await this.db.query(`SELECT platform,audience,tone,structure,length_hint,updated_at
      FROM product_platform_settings ORDER BY CASE platform WHEN '知乎' THEN 1 WHEN '小红书' THEN 2 ELSE 3 END`);
    return rows.map((row) => ({platform:row.platform,audience:row.audience,tone:row.tone,structure:row.structure,lengthHint:row.length_hint,updatedAt:row.updated_at}));
  }

  async updateProductPlatformSettings(platform,body={}) {
    if (!PRODUCT_COPY_PLATFORMS.includes(platform)) throw new BadRequestException('内容平台无效');
    const current = (await this.productCenterPlatformSettings()).find((item) => item.platform === platform);
    if (!current) throw new NotFoundException('找不到该平台的表达设置');
    const audience = body.audience === undefined ? current.audience : cleanText(body.audience,'目标读者',300);
    const tone = body.tone === undefined ? current.tone : cleanText(body.tone,'表达语气',500);
    const structure = body.structure === undefined ? current.structure : cleanText(body.structure,'内容结构',1200);
    const lengthHint = body.lengthHint === undefined ? current.lengthHint : cleanText(body.lengthHint,'篇幅建议',300);
    const {rows} = await this.db.query(`UPDATE product_platform_settings SET audience=$2,tone=$3,structure=$4,length_hint=$5,updated_at=NOW()
      WHERE platform=$1 RETURNING platform,audience,tone,structure,length_hint,updated_at`,[platform,audience,tone,structure,lengthHint]);
    const row = rows[0];
    return {platform:row.platform,audience:row.audience,tone:row.tone,structure:row.structure,lengthHint:row.length_hint,updatedAt:row.updated_at};
  }

  async productCenterMeta() {
    const [companies,insuranceTypes] = await Promise.all([
      this.db.query('SELECT code,label FROM product_company_dictionary WHERE is_active=TRUE ORDER BY sort_order,label'),
      this.db.query('SELECT code,label FROM product_insurance_type_dictionary WHERE is_active=TRUE ORDER BY sort_order,label'),
    ]);
    return {
      companies:companies.rows.map((row) => ({code:row.code,label:row.label})),
      insuranceTypes:insuranceTypes.rows.map((row) => ({code:row.code,label:row.label})),
    };
  }

  async listProductCenterProducts({search='',status=''}={}) {
    const query = String(search || '').trim().slice(0,120);
    const {rows} = await this.db.query(`SELECT p.*,c.label AS company_label,t.label AS insurance_type_label,
      COUNT(DISTINCT doc.id)::int AS document_count,
      COUNT(DISTINCT e.id) FILTER (WHERE e.status='待核对')::int AS pending_extraction_count,
      COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('待审核','草稿'))::int AS pending_draft_count
      FROM insurance_products p
      JOIN product_company_dictionary c ON c.code=p.company_code
      JOIN product_insurance_type_dictionary t ON t.code=p.insurance_type_code
      LEFT JOIN product_documents doc ON doc.product_id=p.id
      LEFT JOIN product_extractions e ON e.product_id=p.id
      LEFT JOIN product_copy_drafts d ON d.product_id=p.id
      WHERE ($1='' OR p.product_name ILIKE '%'||$1||'%' OR p.short_name ILIKE '%'||$1||'%')
        AND ($2='' OR p.status=$2)
      GROUP BY p.id,c.label,t.label ORDER BY p.updated_at DESC,p.id DESC`,[query,status]);
    return rows.map(publicProduct);
  }

  async createInsuranceProduct(body={}) {
    const productName = cleanText(body.productName,'产品名称',MAX_PRODUCT_NAME,{required:true});
    const shortName = cleanText(body.shortName,'产品简称',80);
    const productVersion = cleanText(body.productVersion,'产品版本',80);
    const note = cleanText(body.note,'备注',MAX_PRODUCT_NOTE);
    const companyCode = String(body.companyCode || 'xinhua').trim();
    const insuranceTypeCode = String(body.insuranceTypeCode || '').trim();
    if (!insuranceTypeCode) throw new BadRequestException('请选择险种');
    const [company,type] = await Promise.all([
      this.db.query('SELECT code FROM product_company_dictionary WHERE code=$1 AND is_active=TRUE',[companyCode]),
      this.db.query('SELECT code FROM product_insurance_type_dictionary WHERE code=$1 AND is_active=TRUE',[insuranceTypeCode]),
    ]);
    if (!company.rows[0]) throw new BadRequestException('当前暂不支持该保险公司；首期仅开放新华保险产品档案');
    if (!type.rows[0]) throw new BadRequestException('险种无效或暂未启用');
    const status = ['整理中','可用','已停用'].includes(body.status) ? body.status : '整理中';
    const effectiveDate = body.effectiveDate ? strictDate(body.effectiveDate,'产品适用日期') : null;
    try {
      const {rows} = await this.db.query(`INSERT INTO insurance_products(company_code,insurance_type_code,product_name,short_name,product_version,effective_date,status,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,[companyCode,insuranceTypeCode,productName,shortName,productVersion,effectiveDate,status,note]);
      const [companyLabel,typeLabel] = await Promise.all([
        this.db.query('SELECT label FROM product_company_dictionary WHERE code=$1',[companyCode]),
        this.db.query('SELECT label FROM product_insurance_type_dictionary WHERE code=$1',[insuranceTypeCode]),
      ]);
      return publicProduct({...rows[0],company_label:companyLabel.rows[0]?.label,insurance_type_label:typeLabel.rows[0]?.label});
    } catch (error) {
      if (error.code === '23505') throw new ConflictException('同一公司、产品名称和版本的档案已存在');
      throw error;
    }
  }

  async updateInsuranceProduct(productId,body={}) {
    const current = await this.findInsuranceProduct(productId);
    const productName = body.productName === undefined ? current.product_name : cleanText(body.productName,'产品名称',MAX_PRODUCT_NAME,{required:true});
    const shortName = body.shortName === undefined ? current.short_name : cleanText(body.shortName,'产品简称',80);
    const productVersion = body.productVersion === undefined ? current.product_version : cleanText(body.productVersion,'产品版本',80);
    const note = body.note === undefined ? current.note : cleanText(body.note,'备注',MAX_PRODUCT_NOTE);
    const status = body.status === undefined ? current.status : body.status;
    if (!['整理中','可用','已停用'].includes(status)) throw new BadRequestException('产品状态无效');
    const insuranceTypeCode = body.insuranceTypeCode === undefined ? current.insurance_type_code : String(body.insuranceTypeCode);
    if (insuranceTypeCode !== current.insurance_type_code) {
      const type = await this.db.query('SELECT code FROM product_insurance_type_dictionary WHERE code=$1 AND is_active=TRUE',[insuranceTypeCode]);
      if (!type.rows[0]) throw new BadRequestException('险种无效或暂未启用');
    }
    const {rows} = await this.db.query(`UPDATE insurance_products SET product_name=$2,short_name=$3,product_version=$4,
      effective_date=$5,status=$6,note=$7,insurance_type_code=$8,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [productId,productName,shortName,productVersion,body.effectiveDate === undefined ? current.effective_date : body.effectiveDate ? strictDate(body.effectiveDate,'产品适用日期') : null,status,note,insuranceTypeCode]);
    const [companyLabel,typeLabel] = await Promise.all([
      this.db.query('SELECT label FROM product_company_dictionary WHERE code=$1',[rows[0].company_code]),
      this.db.query('SELECT label FROM product_insurance_type_dictionary WHERE code=$1',[rows[0].insurance_type_code]),
    ]);
    return publicProduct({...rows[0],company_label:companyLabel.rows[0]?.label,insurance_type_label:typeLabel.rows[0]?.label});
  }

  async findInsuranceProduct(productId,executor=this.db) {
    const {rows} = await executor.query(`SELECT p.*,c.label AS company_label,t.label AS insurance_type_label
      FROM insurance_products p JOIN product_company_dictionary c ON c.code=p.company_code
      JOIN product_insurance_type_dictionary t ON t.code=p.insurance_type_code WHERE p.id=$1`,[productId]);
    if (!rows[0]) throw new NotFoundException('找不到这个产品档案');
    return rows[0];
  }

  async productCenterWorkspace(productId) {
    const product = publicProduct(await this.findInsuranceProduct(productId));
    const [documents,extractions,drafts] = await Promise.all([
      this.db.query('SELECT * FROM product_documents WHERE product_id=$1 ORDER BY created_at DESC,id DESC',[productId]),
      this.db.query(`SELECT e.*,doc.file_name,doc.document_type,doc.page_count FROM product_extractions e
        JOIN product_documents doc ON doc.id=e.document_id WHERE e.product_id=$1 ORDER BY e.created_at DESC,e.id DESC`,[productId]),
      this.db.query('SELECT * FROM product_copy_drafts WHERE product_id=$1 ORDER BY updated_at DESC,id DESC',[productId]),
    ]);
    return {
      product,
      documents:documents.rows.map(publicDocument),
      extractions:extractions.rows.map(publicExtraction),
      drafts:drafts.rows.map(publicProductDraft),
    };
  }

  async productCopyDraftVersions(draftId) {
    const draft = await this.db.query('SELECT id FROM product_copy_drafts WHERE id=$1',[draftId]);
    if (!draft.rows[0]) throw new NotFoundException('找不到这份产品文案');
    const {rows} = await this.db.query('SELECT version,snapshot,changed_by,created_at FROM product_copy_versions WHERE draft_id=$1 ORDER BY version DESC',[draftId]);
    return rows.map((row) => ({version:Number(row.version),snapshot:jsonValue(row.snapshot,{}),changedBy:row.changed_by,createdAt:row.created_at}));
  }

  async restoreProductCopyDraftVersion(draftId,version) {
    const targetVersion = Number(version);
    if (!Number.isInteger(targetVersion) || targetVersion < 1) throw new BadRequestException('文案版本号无效');
    const result = await this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT d.*,p.product_name,settings.value AS settings_value FROM product_copy_drafts d
        JOIN insurance_products p ON p.id=d.product_id LEFT JOIN settings ON settings.key='content' WHERE d.id=$1 FOR UPDATE OF d`,[draftId]);
      const current = rows[0];
      if (!current) throw new NotFoundException('找不到这份产品文案');
      const target = await client.query('SELECT snapshot FROM product_copy_versions WHERE draft_id=$1 AND version=$2',[draftId,targetVersion]);
      if (!target.rows[0]) throw new NotFoundException('找不到这个历史版本');
      const snapshot = jsonValue(target.rows[0].snapshot,{});
      if (!String(snapshot.title || '').trim() || !String(snapshot.body || '').trim()) throw new BadRequestException('历史版本内容不完整，无法恢复');
      const currentVersion = Number(current.version || 1);
      await client.query('INSERT INTO product_copy_versions(draft_id,version,snapshot,changed_by) VALUES($1,$2,$3::jsonb,$4)',
        [draftId,currentVersion,JSON.stringify(snapshotDraft(current)),'before-restore']);
      const settings = jsonValue(current.settings_value,{});
      const html = current.platform === '公众号' ? this.renderWechatHtml(snapshot.title,snapshot.summary || '',snapshot.body,settings.wechatTheme || 'clean') : '';
      const {rows:updated} = await client.query(`UPDATE product_copy_drafts SET title=$2,summary=$3,body=$4,hashtags=$5,sources=$6,
        status='草稿',approval_checks='[false,false,false]'::jsonb,provider=$7,humanized=$8,html_content=$9,
        platform_settings_snapshot=$10::jsonb,approved_at=NULL,version=$11,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [draftId,snapshot.title,snapshot.summary || '',snapshot.body,snapshot.hashtags || '',snapshot.sources || '',snapshot.provider || '',Boolean(snapshot.humanized),html,JSON.stringify(snapshot.platformSettings || {}),currentVersion + 1]);
      return updated[0];
    });
    return publicProductDraft(result);
  }

  async uploadProductDocument(productId,documentType,file) {
    if (!file) throw new BadRequestException('请选择 PDF、DOCX 或 TXT 文件');
    if (!PRODUCT_DOCUMENT_TYPES.includes(documentType)) {
      if (file.path) await rm(path.resolve(file.path),{force:true});
      throw new BadRequestException('资料类型无效');
    }
    if (!file.filename || !file.path) throw new BadRequestException('资料暂存失败，请重新上传');
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!['.pdf','.docx','.txt'].includes(extension)) {
      await rm(path.resolve(file.path),{force:true});
      throw new BadRequestException('仅支持 PDF、DOCX 和 TXT 文件');
    }
    if (Number(file.size) <= 0 || Number(file.size) > PRODUCT_DOCUMENT_MAX_BYTES) {
      await rm(path.resolve(file.path),{force:true});
      throw new BadRequestException('资料必须大于 0 且不超过 25 MB');
    }
    try { await this.findInsuranceProduct(productId); }
    catch (error) { await rm(path.resolve(file.path),{force:true}); throw error; }
    const fileName = path.basename(String(file.originalname || '资料')).replace(/[\u0000-\u001f]/g,'').slice(0,240) || '产品资料';
    let inserted;
    try {
      inserted = await this.db.query(`INSERT INTO product_documents(product_id,document_type,file_name,storage_name,mime_type,byte_size)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[productId,documentType,fileName,path.basename(file.filename),file.mimetype || 'application/octet-stream',Number(file.size)]);
    } catch (error) {
      await rm(path.resolve(file.path),{force:true});
      throw error;
    }
    const documentId = Number(inserted.rows[0].id);
    try {
      const buffer = await readFile(path.resolve(file.path));
      const parsed = await extractProductDocumentText({buffer,fileName});
      const limited = parsed.text.slice(0,MAX_PRODUCT_TEXT);
      let remaining = MAX_PRODUCT_TEXT;
      const pages = parsed.pages.map((page) => {
        const text = String(page.text || '').slice(0,remaining);
        remaining = Math.max(0,remaining - text.length);
        return {num:Number(page.num),text};
      });
      const warnings = [...parsed.warnings];
      if (parsed.text.length > MAX_PRODUCT_TEXT) warnings.push(`资料文字超过首期解析上限，仅保留前 ${MAX_PRODUCT_TEXT.toLocaleString()} 字符。`);
      const parseStatus = limited.length >= 40 ? 'parsed' : 'needs_review';
      const parseError = parseStatus === 'needs_review' ? '没有提取到足够的正文文字；扫描版资料暂不支持自动 OCR。' : null;
      const updated = await this.db.query(`UPDATE product_documents SET parse_status=$2,parse_error=$3,page_count=$4,
        extracted_char_count=$5,extracted_text=$6,extracted_pages=$7::jsonb,warnings=$8::jsonb,updated_at=NOW()
        WHERE id=$1 RETURNING *`,[documentId,parseStatus,parseError,parsed.pageCount,limited.length,limited,JSON.stringify(pages),JSON.stringify(warnings)]);
      await this.db.query('UPDATE insurance_products SET updated_at=NOW() WHERE id=$1',[productId]);
      return publicDocument(updated.rows[0]);
    } catch (error) {
      const message = String(error?.message || '资料解析失败').slice(0,500);
      const {rows} = await this.db.query(`UPDATE product_documents SET parse_status='failed',parse_error=$2,updated_at=NOW() WHERE id=$1 RETURNING *`,[documentId,message]);
      return publicDocument(rows[0]);
    }
  }

  async productDocumentFile(documentId) {
    const {rows} = await this.db.query('SELECT file_name,storage_name,mime_type FROM product_documents WHERE id=$1',[documentId]);
    if (!rows[0]) throw new NotFoundException('找不到这份产品资料');
    return {...rows[0],path:safeStoragePath(rows[0].storage_name)};
  }

  async deleteProductDocument(documentId) {
    const result = await this.db.transaction(async (client) => {
      const {rows} = await client.query('SELECT * FROM product_documents WHERE id=$1 FOR UPDATE',[documentId]);
      if (!rows[0]) throw new NotFoundException('找不到这份产品资料');
      const counts = await client.query(`SELECT COUNT(DISTINCT e.id)::int AS extractions,
        COUNT(DISTINCT d.id)::int AS drafts FROM product_extractions e
        LEFT JOIN product_copy_drafts d ON d.extraction_id=e.id WHERE e.document_id=$1`,[documentId]);
      await client.query('DELETE FROM product_documents WHERE id=$1',[documentId]);
      await client.query('UPDATE insurance_products SET updated_at=NOW() WHERE id=$1',[rows[0].product_id]);
      return {row:rows[0],counts:counts.rows[0] || {extractions:0,drafts:0}};
    });
    await rm(safeStoragePath(result.row.storage_name),{force:true}).catch((error) => {
      console.warn(`[workbench] Could not remove product document file ${path.basename(result.row.storage_name)}: ${error.message}`);
    });
    return {documentId:Number(documentId),deletedExtractions:Number(result.counts.extractions || 0),deletedDrafts:Number(result.counts.drafts || 0)};
  }

  async deleteInsuranceProduct(productId) {
    const result = await this.db.transaction(async (client) => {
      const product = await client.query('SELECT id FROM insurance_products WHERE id=$1 FOR UPDATE',[productId]);
      if (!product.rows[0]) throw new NotFoundException('找不到这个产品档案');
      const documents = await client.query('SELECT storage_name FROM product_documents WHERE product_id=$1',[productId]);
      const counts = await client.query(`SELECT COUNT(DISTINCT e.id)::int AS extractions,COUNT(DISTINCT d.id)::int AS drafts
        FROM product_extractions e LEFT JOIN product_copy_drafts d ON d.extraction_id=e.id WHERE e.product_id=$1`,[productId]);
      await client.query('DELETE FROM insurance_products WHERE id=$1',[productId]);
      return {storageNames:documents.rows.map((row) => row.storage_name),counts:counts.rows[0] || {extractions:0,drafts:0}};
    });
    const cleanup = await Promise.allSettled(result.storageNames.map((name) => rm(safeStoragePath(name),{force:true})));
    cleanup.forEach((item,index) => {
      if (item.status === 'rejected') console.warn(`[workbench] Could not remove product document file ${path.basename(result.storageNames[index])}: ${item.reason?.message || 'file cleanup failed'}`);
    });
    return {productId:Number(productId),deletedDocuments:result.storageNames.length,deletedExtractions:Number(result.counts.extractions || 0),deletedDrafts:Number(result.counts.drafts || 0)};
  }

  async analyzeProductDocument(documentId) {
    const {rows} = await this.db.query(`SELECT p.*,c.label AS company_label,t.label AS insurance_type_label,
      doc.id AS document_id,doc.file_name,doc.document_type,doc.parse_status,doc.page_count,
      doc.extracted_text,doc.extracted_pages FROM product_documents doc
      JOIN insurance_products p ON p.id=doc.product_id
      JOIN product_company_dictionary c ON c.code=p.company_code
      JOIN product_insurance_type_dictionary t ON t.code=p.insurance_type_code WHERE doc.id=$1`,[documentId]);
    const row = rows[0];
    if (!row) throw new NotFoundException('找不到这份产品资料');
    if (!['parsed','needs_review'].includes(row.parse_status) || !String(row.extracted_text || '').trim()) {
      throw new BadRequestException('这份资料没有可整理的文字，请先检查或重新上传');
    }
    const product = publicProduct(row);
    const document = {
      id:Number(row.document_id),fileName:row.file_name,documentType:row.document_type,pageCount:row.page_count,
      extractedText:row.extracted_text,pages:parseJsonArray(row.extracted_pages),
    };
    const prompt = buildProductAnalysisPrompt({product,document});
    const generated = await this.callModel(prompt.instructions,prompt.input);
    if (!generated) throw new ServiceUnavailableException('尚未配置 RUNWARE_API_KEY，无法调用 GPT 整理产品资料');
    const analysis = normalizeProductAnalysis(generated,{documentId:Number(documentId),document,documentText:document.extractedText,documentPages:document.pages});
    const {rows:inserted} = await this.db.query(`INSERT INTO product_extractions(product_id,document_id,positioning,facts,open_questions,status,provider)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,'待核对',$6) RETURNING *`,
    [row.id,documentId,analysis.positioning,JSON.stringify(analysis.facts),JSON.stringify(analysis.openQuestions),runwareTextModel()]);
    await this.db.query('UPDATE insurance_products SET updated_at=NOW() WHERE id=$1',[row.id]);
    return publicExtraction({...inserted[0],file_name:row.file_name,document_type:row.document_type,page_count:row.page_count});
  }

  async updateProductExtraction(extractionId,body={}) {
    if (!Array.isArray(body.facts) || !body.facts.length || body.facts.length > 18) throw new BadRequestException('产品要点格式无效');
    return this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT e.*,doc.file_name,doc.document_type,doc.page_count
        FROM product_extractions e JOIN product_documents doc ON doc.id=e.document_id WHERE e.id=$1 FOR UPDATE OF e`,[extractionId]);
      const current = rows[0];
      if (!current) throw new NotFoundException('找不到这份产品要点');
      const existingFacts = parseJsonArray(current.facts);
      const existingById = new Map(existingFacts.map((fact) => [fact.id,fact]));
      const nextFacts = body.facts.map((input) => {
        const existing = existingById.get(String(input?.id || ''));
        if (!existing) throw new BadRequestException('产品要点来源无效，请重新加载后再保存');
        if (input.confirmed !== undefined && typeof input.confirmed !== 'boolean') throw new BadRequestException('产品要点核对状态无效');
        if (input.confirmed === true && !existing.sourceRefs?.some((source) => source.verified)) throw new BadRequestException('没有可核对的资料原文，不能确认这条要点');
        return {
          ...existing,
          title:cleanText(input.title,'要点标题',100,{required:true}),
          productFact:cleanText(input.productFact,'资料事实',1200,{required:true}),
          plainExplanation:cleanText(input.plainExplanation,'通俗解释',1200),
          customerValue:cleanText(input.customerValue,'需求价值',1000),
          boundary:cleanText(input.boundary,'适用边界',1000),
          confirmed:input.confirmed === true,
        };
      });
      const {rows:updated} = await client.query(`UPDATE product_extractions SET facts=$2::jsonb,status='待核对',confirmed_at=NULL,updated_at=NOW()
        WHERE id=$1 RETURNING *`,[extractionId,JSON.stringify(nextFacts)]);
      const drafts = await client.query('SELECT * FROM product_copy_drafts WHERE extraction_id=$1 FOR UPDATE',[extractionId]);
      for (const draft of drafts.rows) {
        const version = Number(draft.version || 1);
        await client.query('INSERT INTO product_copy_versions(draft_id,version,snapshot,changed_by) VALUES($1,$2,$3::jsonb,$4)',
          [draft.id,version,JSON.stringify(snapshotDraft(draft)),'facts-recheck']);
        await client.query(`UPDATE product_copy_drafts SET status='草稿',approval_checks='[false,false,false]'::jsonb,
          approved_at=NULL,version=$2,updated_at=NOW() WHERE id=$1`,[draft.id,version + 1]);
      }
      return publicExtraction({...updated[0],file_name:current.file_name,document_type:current.document_type,page_count:current.page_count});
    });
  }

  async confirmProductExtraction(extractionId) {
    return this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT e.*,doc.file_name,doc.document_type,doc.page_count FROM product_extractions e
        JOIN product_documents doc ON doc.id=e.document_id WHERE e.id=$1 FOR UPDATE OF e`,[extractionId]);
      const current = rows[0];
      if (!current) throw new NotFoundException('找不到这份产品要点');
      const facts = parseJsonArray(current.facts);
      if (!facts.length || facts.some((fact) => !fact.confirmed || !fact.sourceRefs?.some((source) => source.verified))) {
        throw new BadRequestException('请逐条确认产品事实，并确认每条要点都有可核对的资料原文');
      }
      const {rows:updated} = await client.query(`UPDATE product_extractions SET status='已确认',confirmed_at=NOW(),updated_at=NOW()
        WHERE id=$1 RETURNING *`,[extractionId]);
      return publicExtraction({...updated[0],file_name:current.file_name,document_type:current.document_type,page_count:current.page_count});
    });
  }

  async generateProductCopyDraft(extractionId,platform) {
    const {rows} = await this.db.query(`SELECT e.*,p.product_name,p.product_version,p.company_code,
      doc.file_name,doc.document_type,doc.page_count FROM product_extractions e
      JOIN insurance_products p ON p.id=e.product_id JOIN product_documents doc ON doc.id=e.document_id WHERE e.id=$1`,[extractionId]);
    const row = rows[0];
    if (!row) throw new NotFoundException('找不到这份产品要点');
    if (row.status !== '已确认') throw new BadRequestException('请先完成产品要点的人工核对');
    const product = {productName:row.product_name,productVersion:row.product_version,companyCode:row.company_code};
    const extraction = {positioning:row.positioning,facts:parseJsonArray(row.facts)};
    const platformSettings = (await this.productCenterPlatformSettings()).find((item) => item.platform === platform) || {};
    const prompt = buildProductCopyPrompt({product,extraction,platform,platformConfig:platformSettings});
    const generated = await this.callModel(prompt.instructions,prompt.input);
    if (!generated) throw new ServiceUnavailableException('尚未配置 RUNWARE_API_KEY，无法生成产品平台文案');
    const output = normalizeProductCopy(generated,platform);
    output.title = cleanGeneratedCopy(output.title);
    output.summary = cleanGeneratedCopy(output.summary);
    output.hashtags = cleanGeneratedCopy(output.hashtags);
    let humanized = false;
    let polished = output.body;
    try {
      const result = await this.runSkill({skill:'humanizer-zh',drafts:[{platform,title:output.title,text:output.body}]},600_000);
      const candidate = (result.drafts || []).find((draft) => draft.platform === platform)?.text;
      if (String(candidate || '').trim()) { polished = candidate; humanized = true; }
    } catch (error) {
      console.warn(`[workbench] humanizer-zh unavailable for product draft ${platform}: ${String(error?.message || 'skill error').slice(0,180)}`);
    }
    const body = cleanGeneratedCopy(polished).slice(0,40_000);
    const facts = extraction.facts.filter((fact) => fact.confirmed);
    const sources = productCopySources(facts);
    const settings = await this.getSettings();
    const htmlContent = platform === '公众号' ? this.renderWechatHtml(output.title,output.summary,body,settings.content?.wechatTheme || 'clean') : '';
    const result = await this.db.transaction(async (client) => {
      const prior = await client.query('SELECT * FROM product_copy_drafts WHERE extraction_id=$1 AND platform=$2 FOR UPDATE',[extractionId,platform]);
      let saved;
      if (prior.rows[0]) {
        const old = prior.rows[0];
        const oldVersion = Number(old.version || 1);
        await client.query('INSERT INTO product_copy_versions(draft_id,version,snapshot,changed_by) VALUES($1,$2,$3::jsonb,$4)',
          [old.id,oldVersion,JSON.stringify(snapshotDraft(old)),'before-regenerate']);
        const update = await client.query(`UPDATE product_copy_drafts SET title=$2,summary=$3,body=$4,hashtags=$5,sources=$6,
          status='待审核',approval_checks='[false,false,false]'::jsonb,provider=$7,humanized=$8,html_content=$9,
          platform_settings_snapshot=$10::jsonb,version=$11,approved_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [old.id,output.title,output.summary,body,output.hashtags,sources,runwareTextModel(),humanized,htmlContent,JSON.stringify(platformSettings),oldVersion + 1]);
        saved = update.rows[0];
      } else {
        const insert = await client.query(`INSERT INTO product_copy_drafts(product_id,extraction_id,platform,title,summary,body,hashtags,sources,
          status,approval_checks,provider,humanized,html_content,platform_settings_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'待审核','[false,false,false]'::jsonb,$9,$10,$11,$12::jsonb) RETURNING *`,
        [row.product_id,extractionId,platform,output.title,output.summary,body,output.hashtags,sources,runwareTextModel(),humanized,htmlContent,JSON.stringify(platformSettings)]);
        saved = insert.rows[0];
      }
      await client.query('UPDATE insurance_products SET updated_at=NOW() WHERE id=$1',[row.product_id]);
      return saved;
    });
    return publicProductDraft(result);
  }

  async saveProductCopyDraft(draftId,body={}) {
    const result = await this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT d.*,p.product_name,settings.value AS settings_value FROM product_copy_drafts d
        JOIN insurance_products p ON p.id=d.product_id LEFT JOIN settings ON settings.key='content' WHERE d.id=$1 FOR UPDATE OF d`,[draftId]);
      const current = rows[0];
      if (!current) throw new NotFoundException('找不到这份产品文案');
      const title = body.title === undefined ? current.title : cleanText(body.title,'标题',200,{required:true});
      const summary = body.summary === undefined ? current.summary : cleanText(body.summary,'摘要',500);
      const text = body.body === undefined ? current.body : cleanText(body.body,'正文',40_000,{required:true});
      const hashtags = body.hashtags === undefined ? current.hashtags : cleanText(body.hashtags,'话题标签',800);
      const contentChanged = title !== current.title || summary !== current.summary || text !== current.body || hashtags !== current.hashtags;
      if (body.checks !== undefined && (!Array.isArray(body.checks) || body.checks.length !== 3 || body.checks.some((value) => typeof value !== 'boolean'))) throw new BadRequestException('发布前核对项格式无效');
      const incomingChecks = Array.isArray(body.checks) ? body.checks : null;
      const checks = incomingChecks && incomingChecks.length === 3 ? incomingChecks : jsonValue(current.approval_checks,[false,false,false]).map(Boolean).slice(0,3);
      const safeChecks = contentChanged ? [false,false,false] : checks;
      const status = contentChanged ? '草稿' : current.status;
      const settings = jsonValue(current.settings_value,{});
      const html = current.platform === '公众号' ? this.renderWechatHtml(title,summary,text,settings.wechatTheme || 'clean') : '';
      if (!contentChanged && JSON.stringify(safeChecks) === JSON.stringify(jsonValue(current.approval_checks,[false,false,false]))) return current;
      const version = Number(current.version || 1);
      await client.query('INSERT INTO product_copy_versions(draft_id,version,snapshot,changed_by) VALUES($1,$2,$3::jsonb,$4)',
        [draftId,version,JSON.stringify(snapshotDraft(current)),'agent-edit']);
      const {rows:updated} = await client.query(`UPDATE product_copy_drafts SET title=$2,summary=$3,body=$4,hashtags=$5,
        status=$6,approval_checks=$7::jsonb,html_content=$8,approved_at=NULL,version=$9,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [draftId,title,summary,text,hashtags,status,JSON.stringify(safeChecks),html,version + 1]);
      return updated[0];
    });
    return publicProductDraft(result);
  }

  async approveProductCopyDraft(draftId,body={}) {
    const checks = body.checks;
    if (!Array.isArray(checks) || checks.length !== 3 || checks.some((value) => typeof value !== 'boolean') || !checks.every((value) => value === true)) {
      throw new BadRequestException('请先完成三项发布前核对');
    }
    return this.db.transaction(async (client) => {
      const {rows} = await client.query(`SELECT d.id,d.extraction_id,e.status AS extraction_status FROM product_copy_drafts d
        JOIN product_extractions e ON e.id=d.extraction_id WHERE d.id=$1 FOR UPDATE OF d,e`,[draftId]);
      if (!rows[0]) throw new NotFoundException('找不到这份产品文案');
      if (rows[0].extraction_status !== '已确认') throw new BadRequestException('产品要点已失效，请重新核对后再审核文案');
      const {rows:updated} = await client.query(`UPDATE product_copy_drafts SET status='已审核',approval_checks=$2::jsonb,
        approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`,[draftId,JSON.stringify(checks)]);
      return publicProductDraft(updated[0]);
    });
  }
}
