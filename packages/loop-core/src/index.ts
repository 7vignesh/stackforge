/**
 * @stackforge/loop-core — the loop layer for AI coding agents.
 *
 * Persists loop state, runs real gate commands, and refuses to let a milestone
 * be called done without evidence. Contains no LLM calls: the user's own coding
 * agent supplies the intelligence.
 */

export {
  LOOP_STATUS,
  MILESTONE_STATUS,
  EXISTENCE_VERDICT,
  MEMORY_KIND,
  type BlockedReason,
  type Loop,
  type LoopStatus as LoopStatusValue,
  type Milestone,
  type MilestoneStatus,
  type ExistenceVerdict,
  type Iteration,
  type GateRun,
  type MemoryEntry,
  type MemoryHit,
  type MemoryKind,
} from "./types.js";

export {
  DEFAULT_CONFIG_FILENAME,
  STARTER_CONFIG,
  GateConfigSchema,
  LoopConfigSchema,
  emptyLoopConfig,
  parseLoopConfig,
  type GateConfig,
  type LoopConfig,
  type LoopConfigInput,
} from "./config.js";

export {
  findConfigFile,
  loadConfig,
  writeStarterConfig,
  type LoadedConfig,
} from "./config-loader.js";

export {
  DEFAULT_DB_DIRNAME,
  DEFAULT_DB_FILENAME,
  SCHEMA_VERSION,
  migrate,
  openDatabase,
  resolveDatabasePath,
  type OpenDatabaseOptions,
} from "./db/database.js";

export {
  StateStore,
  StateError,
  resolveDependencies,
  toFtsQuery,
  type CreateLoopInput,
  type MilestoneInput,
  type RecallOptions,
  type RecordGateRunInput,
  type RecordIterationInput,
  type RememberInput,
} from "./db/state-store.js";

export {
  formatGateFailure,
  runGate,
  runGateSuite,
  type GateOutcome,
  type GateSuiteResult,
  type RunGateOptions,
} from "./gates/runner.js";

export {
  LoopEngine,
  LoopError,
  type GateResult,
  type LoopEngineOptions,
  type LoopStatus,
  type PreflightInput,
  type PreflightResult,
  type ResumeContext,
  type StartLoopInput,
} from "./engine.js";

export { newId, nowIso, normalizeTags, truncateOutput } from "./util.js";
