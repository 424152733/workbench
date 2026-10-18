import { useCallback, useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';

export function useCustomerAnalytics(api) {
  const [range, setRange] = useState(() => [dayjs().startOf('month').subtract(11, 'month'), dayjs()]);
  const [sourceCode, setSourceCode] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestNumber.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.customerAnalytics({
        from: range[0]?.format('YYYY-MM-DD'),
        to: range[1]?.format('YYYY-MM-DD'),
        sourceCode,
      });
      if (requestId === requestNumber.current) setData(result);
    } catch (loadError) {
      if (requestId === requestNumber.current) setError(loadError.message || '客户分析加载失败');
    } finally {
      if (requestId === requestNumber.current) setLoading(false);
    }
  }, [api, range, sourceCode]);

  useEffect(() => {
    load();
    return () => { requestNumber.current += 1; };
  }, [load]);

  const updateRange = (dates) => {
    if (dates?.[0] && dates?.[1]) setRange(dates);
  };

  return { range, updateRange, sourceCode, setSourceCode, data, loading, error, reload: load };
}
