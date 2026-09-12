'use client';

import { useEffect, useState } from 'react';

/**
 * The value, but only once typing has paused.
 *
 * A search box wired straight to a query key fires a request per keystroke, and every one of them
 * changes the key — so the list has no data for the new key and falls back to its loading state.
 * The result is a page that blanks and re-renders under the cursor on every letter, which reads as
 * the box being broken. Hold the value back a moment and the query runs once, for the word.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
