import { useEffect, useRef, useState } from "react";

/** Tracks an element's width so SVG charts render at real pixels (crisp text, no stretching). */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(
      ([entry]) =>
        entry && setWidth(Math.max(240, Math.floor(entry.contentRect.width))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
