import { useEffect, useState } from 'react';

export function usePolling<T>(fn: () => Promise<T>, interval: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: any;

    async function tick() {
      try {
        const result = await fn();
        if (!cancelled) setData(result);
      } catch (e: any) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) timer = setTimeout(tick, interval);
      }
    }

    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [fn, interval]);

  return { data, error };
}
