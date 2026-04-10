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
  providerBreakdown: Record<string, ProviderStats>;
  modelBreakdown: Record<string, ProviderStats>;
  estimatedCostINR: number;
};

type BreakdownEntry = {
  name: string;
  calls: number;
  tokens: number;
};

function toDisplayName(value: string): string {
  if (value.length === 0) {
    return "unknown";
  }

  return value
    .split(/[-_/]/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function topEntries(map: Record<string, ProviderStats>, max = 5): BreakdownEntry[] {
  return Object.entries(map)
    .map(([name, stats]) => ({ name, calls: stats.calls, tokens: stats.tokens }))
    .sort((a, b) => b.calls - a.calls || b.tokens - a.tokens)
    .slice(0, max);
}

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

  const providerRows = useMemo(() => topEntries(telemetry?.providerBreakdown ?? {}), [telemetry]);
  const modelRows = useMemo(() => topEntries(telemetry?.modelBreakdown ?? {}), [telemetry]);
  const providerTotalCalls = useMemo(
    () => providerRows.reduce((sum, row) => sum + row.calls, 0),
    [providerRows],
  );
  const modelTotalCalls = useMemo(
    () => modelRows.reduce((sum, row) => sum + row.calls, 0),
    [modelRows],
  );

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
        {providerRows.length === 0 && (
          <div style={{ fontSize: "12px", color: "#6f6f84" }}>No provider calls yet</div>
        )}
        {providerRows.map((row, index) => (
          <ProviderRow
            key={`provider-${row.name}`}
            name={toDisplayName(row.name)}
            calls={row.calls}
            ratio={providerTotalCalls > 0 ? (row.calls / providerTotalCalls) * 100 : 0}
            color={index % 2 === 0 ? "#3b82f6" : "#a855f7"}
          />
        ))}
      </div>

      <div style={{ marginTop: "10px" }}>
        <div style={{ fontSize: "13px", color: "#9898a8", marginBottom: "10px" }}>Model breakdown:</div>
        {modelRows.length === 0 && (
          <div style={{ fontSize: "12px", color: "#6f6f84" }}>No model calls yet</div>
        )}
        {modelRows.map((row, index) => (
          <ProviderRow
            key={`model-${row.name}`}
            name={row.name}
            calls={row.calls}
            ratio={modelTotalCalls > 0 ? (row.calls / modelTotalCalls) * 100 : 0}
            color={index % 2 === 0 ? "#22c55e" : "#14b8a6"}
          />
        ))}
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
  color,
}: {
  name: string;
  calls: number;
  ratio: number;
  color: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(84px, 1fr) 2fr auto", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
      <span
        title={name}
        style={{
          fontSize: "12px",
          color: "#f0f0f5",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </span>
      <div style={{ background: "#1d1d2a", borderRadius: "999px", height: "10px", overflow: "hidden" }}>
        <div style={{ width: `${ratio}%`, height: "100%", transition: "width 300ms ease", background: color }} />
      </div>
      <span style={{ fontSize: "12px", color: "#9898a8", minWidth: "56px", textAlign: "right" }}>{calls} calls</span>
    </div>
  );
}
