/// <reference types="bun" />
import { describe, it, expect } from "bun:test";
import JSZip from "jszip";
import { buildProjectZip } from "../src/services/fileWriter.js";

describe("fileWriter service", () => {
  it("builds a runnable zip archive with key generated files", async () => {
    const mockPipelineOutput = {
      projectName: "Task Forge",
      stack: {
        frontend: "react",
        backend: "express",
        database: "postgresql",
        auth: "jwt",
        hosting: "docker",
        packageManager: "npm",
        monorepo: false,
      },
      entities: [
        {
          name: "user",
          tableName: "users",
          fields: [
            { name: "id", type: "uuid", nullable: false, unique: true },
            { name: "email", type: "string", nullable: false, unique: true },
          ],
        },
      ],
      routePlan: [
        {
          method: "GET",
          path: "/users",
          description: "List users",
          auth: true,
          responseType: "User[]",
        },
      ],
      frontendPages: [
        {
          route: "/dashboard",
          name: "Dashboard",
          components: ["StatsCard"],
          auth: true,
          description: "Shows high-level product metrics",
        },
      ],
      infraPlan: {
        docker: true,
        ci: ["github-actions"],
        deployment: ["railway"],
        envVars: ["DATABASE_URL", "JWT_SECRET"],
      },
    };

    const { projectName, buffer } = await buildProjectZip(mockPipelineOutput);

    expect(projectName).toBe("task-forge");
    expect(buffer.length).toBeGreaterThan(100);

    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.keys(zip.files);

    expect(entries).toContain("README.md");
    expect(entries).toContain("package.json");
    expect(entries).toContain("src/index.ts");
    expect(entries).toContain("src/routes/users.routes.ts");
    expect(entries).toContain("src/pages/Dashboard.tsx");
    expect(entries).toContain("prisma/schema.prisma");
    expect(entries).toContain("docker-compose.yml");

    const readme = await zip.file("README.md")?.async("text");
    expect(readme).toContain("Task Forge");

    const routeFile = await zip.file("src/routes/users.routes.ts")?.async("text");
    expect(routeFile).toContain("router.get");
  });
});
