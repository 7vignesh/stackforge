import React from "react";
import { Link, useLocation } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ─── Navbar ─────────────────────────────────────────────────────── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
          height: "64px",
          background: "rgba(10, 10, 15, 0.8)",
          backdropFilter: "blur(16px) saturate(180%)",
          borderBottom: "1px solid #23232f",
        }}
      >
        <Link
          to="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            textDecoration: "none",
            color: "#f0f0f5",
          }}
        >
          {/* Logo icon */}
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              fontWeight: 800,
              color: "#fff",
              boxShadow: "0 2px 8px rgba(99, 102, 241, 0.3)",
            }}
          >
            S
          </div>
          <span style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Stack<span style={{ color: "#8b5cf6" }}>Forge</span>
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <NavLink to="/" active={location.pathname === "/"}>
            Home
          </NavLink>
        </div>
      </nav>

      {/* ─── Main ──────────────────────────────────────────────────────── */}
      <main style={{ flex: 1 }}>{children}</main>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 32px",
          borderTop: "1px solid #23232f",
          fontSize: "13px",
          color: "#5c5c6f",
        }}
      >
        Built with AI agents&nbsp;·&nbsp;StackForge © {new Date().getFullYear()}
      </footer>
    </div>
  );
}

function NavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      style={{
        fontSize: "14px",
        fontWeight: active ? 600 : 400,
        color: active ? "#f0f0f5" : "#9898a8",
        textDecoration: "none",
        transition: "color 250ms",
        position: "relative",
        paddingBottom: "2px",
        borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
      }}
    >
      {children}
    </Link>
  );
}
