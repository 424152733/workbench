import { ServiceUnavailableException } from '@nestjs/common';

export const deepseekTextModel = () => process.env.DEEPSEEK_TEXT_MODEL || 'deepseek-flash';

const baseUrl = () => {
  const value = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/,'');
  let parsed;
  try { parsed = new URL(value); } catch { throw new ServiceUnavailableException('DEEPSEEK_BASE_URL 格式无效'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ServiceUnavailableException('DEEPSEEK_BASE_URL 必须是有效的 HTTPS 地址');
  }
  return `${value}/chat/completions`;
};

const parseJsonContent = (value,diagnostics) => {
  const text = Array.isArray(value)
    ? value.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
    : String(value || '');
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,'')); }
  catch {
    const reason = text.trim() ? '返回内容未符合预期 JSON 格式' : '返回了空内容';
    throw new ServiceUnavailableException(`DeepSeek ${reason}（${diagnostics}）`);
  }
};

const diagnosticValue = (value,fallback='unknown') => {
  const normalized = String(value ?? '').replace(/[^\w.-]/g,'_').slice(0,80);
  return normalized || fallback;
};

const requestFailureMessage = (status) => {
  if (status === 401) return 'DeepSeek 鉴权失败（HTTP 401），请检查 DEEPSEEK_API_KEY 是否有效。';
  if (status === 402) return 'DeepSeek 账户余额不足（HTTP 402），请检查 API 账户余额。';
  if (status === 429) return 'DeepSeek 请求频率或并发数超限（HTTP 429），请稍后重试。';
  return `DeepSeek 请求失败（HTTP ${status}）`;
};

export async function callDeepSeekJson({
  instructions,input,timeoutMs=120_000,fetchImpl=globalThis.fetch,reasoningEffort='high',thinking='enabled',maxTokens=16_384,includeMetadata=false,
}={}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const endpoint = baseUrl();
  let response;
  try {
    response = await fetchImpl(endpoint,{
      method:'POST',
      headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:deepseekTextModel(),
        thinking:{type:thinking},
        ...(thinking==='enabled' ? {reasoning_effort:reasoningEffort} : {}),
        max_tokens:maxTokens,
        response_format:{type:'json_object'},
        messages:[
          {role:'system',content:String(instructions || '')},
          {role:'user',content:typeof input === 'string' ? input : JSON.stringify(input ?? '')},
        ],
      }),
      signal:AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError' || error?.cause?.code === 'ETIMEDOUT'
      ? '连接 DeepSeek 服务超时，请检查网络、DNS 或代理设置后重试。'
      : '无法连接 DeepSeek 服务（api.deepseek.com），请检查网络、DNS 或代理设置后重试。';
    throw new ServiceUnavailableException(message);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ServiceUnavailableException(requestFailureMessage(response.status));
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  const responseChars = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('').length
    : String(content || '').length;
  const usage = payload.usage || {};
  const diagnostics = [
    `model=${diagnosticValue(payload.model || deepseekTextModel())}`,
    `finish_reason=${diagnosticValue(choice?.finish_reason)}`,
    `prompt_tokens=${Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : 'unknown'}`,
    `completion_tokens=${Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : 'unknown'}`,
    `total_tokens=${Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : 'unknown'}`,
    `response_chars=${responseChars}`,
  ].join(', ');
  const metadata={
    model:String(payload.model || deepseekTextModel()),
    finishReason:String(choice?.finish_reason || ''),
    promptTokens:Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
    completionTokens:Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null,
    totalTokens:Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null,
    responseChars,
  };
  let data;
  try { data=parseJsonContent(content,diagnostics); }
  catch (error) {
    error.modelMetadata=metadata;
    throw error;
  }
  return includeMetadata ? {data,metadata} : data;
}
