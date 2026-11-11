// Count only complete, consecutively numbered disease definitions under a
// contract section explicitly headed as major or minor illness. A few AI
// excerpts or a regulatory reference to "25 diseases" are not a policy count.
export function countPolicyDiseases(pages = []) {
  const source=(Array.isArray(pages)?pages:[]).map((page)=>String(page?.text || '')).join(' ').replace(/\s+/g,' ');
  const headings=[...source.matchAll(/(\d{1,2}\.\d{1,2})\s*本合同所指的\s*(轻症疾病|重大疾病)/g)];
  const result={critical:null,light:null};
  for (const [,section,label] of headings) {
    const escaped=section.replaceAll('.','\\.');
    const numbers=[...source.matchAll(new RegExp(`(?:^|[^\\d.])${escaped}\\.(\\d{1,3})(?!\\d)`, 'g'))]
      .map((match)=>Number(match[1]));
    const unique=new Set(numbers);
    const highest=Math.max(0,...unique);
    if (highest<2 || highest>200 || unique.size!==highest || !unique.has(1)) continue;
    const key=label==='重大疾病'?'critical':'light';
    result[key]=Math.max(result[key] || 0,highest);
  }
  return result;
}
