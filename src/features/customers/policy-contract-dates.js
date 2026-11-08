const DATE_PATTERN=/(?<!\d)((?:19|20)\d{2})\s*(?:年|[./-])\s*(1[0-2]|0?[1-9])\s*(?:月|[./-])\s*(3[01]|[12]\d|0?[1-9])\s*日?/;

function normalizeDate(value) {
  const match=String(value || '').match(DATE_PATTERN);
  if (!match) return '';
  const [,yearText,monthText,dayText]=match;
  const year=Number(yearText),month=Number(monthText),day=Number(dayText);
  const date=new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return '';
  return `${yearText}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function extractPolicyContractDates(policy={}) {
  const coveragePeriod=String(policy.coveragePeriod || '');
  const effectiveDate=normalizeDate(policy.effectiveDate) || normalizeDate(coveragePeriod);
  let expiryDate=normalizeDate(policy.expiryDate);
  if (!expiryDate && !/终身|终生/.test(coveragePeriod)) {
    const endDate=coveragePeriod.match(/(?:至|到)\s*((?:19|20)\d{2}\s*(?:年|[./-])\s*(?:1[0-2]|0?[1-9])\s*(?:月|[./-])\s*(?:3[01]|[12]\d|0?[1-9])\s*日?)/);
    expiryDate=normalizeDate(endDate?.[1]);
  }
  return {
    effectiveDate,
    expiryDate,
    nextPaymentDate:normalizeDate(policy.nextPaymentDate),
    lifetimeCoverage:/终身|终生/.test(coveragePeriod),
  };
}
