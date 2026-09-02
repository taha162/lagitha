"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { ar } from "@/i18n/ar";
import { TextField } from "./field";

/**
 * A password input with a reveal toggle.
 *
 * The toggle is not a nicety: on a phone keyboard, typing a password you cannot
 * see is where people give up and pick something short. Showing it is the
 * user's choice, and the field starts hidden.
 *
 * The value is always laid out left-to-right even though the page is RTL —
 * a password is a sequence of characters, not Arabic prose, and mixing
 * directions makes the caret jump around unpredictably.
 */
export function PasswordField({
  name,
  label,
  hint,
  error,
  autoComplete,
  autoFocus,
  required = true,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <TextField
        name={name}
        type={visible ? "text" : "password"}
        label={label}
        hint={hint}
        error={error}
        placeholder={ar.auth.passwordPlaceholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        dir="ltr"
        className="text-start latin pe-11"
        required={required}
        autoFocus={autoFocus}
      />

      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? ar.auth.passwordHide : ar.auth.passwordShow}
        aria-pressed={visible}
        // Offset clears the label above and centres on the 44px control.
        className="absolute top-[1.9rem] end-1 size-9 grid place-items-center rounded-sm text-muted hover:text-text transition-colors"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
