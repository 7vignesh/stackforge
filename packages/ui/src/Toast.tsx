import React, { createContext, useContext, useState, useCallback } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let nextId = 0;

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "rgba(52, 211, 153, 0.12)", border: "rgba(52, 211, 153, 0.3)", icon: "✓" },
  error:   { bg: "rgba(244, 63, 94, 0.12)",  border: "rgba(244, 63, 94, 0.3)",  icon: "✕" },
  info:    { bg: "rgba(56, 189, 248, 0.12)",  border: "rgba(56, 189, 248, 0.3)",  icon: "ℹ" },
};

const typeColor: Record<ToastType, string> = {
  success: "#34d399",
  error: "#f43f5e",
  info: "#38bdf8",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => {
          const s = typeStyles[toast.type];
          return (
            <div
              key={toast.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 18px",
                background: "#16161f",
                border: `1px solid ${s.border}`,
                borderRadius: "12px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
                fontSize: "14px",
                fontFamily: "'Inter', system-ui, sans-serif",
                color: "#f0f0f5",
                animation: "toast-in 300ms ease-out",
                pointerEvents: "auto",
                maxWidth: "380px",
              }}
            >
              <span
                style={{
                  width: "24px",
                  height: "24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  background: s.bg,
                  color: typeColor[toast.type],
                  fontSize: "12px",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {s.icon}
              </span>
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
