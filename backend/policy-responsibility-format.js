const text = (value) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const displayText = (value) => text(value).replace(/身故保险金/g, '身价金');
const width = (value) => [...value].reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 2 : 1), 0);
const countNumber = (value) => ({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10})[value] || value;

// The extraction keeps the original clause wording. Only shorten repeated
// insurance terms in the customer-facing sheet; never infer a payout amount.
const concise = (value) => displayText(value)
  .replace(/实际交纳的?保险费/g, '已交保费')
  .replace(/已交保险费/g, '已交保费')
  .replace(/基本保险金额/g, '基本保额')
  .replace(/意外伤害以外(?:的)?原因/g, '非意外原因')
  .replace(/因意外以外原因/g, '因非意外原因')
  .replace(/因意外伤害或/g, '因意外或')
  .replace(/意外伤害或/g, '意外或')
  .replace(/生效或最后一次复效之日起/g, '生效/复效')
  .replace(/生效或最后复效之日起/g, '生效/复效')
  .replace(/初次患(?:本)?(?:附加)?合同所列的?/g, '初次患约定')
  .replace(/年满(\d+)周岁/g, '$1岁')
  .replace(/未满(\d+)周岁/g, '未满$1岁')
  .replace(/(\d+)周岁/g, '$1岁')
  .replace(/每种(轻症|中症)?疾病只给付一次/g, '每种限1次')
  .replace(/每种(轻症|中症)?一次/g, '每种限1次')
  .replace(/累计([一二两三四五六七八九十])次/g, (_, count) => `最多${countNumber(count)}次`)
  .replace(/给付次数以一次为限/g, '限给付1次')
  .replace(/累计给付以([一二两三四五六七八九十])次为限/g, (_, count) => `最多给付${countNumber(count)}次`)
  .replace(/同时合同及附加合同终止/g, '主附合同终止')
  .replace(/给付后附加合同及主合同终止/g, '主附合同终止')
  .replace(/不含(?:身故|全残)前欠交保险费和利息、宽限期内应交未交保险费、其他保险合同保险费/g, '不含此前欠费及利息、宽限期未交费和其他保单保费')
  .replace(/被保险人(?=身故时|全残时)/g, '')
  .replace(/本附加合同/g, '附加合同')
  .replace(/本合同/g, '合同')
  .replace(/[；;，,。\s]+$/g, '');

const clauses = (value) => concise(value).split(/[；;。]/).map((part) => part.trim()).filter(Boolean);
const unique = (parts) => {
  const result = [];
  for (const part of parts.flatMap(clauses)) {
    if (result.some((saved) => saved === part || saved.includes(part))) continue;
    const shorter = result.findIndex((saved) => part.includes(saved));
    if (shorter >= 0) result.splice(shorter, 1);
    result.push(part);
  }
  return result;
};

const materialNote = (part) => /分组|组别|间隔|共用|合计|上限|免赔|报销|赔付比例|等待期|择一|限额|保证给付|继续有效|同时给付/.test(part);
const scenarioMarker = (index) => '①②③④⑤⑥⑦⑧⑨'[index] || '·';

const neutralLifeDisability = (value) => concise(value)
  .replace(/身价金|全残保险金/g, '相应保险金')
  .replace(/身故|全残/g, '相应情形');
const pairedLifeDisability = (value) => {
  const phrase = concise(value);
  if (/^与全残保险金仅给付其中一项$/.test(phrase)) return '身故与全残仅给付其一';
  return phrase.replace(/身故时/g, '发生时').replace(/身故/g, '身故或全残');
};

function sameLifeDisabilityPayout(first, second) {
  if (concise(first?.name) !== '身价金' || concise(second?.name) !== '全残保险金') return false;
  const left = Array.isArray(first.scenarios) ? first.scenarios.filter((item) => item.evidenceVerified) : [];
  const right = Array.isArray(second.scenarios) ? second.scenarios.filter((item) => item.evidenceVerified) : [];
  if (!left.length || left.length !== right.length) return false;
  if (first.amount && second.amount && neutralLifeDisability(first.amount) !== neutralLifeDisability(second.amount)) return false;
  return left.every((scenario, index) => ['trigger', 'amount', 'limit', 'conditions', 'relation'].every((field) =>
    neutralLifeDisability(scenario[field]) === neutralLifeDisability(right[index][field])));
}

function groupedBenefits(benefits) {
  const result = [];
  for (let index = 0; index < benefits.length; index++) {
    const benefit = benefits[index];
    const next = benefits[index + 1];
    if (!sameLifeDisabilityPayout(benefit, next)) { result.push(benefit); continue; }
    result.push({
      ...benefit,
      name:'身价金/全残保险金',
      summary:'',conditions:'',
      scenarios:benefit.scenarios.map((scenario) => Object.fromEntries(Object.entries(scenario).map(([key, value]) =>
        [key, typeof value === 'string' && ['trigger', 'amount', 'limit', 'conditions', 'relation'].includes(key)
          ? pairedLifeDisability(value) : value]))),
    });
    index++;
  }
  return result;
}

function conciseScenarioDetails(details, trigger, amount) {
  const uniqueDetails = unique(details).filter((part) => !`${trigger}；${amount}`.includes(part));
  return uniqueDetails.filter((part) => {
    if (/给付后该种.*责任终止/.test(part) && uniqueDetails.some((other) => /每种限1次/.test(other))) return false;
    if (/同时符合.*仅承担/.test(part) && uniqueDetails.some((other) => /择一/.test(other))) return false;
    if (/与.*责任择一终止/.test(part) && uniqueDetails.some((other) => /给付后.*责任终止/.test(other))) return false;
    if (/首次重疾后继续承担其他组别责任/.test(part) && /其他组别/.test(trigger)) return false;
    return true;
  });
}

function distinctNotes(benefit, scenarioText, maxNotes, materialOnly = true) {
  const candidates = unique([benefit.summary, benefit.conditions, benefit.paymentMethod]);
  return candidates.filter((part) => (!materialOnly || materialNote(part)) &&
    !scenarioText.includes(part) &&
    !/^(按条款给付|一次给付|按约定给付|费用补偿|豁免|先扣已补偿费用)$|请核对具体条款|满足合同约定的发生条件时给付/.test(part) &&
    !(/按基本保额比例给付/.test(part) && /基本保额/.test(scenarioText) && /最多给付\d+次/.test(scenarioText)) &&
    !(/同时给付.*限一次/.test(part) && /同时给付/.test(scenarioText) && /限给付1次/.test(scenarioText)) &&
    !(/间隔180日/.test(part) && /间隔180日/.test(scenarioText)))
    .map((part) => /豁免.*合同继续有效/.test(part) && /豁免/.test(scenarioText) ? '合同继续有效' : part)
    .slice(0, maxNotes);
}

export function responsibilityLines(record = {}) {
  const benefits = Array.isArray(record.benefits) ? groupedBenefits(record.benefits.filter((item) => !/宣告死亡/.test(text(item?.name)))) : [];
  if (!benefits.length) {
    const summary = concise(record.extraction?.policy?.claimSummary || record.coverageSummary);
    return [summary ? `保障责任摘要待核对：${summary}` : '本次未提取到保障责任明细；请更新整理结果或人工补充。'];
  }
  const lines = [];
  for (const [index, benefit] of benefits.entries()) {
    const name = concise(benefit.name) || '保障责任';
    const count = /^(?:轻症|轻度疾病)(?:疾病)?保险金$/.test(name) ? record.diseaseCounts?.light
      : /^(?:重大疾病|重疾)(?:疾病)?保险金$/.test(name) ? record.diseaseCounts?.critical : null;
    const displayName = Number.isSafeInteger(count) && count > 0 ? `${count}种${name}` : name;
    const heading = `${index + 1}、${displayName}`;
    const scenarios = Array.isArray(benefit.scenarios) ? benefit.scenarios.filter((item) => item.evidenceVerified) : [];
    const amount = concise(benefit.amount || benefit.main);
    if (/医疗费用保险金/.test(name) && /年度限额/.test(amount) && benefit.summary) {
      const notes = unique([benefit.summary]).filter((part) => !amount.includes(part)).slice(0, 2);
      lines.push(`${heading}：${amount}${notes.length ? `；${notes.join('；')}` : ''}`);
      continue;
    }
    if (scenarios.length) {
      const scenarioDetails = scenarios.map((scenario) => conciseScenarioDetails(
        [scenario.limit, scenario.conditions, scenario.relation], concise(scenario.trigger), concise(scenario.amount)));
      const sharedDetails = scenarioDetails.length > 1 ? scenarioDetails[0].filter((part) => scenarioDetails.every((details) => details.includes(part))) : [];
      const scenarioLines = scenarios.map((scenario, scenarioIndex) => {
        const trigger = concise(scenario.trigger);
        const amount = concise(scenario.amount) || '金额待核对';
        const details = scenarioDetails[scenarioIndex].filter((part) => !sharedDetails.includes(part));
        return `${scenarioMarker(scenarioIndex)}${trigger ? `${trigger}：` : ''}${amount}${details.length ? `；${details.join('；')}` : ''}`;
      });
      const notes = distinctNotes(benefit, `${scenarioLines.join('；')}；${sharedDetails.join('；')}`, 1);
      if (scenarios.length === 1) {
        const scenario = scenarios[0];
        const amount = concise(scenario.amount) || '金额待核对';
        const trigger = concise(scenario.trigger);
        const details = conciseScenarioDetails([scenario.limit, scenario.conditions, scenario.relation], trigger, amount);
        const condition = unique([trigger, ...details]);
        lines.push(`${heading}：${amount}${condition.length ? `（${condition.join('；')}）` : ''}`);
      }
      else {
        const medicalCap = /医疗费用保险金/.test(name) && /限额/.test(amount) ? amount : '';
        lines.push(`${heading}${medicalCap ? `：${medicalCap}` : '：'}`);
        lines.push(...scenarioLines.filter((line) => !medicalCap || !/计划一.*计划二.*计划三/.test(line)).map((line) => `  ${line}`));
      }
      if (sharedDetails.length) lines.push(`  共同条件：${sharedDetails.join('；')}`);
      if (notes.length) lines.push(`  补充：${notes.join('；')}`);
      continue;
    }
    const notes = distinctNotes(benefit, amount, 2, false);
    lines.push(`${heading}${amount || notes.length ? '：' : ''}${amount}${notes.length ? `${amount ? '；' : ''}${notes.join('；')}` : ''}`);
  }
  return lines;
}

// Keep all responsibilities in the policy's own cell. Excel limits a row to
// 409.5 pt, so long contracts also get a cell note for convenient reading.
export function responsibilityBlocks(record = {}, maxHeight = 405) {
  const lines=responsibilityLines(record);
  const text=lines.join('\n');
  for (const fontSize of [9,8.5,8,7.5,7]) {
    const availableWidth=80*9/fontSize;
    const visualLines=lines.reduce((sum,line)=>sum+Math.max(1,Math.ceil(width(line)/availableWidth)),0);
    const estimatedHeight=16+visualLines*fontSize*1.55;
    if (estimatedHeight<=maxHeight) return [{text,height:Math.max(78,Math.ceil(estimatedHeight)),fontSize,overflow:false}];
  }
  return [{text,height:maxHeight,fontSize:7,overflow:true}];
}
