import { useCallback, useEffect, useRef, useState } from 'react';
import { localMonth } from '../../utils/date.js';

export function useWorkCalendar({api,performApiAction,backendStatus,onError,onSuccess}) {
  const [month,setMonth] = useState(localMonth(new Date()));
  const [events,setEvents] = useState([]);
  const onErrorRef = useRef(onError);
  const loadSequenceRef = useRef(0);
  useEffect(() => { onErrorRef.current = onError; },[onError]);

  const reload = useCallback(async (targetMonth=month) => {
    if (backendStatus !== 'ok') return [];
    const requestSequence = ++loadSequenceRef.current;
    const rows = await performApiAction(`work-calendar:month:${targetMonth}`,() => api.workCalendarEvents(targetMonth));
    if (requestSequence === loadSequenceRef.current) setEvents(rows);
    return rows;
  },[api,backendStatus,month,performApiAction]);

  useEffect(() => {
    if (backendStatus !== 'ok') return;
    reload(month).catch((error) => onErrorRef.current(error));
  },[backendStatus,month,reload]);

  const save = async (values,eventId=null) => performApiAction('work-calendar:save',async () => {
    const saved = eventId
      ? await api.updateWorkCalendarEvent(eventId,values)
      : await api.createWorkCalendarEvent(values);
    await reload(month);
    onSuccess(eventId ? '日历事件已更新' : (saved.events?.length > 1 ? `已创建 ${saved.events.length} 个每周重复事件` : '日历事件已添加'));
    return saved;
  });

  const updateStatus = async (eventId,status) => performApiAction(`work-calendar:status:${eventId}`,async () => {
    const saved = await api.updateWorkCalendarEvent(eventId,{status});
    setEvents((current) => current.map((item) => item.id === saved.id ? saved : item));
    onSuccess('事件状态已更新');
    return saved;
  });

  return {month,setMonth,events,reload,save,updateStatus};
}
