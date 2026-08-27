export interface Usage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  webSearches: number;
  webFetches: number;
}

export interface NormalizedMessage {
  uuid: string;
  sessionId: string;
  ts: string;
  role: "user" | "assistant" | "system";
  model: string | null;
  usage: Usage;
  speed: string | null;
  inferenceGeo: string | null;
  isSidechain: boolean;
  costUsd: number;
}

export interface NormalizedToolCall {
  sessionId: string;
  messageUuid: string;
  ts: string;
  name: string;
  mcpServer: string | null;
  mcpTool: string | null;
  skill: string | null;
  subagent: string | null;
}

export interface NormalizedSession {
  id: string;
  provider: string;
  project: string;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
  entrypoint: string | null;
  title: string | null;
  firstTs: string | null;
  lastTs: string | null;
}

export interface ProviderScan {
  sessions: NormalizedSession[];
  messages: NormalizedMessage[];
  tools: NormalizedToolCall[];
}

export interface Provider {
  id: string;
  label: string;
  /** `note` es una CLAVE de traduccion, no prosa: el idioma lo elige el front. */
  detect(): { installed: boolean; root: string | null; note?: string; noteParams?: Record<string, number> };
  /** Indexa incrementalmente. Devuelve conteos. */
  index(db: import("bun:sqlite").Database): { files: number; newBytes: number; messages: number };
}
