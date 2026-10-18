import { useCallback, useState } from 'react';

export function useApiAction() {
  const [apiLoading, setApiLoading] = useState({});
  const performApiAction = useCallback(async (key, action) => {
    setApiLoading((current) => ({ ...current, [key]:true }));
    try {
      return await action();
    } finally {
      setApiLoading((current) => ({ ...current, [key]:false }));
    }
  }, []);

  return { apiLoading, performApiAction };
}
