import { demoXhsCardPlan } from './content-prompts.js';

export function demoDrafts(topicTitle) {
  const plainTitle = String(topicTitle || '家庭保障常见问题').replace(/[？?]$/, '');
  const core = `先说简单一点：${plainTitle}，要结合具体保险合同来看。不同产品的约定可能不一样，不能只凭一句宣传语或一个数字下结论。\n\n看自己的保单时，先找“保险责任”“责任免除”和相关定义，再核对适用条件、时间范围和需要提交的材料。\n\n如果条款里有看不懂的地方，可以把具体条款交给保险公司或服务人员解释。本文只讲一般概念，具体保障和处理结果以保险合同及保险公司正式文件为准。`;
  return {
    '知乎': { title: plainTitle, summary: '', body: `先给结论：${plainTitle}要结合具体保险合同判断，不能只凭产品名称或一句宣传语下结论。\n\n理解这个问题，可以先分清合同约定的保障责任，以及责任免除和适用条件。它们分别说明哪些情形可能获得保障、哪些情形不在范围内，以及相关责任在什么条件下适用。\n\n核对时，可以先找到合同中的定义和保险责任，再看时间、保障对象、费用范围及其他限制。如果涉及申请待遇或理赔，还要结合具体情况和正式材料核实。\n\n不同产品和合同的写法可能不同。遇到不确定的条款，可以向保险公司或相关服务人员确认。本文用于解释一般概念，不替代对个人合同或具体理赔情况的判断。`, hashtags: '', sources: '' },
    '小红书': { title: `${plainTitle}，大白话说清楚`, summary: '', body: `买保险时遇到“${plainTitle}”？先记住：别只看产品名字，要回到自己的合同核对。\n\n重点找保险责任、责任免除和适用条件。不同产品约定可能不同，具体以正式合同为准。`, hashtags: '大话保险 保险科普 买保险前先看', sources: '', cardPlan:demoXhsCardPlan(plainTitle,core) },
    '公众号': { title: `大话保险｜${plainTitle}`, summary: '用普通人听得懂的话，讲清保险里的常见说法。', body: `买保险或整理保单时，很多人会遇到“${plainTitle}”这样的说法。只看产品名称或宣传页，往往不够判断具体保障。真正需要核对的，是合同中写明的保障责任、责任免除和适用条件。\n\n## 先弄清合同在说什么\n\n保险条款会说明哪些对象、费用或情形可能纳入保障，也会写明不承担责任的情况和适用限制。遇到不熟悉的词，先看合同里的定义，再结合相关责任理解，不要只凭日常词义猜测。\n\n## 对照自己的情况逐项核对\n\n可以先找出与问题相关的条款，再核对保障对象、时间范围、费用或情形、申请条件和需要准备的材料。若问题涉及报销或理赔，还需要结合实际情况、正式材料及保险公司的处理规则确认。\n\n## 产品名称相似，约定也可能不同\n\n不同产品、不同版本或不同责任的写法可能不同。某个常见说法不能直接代替合同结论；也不能仅凭“买过保险”推定某项责任一定适用。\n\n遇到看不懂的内容，可以把具体条款向保险公司或相关服务人员核实。本文只介绍一般梳理方法，不构成对具体产品的承保或理赔判断；实际保障以保险合同和保险公司正式文件为准。`, hashtags: '', sources: '' },
  };
}

export function getResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return (payload?.output || []).flatMap((item) => item.content || []).filter((part) => part.type === 'output_text' || part.type === 'text').map((part) => part.text || '').join('\n');
}

export const runwareTextModel = () => process.env.RUNWARE_TEXT_MODEL || 'openai:gpt@6-luna';
const stepMarkers = new Map([
  ['一','①'],['二','②'],['三','③'],['四','④'],['五','⑤'],['六','⑥'],['七','⑦'],['八','⑧'],['九','⑨'],['十','⑩'],
  ['1','①'],['2','②'],['3','③'],['4','④'],['5','⑤'],['6','⑥'],['7','⑦'],['8','⑧'],['9','⑨'],['10','⑩'],
]);

export function cleanGeneratedCopy(value) {
  return String(value || '')
    .replaceAll('**','')
    .replace(/(^|\n)([\t ]*)第(一|二|三|四|五|六|七|八|九|十|10|[1-9])\s*步(?:[：:、，,][\t ]*)?/g,(_match,line,indent,number) => `${line}${indent}${stepMarkers.get(number)} `)
    .replace(/(^|\n)([\t ]*)(1[.)、]|[2-9][.)、]|10[.)、])\s*/g,(_match,line,indent,number) => `${line}${indent}${stepMarkers.get(number.replace(/[.)、]/g,''))} `);
}

export function cleanXhsCardPlan(cardPlan) {
  return (cardPlan || []).map((card) => ({
    ...card,
    headline:cleanGeneratedCopy(card.headline),
    keyPoints:card.keyPoints.map(cleanGeneratedCopy),
    visualDirection:cleanGeneratedCopy(card.visualDirection),
  }));
}
