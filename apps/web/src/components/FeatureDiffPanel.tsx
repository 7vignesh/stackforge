import type { DiffObject, PipelineAgentId } from "../lib/api";

const AGENT_LABELS: Record<PipelineAgentId, string> = {
  planner: "Planner changes",
  schema: "Schema changes",
  api: "API changes",
  frontend: "Frontend changes",
  devops: "DevOps changes",
};

function colorFor(kind: "added" | "modified" | "removed"): { bg: string; border: string; label: string } {
  switch (kind) {
    case "added":
      return { bg: "rgba(34, 197, 94, 0.12)", border: "#22c55e", label: "Added" };
    case "modified":
      return { bg: "rgba(234, 179, 8, 0.12)", border: "#eab308", label: "Modified" };
    case "removed":
      return { bg: "rgba(239, 68, 68, 0.12)", border: "#ef4444", label: "Removed" };
  }
}

function rowsByAgent(diff: DiffObject, agentId: PipelineAgentId): Array<{ kind: "added" | "modified" | "removed"; text: string }> {
  const rows: Array<{ kind: "added" | "modified" | "removed"; text: string }> = [];

  for (const item of diff.added.find((x) => x.agentId === agentId)?.items ?? []) {
    rows.push({ kind: "added", text: item });
  }
  for (const item of diff.modified.find((x) => x.agentId === agentId)?.items ?? []) {
    rows.push({ kind: "modified", text: item });
  }
  for (const item of diff.removed.find((x) => x.agentId === agentId)?.items ?? []) {
    rows.push({ kind: "removed", text: item });
  }

  return rows;
}

export function FeatureDiffPanel({ diff }: { diff: DiffObject }) {
  const agents = Object.keys(AGENT_LABELS) as PipelineAgentId[];
  const hasAny = diff.added.length + diff.modified.length + diff.removed.length > 0;

  if (!hasAny) {
    return (
      <div style={{ border: "1px solid #23232f", borderRadius: "12px", padding: "14px", color: "#9898a8", fontSize: "13px" }}>
        No diff found for this update request.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {agents.map((agentId) => {
        const rows = rowsByAgent(diff, agentId);
        if (rows.length === 0) {
          return null;
        }

        return (
          <div key={agentId} style={{ border: "1px solid #23232f", borderRadius: "12px", overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", background: "#161622", color: "#f0f0f5", fontSize: "13px", fontWeight: 700 }}>
              {AGENT_LABELS[agentId]}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px" }}>
              {rows.map((row, index) => {
                const c = colorFor(row.kind);
                return (
                  <div
                    key={`${agentId}-${row.kind}-${index}`}
                    style={{
                      background: c.bg,
                      borderLeft: `3px solid ${c.border}`,
                      borderRadius: "8px",
                      padding: "8px 10px",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      fontSize: "12px",
                      color: "#d6d6e5",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    <span style={{ color: c.border, fontWeight: 700, marginRight: "8px" }}>[{c.label}]</span>
                    {row.text}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
