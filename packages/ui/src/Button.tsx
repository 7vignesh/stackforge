import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    color: "#fff",
    border: "1px solid rgba(99, 102, 241, 0.3)",
    boxShadow: "0 2px 12px rgba(99, 102, 241, 0.25)",
  },
  secondary: {
    background: "#1a1a26",
    color: "#f0f0f5",
    border: "1px solid #23232f",
    boxShadow: "none",
  },
  ghost: {
    background: "transparent",
    color: "#9898a8",
    border: "1px solid transparent",
    boxShadow: "none",
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "6px 14px", fontSize: "13px", borderRadius: "6px" },
  md: { padding: "10px 22px", fontSize: "14px", borderRadius: "10px" },
  lg: { padding: "14px 32px", fontSize: "16px", borderRadius: "12px" },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 600,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.55 : 1,
        transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
        letterSpacing: "-0.01em",
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
      }}
    >
      {loading && (
        <span
          style={{
            width: "16px",
            height: "16px",
            border: "2px solid rgba(255,255,255,0.3)",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </button>
  );
}
