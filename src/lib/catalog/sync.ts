import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDataDirectory, getDatabase } from "./database";
import type { SyncResult } from "./types";
import chinaOfficialData from "../../../data/official/china-api-prices.json";

type JsonObject = Record<string, unknown>;

const SOURCE_ENDPOINTS = {
  modelsdev_models: {
    name: "Models.dev 底层模型",
    url: "https://models.dev/models.json",
  },
  modelsdev_offerings: {
    name: "Models.dev 渠道",
    url: "https://models.dev/api.json",
  },
  litellm: {
    name: "LiteLLM 价格库",
    url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  },
  openrouter: {
    name: "OpenRouter 模型目录",
    url: "https://openrouter.ai/api/v1/models?output_modalities=all",
  },
  official_cn: {
    name: "中国厂商官方 API 定价",
    url: "data/official/china-api-prices.json",
  },
} as const;

const US_DEVELOPERS = new Set([
  "amazon",
  "anthropic",
  "google",
  "meta",
  "microsoft",
  "nvidia",
  "openai",
  "perplexity",
  "xai",
]);

const DIRECT_US_PROVIDERS = new Map([
  ["anthropic", "anthropic"],
  ["google", "google"],
  ["openai", "openai"],
  ["xai", "xai"],
]);

const CHINA_DEVELOPERS = new Set(
  chinaOfficialData.providers.flatMap((provider) => provider.developer_ids),
);

function developerCountry(developer: string) {
  if (CHINA_DEVELOPERS.has(developer)) return "CN";
  if (US_DEVELOPERS.has(developer)) return "US";
  return null;
}

function inferredPriceStatus(values: Array<number | null>) {
  return values.some((value) => value !== null && value > 0) ? "priced" : "unknown";
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): number | null {
  return typeof value === "boolean" ? Number(value) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function perMillion(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed === null ? null : parsed * 1_000_000;
}

function stableUid(source: string, provider: string, modelId: string) {
  const hash = createHash("sha1")
    .update(`${source}:${provider}:${modelId}`)
    .digest("hex")
    .slice(0, 16);
  return `${source}:${hash}`;
}

function normalizeIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(preview|latest)$/g, "");
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "local-model-catalog/0.1" },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<unknown>;
}

async function writeRawSnapshot(source: string, payload: unknown) {
  const rawDirectory = path.join(getDataDirectory(), "raw");
  await fs.mkdir(rawDirectory, { recursive: true });
  await fs.writeFile(
    path.join(rawDirectory, `${source}.json`),
    JSON.stringify(payload),
    "utf8",
  );
}

type Match = {
  id: string | null;
  status: "manual" | "exact" | "heuristic" | "unmatched";
  confidence: number;
};

function createMatcher() {
  const database = getDatabase();
  const models = database
    .prepare(
      "SELECT id, name FROM canonical_models WHERE active = 1 ORDER BY id",
    )
    .all() as Array<{ id: string; name: string }>;
  const aliases = database
    .prepare("SELECT source, source_model_id, canonical_model_id FROM manual_aliases")
    .all() as Array<{
    source: string;
    source_model_id: string;
    canonical_model_id: string;
  }>;

  const ids = new Set(models.map((model) => model.id));
  const normalized = new Map<string, string[]>();
  const suffixes = new Map<string, string[]>();
  const manual = new Map(
    aliases.map((alias) => [
      `${alias.source}:${alias.source_model_id}`,
      alias.canonical_model_id,
    ]),
  );

  for (const model of models) {
    const nameKey = normalizeIdentity(model.name);
    normalized.set(nameKey, [...(normalized.get(nameKey) ?? []), model.id]);
    const suffixKey = normalizeIdentity(model.id.split("/").at(-1) ?? model.id);
    suffixes.set(suffixKey, [...(suffixes.get(suffixKey) ?? []), model.id]);
  }

  return (source: string, modelId: string, name: string, canonicalSlug?: string | null): Match => {
    const manualMatch = manual.get(`${source}:${modelId}`);
    if (manualMatch) return { id: manualMatch, status: "manual", confidence: 1 };

    for (const candidate of [canonicalSlug, modelId]) {
      if (candidate && ids.has(candidate)) {
        return { id: candidate, status: "exact", confidence: 1 };
      }
    }

    const byName = normalized.get(normalizeIdentity(name)) ?? [];
    if (byName.length === 1) {
      return { id: byName[0], status: "heuristic", confidence: 0.9 };
    }

    const suffix = normalizeIdentity(modelId.split("/").at(-1) ?? modelId);
    const bySuffix = suffixes.get(suffix) ?? [];
    if (bySuffix.length === 1) {
      return { id: bySuffix[0], status: "heuristic", confidence: 0.82 };
    }

    return { id: null, status: "unmatched", confidence: 0 };
  };
}

function upsertCanonicalModels(payload: unknown, now: string) {
  const database = getDatabase();
  const records = object(payload);
  database
    .prepare("UPDATE canonical_models SET active = 0 WHERE source = 'models.dev'")
    .run();

  const statement = database.prepare(`
    INSERT INTO canonical_models (
      id, name, developer, developer_country, family, description, release_date, knowledge_cutoff,
      last_updated, context_window, max_output, input_modalities, output_modalities,
      reasoning, tool_call, structured_output, attachment, open_weights,
      benchmarks_json, weights_json, source, raw_json, active, created_at, updated_at
    ) VALUES (
      @id, @name, @developer, @developerCountry, @family, @description, @releaseDate, @knowledgeCutoff,
      @lastUpdated, @contextWindow, @maxOutput, @inputModalities, @outputModalities,
      @reasoning, @toolCall, @structuredOutput, @attachment, @openWeights,
      @benchmarks, @weights, 'models.dev', @raw, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      developer = excluded.developer,
      developer_country = excluded.developer_country,
      family = excluded.family,
      description = excluded.description,
      release_date = excluded.release_date,
      knowledge_cutoff = excluded.knowledge_cutoff,
      last_updated = excluded.last_updated,
      context_window = excluded.context_window,
      max_output = excluded.max_output,
      input_modalities = excluded.input_modalities,
      output_modalities = excluded.output_modalities,
      reasoning = excluded.reasoning,
      tool_call = excluded.tool_call,
      structured_output = excluded.structured_output,
      attachment = excluded.attachment,
      open_weights = excluded.open_weights,
      benchmarks_json = excluded.benchmarks_json,
      weights_json = excluded.weights_json,
      raw_json = excluded.raw_json,
      active = 1,
      updated_at = excluded.updated_at
  `);

  for (const [key, rawValue] of Object.entries(records)) {
    const model = object(rawValue);
    const id = stringValue(model.id) ?? key;
    const developer = id.split("/")[0] ?? "unknown";
    const modalities = object(model.modalities);
    const limits = object(model.limit);
    statement.run({
      id,
      name: stringValue(model.name) ?? id,
      developer,
      developerCountry: developerCountry(developer),
      family: stringValue(model.family),
      description: stringValue(model.description),
      releaseDate: stringValue(model.release_date),
      knowledgeCutoff: stringValue(model.knowledge),
      lastUpdated: stringValue(model.last_updated),
      contextWindow: numberValue(limits.context),
      maxOutput: numberValue(limits.output),
      inputModalities: JSON.stringify(stringArray(modalities.input)),
      outputModalities: JSON.stringify(stringArray(modalities.output)),
      reasoning: booleanValue(model.reasoning),
      toolCall: booleanValue(model.tool_call),
      structuredOutput: booleanValue(model.structured_output),
      attachment: booleanValue(model.attachment),
      openWeights: booleanValue(model.open_weights),
      benchmarks: JSON.stringify(Array.isArray(model.benchmarks) ? model.benchmarks : []),
      weights: JSON.stringify(Array.isArray(model.weights) ? model.weights : []),
      raw: JSON.stringify(model),
      now,
    });
  }

  return Object.keys(records).length;
}

type OfferingWrite = {
  uid: string;
  source: string;
  sourceModelId: string;
  canonicalModelId: string | null;
  providerId: string;
  providerName: string;
  name: string;
  developer: string;
  family: string | null;
  description: string | null;
  mode: string | null;
  inputModalities: string;
  outputModalities: string;
  contextWindow: number | null;
  maxInput: number | null;
  maxOutput: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  currency: "CNY" | "USD" | null;
  priceUnit: string | null;
  priceStatus: "priced" | "free" | "unknown";
  isOfficialApi: number;
  market: "CN" | "US" | null;
  priceNote: string | null;
  verifiedAt: string | null;
  pricingTiers: string;
  reasoning: number | null;
  toolCall: number | null;
  structuredOutput: number | null;
  openWeights: number | null;
  releaseDate: string | null;
  deprecationDate: string | null;
  status: string;
  matchStatus: string;
  matchConfidence: number;
  sourceUrl: string | null;
  raw: string;
  now: string;
};

function offeringStatement() {
  return getDatabase().prepare(`
    INSERT INTO offerings (
      uid, source, source_model_id, canonical_model_id, provider_id, provider_name,
      name, developer, family, description, mode, input_modalities, output_modalities,
      context_window, max_input, max_output, input_price, output_price,
      cache_read_price, cache_write_price, currency, price_unit, price_status,
      is_official_api, market, price_note, verified_at, pricing_tiers_json,
      reasoning, tool_call, structured_output,
      open_weights, release_date, deprecation_date, status, match_status,
      match_confidence, source_url, raw_json, active, created_at, updated_at
    ) VALUES (
      @uid, @source, @sourceModelId, @canonicalModelId, @providerId, @providerName,
      @name, @developer, @family, @description, @mode, @inputModalities, @outputModalities,
      @contextWindow, @maxInput, @maxOutput, @inputPrice, @outputPrice,
      @cacheReadPrice, @cacheWritePrice, @currency, @priceUnit, @priceStatus,
      @isOfficialApi, @market, @priceNote, @verifiedAt, @pricingTiers,
      @reasoning, @toolCall, @structuredOutput,
      @openWeights, @releaseDate, @deprecationDate, @status, @matchStatus,
      @matchConfidence, @sourceUrl, @raw, 1, @now, @now
    )
    ON CONFLICT(uid) DO UPDATE SET
      canonical_model_id = excluded.canonical_model_id,
      provider_id = excluded.provider_id,
      provider_name = excluded.provider_name,
      name = excluded.name,
      developer = excluded.developer,
      family = excluded.family,
      description = excluded.description,
      mode = excluded.mode,
      input_modalities = excluded.input_modalities,
      output_modalities = excluded.output_modalities,
      context_window = excluded.context_window,
      max_input = excluded.max_input,
      max_output = excluded.max_output,
      input_price = excluded.input_price,
      output_price = excluded.output_price,
      cache_read_price = excluded.cache_read_price,
      cache_write_price = excluded.cache_write_price,
      currency = excluded.currency,
      price_unit = excluded.price_unit,
      price_status = excluded.price_status,
      is_official_api = excluded.is_official_api,
      market = excluded.market,
      price_note = excluded.price_note,
      verified_at = excluded.verified_at,
      pricing_tiers_json = excluded.pricing_tiers_json,
      reasoning = excluded.reasoning,
      tool_call = excluded.tool_call,
      structured_output = excluded.structured_output,
      open_weights = excluded.open_weights,
      release_date = excluded.release_date,
      deprecation_date = excluded.deprecation_date,
      status = excluded.status,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      source_url = excluded.source_url,
      raw_json = excluded.raw_json,
      active = 1,
      updated_at = excluded.updated_at
  `);
}

function upsertModelsDevOfferings(payload: unknown, now: string) {
  const providers = object(payload);
  const database = getDatabase();
  database
    .prepare("UPDATE offerings SET active = 0 WHERE source = 'models.dev'")
    .run();
  const write = offeringStatement();
  const match = createMatcher();
  let count = 0;

  for (const [providerKey, rawProvider] of Object.entries(providers)) {
    const provider = object(rawProvider);
    const providerId = stringValue(provider.id) ?? providerKey;
    const providerName = stringValue(provider.name) ?? providerId;
    const models = object(provider.models);

    for (const [modelKey, rawModel] of Object.entries(models)) {
      const model = object(rawModel);
      const sourceModelId = stringValue(model.id) ?? modelKey;
      const name = stringValue(model.name) ?? sourceModelId;
      const identity = match("models.dev", sourceModelId, name);
      const modalities = object(model.modalities);
      const limits = object(model.limit);
      const costs = object(model.cost);
      const developer = identity.id?.split("/")[0] ?? sourceModelId.split("/")[0] ?? providerId;
      const inputPrice = numberValue(costs.input);
      const outputPrice = numberValue(costs.output);
      const cacheReadPrice = numberValue(costs.cache_read);
      const cacheWritePrice = numberValue(costs.cache_write);
      const country = developerCountry(developer);
      const isOfficialApi =
        country === "US" && DIRECT_US_PROVIDERS.get(developer) === providerId;

      const row: OfferingWrite = {
        uid: stableUid("models.dev", providerId, sourceModelId),
        source: "models.dev",
        sourceModelId,
        canonicalModelId: identity.id,
        providerId,
        providerName,
        name,
        developer,
        family: stringValue(model.family),
        description: stringValue(model.description),
        mode: "chat",
        inputModalities: JSON.stringify(stringArray(modalities.input)),
        outputModalities: JSON.stringify(stringArray(modalities.output)),
        contextWindow: numberValue(limits.context),
        maxInput: numberValue(limits.input),
        maxOutput: numberValue(limits.output),
        inputPrice,
        outputPrice,
        cacheReadPrice,
        cacheWritePrice,
        currency: "USD",
        priceUnit: "per_million_tokens",
        priceStatus: inferredPriceStatus([
          inputPrice,
          outputPrice,
          cacheReadPrice,
          cacheWritePrice,
        ]),
        isOfficialApi: Number(isOfficialApi),
        market: country,
        priceNote: isOfficialApi ? "美国厂商官方 API 渠道价" : "第三方来源中的 API 渠道价",
        verifiedAt: isOfficialApi ? now.slice(0, 10) : null,
        pricingTiers: "[]",
        reasoning: booleanValue(model.reasoning),
        toolCall: booleanValue(model.tool_call),
        structuredOutput: booleanValue(model.structured_output),
        openWeights: booleanValue(model.open_weights),
        releaseDate: stringValue(model.release_date),
        deprecationDate: null,
        status: "active",
        matchStatus: identity.status,
        matchConfidence: identity.confidence,
        sourceUrl: stringValue(provider.doc),
        raw: JSON.stringify(model),
        now,
      };
      write.run(row);
      count += 1;
    }
  }

  return count;
}

function upsertLiteLlmOfferings(payload: unknown, now: string) {
  const records = object(payload);
  const database = getDatabase();
  database.prepare("UPDATE offerings SET active = 0 WHERE source = 'litellm'").run();
  const write = offeringStatement();
  const match = createMatcher();
  let count = 0;

  for (const [sourceModelId, rawModel] of Object.entries(records)) {
    if (sourceModelId === "sample_spec") continue;
    const model = object(rawModel);
    const providerId = stringValue(model.litellm_provider) ?? "unknown";
    const name = sourceModelId.split("/").at(-1) ?? sourceModelId;
    const identity = match("litellm", sourceModelId, name);
    const developer =
      identity.id?.split("/")[0] ??
      (sourceModelId.includes("/") ? sourceModelId.split("/")[0] : providerId);
    const deprecationDate = stringValue(model.deprecation_date);
    const status = deprecationDate && deprecationDate <= now.slice(0, 10) ? "deprecated" : "active";

    write.run({
      uid: stableUid("litellm", providerId, sourceModelId),
      source: "litellm",
      sourceModelId,
      canonicalModelId: identity.id,
      providerId,
      providerName: providerId,
      name,
      developer,
      family: null,
      description: stringValue(object(model.metadata).notes),
      mode: stringValue(model.mode),
      inputModalities: JSON.stringify([
        "text",
        ...(model.supports_vision ? ["image"] : []),
        ...(model.supports_audio_input ? ["audio"] : []),
        ...(model.supports_video_input ? ["video"] : []),
      ]),
      outputModalities: JSON.stringify([
        stringValue(model.mode) === "image_generation" ? "image" : "text",
        ...(model.supports_audio_output ? ["audio"] : []),
      ]),
      contextWindow: numberValue(model.max_tokens) ?? numberValue(model.max_input_tokens),
      maxInput: numberValue(model.max_input_tokens),
      maxOutput: numberValue(model.max_output_tokens),
      inputPrice: perMillion(model.input_cost_per_token),
      outputPrice: perMillion(model.output_cost_per_token),
      cacheReadPrice: perMillion(model.cache_read_input_token_cost),
      cacheWritePrice: perMillion(model.cache_creation_input_token_cost),
      currency: "USD",
      priceUnit: "per_million_tokens",
      priceStatus: inferredPriceStatus([
        perMillion(model.input_cost_per_token),
        perMillion(model.output_cost_per_token),
        perMillion(model.cache_read_input_token_cost),
        perMillion(model.cache_creation_input_token_cost),
      ]),
      isOfficialApi: 0,
      market: developerCountry(developer),
      priceNote: "LiteLLM 收录的 API 渠道价；不是中国厂商官方人民币价。",
      verifiedAt: null,
      pricingTiers: "[]",
      reasoning: booleanValue(model.supports_reasoning),
      toolCall: booleanValue(model.supports_function_calling),
      structuredOutput: booleanValue(model.supports_response_schema),
      openWeights: null,
      releaseDate: null,
      deprecationDate,
      status,
      matchStatus: identity.status,
      matchConfidence: identity.confidence,
      sourceUrl: stringValue(model.source),
      raw: JSON.stringify(model),
      now,
    } satisfies OfferingWrite);
    count += 1;
  }

  return count;
}

function upsertOpenRouterOfferings(payload: unknown, now: string) {
  const records = Array.isArray(object(payload).data) ? object(payload).data : [];
  const database = getDatabase();
  database.prepare("UPDATE offerings SET active = 0 WHERE source = 'openrouter'").run();
  const write = offeringStatement();
  const match = createMatcher();
  let count = 0;

  for (const rawModel of records as unknown[]) {
    const model = object(rawModel);
    const sourceModelId = stringValue(model.id);
    if (!sourceModelId) continue;
    const canonicalSlug = stringValue(model.canonical_slug);
    const name = stringValue(model.name) ?? sourceModelId;
    const identity = match("openrouter", sourceModelId, name, canonicalSlug);
    const architecture = object(model.architecture);
    const pricing = object(model.pricing);
    const topProvider = object(model.top_provider);
    const expirationDate = stringValue(model.expiration_date);
    const supported = stringArray(model.supported_parameters);

    write.run({
      uid: stableUid("openrouter", "openrouter", sourceModelId),
      source: "openrouter",
      sourceModelId,
      canonicalModelId: identity.id,
      providerId: "openrouter",
      providerName: "OpenRouter",
      name,
      developer: (canonicalSlug ?? sourceModelId).split("/")[0] ?? "unknown",
      family: stringValue(architecture.tokenizer),
      description: stringValue(model.description),
      mode: stringValue(architecture.modality),
      inputModalities: JSON.stringify(stringArray(architecture.input_modalities)),
      outputModalities: JSON.stringify(stringArray(architecture.output_modalities)),
      contextWindow: numberValue(model.context_length) ?? numberValue(topProvider.context_length),
      maxInput: null,
      maxOutput: numberValue(topProvider.max_completion_tokens),
      inputPrice: perMillion(pricing.prompt),
      outputPrice: perMillion(pricing.completion),
      cacheReadPrice: perMillion(pricing.input_cache_read),
      cacheWritePrice: perMillion(pricing.input_cache_write),
      currency: "USD",
      priceUnit: "per_million_tokens",
      priceStatus: inferredPriceStatus([
        perMillion(pricing.prompt),
        perMillion(pricing.completion),
        perMillion(pricing.input_cache_read),
        perMillion(pricing.input_cache_write),
      ]),
      isOfficialApi: 0,
      market: developerCountry((canonicalSlug ?? sourceModelId).split("/")[0] ?? "unknown"),
      priceNote: "OpenRouter API 渠道价；不是模型厂商官方直连价。",
      verifiedAt: null,
      pricingTiers: "[]",
      reasoning: booleanValue(Boolean(model.reasoning)),
      toolCall: booleanValue(supported.includes("tools")),
      structuredOutput: booleanValue(
        supported.includes("structured_outputs") || supported.includes("response_format"),
      ),
      openWeights: null,
      releaseDate: numberValue(model.created)
        ? new Date(Number(model.created) * 1000).toISOString().slice(0, 10)
        : null,
      deprecationDate: expirationDate,
      status: expirationDate && expirationDate <= now.slice(0, 10) ? "deprecated" : "active",
      matchStatus: identity.status,
      matchConfidence: identity.confidence,
      sourceUrl: `https://openrouter.ai/${sourceModelId}`,
      raw: JSON.stringify(model),
      now,
    } satisfies OfferingWrite);
    count += 1;
  }

  return count;
}

type CanonicalOfferingSeed = {
  family: string | null;
  description: string | null;
  input_modalities: string;
  output_modalities: string;
  context_window: number | null;
  max_output: number | null;
  reasoning: number | null;
  tool_call: number | null;
  structured_output: number | null;
  open_weights: number | null;
  release_date: string | null;
};

function upsertOfficialChinaPrices(now: string) {
  const database = getDatabase();
  const verifiedAt = chinaOfficialData.verified_at;

  const writeProvider = database.prepare(`
    INSERT INTO provider_sources (
      id, name, company, country, developer_ids_json, homepage_url, pricing_url,
      api_status, price_status, notes, verified_at, updated_at
    ) VALUES (
      @id, @name, @company, @country, @developerIds, @homepageUrl, @pricingUrl,
      @apiStatus, @priceStatus, @notes, @verifiedAt, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      company = excluded.company,
      country = excluded.country,
      developer_ids_json = excluded.developer_ids_json,
      homepage_url = excluded.homepage_url,
      pricing_url = excluded.pricing_url,
      api_status = excluded.api_status,
      price_status = excluded.price_status,
      notes = excluded.notes,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
  `);

  for (const provider of chinaOfficialData.providers) {
    writeProvider.run({
      id: provider.id,
      name: provider.name,
      company: provider.company,
      country: provider.country,
      developerIds: JSON.stringify(provider.developer_ids),
      homepageUrl: provider.homepage_url,
      pricingUrl: provider.pricing_url,
      apiStatus: provider.api_status,
      priceStatus: provider.price_status,
      notes: provider.notes,
      verifiedAt,
      now,
    });

    for (const developer of provider.developer_ids) {
      database
        .prepare("UPDATE canonical_models SET developer_country = 'CN' WHERE developer = ?")
        .run(developer);
    }
  }

  database
    .prepare("UPDATE offerings SET active = 0 WHERE source = 'official-cn'")
    .run();

  const providerNames = new Map(
    chinaOfficialData.providers.map((provider) => [provider.id, provider.name]),
  );
  const write = offeringStatement();
  const match = createMatcher();
  let count = 0;

  for (const price of chinaOfficialData.prices) {
    const identity = match(
      "official-cn",
      price.model_id,
      price.name,
      price.canonical_id,
    );
    const seed = identity.id
      ? (database
          .prepare(`
            SELECT family, description, input_modalities, output_modalities,
              context_window, max_output, reasoning, tool_call, structured_output,
              open_weights, release_date
            FROM canonical_models WHERE id = ?
          `)
          .get(identity.id) as CanonicalOfferingSeed | undefined)
      : undefined;
    const developer = price.canonical_id.split("/")[0] ?? price.provider_id;

    write.run({
      uid: stableUid("official-cn", price.provider_id, price.model_id),
      source: "official-cn",
      sourceModelId: price.model_id,
      canonicalModelId: identity.id,
      providerId: price.provider_id,
      providerName: providerNames.get(price.provider_id) ?? price.provider_id,
      name: price.name,
      developer,
      family: seed?.family ?? null,
      description: seed?.description ?? null,
      mode: "chat",
      inputModalities: seed?.input_modalities ?? '["text"]',
      outputModalities: seed?.output_modalities ?? '["text"]',
      contextWindow: price.context_window ?? seed?.context_window ?? null,
      maxInput: null,
      maxOutput: seed?.max_output ?? null,
      inputPrice: price.input_price,
      outputPrice: price.output_price,
      cacheReadPrice: price.cache_read_price,
      cacheWritePrice: price.cache_write_price,
      currency: "CNY",
      priceUnit: price.unit,
      priceStatus: price.price_status as "priced" | "free",
      isOfficialApi: 1,
      market: "CN",
      priceNote: price.note,
      verifiedAt,
      pricingTiers: JSON.stringify(price.tiers),
      reasoning: seed?.reasoning ?? null,
      toolCall: seed?.tool_call ?? null,
      structuredOutput: seed?.structured_output ?? null,
      openWeights: seed?.open_weights ?? null,
      releaseDate: seed?.release_date ?? null,
      deprecationDate:
        price.canonical_id === "tencent/hy3-preview" ? "2026-08-31" : null,
      status: "active",
      matchStatus: identity.status,
      matchConfidence: identity.confidence,
      sourceUrl: price.source_url,
      raw: JSON.stringify(price),
      now,
    } satisfies OfferingWrite);
    count += 1;
  }

  return count;
}

function updateSource(
  id: keyof typeof SOURCE_ENDPOINTS,
  count: number,
  now: string,
  error: string | null = null,
) {
  const source = SOURCE_ENDPOINTS[id];
  getDatabase()
    .prepare(`
      INSERT INTO sources (id, name, endpoint, record_count, last_synced_at, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        endpoint = excluded.endpoint,
        record_count = excluded.record_count,
        last_synced_at = excluded.last_synced_at,
        status = excluded.status,
        error = excluded.error
    `)
    .run(id, source.name, source.url, count, now, error ? "error" : "ok", error);
}

export async function syncCatalog(): Promise<SyncResult> {
  const database = getDatabase();
  const startedAt = new Date().toISOString();
  const run = database
    .prepare("INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')")
    .run(startedAt);
  const runId = Number(run.lastInsertRowid);

  try {
    const [modelsDevModels, modelsDevOfferings, liteLlm, openRouter] =
      await Promise.all([
        fetchJson(SOURCE_ENDPOINTS.modelsdev_models.url),
        fetchJson(SOURCE_ENDPOINTS.modelsdev_offerings.url),
        fetchJson(SOURCE_ENDPOINTS.litellm.url),
        fetchJson(SOURCE_ENDPOINTS.openrouter.url),
      ]);

    await Promise.all([
      writeRawSnapshot("modelsdev-models", modelsDevModels),
      writeRawSnapshot("modelsdev-offerings", modelsDevOfferings),
      writeRawSnapshot("litellm", liteLlm),
      writeRawSnapshot("openrouter", openRouter),
    ]);

    const now = new Date().toISOString();
    const counts = database.transaction(() => {
      const result = {
        modelsdev_models: upsertCanonicalModels(modelsDevModels, now),
        modelsdev_offerings: upsertModelsDevOfferings(modelsDevOfferings, now),
        litellm: upsertLiteLlmOfferings(liteLlm, now),
        openrouter: upsertOpenRouterOfferings(openRouter, now),
        official_cn: upsertOfficialChinaPrices(now),
      };

      for (const [source, count] of Object.entries(result)) {
        updateSource(source as keyof typeof SOURCE_ENDPOINTS, count, now);
      }

      return result;
    })();

    const completedAt = new Date().toISOString();
    const unmatchedOfferings = (
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM offerings WHERE active = 1 AND canonical_model_id IS NULL",
        )
        .get() as { count: number }
    ).count;

    database
      .prepare(
        "UPDATE sync_runs SET completed_at = ?, status = 'ok', counts_json = ? WHERE id = ?",
      )
      .run(completedAt, JSON.stringify(counts), runId);

    return { runId, startedAt, completedAt, counts, unmatchedOfferings };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    database
      .prepare(
        "UPDATE sync_runs SET completed_at = ?, status = 'error', error = ? WHERE id = ?",
      )
      .run(completedAt, message, runId);
    throw error;
  }
}
