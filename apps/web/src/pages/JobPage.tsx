import React, { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { Button, Spinner, useToast } from "@stackforge/ui";
import { AgentTimeline } from "../components/AgentTimeline";
import { BlueprintView } from "../components/BlueprintView";
import { useJobStream } from "../hooks/useJobStream";
import { getJob, type JobResponse } from "../lib/api";
import { MOCK_BLUEPRINT } from "../lib/mock-data";

export function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";

  const { addToast } = useToast();
  const stream = useJobStream(jobId, isDemo);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
