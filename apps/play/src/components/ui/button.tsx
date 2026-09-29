import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The console's one button.
 *
 * Four variants and two sizes, which is all a control panel needs. The product
 * apps use `class-variance-authority` for theirs because they have to survive
 * being restyled by whoever composes them; here the variants are a lookup and
 * the whole component is shorter than the import list would be.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm disabled:bg-primary/40",
  secondary:
    "border border-border/70 bg-card text-foreground hover:bg-accent hover:border-border",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  danger:
    "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-full px-3 text-xs",
  md: "h-10 gap-2 rounded-full px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Rendered before the label; sized by the button, not by the caller. */
  icon?: ReactNode;
  /** Swaps the icon for a turning ring, and disables the button. */
  busy?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {busy ? (
        <span
          aria-hidden
          className="border-current/30 border-t-current size-3.5 animate-spin rounded-full border-2"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/** An icon button: no label, a square hit area, a title for the tooltip. */
export function IconButton({
  variant = "ghost",
  className,
  children,
  ...rest
}: Omit<ButtonProps, "size" | "icon">) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}
