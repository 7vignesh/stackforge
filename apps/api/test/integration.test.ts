/// <reference types="bun" />
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../src/index.js";
import type { Server } from "http";

describe("StackForge API Integration", () => {
  let server: Server;
  const PORT = 3005; // Use a different port for testing
  const baseUrl = `http://localhost:${PORT}`;

  beforeAll(() => {
    // Start the exported Express app
    server = app.listen(PORT);
  });

  afterAll(() => {
    server.close();
  });

  it("should fail validation for empty prompt", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "tiny" }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
  });

  it("should create a job and return 202 accepted", async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Build a blog with Next.js and Postgres",
        projectName: "next-blog",
      }),
    });
    
    expect(res.status).toBe(202);
    const data = await res.json();
    
    expect(data.jobId).toBeDefined();
    expect(data.status).toBe("queued");
    expect(data.projectName).toBe("next-blog");
    expect(data.streamUrl).toBe(`/api/stream/${data.jobId}`);
    
    // Check job store via GET
    const jobRes = await fetch(`${baseUrl}/api/jobs/${data.jobId}`);
    expect(jobRes.status).toBe(200);
    const jobData = await jobRes.json();
    expect(jobData.id).toBe(data.jobId);
    expect(["queued", "running", "completed", "failed"]).toContain(jobData.status);
  });
});
