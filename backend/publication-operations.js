import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CHANNELS, strictDate } from './workbench-primitives.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestKey(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new BadRequestException('请求标识无效，请重试');
  return value;
}

function publishTime(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('发布时间格式无效');
  return value;
}

function publishUrl(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (text.length > 2048) throw new BadRequestException('发布链接过长');
  try {
    const url = new URL(text);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid');
  } catch { throw new BadRequestException('发布链接需以 http:// 或 https:// 开头'); }
  return text;
}

function shortText(value,label,max = 1000) {
  const text = String(value || '').trim();
  if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字`);
  return text;
}

function selectedAssetIds(value) {
  if (!Array.isArray(value) || value.length > 10 || value.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1) || new Set(value.map(Number)).size !== value.length) {
    throw new BadRequestException('配图选择无效');
  }
  return value.map(Number);
}

function publicationSummary(row) {
  return {
    id:Number(row.id),draftId:Number(row.draft_id),topicId:row.topic_id,platform:row.platform,
    topicTitle:row.topic_title_snapshot,title:row.title_snapshot,
    publishedOn:row.published_on_text,publishedTime:row.published_time_text || null,
    publishUrl:row.publish_url,note:row.note,status:row.status,origin:row.origin,
    recordedAt:row.recorded_at,updatedAt:row.updated_at,voidedAt:row.voided_at,
  };
}

const publicationSelect = `SELECT p.*,d.topic_id,
  TO_CHAR(p.published_on,'YYYY-MM-DD') AS published_on_text,
  TO_CHAR(p.published_time,'HH24:MI') AS published_time_text
  FROM content_publications p JOIN drafts d ON d.id=p.draft_id`;

async function syncLatestPublication(client,draftId,markPublished = false) {
  const latest = await client.query(`SELECT TO_CHAR(published_on,'YYYY-MM-DD') AS published_on_text,
    TO_CHAR(published_time,'HH24:MI') AS published_time_text,publish_url
    FROM content_publications WHERE draft_id=$1 AND status='active'
    ORDER BY published_on DESC,published_time DESC NULLS LAST,id DESC LIMIT 1`,[draftId]);
  const row = latest.rows[0];
  const timestamp = row ? `${row.published_on_text}T${row.published_time_text || '00:00'}:00+08:00` : null;
  await client.query(`UPDATE drafts SET published_at=$2::timestamptz,publish_url=$3,
    status=CASE WHEN $4::boolean THEN '已发布'
      WHEN $2::timestamptz IS NULL AND status='已发布'
        THEN CASE WHEN approval_checks='[true,true,true]'::jsonb THEN '已审核' ELSE '草稿' END
      ELSE status END,updated_at=NOW() WHERE id=$1`,[draftId,timestamp,row?.publish_url || null,markPublished]);
}

export class PublicationOperations {
  async listPublications(filters = {}) {
    const page = Number(filters.page || 1);
    const pageSize = Number(filters.pageSize || 20);
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('分页参数无效');
    }
    const status = filters.status || 'active';
    if (!['active','voided','all'].includes(status)) throw new BadRequestException('发布记录状态无效');
    if (filters.platform && !CHANNELS.includes(filters.platform)) throw new BadRequestException('发布平台无效');
    const from = filters.from ? strictDate(filters.from,'开始日期') : null;
    const to = filters.to ? strictDate(filters.to,'结束日期') : null;
    if (from && to && from > to) throw new BadRequestException('开始日期不能晚于结束日期');
    const keyword = shortText(filters.keyword,'搜索词',100);
    const params = [];
    const where = [];
    const add = (fragment,value) => { params.push(value); where.push(fragment.replace('?',`$${params.length}`)); };
    if (status !== 'all') add('p.status=?',status);
    if (filters.platform) add('p.platform=?',filters.platform);
    if (from) add('p.published_on >= ?::date',from);
    if (to) add('p.published_on <= ?::date',to);
    if (filters.topicId) add('d.topic_id=?',String(filters.topicId));
    if (keyword) {
      params.push(`%${keyword}%`);
      where.push(`(p.title_snapshot ILIKE $${params.length} OR p.topic_title_snapshot ILIKE $${params.length})`);
    }
    const condition = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await this.db.query(`SELECT COUNT(*)::int AS total FROM content_publications p JOIN drafts d ON d.id=p.draft_id ${condition}`,params);
    const limitParam = params.length + 1;
    const rows = await this.db.query(`${publicationSelect} ${condition} ORDER BY p.published_on DESC,p.id DESC LIMIT $${limitParam} OFFSET $${limitParam + 1}`,[...params,pageSize,(page - 1) * pageSize]);
    return {items:rows.rows.map(publicationSummary),total:count.rows[0].total,page,pageSize};
  }

  async publication(id) {
    const found = await this.db.query(`${publicationSelect} WHERE p.id=$1`,[id]);
    const row = found.rows[0];
    if (!row) throw new NotFoundException('找不到发布记录');
    const [assets,availableAssets,events] = await Promise.all([
      this.db.query(`SELECT a.id,pa.file_name_snapshot,a.mime_type,pa.position FROM content_publication_assets pa
        JOIN assets a ON a.id=pa.asset_id WHERE pa.publication_id=$1 ORDER BY pa.position`,[id]),
      this.db.query('SELECT id,file_name FROM assets WHERE topic_id=$1 AND platform=$2 ORDER BY created_at,id',[row.topic_id,row.platform]),
      this.db.query(`SELECT id,action,previous_values,next_values,reason,created_at FROM content_publication_events
        WHERE publication_id=$1 ORDER BY created_at,id`,[id]),
    ]);
    return {
      ...publicationSummary(row),contentSnapshot:row.content_snapshot,
      assets:assets.rows.map((asset) => ({id:Number(asset.id),fileName:asset.file_name_snapshot,mimeType:asset.mime_type,url:`/api/assets/${asset.id}`})),
      availableAssets:availableAssets.rows.map((asset) => ({id:Number(asset.id),fileName:asset.file_name})),
      events:events.rows.map((event) => ({id:Number(event.id),action:event.action,previous:event.previous_values,next:event.next_values,reason:event.reason,createdAt:event.created_at})),
    };
  }

  async createPublication(topicId,platform,body = {}) {
    if (!CHANNELS.includes(platform)) throw new BadRequestException('发布平台无效');
    const key = requestKey(body.requestKey);
    const publishedOn = strictDate(body.publishedOn,'发布日期');
    const publishedTime = publishTime(body.publishedTime);
    const url = publishUrl(body.publishUrl);
    const note = shortText(body.note,'备注');
    const assetIds = body.assetIds;
    const normalizedAssetIds = assetIds === undefined ? undefined : selectedAssetIds(assetIds);
    const publicationId = await this.db.transaction(async (client) => {
      const draft = await client.query(`SELECT d.*,t.title AS topic_title FROM drafts d JOIN topics t ON t.id=d.topic_id
        WHERE d.topic_id=$1 AND d.platform=$2 FOR UPDATE OF d`,[topicId,platform]);
      const row = draft.rows[0];
      if (!row) throw new NotFoundException('找不到这个平台的稿件');
      const prior = await client.query('SELECT id,draft_id,published_on,published_time,publish_url,note FROM content_publications WHERE request_key=$1',[key]);
      if (prior.rows[0]) {
        const existing = prior.rows[0];
        const existingDate = await client.query("SELECT TO_CHAR(published_on,'YYYY-MM-DD') AS day,TO_CHAR(published_time,'HH24:MI') AS time FROM content_publications WHERE id=$1",[existing.id]);
        const priorAssets = await client.query('SELECT asset_id FROM content_publication_assets WHERE publication_id=$1 ORDER BY position',[existing.id]);
        if (Number(existing.draft_id) !== Number(row.id) || existingDate.rows[0].day !== publishedOn || (existingDate.rows[0].time || null) !== publishedTime || existing.publish_url !== url || existing.note !== note ||
          (assetIds !== undefined && JSON.stringify(priorAssets.rows.map((item) => Number(item.asset_id))) !== JSON.stringify(assetIds.map(Number)))) {
          throw new ConflictException('请求标识已用于其他发布记录');
        }
        return Number(existing.id);
      }
      const usedKey = await client.query('SELECT 1 FROM content_publication_events WHERE request_key=$1',[key]);
      if (usedKey.rowCount) throw new ConflictException('请求标识已用于其他操作');
      if (!['已审核','已发布'].includes(row.status)) throw new BadRequestException('请先完成该平台的人工审核');
      const duplicate = await client.query(`SELECT id FROM content_publications WHERE draft_id=$1 AND status='active'
        AND published_on=$2::date AND COALESCE(publish_url,'')=$3 LIMIT 1`,[row.id,publishedOn,url || '']);
      if (duplicate.rowCount && !body.allowDuplicate) throw new ConflictException('同一天已有相同链接的发布记录，请核对后再提交');
      const available = await client.query(`SELECT id,file_name FROM assets WHERE topic_id=$1 AND platform=$2 ORDER BY created_at,id`,[topicId,platform]);
      const selectedIds = normalizedAssetIds === undefined ? available.rows.map((asset) => Number(asset.id)) : normalizedAssetIds;
      const assetMap = new Map(available.rows.map((asset) => [Number(asset.id),asset]));
      if (selectedIds.some((id) => !assetMap.has(id))) throw new BadRequestException('所选配图不属于当前稿件');
      const snapshot = {
        title:row.title,summary:row.summary,body:row.body,hashtags:row.hashtags,sources:row.sources,
        cardPlan:row.xhs_card_plan || [],htmlContent:row.html_content,
      };
      const inserted = await client.query(`INSERT INTO content_publications
        (draft_id,platform,topic_title_snapshot,title_snapshot,published_on,published_time,publish_url,note,content_snapshot,request_key)
        VALUES($1,$2,$3,$4,$5::date,$6::time,$7,$8,$9::jsonb,$10) RETURNING id`,
      [row.id,platform,row.topic_title,row.title,publishedOn,publishedTime,url,note,JSON.stringify(snapshot),key]);
      const id = Number(inserted.rows[0].id);
      for (const [position,assetId] of selectedIds.entries()) {
        await client.query(`INSERT INTO content_publication_assets(publication_id,asset_id,position,file_name_snapshot)
          VALUES($1,$2,$3,$4)`,[id,assetId,position,assetMap.get(assetId).file_name]);
      }
      await client.query(`INSERT INTO content_publication_events(publication_id,action,next_values,request_key)
        VALUES($1,'created',$2::jsonb,$3)`,[id,JSON.stringify({publishedOn,publishedTime,publishUrl:url,note}),key]);
      await syncLatestPublication(client,row.id,true);
      return id;
    });
    return {draft:await this.getDraft(topicId,platform),publication:await this.publication(publicationId)};
  }

  async correctPublication(id,body = {}) {
    const key = requestKey(body.requestKey);
    const reason = shortText(body.reason,'更正原因',500);
    if (!reason) throw new BadRequestException('请填写更正原因');
    const assetIds = body.assetIds === undefined ? undefined : selectedAssetIds(body.assetIds);
    await this.db.transaction(async (client) => {
      const result = await client.query(`${publicationSelect} WHERE p.id=$1 FOR UPDATE OF p`,[id]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException('找不到发布记录');
      if (row.status === 'voided') throw new ConflictException('已作废的发布记录不能更正');
      const used = await client.query('SELECT publication_id,action,next_values,reason FROM content_publication_events WHERE request_key=$1',[key]);
      if (used.rows[0]) {
        const event = used.rows[0];
        if (Number(event.publication_id) !== Number(row.id) || event.action !== 'corrected' || event.reason !== reason ||
          (body.publishedOn !== undefined && event.next_values?.publishedOn !== body.publishedOn) ||
          (body.publishedTime !== undefined && event.next_values?.publishedTime !== publishTime(body.publishedTime)) ||
          (body.publishUrl !== undefined && event.next_values?.publishUrl !== publishUrl(body.publishUrl)) ||
          (body.note !== undefined && event.next_values?.note !== shortText(body.note,'备注')) ||
          (assetIds !== undefined && JSON.stringify(event.next_values?.assetIds) !== JSON.stringify(assetIds))) {
          throw new ConflictException('请求标识已用于其他操作');
        }
        return;
      }
      const currentAssets = await client.query('SELECT asset_id FROM content_publication_assets WHERE publication_id=$1 ORDER BY position',[id]);
      const previous = {publishedOn:row.published_on_text,publishedTime:row.published_time_text || null,publishUrl:row.publish_url,note:row.note,assetIds:currentAssets.rows.map((asset) => Number(asset.asset_id))};
      const next = {
        publishedOn:body.publishedOn === undefined ? previous.publishedOn : strictDate(body.publishedOn,'发布日期'),
        publishedTime:body.publishedTime === undefined ? previous.publishedTime : publishTime(body.publishedTime),
        publishUrl:body.publishUrl === undefined ? previous.publishUrl : publishUrl(body.publishUrl),
        note:body.note === undefined ? previous.note : shortText(body.note,'备注'),
        assetIds:assetIds === undefined ? previous.assetIds : assetIds,
      };
      if (JSON.stringify(previous) === JSON.stringify(next)) return;
      if (JSON.stringify(previous.assetIds) !== JSON.stringify(next.assetIds)) {
        const available = await client.query('SELECT id,file_name FROM assets WHERE topic_id=$1 AND platform=$2',[row.topic_id,row.platform]);
        const assetMap = new Map(available.rows.map((asset) => [Number(asset.id),asset]));
        if (next.assetIds.some((assetId) => !assetMap.has(assetId))) throw new BadRequestException('所选配图不属于当前稿件');
        await client.query('DELETE FROM content_publication_assets WHERE publication_id=$1',[id]);
        for (const [position,assetId] of next.assetIds.entries()) {
          await client.query(`INSERT INTO content_publication_assets(publication_id,asset_id,position,file_name_snapshot)
            VALUES($1,$2,$3,$4)`,[id,assetId,position,assetMap.get(assetId).file_name]);
        }
      }
      await client.query(`UPDATE content_publications SET published_on=$2::date,published_time=$3::time,
        publish_url=$4,note=$5,updated_at=NOW() WHERE id=$1`,[id,next.publishedOn,next.publishedTime,next.publishUrl,next.note]);
      await client.query(`INSERT INTO content_publication_events(publication_id,action,previous_values,next_values,reason,request_key)
        VALUES($1,'corrected',$2::jsonb,$3::jsonb,$4,$5)`,[id,JSON.stringify(previous),JSON.stringify(next),reason,key]);
      await syncLatestPublication(client,row.draft_id);
    });
    return this.publication(id);
  }

  async voidPublication(id,body = {}) {
    const key = requestKey(body.requestKey);
    const reason = shortText(body.reason,'作废原因',500);
    if (!reason) throw new BadRequestException('请填写作废原因');
    await this.db.transaction(async (client) => {
      const result = await client.query('SELECT * FROM content_publications WHERE id=$1 FOR UPDATE',[id]);
      const row = result.rows[0];
      if (!row) throw new NotFoundException('找不到发布记录');
      if (row.status === 'voided') return;
      const used = await client.query('SELECT publication_id,action,reason FROM content_publication_events WHERE request_key=$1',[key]);
      if (used.rows[0] && (Number(used.rows[0].publication_id) !== Number(row.id) || used.rows[0].action !== 'voided' || used.rows[0].reason !== reason)) throw new ConflictException('请求标识已用于其他操作');
      if (used.rows[0]) return;
      await client.query("UPDATE content_publications SET status='voided',voided_at=NOW(),updated_at=NOW() WHERE id=$1",[id]);
      await client.query(`INSERT INTO content_publication_events(publication_id,action,previous_values,next_values,reason,request_key)
        VALUES($1,'voided',$2::jsonb,$3::jsonb,$4,$5)`,[id,JSON.stringify({status:'active'}),JSON.stringify({status:'voided'}),reason,key]);
      await syncLatestPublication(client,row.draft_id);
    });
    return this.publication(id);
  }
}
