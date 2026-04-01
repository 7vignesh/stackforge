import React from "react";
import { AgentCard } from "./AgentCard";
import type { AgentState } from "../hooks/useJobStream";

export function AgentTimeline({ agents }: { agents: AgentState[] }) {
  return (
    <div style={{ position: "relative" }}>
      {/* Vertical connector line */}
      <div
        style={{
          position: "absolute",
          left: "39px",
          top: "24px",
          bottom: "24px",
          width: "2px",
          background: "linear-gradient(to bottom, #6366f1, #8b5cf6, #23232f)",
          borderRadius: "1px",
          zIndex: 0,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", position: "relative", zIndex: 1 }}>
        {agents.map((agent, i) => (
          <div
            key={agent.name}
            className="animate-fade-in"
            style={{ animationDelay: `${i * 60}ms`, animationFillMode: "both" }}
          >
            <AgentCard agent={agent} />
          </div>
        ))}
      </div>
    </div>
  );
}
