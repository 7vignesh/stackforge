/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { selectWorkflow } from "../src/workflow/router.js";

describe("Workflow router", () => {
  it("selects fullstack workflow for scaffold prompts", () => {
    const workflow = selectWorkflow("Build a simple todo application with user auth and dashboard");
    expect(workflow.id).toBe("fullstack-scaffold");
    expect(workflow.steps.length).toBe(7);
  });

  it("selects feature-add workflow for explicit add intent", () => {
    const workflow = selectWorkflow("Add Stripe subscription billing to existing app");
    expect(workflow.id).toBe("feature-add");
    expect(workflow.steps.length).toBe(5);
  });

  it("does not treat embedded substrings as feature intent", () => {
    const workflow = selectWorkflow("Build admin dashboard with auth and analytics");
    expect(workflow.id).toBe("fullstack-scaffold");
  });
});
