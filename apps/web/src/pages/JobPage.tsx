import React, { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Button, Spinner, useToast } from "@stackforge/ui";
import { AgentTimeline } from "../components/AgentTimeline";
import { BlueprintView } from "../components/BlueprintView";
import { FeatureDiffPanel } from "../components/FeatureDiffPanel";
import { TelemetryPanel } from "../components/TelemetryPanel";
import { useJobStream } from "../hooks/useJobStream";
import {
  addFeatureToPipeline,
  downloadProjectZip,
  getJob,
  type AddFeatureResponse,
  type JobResponse,
  type PipelineAgentId,
} from "../lib/api";
import { MOCK_BLUEPRINT } from "../lib/mock-data";

const UPDATE_AGENT_ORDER: PipelineAgentId[] = ["planner", "schema", "api", "frontend", "devops"];

type UpdateAgentStatus = "running" | "complete" | "error" | "unchanged";

type UpdateFlowState = {
  isRunning: boolean;
  featureRequest: string;
  affectedAgents: PipelineAgentId[];
  statuses: Record<PipelineAgentId, UpdateAgentStatus>;
  result?: AddFeatureResponse;
};

function estimateAffectedAgents(featureRequest: string): PipelineAgentId[] {
  const lowered = featureRequest.toLowerCase();
  const includes = (parts: string[]) => parts.some((part) => lowered.includes(part));

  const affected = new Set<PipelineAgentId>();
  if (includes(["schema", "entity", "table", "database", "column", "relation", "payment", "stripe"])) affected.add("schema");
  if (includes(["api", "route", "endpoint", "controller", "webhook", "auth", "payment", "stripe"])) affected.add("api");
  if (includes(["frontend", "ui", "page", "component", "screen", "payment", "checkout", "stripe"])) affected.add("frontend");
  if (includes(["deploy", "docker", "infra", "ci", "pipeline", "env", "secret"])) affected.add("devops");
  if (includes(["architecture", "stack", "monorepo", "folder", "project", "framework"])) affected.add("planner");

  if (affected.size === 0) {
    return [...UPDATE_AGENT_ORDER];
  }

  return UPDATE_AGENT_ORDER.filter((agent) => affected.has(agent));
}

function createStatusMap(affectedAgents: PipelineAgentId[], affectedStatus: UpdateAgentStatus): Record<PipelineAgentId, UpdateAgentStatus> {
  return Object.fromEntries(
    UPDATE_AGENT_ORDER.map((agent) => [agent, affectedAgents.includes(agent) ? affectedStatus : "unchanged"]),
  ) as Record<PipelineAgentId, UpdateAgentStatus>;
}

function summarizeUpdateBadge(result: AddFeatureResponse): string {
  const countFor = (agent: PipelineAgentId): number => {
    const added = result.diff.added.find((x) => x.agentId === agent)?.items.length ?? 0;
    const modified = result.diff.modified.find((x) => x.agentId === agent)?.items.length ?? 0;
    const removed = result.diff.removed.find((x) => x.agentId === agent)?.items.length ?? 0;
    return added + modified + removed;
  };

  const newRoutes = result.diff.added.find((x) => x.agentId === "api")?.items.length ?? 0;
  const schemaChanges = countFor("schema");
  return `${result.agentsRerun.length} agents updated · ${newRoutes} new routes · ${schemaChanges} schema change`;
}

export function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const includeCodegen = searchParams.get("codegen") !== "0";

  const { addToast } = useToast();
  const stream = useJobStream(jobId, isDemo, includeCodegen);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [featureRequest, setFeatureRequest] = useState("");
  const [updateFlow, setUpdateFlow] = useState<UpdateFlowState>({
    isRunning: false,
    featureRequest: "",
    affectedAgents: [],
    statuses: createStatusMap([], "unchanged"),
  });
  const [isUpdatedZipLoading, setIsUpdatedZipLoading] = useState(false);

  // Fetch job details
  useEffect(() => {
    if (!jobId) return;
    if (isDemo) {
      setJob({
        id: jobId,
        status: "running",
        projectName: MOCK_BLUEPRINT.projectName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentsCompleted: [],
      });
      return;
    }

    getJob(jobId)
      .then(setJob)
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load job");
      });
  }, [jobId, isDemo]);

  // Re-fetch when job completes to get blueprint
  useEffect(() => {
    if (!jobId || stream.jobStatus !== "completed") return;
    
    if (isDemo) {
      setJob((prev) => prev ? { ...prev, status: "completed", blueprint: MOCK_BLUEPRINT } : null);
      addToast("success", "Demo blueprint generation complete!");
      return;
    }

    getJob(jobId).then(setJob).catch(() => {});
    addToast("success", "Blueprint generation complete!");
  }, [stream.jobStatus, jobId, isDemo, addToast]);

  // Notify on failure
  useEffect(() => {
    if (stream.jobStatus === "failed") {
      addToast("error", stream.jobError ?? "Job failed");
    }
  }, [stream.jobStatus, stream.jobError, addToast]);

  async function handleFeatureUpdateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!jobId || !job?.blueprint) {
      return;
    }

    const request = featureRequest.trim();
    if (request.length < 3) {
      addToast("error", "Feature request must be at least 3 characters");
      return;
    }

    const predicted = estimateAffectedAgents(request);
    setUpdateFlow({
      isRunning: true,
      featureRequest: request,
      affectedAgents: predicted,
      statuses: createStatusMap(predicted, "running"),
    });

    try {
      const result = await addFeatureToPipeline({
        runId: jobId,
        previousOutput: job.blueprint,
        featureRequest: request,
      });

      setJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          blueprint: result.updatedOutput,
          updatedAt: new Date().toISOString(),
        };
      });

      setUpdateFlow({
        isRunning: false,
        featureRequest: request,
        affectedAgents: result.agentsRerun,
        statuses: createStatusMap(result.agentsRerun, "complete"),
        result,
      });

      addToast("success", "Blueprint updated with your feature request");
      setFeatureRequest("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update blueprint";
      setUpdateFlow((prev) => ({
        ...prev,
        isRunning: false,
        statuses: createStatusMap(prev.affectedAgents, "error"),
      }));
      addToast("error", message);
    }
  }

  async function handleDownloadUpdatedZip() {
    if (!updateFlow.result?.updatedOutput) {
      return;
    }

    try {
      setIsUpdatedZipLoading(true);
      const { blob, filename } = await downloadProjectZip(updateFlow.result.updatedOutput as unknown as Record<string, unknown>);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      addToast("success", "Updated ZIP download is ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to download updated ZIP";
      addToast("error", message);
    } finally {
      setIsUpdatedZipLoading(false);
    }
  }

  if (!jobId) {
    return (
      <PageShell>
        <p style={{ color: "#f43f5e" }}>Invalid job ID</p>
        <Link to="/" style={{ color: "#6366f1", textDecoration: "none", fontSize: "14px" }}>
          ← Back to home
        </Link>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <div
          style={{
            padding: "24px",
            background: "rgba(244, 63, 94, 0.08)",
            border: "1px solid rgba(244, 63, 94, 0.2)",
            borderRadius: "14px",
            textAlign: "center",
          }}
        >
          <p style={{ color: "#f43f5e", fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
            Failed to load job
          </p>
          <p style={{ color: "#9898a8", fontSize: "14px" }}>{loadError}</p>
          <Link to="/" style={{ color: "#6366f1", textDecoration: "none", fontSize: "14px", marginTop: "16px", display: "inline-block" }}>
            ← Back to home
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "32px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <Link
              to="/"
              style={{ fontSize: "13px", color: "#9898a8", textDecoration: "none", display: "block", marginBottom: "8px" }}
            >
              ← Back to home
            </Link>
            <h1 style={{ fontSize: "24px", fontWeight: 700 }}>
              {job?.projectName ?? "Loading..."}
            </h1>
            <p style={{ fontSize: "13px", color: "#5c5c6f", marginTop: "4px" }}>
              Job {jobId.slice(0, 8)}...
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {stream.connected && (
              <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#34d399" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34d399" }} />
                Live
              </span>
            )}
            <StatusPill status={stream.jobStatus} />
          </div>
        </div>

        {/* Two-column layout on large screens */}
        <div style={{ display: "grid", gridTemplateColumns: stream.jobStatus === "completed" && job?.blueprint ? "380px 1fr" : "1fr", gap: "32px" }}>
          {/* Agent Timeline */}
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "#9898a8" }}>
              Agent Progress
            </h2>
            <AgentTimeline agents={stream.agents} />
          </div>

          {/* Blueprint */}
          {stream.jobStatus === "completed" && job?.blueprint && (
            <div>
              <div style={{ marginBottom: "14px", border: "1px solid #23232f", borderRadius: "12px", padding: "14px" }}>
                <form onSubmit={handleFeatureUpdateSubmit} style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <input
                    value={featureRequest}
                    onChange={(e) => setFeatureRequest(e.target.value)}
                    placeholder="✦ Add a feature... (e.g. 'Add Stripe payments')"
                    style={{
                      flex: 1,
                      minWidth: "240px",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #2a2a38",
                      background: "#161622",
                      color: "#f0f0f5",
                      fontSize: "13px",
                    }}
                    disabled={updateFlow.isRunning}
                  />
                  <Button type="submit" variant="secondary" loading={updateFlow.isRunning}>
                    Update Blueprint
                  </Button>
                </form>

                {(updateFlow.isRunning || updateFlow.affectedAgents.length > 0) && (
                  <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "8px" }}>
                    {UPDATE_AGENT_ORDER.map((agent) => {
                      const status = updateFlow.statuses[agent];
                      const bg = status === "running"
                        ? "rgba(56, 189, 248, 0.14)"
                        : status === "complete"
                          ? "rgba(34, 197, 94, 0.12)"
                          : status === "error"
                            ? "rgba(239, 68, 68, 0.12)"
                            : "rgba(92, 92, 111, 0.14)";
                      const border = status === "running"
                        ? "#38bdf8"
                        : status === "complete"
                          ? "#22c55e"
                          : status === "error"
                            ? "#ef4444"
                            : "#4b4b60";
                      const label = status === "running"
                        ? "rerunning"
                        : status === "complete"
                          ? "updated"
                          : status === "error"
                            ? "error"
                            : "unchanged";

                      return (
                        <div key={agent} style={{ background: bg, border: `1px solid ${border}`, borderRadius: "10px", padding: "8px" }}>
                          <div style={{ fontSize: "12px", color: "#f0f0f5", textTransform: "capitalize", fontWeight: 600 }}>{agent}</div>
                          <div style={{ fontSize: "11px", color: status === "unchanged" ? "#a6a6bb" : "#dbe6ff" }}>{label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {updateFlow.result && (
                  <div style={{ marginTop: "12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "12px", color: "#a5b4fc", fontWeight: 700 }}>
                      {summarizeUpdateBadge(updateFlow.result)}
                    </div>
                    <Button variant="secondary" loading={isUpdatedZipLoading} onClick={handleDownloadUpdatedZip}>
                      Download Updated ZIP
                    </Button>
                  </div>
                )}
              </div>

              {updateFlow.result && (
                <div style={{ marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "10px", color: "#9898a8" }}>
                    Diff
                  </h2>
                  <FeatureDiffPanel diff={updateFlow.result.diff} />
                </div>
              )}

              <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "#9898a8" }}>
                Generated Blueprint
              </h2>
              <BlueprintView blueprint={job.blueprint} />
            </div>
          )}
        </div>

        {/* Error state */}
        {stream.jobStatus === "failed" && (
          <div
            className="animate-fade-in"
            style={{
              marginTop: "32px",
              padding: "24px",
              background: "rgba(244, 63, 94, 0.06)",
              border: "1px solid rgba(244, 63, 94, 0.2)",
              borderRadius: "14px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "16px", fontWeight: 600, color: "#f43f5e", marginBottom: "8px" }}>
              Generation Failed
            </p>
            <p style={{ fontSize: "14px", color: "#9898a8", marginBottom: "16px" }}>
              {stream.jobError ?? "An unexpected error occurred"}
            </p>
            <Button variant="secondary" onClick={() => window.location.href = "/"}>
              Try Again
            </Button>
          </div>
        )}

        {/* Loading indicator when still running */}
        {(stream.jobStatus === "queued" || stream.jobStatus === "running") && !job && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px" }}>
            <Spinner size={32} />
          </div>
        )}
      </PageShell>
      <TelemetryPanel jobId={jobId} isDemo={isDemo} />
    </>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "40px 24px" }}>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string }> = {
    queued:    { bg: "rgba(92, 92, 111, 0.15)", color: "#9898a8" },
    running:   { bg: "rgba(56, 189, 248, 0.12)", color: "#38bdf8" },
    completed: { bg: "rgba(52, 211, 153, 0.12)", color: "#34d399" },
    failed:    { bg: "rgba(244, 63, 94, 0.12)", color: "#f43f5e" },
  };
  const c = config[status] ?? config["queued"]!;

  return (
    <span
      style={{
        padding: "4px 14px",
        fontSize: "13px",
        fontWeight: 600,
        borderRadius: "20px",
        background: c.bg,
        color: c.color,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}
