import React, { useEffect, useMemo, useRef, useState } from "react";

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
    <span className={`sf-telemetry-animated-number ${pulse ? "is-pulse" : ""}`}>
      {display}
    </span>
  );
}

export function TelemetryPanel({ jobId, isDemo = false }: { jobId?: string; isDemo?: boolean }) {
  const [telemetry, setTelemetry] = useState<RunTelemetry | null>(null);
  const [liveElapsedSeconds, setLiveElapsedSeconds] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });

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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current.active || panelRef.current === null) {
        return;
      }

      const panel = panelRef.current;
      const minX = 8;
      const minY = 8;
      const maxX = Math.max(minX, window.innerWidth - panel.offsetWidth - 8);
      const maxY = Math.max(minY, window.innerHeight - panel.offsetHeight - 8);
      const nextX = Math.min(maxX, Math.max(minX, event.clientX - dragStateRef.current.offsetX));
      const nextY = Math.min(maxY, Math.max(minY, event.clientY - dragStateRef.current.offsetY));

      setPosition({ x: nextX, y: nextY });
    };

    const handlePointerUp = () => {
      dragStateRef.current.active = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

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

  const panelStyle = position === null
    ? undefined
    : {
      left: `${position.x}px`,
      top: `${position.y}px`,
      right: "auto",
      bottom: "auto",
    };

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (panelRef.current === null) {
      return;
    }

    const rect = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      active: true,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };

    document.body.style.userSelect = "none";
  };

  return (
    <aside
      ref={panelRef}
      className="sf-telemetry-panel"
      style={panelStyle}
      onPointerDown={beginDrag}
    >
      <div className="sf-telemetry-header">
        <div className="sf-telemetry-title">
          📊 This Run
        </div>
        <button
          type="button"
          className="sf-telemetry-toggle"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? "Close" : "Open"}
        </button>
      </div>

      {isOpen && (
        <>
          <div className="sf-telemetry-stats-wrap">
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

          <div className="sf-telemetry-group">
            <div className="sf-telemetry-group-title">Provider breakdown:</div>
            {providerRows.length === 0 && (
              <div className="sf-telemetry-empty">No provider calls yet</div>
            )}
            {providerRows.map((row, index) => (
              <ProviderRow
                key={`provider-${row.name}`}
                name={toDisplayName(row.name)}
                calls={row.calls}
                ratio={providerTotalCalls > 0 ? (row.calls / providerTotalCalls) * 100 : 0}
                variant={index % 2 === 0 ? "provider-a" : "provider-b"}
              />
            ))}
          </div>

          <div className="sf-telemetry-group sf-telemetry-group-tight">
            <div className="sf-telemetry-group-title">Model breakdown:</div>
            {modelRows.length === 0 && (
              <div className="sf-telemetry-empty">No model calls yet</div>
            )}
            {modelRows.map((row, index) => (
              <ProviderRow
                key={`model-${row.name}`}
                name={row.name}
                calls={row.calls}
                ratio={modelTotalCalls > 0 ? (row.calls / modelTotalCalls) * 100 : 0}
                variant={index % 2 === 0 ? "model-a" : "model-b"}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sf-telemetry-stat-row">
      <span className="sf-telemetry-stat-label">{label}</span>
      <strong className="sf-telemetry-stat-value">{value}</strong>
    </div>
  );
}

function ProviderRow({
  name,
  calls,
  ratio,
  variant,
}: {
  name: string;
  calls: number;
  ratio: number;
  variant: "provider-a" | "provider-b" | "model-a" | "model-b";
}) {
  return (
    <div className="sf-telemetry-provider-row">
      <span
        title={name}
        className="sf-telemetry-provider-name"
      >
        {name}
      </span>
      <progress className={`sf-telemetry-provider-progress is-${variant}`} max={100} value={ratio} />
      <span className="sf-telemetry-provider-calls">{calls} calls</span>
    </div>
  );
}
