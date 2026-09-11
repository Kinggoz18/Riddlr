import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

type ToastTone = "ok" | "danger";
type ToastItem = { id: number; text: string; tone: ToastTone };

const ToastContext = createContext<{
  toast: (text: string, tone?: ToastTone) => void;
} | null>(null);

export function ToastProvider(props: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((text: string, tone: ToastTone = "ok") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current.slice(-1), { id, text, tone }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 3200);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {props.children}
      <div className="toast-stack">
        {items.map((item) => (
          <p
            key={item.id}
            className={`toast toast-${item.tone}`}
            role={item.tone === "danger" ? "alert" : "status"}
            aria-live="polite"
          >
            {item.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("ToastProvider is required");
  }
  return value.toast;
}

export function toastFail(err: unknown, fallback = "Couldn’t save") {
  return err instanceof Error ? err.message : fallback;
}
