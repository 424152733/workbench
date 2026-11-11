// Only produce a concise liability summary when the matching clauses and
// benefit schedule are present in the uploaded original contract.
export function contractResponsibilities(pages = [], facts = {}) {
  const page = (number) => String(pages.find((item) => Number(item.num) === number)?.text || '');
  const name = String(facts.productName || '').replace(/\s+/g, '');
  const basicAmount = Number(String(facts.basicSumInsured?.amount || '').replace(/[^\d.]/g, ''));
  const displayMoney = (amount) => Number.isFinite(amount) && amount > 0
    ? amount % 10000 === 0 ? `${amount / 10000}万元` : `${amount.toLocaleString('zh-CN')}元` : '';
  const basicText = displayMoney(basicAmount) || '基本保额';
  const lightText = displayMoney(basicAmount * 0.2);
  const careText = displayMoney(basicAmount * 0.5);
  const clause5 = page(5);
  const clause6 = page(6);
  const clause7 = page(7);
  const verifiedScenario = (trigger,amount,extra={}) => ({trigger,amount,...extra,evidenceVerified:true});

  if (name.includes('健康无忧C款重大疾病保险') &&
      /2\.3\.1[\s\S]*轻[\s\S]*症/.test(clause5) &&
      clause5.includes('180 日') && clause5.includes('20%') &&
      clause5.includes('1.1 倍') && clause5.includes('身故保险金')) {
    return [
      {name:'轻症疾病保险金',main:`轻症：基本保额20%${lightText ? `（本单${lightText}）` : ''}`,amount:`基本保额的20%${lightText ? `（本单${lightText}）` : ''}`,paymentMethod:'一次给付',
        summary:'给付后轻症责任终止，合同继续有效。',page:'5',scenarios:[
          verifiedScenario('180日内因疾病确诊','不承担轻症保险金'),
          verifiedScenario('因意外或180日后确诊',`基本保额20%${lightText ? `（本单${lightText}）` : ''}`),
        ]},
      {name:'重大疾病保险金',main:`重疾：${basicText}或实交保费1.1倍，依发生情形确定`,amount:`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}或实交保费的1.1倍`,paymentMethod:'一次给付',
        summary:'给付后合同终止。',page:'5',scenarios:[
          verifiedScenario('180日内因疾病确诊','实际交纳保费的1.1倍'),
          verifiedScenario('因意外或180日后确诊',`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}`),
        ]},
      {name:'身故保险金',main:`身故：${basicText}或实交保费1.1倍，依发生情形确定`,amount:`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}或实交保费的1.1倍`,paymentMethod:'一次给付',
        summary:'给付后合同终止。',page:'5',scenarios:[
          verifiedScenario('180日内因疾病身故','实际交纳保费的1.1倍'),
          verifiedScenario('因意外或180日后身故',`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}`),
        ]},
    ];
  }

  if (name.includes('多倍保障重大疾病保险') &&
      clause5.includes('单一组别给付限额') && clause5.includes('90 日') &&
      clause6.includes('重大疾病保险金') && clause6.includes('身故保险金') &&
      clause6.includes('85 周岁保单生效对应日') &&
      clause7.includes('前 10 年关爱') && clause7.includes('特定严重疾病保险金') &&
      clause7.includes('50%') && clause7.includes('20%')) {
    return [
      {name:'轻症疾病保险金',main:`轻症：基本保额20%${lightText ? `（本单${lightText}）` : ''}，受分组限额约束`,amount:`基本保额的20%${lightText ? `（本单${lightText}）` : ''}`,paymentMethod:'按次给付',
        summary:'每项轻症限一次，受分组和累计限额约束。',page:'5',scenarios:[
          verifiedScenario('90日内因疾病确诊','不承担轻症保险金'),
          verifiedScenario('因意外或90日后确诊',`基本保额20%${lightText ? `（本单${lightText}）` : ''}`),
        ]},
      {name:'重大疾病保险金',main:'重疾：依基本保额、分组余额及累计给付额计算',amount:'依基本保额、分组余额及已给付金额计算',paymentMethod:'按条款给付',
        summary:'受分组及累计限额约束；两次重疾须满足约定间隔。',page:'5–6',scenarios:[
          verifiedScenario('90日内因疾病确诊','实际交纳保费的1.1倍',{conditions:'给付后合同终止'}),
          verifiedScenario('因意外或90日后确诊，且未到85周岁对应日',`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}与该疾病组别剩余额度，取较小者`),
          verifiedScenario('85周岁对应日及以后确诊',`基本保额${displayMoney(basicAmount) ? `（本单${basicText}）` : ''}减去累计已给付的疾病保险金`),
        ]},
      {name:'身故保险金',main:'身故：实交保费1.1倍或基本保额扣减已给付疾病保险金',amount:'实交保费的1.1倍或基本保额扣减已给付疾病保险金',paymentMethod:'一次给付',
        summary:'给付后合同终止。',page:'6',scenarios:[
          verifiedScenario('90日内因疾病身故','实际交纳保费的1.1倍'),
          verifiedScenario('90日内因意外或90日后身故','基本保额扣减累计已给付的疾病保险金'),
        ]},
      {name:'前10年关爱保险金',main:'前10年关爱：符合条件的重疾或身故，附加基本保额50%',amount:`基本保额的50%${careText ? `（本单${careText}）` : ''}`,paymentMethod:'附加给付',
        summary:'前10年符合条件的重疾或身故时同时给付，限一次。',page:'7'},
      {name:'特定严重疾病保险金',main:'特定严重疾病：符合条件时附加基本保额20%',amount:`基本保额的20%${lightText ? `（本单${lightText}）` : ''}`,paymentMethod:'附加给付',
        summary:'重疾给付成立且符合特定严重疾病时同时给付，限一次。',page:'7'},
      {name:'豁免保险费',main:'保费豁免：满足累计给付条件后免交后续保费',amount:'后续保险费',paymentMethod:'豁免',
        summary:'交费期内疾病保险金累计达到基本保额时，免交后续保费；合同继续有效。',page:'7'},
    ];
  }

  const schedule = page(3);
  const planTable = page(26);
  if (name.includes('康健华尊医疗保险') && facts.plan === '计划二' &&
      schedule.includes('计划二') && planTable.includes('计划二') &&
      /保险金额\s+200\s*万\s+400\s*万/.test(planTable) &&
      /一般医疗费\s*用保险金\s+100\s*万\s+200\s*万/.test(planTable) &&
      /特定疾病医\s*疗费用保险金\s+200\s*万\s+400\s*万/.test(planTable) &&
      page(4).includes('一般医疗费用保险金') &&
      clause5.includes('年度免赔额为 10000 元') &&
      clause6.includes('累计给付的一般医疗费用保险金和特定疾病医疗费用保险金之和')) {
    return [
      {name:'一般医疗费用保险金',main:'一般医疗：年度限额200万元，年度免赔额1万元',amount:'年度限额200万元（计划二）',paymentMethod:'费用补偿',
        summary:'包括住院和住院前后门急诊合理医疗费用，共用一般医疗限额；年度免赔额1万元。',page:'4–5、26'},
      {name:'特定疾病医疗费用保险金',main:'特定疾病医疗：年度限额400万元',amount:'年度限额400万元（计划二）',paymentMethod:'费用补偿',
        summary:'包括特定疾病住院、特殊门诊、住院前后门急诊及质子重离子医疗费用，共用特定疾病医疗限额。',page:'5–6、26'},
      {name:'年度总给付上限',main:'年度总给付：两项合计不超过400万元',amount:'两项合计不超过400万元/年（计划二）',paymentMethod:'共用上限',
        summary:'一般医疗与特定疾病医疗的实际给付合计不超过本合同保险金额；两个分项限额不可直接相加。',page:'3、6、26'},
      {name:'赔付条件',main:'赔付比例：通常100%；未按医保身份结算通常60%',amount:'按实际合理费用计算',paymentMethod:'先扣已补偿费用',
        summary:'符合条款时通常按100%比例计算；以医保身份投保但未按医保身份就医结算时通常为60%，并受等待期等约定限制。',page:'4–6'},
    ];
  }
  return [];
}
