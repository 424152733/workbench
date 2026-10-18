export const channelKey = { 知乎: 'zhihu', 小红书: 'xhs', 公众号: 'wechat' };

export const xhsCardRoleOptions = [
  { value:'cover',label:'封面' }, { value:'concept',label:'概念解释' }, { value:'misconception',label:'误区澄清' },
  { value:'checklist',label:'核对清单' }, { value:'boundary',label:'适用边界' }, { value:'summary',label:'总结提醒' },
  { value:'example',label:'示意场景' }, { value:'comparison',label:'对比说明' },
];

export const defaultImageStyles = {
  xhs: { style:'sketch-notes',layout:'auto',palette:'macaron' },
  article: { type:'auto',style:'notion',palette:'macaron' },
};

export const insuranceTypeOptions = ['不限','寿险','健康险','财险','意外险','年金/养老险','综合保险'];
export const defaultXhsImageMode = 'test';

export const wechatHtmlThemes = [
  {value:'clean',label:'清爽简约'},
  {value:'warm',label:'温暖柔和'},
  {value:'editorial',label:'杂志清晰'},
];

export const xhsStyleOptions = [
  ['auto','按内容自动推荐'],['cute','可爱卡通'],['fresh','清新'],['warm','温暖'],['bold','醒目高对比'],['minimal','极简'],['retro','复古'],['pop','波普'],['notion','Notion 手绘'],['chalkboard','黑板粉笔'],['study-notes','学习笔记'],['screen-print','丝网印刷'],['sketch-notes','手绘知识卡'],
].map(([value,label]) => ({value,label:`${label}（${value}）`}));

export const xhsLayoutOptions = [
  ['auto','按内容自动推荐'],['sparse','稀疏：1–2 个重点'],['balanced','均衡：3–4 个重点'],['dense','密集：5–8 个重点'],['list','清单：4–7 项'],['comparison','对比：双栏结构'],['flow','流程：3–6 个步骤'],
].map(([value,label]) => ({value,label:value === 'auto' ? label : `${label}（${value}）`}));

export const articleTypeOptions = [
  ['auto','按文章内容自动推荐'],['infographic','信息图：数据和指标'],['scene','场景图：氛围和故事'],['flowchart','流程图：步骤和工作流'],['comparison','对比图：并列比较'],['framework','框架图：概念和关系'],['timeline','时间线：阶段和进展'],
].map(([value,label]) => ({value,label:value === 'auto' ? label : `${label}（${value}）`}));

export const articleStyleOptions = [
  ['auto','按内容自动推荐'],['notion','极简手绘'],['elegant','精致优雅'],['warm','温暖亲切'],['minimal','极简禅意'],['blueprint','技术蓝图'],['watercolor','柔和水彩'],['editorial','杂志信息图'],['scientific','学术图表'],
].map(([value,label]) => ({value,label:value === 'auto' ? label : `${label}（${value}）`}));

export const paletteOptions = [['auto','按内容自动推荐'],['macaron','马卡龙'],['warm','暖色'],['neon','霓虹']].map(([value,label]) => ({value,label:value === 'auto' ? label : `${label}（${value}）`}));
