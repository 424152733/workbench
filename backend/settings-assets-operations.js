import { BadRequestException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isRasterImage, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from './image-utils.js';
import { normalizeXhsCardPlan } from './content-prompts.js';
import { CHANNELS, DEFAULT_IMAGE_STYLES, DEFAULT_WECHAT_THEME, DEFAULT_XHS_IMAGE_MODE, XHS_IMAGE_MODES, WECHAT_THEMES, IMAGE_STYLE_OPTIONS, addCalendarDays, beijingDate, dateOnly, beijingMonthStart } from './workbench-primitives.js';

export class SettingsAssetsOperations {
  async getSettings() {
    const { rows } = await this.db.query('SELECT key,value FROM settings WHERE key IN (\'content\',\'preferences\')');
    const result = Object.fromEntries(rows.map((row) => [row.key,row.value]));
    const savedContent = result.content || {};
    const { xhsImageCount: _legacyXhsImageCount,...savedContentWithoutLegacyCount } = savedContent;
    const savedStyles = savedContent.imageStyles || {};
    result.content = {
      autoEnabled:false,frequencyDays:2,runAt:'09:00',voice:'',...savedContentWithoutLegacyCount,
      wechatTheme:WECHAT_THEMES.has(savedContent.wechatTheme) ? savedContent.wechatTheme : DEFAULT_WECHAT_THEME,
      xhsImageMode:XHS_IMAGE_MODES.has(savedContent.xhsImageMode) ? savedContent.xhsImageMode : DEFAULT_XHS_IMAGE_MODE,
      imageStyles:{
        xhs:{ ...DEFAULT_IMAGE_STYLES.xhs,...(savedStyles.xhs || {}) },
        article:{ ...DEFAULT_IMAGE_STYLES.article,...(savedStyles.article || {}) },
      },
    };
    return result;
  }

  async updateSettings(body) {
    if (body.content) {
      const existing = (await this.db.query("SELECT value FROM settings WHERE key='content'")).rows[0]?.value || {};
      const updated = { autoEnabled:false,frequencyDays:2,runAt:'09:00',voice:'',wechatTheme:DEFAULT_WECHAT_THEME,xhsImageMode:DEFAULT_XHS_IMAGE_MODE,...existing,...body.content };
      if (body.content.wechatTheme !== undefined && !WECHAT_THEMES.has(body.content.wechatTheme)) throw new BadRequestException('公众号排版主题无效');
      if (body.content.xhsImageMode !== undefined && !XHS_IMAGE_MODES.has(body.content.xhsImageMode)) throw new BadRequestException('小红书生图模式只能是测试或生产');
      delete updated.xhsImageCount;
      if (body.content.imageStyles) {
        const imageStyles = {
          ...DEFAULT_IMAGE_STYLES,
          ...(existing.imageStyles || {}),
          xhs:{ ...DEFAULT_IMAGE_STYLES.xhs,...(existing.imageStyles?.xhs || {}) },
          article:{ ...DEFAULT_IMAGE_STYLES.article,...(existing.imageStyles?.article || {}) },
        };
        for (const group of ['xhs','article']) {
          if (body.content.imageStyles[group] === undefined) continue;
          const candidate = { ...imageStyles[group],...body.content.imageStyles[group] };
          for (const [key,allowed] of Object.entries(IMAGE_STYLE_OPTIONS[group])) {
            if (!allowed.has(candidate[key])) throw new BadRequestException(`不支持的${group === 'xhs' ? '小红书' : '文章插图'}${key}配置`);
          }
          imageStyles[group] = candidate;
        }
        updated.imageStyles = imageStyles;
      }
      if (updated.frequencyDays < 1 || updated.frequencyDays > 30) throw new BadRequestException('频率范围为 1 至 30 天');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(updated.runAt || '')) throw new BadRequestException('请填写有效的运行时间');
      if (body.content.autoEnabled && (body.content.autoEnabled !== existing.autoEnabled || body.content.frequencyDays !== undefined || body.content.runAt !== undefined)) updated.nextRunAt = this.nextRunAt(updated.frequencyDays,updated.runAt);
      if (!updated.autoEnabled) updated.nextRunAt = null;
      await this.db.query("INSERT INTO settings(key,value) VALUES('content',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()", [JSON.stringify(updated)]);
    }
    if (body.preferences) {
      const existing = (await this.db.query("SELECT value FROM settings WHERE key='preferences'")).rows[0]?.value || {};
      const updated = { ...existing, ...body.preferences };
      await this.db.query("INSERT INTO settings(key,value) VALUES('preferences',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()", [JSON.stringify(updated)]);
    }
    return this.getSettings();
  }

  nextRunAt(days,time,now=new Date()) {
    const [hour,minute] = time.split(':').map(Number);
    const date = addCalendarDays(beijingDate(now),Number(days));
    return new Date(`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`).toISOString();
  }

  async runDueSchedule() {
    if (this.scheduleBusy) return;
    this.scheduleBusy = true;
    try {
      const settings = await this.getSettings();
      const content = settings.content || {};
      if (!content.autoEnabled || !content.nextRunAt || new Date(content.nextRunAt) > new Date()) return;
      await this.updateSettings({ content: { autoEnabled: true, nextRunAt: this.nextRunAt(content.frequencyDays,content.runAt) } });
      const ideas = await this.suggestTopics();
      const idea = ideas.topics[0] || { title: '保险合同里的常见词，分别是什么意思？', category: '保险基础' };
      const topic = await this.createTopic({ title: idea.title, category: idea.category, insuranceType:idea.insuranceType, platforms: CHANNELS });
      await this.generateDrafts(topic.id);
    } catch (error) {
      console.error('自动内容任务失败:', error.message);
    } finally {
      this.scheduleBusy = false;
    }
  }

  async calendar(month) {
    const start = /^\d{4}-\d{2}$/.test(month || '') ? `${month}-01` : beijingMonthStart();
    const { rows } = await this.db.query('SELECT id,title,category,status,due_date,platforms,generation_status FROM topics WHERE due_date >= $1::date AND due_date < $1::date + INTERVAL \'1 month\' ORDER BY due_date,title', [start]);
    return rows.map((row) => ({ id: row.id,title: row.title,category: row.category,status: row.status,date: dateOnly(row.due_date),platforms: row.platforms,generationStatus: row.generation_status }));
  }

  async uploadAsset(topicId, platform, file) {
    if (!file) throw new BadRequestException('请选择一个文件');
    if (!String(file.mimetype).startsWith('image/')) throw new BadRequestException('目前只接受图片文件');
    if (platform && !CHANNELS.includes(platform)) throw new BadRequestException('发布平台无效');
    if (topicId) {
      const topic = await this.db.query('SELECT 1 FROM topics WHERE id=$1',[topicId]);
      if (!topic.rowCount) throw new NotFoundException('找不到对应选题');
    }
    const { rows } = await this.db.transaction(async (client) => {
      const inserted = await client.query('INSERT INTO assets(topic_id,platform,file_name,storage_name,mime_type,byte_size) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,file_name,mime_type,byte_size,created_at', [topicId || null,platform || null,file.originalname,file.filename,file.mimetype,file.size]);
      if (topicId && platform) {
        await client.query(`UPDATE drafts SET status='草稿',approval_checks='[false,false,false]'::jsonb,
          approved_at=NULL,updated_at=NOW() WHERE topic_id=$1 AND platform=$2`, [topicId,platform]);
      }
      return { rows:inserted.rows };
    });
    return { id:Number(rows[0].id),fileName:rows[0].file_name,mimeType:rows[0].mime_type,byteSize:Number(rows[0].byte_size),url:`/api/assets/${rows[0].id}` };
  }

  async asset(id) {
    const { rows } = await this.db.query('SELECT * FROM assets WHERE id=$1',[id]);
    if (!rows[0]) throw new NotFoundException('找不到这张图片');
    return { ...rows[0], path: path.resolve('backend/uploads',rows[0].storage_name) };
  }

  async deleteAsset(id) {
    const assetId = Number(id);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new BadRequestException('图片编号无效');
    const result = await this.db.transaction(async (client) => {
      const found = await client.query('SELECT id,topic_id,platform,storage_name FROM assets WHERE id=$1 FOR UPDATE',[assetId]);
      const asset = found.rows[0];
      if (!asset) throw new NotFoundException('找不到这张图片');
      const publication = await client.query('SELECT 1 FROM content_publication_assets WHERE asset_id=$1 LIMIT 1',[assetId]);
      const preservedForHistory = publication.rowCount > 0;
      if (preservedForHistory) await client.query('UPDATE assets SET topic_id=NULL,platform=NULL WHERE id=$1',[assetId]);
      else await client.query('DELETE FROM assets WHERE id=$1',[assetId]);
      if (asset.topic_id && asset.platform) {
        await client.query(`UPDATE drafts SET status='草稿',approval_checks='[false,false,false]'::jsonb,
          approved_at=NULL,updated_at=NOW() WHERE topic_id=$1 AND platform=$2`,[asset.topic_id,asset.platform]);
      }
      return {storageName:preservedForHistory ? null : asset.storage_name,preservedForHistory};
    });
    if (result.storageName) {
      try { await rm(path.resolve('backend/uploads',path.basename(result.storageName)),{force:true}); }
      catch (error) { console.warn(`[workbench] Could not remove asset file ${path.basename(result.storageName)}: ${error.message}`); }
    }
    return {id:assetId,preservedForHistory:result.preservedForHistory};
  }

  async generateImage(topicId, platform, requestedImageOptions) {
    if (!CHANNELS.includes(platform)) throw new BadRequestException('发布平台无效');
    const topic = await this.db.query('SELECT * FROM topics WHERE id=$1',[topicId]);
    if (!topic.rows[0]) throw new NotFoundException('找不到这个选题');
    const draft = await this.getDraft(topicId,platform);
    const skill = platform === '小红书' ? 'baoyu-xhs-images' : 'baoyu-article-illustrator';
    const contentSettings = (await this.getSettings()).content || {};
    const imageStyles = { ...DEFAULT_IMAGE_STYLES,...(contentSettings.imageStyles || {}) };
    const group = platform === '小红书' ? 'xhs' : 'article';
    const savedImageOptions = imageStyles[group] || DEFAULT_IMAGE_STYLES[group];
    if (requestedImageOptions !== undefined && (!requestedImageOptions || typeof requestedImageOptions !== 'object' || Array.isArray(requestedImageOptions))) {
      throw new BadRequestException('图文样式配置无效');
    }
    const imageOptions = { ...savedImageOptions,...(requestedImageOptions || {}) };
    const unexpectedOption = Object.keys(requestedImageOptions || {}).find((key) => !Object.hasOwn(IMAGE_STYLE_OPTIONS[group],key));
    if (unexpectedOption) throw new BadRequestException('图文样式配置包含不支持的选项');
    for (const [key,allowed] of Object.entries(IMAGE_STYLE_OPTIONS[group])) {
      if (!allowed.has(imageOptions[key])) throw new BadRequestException(`不支持的图文${key}设置`);
    }
    const skillPayload = {skill,platform,title:draft.title || topic.rows[0].title,imageOptions};
    if (platform === '小红书') {
      const cardPlan = normalizeXhsCardPlan(draft.cardPlan);
      if (!cardPlan) throw new BadRequestException('当前小红书稿件缺少有效图卡规划，请先生成图卡规划');
      const imageMode = contentSettings.xhsImageMode || DEFAULT_XHS_IMAGE_MODE;
      skillPayload.imageMode = imageMode;
      skillPayload.cardPlan = imageMode === 'test' ? cardPlan.slice(0,1) : cardPlan;
    } else {
      skillPayload.text = draft.body;
    }
    const payload = await this.runSkill(skillPayload,Number(process.env.SKILL_IMAGE_REQUEST_TIMEOUT_MS || 1_800_000));
    const artifacts = (payload.artifacts || []).filter((item) => typeof item.base64 === 'string' && item.base64 && ['image/png','image/jpeg','image/webp'].includes(item.mimeType));
    if (!artifacts.length) throw new ServiceUnavailableException('baoyu 技能没有返回可用的图片，请重试');
    if (artifacts.length > 10) throw new ServiceUnavailableException('baoyu 技能返回图片过多，请调整内容后重试');
    const storedFiles = [];
    let totalBytes = 0;
    try {
      for (const artifact of artifacts) {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(artifact.base64)) throw new ServiceUnavailableException('baoyu 技能返回了无效的图片数据');
        const data = Buffer.from(artifact.base64,'base64');
        if (data.length > MAX_IMAGE_BYTES) throw new ServiceUnavailableException(`生成图片为 ${(data.length / 1024 / 1024).toFixed(1)} MB，超过单张 ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB 限制`);
        if (data.length < 16) throw new ServiceUnavailableException('生成图片内容过短，无法读取');
        if (!isRasterImage(data,artifact.mimeType)) throw new ServiceUnavailableException('生成图片内容与图片格式不匹配');
        totalBytes += data.length;
        if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw new ServiceUnavailableException('生成图片总大小超出限制');
        const ext = artifact.mimeType === 'image/jpeg' ? '.jpg' : artifact.mimeType === 'image/webp' ? '.webp' : '.png';
        const originalName = path.basename(String(artifact.name || `generated${ext}`));
        const displayName = originalName.replace(/[^\p{L}\p{N}._-]/gu,'_').slice(0,120) || `generated${ext}`;
        const storageName = `${randomUUID()}${ext}`;
        const outPath = path.resolve('backend/uploads',storageName);
        await mkdir(path.dirname(outPath),{recursive:true});
        await writeFile(outPath,data,{flag:'wx'});
        storedFiles.push({displayName,storageName,mimeType:artifact.mimeType,byteSize:data.length});
      }
      const rows = await this.db.transaction(async (client) => {
        const inserted = [];
        for (const file of storedFiles) {
          const result = await client.query('INSERT INTO assets(topic_id,platform,file_name,storage_name,mime_type,byte_size) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,file_name,mime_type,byte_size', [topicId,platform,file.displayName,file.storageName,file.mimeType,file.byteSize]);
          inserted.push(result.rows[0]);
        }
        await client.query(`UPDATE drafts SET status='草稿',approval_checks='[false,false,false]'::jsonb,
          approved_at=NULL,updated_at=NOW() WHERE topic_id=$1 AND platform=$2`, [topicId,platform]);
        return inserted;
      });
      const assets = rows.map((row) => ({id:Number(row.id),fileName:row.file_name,mimeType:row.mime_type,byteSize:Number(row.byte_size),url:`/api/assets/${row.id}`}));
      return {...assets[0],assets,provider:'baoyu-skills+runware',skill};
    } catch (error) {
      await Promise.all(storedFiles.map((file) => rm(path.resolve('backend/uploads',file.storageName),{force:true})));
      throw error;
    }
  }
}
