import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresTypes } from '../database.service.js';
import { addCalendarDays, beijingDate, beijingMonthStart, cleanText, dateOnly, displayWhen, pgDate, taskWhen } from '../workbench-primitives.js';
import { WorkbenchService } from '../workbench.service.js';

test('database DATE values stay as calendar-date strings',() => {
  const parseDate = postgresTypes.getTypeParser(1082,'text');
  const date = parseDate('2026-10-18');
  assert.equal(date,'2026-10-18');
  assert.equal(dateOnly(date),'2026-10-18');
  assert.equal(pgDate(date),'2026-10-18');
});

test('date helpers use the Shanghai calendar independently of the host timezone',() => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Auckland';
    const today = beijingDate();
    const todayInstant = new Date(`${today}T00:00:00.000Z`);
    const [year,month,day] = today.split('-').map(Number);
    const tomorrow = new Date(Date.UTC(year,month-1,day+1)).toISOString().slice(0,10);

    assert.equal(dateOnly(todayInstant),today);
    assert.equal(pgDate(todayInstant),today);
    assert.equal(displayWhen(todayInstant),'今天');
    assert.equal(taskWhen(tomorrow,'09:30'),'明天 09:30');
    assert.equal(beijingMonthStart(),`${today.slice(0,7)}-01`);
    assert.equal(addCalendarDays('2026-10-31',1),'2026-11-01');
    assert.equal(new WorkbenchService({}).nextRunAt(1,'09:30',new Date('2026-10-18T17:30:00.000Z')),'2026-10-20T01:30:00.000Z');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('shared text validation trims text and keeps the caller-specific messages',() => {
  assert.equal(cleanText('  保障摘要  ','摘要',20),'保障摘要');
  assert.throws(() => cleanText('','产品名称',20,{required:true}),/请填写产品名称/);
  assert.throws(() => cleanText('超过长度','备注',2),/备注不能超过 2 个字/);
});
