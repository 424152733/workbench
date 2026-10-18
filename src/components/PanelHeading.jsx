import { Typography } from 'antd';

const { Text } = Typography;

export function PanelHeading({ title, subtitle }) {
  return <div className="panel-heading"><Text strong>{title}</Text><Text className="panel-subtitle">{subtitle}</Text></div>;
}
