export type CatalogView = "models" | "offerings";
export type PriceStatus = "priced" | "free" | "unknown";

export type ProviderSource = {
  id: string;
  name: string;
  company: string;
  country: "CN" | "US";
  developerIds: string[];
  homepageUrl: string | null;
  pricingUrl: string | null;
  apiStatus: "active" | "researching" | "retired";
  priceStatus: "verified" | "pending" | "not_public";
  notes: string | null;
  verifiedAt: string | null;
};

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
  activeModels: number;
  retiredModels: number;
  activeOfferings: number;
  unmatchedOfferings: number;
  providers: number;
  officialChinaSources: number;
  verifiedChinaSources: number;
  officialPricedModels: number;
  embeddingModels: number;
  rerankModels: number;
  lastSyncAt: string | null;
  sources: SourceStatus[];
};

export type CatalogItem = {
  uid: string;
  view: CatalogView;
  canonicalId: string | null;
  productId: string | null;
  apiModelId: string;
  name: string;
  developer: string;
  developerCountry: string | null;
  modelType: string;
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
  currency: "CNY" | "USD" | null;
  priceUnit: string | null;
  priceStatus: PriceStatus;
  isOfficialApi: boolean;
  market: "CN" | "US" | null;
  priceNote: string | null;
  priceDisplay: string | null;
  verifiedAt: string | null;
  sourceUrl: string | null;
  pricingTiers: Array<Record<string, unknown>>;
  specs: Record<string, unknown>;
  reasoning: boolean | null;
  toolCall: boolean | null;
  structuredOutput: boolean | null;
  openWeights: boolean | null;
  opennessBasis: string | null;
  opennessSourceUrl: string | null;
  opennessVerifiedAt: string | null;
  releaseDate: string | null;
  lifecycleStatus: string;
  callable: boolean;
  versionCount: number;
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
  providerSources: ProviderSource[];
};

export type SyncResult = {
  runId: number;
  startedAt: string;
  completedAt: string;
  counts: Record<string, number>;
  unmatchedOfferings: number;
  changes: {
    newModels: number;
    reactivatedModels: number;
    retiredModels: number;
    retiredOfferings: number;
    priceChanges: number;
    specChanges: number;
  };
};
