import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './api.js';

test('image generation sends the selected platform style options to the backend',async () => {
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url,options) => {
    captured = {url,options};
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.generateImage('T-12345','小红书',{style:'bold',layout:'comparison',palette:'neon'});
    assert.equal(captured.url,'/api/topics/T-12345/images/generate');
    assert.deepEqual(JSON.parse(captured.options.body),{
      platform:'小红书',imageOptions:{style:'bold',layout:'comparison',palette:'neon'},
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('deleting a preview image uses the asset DELETE route',async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url,options={}) => {
    call = {url,options};
    return new Response(JSON.stringify({id:17,preservedForHistory:false}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    const result = await api.deleteAsset(17);
    assert.equal(call.url,'/api/assets/17');
    assert.equal(call.options.method,'DELETE');
    assert.deepEqual(result,{id:17,preservedForHistory:false});
  } finally {
    globalThis.fetch = originalFetch;
  }
});
