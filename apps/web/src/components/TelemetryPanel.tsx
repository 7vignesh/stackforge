import React, { useEffect, useMemo, useState } from "react";

type ProviderStats = {
  calls: number;
  tokens: number;
};

type RunTelemetry = {
  runId: string;
  startTime: number;
  endTime: number | null;
  elapsedTimeMs: number;
  agentsTotal: number;
  agentsCompleted: number;
  totalTokensUsed: number;
  tokensByAgent: Record<string, number>;
  providerBreakdown: {
    gemini: ProviderStats;
    groq: ProviderStats;
  };
  estimatedCostINR: number;
};

function formatInt(value: number): string {
  return value.toLocaleString("en-IN");
}

function formatCost(value: number): string {
  return `\u20B9${value.toFixed(2)}`;
}

function formatElapsed(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function AnimatedNumber({
  display,
  watchValue,
}: {
  display: string;
  watchValue: number;
}) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const timeout = window.setTimeout(() => setPulse(false), 200);
    return () => window.clearTimeout(timeout);
  }, [watchValue]);

  return (
    <span
      style={{
        display: "inline-block",
        transform: pulse ? "scale(1.1)" : "scale(1)",
        transition: "transform 200ms ease",
      }}
    >
      {display}
    </span>
  );
}

export function TelemetryPanel({ jobId, isDemo = false }: { jobId?: string; isDemo?: boolean }) {
  const [telemetry, setTelemetry] = useState<RunTelemetry | null>(null);
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!jobId || isDemo) {
      setTelemetry(null);
      return;
    }

    const source = new EventSource(`/api/stream/${jobId}`);

    source.addEventListener("telemetry_update", (event) => {
      try {
        const payload = JSON.parse(event.data) as { data?: RunTelemetry };
        if (payload.data) {
          setTelemetry(payload.data);
        }
      } catch {
        // Ignore malformed telemetry payloads.
      }
    });

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [jobId, isDemo]);

  useEffect(() => {
    if (telemetry === null) {
      setLiveElapsedSeconds(0);
      return;
    }

    const computeElapsed = () => {
      const end = telemetry.endTime ?? Date.now();
      const seconds = Math.max(0, (end - telemetry.startTime) / 1000);
      setLiveElapsedSeconds(seconds);
    };

    computeElapsed();

    if (telemetry.endTime !== null) {
      return;
    }

    const interval = window.setInterval(computeElapsed, 250);
    return () => window.clearInterval(interval);
  }, [telemetry]);

  const providerRatios = useMemo(() => {
    const geminiCalls = telemetry?.providerBreakdown.gemini.calls ?? 0;
    const groqCalls = telemetry?.providerBreakdown.groq.calls ?? 0;
    const total = geminiCalls + groqCalls;

    if (total === 0) {
      return { gemini: 0, groq: 0 };
    }

    return {
      gemini: (geminiCalls / total) * 100,
      groq: (groqCalls / total) * 100,
    };
  }, [telemetry]);

  if (!jobId || isDemo || telemetry === null) {
    return null;
  }

  return (
    <aside
      style={{
        position: "fixed",
        right: "20px",
        bottom: "20px",
        width: "min(360px, calc(100vw - 32px))",
        zIndex: 40,
        background: "#12121b",
        border: "1px solid #23232f",
        borderRadius: "14px",
        boxShadow: "0 14px 38px rgba(0, 0, 0, 0.45)",
        padding: "16px",
      }}
    >
      <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "12px", color: "#f0f0f5" }}>
        📊 This Run
      </div>

      <div style={{ borderTop: "1px solid #23232f", borderBottom: "1px solid #23232f", padding: "12px 0" }}>
        <StatRow
          label="Total tokens"
          value={<AnimatedNumber display={formatInt(telemetry.totalTokensUsed)} watchValue={telemetry.totalTokensUsed} />}
        />
        <StatRow
          label="Estimated cost"
          value={<AnimatedNumber display={formatCost(telemetry.estimatedCostINR)} watchValue={telemetry.estimatedCostINR} />}
        />
        <StatRow
          label="Elapsed time"
          value={<AnimatedNumber display={formatElapsed(liveElapsedSeconds)} watchValue={Math.round(liveElapsedSeconds * 10)} />}
        />
        <StatRow
          label="Agents done"
          value={
            <AnimatedNumber
              display={`${telemetry.agentsCompleted} / ${telemetry.agentsTotal}`}
              watchValue={telemetry.agentsCompleted}
            />
          }
        />
      </div>

      <div style={{ marginTop: "12px" }}>
        <div style={{ fontSize: "13px", color: "#9898a8", marginBottom: "10px" }}>Provider breakdown:</div>

        <ProviderRow
          name="Gemini"
          calls={telemetry.providerBreakdown.gemini.calls}
          ratio={providerRatios.gemini}
          colorClass="bg-blue-500"
        />
        <ProviderRow
          name="Groq"
          calls={telemetry.providerBreakdown.groq.calls}
          ratio={providerRatios.groq}
          colorClass="bg-purple-500"
        />
      </div>
    </aside>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "13px",
        color: "#f0f0f5",
        marginBottom: "7px",
      }}
    >
      <span style={{ color: "#9898a8" }}>{label}</span>
      <strong style={{ fontWeight: 700 }}>{value}</strong>
    </div>
  );
}

function ProviderRow({
  name,
  calls,
  ratio,
  colorClass,
}: {
  name: string;
  calls: number;
  ratio: number;
  colorClass: "bg-blue-500" | "bg-purple-500";
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "58px 1fr auto", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
      <span style={{ fontSize: "12px", color: "#f0f0f5" }}>{name}</span>
      <div style={{ background: "#1d1d2a", borderRadius: "999px", height: "10px", overflow: "hidden" }}>
        <div className={colorClass} style={{ width: `${ratio}%`, height: "100%", transition: "width 300ms ease" }} />
      </div>
      <span style={{ fontSize: "12px", color: "#9898a8", minWidth: "56px", textAlign: "right" }}>{calls} calls</span>
    </div>
  );
}
