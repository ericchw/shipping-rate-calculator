"use client";
import { useI18n } from "./UIPreferences";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
type Toast = { id: string; message: string; kind: "success" | "error"; expires: number };
const Context = createContext<((message: string, kind?: Toast["kind"]) => void) | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const nextId = useRef(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((previous) => previous.filter((toast) => toast.id !== id)), []);
  const notify = useCallback((message: string, kind: Toast["kind"] = "success") => {
    const toast = { id: `${Date.now()}-${++nextId.current}`, message, kind, expires: Date.now() + 4500 };
    setToasts((previous) => [...previous.slice(-2), toast]);
  }, []);
  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => dismiss(toast.id), Math.max(0, toast.expires - Date.now())));
    return () => timers.forEach(window.clearTimeout);
  }, [toasts, dismiss]);
  return <Context.Provider value={notify}>{children}<div className="toast-stack" aria-label={t("Notifications")} data-capture-ignore>
    {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
      <span className="toast-icon" aria-hidden="true">{toast.kind === "error" ? "!" : "✓"}</span><span>{t(toast.message)}</span>
      <button type="button" aria-label={t("Dismiss notification")} onClick={() => dismiss(toast.id)}>×</button>
    </div>)}
  </div></Context.Provider>;
}
export function useToast() {
  const notify = useContext(Context);
  if (!notify) throw new Error("ToastProvider is required");
  return notify;
}
