import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './api.js';

test('product center API uses its dedicated routes and sends structured platform preferences',async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url,options={}) => {
    calls.push({url,options});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.productCenterMeta();
    await api.productCenterProducts({search:'安心',status:'可用'});
    await api.analyzeProductMaterials(12);
    await api.updateProductPlatformSettings('公众号',{audience:'普通读者',tone:'通俗'});
    await api.restoreProductCopyDraftVersion(8,2);
    assert.equal(calls[0].url,'/api/product-center/meta');
    assert.equal(calls[1].url,'/api/product-center/products?search=%E5%AE%89%E5%BF%83&status=%E5%8F%AF%E7%94%A8');
    assert.equal(calls[2].url,'/api/product-center/products/12/analyze');
    assert.equal(calls[2].options.method,'POST');
    assert.deepEqual(JSON.parse(calls[2].options.body),{});
    assert.equal(calls[3].url,'/api/product-center/platform-settings/%E5%85%AC%E4%BC%97%E5%8F%B7');
    assert.deepEqual(JSON.parse(calls[3].options.body),{audience:'普通读者',tone:'通俗'});
    assert.equal(calls[4].url,'/api/product-center/drafts/8/versions/2/restore');
    assert.equal(calls[4].options.method,'POST');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('product document upload leaves content type to the browser FormData boundary',async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url,options={}) => {
    call = {url,options};
    return new Response(JSON.stringify({id:1}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.uploadProductDocument(4,new Blob(['sample'],{type:'text/plain'}),'product_brief');
    assert.equal(call.url,'/api/product-center/products/4/documents');
    assert.equal(call.options.method,'POST');
    assert.equal(call.options.headers,undefined);
    assert.equal(call.options.body.get('documentType'),'product_brief');
    assert.equal(call.options.body.get('file').type,'text/plain');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
