import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@stackforge/ui";
import { generateProject, getRuntime, type RuntimeResponse } from "../lib/api";

const FRONTEND_OPTIONS = ["react", "vue", "svelte"] as const;
const BACKEND_OPTIONS = ["express", "fastify", "hono"] as const;
const DATABASE_OPTIONS = ["postgres", "mysql", "mongodb"] as const;

const PARTICLE_COUNT = 45;

export function Home() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<HTMLDivElement | null>(null);

  const [prompt, setPrompt] = useState("");
  const [frontend, setFrontend] = useState("react");
  const [backend, setBackend] = useState("express");
  const [database, setDatabase] = useState("postgres");
  const [enableCodeGeneration, setEnableCodeGeneration] = useState(false);
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

  useEffect(() => {
    const container = particlesRef.current;
    if (!container) return;

    container.innerHTML = "";

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const particle = document.createElement("span");
      particle.className = "sf-particle";

      const depth = Math.random() * 2 + 0.5;
      const size = Math.random() * 2 + 1;

      particle.style.left = `${Math.random() * 100}%`;
      particle.style.top = `${Math.random() * 85}%`;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.opacity = `${Math.random() * 0.4 + 0.1}`;
      particle.style.animationDuration = `${Math.random() * 4 + 2}s`;
      particle.style.animationDelay = `${Math.random() * 2}s`;
      particle.style.setProperty("--depth", `${depth}`);
      container.appendChild(particle);
    }

    return () => {
      container.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const setFromPoint = (x: number, y: number) => {
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      const moveX = (x - width / 2) / (width / 2);
      const moveY = (y - height / 2) / (height / 2);

      root.style.setProperty("--cursor-x", `${x}px`);
      root.style.setProperty("--cursor-y", `${y}px`);
      root.style.setProperty("--parallax-x", `${-moveX * 40}px`);
      root.style.setProperty("--parallax-y", `${-moveY * 40}px`);
    };

    setFromPoint(window.innerWidth / 2, window.innerHeight / 3);

    const onMouseMove = (event: MouseEvent) => {
      setFromPoint(event.clientX, event.clientY);
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canGenerate || loading) return;

    setError(null);
    setLoading(true);

    const fullPrompt = `${prompt.trim()}\n\nStack preferences: Frontend: ${frontend}, Backend: ${backend}, Database: ${database}`;

    try {
      const res = await generateProject(
        fullPrompt,
        undefined,
        { enableCodeGeneration },
      );
      addToast("success", `Project "${res.projectName}" queued!`);
      navigate(`/jobs/${res.jobId}?codegen=${enableCodeGeneration ? "1" : "0"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      addToast("error", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sf-home" ref={containerRef}>
      <div className="sf-cursor-glow" aria-hidden="true" />

      <div className="sf-hero-lighting sf-gsap-fade" aria-hidden="true">
        <div className="sf-vertical-rays" />
        <div className="sf-ambient-bloom" />

        <div className="sf-arc-svg-container">
          <svg width="100%" height="100%" viewBox="0 0 1400 600" preserveAspectRatio="none">
            <defs>
              <linearGradient id="core-glow" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(255,255,255,0)" />
                <stop offset="35%" stopColor="rgba(255,255,255,0)" />
                <stop offset="47%" stopColor="rgba(255,255,255,0.9)" />
                <stop offset="50%" stopColor="rgba(255,255,255,1)" />
                <stop offset="53%" stopColor="rgba(255,255,255,0.9)" />
                <stop offset="65%" stopColor="rgba(255,255,255,0)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>

              <linearGradient id="ambient-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(56,189,248,0)" />
                <stop offset="25%" stopColor="rgba(56,189,248,0.1)" />
                <stop offset="40%" stopColor="rgba(56,189,248,0.4)" />
                <stop offset="50%" stopColor="rgba(186,230,253,0.7)" />
                <stop offset="60%" stopColor="rgba(56,189,248,0.4)" />
                <stop offset="75%" stopColor="rgba(56,189,248,0.1)" />
                <stop offset="100%" stopColor="rgba(56,189,248,0)" />
              </linearGradient>
            </defs>
            <path
              d="M 0 600 Q 700 80 1400 600"
              fill="none"
              stroke="url(#ambient-grad)"
              strokeWidth="60"
              filter="blur(35px)"
              opacity="0.3"
            />
            <path
              d="M 0 600 Q 700 80 1400 600"
              fill="none"
              stroke="url(#ambient-grad)"
              strokeWidth="15"
              filter="blur(8px)"
              opacity="0.6"
            />
            <path d="M 0 600 Q 700 80 1400 600" fill="none" stroke="url(#core-glow)" strokeWidth="2" />
          </svg>
        </div>
        <div className="sf-core-flare" />
      </div>

      <div ref={particlesRef} className="sf-particles" aria-hidden="true" />

      <div className="sf-demo-banner">
        <p>
          <strong>Live demo</strong> — this deployment runs without an API key, so
          real generation is disabled. To use StackForge for real, clone the repo,
          add your own OpenRouter key, and run it locally.
        </p>
        <a
          href="https://github.com/7vignesh/stackforge"
          target="_blank"
          rel="noopener noreferrer"
          className="sf-demo-banner-link"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
          View on GitHub &amp; setup guide
        </a>
      </div>

      <main className="sf-hero">
        <h1 className="sf-gsap-anim">
          Describe your idea.
          <br />
          <span className="sf-gradient-text">We&apos;ll build the blueprint.</span>
        </h1>

        <p className="sf-subtitle sf-gsap-anim">
          StackForge uses AI agents to plan your full-stack project - schema, APIs, frontend
          pages, DevOps - all generated in seconds.
        </p>
      </main>

      <section className="sf-dashboard-wrapper sf-anim-dash">
        <div className="sf-dash-glow-intense" />
        <form onSubmit={handleSubmit} className="sf-dashboard-ui">
          <div className="sf-form-group">
            <label className="sf-form-label" htmlFor="prompt-input">
              Project description
            </label>
            <textarea
              id="prompt-input"
              className="sf-textarea"
              placeholder="e.g. A SaaS platform for managing freelancer invoices with user auth, Stripe payments, and a dashboard..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
            {prompt.length > 0 && prompt.trim().length < 10 && (
              <p className="sf-inline-error">Please enter at least 10 characters</p>
            )}
          </div>

          <div className="sf-dropdowns-container">
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

          <label className="sf-codegen-toggle" htmlFor="codegen-toggle">
            <div className="sf-codegen-toggle-copy">
              <span>Enable code generation agent</span>
              <small>ON: generate runnable source files. OFF: blueprint-only flow.</small>
            </div>
            <input
              id="codegen-toggle"
              type="checkbox"
              checked={enableCodeGeneration}
              onChange={(e) => setEnableCodeGeneration(e.target.checked)}
            />
          </label>

          {error && <div className="sf-error-box">{error}</div>}

          <div className="sf-action-stack">
            <button
              type="submit"
              className="sf-btn-generate"
              disabled={!canGenerate || loading}
            >
              {loading ? "Generating..." : "Generate Blueprint"}
            </button>
            <button
              type="button"
              className="sf-btn-demo"
              onClick={() => {
                const demoId = crypto.randomUUID();
                addToast("info", "Starting demo simulation...");
                navigate(`/jobs/${demoId}?demo=true&codegen=${enableCodeGeneration ? "1" : "0"}`);
              }}
            >
              Try Demo - No API Key Needed
            </button>
          </div>

          {(runtimeError || runtime?.ready === false || runtime !== null) && (
            <div className={`sf-runtime-badge ${runtime?.ready === false || runtimeError ? "is-error" : "is-ok"}`}>
              {runtimeError && `Runtime status unavailable: ${runtimeError}`}
              {!runtimeError && runtime?.ready && <>Runtime ready. Provider: {runtime.provider}</>}
              {!runtimeError && runtime?.ready === false && (
                <>
                  Runtime unavailable ({runtime.provider}): {runtime.reason ?? "Provider not configured"}
                </>
              )}
            </div>
          )}
        </form>
      </section>
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
    <div className="sf-dropdown-group">
      <label htmlFor={id} className="sf-form-label">
        {label}
      </label>
      <div className="sf-select-wrapper">
      <select
        id={id}
        className="sf-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </option>
        ))}
      </select>
      </div>
    </div>
  );
}
