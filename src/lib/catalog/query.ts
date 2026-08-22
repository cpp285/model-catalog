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

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nullableBoolean(value: number | null): boolean | null {
  return value === null ? null : Boolean(value);
}

type ModelRow = {
  id: string;
  product_id: string | null;
  lifecycle_status: string;
  callable: number;
  version_count: number;
  api_model_id: string | null;
  name: string;
  developer: string;
  source: string;
  developer_country: string | null;
  model_type: string;
  specs_json: string;
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
  openness_basis: string | null;
  openness_source_url: string | null;
  openness_verified_at: string | null;
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
  price_display: string | null;
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
  model_type: string | null;
  specs_json: string | null;
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
  price_display: string | null;
  verified_at: string | null;
  source_url: string | null;
  pricing_tiers_json: string;
  reasoning: number | null;
  tool_call: number | null;
  structured_output: number | null;
  open_weights: number | null;
  openness_basis: string | null;
  openness_source_url: string | null;
  openness_verified_at: string | null;
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

function catalogModelType(modelType: string, inputModalities: string[]) {
  if (modelType !== "chat") return modelType;
  return inputModalities.some((modality) => modality !== "text")
    ? "multimodal_generation"
    : "text_generation";
}

function tagsFor(item: Omit<CatalogItem, "tags">) {
  return [
    item.developerCountry === "CN" ? "中国模型" : null,
    item.developerCountry === "US" ? "美国模型" : null,
    item.isOfficialApi ? "官方 API" : null,
    item.modelType === "embedding" ? "文本向量" : null,
    item.modelType === "multimodal_embedding" ? "多模态向量" : null,
    item.modelType === "rerank" ? "排序模型" : null,
    item.modelType === "text_generation" ? "文本生成" : null,
    item.modelType === "multimodal_generation" ? "多模态生成" : null,
    item.priceStatus === "free" ? "官方免费" : null,
    item.pricingTiers.length ? "阶梯价" : null,
    item.openWeights === true ? "开源模型" : null,
    item.openWeights === false ? "闭源模型" : null,
    item.lifecycleStatus === "retired" ? "已下架" : null,
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
        (SELECT COUNT(*) FROM canonical_models
          WHERE is_current = 1 AND (active = 1 OR lifecycle_status = 'retired')) AS canonical_models,
        (SELECT COUNT(*) FROM canonical_models
          WHERE active = 1 AND is_current = 1) AS active_models,
        (SELECT COUNT(*) FROM canonical_models
          WHERE is_current = 1 AND lifecycle_status = 'retired') AS retired_models,
        (SELECT COUNT(*) FROM offerings WHERE active = 1) AS active_offerings,
        (SELECT COUNT(*) FROM offerings WHERE active = 1 AND canonical_model_id IS NULL) AS unmatched_offerings,
        (SELECT COUNT(DISTINCT provider_id) FROM offerings WHERE active = 1) AS providers,
        (SELECT COUNT(*) FROM provider_sources WHERE country = 'CN') AS official_china_sources,
        (SELECT COUNT(*) FROM provider_sources WHERE country = 'CN' AND price_status = 'verified') AS verified_china_sources,
        (SELECT COUNT(DISTINCT COALESCE(model.product_id, offering.canonical_model_id))
          FROM offerings offering
          LEFT JOIN canonical_models model ON model.id = offering.canonical_model_id
          WHERE offering.active = 1 AND offering.is_official_api = 1
            AND offering.price_status IN ('priced', 'free')) AS official_priced_models,
        (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1 AND model_type IN ('embedding', 'multimodal_embedding')) AS embedding_models,
        (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1 AND model_type = 'rerank') AS rerank_models,
        (SELECT MAX(completed_at) FROM sync_runs WHERE status = 'ok') AS last_sync_at
    `)
    .get() as {
    canonical_models: number;
    active_models: number;
    retired_models: number;
    active_offerings: number;
    unmatched_offerings: number;
    providers: number;
    official_china_sources: number;
    verified_china_sources: number;
    official_priced_models: number;
    embedding_models: number;
    rerank_models: number;
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
    activeModels: counts.active_models,
    retiredModels: counts.retired_models,
    activeOfferings: counts.active_offerings,
    unmatchedOfferings: counts.unmatched_offerings,
    providers: counts.providers,
    officialChinaSources: counts.official_china_sources,
    verifiedChinaSources: counts.verified_china_sources,
    officialPricedModels: counts.official_priced_models,
    embeddingModels: counts.embedding_models,
    rerankModels: counts.rerank_models,
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
      WITH offering_products AS (
        SELECT offering.*,
          COALESCE(version_model.product_id, offering.canonical_model_id) AS product_id,
          version_model.developer AS canonical_developer
        FROM offerings offering
        LEFT JOIN canonical_models version_model ON version_model.id = offering.canonical_model_id
      ),
      ranked_prices AS (
        SELECT offering.*,
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY
              active DESC,
              CASE source
                WHEN 'official-cn' THEN 0
                WHEN 'official-us-media-live' THEN 0
                WHEN 'models.dev' THEN 1
                WHEN 'volcengine-pricing' THEN 2
                WHEN 'qianwen-pricing' THEN 2
                ELSE 9
              END,
              CASE WHEN EXISTS (
                SELECT 1 FROM provider_sources provider
                WHERE provider.id = offering.provider_id
                  AND provider.developer_ids_json LIKE '%"' || offering.canonical_developer || '"%'
              ) THEN 0 ELSE 1 END,
              CASE price_status WHEN 'priced' THEN 0 WHEN 'free' THEN 0 ELSE 1 END,
              verified_at DESC,
              updated_at DESC
          ) AS price_rank
        FROM offering_products offering
        WHERE offering.is_official_api = 1
          AND offering.market IN ('CN', 'US')
          AND offering.product_id IS NOT NULL
      ),
      offering_counts AS (
        SELECT product_id, COUNT(*) AS offering_count
        FROM offering_products
        WHERE product_id IS NOT NULL AND active = 1
        GROUP BY product_id
      ),
      version_counts AS (
        SELECT product_id, COUNT(*) AS version_count
        FROM canonical_models
        WHERE product_id IS NOT NULL
        GROUP BY product_id
      )
      SELECT
        model.*,
        COALESCE(counts.offering_count, 0) AS offering_count,
        COALESCE(versions.version_count, 1) AS version_count,
        price.input_price,
        price.output_price,
        price.cache_read_price,
        price.currency,
        price.price_unit,
        price.price_status,
        price.is_official_api,
        price.market,
        price.price_note,
        price.price_display,
        price.verified_at,
        price.source_url,
        price.pricing_tiers_json,
        price.source AS price_source,
        price.provider_name AS price_provider,
        price.source_model_id AS api_model_id,
        openness.basis AS openness_basis,
        openness.source_url AS openness_source_url,
        openness.verified_at AS openness_verified_at
      FROM canonical_models model
      LEFT JOIN offering_counts counts ON counts.product_id = COALESCE(model.product_id, model.id)
      LEFT JOIN version_counts versions ON versions.product_id = COALESCE(model.product_id, model.id)
      LEFT JOIN ranked_prices price
        ON price.product_id = COALESCE(model.product_id, model.id)
          AND price.price_rank = 1
          AND (price.active = 1 OR model.lifecycle_status = 'retired')
      LEFT JOIN model_openness_evidence openness
        ON openness.canonical_model_id = model.id
      WHERE model.is_current = 1
        AND (model.active = 1 OR model.lifecycle_status = 'retired')
      ORDER BY model.release_date DESC, model.name COLLATE NOCASE
    `)
    .all() as ModelRow[];

  return rows.map((row) => {
    const inputModalities = parseArray(row.input_modalities);
    const base: Omit<CatalogItem, "tags"> = {
      uid: row.id,
      view: "models",
      canonicalId: row.id,
      productId: row.product_id ?? row.id,
      apiModelId: row.api_model_id ?? row.id.split("/").at(-1) ?? row.id,
      name: row.name,
      developer: row.developer,
      developerCountry: row.developer_country,
      modelType: catalogModelType(row.model_type, inputModalities),
      family: row.family,
      provider: row.price_provider,
      description: row.description,
      mode: "model",
      inputModalities,
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
      priceDisplay: row.price_display,
      verifiedAt: row.verified_at,
      sourceUrl: row.source_url,
      pricingTiers: parseObjectArray(row.pricing_tiers_json),
      specs: parseObject(row.specs_json),
      reasoning: nullableBoolean(row.reasoning),
      toolCall: nullableBoolean(row.tool_call),
      structuredOutput: nullableBoolean(row.structured_output),
      openWeights: nullableBoolean(row.open_weights),
      opennessBasis: row.openness_basis,
      opennessSourceUrl: row.openness_source_url,
      opennessVerifiedAt: row.openness_verified_at,
      releaseDate: row.release_date,
      lifecycleStatus: row.lifecycle_status,
      callable: Boolean(row.callable),
      versionCount: row.version_count,
      status: row.lifecycle_status === "retired" ? "retired" : "active",
      source: row.price_source ?? row.source,
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
      SELECT offering.*, model.developer_country, model.model_type, model.specs_json,
        openness.basis AS openness_basis,
        openness.source_url AS openness_source_url,
        openness.verified_at AS openness_verified_at
      FROM offerings offering
      LEFT JOIN canonical_models model ON model.id = offering.canonical_model_id
      LEFT JOIN model_openness_evidence openness
        ON openness.canonical_model_id = offering.canonical_model_id
      WHERE offering.active = 1 AND offering.source IN ('official-cn', 'openrouter')
      ORDER BY offering.name COLLATE NOCASE, offering.provider_name COLLATE NOCASE
    `)
    .all() as OfferingRow[];

  return rows.map((row) => {
    const country = row.developer_country ?? row.market;
    const inputModalities = parseArray(row.input_modalities);
    const rawModelType = row.model_type ?? row.mode ?? "unknown";
    const hideForeignChinaPrice =
      country === "CN" && !Boolean(row.is_official_api);
    const base: Omit<CatalogItem, "tags"> = {
      uid: row.uid,
      view: "offerings",
      canonicalId: row.canonical_model_id,
      productId: row.canonical_model_id,
      apiModelId: row.source_model_id,
      name: row.name,
      developer: row.developer,
      developerCountry: country,
      modelType: catalogModelType(rawModelType, inputModalities),
      family: row.family,
      provider: row.provider_name,
      description: row.description,
      mode: row.mode,
      inputModalities,
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
      priceDisplay: hideForeignChinaPrice ? null : row.price_display,
      verifiedAt: row.verified_at,
      sourceUrl: row.source_url,
      pricingTiers: hideForeignChinaPrice
        ? []
        : parseObjectArray(row.pricing_tiers_json),
      specs: parseObject(row.specs_json),
      reasoning: nullableBoolean(row.reasoning),
      toolCall: nullableBoolean(row.tool_call),
      structuredOutput: nullableBoolean(row.structured_output),
      openWeights: nullableBoolean(row.open_weights),
      opennessBasis: row.openness_basis,
      opennessSourceUrl: row.openness_source_url,
      opennessVerifiedAt: row.openness_verified_at,
      releaseDate: row.release_date,
      lifecycleStatus: row.status,
      callable: row.status === "active",
      versionCount: 1,
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
