export const CONTENT_TYPES = Object.freeze([
  {code:'insurance_education',name:'大话保险',description:'保险知识科普、常见误区和办理事项'},
  {code:'product_explainer',name:'产品解读',description:'依据产品中心已确认资料解读具体产品'},
  {code:'customer_case',name:'客户案例',description:'通过脱敏案例说明需求分析和保障思路'},
]);

export const CONTENT_TYPE_RULES = Object.freeze({
  insurance_education:['用大白话解释保险','先回答读者问题','不编造案例、数字和个人经历','关键事实注明来源','免责和适用边界讲清楚'],
  product_explainer:['仅依据当前选定产品的已确认资料生成','保持产品名称、版本和适用条件准确','讲清保障内容、限制条件和需要核对的事项','资料没有明确说明的内容标为“待核实”，不自行补全','不承诺收益或理赔结果，不把产品说成适合所有人'],
  customer_case:['只使用已授权且完成脱敏的案例材料','不出现姓名、电话、保单号等身份信息','不补造未确认的经历、金额、对话或处理结果','明确区分真实案例、综合案例和情景示例','说明结论只适用于案例所述情况，不泛化为普遍结果'],
});

export const CASE_KIND_NAMES = Object.freeze({authorized_real:'经授权真实案例',composite:'综合案例',scenario:'情景示例'});
