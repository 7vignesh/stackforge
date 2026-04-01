import React from "react";

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 20, color = "#6366f1" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{
        display: "inline-block",
        width: `${size}px`,
        height: `${size}px`,
        border: `2px solid rgba(99, 102, 241, 0.2)`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}
