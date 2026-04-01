import React, { useState } from "react";

interface CollapsibleSectionProps {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  count,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        border: "1px solid #23232f",
        borderRadius: "14px",
        overflow: "hidden",
        background: "#16161f",
        transition: "border-color 250ms",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "16px 20px",
          background: "transparent",
          border: "none",
          color: "#f0f0f5",
          fontSize: "15px",
          fontWeight: 600,
          fontFamily: "'Inter', system-ui, sans-serif",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            transition: "transform 200ms",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: "12px",
            color: "#9898a8",
          }}
        >
          ▶
        </span>
        {icon && <span>{icon}</span>}
        <span style={{ flex: 1 }}>{title}</span>
        {count != null && (
          <span
            style={{
              fontSize: "12px",
              padding: "2px 8px",
              borderRadius: "12px",
              background: "rgba(99, 102, 241, 0.1)",
              color: "#818cf8",
              fontWeight: 500,
            }}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            padding: "0 20px 20px",
            animation: "fadeIn 200ms ease-out",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
