import type { ReactNode, TextareaHTMLAttributes, InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * The form vocabulary, in the same voice as the rest of the console.
 *
 * Labels are small and muted, the control is a hairline on a tinted surface, and
 * the hint sits under the control rather than inside it — a hint that replaces
 * the placeholder is a hint that disappears the moment somebody types.
 */

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={htmlFor}>
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-muted-foreground text-xs leading-relaxed">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "border-border/70 bg-background/60 focus-visible:ring-ring w-full rounded-2xl border px-3.5 py-2.5 font-mono text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, className)} />;
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(CONTROL, "resize-y leading-relaxed", className)}
    />
  );
}
