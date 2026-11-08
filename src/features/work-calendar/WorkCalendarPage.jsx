import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import { CalendarOutlined, CheckOutlined, ClockCircleOutlined, LeftOutlined, PlusOutlined, RightOutlined, SyncOutlined } from '@ant-design/icons';
import { useWorkCalendar } from './useWorkCalendar.js';
import './work-calendar.css';

const { Title,Text } = Typography;
const categories = ['客户活动','客户服务','团队事项','培训学习','其他'];
const statusOptions = [
  {value:'planned',label:'计划中',color:'blue'},
  {value:'in_progress',label:'进行中',color:'orange'},
  {value:'completed',label:'已完成',color:'green'},
  {value:'cancelled',label:'已取消',color:'default'},
];
const statusByValue = Object.fromEntries(statusOptions.map((item) => [item.value,item]));
const weekdayNames = ['日','一','二','三','四','五','六'];

const localDateString = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const todayString = () => localDateString(new Date());
const addDays = (value,days) => {
  const [year,month,day] = value.split('-').map(Number);
  return localDateString(new Date(year,month-1,day+days));
};
const shiftMonth = (month,delta) => {
  const [year,monthNumber] = month.split('-').map(Number);
  const date = new Date(year,monthNumber-1+delta,1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
};
const monthLabel = (month) => {
  const [year,monthNumber] = month.split('-').map(Number);
  return `${year}年${monthNumber}月`;
};
const dateLabel = (value) => {
  if (!value) return '未设置';
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(year,month-1,day);
  return `${month}月${day}日 周${weekdayNames[date.getDay()]}`;
};

function calendarDays(month) {
  const [year,monthNumber] = month.split('-').map(Number);
  const first = new Date(year,monthNumber-1,1);
  const count = new Date(year,monthNumber,0).getDate();
  const totalCells = Math.max(35,Math.ceil((first.getDay()+count)/7)*7);
  return Array.from({length:totalCells},(_,index) => {
    const date = new Date(year,monthNumber-1,1-first.getDay()+index);
    return { date,dateText:localDateString(date),inMonth:date.getMonth() === monthNumber-1 };
  });
}

function WorkCalendarEventModal({open,event,selectedDate,month,loading,onCancel,onSubmit}) {
  const [form] = Form.useForm();
  const repeatValue = Form.useWatch('repeat',form);
  const openForEvent = Boolean(event);
  const initialDate = selectedDate || `${month}-01`;
  const title = openForEvent ? '编辑日历事件' : '新增日历事件';

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(event ? {
      title:event.title,
      category:event.category,
      startDate:event.startDate,
      endDate:event.endDate,
      startTime:event.startTime || undefined,
      endTime:event.endTime || undefined,
      status:event.status,
      note:event.note,
      repeat:'none',
      repeatUntil:addDays(event.startDate,28),
    } : {
      title:'',category:'客户活动',startDate:initialDate,endDate:initialDate,
      status:'planned',repeat:'none',repeatUntil:addDays(initialDate,28),note:'',
    });
  },[open,event,selectedDate,month,form]);

  const submit = (values) => {
    const body = {
      title:values.title,
      category:values.category,
      startDate:values.startDate,
      endDate:values.endDate || values.startDate,
      startTime:values.startTime || null,
      endTime:values.endTime || null,
      status:values.status,
      note:values.note || '',
    };
    if (!openForEvent) {
      body.repeat = values.repeat || 'none';
      body.repeatUntil = values.repeat === 'weekly' ? values.repeatUntil : null;
    }
    return onSubmit(body);
  };

  return <Modal
    title={title}
    open={open}
    onCancel={onCancel}
    onOk={() => form.submit()}
    confirmLoading={loading}
    okText="保存事件"
    cancelText="取消"
    cancelButtonProps={{color:'danger',variant:'outlined'}}
    destroyOnHidden
  >
    <Form form={form} layout="vertical" onFinish={submit}>
      <Form.Item name="title" label="事件名称" rules={[{required:true,whitespace:true,message:'请填写事件名称'}]}>
        <Input maxLength={120} showCount placeholder="例如：客户权益说明会" />
      </Form.Item>
      <Form.Item name="category" label="事件类型" rules={[{required:true,message:'请选择事件类型'}]}>
        <Select options={categories.map((value) => ({value,label:value}))} />
      </Form.Item>
      <div className="work-calendar-form-grid">
        <Form.Item name="startDate" label="开始日期" rules={[{required:true,message:'请选择开始日期'}]}><Input type="date" /></Form.Item>
        <Form.Item name="endDate" label="结束日期"><Input type="date" /></Form.Item>
        <Form.Item name="startTime" label="开始时间"><Input type="time" /></Form.Item>
        <Form.Item name="endTime" label="结束时间"><Input type="time" /></Form.Item>
      </div>
      <Form.Item name="status" label="状态" rules={[{required:true,message:'请选择事件状态'}]}>
        <Select options={statusOptions.map(({value,label}) => ({value,label}))} />
      </Form.Item>
      {!openForEvent ? <>
        <Form.Item name="repeat" label="重复设置">
          <Select options={[{value:'none',label:'不重复'},{value:'weekly',label:'每周重复'}]} />
        </Form.Item>
        {repeatValue === 'weekly' ? <Form.Item name="repeatUntil" label="重复至" rules={[{required:true,message:'请选择重复结束日期'}]}><Input type="date" /></Form.Item> : null}
      </> : event?.seriesId ? <Alert type="info" showIcon message="这是每周重复活动中的一场；本次编辑和状态变更只影响当前场次。" /> : null}
      <Form.Item name="note" label="备注"><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
    </Form>
  </Modal>;
}

export function WorkCalendarPage({api,apiLoading,performApiAction,backendStatus,onError,onSuccess}) {
  const {month,setMonth,events,save,updateStatus} = useWorkCalendar({api,performApiAction,backendStatus,onError,onSuccess});
  const [selectedDate,setSelectedDate] = useState(todayString());
  const [selectedEvent,setSelectedEvent] = useState(null);
  const [modalOpen,setModalOpen] = useState(false);
  const [editingEvent,setEditingEvent] = useState(null);
  const days = useMemo(() => calendarDays(month),[month]);
  const monthLoading = Boolean(apiLoading[`work-calendar:month:${month}`]);
  const saving = Boolean(apiLoading['work-calendar:save']);
  const statusLoading = Boolean(selectedEvent && apiLoading[`work-calendar:status:${selectedEvent.id}`]);

  const eventsForDate = (dateText) => events.filter((event) => event.startDate <= dateText && event.endDate >= dateText);
  const openCreate = (dateText=selectedDate) => {
    setSelectedDate(dateText);
    setEditingEvent(null);
    setModalOpen(true);
  };
  const openEdit = () => {
    setEditingEvent(selectedEvent);
    setSelectedEvent(null);
    setModalOpen(true);
  };
  const handleSubmit = async (values) => {
    try {
      await save(values,editingEvent?.id || null);
      setModalOpen(false);
      setEditingEvent(null);
      if (editingEvent && (editingEvent.startDate.slice(0,7) !== month || values.startDate.slice(0,7) !== month)) setSelectedEvent(null);
    } catch (error) { onError(error); }
  };
  const changeStatus = async (status) => {
    if (!selectedEvent || status === selectedEvent.status) return;
    try {
      const updated = await updateStatus(selectedEvent.id,status);
      setSelectedEvent(updated);
    } catch (error) { onError(error); }
  };
  const goToMonth = (nextMonth) => {
    setMonth(nextMonth);
    setSelectedDate(`${nextMonth}-01`);
  };

  return <div className="work-calendar-page">
    <div className="work-calendar-heading">
      <div><Title level={3}>工作行事历</Title><Text type="secondary">安排客户活动、服务和团队事项，及时更新进展。</Text></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>新增事件</Button>
    </div>
    {backendStatus !== 'ok' ? <Alert type="warning" showIcon message="工作行事历需要连接工作台 API 后使用。" /> : null}
    <Card className="work-calendar-card" bordered>
      <div className="work-calendar-toolbar">
        <Space size={8}>
          <Button aria-label="上个月" icon={<LeftOutlined />} onClick={() => goToMonth(shiftMonth(month,-1))} />
          <Button aria-label="下个月" icon={<RightOutlined />} onClick={() => goToMonth(shiftMonth(month,1))} />
          <Title level={4} className="work-calendar-month-title">{monthLabel(month)}</Title>
          <Button onClick={() => { const current=todayString(); goToMonth(current.slice(0,7)); setSelectedDate(current); }}>今天</Button>
        </Space>
        <Input type="month" aria-label="选择月份" value={month} onChange={(event) => event.target.value && goToMonth(event.target.value)} />
      </div>
      <div className="work-calendar-legend" aria-label="事件状态">
        {statusOptions.map((status) => <span className="work-calendar-legend-item" key={status.value}><i className={`work-calendar-legend-dot ${status.value}`} />{status.label}</span>)}
      </div>
      {monthLoading ? <div className="work-calendar-loading"><Spin /></div> : events.length === 0 ? <Empty className="work-calendar-empty" description="这个月还没有事件，点击日期或新增事件开始安排。" /> : null}
      <div className="work-calendar-grid" role="grid" aria-label={`${monthLabel(month)}工作行事历`}>
        {weekdayNames.map((day) => <div className="work-calendar-weekday" role="columnheader" key={day}>周{day}</div>)}
        {days.map(({date,dateText,inMonth}) => {
          const todaysEvents = eventsForDate(dateText);
          return <div className={`work-calendar-day ${inMonth ? '' : 'outside-month'} ${selectedDate === dateText ? 'selected-day' : ''}`} role="gridcell" key={dateText}>
            <div className="work-calendar-day-head">
              <button className={`work-calendar-date ${dateText === todayString() ? 'is-today' : ''}`} type="button" onClick={() => openCreate(dateText)} aria-label={`${dateLabel(dateText)}，点击新建事件`}>
                <span>{date.getDate()}</span>{dateText === todayString() ? <span className="work-calendar-today-label">今天</span> : null}
              </button>
              <Button className="work-calendar-add-day" type="text" size="small" icon={<PlusOutlined />} aria-label={`${dateLabel(dateText)}新增事件`} onClick={() => openCreate(dateText)} />
            </div>
            <div className="work-calendar-day-events">
              {todaysEvents.slice(0,3).map((event) => <button
                type="button"
                key={event.id}
                className={`work-calendar-event ${event.status}`}
                onClick={() => { setSelectedDate(dateText); setSelectedEvent(event); }}
                aria-label={`${event.title}，${statusByValue[event.status]?.label || '计划中'}，${dateLabel(event.startDate)}`}
              >
                {event.seriesId ? <SyncOutlined aria-hidden="true" /> : null}
                {event.startTime && event.startDate === dateText ? <span className="work-calendar-event-time">{event.startTime}</span> : null}
                <span className="work-calendar-event-title">{event.title}</span>
              </button>)}
              {todaysEvents.length > 3 ? <Text className="work-calendar-more">+{todaysEvents.length-3} 项</Text> : null}
            </div>
          </div>;
        })}
      </div>
      <div className="work-calendar-hint"><CalendarOutlined /> 点击日期新建事件；点击事件查看详情或修改状态。取消的活动会保留记录。</div>
    </Card>

    <Drawer title="事件详情" open={Boolean(selectedEvent)} onClose={() => setSelectedEvent(null)} size={420}>
      {selectedEvent ? <div className="work-calendar-detail">
        <div className="work-calendar-detail-title"><Title level={4}>{selectedEvent.title}</Title><Tag color={statusByValue[selectedEvent.status]?.color}>{statusByValue[selectedEvent.status]?.label}</Tag></div>
        <Descriptions column={1} size="small" items={[
          {key:'category',label:'类型',children:selectedEvent.category},
          {key:'date',label:'日期',children:selectedEvent.startDate === selectedEvent.endDate ? dateLabel(selectedEvent.startDate) : `${dateLabel(selectedEvent.startDate)} 至 ${dateLabel(selectedEvent.endDate)}`},
          {key:'time',label:'时间',children:selectedEvent.startTime ? `${selectedEvent.startTime}${selectedEvent.endTime ? `—${selectedEvent.endTime}` : ''}` : '全天'},
          {key:'repeat',label:'重复',children:selectedEvent.seriesId ? <Space><SyncOutlined />每周重复 · 至 ${selectedEvent.repeatUntil}</Space> : '不重复'},
          {key:'note',label:'备注',children:selectedEvent.note || '无'},
        ]} />
        <Form.Item label="更新状态" className="work-calendar-status-control">
          <Select value={selectedEvent.status} loading={statusLoading} disabled={statusLoading} options={statusOptions.map(({value,label}) => ({value,label}))} onChange={changeStatus} />
        </Form.Item>
        <div className="work-calendar-detail-actions"><Button icon={<ClockCircleOutlined />} onClick={openEdit} disabled={statusLoading}>编辑事件</Button>{selectedEvent.status !== 'completed' ? <Button type="primary" icon={<CheckOutlined />} loading={statusLoading} onClick={() => changeStatus('completed')}>标记完成</Button> : null}</div>
        {selectedEvent.updatedAt ? <Text type="secondary" className="work-calendar-updated">最近更新：{new Date(selectedEvent.updatedAt).toLocaleString('zh-CN')}</Text> : null}
      </div> : null}
    </Drawer>
    <WorkCalendarEventModal open={modalOpen} event={editingEvent} selectedDate={selectedDate} month={month} loading={saving} onCancel={() => { setModalOpen(false); setEditingEvent(null); }} onSubmit={handleSubmit} />
  </div>;
}
