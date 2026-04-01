import React from "react";
import { Badge, Card, Spinner } from "@stackforge/ui";
import type { AgentState } from "../hooks/useJobStream";

const AGENT_META: Record<string, { icon: string; label: string; description: string }> = {
  planner:  { icon: "📋", label: "Planner",   description: "Defines project structure and tech stack" },
  schema:   { icon: "🗄️", label: "Schema",    description: "Designs database entities and relationships" },
  api:      { icon: "⚡", label: "API",       description: "Plans API routes and endpoints" },
  frontend: { icon: "🎨", label: "Frontend",  description: "Creates frontend pages and components" },
  devops:   { icon: "🚀", label: "DevOps",    description: "Sets up CI/CD, Docker, and deployment" },
  reviewer: { icon: "🔍", label: "Reviewer",  description: "Reviews the entire blueprint for quality" },
};

export function AgentCard({ agent }: { agent: AgentState }) {
  const meta = AGENT_META[agent.name] ?? { icon: "🤖", label: agent.name, description: "" };

  const borderColor =
    agent.status === "running"
      ? "rgba(56, 189, 248, 0.3)"
      : agent.status === "completed"
        ? "rgba(52, 211, 153, 0.2)"
        : agent.status === "failed"
          ? "rgba(244, 63, 94, 0.2)"
          : "#23232f";

  return (
    <Card
      hover={false}
      style={{
        padding: "18px 20px",
        borderColor,
        borderRadius: "14px",
        animation: agent.status === "running" ? "pulse-glow 2s ease-in-out infinite" : undefined,
        transition: "all 350ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {/* Icon */}
        <div
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "12px",
            background:
              agent.status === "running"
                ? "rgba(56, 189, 248, 0.1)"
                : agent.status === "completed"
                  ? "rgba(52, 211, 153, 0.1)"
                  : "rgba(92, 92, 111, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            flexShrink: 0,
          }}
        >
          {agent.status === "running" ? <Spinner size={18} color="#38bdf8" /> : meta.icon}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600 }}>{meta.label}</span>
            <Badge status={agent.status} />
          </div>
          <p style={{ fontSize: "13px", color: "#9898a8", margin: 0 }}>{meta.description}</p>
        </div>

        {/* Duration / details */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {agent.durationMs != null && (
            <span style={{ fontSize: "13px", color: "#9898a8", fontVariantNumeric: "tabular-nums" }}>
              {(agent.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {agent.totalTokens != null && (
            <div style={{ fontSize: "11px", color: "#5c5c6f", marginTop: "2px" }}>
              {agent.totalTokens.toLocaleString()} tokens
            </div>
          )}
          {agent.error && (
            <span style={{ fontSize: "12px", color: "#f43f5e" }}>{agent.error}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
