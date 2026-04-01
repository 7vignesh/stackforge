import React from "react";

interface CardProps {
  children: React.ReactNode;
  hover?: boolean;
  glow?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function Card({ children, hover = true, glow = false, style, className }: CardProps) {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      className={className}
      onMouseEnter={hover ? () => setIsHovered(true) : undefined}
      onMouseLeave={hover ? () => setIsHovered(false) : undefined}
      style={{
        background: isHovered ? "#1c1c28" : "#16161f",
        border: "1px solid",
        borderColor: isHovered && glow ? "rgba(99, 102, 241, 0.3)" : "#23232f",
        borderRadius: "16px",
        padding: "24px",
        transition: "all 250ms cubic-bezier(0.4, 0, 0.2, 1)",
        boxShadow: isHovered
          ? glow
            ? "0 4px 16px rgba(99, 102, 241, 0.15), 0 8px 32px rgba(0, 0, 0, 0.3)"
            : "0 4px 16px rgba(0, 0, 0, 0.3)"
          : "0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
