import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { PRODUCT_SYNC_ADAPTERS, isProductSyncUrlSafe } from './product-sync-adapters.js';

const activeRunIds = new Set();
let queuedSyncWork=Promise.resolve();
const jsonValue = (value,fallback=[]) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
};
const publicRun = (row) => ({
  id:row.id,companyCode:row.company_code,company:row.company_label || '',status:row.status,phase:row.phase,
  discoveredCount:Number(row.discovered_count || 0),importedCount:Number(row.imported_count || 0),
  updatedCount:Number(row.updated_count || 0),excludedCount:Number(row.excluded_count || 0),
  materialCount:Number(row.material_count || 0),errorCount:Number(row.error_count || 0),
  errors:jsonValue(row.errors,[]),sourceSummary:jsonValue(row.source_summary,{}),
  startedAt:row.started_at,finishedAt:row.finished_at,createdAt:row.created_at,
});
const productMaterialKey = (material) => createHash('sha256').update(`${material.type}\n${material.url}`).digest('hex');
const groupProduct = (product) => product.scope === 'group' || /团体|团险/.test(product.productName || '');
const retryableNetworkError = (error) => /官网返回 HTTP (?:429|5\d\d)|fetch failed|network|timeout|timed out|AbortError/i.test(String(error?.message || error?.name || ''));
const wait = (ms) => new Promise((resolve)=>setTimeout(resolve,ms));
const safeProduct = (product,companyCode) => {
  const name=String(product.productName || '').trim();
  return name && name.length<=120 && !groupProduct(product) &&
    product.scope !== 'unknown' && ['individual','supplementary'].includes(product.scope) &&
    product.officialProductUrl && isProductSyncUrlSafe(product.officialProductUrl,companyCode) &&
    product.evidenceUrl && isProductSyncUrlSafe(product.evidenceUrl,companyCode);
};

export class ProductSyncOperations {
  async updateProductSyncCompany(companyCode,body={}) {
    const code=String(companyCode || '').trim();
    const enabled=body.syncEnabled;
    if (typeof enabled!=='boolean') throw new BadRequestException('请指定是否启用该公司的同步');
    const {rows}=await this.db.query(`UPDATE product_company_dictionary SET sync_enabled=$2
      WHERE code=$1 AND sync_supported=TRUE RETURNING code,label,sync_enabled`,[code,enabled]);
    if (!rows[0]) throw new NotFoundException('找不到可同步的保险公司');
    return {code:rows[0].code,label:rows[0].label,syncEnabled:rows[0].sync_enabled};
  }

  async startProductSync(body={}) {
    const requested=Array.isArray(body.companyCodes) ? [...new Set(body.companyCodes.map((code)=>String(code || '').trim()).filter(Boolean))] : [];
    if (!requested.length || requested.length>5) throw new BadRequestException('请选择 1 到 5 家保险公司');
    const {rows:companies}=await this.db.query(`SELECT code,label,adapter_code,sync_enabled,sync_supported
      FROM product_company_dictionary WHERE code=ANY($1::text[]) ORDER BY sort_order`,[requested]);
    if (companies.length!==requested.length) throw new BadRequestException('所选公司中包含未配置的保险公司');
    for (const company of companies) {
      if (!company.sync_supported || !PRODUCT_SYNC_ADAPTERS[company.adapter_code]) throw new BadRequestException(`${company.label}暂未接入官网同步`);
      if (!company.sync_enabled) throw new BadRequestException(`请先启用${company.label}同步`);
    }
    const results=[]; const scheduled=[];
    for (const company of companies) {
      const id=randomUUID();
      const inserted=await this.db.query(`INSERT INTO product_sync_runs(id,company_code,status,phase)
        VALUES($1,$2,'queued','queued')
        ON CONFLICT (company_code) WHERE status IN ('queued','running') DO NOTHING
        RETURNING *`,[id,company.code]);
      let run=inserted.rows[0];
      if (!run) {
        const active=await this.db.query(`SELECT r.*,c.label AS company_label FROM product_sync_runs r
          JOIN product_company_dictionary c ON c.code=r.company_code
          WHERE r.company_code=$1 AND r.status IN ('queued','running') ORDER BY r.created_at DESC LIMIT 1`,[company.code]);
        run=active.rows[0];
      } else {
        run={...run,company_label:company.label};
        scheduled.push(run.id);
      }
      if (run) results.push(publicRun(run));
    }
    if (scheduled.length) {
      for (const id of scheduled) activeRunIds.add(id);
      setTimeout(() => {
        queuedSyncWork=queuedSyncWork.then(()=>this.runProductSyncQueue(scheduled)).catch(()=>{});
      },0);
    }
    return {runs:results};
  }

  async runProductSyncQueue(runIds) {
    for (const runId of runIds) {
      try { await this.runProductSync(runId); }
      catch (error) {
        const message=String(error?.message || '同步失败').slice(0,500);
        await this.db.query(`UPDATE product_sync_runs SET status='failed',phase='failed',error_count=error_count+1,
          errors=errors || $2::jsonb,finished_at=NOW(),heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1 AND status IN ('queued','running')`,
        [runId,JSON.stringify([{message}])]).catch(()=>{});
      } finally { activeRunIds.delete(runId); }
    }
  }

  async runProductSync(runId) {
    const {rows}=await this.db.query(`SELECT r.*,c.label AS company_label,c.adapter_code
      FROM product_sync_runs r JOIN product_company_dictionary c ON c.code=r.company_code WHERE r.id=$1`,[runId]);
    const run=rows[0]; if (!run || !['queued','running'].includes(run.status)) return;
    await this.db.query(`UPDATE product_sync_runs SET status='running',phase='reading_official_catalog',started_at=COALESCE(started_at,NOW()),
      heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1`,[runId]);
    const adapter=PRODUCT_SYNC_ADAPTERS[run.adapter_code];
    if (!adapter) throw new Error('该公司暂无官网同步适配器');
    let result; let lastError;
    for (let attempt=0;attempt<3;attempt++) {
      try { result=await adapter(); lastError=null; break; }
      catch(error) {
        lastError=error;
        if (attempt===2 || !retryableNetworkError(error)) throw error;
        await wait(800*(attempt+1));
      }
    }
    if (lastError) throw lastError;
    if (!result?.products?.length || !result.sourceSummary?.sourceUrls?.length) throw new Error('官网目录不完整或缺少明确来源，未更新产品库');
    const deduped=new Map();
    for (const product of result.products) {
      if (!safeProduct(product,run.company_code)) continue;
      deduped.set(product.productKey,product);
    }
    if (!deduped.size) throw new Error('官网目录中没有可确认在售的个人保险产品');
    const products=[...deduped.values()];
    const seenKeys=[]; let imported=0; let updated=0; let materialCount=0; const errors=[];
    await this.db.query(`UPDATE product_sync_runs SET phase='saving_products',discovered_count=$2,excluded_count=$3,
      source_summary=$4::jsonb,heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [runId,products.length,Number(result.excluded || 0)+Math.max(0,result.products.length-products.length),JSON.stringify(result.sourceSummary)]);
    for (let index=0;index<products.length;index++) {
      const product=products[index]; seenKeys.push(product.productKey);
      try {
        const action=await this.db.transaction(async (client)=>{
          const existing=await client.query(`SELECT id FROM insurance_products WHERE company_code=$1 AND source_type='official_sync' AND source_product_key=$2 FOR UPDATE`,[run.company_code,product.productKey]);
          let row; let operation;
          if (existing.rows[0]) {
            const saved=await client.query(`UPDATE insurance_products SET insurance_type_code=$2,product_name=$3,
              official_product_code=$4,official_product_url=$5,official_sale_status='verified_on_sale',
              sale_status_evidence_url=$6,product_scope=$7,last_verified_at=NOW(),last_sync_run_id=$8,
              note=$9,updated_at=NOW() WHERE id=$1 RETURNING id`,[
              existing.rows[0].id,product.insuranceTypeCode,product.productName,product.officialProductCode,
              product.officialProductUrl,product.evidenceUrl,product.scope,runId,`官网目录同步 · ${result.sourceSummary.coverage || ''}`.slice(0,1200),
            ]);
            row=saved.rows[0]; operation='updated';
          } else {
            const saved=await client.query(`INSERT INTO insurance_products(company_code,insurance_type_code,product_name,product_version,status,note,
              source_type,source_product_key,official_product_code,official_product_url,official_sale_status,sale_status_evidence_url,product_scope,last_verified_at,last_sync_run_id)
              VALUES($1,$2,$3,'','整理中',$4,'official_sync',$5,$6,$7,'verified_on_sale',$8,$9,NOW(),$10) RETURNING id`,[
              run.company_code,product.insuranceTypeCode,product.productName,`官网目录同步 · ${result.sourceSummary.coverage || ''}`.slice(0,1200),
              product.productKey,product.officialProductCode,product.officialProductUrl,product.evidenceUrl,product.scope,runId,
            ]);
            row=saved.rows[0]; operation='imported';
          }
          await client.query('UPDATE product_official_materials SET is_current=FALSE WHERE product_id=$1',[row.id]);
          let savedMaterials=0;
          for (const item of product.materials || []) {
            if (!item?.url || !isProductSyncUrlSafe(item.url,run.company_code)) continue;
            const sourceKey=productMaterialKey(item);
            await client.query(`INSERT INTO product_official_materials(product_id,material_type,label,source_key,source_url,source_page_url,is_current,last_seen_at,last_sync_run_id)
              VALUES($1,$2,$3,$4,$5,$6,TRUE,NOW(),$7)
              ON CONFLICT(product_id,source_key) DO UPDATE SET material_type=EXCLUDED.material_type,label=EXCLUDED.label,
              source_url=EXCLUDED.source_url,source_page_url=EXCLUDED.source_page_url,is_current=TRUE,last_seen_at=NOW(),last_sync_run_id=EXCLUDED.last_sync_run_id`,
            [row.id,item.type,item.label,sourceKey,item.url,item.pageUrl || product.evidenceUrl,runId]);
            savedMaterials++;
          }
          await client.query(`INSERT INTO product_sync_events(run_id,product_id,product_key,action,reason,source_url,details)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,[runId,row.id,product.productKey,operation,'官网目录明确标记为在售',product.evidenceUrl,JSON.stringify({materialCount:savedMaterials})]);
          return {operation,materialCount:savedMaterials};
        });
        if (action.operation==='imported') imported++; else updated++;
        materialCount+=action.materialCount;
      } catch (error) {
        errors.push({productKey:product.productKey,productName:product.productName,message:String(error?.message || '产品入库失败').slice(0,300)});
      }
      if (index%10===9 || index===products.length-1) {
        await this.db.query(`UPDATE product_sync_runs SET imported_count=$2,updated_count=$3,material_count=$4,
          error_count=$5,errors=$6::jsonb,phase='saving_products',heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [runId,imported,updated,materialCount,errors.length,JSON.stringify(errors)]);
      }
    }
    if (!errors.length) {
      const missing=await this.db.query(`UPDATE insurance_products SET official_sale_status='review_required',updated_at=NOW()
        WHERE company_code=$1 AND source_type='official_sync' AND official_sale_status='verified_on_sale'
          AND NOT (source_product_key=ANY($2::text[])) RETURNING id,source_product_key,official_product_url`,[run.company_code,seenKeys]);
      for (const row of missing.rows) await this.db.query(`INSERT INTO product_sync_events(run_id,product_id,product_key,action,reason,source_url)
        VALUES($1,$2,$3,'review_required','本次完整在售目录中未出现，不能据此判断停售',$4)`,[runId,row.id,row.source_product_key,row.official_product_url]);
    }
    const status=errors.length ? (imported+updated ? 'partial_success' : 'failed') : 'success';
    await this.db.query(`UPDATE product_sync_runs SET status=$2,phase=$3,imported_count=$4,updated_count=$5,
      material_count=$6,error_count=$7,errors=$8::jsonb,finished_at=NOW(),heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [runId,status,status,imported,updated,materialCount,errors.length,JSON.stringify(errors)]);
  }

  async getProductSyncRun(runId) {
    let {rows}=await this.db.query(`SELECT r.*,c.label AS company_label FROM product_sync_runs r
      JOIN product_company_dictionary c ON c.code=r.company_code WHERE r.id=$1`,[runId]);
    if (!rows[0]) throw new NotFoundException('找不到这次同步记录');
    if (['queued','running'].includes(rows[0].status) && !activeRunIds.has(runId)) {
      await this.db.query(`UPDATE product_sync_runs SET status='failed',phase='failed',error_count=error_count+1,
        errors=errors || '[{"message":"同步任务在服务重启时中断，可重新发起同步"}]'::jsonb,finished_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status IN ('queued','running')`,[runId]);
      ({rows}=await this.db.query(`SELECT r.*,c.label AS company_label FROM product_sync_runs r
        JOIN product_company_dictionary c ON c.code=r.company_code WHERE r.id=$1`,[runId]));
    }
    return publicRun(rows[0]);
  }

  async listProductSyncRuns() {
    const {rows}=await this.db.query(`SELECT DISTINCT ON (r.company_code) r.*,c.label AS company_label
      FROM product_sync_runs r JOIN product_company_dictionary c ON c.code=r.company_code
      ORDER BY r.company_code,r.created_at DESC LIMIT 50`);
    return rows.map(publicRun);
  }
}
