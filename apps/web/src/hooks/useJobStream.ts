import { useState, useEffect, useCallback, useRef } from "react";
import { runDemoSimulation } from "../lib/mock-data";
import { sanitizeStreamContent, sanitizeEventData } from "../lib/sanitize";

/**
 * Safely parse SSE event data with validation.
 * Returns null if parsing fails or data is malformed.
 */
function safeParseEventData(raw: string): Record<string, unknown> | null {
  if (!raw || raw.length > 1_000_000) {
    // Reject empty or suspiciously large payloads
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return sanitizeEventData(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

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
  const jobDoneRef = useRef(false);

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
                  streamBuffer: `${a.streamBuffer ?? ""}${sanitizeStreamContent(String(data["token"] ?? ""))}`,
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
        jobDoneRef.current = true;
        setJobStatus("completed");
        setConnected(false);
        setAgents((prev) => prev.filter((agent) => agent.status !== "waiting"));
        break;

      case "job_failed": {
        const payload = data["payload"] as Record<string, unknown>;
        jobDoneRef.current = true;
        setJobStatus("failed");
        setConnected(false);
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

  // Real SSE mode with exponential backoff reconnection
  useEffect(() => {
    if (!jobId || isDemo) return;

    // Reset only if starting fresh (not already done from a previous mount)
    if (!jobDoneRef.current) {
      setAgents(createInitialAgents(includeCodegen));
      setJobStatus("queued");
      setJobError(undefined);
    }

    let source: EventSource | null = null;
    let retryCount = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 1000;
    const MAX_DELAY_MS = 30000;

    function getBackoffDelay(attempt: number): number {
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
      // Add jitter (±25%)
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      return Math.round(delay + jitter);
    }

    function connectSSE() {
      if (isCancelled || jobDoneRef.current) return;

      source = new EventSource(`/api/stream/${jobId}`);

      source.onopen = () => {
        if (!jobDoneRef.current) {
          setConnected(true);
        }
        retryCount = 0; // Reset on successful connection
      };

      const EVENT_TYPES = [
        "job_created", "agent_started", "agent_token", "agent_complete",
        "agent_completed", "agent_failed", "job_completed", "job_failed",
      ] as const;

      for (const eventType of EVENT_TYPES) {
        source.addEventListener(eventType, (e) => {
          const data = safeParseEventData(e.data);
          if (data !== null) {
            handleEvent(data);
          }
        });
      }

      source.onerror = () => {
        source?.close();
        source = null;

        // Don't retry if job is done or cancelled
        if (isCancelled || jobDoneRef.current) return;

        setConnected(false);

        if (retryCount < MAX_RETRIES) {
          const delay = getBackoffDelay(retryCount);
          retryCount += 1;
          retryTimeout = setTimeout(connectSSE, delay);
        }
      };
    }

    connectSSE();

    return () => {
      isCancelled = true;
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout);
      }
      source?.close();
    };
  }, [jobId, isDemo, includeCodegen, handleEvent]);

  return { agents, jobStatus, jobError, connected };
}
