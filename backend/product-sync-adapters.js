import { createHash, randomUUID } from 'node:crypto';

const SOURCES = Object.freeze({
  xinhua: { host: 'www.newchinalife.com', listing: 'https://www.newchinalife.com/info/4593' },
  'china-life': { host: 'www.e-chinalife.com', listing: 'https://www.e-chinalife.com/xxpl/gsgk/cpjbxx/' },
  taikang: { host: 'www.taikanglife.com', listing: 'https://www.taikanglife.com/publicinfonew/basicnew/pubproduct/commonprodinfonew/list_542_1.html' },
  'ping-an': { host: 'life.pingan.com', listing: 'https://life.pingan.com/gongkaixinxipilu/baoxianchanpinmulujitiaokuan.jsp' },
  'cpic-life': { host: 'www.cpic.com.cn', listing: 'https://www.cpic.com.cn/xrsbx/gkxxpl/jbxx/gsgk/jydbxcpmljtk/zbcp/' },
  'aia-life': { host: 'www.aia.com.cn', apiHost: 'cws.aia.com.cn', listing: 'https://www.aia.com.cn/zh-cn/gongkaixinxipilou/jibenxinxi/chanpinjibenxinxi/zaishouchanpin.chanpinjibenxinxi' },
});

const LIMIT_BYTES = 8 * 1024 * 1024;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashKey = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 40);
const decodeHtml = (value='') => String(value)
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/\u00a0/g, ' ');
const textOf = (html='') => decodeHtml(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/[\s\u3000]+/g, ' ').trim();
const attributesOf = (html='') => {
  const attrs = {};
  for (const match of String(html).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
};
const tagAttributes = (html,tag) => [...String(html).matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map((match) => attributesOf(match[1]));
const getRows = (html) => [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
const getCells = (row) => [...String(row).matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => match[1]);
const safeUrl = (value,companyCode) => {
  try {
    const url = new URL(value, SOURCES[companyCode].listing);
    const allowed = {
      xinhua: ['www.newchinalife.com','static-cdn.newchinalife.com'],
      'china-life': ['www.e-chinalife.com'],
      taikang: ['www.taikanglife.com','m.taikanglife.com'],
      'ping-an': ['life.pingan.com'],
      'cpic-life': ['www.cpic.com.cn','cpic.com.cn','life.cpic.com.cn'],
      'aia-life': ['www.aia.com.cn','cws.aia.com.cn'],
    }[companyCode] || [];
    return url.protocol === 'https:' && allowed.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
};
export const isProductSyncUrlSafe = (value,companyCode) => Boolean(safeUrl(value,companyCode));
const fetchBody = async (url,{method='GET',headers={},body,companyCode,contentType='text'}={}) => {
  let requestUrl = safeUrl(url,companyCode);
  if (!requestUrl) throw new Error('来源链接不在该保险公司的官方域名范围内');
  let requestMethod=method;
  let requestBody=body;
  let response;
  for (let redirectCount=0;redirectCount<=5;redirectCount++) {
    response=await fetch(requestUrl,{method:requestMethod,headers,body:requestBody,redirect:'manual',signal:AbortSignal.timeout(30_000)});
    if (![301,302,303,307,308].includes(response.status)) break;
    const location=response.headers.get('location');
    const nextUrl=location ? safeUrl(new URL(location,requestUrl).href,companyCode) : '';
    if (!nextUrl) throw new Error('官网跳转到了未授权域名，已停止请求');
    if (redirectCount===5) throw new Error('官网跳转次数过多，已停止请求');
    if (response.status===303 || ((response.status===301 || response.status===302) && requestMethod==='POST')) {
      requestMethod='GET'; requestBody=undefined;
    }
    requestUrl=nextUrl;
  }
  const finalUrl = safeUrl(response.url || requestUrl,companyCode);
  if (!finalUrl) throw new Error('官网跳转到了未授权域名，已停止请求');
  if (!response.ok) throw new Error(`官网返回 HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > LIMIT_BYTES) throw new Error('官网目录响应超过 8 MB 上限');
  const raw = await response.text();
  if (Buffer.byteLength(raw,'utf8') > LIMIT_BYTES) throw new Error('官网目录响应超过 8 MB 上限');
  if (contentType === 'json') {
    try { return JSON.parse(raw); } catch { throw new Error('官网返回内容不是有效 JSON'); }
  }
  return {text:raw,url:finalUrl};
};
const productType = (category,name) => {
  if (['life','health','accident','annuity'].includes(String(category || '').toLowerCase())) return String(category).toLowerCase();
  const value = `${category || ''} ${name || ''}`;
  if (/医疗|健康|疾病|重疾|护理|长期护理/.test(value)) return 'health';
  if (/意外|伤害/.test(value)) return 'accident';
  if (/年金|养老/.test(value)) return 'annuity';
  return 'life';
};
const isGroupProduct = (name) => /团体|团险/.test(name);
const scopeFor = (name) => /附加/.test(name) ? 'supplementary' : 'individual';
const materialType = (label='') => {
  if (/条款|clause/i.test(label)) return 'policy_terms';
  if (/费率|保费表|基本保险金额表|rate/i.test(label)) return 'rate_table';
  if (/现金价值|cash.?value/i.test(label)) return 'cash_value';
  if (/说明书|产品说明|direction|description/i.test(label)) return 'product_brief';
  if (/宣传|折页/.test(label)) return 'brochure';
  return 'other';
};
const material = (companyCode,label,url,pageUrl) => {
  let candidate=url;
  if (companyCode==='cpic-life') {
    try {
      const viewer=new URL(url,SOURCES[companyCode].listing);
      if (/\/mpdfjs\/pdf\.html$/i.test(viewer.pathname)) {
        const filePath=(viewer.searchParams.get('file') || '').split('?')[0];
        if (filePath.startsWith('/upload/resources/file/')) candidate=new URL(filePath,viewer.origin).href;
      }
    } catch {}
  }
  const safe = safeUrl(candidate,companyCode);
  if (!safe) return null;
  const rawLabel=textOf(label);
  const displayLabel=/条款|clause/i.test(rawLabel)?'保险条款':/费率|保费表|基本保险金额表|rate/i.test(rawLabel)?'费率表':
    /现金价值|cash.?value/i.test(rawLabel)?'现金价值表':/说明书|产品说明|direction|description/i.test(rawLabel)?'产品说明书':rawLabel || '官方产品资料';
  return {type:materialType(label),label:displayLabel.slice(0,120),url:safe,pageUrl:safeUrl(pageUrl,companyCode) || SOURCES[companyCode].listing};
};
const makeProduct = ({companyCode,key,name,category='',code='',productUrl='',evidenceUrl='',materials=[]}) => ({
  productKey:String(key || hashKey(`${companyCode}:${name}:${productUrl || evidenceUrl}`)),
  productName:textOf(name).slice(0,120),
  insuranceTypeCode:productType(category,name),
  officialProductCode:String(code || '').slice(0,120),
  officialProductUrl:safeUrl(productUrl,companyCode) || safeUrl(evidenceUrl,companyCode) || SOURCES[companyCode].listing,
  evidenceUrl:safeUrl(evidenceUrl,companyCode) || SOURCES[companyCode].listing,
  scope:scopeFor(name),
  materials:materials.filter(Boolean),
});

async function fetchXinhua() {
  const code='xinhua';
  const first=await fetchBody(SOURCES[code].listing,{companyCode:code});
  const pages=[...first.text.matchAll(/href=["']\/info\/4593(?:_(\d+))?["']/gi)].map((match)=>Number(match[1] || 1));
  const maxPage=Math.max(1,...pages);
  const all=[]; let excluded=0;
  for (let page=1; page<=maxPage; page++) {
    const current=page===1 ? first : await fetchBody(`https://www.newchinalife.com/info/4593_${page}`,{companyCode:code});
    for (const row of getRows(current.text)) {
      const cells=getCells(row); if (cells.length<5) continue;
      const name=textOf(cells[1]); const category=textOf(cells[2]); const sale=textOf(cells[3]);
      if (!name || name==='产品名称') continue;
      if (sale!=='在售') { excluded++; continue; }
      if (isGroupProduct(name)) { excluded++; continue; }
      const anchors=[...cells[4].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match)=>({attrs:attributesOf(match[1]),label:textOf(match[2])}));
      const terms=anchors.find((item)=>/条款/.test(item.label));
      const codeMatch=decodeHtml(terms?.attrs.href || '').match(/[?&]riskCode=([^&]+)/i);
      const materials=anchors.map((item)=>material(code,item.label,item.attrs.href,current.url));
      const productUrl=terms?.attrs.href ? new URL(terms.attrs.href,current.url).href : current.url;
      all.push(makeProduct({companyCode:code,key:codeMatch?.[1] || hashKey(`${name}:${productUrl}`),name,category,code:codeMatch?.[1] ? decodeURIComponent(codeMatch[1]) : '',productUrl,evidenceUrl:current.url,materials}));
    }
    if (page<maxPage) await sleep(250);
  }
  if (!all.length) throw new Error('新华官网未解析到明确在售产品，未更新产品库');
  return {products:all,excluded,sourceSummary:{pages:maxPage,sourceUrls:[SOURCES[code].listing],coverage:'逐行状态为“在售”；已排除团体产品'}};
}

async function fetchTaikang() {
  const code='taikang'; const {text,url}=await fetchBody(SOURCES[code].listing,{companyCode:code});
  const table=text.match(/<table\b[^>]*id=["']tb_tab_1["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error('泰康官网在售产品目录结构发生变化，未更新产品库');
  const rows=getRows(table); if (rows.length<2) throw new Error('泰康官网在售目录为空或结构异常');
  let excluded=0; const products=[];
  for (const row of rows.slice(1)) {
    const cells=getCells(row); const name=textOf(cells[0] || '');
    if (!name) continue;
    if (isGroupProduct(name)) { excluded++; continue; }
    const options=tagAttributes(cells[1] || '', 'option').filter((option)=>option.enabled==='Y' && option.value);
    const materials=options.map((option)=>material(code,option.filetype || option.fileType || option.name,option.value,url));
    const productId=options.find((option)=>/^\d+$/.test(option.name || ''))?.name || '';
    const productUrl=productId ? `${url}#${encodeURIComponent(productId)}` : url;
    products.push(makeProduct({companyCode:code,key:productId || hashKey(`${name}:${url}`),name,category:'',code:productId,productUrl,evidenceUrl:url,materials}));
  }
  if (!products.length) throw new Error('泰康官网在售目录没有可导入的个人产品');
  return {products,excluded,sourceSummary:{pages:1,sourceUrls:[url],coverage:'仅解析 tb_tab_1 在售页签；材料仅收录 enabled=Y 的链接'}};
}

async function fetchPingAn() {
  const code='ping-an'; const page=await fetchBody(SOURCES[code].listing,{companyCode:code});
  const scriptUrl=new URL('/app_js/xinxipilu/gongkaixinxipilu_baoxianchanpin.js',page.url).href;
  await fetchBody(scriptUrl,{companyCode:code});
  const endpoint='https://life.pingan.com/ilife-home/product/getProductList';
  const data=await fetchBody(endpoint,{method:'POST',companyCode:code,contentType:'json',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({isOrNotSale:'Y',planSalesStatus:'Y',sourceCode:'ilife-core',isOnlyNew:'Y'})});
  if (data.CODE!=='00' || !Array.isArray(data.DATA)) throw new Error('平安官网在售产品目录返回异常，未更新产品库');
  let excluded=0;
  const products=data.DATA.flatMap((entry)=>{
    const name=textOf(entry.clauseName || entry.planName || '');
    if (entry.planSalesStatus!=='在售' || !name || isGroupProduct(name)) { excluded++; return []; }
    const planCode=entry.actualPlanCode || entry.planCode || '';
    const version=entry.versionNo || '';
    const materialTypes=[['条款',1],['费率表',2],['产品说明书',7],['现金价值表',12]];
    const materials=materialTypes.map(([label,type])=>{
      const flagKey=type===1?'clauseContent':type===2?'premAttachment':type===7?'productInstruction':'existResvAttachment';
      const hasFlag=entry[flagKey]===true || ['Y','1','是'].includes(String(entry[flagKey] || '').toUpperCase());
      if (!hasFlag) return null;
      const url=`https://life.pingan.com/ilife-home/product/getPlanClausePdf?planCode=${encodeURIComponent(planCode)}&versionNo=${encodeURIComponent(version)}&attachmentType=${type}`;
      return material(code,label,url,SOURCES[code].listing);
    });
    return [makeProduct({companyCode:code,key:`${planCode}:${version}`,name,category:entry.productType || entry.insuranceType || '',code:planCode,productUrl:SOURCES[code].listing,evidenceUrl:SOURCES[code].listing,materials})];
  });
  if (!products.length) throw new Error('平安官网没有返回可确认在售的个人产品');
  return {products,excluded,sourceSummary:{pages:1,sourceUrls:[page.url],coverage:'官网产品目录请求限定 isOrNotSale=Y、planSalesStatus=Y；逐条核验状态'}};
}

const CPIC_CATEGORIES=[
  {path:'sx',type:'life'},
  {path:'nj',type:'annuity'},
  {path:'ywx',type:'accident'},
  {path:'jkx',type:'health'},
];
async function fetchCpic() {
  const code='cpic-life'; const products=[]; const visited=[]; let excluded=0; let totalPages=0;
  for (const category of CPIC_CATEGORIES) {
    const base=`https://www.cpic.com.cn/xrsbx/gkxxpl/jbxx/gsgk/jydbxcpmljtk/zbcp/${category.path}/`;
    const first=await fetchBody(base,{companyCode:code});
    const pageNums=[...first.text.matchAll(new RegExp(`href=["']([^"']*${category.path}/index_(\\d+)\\.shtml)["']`,'gi'))].map((match)=>Number(match[2]));
    const maxPage=Math.max(1,...pageNums); totalPages+=maxPage;
    const categoryEntries=[];
    for (let page=1;page<=maxPage;page++) {
      const current=page===1?first:await fetchBody(`${base}index_${page}.shtml`,{companyCode:code});
      const tables=[...current.text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match)=>match[1]);
      const productTable=tables.find((table)=>/产品名称/.test(textOf(table)) && getRows(table).length>1);
      if (!productTable) throw new Error(`太平洋人寿${category.path}在售目录第 ${page} 页结构异常`);
      for (const row of getRows(productTable)) {
        const cells=getCells(row); if (cells.length<5 || !/产品名称/.test(textOf(cells[1] || '')) && !/产品名称/.test(textOf(cells[0] || ''))) {
          const name=textOf(cells[1] || cells[0] || '');
          if (!name || /^\d+$/.test(name)) continue;
          if (isGroupProduct(name)) { excluded++; continue; }
          const materialCells=[['条款',cells[1]],['费率表',cells[2]],['现金价值表',cells[3]],['产品说明/产品说明书',cells[4]]];
          const materials=materialCells.flatMap(([label,cell])=>[...String(cell || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match)=>material(code,label,attributesOf(match[1]).href,current.url)).filter(Boolean));
          const productLinks=[...String(cells[1] || '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
          const productPage=productLinks.length ? new URL(attributesOf(productLinks[0][1]).href,current.url).href : current.url;
          const stableMaterialIds=materials.map((item)=>item.url).sort().join('|');
          const key=hashKey(`${category.path}:${stableMaterialIds || productPage}:${name}`);
          categoryEntries.push(makeProduct({companyCode:code,key,name,category:category.type,productUrl:productPage,evidenceUrl:current.url,materials}));
        }
      }
      if (page<maxPage) await sleep(250);
    }
    if (!categoryEntries.length) throw new Error(`太平洋人寿${category.path}在售分类未解析到产品，未更新产品库`);
    products.push(...categoryEntries); visited.push({category:category.path,pages:maxPage,count:categoryEntries.length,url:base});
  }
  if (!products.length) throw new Error('太平洋人寿没有返回可确认在售的个人产品');
  return {products,excluded,sourceSummary:{pages:totalPages,categories:visited,sourceUrls:visited.map((item)=>item.url),coverage:'仅读取寿险、年金、意外险、健康险在办产品目录，跳过团体产品及历史版本栏'}};
}

const aiaDocumentUrl=(fileName,docBasePath)=>{
  const name=String(fileName || '').trim();
  const base=String(docBasePath || '').trim();
  if (!name || !base.startsWith('/content/dam/cn/zh-cn/docs/public-disclosure/') ||
      name.startsWith('/') || name.split('/').some((part)=>!part || part==='.' || part==='..' || /[\u0000-\u001f\\?#]/.test(part)) ||
      /[\u0000-\u001f\\?#]/.test(base) || base.includes('..')) return '';
  const encodedName=name.split('/').map((part)=>encodeURIComponent(part)).join('/');
  return new URL(`${base}${encodedName}.pdf`,'https://www.aia.com.cn').href;
};

async function fetchAiaLife() {
  const code='aia-life';
  const {text}=await fetchBody(SOURCES[code].listing,{companyCode:code});
  const accordionTag=text.match(/<div\b[^>]*class=["'][^"']*\bcmp-productaccordion\b[^"']*["'][^>]*>/i)?.[0];
  const accordion=accordionTag ? attributesOf(accordionTag.slice(4,-1)) : {};
  const apiBaseTag=[...text.matchAll(/<meta\b[^>]*>/gi)].map((match)=>attributesOf(match[0].slice(5,-1)))
    .find((attributes)=>attributes.name?.toLowerCase()==='apibaseurl');
  const apiBase=apiBaseTag?.content ? safeUrl(apiBaseTag.content,code) : '';
  const apiPath=String(accordion['data-api-path'] || '');
  const docBasePath=String(accordion['data-doc-base-path'] || '');
  if (!apiBase || apiPath!=='/mypage/productpublish/list' || accordion['data-product-status']!=='1' ||
      !docBasePath.startsWith('/content/dam/cn/zh-cn/docs/public-disclosure/')) {
    throw new Error('友邦官网在售产品目录结构发生变化，未更新产品库');
  }
  const endpoint=safeUrl(new URL(apiPath,apiBase).href,code);
  const pageSize=Number(accordion['data-display-count-per-page'] || 10);
  if (!endpoint || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('友邦官网目录分页参数异常');
  const requestPage=async(index)=>{
    const body={like:'',status:'在售',page:{pageSize,index}};
    const requestId=randomUUID();
    const canonical=JSON.stringify(body).split('').sort().join('');
    // This signing seed is shipped in AIA's public client bundle and is required by its public catalog endpoint.
    const signature=createHash('md5').update(`1qaz@WSX#$%&#${canonical}##${requestId}`).digest('hex').toUpperCase();
    const response=await fetchBody(endpoint,{method:'POST',companyCode:code,contentType:'json',headers:{
      'content-type':'application/json','accept':'application/json, text/plain, */*',
      'x-crp-sign':signature,'x-request-id':requestId,
      'referer':SOURCES[code].listing,'origin':'https://www.aia.com.cn',
    },body:JSON.stringify(body)});
    const directory=response?.product_publish;
    if (response?.success!=='true' || !Array.isArray(directory?.records) ||
        Number(directory.pageSize)!==pageSize || Number(directory.index)!==index || !Number(directory.totalPage)) {
      throw new Error(index===0 ? '友邦官网在售产品目录返回异常，未更新产品库' : `友邦官网第 ${index+1} 页目录结构异常`);
    }
    return {records:directory.records,totalPage:Number(directory.totalPage),publishDate:String(response.publish_date || '')};
  };
  const first=await requestPage(0);
  if (first.totalPage>1 && first.records.length!==pageSize) throw new Error('友邦官网在售目录第一页数据不完整，未更新产品库');
  const entries=[...first.records];
  for (let page=1;page<first.totalPage;page++) {
    const current=await requestPage(page);
    if ((page<first.totalPage-1 && current.records.length!==pageSize) ||
        (page===first.totalPage-1 && (!current.records.length || current.records.length>pageSize))) {
      throw new Error(`友邦官网第 ${page+1} 页目录数据不完整，未更新产品库`);
    }
    entries.push(...current.records);
    if (page<first.totalPage-1) await sleep(250);
  }
  if (entries.length===0) throw new Error('友邦官网在售目录为空，未更新产品库');
  let excluded=0;
  const products=entries.flatMap((entry)=>{
    const name=textOf(entry.productName || '');
    if (entry.productStatus!=='在售' || !name || isGroupProduct(name)) { excluded++; return []; }
    const terms=String(entry.productItem || '').split('/').at(-1) || '';
    const codeMatch=terms.match(/^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)/);
    const materials=[
      ['保险条款',entry.productItem],['费率表',entry.ratesTable],
      ['现金价值表',entry.cashValueTable],['产品说明书',entry.productInstruction],
    ].map(([label,fileName])=>{
      const url=aiaDocumentUrl(fileName,docBasePath);
      return url ? material(code,label,url,SOURCES[code].listing) : null;
    });
    return [makeProduct({companyCode:code,key:codeMatch?.[1] || hashKey(`${name}:${terms}`),name,
      code:codeMatch?.[1] || '',productUrl:SOURCES[code].listing,evidenceUrl:SOURCES[code].listing,materials})];
  });
  if (!products.length) throw new Error('友邦官网没有返回可确认在售的个人产品');
  return {products,excluded,sourceSummary:{pages:first.totalPage,publishDate:first.publishDate,
    sourceUrls:[SOURCES[code].listing],coverage:'友邦官网产品基本信息“在售产品”目录；逐条核验 productStatus=在售，排除团体产品'}};
}

export const PRODUCT_SYNC_ADAPTERS=Object.freeze({
  xinhua:fetchXinhua,
  taikang:fetchTaikang,
  'ping-an':fetchPingAn,
  'cpic-life':fetchCpic,
  'aia-life':fetchAiaLife,
});
