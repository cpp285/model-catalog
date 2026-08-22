import { getDatabase } from "./database";
import type {
  CatalogItem,
  CatalogPayload,
  CatalogStats,
  CatalogView,
  PriceStatus,
  ProviderSource,
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

function parseObjectArray(value: string | null): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
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
  developer_country: string | null;
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
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  currency: "CNY" | "USD" | null;
  price_unit: string | null;
  price_status: PriceStatus | null;
  is_official_api: number | null;
  market: "CN" | "US" | null;
  price_note: string | null;
  verified_at: string | null;
  source_url: string | null;
  pricing_tiers_json: string | null;
  price_source: string | null;
  price_provider: string | null;
};

type OfferingRow = {
  uid: string;
  source_model_id: string;
  canonical_model_id: string | null;
  provider_name: string;
  name: string;
  developer: string;
  developer_country: string | null;
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
  currency: "CNY" | "USD" | null;
  price_unit: string | null;
  price_status: PriceStatus;
  is_official_api: number;
  market: "CN" | "US" | null;
  price_note: string | null;
  verified_at: string | null;
  source_url: string | null;
  pricing_tiers_json: string;
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
    item.developerCountry === "CN" ? "中国模型" : null,
    item.developerCountry === "US" ? "美国模型" : null,
    item.isOfficialApi ? "官方 API" : null,
    item.priceStatus === "free" ? "官方免费" : null,
    item.pricingTiers.length ? "阶梯价" : null,
    item.reasoning ? "推理" : null,
    item.toolCall ? "工具调用" : null,
    item.structuredOutput ? "结构化输出" : null,
    item.openWeights ? "开源权重" : null,
    ...item.inputModalities.map((modality) => `${modality} 输入`),
    ...item.outputModalities.map((modality) => `${modality} 输出`),
    contextTag(item.contextWindow),
  ].filter((tag): tag is string => Boolean(tag));
}

function getProviderSources(): ProviderSource[] {
  const rows = getDatabase()
    .prepare(`
      SELECT * FROM provider_sources
      ORDER BY
        CASE price_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        name COLLATE NOCASE
    `)
    .all() as Array<{
    id: string;
    name: string;
    company: string;
    country: "CN" | "US";
    developer_ids_json: string;
    homepage_url: string | null;
    pricing_url: string | null;
    api_status: ProviderSource["apiStatus"];
    price_status: ProviderSource["priceStatus"];
    notes: string | null;
    verified_at: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company,
    country: row.country,
    developerIds: parseArray(row.developer_ids_json),
    homepageUrl: row.homepage_url,
    pricingUrl: row.pricing_url,
    apiStatus: row.api_status,
    priceStatus: row.price_status,
    notes: row.notes,
    verifiedAt: row.verified_at,
  }));
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
        (SELECT COUNT(*) FROM provider_sources WHERE country = 'CN') AS official_china_sources,
        (SELECT COUNT(*) FROM provider_sources WHERE country = 'CN' AND price_status = 'verified') AS verified_china_sources,
        (SELECT MAX(completed_at) FROM sync_runs WHERE status = 'ok') AS last_sync_at
    `)
    .get() as {
    canonical_models: number;
    active_offerings: number;
    unmatched_offerings: number;
    providers: number;
    official_china_sources: number;
    verified_china_sources: number;
    last_sync_at: string | null;
  };
  const sourceRows = database
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
    officialChinaSources: counts.official_china_sources,
    verifiedChinaSources: counts.verified_china_sources,
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
      WITH ranked_prices AS (
        SELECT offering.*,
          ROW_NUMBER() OVER (
            PARTITION BY canonical_model_id
            ORDER BY
              CASE source WHEN 'official-cn' THEN 0 WHEN 'models.dev' THEN 1 ELSE 9 END,
              verified_at DESC,
              updated_at DESC
          ) AS price_rank
        FROM offerings offering
        WHERE offering.active = 1
          AND offering.is_official_api = 1
          AND offering.market IN ('CN', 'US')
          AND offering.price_status IN ('priced', 'free')
      ),
      offering_counts AS (
        SELECT canonical_model_id, COUNT(*) AS offering_count
        FROM offerings
        WHERE active = 1 AND canonical_model_id IS NOT NULL
        GROUP BY canonical_model_id
      )
      SELECT
        model.*,
        COALESCE(counts.offering_count, 0) AS offering_count,
        price.input_price,
        price.output_price,
        price.cache_read_price,
        price.currency,
        price.price_unit,
        price.price_status,
        price.is_official_api,
        price.market,
        price.price_note,
        price.verified_at,
        price.source_url,
        price.pricing_tiers_json,
        price.source AS price_source,
        price.provider_name AS price_provider
      FROM canonical_models model
      LEFT JOIN offering_counts counts ON counts.canonical_model_id = model.id
      LEFT JOIN ranked_prices price
        ON price.canonical_model_id = model.id AND price.price_rank = 1
      WHERE model.active = 1
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
      developerCountry: row.developer_country,
      family: row.family,
      provider: row.price_provider,
      description: row.description,
      mode: "model",
      inputModalities: parseArray(row.input_modalities),
      outputModalities: parseArray(row.output_modalities),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      inputPrice: row.input_price,
      outputPrice: row.output_price,
      cacheReadPrice: row.cache_read_price,
      currency: row.currency,
      priceUnit: row.price_unit,
      priceStatus: row.price_status ?? "unknown",
      isOfficialApi: Boolean(row.is_official_api),
      market: row.market,
      priceNote: row.price_note,
      verifiedAt: row.verified_at,
      sourceUrl: row.source_url,
      pricingTiers: parseObjectArray(row.pricing_tiers_json),
      reasoning: nullableBoolean(row.reasoning),
      toolCall: nullableBoolean(row.tool_call),
      structuredOutput: nullableBoolean(row.structured_output),
      openWeights: nullableBoolean(row.open_weights),
      releaseDate: row.release_date,
      status: "active",
      source: row.price_source ?? "models.dev",
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
      SELECT offering.*, model.developer_country
      FROM offerings offering
      LEFT JOIN canonical_models model ON model.id = offering.canonical_model_id
      WHERE offering.active = 1
      ORDER BY offering.name COLLATE NOCASE, offering.provider_name COLLATE NOCASE
    `)
    .all() as OfferingRow[];

  return rows.map((row) => {
    const country = row.developer_country ?? row.market;
    const hideForeignChinaPrice =
      country === "CN" && !Boolean(row.is_official_api);
    const base: Omit<CatalogItem, "tags"> = {
      uid: row.uid,
      view: "offerings",
      canonicalId: row.canonical_model_id,
      name: row.name,
      developer: row.developer,
      developerCountry: country,
      family: row.family,
      provider: row.provider_name,
      description: row.description,
      mode: row.mode,
      inputModalities: parseArray(row.input_modalities),
      outputModalities: parseArray(row.output_modalities),
      contextWindow: row.context_window,
      maxOutput: row.max_output,
      inputPrice: hideForeignChinaPrice ? null : row.input_price,
      outputPrice: hideForeignChinaPrice ? null : row.output_price,
      cacheReadPrice: hideForeignChinaPrice ? null : row.cache_read_price,
      currency: hideForeignChinaPrice ? null : row.currency,
      priceUnit: hideForeignChinaPrice ? null : row.price_unit,
      priceStatus: hideForeignChinaPrice ? "unknown" : row.price_status,
      isOfficialApi: Boolean(row.is_official_api),
      market: row.market,
      priceNote: hideForeignChinaPrice
        ? "中国模型仅展示厂商国内官方人民币 API 价格。"
        : row.price_note,
      verifiedAt: row.verified_at,
      sourceUrl: row.source_url,
      pricingTiers: hideForeignChinaPrice
        ? []
        : parseObjectArray(row.pricing_tiers_json),
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
    providerSources: getProviderSources(),
  };
}
