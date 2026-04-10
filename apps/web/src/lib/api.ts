const API_BASE = "/api";

export interface DownloadZipResponse {
  blob: Blob;
  filename: string;
}

export interface GenerateResponse {
  jobId: string;
  status: string;
  projectName: string;
  createdAt: string;
  streamUrl: string;
  jobUrl: string;
}

export interface RuntimeResponse {
  provider: "openrouter" | "mock";
  ready: boolean;
  reason?: string;
}

export interface JobResponse {
  id: string;
  status: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  agentsCompleted: string[];
  error?: string;
  blueprint?: Blueprint;
  tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface Blueprint {
  projectName: string;
  generatedAt: string;
  stack: {
    frontend: string;
    backend: string;
    database: string;
    auth: string;
    hosting: string;
    packageManager: string;
    monorepo: boolean;
  };
  folderStructure: { path: string; type: "file" | "dir"; description?: string }[];
  entities: {
    name: string;
    tableName: string;
    fields: { name: string; type: string; nullable: boolean; unique?: boolean; foreignKey?: string }[];
    indexes?: string[];
  }[];
  relationships: { from: string; to: string; type: string; description: string }[];
  routePlan: {
    method: string;
    path: string;
    description: string;
    auth: boolean;
    requestBody?: string;
    responseType: string;
  }[];
  frontendPages: {
    route: string;
    name: string;
    components: string[];
    auth: boolean;
    description: string;
  }[];
  infraPlan: {
    ci: string[];
    docker: boolean;
    deployment: string[];
    envVars: string[];
  };
  generatedFilesPlan: { path: string; generator: string; description: string }[];
  reviewerNotes: { severity: "info" | "warning" | "error"; agent: string; note: string }[];
}

export async function generateProject(prompt: string, projectName?: string): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ...(projectName ? { projectName } : {}) }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<GenerateResponse>;
}

export async function getJob(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<JobResponse>;
}

export async function getRuntime(): Promise<RuntimeResponse> {
  const res = await fetch(`${API_BASE}/runtime`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  return res.json() as Promise<RuntimeResponse>;
}

export async function downloadProjectZip(pipelineOutput: Record<string, unknown>): Promise<DownloadZipResponse> {
  const res = await fetch(`${API_BASE}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pipelineOutput }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  const contentDisposition = res.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename="?([^\"]+)"?/i.exec(contentDisposition);
  const filename = filenameMatch?.[1] ?? "stackforge-project.zip";

  return {
    blob: await res.blob(),
    filename,
  };
}
