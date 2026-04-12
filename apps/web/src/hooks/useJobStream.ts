import { useState, useEffect, useCallback } from "react";
import { runDemoSimulation } from "../lib/mock-data";

export type AgentStatus = "waiting" | "running" | "completed" | "failed";

export interface AgentState {
  name: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  model?: string;
  totalTokens?: number;
  streamBuffer?: string;
}

export interface JobStreamState {
  agents: AgentState[];
  jobStatus: "queued" | "running" | "completed" | "failed";
  jobError?: string;
  connected: boolean;
}

const AGENT_ORDER = ["planner", "schema", "api", "frontend", "devops", "reviewer", "codegen"] as const;

function createInitialAgents(includeCodegen: boolean): AgentState[] {
  return AGENT_ORDER
    .filter((name) => includeCodegen || name !== "codegen")
    .map((name) => ({ name, status: "waiting" as AgentStatus }));
}

export function useJobStream(
  jobId: string | undefined,
  isDemo = false,
  includeCodegen = true,
): JobStreamState {
  const [agents, setAgents] = useState<AgentState[]>(() => createInitialAgents(includeCodegen));
  const [jobStatus, setJobStatus] = useState<JobStreamState["jobStatus"]>("queued");
  const [jobError, setJobError] = useState<string | undefined>();
  const [connected, setConnected] = useState(false);

  const handleEvent = useCallback((data: Record<string, unknown>) => {
    const type = data["type"] as string;

    switch (type) {
      case "job_created":
        setJobStatus("running");
        break;

      case "agent_started":
        setAgents((prev) =>
          prev.map((a) =>
            a.name === data["agent"]
              ? {
                  ...a,
                  status: "running" as AgentStatus,
                  startedAt: data["timestamp"] as string,
                  streamBuffer: "",
                }
              : a,
          ),
        );
        break;

      case "agent_token":
        setAgents((prev) =>
          prev.map((a) =>
            a.name === data["agentId"]
              ? {
                  ...a,
                  status: "running" as AgentStatus,
                  streamBuffer: `${a.streamBuffer ?? ""}${String(data["token"] ?? "")}`,
                }
              : a,
          ),
        );
        break;

      case "agent_complete":
        setAgents((prev) =>
          prev.map((a) => {
            if (a.name !== data["agentId"]) {
              return a;
            }

            const existingBuffer = a.streamBuffer ?? "";
            const fallbackOutput = (() => {
              if (existingBuffer.length > 0) {
                return existingBuffer;
              }

              try {
                return JSON.stringify(data["fullOutput"], null, 2);
              } catch {
                return String(data["fullOutput"] ?? "");
              }
            })();

            return {
              ...a,
              status: a.status === "failed" ? "failed" : "completed",
              streamBuffer: fallbackOutput,
            };
          }),
        );
        break;

      case "agent_completed": {
        const payload = data["payload"] as Record<string, unknown>;
        setAgents((prev) =>
          prev.map((a) =>
            a.name === data["agent"]
              ? {
                  ...a,
                  status: "completed" as AgentStatus,
                  completedAt: data["timestamp"] as string,
                  durationMs: payload["durationMs"] as number,
                  model: payload["model"] as string | undefined,
                  totalTokens: payload["totalTokens"] as number | undefined,
                }
              : a,
          ),
        );
        break;
      }

      case "agent_failed": {
        const payload = data["payload"] as Record<string, unknown>;
        setAgents((prev) =>
          prev.map((a) =>
            a.name === data["agent"]
              ? { ...a, status: "failed" as AgentStatus, error: payload["error"] as string }
              : a,
          ),
        );
        break;
      }

      case "job_completed":
        setJobStatus("completed");
        setAgents((prev) => prev.filter((agent) => agent.status !== "waiting"));
        break;

      case "job_failed": {
        const payload = data["payload"] as Record<string, unknown>;
        setJobStatus("failed");
        setJobError(payload["error"] as string);
        break;
      }
    }
  }, []);

  // Demo mode — simulate locally
  useEffect(() => {
    if (!jobId || !isDemo) return;

    setAgents(createInitialAgents(includeCodegen));
    setJobStatus("queued");
    setJobError(undefined);
    setConnected(true);

    const cancel = runDemoSimulation(
      jobId,
      (event) => handleEvent(event as unknown as Record<string, unknown>),
      () => setConnected(false),
    );

    return cancel;
  }, [jobId, isDemo, includeCodegen, handleEvent]);

  // Real SSE mode
  useEffect(() => {
    if (!jobId || isDemo) return;

    setAgents(createInitialAgents(includeCodegen));
    setJobStatus("queued");
    setJobError(undefined);

    const source = new EventSource(`/api/stream/${jobId}`);

    source.onopen = () => setConnected(true);

    source.addEventListener("job_created", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("agent_started", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("agent_token", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("agent_complete", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("agent_completed", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("agent_failed", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("job_completed", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });
    source.addEventListener("job_failed", (e) => {
      handleEvent(JSON.parse(e.data) as Record<string, unknown>);
    });

    source.onerror = () => {
      setConnected(false);
      source.close();
    };

    return () => {
      source.close();
    };
  }, [jobId, isDemo, includeCodegen, handleEvent]);

  return { agents, jobStatus, jobError, connected };
}
