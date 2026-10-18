export const contractStatusOptions = [
  {value:'unknown',label:'待确认'},
  {value:'pending_effective',label:'待生效'},
  {value:'active',label:'保障中'},
  {value:'suspended',label:'效力中止'},
  {value:'expired',label:'已到期'},
  {value:'terminated',label:'已终止'},
];

export const serviceKindOptions = [
  {value:'renewal',label:'续保'},
  {value:'payment',label:'缴费'},
  {value:'endorsement',label:'保全'},
  {value:'claim_inquiry',label:'理赔咨询'},
  {value:'other',label:'其他'},
];

export const serviceStatusOptions = [
  {value:'pending',label:'待处理'},
  {value:'in_progress',label:'处理中'},
  {value:'waiting_customer',label:'待客户反馈'},
  {value:'waiting_insurer',label:'待保险公司反馈'},
  {value:'completed',label:'已完成'},
  {value:'cancelled',label:'已取消'},
];

export const optionLabel = (options,value) => options.find((item) => item.value === value)?.label || value || '待确认';
export const serviceIsOpen = (status) => ['pending','in_progress','waiting_customer','waiting_insurer'].includes(status);
