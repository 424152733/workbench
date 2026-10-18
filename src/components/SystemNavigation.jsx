import { Menu } from 'antd';

export function WorkspaceBrand({className = ''}) {
  return <div className={`brand ${className}`.trim()}>
    <div className="brand-mark">保</div>
    <div className="brand-copy"><strong>保险顾问工作台</strong><span>ADVISOR DESK</span></div>
  </div>;
}

export function SystemNavigation({activeKey,items,onNavigate,placement = 'left'}) {
  const atTop = placement === 'top';
  return <Menu
    mode={atTop ? 'horizontal' : 'inline'}
    selectedKeys={[activeKey]}
    items={items}
    onClick={({key}) => onNavigate(key)}
    className={atTop ? 'top-menu' : 'side-menu'}
  />;
}
