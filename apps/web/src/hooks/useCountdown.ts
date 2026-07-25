import { useEffect, useState } from 'react';
import { countdownTo, type CountdownValue } from '../lib/calculations';

export function useCountdown(deadlineAt: string): CountdownValue {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return countdownTo(deadlineAt, now);
}
