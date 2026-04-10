/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { Blueprint } from "@stackforge/shared";
import { generateBlueprintDiff } from "../src/services/diffGenerator.js";

function baseBlueprint(): Blueprint {
  return {
    projectName: "demo-app",
    generatedAt: new Date().toISOString(),
    stack: {
      frontend: "react",
      backend: "express",
      database: "postgres",
      auth: "jwt",
      hosting: "docker",
      packageManager: "bun",
      monorepo: true,
    },
    folderStructure: [{ path: "apps/api", type: "dir" }],
    entities: [{
      name: "User",
      tableName: "users",
      fields: [{ name: "id", type: "uuid", nullable: false }],
    }],
    relationships: [],
    routePlan: [{
      method: "GET",
      path: "/api/users",
      description: "List users",
      auth: true,
      responseType: "User[]",
    }],
    frontendPages: [{
      route: "/users",
      name: "Users",
      components: ["UserTable"],
      auth: true,
      description: "Users page",
    }],
    infraPlan: {
      ci: ["lint"],
      docker: true,
      deployment: ["railway"],
      envVars: ["DATABASE_URL"],
    },
    generatedFilesPlan: [{
      path: "Dockerfile",
      generator: "devops",
      description: "Docker setup",
    }],
    reviewerNotes: [],
  };
}

describe("diffGenerator", () => {
  it("reports added and modified changes grouped by agent", () => {
    const previous = baseBlueprint();
    const updated = {
      ...baseBlueprint(),
      entities: [
        ...baseBlueprint().entities,
        {
          name: "Invoice",
          tableName: "invoices",
          fields: [{ name: "id", type: "uuid", nullable: false }],
        },
      ],
      routePlan: [
        ...baseBlueprint().routePlan,
        {
          method: "POST",
          path: "/api/payments/stripe",
          description: "Create stripe payment intent",
          auth: true,
          responseType: "PaymentIntent",
        },
      ],
      infraPlan: {
        ...baseBlueprint().infraPlan,
        envVars: ["DATABASE_URL", "STRIPE_SECRET_KEY"],
      },
    };

    const diff = generateBlueprintDiff(previous, updated);

    expect(diff.added.some((group) => group.agentId === "schema")).toBe(true);
    expect(diff.added.some((group) => group.agentId === "api")).toBe(true);
    const devopsTouched =
      diff.modified.some((group) => group.agentId === "devops")
      || diff.added.some((group) => group.agentId === "devops");
    expect(devopsTouched).toBe(true);
  });
});
