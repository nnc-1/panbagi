// A tiny observable value with a Preact hook (enough for toasts; avoids another dependency).
import { useEffect, useState } from 'preact/hooks';

export function signalish<T>(initial: T) {
  let v = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => v,
    set(n: T) {
      v = n;
      subs.forEach((f) => f(v));
    },
    use(): T {
      const [, force] = useState(0);
      useEffect(() => {
        const f = () => force((x) => x + 1);
        subs.add(f);
        return () => void subs.delete(f);
      }, []);
      return v;
    },
  };
}
