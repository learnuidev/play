'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Naming a loop, the way a DAW does it.
 *
 * The name is written and selected the moment it appears, so typing replaces it
 * and Enter keeps it. Escape — or emptying it — throws it away, and blur commits,
 * because the thing you clicked next is usually the thing you wanted rather than
 * a way to cancel.
 */
export function LoopNameField({
  initial,
  onCommit,
  onCancel,
  className,
  style,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards against commit-then-blur firing the handler twice. */
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;

    const name = value.trim();
    if (!name) {
      onCancel();
      return;
    }
    onCommit(name);
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') cancel();
      }}
      maxLength={60}
      aria-label="Loop name"
      style={style}
      className={className}
    />
  );
}
