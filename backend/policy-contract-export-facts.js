// Only reads facts from the policy schedule pages. Identity numbers are never
// returned: a valid ID number may only contribute its birth date.
const firstValue = (text,pattern) => text.match(pattern)?.[1]?.trim() || '';
const compact = (value) => String(value || '').replace(/\s+/g,'').replace(/[（）()·•\-—_]/g,'').toLowerCase();

function dateText(value) {
  const text=String(value || '');
  const match=text.match(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/) ||
    text.match(/((?:19|20)\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (!match) return '';
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  if (date.getUTCFullYear()!==Number(match[1]) || date.getUTCMonth()+1!==Number(match[2]) || date.getUTCDate()!==Number(match[3])) return '';
  return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
}

function demographicsFromId(value) {
  const id=String(value || '').toUpperCase();
  if (!/^\d{17}[\dX]$/.test(id)) return null;
  const factors=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const checksum='10X98765432';
  const sum=[...id.slice(0,17)].reduce((total,digit,index)=>total+Number(digit)*factors[index],0);
  if (checksum[sum%11]!==id[17]) return null;
  const raw=id.slice(6,14);
  const year=Number(raw.slice(0,4)),month=Number(raw.slice(4,6)),day=Number(raw.slice(6,8));
  const date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()+1!==month || date.getUTCDate()!==day) return null;
  return {birthDate:`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,sex:Number(id[16])%2?'男':'女'};
}

function money(value) {
  const match=String(value || '').match(/(?:RMB|人民币|[￥¥]\s*)?([\d,]+(?:\.\d{1,2})?)\s*(万元|万|元)/i) ||
    String(value || '').match(/(?:RMB|人民币|[￥¥])\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return '';
  const raw=Number(match[1].replaceAll(',',''));
  const number=raw*(match[2]==='万元'||match[2]==='万'?10_000:1);
  return Number.isFinite(number) ? `${number.toLocaleString('zh-CN',{maximumFractionDigits:2})}元` : '';
}

function beneficiaryFromLines(lines) {
  for (const line of lines) {
    const compactLine=line.replace(/\s+/g,'');
    if (/受益人/.test(compactLine) && /法定继承人/.test(compactLine)) return '法定继承人';
    const inline=compactLine.match(/(?:身故保险金)?受益人(?:姓名|名称)?[:：]?([\u4e00-\u9fa5]{2,5})(?=身份证|证件|受益顺序|受益份额|$)/);
    if (inline && !/受益人|指定|证件|身份证|姓名|性别|顺序|份额|号码|保险/.test(inline[1])) return inline[1];
  }
  const header=lines.findIndex((line)=>/(?:身故保险金)?受益人/.test(line) && /受益顺序|受益份额/.test(line));
  const next=lines.slice(header<0 ? 0 : header,header<0 ? 12 : header+5);
  if (next.some((line)=>line.includes('法定继承人'))) return '法定继承人';
  for (const line of next) {
    const match=line.replace(/\s+/g,'').match(/(?:第\d+顺位)?([\u4e00-\u9fa5]{2,5})\d{15,18}[Xx]?/);
    if (match) return match[1];
  }
  return '';
}

function validProductName(value) {
  const name=String(value || '').replace(/\s+/g,'').trim();
  return name.length>=5 && name.length<=80 && /保险|年金|寿险/.test(name) &&
    !/险种名称|基本保险金额|保险金额|保险费|保险期间|交费期满日|交费方式|保障计划|份数|档次|证件/.test(name);
}

function productFromScheduleLines(lines) {
  for (const [index,line] of lines.entries()) {
    if (!line.includes('险种名称')) continue;
    const inline=line.match(/险种名称\s*[:：]\s*(.+)/)?.[1]?.trim() || '';
    if (validProductName(inline)) return inline;
    for (const candidateLine of lines.slice(index+1,index+14)) {
      const candidate=candidateLine.split(/\s+(?:RMB|人民币|[￥¥])?\s*\d|(?:RMB|人民币|[￥¥])\s*\d/i)[0]?.trim() || '';
      if (validProductName(candidate)) return candidate;
      if (/重大疾病$/.test(candidate) && /保险/.test(lines[lines.indexOf(candidateLine)+1] || '')) {
        const combined=`${candidate}保险`;
        if (validProductName(combined)) return combined;
      }
    }
  }
  return '';
}

function policyTableFacts(lines) {
  const header=lines.findIndex((line)=>line.includes('险种名称') && /保险金额|保障计划|基本保险金额/.test(line));
  if (header<0) return {};
  const feeHeader=lines.findIndex((line,index)=>index>=header && index<header+14 && /保险费/.test(line));
  if (feeHeader<0) return {};
  const nearby=lines.slice(header,Math.min(header+18,lines.length)).join(' ');
  const amountIndex=lines.findIndex((line,index)=>index>=feeHeader && index<feeHeader+8 && /(?:[￥¥]|RMB)?\s*[\d,]+(?:\.\d{1,2})?\s*(?:万元|万|元)|(?:RMB|人民币|[￥¥])\s*[\d,]+(?:\.\d{1,2})?/i.test(line));
  const name=productFromScheduleLines(lines);
  const amount=amountIndex>=0 ? money(lines[amountIndex]) : '';
  const rest=lines.slice(feeHeader,Math.min(feeHeader+10,lines.length)).join(' ');
  const plan=firstValue(rest,/\/\s*(计划[一二三四五六七八九十\d]+)/);
  const annual=firstValue(rest,/(每年\s*[\d,]+(?:\.\d+)?\s*元)/);
  const single=firstValue(rest,/(一次交清\s*[\d,]+(?:\.\d+)?\s*元)/);
  const paymentTerm=firstValue(nearby,/交费期间\s*[:：]?\s*(\d+\s*年)/) || firstValue(rest,/\/\s*(\d+\s*年)(?!\d)/) || (rest.includes('一次交清') ? '一次交清' : '');
  const paymentEndDate=dateText(firstValue(nearby,/交费期满日\s*[:：]?\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/));
  const expiryDate=dateText(firstValue(nearby,/至\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/));
  return {
    productName:name,
    basicSumInsured:amount ? {label:plan ? `合同保险金额·${plan}` : '基本保险金额',amount} : null,
    premium:annual ? annual.replace(/\s+/g,'') : single ? single.replace(/\s+/g,'') : '',
    paymentTerm,paymentEndDate,expiryDate,plan,
    coveragePeriod:/终身|终生/.test(nearby)?'终身':'',
  };
}

export function normalizedPolicyName(value) {
  return compact(value).replace(/保险$/,'');
}

export function extractPolicyContractExportFacts(pages=[]) {
  const pageLines=(Array.isArray(pages)?pages:[]).map((page)=>({page:Number(page.num)||1,lines:String(page.text || '').split('\n').map((line)=>line.trim()).filter(Boolean)}));
  const scheduleScore=({lines})=>[
    ['险种名称',5],['基本保险金额',3],['保险金额',2],['保险费',2],['交费期间',3],['交费期满日',3],
    ['合同成立日',2],['合同生效日',3],['保险期间',2],['投保人',1],['被保险人',1],
  ].reduce((score,[term,weight])=>score+(lines.some((line)=>line.includes(term))?weight:0),0);
  const schedules=pageLines.filter(({lines})=>lines.some((line)=>line.includes('险种名称')))
    .sort((a,b)=>scheduleScore(b)-scheduleScore(a)||a.page-b.page);
  const schedule=schedules[0] || pageLines[0];
  if (!schedule) return {};
  const relevantPages=schedules.slice(0,4);
  const text=relevantPages.map(({lines})=>lines.join('\n')).join('\n');
  const allText=pageLines.map(({lines})=>lines.join('\n')).join('\n');
  const identityLines=pageLines.flatMap(({lines})=>lines).filter((line)=>/投\s*保\s*人|被\s*保\s*险\s*人/.test(line));
  const identityText=identityLines.join('\n');
  const compactIdentityText=identityText.replace(/\s+/g,'');
  const holder=firstValue(compactIdentityText,/(?:投保人)(?:姓名)?[:：]?([\u4e00-\u9fa5]{2,5})(?=身份证|证件|性别|$)/);
  const insuredLine=identityLines.find((line)=>/(?:被\s*保\s*险\s*人)/.test(line) && /身份证|证件|姓名|[:：]/.test(line)) || identityLines.find((line)=>line.includes('被保险人')) || '';
  const compactInsuredLine=insuredLine.replace(/\s+/g,'');
  const insured=firstValue(compactInsuredLine,/(?:被保险人)(?:姓名)?[:：]?([\u4e00-\u9fa5]{2,5})(?=身份证|证件|性别|$)/);
  const insuredId=firstValue(compactInsuredLine,/(?:身份证|证件号码|证件号)[:：]?(\d{17}[\dXx])/);
  const idDemographics=demographicsFromId(insuredId);
  const policyNumber=firstValue(allText,/(?:保险合同号码|保险合同号|保险单号码|保险单号|保单号码|保单号|合同编号|合同号码|合同号)\s*[:：]?\s*([A-Za-z0-9-]{6,40})(?=[ \t\n]|$)/);
  const sex=firstValue(compactInsuredLine,/性别[:：]?([男女])/) ||
    firstValue(allText.replace(/\s+/g,''),/投保年龄[:：]?\d+岁性别[:：]?([男女])/) || idDemographics?.sex || '';
  const directProduct=schedules.map(({lines})=>productFromScheduleLines(lines)).find(Boolean) || '';
  const table=schedules.map(({lines})=>policyTableFacts(lines)).find((item)=>item.productName || item.basicSumInsured || item.paymentTerm || item.paymentEndDate) || {};
  const productName=directProduct || table.productName || '';
  const compactAllText=allText.replace(/\s+/g,'');
  const directPremium=firstValue(compactAllText,/保险费(?:合计)?[:：]?((?:每年|每月)?(?:RMB|人民币|[￥¥])?[\d,]+(?:\.\d+)?(?:元|RMB)?)/i);
  const directAmount=firstValue(compactAllText,/(?:基本保险金额|基本保额)[:：]?((?:RMB|人民币|[￥¥])?[\d,]+(?:\.\d+)?(?:万元|万|元))/i);
  const periodText=firstValue(compactAllText,/保险期间[:：]?([^\n]+)/) || '';
  const datePattern='((?:(?:19|20)\\d{2}年\\d{1,2}月\\d{1,2}日?|(?:19|20)\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2}))';
  const effectiveDate=dateText(firstValue(compactAllText,new RegExp(`(?:合同生效日期|合同生效日|保险单生效日|保单生效日)[:：]?${datePattern}`)));
  const contractDate=dateText(firstValue(compactAllText,new RegExp(`合同成立日[:：]?${datePattern}`)));
  const paymentTerm=firstValue(compactAllText,/交费期间[:：]?(\d+年|一次交清|趸交)/) || table.paymentTerm || '';
  const paymentEndDate=dateText(firstValue(compactAllText,new RegExp(`交费期满日[:：]?${datePattern}`)));
  const compactRenewalText=compactAllText;
  const renewalDue=firstValue(compactRenewalText,/续期保险费交费日期[:：]?每年(\d{1,2}月\d{1,2}日)/) ||
    firstValue(compactRenewalText,/每年(\d{1,2}月\d{1,2}日)/);
  const renewalDueMatch=renewalDue.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const expiryDate=table.expiryDate || dateText(firstValue(compactAllText,new RegExp(`保险期间.*?至${datePattern}`)));
  const coveragePeriod=table.coveragePeriod || (/终身|终生/.test(periodText) ? '终身' : '') ||
    (pageLines.some(({lines})=>lines.some((line)=>/保险年期\s*[:：]\s*终身/.test(line))) ? '终身' : '');
  const companyMatch=allText.match(/(?:中国|新华|华夏|泰康|太平|平安|人保|富德|阳光|友邦|中意|中英|国华|民生|工银安盛|中宏|君龙|信泰|百年|农银|中荷|恒安标准)[\u4e00-\u9fa5]{0,8}(?:人寿保险|人寿|保险)(?:股份有限公司|有限责任公司|有限公司)/);
  const company=companyMatch?.[0] || '';
  const result={
    productName,company,policyNumber,holderName:holder,insuredName:insured,beneficiary:beneficiaryFromLines([...pageLines.slice(0,8),...schedules.slice(0,4)].flatMap(({lines})=>lines)),
    insuredSex:sex,insuredBirthDate:idDemographics?.birthDate || '',birthDateSource:idDemographics?.birthDate?'身份证校验推得':'',
    effectiveDate,contractDate,expiryDate,coveragePeriod,paymentTerm,paymentEndDate:paymentEndDate || table.paymentEndDate,
    renewalDueMonthDay:renewalDueMatch ? `${renewalDueMatch[1].padStart(2,'0')}-${renewalDueMatch[2].padStart(2,'0')}` : '',
    premium:table.premium || (/(?:RMB|人民币|[￥¥]|元|每年|每月|一次交清|趸交)|\d+\.\d{2}/i.test(directPremium) ? directPremium.replace(/\s+/g,'') : ''),
    basicSumInsured:directAmount ? {label:'基本保险金额',amount:money(directAmount)} : table.basicSumInsured,
    plan:table.plan,
  };
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!=='' && value!==null));
}
