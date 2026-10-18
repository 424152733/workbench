import { Button, Tooltip } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';

export function GlobalAddCustomerButton({ onClick }) {
  return <Tooltip title="新增客户" placement="left">
    <Button
      className="global-add-customer-fab"
      type="primary"
      shape="circle"
      size="large"
      icon={<UserAddOutlined />}
      aria-label="新增客户"
      onClick={onClick}
    />
  </Tooltip>;
}
