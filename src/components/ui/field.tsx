"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { ar } from "@/i18n/ar";

const CONTROL_BASE =
  "w-full bg-surface border rounded-md px-3 text-body text-text " +
  "transition-colors placeholder:text-muted " +
  "focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-0 " +
  "disabled:opacity-60 disabled:bg-surface-sunken";

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Wraps a control with its label, hint and error and wires up the aria plumbing
 * once, so no individual field can forget it.
 */
export function Field({ label, hint, error, optional, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-meta font-medium text-text">
        {label}
        {optional && <span className="text-muted font-normal"> — {ar.common.optional}</span>}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="text-fine text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-fine text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** React 19 passes ref as an ordinary prop; declare it so callers can use it. */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, optional, className, ...props }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            CONTROL_BASE,
            "h-11",
            invalid ? "border-danger" : "border-border-strong",
            className,
          )}
          {...props}
        />
      )}
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  className,
  rows = 4,
  ...props
}: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            CONTROL_BASE,
            "py-2.5 resize-y leading-relaxed",
            invalid ? "border-danger" : "border-border-strong",
            className,
          )}
          {...props}
        />
      )}
    </Field>
  );
}

interface SelectFieldProps {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  options,
  placeholder,
  onChange,
  ...props
}: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange?.(event.target.value)}
          className={cn(
            CONTROL_BASE,
            "h-11 appearance-none",
            // Chevron drawn with a gradient so the control needs no icon font.
            "bg-[length:14px] bg-no-repeat bg-[left_0.75rem_center]",
            invalid ? "border-danger" : "border-border-strong",
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23747a76' stroke-width='1.6'><path d='M1 1.5 6 6.5 11 1.5'/></svg>\")",
          }}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
