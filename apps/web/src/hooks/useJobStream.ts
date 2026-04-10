import { useState, useEffect, useRef, useCallback } from "react";
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

const AGENT_ORDER = ["planner", "schema", "api", "frontend", "devops", "reviewer"] as const;

function createInitialAgents(): AgentState[] {
  return AGENT_ORDER.map((name) => ({ name, status: "waiting" as AgentStatus }));
}

export function useJobStream(jobId: string | undefined, isDemo = false): JobStreamState {
  const [agents, setAgents] = useState<AgentState[]>(createInitialAgents);
  const [jobStatus, setJobStatus] = useState<JobStreamState["jobStatus"]>("queued");
  const [jobError, setJobError] = useState<string | undefined>();
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

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

    setAgents(createInitialAgents());
    setJobStatus("queued");
    setJobError(undefined);
    setConnected(true);

    const cancel = runDemoSimulation(
      jobId,
      (event) => handleEvent(event as unknown as Record<string, unknown>),
      () => setConnected(false),
    );

    return cancel;
  }, [jobId, isDemo, handleEvent]);

  // Real SSE mode
  useEffect(() => {
    if (!jobId || isDemo) return;

    setAgents(createInitialAgents());
    setJobStatus("queued");
    setJobError(undefined);

    const source = new EventSource(`/api/stream/${jobId}`);
    sourceRef.current = source;

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
      sourceRef.current = null;
    };
  }, [jobId, isDemo, handleEvent]);

  return { agents, jobStatus, jobError, connected };
}
