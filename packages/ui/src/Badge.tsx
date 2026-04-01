import React from "react";

export type BadgeStatus = "waiting" | "running" | "completed" | "failed";

interface BadgeProps {
  status: BadgeStatus;
  label?: string;
}

const statusConfig: Record<BadgeStatus, { bg: string; color: string; borderColor: string; label: string }> = {
  waiting:   { bg: "rgba(92, 92, 111, 0.15)", color: "#9898a8", borderColor: "rgba(92, 92, 111, 0.3)", label: "Waiting" },
  running:   { bg: "rgba(56, 189, 248, 0.12)", color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)", label: "Running" },
  completed: { bg: "rgba(52, 211, 153, 0.12)", color: "#34d399", borderColor: "rgba(52, 211, 153, 0.3)", label: "Completed" },
  failed:    { bg: "rgba(244, 63, 94, 0.12)",  color: "#f43f5e", borderColor: "rgba(244, 63, 94, 0.3)",  label: "Failed" },
};

export function Badge({ status, label }: BadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 10px",
        fontSize: "12px",
        fontWeight: 600,
        fontFamily: "'Inter', system-ui, sans-serif",
        borderRadius: "20px",
        background: config.bg,
        color: config.color,
        border: `1px solid ${config.borderColor}`,
        letterSpacing: "0.02em",
        textTransform: "capitalize",
      }}
    >
      {status === "running" && (
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: config.color,
            animation: "pulse-glow 1.5s ease-in-out infinite",
            flexShrink: 0,
          }}
        />
      )}
      {status === "completed" && <span style={{ fontSize: "11px" }}>✓</span>}
      {status === "failed" && <span style={{ fontSize: "11px" }}>✕</span>}
      {label ?? config.label}
    </span>
  );
}
