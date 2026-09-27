'use client';

import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@ui/components/ui/button';
import { cn } from '@ui/lib/utils';

/**
 * Copies a string, and says so for a moment.
 *
 * The feedback matters more than usual on this screen: a secret is copied once
 * and then unrecoverable, so a button that copied nothing and a button that
 * copied the key look identical without it. The tick replaces the icon in place
 * rather than toasting, because the thing being confirmed is where the pointer
 * already is.
 *
 * `navigator.clipboard` needs a secure context, which is why the failure path
 * exists at all: on a plain-HTTP origin the promise rejects, and the honest
 * answer there is to show the value so it can be selected by hand.
 */
export function CopyButton({
  value,
  label = 'Copy',
  className,
  variant = 'ghost',
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: 'ghost' | 'secondary' | 'outline' | 'default';
  size?: 'sm' | 'default' | 'icon';
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error('Could not copy to the clipboard', { description: value });
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {size !== 'icon' && (copied ? 'Copied' : label)}
    </Button>
  );
}
