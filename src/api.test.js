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

test('content draft history uses shared draft version routes',async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url,options={}) => {
    calls.push({url,options});
    return new Response(JSON.stringify([]),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.draftVersions('T-CASE','小红书');
    await api.restoreDraftVersion('T-CASE','小红书',2);
    assert.equal(calls[0].url,'/api/topics/T-CASE/drafts/%E5%B0%8F%E7%BA%A2%E4%B9%A6/versions');
    assert.equal(calls[0].options?.method || 'GET','GET');
    assert.equal(calls[1].url,'/api/topics/T-CASE/drafts/%E5%B0%8F%E7%BA%A2%E4%B9%A6/versions/2/restore');
    assert.equal(calls[1].options.method,'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('product catalog sync API targets company settings, run history, and on-sale filtering routes',async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url,options});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.productCenterProducts({officialSaleStatus:'verified_on_sale'});
    await api.updateProductSyncCompany('aia-life',true);
    await api.startProductSync(['aia-life']);
    await api.productSyncRuns();
    await api.productSyncRun('run / 1');
    await api.importOfficialProductMaterial(8,21);
    assert.equal(calls[0].url,'/api/product-center/products?officialSaleStatus=verified_on_sale');
    assert.equal(calls[1].url,'/api/product-center/companies/aia-life');
    assert.equal(calls[1].options.method,'PATCH');
    assert.deepEqual(JSON.parse(calls[1].options.body),{syncEnabled:true});
    assert.equal(calls[2].url,'/api/product-center/sync-runs');
    assert.deepEqual(JSON.parse(calls[2].options.body),{companyCodes:['aia-life']});
    assert.equal(calls[3].url,'/api/product-center/sync-runs');
    assert.equal(calls[4].url,'/api/product-center/sync-runs/run%20%2F%201');
    assert.equal(calls[5].url,'/api/product-center/products/8/official-materials/21/import');
  } finally {
    globalThis.fetch=originalFetch;
  }
});
