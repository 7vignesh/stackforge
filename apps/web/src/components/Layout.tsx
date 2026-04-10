import React from "react";
import { Link, useLocation } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="sf-shell">
      <nav className="sf-nav">
        <Link
          to="/"
          className="sf-logo"
        >
          <div className="sf-logo-icon">S</div>
          <span>StackForge</span>
        </Link>

        <div className="sf-nav-links">
          <NavLink to="/" active={location.pathname === "/"}>
            Home
          </NavLink>
        </div>
      </nav>

      <main className="sf-main">{children}</main>

      <footer className="sf-footer">
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
      className={`sf-nav-link ${active ? "is-active" : ""}`}
    >
      {children}
    </Link>
  );
}
