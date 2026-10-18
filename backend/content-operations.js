import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { isRasterImage, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from './image-utils.js';
import { buildDraftGenerationPrompt, buildXhsCardPlanPrompt, normalizeEditableXhsCardPlan, normalizeXhsCardPlan } from './content-prompts.js';
import { cleanGeneratedCopy, cleanXhsCardPlan, demoDrafts, getResponseText, runwareTextModel } from './content-generation-helpers.js';
import { RichText } from '../src/richText.js';
import { CHANNELS, INSURANCE_TYPES, TOPIC_CATEGORIES, DEFAULT_WECHAT_THEME, WECHAT_THEMES, displayWhen, dateOnly, boolArray } from './workbench-primitives.js';

export class ContentOperations {
  async listTopics() {
    const { rows } = await this.db.query('SELECT * FROM topics ORDER BY COALESCE(due_date,created_at::date),created_at DESC');
    const topicIds = rows.map((row) => row.id);
    const drafts = topicIds.length ? await this.db.query('SELECT * FROM drafts WHERE topic_id=ANY($1::text[]) ORDER BY platform', [topicIds]) : { rows: [] };
    const assets = topicIds.length ? await this.db.query('SELECT id,topic_id,platform,file_name,mime_type,byte_size,created_at FROM assets WHERE topic_id=ANY($1::text[]) ORDER BY created_at,id', [topicIds]) : { rows: [] };
    const grouped = new Map();
    for (const draft of drafts.rows) grouped.set(`${draft.topic_id}:${draft.platform}`, draft);
    const assetMap = new Map();
    for (const item of assets.rows) {
      const key = `${item.topic_id}:${item.platform}`;
      assetMap.set(key,[...(assetMap.get(key) || []),{ id:Number(item.id),fileName:item.file_name,mimeType:item.mime_type,byteSize:Number(item.byte_size),url:`/api/assets/${item.id}` }]);
    }
    return rows.map((topic) => ({
      id: topic.id, title: topic.title, category: topic.category, insuranceType: topic.insurance_type || '未分类', status: topic.status,
      due: displayWhen(topic.due_date), dueDate: dateOnly(topic.due_date),
      platforms: topic.platforms, generationStatus: topic.generation_status, generationError: topic.generation_error,
      createdAt: topic.created_at,
      drafts: Object.fromEntries(CHANNELS.map((platform) => {
        const draft = grouped.get(`${topic.id}:${platform}`);
        return [platform, draft ? this.publicDraft(draft,assetMap.get(`${topic.id}:${platform}`) || []) : null];
      })),
    }));
  }

  publicDraft(row,assets = []) {
    return {
      id: Number(row.id), title: row.title, extra: row.platform === '公众号' ? row.summary : row.hashtags,
      summary: row.summary, hashtags: row.hashtags, body: row.body, sources: row.sources,
      cardPlan: Array.isArray(row.xhs_card_plan) ? row.xhs_card_plan : [],
      status: row.status, humanized: row.humanized, checks: boolArray(row.approval_checks),
      provider: row.provider, approvedAt: row.approved_at, publishedAt: row.published_at,
      publishUrl: row.publish_url, htmlContent: row.html_content, assets,
    };
  }

  async createTopic(body) {
    const title = String(body.title || '').trim();
    if (!title) throw new BadRequestException('请填写选题');
    const platforms = Array.isArray(body.platforms) ? body.platforms.filter((item) => CHANNELS.includes(item)) : CHANNELS;
    if (!platforms.length) throw new BadRequestException('至少选择一个发布平台');
    const id = `T-${randomUUID().slice(0, 5).toUpperCase()}`;
    const insuranceType = body.insuranceType || '未分类';
    if (insuranceType !== '未分类' && !INSURANCE_TYPES.includes(insuranceType)) throw new BadRequestException('选题险种分类无效');
    await this.db.query('INSERT INTO topics(id,title,category,insurance_type,status,due_date,platforms) VALUES($1,$2,$3,$4,$5,$6,$7)', [id,title,body.category || '保险基础',insuranceType,'选题中',body.dueDate || null,JSON.stringify(platforms)]);
    return (await this.listTopics()).find((topic) => topic.id === id);
  }

  async deleteTopic(id) {
    const storageNames = await this.db.transaction(async (client) => {
      const topic = await client.query('SELECT id FROM topics WHERE id=$1 FOR UPDATE',[id]);
      if (!topic.rows[0]) throw new NotFoundException('找不到这个选题');
      const publication = await client.query(`SELECT p.id FROM content_publications p JOIN drafts d ON d.id=p.draft_id
        WHERE d.topic_id=$1 LIMIT 1`,[id]);
      if (publication.rowCount) throw new ConflictException('这个选题已有发布记录，请保留历史，不能删除');
      const assets = await client.query('SELECT storage_name FROM assets WHERE topic_id=$1',[id]);
      await client.query('DELETE FROM topics WHERE id=$1',[id]);
      return assets.rows.map(({storage_name}) => storage_name);
    });
    const cleanup = await Promise.allSettled(storageNames.map((storageName) => rm(path.resolve('backend/uploads',path.basename(storageName)),{force:true})));
    cleanup.forEach((result,index) => {
      if (result.status === 'rejected') console.warn(`[workbench] Could not remove asset file for deleted topic ${id}: ${path.basename(storageNames[index])}`);
    });
    return {id};
  }

  async updateTopic(id, body) {
    const currentResult = await this.db.query('SELECT * FROM topics WHERE id=$1', [id]);
    if (!currentResult.rows[0]) throw new NotFoundException('找不到这个选题');
    const current = currentResult.rows[0];
    const allowedStatus = ['选题中','草稿','待审核','已排期','已暂停','已跳过'];
    const status = body.status ?? current.status;
    if (!allowedStatus.includes(status)) throw new BadRequestException('选题状态无效');
    const insuranceType = body.insuranceType ?? current.insurance_type ?? '未分类';
    if (insuranceType !== '未分类' && !INSURANCE_TYPES.includes(insuranceType)) throw new BadRequestException('选题险种分类无效');
    const { rows } = await this.db.query('UPDATE topics SET title=$2,category=$3,insurance_type=$4,status=$5,due_date=$6,updated_at=NOW() WHERE id=$1 RETURNING *', [id,body.title ?? current.title,body.category ?? current.category,insuranceType,status,body.dueDate === undefined ? current.due_date : body.dueDate || null]);
    return (await this.listTopics()).find((topic) => topic.id === rows[0].id);
  }

  async callModel(instructions, input) {
    if (!process.env.RUNWARE_API_KEY) return null;
    let response;
    try {
      response = await fetch('https://api.runware.ai/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RUNWARE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: runwareTextModel(),
          instructions,
          input: typeof input === 'string' ? `${input}\n\nPlease return valid json.` : input,
          text: { format: { type: 'json_object' } },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.cause?.code === 'ETIMEDOUT'
        ? '连接 Runware GPT 服务超时。请检查网络、DNS 或代理设置后重试。'
        : '无法连接 Runware GPT 服务（api.runware.ai）。请检查网络、DNS 或代理设置后重试。';
      throw new ServiceUnavailableException(message);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ServiceUnavailableException(payload.error?.message || `GPT 请求失败（HTTP ${response.status}）`);
    const raw = getResponseText(payload).trim();
    try { return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch { throw new ServiceUnavailableException('GPT 返回内容未符合预期 JSON 格式，请重试'); }
  }

  async runSkill(payload, timeoutMs = 180_000) {
    const baseUrl = (process.env.SKILL_RUNNER_URL || 'http://127.0.0.1:3020').replace(/\/+$/,'');
    const headers = { 'Content-Type':'application/json' };
    if (process.env.SKILL_RUNNER_TOKEN) headers.Authorization = `Bearer ${process.env.SKILL_RUNNER_TOKEN}`;
    let response;
    try {
      response = await fetch(`${baseUrl}/run`,{
        method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const detail = error?.name === 'TimeoutError' ? '技能运行超时' : '无法连接技能运行器';
      throw new ServiceUnavailableException(`${detail}。请确认本地技能运行器已启动，并检查 .env 配置。`);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status >= 500 ? response.status : 502;
      throw new HttpException(result.message || `技能运行失败（HTTP ${response.status}）`,status);
    }
    return result;
  }

  async generateDrafts(topicId) {
    const found = await this.db.query('SELECT * FROM topics WHERE id=$1', [topicId]);
    if (!found.rows[0]) throw new NotFoundException('找不到这个选题');
    const topic = found.rows[0];
    const platforms = (Array.isArray(topic.platforms) ? topic.platforms : CHANNELS).filter((platform) => CHANNELS.includes(platform));
    if (!platforms.length) throw new BadRequestException('这个选题没有有效的发布平台');
    await this.db.query("UPDATE topics SET generation_status='running',generation_error=NULL,updated_at=NOW() WHERE id=$1", [topicId]);
    try {
      const contentSettings = (await this.getSettings()).content || {};
      const prompt = buildDraftGenerationPrompt({title:topic.title,category:topic.category,platforms,voice:contentSettings.voice || ''});
      const generated = await this.callModel(prompt.instructions,prompt.input);
      const rawDrafts = generated ? generated.drafts : null;
      if (generated && (!Array.isArray(rawDrafts) || rawDrafts.length !== platforms.length)) {
        throw new ServiceUnavailableException('GPT 没有按选题启用的平台完整返回稿件，请重试');
      }
      const allowed = new Map();
      if (generated) {
        for (const draft of rawDrafts) {
          if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !platforms.includes(draft.platform) || allowed.has(draft.platform) ||
              typeof draft.title !== 'string' || !draft.title.trim() || typeof draft.body !== 'string' || !draft.body.trim()) {
            throw new ServiceUnavailableException('GPT 返回的平台稿件不完整或平台重复，请重试');
          }
          if (['summary','hashtags','sources'].some((field) => draft[field] !== undefined && typeof draft[field] !== 'string')) {
            throw new ServiceUnavailableException('GPT 返回了格式错误的可选稿件字段，请重试');
          }
          const cardPlan = draft.platform === '小红书' ? normalizeXhsCardPlan(draft.cardPlan) : [];
          if (draft.platform === '小红书' && !cardPlan) throw new ServiceUnavailableException('GPT 没有按要求返回 3–5 张小红书图卡规划，请重新生成');
          allowed.set(draft.platform,{
            ...draft,
            title:cleanGeneratedCopy(draft.title),
            summary:cleanGeneratedCopy(draft.summary),
            body:cleanGeneratedCopy(draft.body),
            hashtags:cleanGeneratedCopy(draft.hashtags),
            sources:cleanGeneratedCopy(draft.sources),
            cardPlan:draft.platform === '小红书' ? cleanXhsCardPlan(cardPlan) : [],
          });
        }
        if (platforms.some((platform) => !allowed.has(platform))) throw new ServiceUnavailableException('GPT 漏掉了选题启用的平台，请重试');
      }
      const fallback = demoDrafts(topic.title);
      const provider = generated ? runwareTextModel() : 'demo';
      const generatedForPlatforms = platforms.map((platform) => {
        const output = allowed.get(platform) || fallback[platform];
        return { platform,title:output.title || topic.title,text:output.body || '',...(platform === '小红书' ? {cardPlan:output.cardPlan} : {}) };
      });
      const humanized = await this.runSkill({ skill:'humanizer-zh',drafts:generatedForPlatforms },600_000);
      const humanizedByPlatform = new Map((humanized.drafts || []).map((draft) => [draft.platform,draft]));
      if (platforms.some((platform) => !humanizedByPlatform.get(platform)?.text?.trim())) {
        throw new ServiceUnavailableException('humanizer-zh 未返回全部平台的润色稿件，请重试');
      }
      await this.db.transaction(async (client) => {
        for (const platform of platforms) {
          const output = allowed.get(platform) || fallback[platform];
          const before = await client.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2 FOR UPDATE', [topicId,platform]);
          if (before.rows[0]) await this.snapshotVersion(client, before.rows[0], 'before-regenerate');
          const humanizedOutput = humanizedByPlatform.get(platform);
          const body = cleanGeneratedCopy(humanizedOutput.text);
          let cardPlan = output.cardPlan || [];
          if (platform === '小红书') {
            const polishedPlan = normalizeXhsCardPlan(humanizedOutput.cardPlan);
            if (!polishedPlan || polishedPlan.length !== cardPlan.length || polishedPlan.some((card,index) => card.role !== cardPlan[index].role || card.keyPoints.length !== cardPlan[index].keyPoints.length)) {
              throw new ServiceUnavailableException('humanizer-zh 未按原结构返回小红书图卡规划，请重试');
            }
            cardPlan = cleanXhsCardPlan(polishedPlan.map((card,index) => ({...card,role:cardPlan[index].role})));
          }
          const htmlContent = platform === '公众号' ? this.renderWechatHtml(output.title || topic.title,output.summary || '',body,contentSettings.wechatTheme) : '';
          await client.query(`INSERT INTO drafts(topic_id,platform,title,summary,body,hashtags,sources,xhs_card_plan,status,humanized,provider,approval_checks,html_content)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'待审核',TRUE,$9,'[false,false,false]'::jsonb,$10)
            ON CONFLICT(topic_id,platform) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,body=EXCLUDED.body,
              hashtags=EXCLUDED.hashtags,sources=EXCLUDED.sources,xhs_card_plan=EXCLUDED.xhs_card_plan,status='待审核',humanized=TRUE,provider=EXCLUDED.provider,
              approval_checks='[false,false,false]'::jsonb,html_content=EXCLUDED.html_content,approved_at=NULL,updated_at=NOW()`,
          [topicId,platform,output.title || topic.title,output.summary || '',body,output.hashtags || '',output.sources || '',JSON.stringify(cardPlan),provider,htmlContent]);
        }
        await client.query("UPDATE topics SET status='待审核',generation_status='succeeded',generation_error=NULL,updated_at=NOW() WHERE id=$1", [topicId]);
      });
      return { topic: (await this.listTopics()).find((item) => item.id === topicId), provider, humanizer:'humanizer-zh', mode: provider === 'demo' ? 'demo' : 'gpt' };
    } catch (error) {
      await this.db.query("UPDATE topics SET generation_status='failed',generation_error=$2,updated_at=NOW() WHERE id=$1", [topicId,error.message || '生成失败']);
      throw error;
    }
  }

  async snapshotVersion(client, draft, changedBy) {
    const result = await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM draft_versions WHERE draft_id=$1', [draft.id]);
    const { id, topic_id, platform, title, summary, body, hashtags, sources, xhs_card_plan, status, humanized, approval_checks, provider } = draft;
    await client.query('INSERT INTO draft_versions(draft_id,version,snapshot,changed_by) VALUES($1,$2,$3,$4)', [id,result.rows[0].version,JSON.stringify({ topic_id,platform,title,summary,body,hashtags,sources,cardPlan:xhs_card_plan || [],status,humanized,approval_checks,provider }),changedBy]);
  }

  async humanizeDraft(topicId, platform) {
    const found = await this.db.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2', [topicId,platform]);
    if (!found.rows[0]) throw new NotFoundException('请先生成这个平台的草稿');
    const draft = found.rows[0];
    const sourceCardPlan = platform === '小红书' ? normalizeXhsCardPlan(draft.xhs_card_plan,{allowEmpty:true}) : [];
    const result = await this.runSkill({skill:'humanizer-zh',platform,title:draft.title,text:draft.body,...(sourceCardPlan?.length ? {cardPlan:sourceCardPlan} : {})},180_000);
    const resultText = cleanGeneratedCopy(result.text || result.output?.text || '');
    const provider = 'humanizer-zh';
    if (!resultText?.trim()) throw new ServiceUnavailableException('没有得到可用的润色正文');
    let nextCardPlan = draft.xhs_card_plan || [];
    if (platform === '小红书' && sourceCardPlan?.length) {
      const polished = normalizeXhsCardPlan(result.cardPlan);
      if (!polished || polished.length !== sourceCardPlan.length || polished.some((card,index) => card.keyPoints.length !== sourceCardPlan[index].keyPoints.length)) {
        throw new ServiceUnavailableException('humanizer-zh 未按原结构返回小红书图卡规划，请重试');
      }
      nextCardPlan = cleanXhsCardPlan(polished.map((card,index) => ({...card,role:sourceCardPlan[index].role})));
    }
    const htmlTheme = (await this.getSettings()).content?.wechatTheme || DEFAULT_WECHAT_THEME;
    const htmlContent = platform === '公众号' ? this.renderWechatHtml(draft.title,draft.summary,resultText,htmlTheme) : draft.html_content;
    await this.snapshotVersionWithPool(draft, 'before-humanize');
    await this.db.query(`UPDATE drafts SET body=$3,xhs_card_plan=$4::jsonb,humanized=true,status='草稿',provider=$5,html_content=$6,approval_checks='[false,false,false]'::jsonb,approved_at=NULL,updated_at=NOW() WHERE topic_id=$1 AND platform=$2`, [topicId,platform,resultText,JSON.stringify(nextCardPlan),provider,htmlContent]);
    return this.getDraft(topicId,platform);
  }

  async generateXhsCardPlan(topicId, platform) {
    if (platform !== '小红书') throw new BadRequestException('只有小红书稿件需要图卡规划');
    const [topicResult,draftResult] = await Promise.all([
      this.db.query('SELECT * FROM topics WHERE id=$1',[topicId]),
      this.db.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2',[topicId,platform]),
    ]);
    if (!topicResult.rows[0]) throw new NotFoundException('找不到这个选题');
    if (!draftResult.rows[0]) throw new NotFoundException('请先生成这个平台的草稿');
    const draft = draftResult.rows[0];
    const prompt = buildXhsCardPlanPrompt({title:draft.title || topicResult.rows[0].title,body:draft.body,sources:draft.sources});
    const generated = await this.callModel(prompt.instructions,prompt.input);
    const planned = generated ? normalizeXhsCardPlan(generated.cardPlan) : demoXhsCardPlan(draft.title || topicResult.rows[0].title,draft.body);
    if (!planned) throw new ServiceUnavailableException('GPT 没有返回有效的 3–5 张图卡规划，请重试');
    const cardPlan = cleanXhsCardPlan(planned);
    if (Array.isArray(draft.xhs_card_plan) && draft.xhs_card_plan.length) await this.snapshotVersionWithPool(draft,'before-card-plan');
    await this.db.query(`UPDATE drafts SET xhs_card_plan=$3::jsonb,status='草稿',approval_checks='[false,false,false]'::jsonb,
      approved_at=NULL,updated_at=NOW() WHERE topic_id=$1 AND platform=$2`,[topicId,platform,JSON.stringify(cardPlan)]);
    return this.getDraft(topicId,platform);
  }

  async snapshotVersionWithPool(draft, changedBy) {
    await this.db.transaction((client) => this.snapshotVersion(client,draft,changedBy));
  }

  async getDraft(topicId, platform) {
    const { rows } = await this.db.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2', [topicId,platform]);
    if (!rows[0]) throw new NotFoundException('找不到这个平台的稿件');
    const assets = await this.db.query('SELECT id,file_name,mime_type,byte_size FROM assets WHERE topic_id=$1 AND platform=$2 ORDER BY created_at,id',[topicId,platform]);
    return this.publicDraft(rows[0],assets.rows.map((item) => ({ id:Number(item.id),fileName:item.file_name,mimeType:item.mime_type,byteSize:Number(item.byte_size),url:`/api/assets/${item.id}` })));
  }

  async saveDraft(topicId, platform, body) {
    const found = await this.db.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2', [topicId,platform]);
    if (!found.rows[0]) throw new NotFoundException('请先生成这个平台的草稿');
    const draft = found.rows[0];
    const fields = ['title','summary','body','hashtags','sources'];
    const currentCardPlan = Array.isArray(draft.xhs_card_plan) ? draft.xhs_card_plan : [];
    const requestedCardPlan = platform === '小红书' && body.cardPlan !== undefined
      ? normalizeEditableXhsCardPlan(body.cardPlan)
      : currentCardPlan;
    if (!requestedCardPlan) throw new BadRequestException('小红书图卡规划最多保存 5 张卡片，且卡片结构需有效');
    const cardPlanChanged = platform === '小红书' && JSON.stringify(requestedCardPlan) !== JSON.stringify(currentCardPlan);
    const changed = fields.some((key) => body[key] !== undefined && body[key] !== draft[key]) || cardPlanChanged;
    if (changed) await this.snapshotVersionWithPool(draft,'before-edit');
    const next = Object.fromEntries(fields.map((key) => [key, body[key] ?? draft[key]]));
    const nextCardPlan = platform === '小红书' ? cleanXhsCardPlan(requestedCardPlan) : currentCardPlan;
    const checks = changed ? [false,false,false] : boolArray(body.checks ?? draft.approval_checks);
    const status = changed ? '草稿' : draft.status;
    const htmlTheme = (await this.getSettings()).content?.wechatTheme || DEFAULT_WECHAT_THEME;
    const html = platform === '公众号' ? this.renderWechatHtml(next.title,next.summary,next.body,htmlTheme) : draft.html_content;
    const result = await this.db.query(`UPDATE drafts SET title=$3,summary=$4,body=$5,hashtags=$6,sources=$7,xhs_card_plan=$8::jsonb,
      approval_checks=$9,status=$10,approved_at=CASE WHEN $10='草稿' THEN NULL ELSE approved_at END,
      html_content=$11,updated_at=NOW() WHERE topic_id=$1 AND platform=$2 RETURNING *`,
    [topicId,platform,next.title,next.summary,next.body,next.hashtags,next.sources,JSON.stringify(nextCardPlan),JSON.stringify(checks),status,html]);
    return this.getDraft(topicId,platform);
  }

  renderWechatHtml(title, summary, body, theme = DEFAULT_WECHAT_THEME) {
    const escape = (text) => String(text || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const themes = {
      clean:{ title:'#1d3931',text:'#37433f',muted:'#738078',accent:'#287c67',summary:'margin:0 0 22px;color:#738078;',paragraph:'line-height:1.85;margin:0 0 18px;color:#37433f;',note:'#87938d' },
      warm:{ title:'#5b4635',text:'#51463c',muted:'#8c7965',accent:'#bf8156',summary:'margin:20px 0;padding:14px 16px;border-left:3px solid #bf8156;background:#faf4ec;color:#6c5946;line-height:1.8;',paragraph:'line-height:1.9;margin:0 0 18px;color:#51463c;',note:'#8c7965' },
      editorial:{ title:'#263b55',text:'#334155',muted:'#718096',accent:'#557da8',summary:'margin:14px 0 22px;padding:0 0 14px;border-bottom:1px solid #d8e1ea;color:#718096;line-height:1.8;',paragraph:'line-height:1.9;margin:0 0 20px;color:#334155;',note:'#718096' },
    };
    const selected = themes[theme] || themes[DEFAULT_WECHAT_THEME];
    const summaryHtml = summary ? `<p style="${selected.summary}">${escape(summary)}</p>` : '';
    const bodyHtml = renderToStaticMarkup(createElement(RichText,{value:body,className:'wechat-export-body'}))
      .replace('<div class="rich-text wechat-export-body">',`<div style="font-size:16px;line-height:1.85;color:${selected.text};">`)
      .replace(/<p([^>]*)>/g,`<p$1 style="${selected.paragraph}">`)
      .replace(/<h([1-4])([^>]*)>/g,(_match,level,attributes) => `<h${level}${attributes} style="font-size:${level === '1' ? 22 : level === '2' ? 20 : 17}px;line-height:1.55;color:${selected.title};margin:26px 0 12px;font-weight:700;">`)
      .replace(/<(ul|ol)([^>]*)>/g,'<$1$2 style="padding-left:1.6em;margin:0 0 18px;line-height:1.85;">')
      .replace(/<li([^>]*)>/g,'<li$1 style="padding-left:3px;margin:5px 0;">')
      .replace(/<blockquote([^>]*)>/g,'<blockquote$1 style="padding:4px 0 4px 15px;margin:16px 0;border-left:3px solid #80a68d;color:#69756e;">')
      .replace(/<strong([^>]*)>/g,`<strong$1 style="font-weight:700;color:${selected.title};">`)
      .replace(/<a([^>]*)>/g,`<a$1 style="color:${selected.accent};text-decoration:none;">`)
      .replace(/<code([^>]*)>/g,'<code$1 style="padding:2px 5px;border-radius:4px;color:#a04d42;background:#f7f1ee;font-family:monospace;font-size:.9em;">')
      .replace(/<pre([^>]*)>/g,'<pre$1 style="overflow:auto;padding:14px 16px;border-radius:9px;color:#e8efeb;background:#26342d;font-size:13px;line-height:1.7;">')
      .replace(/<table([^>]*)>/g,'<table$1 style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.65;">')
      .replace(/<td([^>]*)>/g,'<td$1 style="padding:9px 11px;border:1px solid #e3e9e4;text-align:left;vertical-align:top;">')
      .replace(/<th([^>]*)>/g,'<th$1 style="padding:9px 11px;border:1px solid #e3e9e4;text-align:left;vertical-align:top;background:#f3f7f3;font-weight:650;">')
      .replace(/<hr([^>]*)>/g,'<hr$1 style="height:1px;margin:22px 0;border:0;background:#e9eeea;">')
      .replace(/<span class="rich-text-image-placeholder">/g,'<span style="padding:2px 8px;border:1px dashed #ccd6ce;border-radius:5px;color:#85938a;background:#f7f9f7;font-size:12px;">')
      .replace('<div class="rich-text-table-wrap">','<div style="overflow-x:auto;margin:16px 0 20px;">');
    return `<article data-theme="${WECHAT_THEMES.has(theme) ? theme : DEFAULT_WECHAT_THEME}"><h1 style="font-size:24px;line-height:1.5;color:${selected.title};border-bottom:2px solid ${selected.accent};padding-bottom:12px;">${escape(title)}</h1>${summaryHtml}${bodyHtml}<p style="font-size:13px;color:${selected.note};border-top:1px solid #e8ece8;padding-top:12px;margin-top:28px;">本文仅作一般保险知识说明，具体保障以保险合同和保险公司正式文件为准。</p></article>`;
  }

  async approveDraft(topicId, platform, body) {
    const draft = await this.db.query('SELECT * FROM drafts WHERE topic_id=$1 AND platform=$2', [topicId,platform]);
    if (!draft.rows[0]) throw new NotFoundException('请先生成这个平台的草稿');
    const checks = boolArray(body.checks ?? draft.rows[0].approval_checks);
    if (!checks.every(Boolean)) throw new BadRequestException('事实来源、表达边界和图片素材三项都核对后才能审核通过');
    const result = await this.db.query(`UPDATE drafts SET approval_checks=$3,status='已审核',approved_at=NOW(),updated_at=NOW()
      WHERE topic_id=$1 AND platform=$2 RETURNING *`, [topicId,platform,JSON.stringify(checks)]);
    return this.getDraft(topicId,platform);
  }

  async publishDraft(topicId, platform, body) {
    return this.createPublication(topicId,platform,body);
  }

  async suggestTopics(insuranceType = '不限',exclude = '') {
    if (insuranceType !== '不限' && !INSURANCE_TYPES.includes(insuranceType)) throw new BadRequestException('不支持的险种分类');
    let excludeTitles = [];
    try { excludeTitles = Array.isArray(exclude) ? exclude : JSON.parse(exclude || '[]'); } catch { throw new BadRequestException('换一批参数无效'); }
    if (!Array.isArray(excludeTitles) || excludeTitles.some((title) => typeof title !== 'string')) throw new BadRequestException('换一批参数无效');
    excludeTitles = excludeTitles.map((title) => title.trim()).filter(Boolean).slice(0,10);
    const popular = await this.db.query('SELECT concern,COUNT(*)::int AS count FROM customers WHERE concern <> \'待了解\' GROUP BY concern ORDER BY count DESC LIMIT 5');
    if (process.env.RUNWARE_API_KEY) {
      const selectedType = insuranceType === '不限' ? '不限（请覆盖多个险种，并逐条标注所属险种）' : insuranceType;
      const excluded = excludeTitles.length ? `\n本轮换批需要避开这些已给出的标题和相同切入角度：${excludeTitles.join('；')}` : '';
      const result = await this.callModel('你是“大话保险”科普选题编辑。给普通消费者提供大白话保险科普主题，不制造恐慌、不做产品推销、不预设理赔结论。只围绕用户选择的险种生成主题。返回 JSON {"topics":[{"title":"","category":"保险基础|误区澄清|条款翻译|办事指南","insuranceType":"寿险|健康险|财险|意外险|年金/养老险|综合保险"}]}，给出 5 条，每条主题和切入角度都要有差异。', `选定险种：${selectedType}\n客户常见问题（仅作匿名汇总）：${popular.rows.map((r) => `${r.concern}(${r.count})`).join('、') || '保险常见误区'}${excluded}\n请严格返回合法 json。`);
      const topics = (Array.isArray(result?.topics) ? result.topics : []).filter((item) => item && typeof item.title === 'string' && item.title.trim()).slice(0,5).map((item) => ({
        title:item.title.trim(),
        category:TOPIC_CATEGORIES.includes(item.category) ? item.category : '保险基础',
        insuranceType:insuranceType === '不限' ? (INSURANCE_TYPES.includes(item.insuranceType) ? item.insuranceType : '综合保险') : insuranceType,
      })).filter((item) => !excludeTitles.includes(item.title));
      return { provider: runwareTextModel(), insuranceType, topics };
    }
    const samples = {
      '寿险':['定期寿险和终身寿险有什么不同？','家庭经济支柱买寿险，保额怎么考虑？','寿险的受益人可以指定谁？','投保寿险时，健康告知要注意什么？','寿险合同里的等待期和免责条款怎么看？','给孩子买寿险，哪些规则需要先了解？','寿险保额和家庭责任怎么一起看？','寿险保费交多久，合同里怎么看？','房贷家庭配置寿险时，哪些责任要考虑？','寿险保单变更受益人需要什么手续？','定期寿险到期后，保障会怎么变化？','多人共同承担家庭责任，寿险怎么梳理？'],
      '健康险':['百万医疗险的免赔额是什么意思？','医疗险续保时要重点看哪些约定？','买健康险前，健康告知怎么填写？','重疾险和医疗险保障方式有什么区别？','住院后申请医疗险理赔要准备什么？','既往症在健康险合同中如何理解？','医疗险的保障范围要从哪里核对？','医疗险的等待期和观察期是一回事吗？','住院前后门急诊费用如何核对约定？','特定药品保障需要满足哪些条件？','重疾险的疾病定义应该怎么查？','健康险产品停售后，原合同如何处理？'],
      '财险':['车险续保前，哪些信息值得重新核对？','家财险通常保障哪些家庭财产？','车险里的第三者责任险怎么理解？','发生财产损失后，报案和留证要注意什么？','家财险的免责条款应该怎么找？','车险出险后，理赔材料如何准备？','家庭财产保险的保障范围以什么为准？','车辆借给别人开，发生事故后先确认什么？','家财险对房屋和室内财物分别怎么约定？','车损险理赔时，定损流程有哪些环节？','店铺投保财产险前要整理哪些信息？','台风暴雨造成损失，保险责任如何核对？'],
      '意外险':['意外险中的“意外”在合同里怎么定义？','意外险的职业类别为什么需要核对？','意外受伤后，申请保险待遇要准备什么？','意外险和医疗险的保障范围有什么不同？','买意外险前，哪些免责约定要看清？','意外险的身故和伤残责任怎么区分？','出行前检查意外险，先核对哪几项？','意外医疗报销的免赔额和比例怎么看？','高风险运动是否在意外险保障范围内？','意外险的保障期限和生效时间如何确认？','工作中受伤，商业意外险要看哪些条款？','意外事故后，现场材料和就诊记录怎么留？'],
      '年金/养老险':['年金险的领取时间和方式怎么看？','养老年金开始领取后，合同约定如何查？','年金险的现金价值是什么意思？','买养老保险前，先厘清哪些长期安排？','年金险的保证领取约定怎么理解？','年金保险和储蓄有什么不同？','年金险的投保人和领取人可以是谁？','年金险的缴费期限和领取期限如何区分？','养老年金的领取金额以哪里写的为准？','领取前退保，可能涉及哪些合同约定？','年金险的身故责任需要怎么核对？','给父母做养老安排，先看哪些时间节点？'],
      '综合保险':['投保人、被保险人和受益人分别是谁？','保险等待期到底从哪一天开始算？','免责条款要怎么读才不漏重点？','保险合同里的“保障范围”怎么找？','保费、保额和保险金有什么区别？','不同类型保险的理赔材料一样吗？','看保险产品介绍时，哪些信息要回到合同核对？','保险合同中的犹豫期和宽限期有什么区别？','电子保单和纸质保单的效力有区别吗？','保险费没按时交，合同状态如何确认？','保单信息有变化时，可以办理哪些变更？','向保险公司咨询时，怎样描述自己的问题？'],
    };
    const types = insuranceType === '不限' ? INSURANCE_TYPES : [insuranceType];
    const candidatesByType = types.map((type) => (samples[type] || []).map((title) => ({title,insuranceType:type})));
    const candidates = insuranceType === '不限'
      ? Array.from({length:Math.max(...candidatesByType.map((items) => items.length))},(_,index) => candidatesByType.flatMap((items) => items[index] ? [items[index]] : [])).flat()
      : candidatesByType.flat();
    const usedTitles = new Set(excludeTitles);
    const base = popular.rows.map((row) => row.concern).filter(Boolean).map((concern) => ({title:`${concern}，先看哪几项？`,insuranceType:insuranceType === '不限' ? '综合保险' : insuranceType}));
    const candidatesWithBase = [...candidates,...base].filter((item) => !usedTitles.has(item.title));
    const topics = candidatesWithBase.slice(0,5).map(({title,insuranceType:type},index) => ({title,insuranceType:type,category:['误区澄清','条款翻译','保险基础','办事指南','误区澄清'][index]}));
    return { provider: 'demo', insuranceType, topics };
  }
}
