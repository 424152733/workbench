import { Button, Space } from 'antd';

export function FollowUpTaskActions({ task, status = 'pending', cancelLoading = false, onComplete, onReschedule, onCancel, onOpenCustomer }) {
  if (status !== 'pending') {
    return <Button size="small" onClick={() => onOpenCustomer?.(task)}>查看客户</Button>;
  }

  return (
    <Space size={4}>
      <Button size="small" type="primary" onClick={() => onComplete?.(task)}>完成并记录</Button>
      <Button size="small" onClick={() => onReschedule?.(task)}>延期</Button>
      {onCancel ? <Button size="small" color="danger" variant="outlined" loading={cancelLoading} onClick={() => onCancel(task)}>取消</Button> : null}
    </Space>
  );
}
