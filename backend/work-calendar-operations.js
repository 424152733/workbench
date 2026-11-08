import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { addCalendarDays, cleanText, optionalTime, strictDate } from './workbench-primitives.js';

const EVENT_CATEGORIES = new Set(['客户活动','客户服务','团队事项','培训学习','其他']);
const EVENT_STATUSES = new Set(['planned','in_progress','completed','cancelled']);
const EVENT_SELECT = `
  SELECT id,series_id,repeat_until,title,category,start_date,end_date,start_time,end_time,status,note,created_at,updated_at
  FROM work_calendar_events
`;

const eventView = (row) => ({
  id:String(row.id),
  seriesId:row.series_id || null,
  repeatUntil:row.repeat_until || null,
  title:row.title,
  category:row.category,
  startDate:String(row.start_date).slice(0,10),
  endDate:String(row.end_date).slice(0,10),
  startTime:row.start_time ? String(row.start_time).slice(0,5) : null,
  endTime:row.end_time ? String(row.end_time).slice(0,5) : null,
  status:row.status,
  note:row.note,
  createdAt:row.created_at,
  updatedAt:row.updated_at,
});

const normalizedCategory = (value) => {
  const category = String(value || '客户活动').trim();
  if (!EVENT_CATEGORIES.has(category)) throw new BadRequestException('事件类型无效');
  return category;
};

const normalizedStatus = (value) => {
  const status = String(value || 'planned').trim();
  if (!EVENT_STATUSES.has(status)) throw new BadRequestException('事件状态无效');
  return status;
};

const normalizedTimes = (startValue,endValue) => {
  const startTime = optionalTime(startValue);
  const endTime = optionalTime(endValue);
  if (endTime && !startTime) throw new BadRequestException('填写结束时间时，请同时填写开始时间');
  if (startTime && endTime && endTime < startTime) throw new BadRequestException('结束时间不能早于开始时间');
  return {startTime,endTime};
};

export class WorkCalendarOperations {
  async listWorkCalendarEvents(month) {
    const monthText = String(month || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthText)) throw new BadRequestException('月份格式应为 YYYY-MM');
    const monthStart = strictDate(`${monthText}-01`,'日历月份');
    const { rows } = await this.db.query(`${EVENT_SELECT}
      WHERE start_date < ($1::date + INTERVAL '1 month')::date AND end_date >= $1::date
      ORDER BY start_date,start_time NULLS LAST,id`,[monthStart]);
    return rows.map(eventView);
  }

  async createWorkCalendarEvent(body={}) {
    const title = cleanText(body.title,'事件名称',120,{required:true});
    const category = normalizedCategory(body.category);
    const startDate = strictDate(body.startDate,'开始日期');
    const endDate = strictDate(body.endDate || body.startDate,'结束日期');
    if (endDate < startDate) throw new BadRequestException('结束日期不能早于开始日期');
    const { startTime,endTime } = normalizedTimes(body.startTime,body.endTime);
    const status = normalizedStatus(body.status);
    const note = cleanText(body.note,'备注',1000);
    const repeat = body.repeat || 'none';
    if (!['none','weekly'].includes(repeat)) throw new BadRequestException('重复方式无效');
    const repeatUntil = repeat === 'weekly' ? strictDate(body.repeatUntil,'重复结束日期') : null;
    if (repeatUntil && repeatUntil < startDate) throw new BadRequestException('重复结束日期不能早于开始日期');

    const occurrences = [startDate];
    if (repeat === 'weekly') {
      while (true) {
        const next = addCalendarDays(occurrences.at(-1),7);
        if (next > repeatUntil) break;
        if (occurrences.length >= 53) throw new BadRequestException('每周重复最多创建 53 次');
        occurrences.push(next);
      }
    }
    const seriesId = repeat === 'weekly' ? randomUUID() : null;
    const duration = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
    const created = await this.db.transaction(async (client) => {
      const rows = [];
      for (const occurrenceStart of occurrences) {
        const occurrenceEnd = addCalendarDays(occurrenceStart,duration);
        const result = await client.query(`
          INSERT INTO work_calendar_events(series_id,repeat_until,title,category,start_date,end_date,start_time,end_time,status,note)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          RETURNING id,series_id,repeat_until,title,category,start_date,end_date,start_time,end_time,status,note,created_at,updated_at`,
        [seriesId,repeatUntil,title,category,occurrenceStart,occurrenceEnd,startTime,endTime,status,note]);
        rows.push(eventView(result.rows[0]));
      }
      return rows;
    });
    return { events:created,seriesId };
  }

  async updateWorkCalendarEvent(eventId,body={}) {
    if (!/^\d+$/.test(String(eventId || '')) || Number(eventId) <= 0) throw new BadRequestException('事件编号无效');
    const currentResult = await this.db.query(`${EVENT_SELECT} WHERE id=$1`,[eventId]);
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundException('找不到这条日历事件');
    const title = body.title === undefined ? current.title : cleanText(body.title,'事件名称',120,{required:true});
    const category = body.category === undefined ? current.category : normalizedCategory(body.category);
    const startDate = body.startDate === undefined ? String(current.start_date).slice(0,10) : strictDate(body.startDate,'开始日期');
    const endDate = body.endDate === undefined ? String(current.end_date).slice(0,10) : strictDate(body.endDate,'结束日期');
    if (endDate < startDate) throw new BadRequestException('结束日期不能早于开始日期');
    const { startTime,endTime } = normalizedTimes(
      body.startTime === undefined ? current.start_time : body.startTime,
      body.endTime === undefined ? current.end_time : body.endTime,
    );
    const status = body.status === undefined ? current.status : normalizedStatus(body.status);
    const note = body.note === undefined ? current.note : cleanText(body.note,'备注',1000);
    const { rows } = await this.db.query(`
      UPDATE work_calendar_events SET title=$2,category=$3,start_date=$4,end_date=$5,start_time=$6,end_time=$7,status=$8,note=$9,updated_at=NOW()
      WHERE id=$1
      RETURNING id,series_id,repeat_until,title,category,start_date,end_date,start_time,end_time,status,note,created_at,updated_at`,
    [eventId,title,category,startDate,endDate,startTime,endTime,status,note]);
    return eventView(rows[0]);
  }
}
