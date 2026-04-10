import React from "react";
import { AgentCard } from "./AgentCard";
import type { AgentState } from "../hooks/useJobStream";

export function AgentTimeline({ agents }: { agents: AgentState[] }) {
  return (
    <div className="sf-agent-timeline">
      {/* Vertical connector line */}
      <div className="sf-agent-timeline-line" />

      <div className="sf-agent-timeline-list">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="animate-fade-in"
          >
            <AgentCard agent={agent} />
          </div>
        ))}
      </div>
    </div>
  );
}
