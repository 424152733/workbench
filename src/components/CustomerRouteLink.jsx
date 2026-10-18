import { Spin } from 'antd';
import { pathForCustomer } from '../navigation.js';

export function CustomerRouteLink({ customerId, loading = false, onOpen, className = '', children }) {
  const handleClick = (event) => {
    const isModifiedClick = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
    if (event.defaultPrevented || isModifiedClick || !onOpen) return;
    event.preventDefault();
    if (!loading) onOpen();
  };

  return <a href={pathForCustomer(customerId)} className={`customer-route-link ${className}`.trim()}
    aria-busy={loading || undefined} aria-disabled={loading || undefined} onClick={handleClick}>
    {children}
    {loading ? <Spin className="customer-route-link-spinner" size="small" /> : null}
  </a>;
}
