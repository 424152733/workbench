import { BadRequestException } from '@nestjs/common';

export const CHANNELS = ['知乎', '小红书', '公众号'];
export const INSURANCE_TYPES = ['寿险','健康险','财险','意外险','年金/养老险','综合保险'];
export const TOPIC_CATEGORIES = ['保险基础','误区澄清','条款翻译','办事指南'];
export const DEFAULT_IMAGE_STYLES = {
  xhs: { style:'sketch-notes',layout:'auto',palette:'macaron' },
  article: { type:'auto',style:'notion',palette:'macaron' },
};
export const DEFAULT_WECHAT_THEME = 'clean';
export const DEFAULT_XHS_IMAGE_MODE = 'test';
export const XHS_IMAGE_MODES = new Set(['test','production']);
export const WECHAT_THEMES = new Set(['clean','warm','editorial']);
export const IMAGE_STYLE_OPTIONS = {
  xhs: {
    style: new Set(['auto','cute','fresh','warm','bold','minimal','retro','pop','notion','chalkboard','study-notes','screen-print','sketch-notes']),
    layout: new Set(['auto','sparse','balanced','dense','list','comparison','flow']),
    palette: new Set(['auto','macaron','warm','neon']),
  },
  article: {
    type: new Set(['auto','infographic','scene','flowchart','comparison','framework','timeline']),
    style: new Set(['auto','notion','elegant','warm','minimal','blueprint','watercolor','editorial','scientific']),
    palette: new Set(['auto','macaron','warm','neon']),
  },
};
export const STAGES = ['新线索', '已联系', '需求了解中', '已成交', '已有客户', '暂缓跟进'];
export const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
export const normalizePolicyNumber = (value) => String(value || '').replace(/\s/g, '');
export const cleanText = (value,label,max,{required=false}={}) => {
  const text = String(value ?? '').trim();
  if (required && !text) throw new BadRequestException(`请填写${label}`);
  if (text.length > max) throw new BadRequestException(`${label}不能超过 ${max} 个字`);
  return text;
};

const dateInBeijing = new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
});
const datePartsInBeijing = (value) => Object.fromEntries(
  dateInBeijing.formatToParts(value).filter((part) => part.type !== 'literal').map(({type,value:partValue}) => [type,partValue]),
);
export const addCalendarDays = (date,days) => {
  const [year,month,day] = date.split('-').map(Number);
  return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);
};

export const maskPhone = (value) => {
  const digits = normalizePhone(value);
  if (digits.length < 7) return value || '未填写';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
};
export const maskPolicyNumber = (value) => {
  const raw = String(value || '').replace(/\s/g,'');
  if (raw.length < 8) return raw || '未填写';
  return `${raw.slice(0,3)}****${raw.slice(-4)}`;
};
export const displayWhen = (value) => {
  if (!value) return '未安排';
  const date = dateOnly(value);
  if (!date) return String(value);
  const today = beijingDate();
  if (date === today) return '今天';
  if (date === addCalendarDays(today,1)) return '明天';
  const [,month,day] = date.split('-').map(Number);
  return `${month}/${day}`;
};
export const dateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = datePartsInBeijing(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const strictDate = (value,label='跟进日期') => {
  if (!value) throw new BadRequestException(`请填写${label}`);
  const text = typeof value === 'string' ? value : dateOnly(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text || '') ? new Date(`${text}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== text) {
    throw new BadRequestException(`${label}格式无效`);
  }
  return text;
};
export const optionalTime = (value) => {
  if (!value) return null;
  const text = String(value).slice(0,5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new BadRequestException('跟进时间格式无效');
  return text;
};
export const pgDate = (value) => value instanceof Date
  ? dateOnly(value)
  : String(value || '').slice(0,10);
export const pgTime = (value) => value ? String(value).slice(0,5) : null;
export const beijingDate = (value=new Date()) => {
  const parts = datePartsInBeijing(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const taskWhen = (date,time) => {
  const today = beijingDate();
  const tomorrow = addCalendarDays(today,1);
  const label = date === today ? '今天' : date === tomorrow ? '明天' : `${Number(date.slice(5,7))} 月 ${Number(date.slice(8,10))} 日`;
  return `${label}${time ? ` ${time}` : ''}`;
};
export const beijingMonthStart = () => `${beijingDate().slice(0,7)}-01`;
export const boolArray = (value) => Array.isArray(value) ? value.map(Boolean).slice(0, 3).concat([false, false, false]).slice(0, 3) : [false, false, false];
