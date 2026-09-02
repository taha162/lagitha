"use client";

import { useEffect, useRef } from "react";

/**
 * Puts back what the person typed after a rejected submission.
 *
 * React clears a `<form action={…}>` once the action resolves. That is right
 * for a form that succeeded and wrong for one that did not: mistyping a
 * password should not also wipe the address above it, and on a phone that is
 * enough friction to end a sign-up.
 *
 * Restoring in an effect is what makes this reliable — effects run after the
 * commit that performs the reset, so this is the last write. Re-rendering the
 * field with a `value` or `defaultValue` is not: React applies those during the
 * render, and the reset then undoes them.
 *
 * The values come back from the server rather than from local state, so the
 * fields restored are exactly the ones the action chose to echo. Passwords are
 * never among them: a rejected password should be cleared.
 */
export function useRestoredForm(
  state: { ok: true } | { ok: false; values?: Record<string, string> } | undefined,
) {
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state || state.ok || !state.values) return;
    const form = ref.current;
    if (!form) return;

    for (const [name, value] of Object.entries(state.values)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement && field.type !== "password") {
        field.value = value;
      }
    }
  }, [state]);

  return ref;
}
