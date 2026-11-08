import { CASE_KIND_NAMES } from '../src/features/content/content-types.js';

function labelPrefix(caseKind) {
  if (!['composite','scenario'].includes(caseKind)) return '';
  return `【${CASE_KIND_NAMES[caseKind]}】`;
}

export function ensureCaseKindLabels({caseKind,body = '',cardPlan = []}) {
  const label = labelPrefix(caseKind);
  if (!label) return {body:String(body || ''),cardPlan:Array.isArray(cardPlan) ? cardPlan : []};
  const normalizedBody = String(body || '').trim();
  const nextBody = normalizedBody.startsWith(label) ? normalizedBody : `${label}\n\n${normalizedBody}`;
  const nextCardPlan = Array.isArray(cardPlan) ? cardPlan.map((card,index) => {
    if (index !== 0 || !card || typeof card !== 'object') return card;
    const headline = String(card.headline || '').trim();
    if (headline.startsWith(label)) return card;
    const suffix = headline.replace(/^【(?:综合案例|情景示例)】\s*[｜|：:]?\s*/,'');
    return {...card,headline:`${label}｜${suffix}`.slice(0,60)};
  }) : [];
  return {body:nextBody,cardPlan:nextCardPlan};
}

export function hasCaseKindLabels({caseKind,body = '',platform,cardPlan = []}) {
  const label = labelPrefix(caseKind);
  if (!label) return true;
  if (!String(body || '').trimStart().startsWith(label)) return false;
  if (platform !== '小红书' || !Array.isArray(cardPlan) || !cardPlan.length) return true;
  return String(cardPlan?.[0]?.headline || '').trimStart().startsWith(label);
}
