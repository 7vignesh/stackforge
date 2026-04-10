import React from "react";
import { Card, Button } from "@stackforge/ui";
import { CollapsibleSection } from "./CollapsibleSection";
import { FileTree } from "./FileTree";
import { useToast } from "@stackforge/ui";
import { downloadProjectZip, pushProjectToGithub, type Blueprint } from "../lib/api";

export function BlueprintView({ blueprint }: { blueprint: Blueprint }) {
  const { addToast } = useToast();
  const [isZipLoading, setIsZipLoading] = React.useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = React.useState(false);
  const [githubToken, setGithubToken] = React.useState("");
  const [tokenAcknowledged, setTokenAcknowledged] = React.useState(false);
  const [isPushing, setIsPushing] = React.useState(false);
  const [pushProgress, setPushProgress] = React.useState<string[]>([]);
  const [pushedRepoUrl, setPushedRepoUrl] = React.useState<string | null>(null);

  function handleDownload() {
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${blueprint.projectName}-blueprint.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleZipDownload() {
    try {
      setIsZipLoading(true);
      const { blob, filename } = await downloadProjectZip(blueprint as unknown as Record<string, unknown>);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      addToast("success", "Your project ZIP is ready!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project ZIP";
      addToast("error", message);
    } finally {
      setIsZipLoading(false);
    }
  }

  function openPushModal() {
    setIsPushModalOpen(true);
    setPushProgress([]);
    setPushedRepoUrl(null);
  }

  function closePushModal() {
    if (isPushing) {
      return;
    }

    setIsPushModalOpen(false);
    setGithubToken("");
    setTokenAcknowledged(false);
    setPushProgress([]);
    setPushedRepoUrl(null);
  }

  async function handlePushNow(event: React.FormEvent) {
    event.preventDefault();

    const token = githubToken.trim();
    if (token.length === 0) {
      addToast("error", "Enter a GitHub Personal Access Token");
      return;
    }

    if (!tokenAcknowledged) {
      addToast("error", "Confirm token usage acknowledgment before pushing");
      return;
    }

    try {
      setIsPushing(true);
      setPushProgress([]);
      setPushedRepoUrl(null);

      // Clear token from component state immediately after starting request.
      setGithubToken("");

      const result = await pushProjectToGithub(
        {
          pipelineOutput: blueprint,
          projectName: blueprint.projectName,
          githubToken: token,
        },
        (streamEvent) => {
          if (streamEvent.type === "progress" && streamEvent.message) {
            setPushProgress((prev) => [...prev, `✓ ${streamEvent.message}`]);
          }

          if (streamEvent.type === "result" && streamEvent.repoUrl) {
            setPushProgress((prev) => [...prev, "✓ Push complete"]);
          }
        },
      );

      setPushedRepoUrl(result.repoUrl);
      addToast("success", "Project pushed to GitHub");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to push to GitHub";
      setPushProgress((prev) => [...prev, `✗ ${message}`]);
      addToast("error", message);
    } finally {
      setIsPushing(false);
    }
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
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Button variant="secondary" onClick={openPushModal}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                <GitHubIcon />
                Push to GitHub
              </span>
            </Button>
            <Button variant="secondary" loading={isZipLoading} onClick={handleZipDownload}>
              Download ZIP
            </Button>
            <Button variant="ghost" onClick={handleDownload}>
              Download JSON
            </Button>
          </div>
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

      {isPushModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 9, 14, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "20px",
          }}
          onClick={closePushModal}
        >
          <div
            style={{
              width: "min(680px, 100%)",
              background: "#11131b",
              border: "1px solid #2a2a38",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 style={{ margin: 0, color: "#f0f0f5", fontSize: "18px", fontWeight: 700 }}>
                Enter your GitHub Personal Access Token
              </h3>
              <p style={{ margin: "6px 0 0", color: "#9898a8", fontSize: "13px" }}>
                Token is used only for this push request and is never persisted by StackForge.
              </p>
            </div>

            <form onSubmit={handlePushNow} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ color: "#d6d6e5", fontSize: "13px", fontWeight: 600 }}>GitHub PAT</span>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder="ghp_..."
                  disabled={isPushing}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #2f3242",
                    background: "#0c0e15",
                    color: "#f0f0f5",
                    fontSize: "13px",
                  }}
                />
              </label>

              <a
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#7dd3fc", fontSize: "12px", textDecoration: "none" }}
              >
                Create a GitHub Personal Access Token
              </a>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#c7c7d7", fontSize: "12px" }}>
                <input
                  type="checkbox"
                  checked={tokenAcknowledged}
                  onChange={(e) => setTokenAcknowledged(e.target.checked)}
                  disabled={isPushing}
                />
                I understand this token is used only for this push and not stored.
              </label>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <Button type="button" variant="ghost" onClick={closePushModal}>
                  Cancel
                </Button>
                <Button type="submit" variant="secondary" loading={isPushing}>
                  Push Now
                </Button>
              </div>
            </form>

            {(pushProgress.length > 0 || isPushing || pushedRepoUrl) && (
              <div style={{ borderTop: "1px solid #23232f", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ color: "#d6d6e5", fontSize: "13px", fontWeight: 600 }}>Push Progress</div>
                <div
                  style={{
                    background: "#0a0b11",
                    border: "1px solid #1d1f2a",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    maxHeight: "220px",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {pushProgress.map((item, idx) => (
                    <div key={`${item}-${idx}`} style={{ color: "#cfd9ff", fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>
                      {item}
                    </div>
                  ))}
                  {isPushing && (
                    <div style={{ color: "#7dd3fc", fontSize: "12px" }}>• Waiting for next update...</div>
                  )}
                </div>

                {pushedRepoUrl && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <a href={pushedRepoUrl} target="_blank" rel="noreferrer" style={{ color: "#86efac", fontSize: "13px", textDecoration: "none" }}>
                      {pushedRepoUrl}
                    </a>
                    <Button type="button" variant="secondary" onClick={() => window.open(pushedRepoUrl, "_blank", "noopener,noreferrer")}>
                      🎉 Pushed! View on GitHub →
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.11 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 4.77c.68 0 1.36.09 2 .26 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
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
