import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PRODUCT_SYNC_ADAPTERS, isProductSyncUrlSafe } from '../product-sync-adapters.js';

const withFetch = async (handler,work) => {
  const originalFetch=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async (url,options={})=>{
    const address=String(url);
    requests.push({url:address,options});
    const response=await handler(address,options,requests);
    if (response instanceof Response && !response.url) Object.defineProperty(response,'url',{value:address});
    return response;
  };
  try { return await work(requests); }
  finally { globalThis.fetch=originalFetch; }
};

const htmlResponse=(html,status=200,headers={})=>new Response(html,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
const jsonResponse=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});

test('official product sync only accepts HTTPS URLs on the configured insurer host',()=>{
  assert.equal(isProductSyncUrlSafe('https://www.newchinalife.com/info/4593','xinhua'),true);
  assert.equal(isProductSyncUrlSafe('http://www.newchinalife.com/info/4593','xinhua'),false);
  assert.equal(isProductSyncUrlSafe('https://attacker.example/info/4593','xinhua'),false);
  assert.equal(isProductSyncUrlSafe('https://www.e-chinalife.com/product.pdf','china-life'),true);
  assert.equal(isProductSyncUrlSafe('https://www.e-chinalife.com.attacker.example/product.pdf','china-life'),false);
  assert.equal(isProductSyncUrlSafe('https://cws.aia.com.cn/mypage/productpublish/list','aia-life'),true);
  assert.equal(isProductSyncUrlSafe('https://www.aia.com.cn/content/dam/policy.pdf','aia-life'),true);
  assert.equal(isProductSyncUrlSafe('https://aia.com.attacker.example/policy.pdf','aia-life'),false);
});

test('Xinhua adapter imports only rows explicitly marked on sale and excludes group products',async()=>{
  const listing='https://www.newchinalife.com/info/4593';
  const html=`<table>
    <tr><th>序号</th><th>产品名称</th><th>险种</th><th>销售状态</th><th>资料</th></tr>
    <tr><td>1</td><td>新华个人终身寿险</td><td>寿险</td><td>在售</td><td><a href="https://www.newchinalife.com/product/clause?riskCode=XH-01">保险条款</a><a href="https://www.newchinalife.com/product/rate.pdf">费率表</a></td></tr>
    <tr><td>2</td><td>新华个人医疗险</td><td>健康险</td><td>停售</td><td></td></tr>
    <tr><td>3</td><td>新华团体医疗险</td><td>健康险</td><td>在售</td><td></td></tr>
  </table>`;
  const {result,requests}=await withFetch(async(url)=>{
    assert.equal(url,listing);
    return htmlResponse(html);
  },async(requests)=>({result:await PRODUCT_SYNC_ADAPTERS.xinhua(),requests}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].productName,'新华个人终身寿险');
  assert.equal(result.products[0].officialProductCode,'XH-01');
  assert.equal(result.products[0].scope,'individual');
  assert.equal(result.products[0].materials.length,2);
  assert.equal(result.excluded,2);
  assert.equal(requests[0].options.redirect,'manual');
});

test('Taikang adapter reads only the on-sale tab and enabled material links',async()=>{
  const listing='https://www.taikanglife.com/publicinfonew/basicnew/pubproduct/commonprodinfonew/list_542_1.html';
  const html=`<table id="tb_tab_1">
    <tr><th>产品名称</th><th>资料</th></tr>
    <tr><td>泰康个人养老年金</td><td><select><option name="TK-01" filetype="保险条款" value="https://www.taikanglife.com/docs/terms.pdf" enabled="Y"></option><option name="rate" filetype="费率表" value="https://www.taikanglife.com/docs/rate.pdf" enabled="N"></option></select></td></tr>
    <tr><td>泰康团体意外险</td><td><select><option name="TK-G" filetype="保险条款" value="https://www.taikanglife.com/docs/group.pdf" enabled="Y"></option></select></td></tr>
  </table><table id="tb_tab_2"><tr><td>停售产品</td></tr></table>`;
  const {result}=await withFetch(async(url)=>{
    assert.equal(url,listing);
    return htmlResponse(html);
  },async()=>({result:await PRODUCT_SYNC_ADAPTERS.taikang()}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].productName,'泰康个人养老年金');
  assert.equal(result.products[0].insuranceTypeCode,'annuity');
  assert.equal(result.products[0].materials.length,1);
  assert.equal(result.excluded,1);
});

test('Ping An adapter requests current on-sale status and excludes stopped or group results',async()=>{
  const listing='https://life.pingan.com/gongkaixinxipilu/baoxianchanpinmulujitiaokuan.jsp';
  const script='https://life.pingan.com/app_js/xinxipilu/gongkaixinxipilu_baoxianchanpin.js';
  const endpoint='https://life.pingan.com/ilife-home/product/getProductList';
  const {result,requests}=await withFetch(async(url,options)=>{
    if (url===listing || url===script) return htmlResponse('<html></html>');
    assert.equal(url,endpoint);
    assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{isOrNotSale:'Y',planSalesStatus:'Y',sourceCode:'ilife-core',isOnlyNew:'Y'});
    return jsonResponse({CODE:'00',DATA:[
      {clauseName:'平安个人医疗险',actualPlanCode:'PA-01',versionNo:'V2',planSalesStatus:'在售',productType:'health',clauseContent:'Y',premAttachment:'Y'},
      {clauseName:'平安个人旧版寿险',actualPlanCode:'PA-OLD',planSalesStatus:'停售'},
      {clauseName:'平安团体寿险',actualPlanCode:'PA-G',planSalesStatus:'在售'},
    ]});
  },async(requests)=>({result:await PRODUCT_SYNC_ADAPTERS['ping-an'](),requests}));
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].productKey,'PA-01:V2');
  assert.equal(result.products[0].insuranceTypeCode,'health');
  assert.equal(result.products[0].materials.length,2);
  assert.equal(result.excluded,2);
  assert.deepEqual(requests.map((request)=>request.options.redirect),['manual','manual','manual']);
});

test('CPIC Life adapter reads the four active individual lines and skips group rows',async()=>{
  const listingRoot='https://www.cpic.com.cn/xrsbx/gkxxpl/jbxx/gsgk/jydbxcpmljtk/zbcp/';
  const table=`<table class="mt40"></table><table id="example"><tr><td>序号</td><td>产品名称及条款</td><td>费率表</td><td>现金价值表</td><td>产品说明</td></tr>
    <tr><td>1</td><td><a href="/xrsbx/product.shtml">太保个人寿险</a></td><td><a href="/xrsbx/terms.pdf">条款</a></td><td><a href="/xrsbx/rate.pdf">费率</a></td><td><a href="/xrsbx/brief.pdf">说明书</a></td></tr>
    <tr><td>2</td><td><a href="/xrsbx/group.shtml">太保团体寿险</a></td><td></td><td></td><td></td></tr></table>`;
  const {result,requests}=await withFetch(async(url)=>{
    assert.match(url,new RegExp(`^${listingRoot.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(sx|nj|ywx|jkx)/$`));
    return htmlResponse(table);
  },async(requests)=>({result:await PRODUCT_SYNC_ADAPTERS['cpic-life'](),requests}));
  assert.equal(result.products.length,4);
  assert.deepEqual(result.products.map((product)=>product.insuranceTypeCode),['life','annuity','accident','health']);
  assert.ok(result.products.every((product)=>product.scope==='individual'));
  assert.equal(result.excluded,4);
  assert.equal(requests.length,4);
});

test('AIA adapter reads the official on-sale directory pages and links official materials',async()=>{
  const listing='https://www.aia.com.cn/zh-cn/gongkaixinxipilou/jibenxinxi/chanpinjibenxinxi/zaishouchanpin.chanpinjibenxinxi';
  const api='https://cws.aia.com.cn/mypage/productpublish/list';
  const html=`<meta name="apiBaseUrl" content="https://cws.aia.com.cn/">
    <div class="cmp-accordion cmp-productaccordion" data-api-path="/mypage/productpublish/list" data-product-status="1"
      data-display-count-per-page="2" data-doc-base-path="/content/dam/cn/zh-cn/docs/public-disclosure/"></div>`;
  const pages=[
    {success:'true',publish_date:'2026-10-19',product_publish:{index:0,pageSize:2,totalPage:2,records:[
      {productName:'友邦个人医疗险',productStatus:'在售',productItem:'terms/B3201-1友邦个人医疗险的条款',ratesTable:'prem/友邦个人医疗险的费率表'},
      {productName:'友邦附加重大疾病保险',productStatus:'在售',productItem:'terms/B3202-1友邦附加重大疾病保险的条款'},
    ]}},
    {success:'true',publish_date:'2026-10-19',product_publish:{index:1,pageSize:2,totalPage:2,records:[
      {productName:'友邦团体意外保险',productStatus:'在售',productItem:'terms/B3203-1团体意外保险的条款'},
      {productName:'友邦已停售产品',productStatus:'停售',productItem:'terms/B3204-1停售产品的条款'},
    ]}},
  ];
  let apiPageIndex=0;
  const {result,requests}=await withFetch(async(url,options)=>{
    if(url===listing) return htmlResponse(html);
    assert.equal(url,api);
    assert.equal(options.method,'POST');
    assert.equal(options.headers.referer,listing);
    const body=JSON.parse(options.body);
    assert.deepEqual(body,{like:'',status:'在售',page:{pageSize:2,index:apiPageIndex}});
    const canonical=JSON.stringify(body).split('').sort().join('');
    const expected=createHash('md5').update(`1qaz@WSX#$%&#${canonical}##${options.headers['x-request-id']}`).digest('hex').toUpperCase();
    assert.equal(options.headers['x-crp-sign'],expected);
    return jsonResponse(pages[apiPageIndex++]);
  },async(requests)=>({result:await PRODUCT_SYNC_ADAPTERS['aia-life'](),requests}));
  assert.equal(result.products.length,2);
  assert.equal(result.products[0].productName,'友邦个人医疗险');
  assert.equal(result.products[0].officialProductCode,'B3201-1');
  assert.equal(result.products[0].insuranceTypeCode,'health');
  assert.equal(result.products[0].scope,'individual');
  assert.match(result.products[0].materials[0].url,/www\.aia\.com\.cn\/content\/dam\/cn\/zh-cn\/docs\/public-disclosure\/terms\/B3201-1/);
  assert.equal(result.products[1].scope,'supplementary');
  assert.equal(result.excluded,2);
  assert.equal(result.sourceSummary.publishDate,'2026-10-19');
  assert.equal(result.sourceSummary.pages,2);
  assert.equal(requests.length,3);
});

test('official directory redirects are validated before requesting a new host',async()=>{
  const {error,requests}=await withFetch(async(_url)=>new Response(null,{status:302,headers:{location:'https://attacker.example/private'}}),async(requests)=>{
    try { await PRODUCT_SYNC_ADAPTERS.xinhua(); return {requests}; }
    catch(error) { return {error,requests}; }
  });
  assert.match(error.message,/未授权域名/);
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.redirect,'manual');
});
