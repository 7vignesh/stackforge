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

function rerunStatusClass(status: UpdateAgentStatus): string {
  if (status === "running") return "is-running";
  if (status === "complete") return "is-complete";
  if (status === "error") return "is-error";
  return "is-unchanged";
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
        <div className="sf-job-inline-alert is-error">
          <p>Invalid job ID</p>
        </div>
        <Link to="/" className="sf-job-back-link">
          ← Back to home
        </Link>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell>
        <div className="sf-job-inline-alert is-error sf-job-alert-center">
          <p className="sf-job-alert-title">
            Failed to load job
          </p>
          <p className="sf-job-alert-text">{loadError}</p>
          <Link to="/" className="sf-job-back-link">
            ← Back to home
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <div className="sf-job-page">
        <div className="sf-job-hero-lighting" aria-hidden="true">
          <div className="sf-job-vertical-rays" />
          <div className="sf-job-ambient-bloom" />
          <div className="sf-job-arc-svg-container">
            <svg width="100%" height="100%" viewBox="0 0 1400 600" preserveAspectRatio="none">
              <defs>
                <linearGradient id="job-core-glow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="35%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="47%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="50%" stopColor="rgba(255,255,255,1)" />
                  <stop offset="53%" stopColor="rgba(255,255,255,0.9)" />
                  <stop offset="65%" stopColor="rgba(255,255,255,0)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </linearGradient>

                <linearGradient id="job-ambient-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="rgba(56,189,248,0)" />
                  <stop offset="25%" stopColor="rgba(56,189,248,0.08)" />
                  <stop offset="40%" stopColor="rgba(56,189,248,0.28)" />
                  <stop offset="50%" stopColor="rgba(186,230,253,0.45)" />
                  <stop offset="60%" stopColor="rgba(56,189,248,0.28)" />
                  <stop offset="75%" stopColor="rgba(56,189,248,0.08)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                </linearGradient>
              </defs>
              <path d="M 0 600 Q 700 120 1400 600" fill="none" stroke="url(#job-ambient-grad)" strokeWidth="54" filter="blur(30px)" opacity="0.25" />
              <path d="M 0 600 Q 700 120 1400 600" fill="none" stroke="url(#job-ambient-grad)" strokeWidth="13" filter="blur(7px)" opacity="0.5" />
              <path d="M 0 600 Q 700 120 1400 600" fill="none" stroke="url(#job-core-glow)" strokeWidth="2" />
            </svg>
          </div>
          <div className="sf-job-core-flare" />
        </div>

        <PageShell>
        {/* Header */}
        <div className="sf-job-header">
          <div>
            <Link to="/" className="sf-job-back-link sf-job-back-link-compact">
              ← Back to home
            </Link>
            <h1 className="sf-job-title">
              {job?.projectName ?? "Loading..."}
            </h1>
            <p className="sf-job-subtitle">
              Job {jobId.slice(0, 8)}...
            </p>
          </div>

          <div className="sf-job-status-wrap">
            {stream.connected && (
              <span className="sf-job-live-pill">
                <span className="sf-job-live-dot" />
                Live
              </span>
            )}
            <StatusPill status={stream.jobStatus} />
          </div>
        </div>

        {/* Two-column layout on large screens */}
        <div className={`sf-job-grid ${stream.jobStatus === "completed" && job?.blueprint ? "has-blueprint" : ""}`}>
          {/* Agent Timeline */}
          <section className="sf-job-panel sf-job-panel-sticky">
            <h2 className="sf-job-panel-title">
              Agent Progress
            </h2>
            <AgentTimeline agents={stream.agents} />
          </section>

          {/* Blueprint */}
          {stream.jobStatus === "completed" && job?.blueprint && (
            <section className="sf-job-panel sf-job-panel-content">
              <div className="sf-job-update-card">
                <form onSubmit={handleFeatureUpdateSubmit} className="sf-job-update-form">
                  <input
                    value={featureRequest}
                    onChange={(e) => setFeatureRequest(e.target.value)}
                    placeholder="✦ Add a feature... (e.g. 'Add Stripe payments')"
                    className="sf-job-feature-input"
                    disabled={updateFlow.isRunning}
                  />
                  <Button type="submit" variant="secondary" loading={updateFlow.isRunning}>
                    Update Blueprint
                  </Button>
                </form>

                {(updateFlow.isRunning || updateFlow.affectedAgents.length > 0) && (
                  <div className="sf-job-agent-rerun-grid">
                    {UPDATE_AGENT_ORDER.map((agent) => {
                      const status = updateFlow.statuses[agent];
                      const label = status === "running"
                        ? "rerunning"
                        : status === "complete"
                          ? "updated"
                          : status === "error"
                            ? "error"
                            : "unchanged";

                      return (
                        <div key={agent} className={`sf-job-agent-rerun-item ${rerunStatusClass(status)}`}>
                          <div className="sf-job-agent-rerun-name">{agent}</div>
                          <div className={`sf-job-agent-rerun-label ${status === "unchanged" ? "is-muted" : ""}`}>{label}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {updateFlow.result && (
                  <div className="sf-job-update-summary">
                    <div className="sf-job-update-summary-text">
                      {summarizeUpdateBadge(updateFlow.result)}
                    </div>
                    <Button variant="secondary" loading={isUpdatedZipLoading} onClick={handleDownloadUpdatedZip}>
                      Download Updated ZIP
                    </Button>
                  </div>
                )}
              </div>

              {updateFlow.result && (
                <div className="sf-job-section-gap">
                  <h2 className="sf-job-panel-title">
                    Diff
                  </h2>
                  <FeatureDiffPanel diff={updateFlow.result.diff} />
                </div>
              )}

              <h2 className="sf-job-panel-title">
                Generated Blueprint
              </h2>
              <BlueprintView blueprint={job.blueprint} />
            </section>
          )}
        </div>

        {/* Error state */}
        {stream.jobStatus === "failed" && (
          <div className="animate-fade-in sf-job-inline-alert is-error sf-job-alert-center sf-job-failed-wrap">
            <p className="sf-job-alert-title">
              Generation Failed
            </p>
            <p className="sf-job-alert-text sf-job-alert-text-spaced">
              {stream.jobError ?? "An unexpected error occurred"}
            </p>
            <Button variant="secondary" onClick={() => window.location.href = "/"}>
              Try Again
            </Button>
          </div>
        )}

        {/* Loading indicator when still running */}
        {(stream.jobStatus === "queued" || stream.jobStatus === "running") && !job && (
          <div className="sf-job-loading-wrap">
            <Spinner size={32} />
          </div>
        )}
        </PageShell>
      </div>
      <TelemetryPanel jobId={jobId} isDemo={isDemo} />
    </>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="sf-job-shell">
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const statusClass = ["queued", "running", "completed", "failed"].includes(status) ? status : "queued";

  return (
    <span className={`sf-job-status-pill is-${statusClass}`}>
      {status}
    </span>
  );
}
