import * as path from "node:path";
import type { SkillHeader } from "../workflow/types.js";

const BODY_DIVIDER = "---BODY---";

function parseArrayValue(value: string, field: string, skillPath: string): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        throw new Error("Expected array of strings");
      }
      return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid '${field}' array in skill '${skillPath}': ${message}`);
    }
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitSkillSections(content: string, skillPath: string): { header: string; body: string } {
  const dividerIndex = content.indexOf(BODY_DIVIDER);
  if (dividerIndex === -1) {
    throw new Error(`Skill '${skillPath}' is missing '${BODY_DIVIDER}' divider`);
  }

  const header = content.slice(0, dividerIndex).trim();
  const body = content.slice(dividerIndex + BODY_DIVIDER.length).trim();

  if (header.length === 0) {
    throw new Error(`Skill '${skillPath}' has an empty header section`);
  }

  if (body.length === 0) {
    throw new Error(`Skill '${skillPath}' has an empty body section`);
  }

  return { header, body };
}

function parseHeaderSection(headerSection: string, skillPath: string): SkillHeader {
  const entries: Record<string, string> = {};

  for (const rawLine of headerSection.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  const name = entries["name"]?.trim() ?? "";
  const description = entries["description"]?.trim() ?? "";
  const triggers = parseArrayValue(entries["triggers"] ?? "", "triggers", skillPath);
  const inputs = parseArrayValue(entries["inputs"] ?? "", "inputs", skillPath);
  const outputs = parseArrayValue(entries["outputs"] ?? "", "outputs", skillPath);

  if (name.length === 0) {
    throw new Error(`Skill '${skillPath}' is missing required header field 'name'`);
  }

  if (description.length === 0) {
    throw new Error(`Skill '${skillPath}' is missing required header field 'description'`);
  }

  if (triggers.length === 0) {
    throw new Error(`Skill '${skillPath}' is missing required header field 'triggers'`);
  }

  return {
    name,
    triggers,
    description,
    inputs,
    outputs,
  };
}

function getDefaultSkillDirs(): string[] {
  const dirs = [
    import.meta.dir,
    path.resolve(import.meta.dir, "../../src/skills"),
    path.resolve(process.cwd(), "packages/agents/src/skills"),
    path.resolve(process.cwd(), "src/skills"),
  ];

  return [...new Set(dirs)];
}

async function collectSkillFiles(skillsDir?: string): Promise<string[]> {
  const candidateDirs = skillsDir !== undefined && skillsDir.trim().length > 0
    ? [skillsDir]
    : getDefaultSkillDirs();

  for (const candidate of candidateDirs) {
    const matches: string[] = [];
    const glob = new Bun.Glob("*.md");
    for await (const entry of glob.scan({ cwd: candidate, absolute: true })) {
      matches.push(String(entry));
    }

    if (matches.length > 0) {
      matches.sort();
      return matches;
    }
  }

  throw new Error("No skill markdown files found under packages/agents/src/skills");
}

export class SkillRegistry {
  private readonly headersByName = new Map<string, SkillHeader>();
  private readonly fileByName = new Map<string, string>();
  private initialized = false;

  constructor(private readonly skillsDir?: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const files = await collectSkillFiles(this.skillsDir);
    for (const skillPath of files) {
      const raw = await Bun.file(skillPath).text();
      const sections = splitSkillSections(raw, skillPath);
      const header = parseHeaderSection(sections.header, skillPath);

      this.headersByName.set(header.name, header);
      this.fileByName.set(header.name, skillPath);
    }

    this.initialized = true;
  }

  async loadSkill(name: string): Promise<string> {
    await this.initialize();

    const skillPath = this.fileByName.get(name);
    if (skillPath === undefined) {
      throw new Error(`Skill '${name}' not found in registry`);
    }

    const raw = await Bun.file(skillPath).text();
    const sections = splitSkillSections(raw, skillPath);
    return sections.body;
  }

  getRegistry(): SkillHeader[] {
    return [...this.headersByName.values()];
  }

  matchSkill(intent: string): SkillHeader | undefined {
    const loweredIntent = intent.toLowerCase();
    let bestMatch: { header: SkillHeader; score: number } | undefined;

    for (const header of this.headersByName.values()) {
      const score = header.triggers.reduce((acc, trigger) => {
        const normalizedTrigger = trigger.toLowerCase();
        if (normalizedTrigger.length === 0) {
          return acc;
        }

        return loweredIntent.includes(normalizedTrigger) ? acc + 1 : acc;
      }, 0);

      if (score <= 0) {
        continue;
      }

      if (bestMatch === undefined || score > bestMatch.score) {
        bestMatch = { header, score };
      }
    }

    return bestMatch?.header;
  }
}
