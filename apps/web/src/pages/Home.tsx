import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, useToast } from "@stackforge/ui";
import { generateProject, getRuntime, type RuntimeResponse } from "../lib/api";

const FRONTEND_OPTIONS = ["react", "vue", "svelte"] as const;
const BACKEND_OPTIONS = ["express", "fastify", "hono"] as const;
const DATABASE_OPTIONS = ["postgres", "mysql", "mongodb"] as const;

export function Home() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [frontend, setFrontend] = useState("react");
  const [backend, setBackend] = useState("express");
  const [database, setDatabase] = useState("postgres");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const isValid = prompt.trim().length >= 10;
  const canGenerate = isValid && runtime?.ready !== false;

  useEffect(() => {
    getRuntime()
      .then((res) => {
        setRuntime(res);
        setRuntimeError(null);
      })
      .catch((err) => {
        setRuntime(null);
        setRuntimeError(err instanceof Error ? err.message : "Failed to load runtime status");
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canGenerate || loading) return;

    setError(null);
    setLoading(true);

    const fullPrompt = `${prompt.trim()}\n\nStack preferences: Frontend: ${frontend}, Backend: ${backend}, Database: ${database}`;

    try {
      const res = await generateProject(fullPrompt);
      addToast("success", `Project "${res.projectName}" queued!`);
      navigate(`/jobs/${res.jobId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      addToast("error", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "calc(100vh - 140px)",
        padding: "48px 24px",
      }}
    >
      {/* Hero */}
      <div
        className="animate-fade-in"
        style={{ textAlign: "center", marginBottom: "48px", maxWidth: "640px" }}
      >
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 56px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            marginBottom: "16px",
          }}
        >
          Describe your idea.
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            We'll build the blueprint.
          </span>
        </h1>
        <p style={{ fontSize: "17px", color: "#9898a8", lineHeight: 1.6 }}>
          StackForge uses AI agents to plan your full-stack project — schema, APIs,
          frontend pages, DevOps — all generated in seconds.
        </p>
      </div>

      {/* Form */}
      <Card
        glow
        style={{
          width: "100%",
          maxWidth: "640px",
          padding: "32px",
        }}
      >
        <form onSubmit={handleSubmit}>
          {/* Prompt textarea */}
          <label
            htmlFor="prompt-input"
            style={{ display: "block", fontSize: "13px", color: "#9898a8", marginBottom: "8px", fontWeight: 500 }}
          >
            Project description
          </label>
          <textarea
            id="prompt-input"
            placeholder="e.g. A SaaS platform for managing freelancer invoices with user auth, Stripe payments, and a dashboard..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: "15px",
              fontFamily: "'Inter', system-ui, sans-serif",
              background: "#1a1a26",
              border: "1px solid #23232f",
              borderRadius: "12px",
              color: "#f0f0f5",
              resize: "vertical",
              lineHeight: 1.5,
              transition: "border-color 250ms",
              outline: "none",
              minHeight: "100px",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#23232f")}
          />
          {prompt.length > 0 && prompt.trim().length < 10 && (
            <p style={{ fontSize: "12px", color: "#f43f5e", marginTop: "6px" }}>
              Please enter at least 10 characters
            </p>
          )}

          {/* Stack preferences */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "24px" }}>
            <SelectField
              id="frontend-select"
              label="Frontend"
              value={frontend}
              onChange={setFrontend}
              options={FRONTEND_OPTIONS}
            />
            <SelectField
              id="backend-select"
              label="Backend"
              value={backend}
              onChange={setBackend}
              options={BACKEND_OPTIONS}
            />
            <SelectField
              id="database-select"
              label="Database"
              value={database}
              onChange={setDatabase}
              options={DATABASE_OPTIONS}
            />
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px 16px",
                fontSize: "13px",
                color: "#f43f5e",
                background: "rgba(244, 63, 94, 0.08)",
                border: "1px solid rgba(244, 63, 94, 0.2)",
                borderRadius: "10px",
              }}
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <div style={{ marginTop: "28px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <Button
              type="submit"
              size="lg"
              loading={loading}
              disabled={!canGenerate}
              style={{ width: "100%" }}
            >
              {loading ? "Generating..." : "Generate Blueprint"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              style={{ width: "100%" }}
              onClick={() => {
                const demoId = crypto.randomUUID();
                addToast("info", "Starting demo simulation...");
                navigate(`/jobs/${demoId}?demo=true`);
              }}
            >
              🎬 Try Demo — No API Key Needed
            </Button>
          </div>

          {(runtimeError || runtime?.ready === false || runtime !== null) && (
            <div
              style={{
                marginTop: "14px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: runtime?.ready === false
                  ? "rgba(244, 63, 94, 0.08)"
                  : "rgba(56, 189, 248, 0.08)",
                border: runtime?.ready === false
                  ? "1px solid rgba(244, 63, 94, 0.2)"
                  : "1px solid rgba(56, 189, 248, 0.2)",
                color: runtime?.ready === false ? "#f43f5e" : "#7dd3fc",
                fontSize: "12px",
              }}
            >
              {runtimeError && `Runtime status unavailable: ${runtimeError}`}
              {!runtimeError && runtime?.ready && (
                <>Runtime ready. Provider: {runtime.provider}</>
              )}
              {!runtimeError && runtime?.ready === false && (
                <>
                  Runtime unavailable ({runtime.provider}): {runtime.reason ?? "Provider not configured"}
                </>
              )}
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

/* ─── Select field helper ──────────────────────────────────────────────────── */
function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{ display: "block", fontSize: "12px", color: "#9898a8", marginBottom: "6px", fontWeight: 500 }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: "14px",
          fontFamily: "'Inter', system-ui, sans-serif",
          background: "#1a1a26",
          border: "1px solid #23232f",
          borderRadius: "10px",
          color: "#f0f0f5",
          cursor: "pointer",
          outline: "none",
          transition: "border-color 250ms",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239898a8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px center",
          paddingRight: "32px",
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
