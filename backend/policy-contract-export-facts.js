// Only reads facts from the policy schedule pages. Personal identifiers are
// never returned: a valid ID number may only contribute its birth date.
const firstValue = (text,pattern) => text.match(pattern)?.[1]?.trim() || '';
const compact = (value) => String(value || '').replace(/\s+/g,'').replace(/[（）()·•\-—_]/g,'').toLowerCase();

function dateText(value) {
  const match=String(value || '').match(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
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
  const match=String(value || '').match(/(?:[￥¥]\s*)?([\d,]+(?:\.\d{1,2})?)\s*元/);
  if (!match) return '';
  const number=Number(match[1].replaceAll(',',''));
  return Number.isFinite(number) ? `${number.toLocaleString('zh-CN',{maximumFractionDigits:2})}元` : '';
}

function beneficiaryFromLines(lines) {
  const header=lines.findIndex((line)=>/(?:身故保险金)?受益人/.test(line) && /受益顺序|受益份额/.test(line));
  if (header<0) return '';
  const next=lines.slice(header+1,header+4);
  if (next.some((line)=>line.includes('法定继承人'))) return '法定继承人';
  for (const line of next) {
    const match=line.match(/^([\u4e00-\u9fa5]{2,4})\s+\d{15,18}[Xx]?\s+\d/);
    if (match) return match[1];
  }
  return '';
}

function policyTableFacts(lines) {
  const header=lines.findIndex((line)=>line.includes('险种名称') && /保险金额|保障计划/.test(line));
  if (header<0) return {};
  const feeHeader=lines.findIndex((line,index)=>index>header && index<header+10 && /^保险费\s*$/.test(line));
  if (feeHeader<0) return {};
  const amountIndex=lines.findIndex((line,index)=>index>feeHeader && index<feeHeader+8 && /^\s*[\d,]+(?:\.\d+)?\s*元/.test(line));
  if (amountIndex<0) return {};
  const name=lines.slice(feeHeader+1,amountIndex).join('').trim();
  const amount=money(lines[amountIndex]);
  const rest=lines.slice(amountIndex,Math.min(amountIndex+8,lines.length)).join(' ');
  const plan=firstValue(rest,/\/\s*(计划[一二三四五六七八九十\d]+)/);
  const annual=firstValue(rest,/(每年\s*[\d,]+(?:\.\d+)?\s*元)/);
  const single=firstValue(rest,/(一次交清\s*[\d,]+(?:\.\d+)?\s*元)/);
  const paymentTerm=firstValue(rest,/\/\s*(\d+\s*年)(?!\d)/) || (rest.includes('一次交清') ? '一次交清' : '');
  const paymentEndDate=dateText(firstValue(rest,/\/\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/));
  const expiryDate=dateText(firstValue(rest,/至\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/));
  return {
    productName:name,
    basicSumInsured:amount ? {label:plan ? `合同保险金额·${plan}` : '基本保险金额',amount} : null,
    premium:annual ? annual.replace(/\s+/g,'') : single ? single.replace(/\s+/g,'') : '',
    paymentTerm,paymentEndDate,expiryDate,plan,
    coveragePeriod:/终身/.test(rest)?'终身':'',
  };
}

export function normalizedPolicyName(value) {
  return compact(value).replace(/保险$/,'');
}

export function extractPolicyContractExportFacts(pages=[]) {
  const schedulePages=(Array.isArray(pages)?pages:[]).slice(0,5);
  const pageLines=schedulePages.map((page)=>({page:Number(page.num)||1,lines:String(page.text || '').split('\n').map((line)=>line.trim()).filter(Boolean)}));
  const schedule=pageLines.find(({lines})=>lines.some((line)=>line.includes('险种名称')) && lines.some((line)=>line.includes('合同生效日期')))
    || pageLines.find(({lines})=>lines.some((line)=>line.includes('险种名称')))
    || pageLines[0];
  if (!schedule) return {};
  const text=schedule.lines.join('\n');
  const identityText=schedule.lines.slice(0,15).join('\n');
  const holder=firstValue(identityText,/(?:投\s*保\s*人)\s*[:：]\s*([\u4e00-\u9fa5]{2,4})(?=\s|身份证|证件|性别|$)/);
  const insuredLine=schedule.lines.find((line)=>/(?:被\s*保\s*险\s*人)\s*[:：]/.test(line) && /身份证|证件/.test(line)) || '';
  const insured=firstValue(insuredLine,/(?:被\s*保\s*险\s*人)\s*[:：]\s*([\u4e00-\u9fa5]{2,4})(?=\s|身份证|证件|性别|$)/);
  const insuredId=firstValue(insuredLine,/(?:身份证|证件号码|证件号)\s*[:：]\s*(\d{17}[\dXx])/);
  const idDemographics=demographicsFromId(insuredId);
  const firstPagesText=pageLines.map(({lines})=>lines.join('\n')).join('\n');
  const sex=firstValue(insuredLine,/性别\s*[:：]\s*([男女])/) ||
    firstValue(firstPagesText,/投保年龄\s*[:：]\s*\d+\s*岁\s*性别\s*[:：]\s*([男女])/) || idDemographics?.sex || '';
  const directProduct=firstValue(text,/险种名称\s*[:：]\s*([^\n]+)/);
  const table=policyTableFacts(schedule.lines);
  const productName=directProduct || table.productName || '';
  const directPremium=firstValue(text,/保险费\s*[:：]\s*((?:每年|每月)?\s*[\d,]+(?:\.\d+)?\s*元)/);
  const directAmount=firstValue(text,/(?:基本保险金额|基本保额)\s*[:：]\s*([\d,]+(?:\.\d+)?\s*元)/);
  const periodText=firstValue(text,/保险期间\s*[:：]\s*([^\n]+)/) || '';
  const effectiveDate=dateText(firstValue(text,/合同生效日期\s*[:：]\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/));
  const paymentTerm=firstValue(text,/交费期间\s*[:：]\s*(\d+\s*年)/) || table.paymentTerm || '';
  const renewalDue=firstValue(text,/续期保险费交费日期\s*[:：]?\s*每年\s*(\d{1,2}\s*月\s*\d{1,2}\s*日)/) ||
    firstValue(text,/每年\s*(\d{1,2}\s*月\s*\d{1,2}\s*日)/);
  const renewalDueMatch=renewalDue.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const expiryDate=table.expiryDate || dateText(firstValue(periodText,/至\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/));
  const coveragePeriod=table.coveragePeriod || (/终身|终生/.test(periodText) ? '终身' : '') ||
    (pageLines.some(({lines})=>lines.some((line)=>/保险年期\s*[:：]\s*终身/.test(line))) ? '终身' : '');
  const company=pageLines.some(({lines})=>lines.some((line)=>line.includes('新华人寿保险股份有限公司')))
    ? '新华人寿保险股份有限公司' : '';
  const result={
    productName,company,holderName:holder,insuredName:insured,beneficiary:beneficiaryFromLines(schedule.lines),
    insuredSex:sex,insuredBirthDate:idDemographics?.birthDate || '',birthDateSource:idDemographics?.birthDate?'身份证校验推得':'',
    effectiveDate,expiryDate,coveragePeriod,paymentTerm,paymentEndDate:table.paymentEndDate,
    renewalDueMonthDay:renewalDueMatch ? `${renewalDueMatch[1].padStart(2,'0')}-${renewalDueMatch[2].padStart(2,'0')}` : '',
    premium:directPremium ? directPremium.replace(/\s+/g,'') : table.premium,
    basicSumInsured:directAmount ? {label:'基本保险金额',amount:money(directAmount)} : table.basicSumInsured,
    plan:table.plan,
  };
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!=='' && value!==null));
}
