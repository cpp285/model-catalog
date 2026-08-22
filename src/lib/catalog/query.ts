import { getDatabase } from "./database";
import type {
  CatalogItem,
  CatalogPayload,
  CatalogStats,
  CatalogView,
  SourceStatus,
} from "./types";

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function nullableBoolean(value: number | null): boolean | null {
  return value === null ? null : Boolean(value);
}

type ModelRow = {
  id: string;
  name: string;
  developer: string;
  family: string | null;
  description: string | null;
  release_date: string | null;
  context_window: number | null;
  max_output: number | null;
  input_modalities: string;
  output_modalities: string;
  reasoning: number | null;
  tool_call: number | null;
  structured_output: number | null;
  open_weights: number | null;
  offering_count: number;
  min_input_price: number | null;
  min_output_price: number | null;
};

type OfferingRow = {
  uid: string;
  source_model_id: string;
  canonical_model_id: string | null;
  provider_id: string;
  provider_name: string;
  name: string;
  developer: string;
  family: string | null;
  description: string | null;
  mode: string | null;
  input_modalities: string;
  output_modalities: string;
  context_window: number | null;
  max_output: number | null;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  reasoning: number | null;
  tool_call: number | null;
  structured_output: number | null;
  open_weights: number | null;
  release_date: string | null;
  status: string;
  source: string;
  match_status: string;
};

function contextTag(contextWindow: number | null) {
  if (!contextWindow) return null;
  if (contextWindow >= 1_000_000) return "1M+ 上下文";
  if (contextWindow >= 200_000) return "200K+ 上下文";
  if (contextWindow >= 128_000) return "128K+ 上下文";
  if (contextWindow >= 32_000) return "32K+ 上下文";
  return "常规上下文";
}

function tagsFor(item: Omit<CatalogItem, "tags">) {
  return [
    item.reasoning ? "推理" : null,
    item.toolCall ? "工具调用" : null,
    item.structuredOutput ? "结构化输出" : null,
    item.openWeights ? "开源权重" : null,
    ...item.inputModalities.map((modality) => `${modality} 输入`),
    ...item.outputModalities.map((modality) => `${modality} 输出`),
    contextTag(item.contextWindow),
  ].filter((tag): tag is string => Boolean(tag));
}

function getStats(): CatalogStats {
  const database = getDatabase();
  const counts = database
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM canonical_models WHERE active = 1) AS canonical_models,
        (SELECT COUNT(*) FROM offerings WHERE active = 1) AS active_offerings,
        (SELECT COUNT(*) FROM offerings WHERE active = 1 AND canonical_model_id IS NULL) AS unmatched_offerings,
        (SELECT COUNT(DISTINCT provider_id) FROM offerings WHERE active = 1) AS providers,
        (SELECT MAX(completed_at) FROM sync_runs WHERE status = 'ok') AS last_sync_at
    `)
    .get() as {
    canonical_models: number;
    active_offerings: number;
    unmatched_offerings: number;
    providers: number;
    last_sync_at: string | null;
  };
  const sourceRows = getDatabase()
    .prepare(
      "SELECT id, name, record_count, last_synced_at, status, error FROM sources ORDER BY id",
    )
    .all() as Array<{
    id: string;
    name: string;
    record_count: number;
    last_synced_at: string | null;
    status: SourceStatus["status"];
    error: string | null;
  }>;

  return {
    canonicalModels: counts.canonical_models,
    activeOfferings: counts.active_offerings,
    unmatchedOfferings: counts.unmatched_offerings,
    providers: counts.providers,
    lastSyncAt: counts.last_sync_at,
    sources: sourceRows.map((source) => ({
      id: source.id,
      name: source.name,
      recordCount: source.record_count,
      lastSyncedAt: source.last_synced_at,
      status: source.status,
      error: source.error,
    })),
  };
}

function getModels(): CatalogItem[] {
  const rows = getDatabase()
    .prepare(`
      SELECT
        model.*,
        COUNT(offering.uid) AS offering_count,
        MIN(offering.input_price) AS min_input_price,
        MIN(offering.output_price) AS min_output_price
      FROM canonical_models model
      LEFT JOIN offerings offering
        ON offering.canonical_model_id = model.id AND offering.active = 1
      WHERE model.active = 1
      GROUP BY model.id
      ORDER BY model.release_date DESC, model.name COLLATE NOCASE
    `)
    .all() as ModelRow[];

  return rows.map((row) => {
    const base: Omit<CatalogItem, "tags"> = {
      uid: row.id,
      view: "models",
      canonicalId: row.id,
      name: row.name,
      developer: row.developer,
      family: row.family,
      provider: null,
      description: row.description,
      mode: "model",
      inputModalities: parseArray(row.input_modalities),
      outputModalities: parseArray(row.output_modalities),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      inputPrice: row.min_input_price,
      outputPrice: row.min_output_price,
      cacheReadPrice: null,
      reasoning: nullableBoolean(row.reasoning),
      toolCall: nullableBoolean(row.tool_call),
      structuredOutput: nullableBoolean(row.structured_output),
      openWeights: nullableBoolean(row.open_weights),
      releaseDate: row.release_date,
      status: "active",
      source: "models.dev",
      matchStatus: "canonical",
      offeringCount: row.offering_count,
      rawId: row.id,
    };
    return { ...base, tags: tagsFor(base) };
  });
}

function getOfferings(): CatalogItem[] {
  const rows = getDatabase()
    .prepare(`
      SELECT * FROM offerings
      WHERE active = 1
      ORDER BY name COLLATE NOCASE, provider_name COLLATE NOCASE
    `)
    .all() as OfferingRow[];

  return rows.map((row) => {
    const base: Omit<CatalogItem, "tags"> = {
      uid: row.uid,
      view: "offerings",
      canonicalId: row.canonical_model_id,
      name: row.name,
      developer: row.developer,
      family: row.family,
      provider: row.provider_name,
      description: row.description,
      mode: row.mode,
      inputModalities: parseArray(row.input_modalities),
      outputModalities: parseArray(row.output_modalities),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      inputPrice: row.input_price,
      outputPrice: row.output_price,
      cacheReadPrice: row.cache_read_price,
      reasoning: nullableBoolean(row.reasoning),
      toolCall: nullableBoolean(row.tool_call),
      structuredOutput: nullableBoolean(row.structured_output),
      openWeights: nullableBoolean(row.open_weights),
      releaseDate: row.release_date,
      status: row.status,
      source: row.source,
      matchStatus: row.match_status,
      offeringCount: 1,
      rawId: row.source_model_id,
    };
    return { ...base, tags: tagsFor(base) };
  });
}

export function getCatalog(view: CatalogView): CatalogPayload {
  return {
    items: view === "models" ? getModels() : getOfferings(),
    stats: getStats(),
  };
}
