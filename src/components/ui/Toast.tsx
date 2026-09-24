"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<{ toast: (kind: Toast["kind"], text: string) => void }>({ toast: () => {} });

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div aria-live="polite" className="fixed bottom-20 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "mb-2 rounded-card border px-4 py-3 text-sm shadow-lg " +
              (t.kind === "success" ? "border-success/30 bg-white text-success"
              : t.kind === "error" ? "border-danger/30 bg-white text-danger"
              : "border-ink/10 bg-white text-ink")}
            role="status"
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
