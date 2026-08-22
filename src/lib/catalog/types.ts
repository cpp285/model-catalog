export type CatalogView = "models" | "offerings";

export type SourceStatus = {
  id: string;
  name: string;
  recordCount: number;
  lastSyncedAt: string | null;
  status: "idle" | "ok" | "error";
  error: string | null;
};

export type CatalogStats = {
  canonicalModels: number;
  activeOfferings: number;
  unmatchedOfferings: number;
  providers: number;
  lastSyncAt: string | null;
  sources: SourceStatus[];
};

export type CatalogItem = {
  uid: string;
  view: CatalogView;
  canonicalId: string | null;
  name: string;
  developer: string;
  family: string | null;
  provider: string | null;
  description: string | null;
  mode: string | null;
  inputModalities: string[];
  outputModalities: string[];
  contextWindow: number | null;
  maxOutput: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  reasoning: boolean | null;
  toolCall: boolean | null;
  structuredOutput: boolean | null;
  openWeights: boolean | null;
  releaseDate: string | null;
  status: string;
  source: string;
  matchStatus: string;
  offeringCount: number;
  tags: string[];
  rawId: string;
};

export type CatalogPayload = {
  items: CatalogItem[];
  stats: CatalogStats;
};

export type SyncResult = {
  runId: number;
  startedAt: string;
  completedAt: string;
  counts: Record<string, number>;
  unmatchedOfferings: number;
};
