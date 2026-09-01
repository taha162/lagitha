import { Slot } from "./slot";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-contrast hover:bg-primary-hover border border-transparent shadow-raised",
  secondary:
    "bg-surface text-text border border-border-strong hover:border-primary hover:text-primary",
  ghost: "bg-transparent text-text border border-transparent hover:bg-surface-sunken",
  danger: "bg-danger text-white border border-transparent hover:brightness-95",
  quiet: "bg-primary-soft text-primary border border-transparent hover:brightness-97",
};

const SIZES: Record<Size, string> = {
  // Touch targets stay at or above 44px on every size that appears on mobile.
  sm: "h-9 px-3 text-meta rounded-sm gap-1.5",
  md: "h-11 px-4 text-body rounded-md gap-2",
  lg: "h-13 px-5 text-h3 rounded-md gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  /** Renders the child element instead of a <button> — used for links. */
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      // A <button> inside a <form> defaults to submit, which has caused more
      // accidental submissions than it has ever saved keystrokes.
      {...(asChild ? {} : { type: type ?? "button" })}
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-colors duration-150",
        "disabled:opacity-55 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...props}
    />
  );
}
