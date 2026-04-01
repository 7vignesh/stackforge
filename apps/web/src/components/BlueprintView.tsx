import React from "react";
import { Card, Button } from "@stackforge/ui";
import { CollapsibleSection } from "./CollapsibleSection";
import { FileTree } from "./FileTree";
import type { Blueprint } from "../lib/api";

export function BlueprintView({ blueprint }: { blueprint: Blueprint }) {
  function handleDownload() {
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${blueprint.projectName}-blueprint.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Stack summary card */}
      <Card glow style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "8px" }}>
              {blueprint.projectName}
            </h2>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {Object.entries(blueprint.stack)
                .filter(([k]) => k !== "monorepo")
                .map(([key, value]) => (
                  <span
                    key={key}
                    style={{
                      padding: "4px 12px",
                      fontSize: "12px",
                      fontWeight: 500,
                      borderRadius: "20px",
                      background: "rgba(99, 102, 241, 0.1)",
                      color: "#818cf8",
                      border: "1px solid rgba(99, 102, 241, 0.2)",
                    }}
                  >
                    {key}: {String(value)}
                  </span>
                ))}
            </div>
          </div>
          <Button variant="secondary" onClick={handleDownload}>
            ⬇ Download JSON
          </Button>
        </div>
      </Card>

      {/* Entities */}
      <CollapsibleSection title="Entities / DB Schema" icon="🗄️" count={blueprint.entities.length} defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {blueprint.entities.map((entity) => (
            <div
              key={entity.name}
              style={{
                padding: "14px 16px",
                background: "#1a1a26",
                borderRadius: "10px",
                border: "1px solid #23232f",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#f0f0f5" }}>{entity.name}</span>
                <span style={{ fontSize: "11px", color: "#5c5c6f" }}>({entity.tableName})</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {entity.fields.map((f) => (
                  <span
                    key={f.name}
                    style={{
                      padding: "2px 8px",
                      fontSize: "11px",
                      borderRadius: "6px",
                      background: "rgba(99, 102, 241, 0.08)",
                      color: "#9898a8",
                      fontFamily: "monospace",
                    }}
                  >
                    {f.name}: {f.type}
                    {f.nullable ? "?" : ""}
                    {f.foreignKey ? ` → ${f.foreignKey}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* API Routes */}
      <CollapsibleSection title="API Routes" icon="⚡" count={blueprint.routePlan.length}>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              fontSize: "13px",
              borderCollapse: "collapse",
              color: "#9898a8",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #23232f" }}>
                {["Method", "Path", "Description", "Auth"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "#f0f0f5", fontSize: "12px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blueprint.routePlan.map((r, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: "1px solid rgba(35, 35, 47, 0.5)" }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      style={{
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "4px",
                        background: methodColor(r.method),
                        color: "#fff",
                      }}
                    >
                      {r.method}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: "12px" }}>{r.path}</td>
                  <td style={{ padding: "8px 12px" }}>{r.description}</td>
                  <td style={{ padding: "8px 12px" }}>{r.auth ? "🔒" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Frontend Pages */}
      <CollapsibleSection title="Frontend Pages" icon="🎨" count={blueprint.frontendPages.length}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {blueprint.frontendPages.map((page) => (
            <div
              key={page.route}
              style={{
                padding: "12px 16px",
                background: "#1a1a26",
                borderRadius: "10px",
                border: "1px solid #23232f",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#f0f0f5" }}>{page.name}</span>
                <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#6366f1" }}>{page.route}</span>
                {page.auth && <span style={{ fontSize: "11px", color: "#fbbf24" }}>🔒 Auth</span>}
              </div>
              <p style={{ fontSize: "13px", color: "#9898a8", margin: 0 }}>{page.description}</p>
              <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                {page.components.map((c) => (
                  <span
                    key={c}
                    style={{
                      padding: "2px 8px",
                      fontSize: "11px",
                      borderRadius: "6px",
                      background: "rgba(139, 92, 246, 0.1)",
                      color: "#a78bfa",
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* DevOps */}
      <CollapsibleSection title="DevOps / Infra Plan" icon="🚀">
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px", color: "#9898a8" }}>
          <Row label="Docker" value={blueprint.infraPlan.docker ? "Yes ✓" : "No"} />
          <Row label="CI" value={blueprint.infraPlan.ci.join(", ") || "—"} />
          <Row label="Deployment" value={blueprint.infraPlan.deployment.join(", ") || "—"} />
          <Row label="Env Vars" value={blueprint.infraPlan.envVars.join(", ") || "—"} />
        </div>
      </CollapsibleSection>

      {/* Reviewer Notes */}
      <CollapsibleSection title="Reviewer Notes" icon="🔍" count={blueprint.reviewerNotes.length}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {blueprint.reviewerNotes.map((note, i) => (
            <div
              key={i}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                background:
                  note.severity === "error"
                    ? "rgba(244, 63, 94, 0.08)"
                    : note.severity === "warning"
                      ? "rgba(251, 191, 36, 0.08)"
                      : "rgba(56, 189, 248, 0.08)",
                borderLeft: `3px solid ${
                  note.severity === "error" ? "#f43f5e" : note.severity === "warning" ? "#fbbf24" : "#38bdf8"
                }`,
                color: "#f0f0f5",
              }}
            >
              <span style={{ fontSize: "11px", color: "#5c5c6f", fontWeight: 600, textTransform: "uppercase" }}>
                [{note.agent}]
              </span>{" "}
              {note.note}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* File Tree */}
      <CollapsibleSection title="Project Structure" icon="📂" count={blueprint.folderStructure.length}>
        <FileTree nodes={blueprint.folderStructure} />
      </CollapsibleSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "12px" }}>
      <span style={{ fontWeight: 600, color: "#f0f0f5", minWidth: "100px" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function methodColor(method: string): string {
  switch (method) {
    case "GET":    return "rgba(52, 211, 153, 0.3)";
    case "POST":   return "rgba(56, 189, 248, 0.3)";
    case "PUT":    return "rgba(251, 191, 36, 0.3)";
    case "PATCH":  return "rgba(168, 85, 247, 0.3)";
    case "DELETE": return "rgba(244, 63, 94, 0.3)";
    default:       return "rgba(92, 92, 111, 0.3)";
  }
}
