import assert from 'node:assert/strict';
import test from 'node:test';
import { callDeepSeekJson, deepseekTextModel } from '../deepseek-client.js';

const withEnvironment = async (updates,callback) => {
  const previous = Object.fromEntries(Object.keys(updates).map((key) => [key,process.env[key]]));
  for (const [key,value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await callback(); }
  finally {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('DeepSeek client sends OpenAI-compatible V4.1 Flash JSON requests',async () => {
  await withEnvironment({
    DEEPSEEK_API_KEY:'deepseek-test-key',
    DEEPSEEK_BASE_URL:'https://api.deepseek.com/',
    DEEPSEEK_TEXT_MODEL:undefined,
  },async () => {
    let requestUrl;
    let requestOptions;
    const output = await callDeepSeekJson({
      instructions:'Return JSON.',
      input:{question:'test'},
      timeoutMs:5_000,
      fetchImpl:async (url,options) => {
        requestUrl = String(url);
        requestOptions = options;
        return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"ok":true}\n```'}}]}),{status:200});
      },
    });
    assert.equal(requestUrl,'https://api.deepseek.com/chat/completions');
    assert.equal(requestOptions.headers.Authorization,'Bearer deepseek-test-key');
    const request = JSON.parse(requestOptions.body);
    assert.equal(request.model,'deepseek-flash');
    assert.deepEqual(request.thinking,{type:'enabled'});
    assert.equal(request.reasoning_effort,'high');
    assert.equal(request.max_tokens,16_384);
    assert.deepEqual(request.response_format,{type:'json_object'});
    assert.deepEqual(request.messages,[
      {role:'system',content:'Return JSON.'},
      {role:'user',content:'{"question":"test"}'},
    ]);
    assert.deepEqual(output,{ok:true});
    assert.equal(deepseekTextModel(),'deepseek-flash');
  });
});

test('DeepSeek client skips network calls when the API key is not configured',async () => {
  await withEnvironment({DEEPSEEK_API_KEY:undefined},async () => {
    let fetched = false;
    assert.equal(await callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => { fetched = true; }}),null);
    assert.equal(fetched,false);
  });
});

test('DeepSeek client rejects invalid endpoints and gives safe guidance for auth and balance errors',async () => {
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key',DEEPSEEK_BASE_URL:'http://example.com/v1'},async () => {
    await assert.rejects(callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => { throw new Error('must not fetch'); }}),/HTTPS/);
  });
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com'},async () => {
    await assert.rejects(
      callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => new Response(JSON.stringify({base_resp:{status_code:1004,status_msg:'Token mismatch; do not expose raw provider details'}}),{status:401})}),
      (error) => {
        assert.match(error.message,/DeepSeek 鉴权失败（HTTP 401）/);
        assert.match(error.message,/DEEPSEEK_API_KEY/);
        assert.doesNotMatch(error.message,/Token mismatch|do not expose/);
        return true;
      },
    );
  });
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key',DEEPSEEK_BASE_URL:'https://api.deepseek.com'},async () => {
    await assert.rejects(
      callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => new Response('sensitive upstream body',{status:401})}),
      (error) => {
        assert.match(error.message,/DeepSeek 鉴权失败（HTTP 401）/);
        assert.doesNotMatch(error.message,/sensitive upstream body/);
        return true;
      },
    );
  });
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key'},async () => {
    await assert.rejects(callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => new Response('{}',{status:402})}),/余额不足（HTTP 402）/);
    await assert.rejects(callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => new Response('{}',{status:429})}),/频率或并发数超限（HTTP 429）/);
  });
});

test('DeepSeek client reports safe completion diagnostics for invalid or empty JSON',async () => {
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key'},async () => {
    const invalidResponse = new Response(JSON.stringify({
      model:'deepseek-flash',
      choices:[{message:{content:'not-json-private-content'},finish_reason:'length'}],
      usage:{prompt_tokens:63_000,completion_tokens:16_384,total_tokens:79_384},
    }),{status:200});
    await assert.rejects(
      callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => invalidResponse}),
      (error) => {
        assert.match(error.message,/未符合预期 JSON 格式/);
        assert.match(error.message,/model=deepseek-flash/);
        assert.match(error.message,/finish_reason=length/);
        assert.match(error.message,/prompt_tokens=63000/);
        assert.match(error.message,/completion_tokens=16384/);
        assert.match(error.message,/response_chars=24/);
        assert.doesNotMatch(error.message,/not-json-private-content/);
        return true;
      },
    );

    await assert.rejects(
      callDeepSeekJson({instructions:'test',input:'test',fetchImpl:async () => new Response(JSON.stringify({
        choices:[{message:{content:''},finish_reason:'stop'}],
      }),{status:200})}),
      /返回了空内容/,
    );
  });
});

test('DeepSeek client accepts task-specific reasoning and output limits',async () => {
  await withEnvironment({DEEPSEEK_API_KEY:'deepseek-test-key'},async () => {
    let requestOptions;
    await callDeepSeekJson({
      instructions:'Return JSON.',input:'test',reasoningEffort:'low',maxTokens:32_768,
      fetchImpl:async (_url,options) => {
        requestOptions=JSON.parse(options.body);
        return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),{status:200});
      },
    });
    assert.equal(requestOptions.reasoning_effort,'low');
    assert.equal(requestOptions.max_tokens,32_768);
  });
});
