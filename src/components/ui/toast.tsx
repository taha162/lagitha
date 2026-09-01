"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small transient confirmations only.
 *
 * Anything the user needs to act on gets a real surface — a toast is for
 * "تم النسخ", not for reporting that their report failed to publish.
 */
type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Announced without stealing focus.
        role="status"
        aria-live="polite"
        className="fixed inset-x-0 bottom-20 sm:bottom-6 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "enter-fade pointer-events-auto flex items-center gap-2",
              "max-w-sm w-fit px-4 py-2.5 rounded-md border shadow-overlay text-meta",
              toast.tone === "success" && "bg-success-soft border-success/30 text-success",
              toast.tone === "error" && "bg-danger-soft border-danger/30 text-danger",
              toast.tone === "info" && "bg-surface border-border text-text",
            )}
          >
            {toast.tone === "success" && <CheckCircle2 className="size-4 shrink-0" aria-hidden />}
            {toast.tone === "error" && <AlertTriangle className="size-4 shrink-0" aria-hidden />}
            {toast.tone === "info" && <Info className="size-4 shrink-0 text-muted" aria-hidden />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
