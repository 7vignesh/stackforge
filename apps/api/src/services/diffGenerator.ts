import type { Blueprint } from "@stackforge/shared";
import type { FeatureAgentId } from "./deltaDetector.js";

export type DiffGroup = {
  agentId: FeatureAgentId;
  items: string[];
};

export type DiffObject = {
  added: DiffGroup[];
  modified: DiffGroup[];
  removed: DiffGroup[];
};

type MutableDiffBucket = {
  added: string[];
  modified: string[];
  removed: string[];
};

const AGENT_SECTION_MAP: Record<FeatureAgentId, Array<keyof Blueprint>> = {
  planner: ["projectName", "stack", "folderStructure"],
  schema: ["entities", "relationships"],
  api: ["routePlan"],
  frontend: ["frontendPages"],
  devops: ["infraPlan", "generatedFilesPlan"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (isObject(value)) {
    const identity =
      (typeof value["name"] === "string" && value["name"]) ||
      (typeof value["path"] === "string" && value["path"]) ||
      (typeof value["route"] === "string" && value["route"]) ||
      (typeof value["method"] === "string" && typeof value["path"] === "string"
        ? `${value["method"]} ${value["path"]}`
        : undefined);

    if (typeof identity === "string") {
      return identity;
    }

    return JSON.stringify(value).slice(0, 120);
  }

  return String(value);
}

function pushUnique(target: string[], item: string): void {
  if (!target.includes(item)) {
    target.push(item);
  }
}

function detectArrayChanges(path: string, before: unknown[], after: unknown[], bucket: MutableDiffBucket): void {
  const beforeSet = new Set(before.map((item) => JSON.stringify(item)));
  const afterSet = new Set(after.map((item) => JSON.stringify(item)));

  for (const item of after) {
    const key = JSON.stringify(item);
    if (!beforeSet.has(key)) {
      pushUnique(bucket.added, `${path}: + ${summarizeValue(item)}`);
    }
  }

  for (const item of before) {
    const key = JSON.stringify(item);
    if (!afterSet.has(key)) {
      pushUnique(bucket.removed, `${path}: - ${summarizeValue(item)}`);
    }
  }
}

function deepDiff(path: string, before: unknown, after: unknown, bucket: MutableDiffBucket): void {
  if (before === undefined && after === undefined) {
    return;
  }

  if (before === undefined) {
    pushUnique(bucket.added, `${path}: + ${summarizeValue(after)}`);
    return;
  }

  if (after === undefined) {
    pushUnique(bucket.removed, `${path}: - ${summarizeValue(before)}`);
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    detectArrayChanges(path, before, after, bucket);
    const len = Math.min(before.length, after.length);
    for (let i = 0; i < len; i += 1) {
      deepDiff(`${path}[${i}]`, before[i], after[i], bucket);
    }
    return;
  }

  if (isObject(before) && isObject(after)) {
    const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      deepDiff(`${path}.${key}`, before[key], after[key], bucket);
    }
    return;
  }

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    pushUnique(bucket.modified, `${path}: ${summarizeValue(before)} -> ${summarizeValue(after)}`);
  }
}

function compact(groups: DiffGroup[]): DiffGroup[] {
  return groups.filter((group) => group.items.length > 0);
}

export function generateBlueprintDiff(previousOutput: Blueprint, updatedOutput: Blueprint): DiffObject {
  const added: DiffGroup[] = [];
  const modified: DiffGroup[] = [];
  const removed: DiffGroup[] = [];

  for (const agentId of Object.keys(AGENT_SECTION_MAP) as FeatureAgentId[]) {
    const sectionKeys = AGENT_SECTION_MAP[agentId];
    const bucket: MutableDiffBucket = {
      added: [],
      modified: [],
      removed: [],
    };

    for (const sectionKey of sectionKeys) {
      deepDiff(
        sectionKey,
        previousOutput[sectionKey],
        updatedOutput[sectionKey],
        bucket,
      );
    }

    added.push({ agentId, items: bucket.added });
    modified.push({ agentId, items: bucket.modified });
    removed.push({ agentId, items: bucket.removed });
  }

  return {
    added: compact(added),
    modified: compact(modified),
    removed: compact(removed),
  };
}
