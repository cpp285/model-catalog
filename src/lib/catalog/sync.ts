import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDataDirectory, getDatabase } from "./database";
import type { SyncResult } from "./types";
import chinaOfficialData from "../../../data/official/china-api-prices.json";
import aliyunPricingData from "../../../data/official/aliyun-model-pricing.json";
import aliyunModelSpecs from "../../../data/official/aliyun-model-specs.json";
import curatedRecentModels from "../../../data/official/curated-recent-models.json";
import curatedRetrievalModels from "../../../data/official/curated-retrieval-models.json";
import opennessEvidence from "../../../data/official/openness-evidence.json";
import {
  fetchLiveOfficialPrices,
  type LiveOfficialPriceResult,
  type OfficialPriceRecord,
} from "./official-price-sync";
import {
  fetchOfficialWeightRepositories,
  type OfficialWeightRepository,
  type OfficialWeightRepositoryResult,
} from "./official-openness-sync";
import {
  fetchOfficialMediaPrices,
  type OfficialMediaPriceRecord,
  type OfficialMediaPriceResult,
} from "./official-media-price-sync";
import {
  fetchVolcenginePricing,
  type VolcenginePricingRecord,
  type VolcenginePricingResult,
} from "./official-volcengine-sync";

type JsonObject = Record<string, unknown>;

const SOURCE_ENDPOINTS = {
  modelsdev_models: {
    name: "Models.dev 底层模型",
    url: "https://models.dev/models.json",
  },
  modelsdev_offerings: {
    name: "美国厂商官方 API",
    url: "https://models.dev/api.json",
  },
  openrouter: {
    name: "OpenRouter 模型目录",
    url: "https://openrouter.ai/api/v1/models?output_modalities=all",
  },
  qianwen_catalog: {
    name: "千问模型市场（模型身份核验）",
    url: "https://www.qianwenai.com/models",
  },
  qianwen_pricing: {
    name: "千问模型市场（人民币 API 价格）",
    url: "https://www.qianwenai.com/models",
  },
  volcengine_ark: {
    name: "火山方舟模型广场（模型身份核验）",
    url: "https://ark.volcengine.com/region:cn-beijing/model?view=CARD_VIEW&preset=ModelGroups",
  },
  volcengine_pricing: {
    name: "火山方舟人民币 API 价格与规格",
    url: "https://ark.volcengine.com/region:cn-beijing/model?view=CARD_VIEW&preset=ModelGroups",
  },
  curated_recent: {
    name: "近期模型官方证据",
    url: "data/official/curated-recent-models.json",
  },
  curated_retrieval: {
    name: "主流向量与重排序模型官方证据",
    url: "data/official/curated-retrieval-models.json",
  },
  curated_openness: {
    name: "模型开放性官方证据",
    url: "data/official/openness-evidence.json",
  },
  official_open_weights: {
    name: "厂商官方开放权重仓库",
    url: "https://huggingface.co/models",
  },
  official_us_media_live: {
    name: "美国厂商官网实时价格",
    url: "https://docs.x.ai/developers/pricing",
  },
  official_cn: {
    name: "中国厂商官方 API 定价",
    url: "data/official/china-api-prices.json",
  },
  official_minimax_live: {
    name: "MiniMax 官网实时价格",
    url: "https://platform.minimaxi.com/docs/guides/pricing-paygo",
  },
  official_deepseek_live: {
    name: "DeepSeek 官网实时价格",
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
  },
  official_moonshot_live: {
    name: "Kimi 官网实时价格",
    url: "https://platform.kimi.com/docs/pricing/chat",
  },
  official_zhipu_live: {
    name: "智谱官网实时价格",
    url: "https://open.bigmodel.cn/pricing",
  },
} as const;

const LIVE_OFFICIAL_SOURCE_IDS = {
  minimax: "official_minimax_live",
  deepseek: "official_deepseek_live",
  moonshot: "official_moonshot_live",
  zhipu: "official_zhipu_live",
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
  "voyage",
  "xai",
]);

const DIRECT_US_PROVIDERS = new Map([
  ["anthropic", "anthropic"],
  ["google", "google"],
  ["openai", "openai"],
  ["xai", "xai"],
]);

const CHINA_DEVELOPERS = new Set(
  [
    ...chinaOfficialData.providers.flatMap((provider) => provider.developer_ids),
    "baai",
  ],
);

function developerCountry(developer: string) {
  if (CHINA_DEVELOPERS.has(developer)) return "CN";
  if (US_DEVELOPERS.has(developer)) return "US";
  return null;
}

function inferredPriceStatus(values: Array<number | null>) {
  return values.some((value) => value !== null && value > 0) ? "priced" : "unknown";
}

function inferModelType(id: string, name: string, outputModalities: string[] = []) {
  const identity = `${id} ${name}`.toLowerCase();
  if (identity.includes("ocr")) return "ocr";
  if (identity.includes("rerank")) return "rerank";
  if (identity.includes("embedding") || identity.includes("embed")) return "embedding";
  if (identity.includes("tts") || identity.includes("text-to-speech")) return "text_to_speech";
  if (identity.includes("asr") || identity.includes("speech-to-text")) return "speech_to_text";
  if (outputModalities.includes("3d")) return "three_d_generation";
  if (outputModalities.includes("video")) return "video_generation";
  if (outputModalities.includes("image")) return "image_generation";
  if (outputModalities.includes("audio")) return "audio_generation";
  return "chat";
}

function aliyunModelProfile(section: string, group: string, modelId: string) {
  if (section === "文本向量") {
    return { modelType: "embedding", input: ["text"], output: ["embedding"] };
  }
  if (section === "多模态向量") {
    return {
      modelType: "multimodal_embedding",
      input: ["text", "image", "video"],
      output: ["embedding"],
    };
  }
  if (section === "排序模型") {
    return {
      modelType: "rerank",
      input: modelId.includes("vl") ? ["text", "image"] : ["text"],
      output: ["score"],
    };
  }
  if (section === "图像生成") {
    return {
      modelType: "image_generation",
      input: group.includes("文生") ? ["text"] : ["text", "image"],
      output: ["image"],
    };
  }
  if (section === "视频生成") {
    return {
      modelType: "video_generation",
      input: group.includes("文生")
        ? ["text"]
        : group.includes("图生")
          ? ["text", "image"]
          : ["text", "image", "video", "audio"],
      output: ["video"],
    };
  }
  if (section === "音乐生成") {
    return { modelType: "music_generation", input: ["text", "audio"], output: ["audio"] };
  }
  if (section.startsWith("语音合成")) {
    return { modelType: "text_to_speech", input: ["text"], output: ["audio"] };
  }
  if (section.startsWith("语音识别")) {
    return { modelType: "speech_to_text", input: ["audio"], output: ["text"] };
  }
  if (section === "语音对话") {
    return {
      modelType: "speech_to_speech",
      input: ["text", "audio"],
      output: ["text", "audio"],
    };
  }
  if (section === "行业模型") {
    return { modelType: "industry", input: ["text"], output: ["text"] };
  }
  return { modelType: "chat", input: ["text"], output: ["text"] };
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

async function fetchQianwenCatalog() {
  const params = {
    OrderType: "Featured",
    ContextWindow: { MinWindow: 4096, MaxWindow: 10_000_000 },
    Pricing: { MinPrice: 0, MaxPrice: 54 },
    PageNo: 1,
    PageSize: 500,
    Language: "zh-CN",
  };
  const body = new URLSearchParams({
    product: "AliyunDeliveryService",
    action: "ListModelSeries",
    sec_token: "",
    params: JSON.stringify(params),
  });
  const response = await fetch(
    "https://platform-home.qianwenai.com/data/api.json?product=AliyunDeliveryService&action=ListModelSeries",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: SOURCE_ENDPOINTS.qianwen_catalog.url,
        "user-agent": "local-model-catalog/0.1",
      },
      body,
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) throw new Error(`千问模型市场：${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

async function fetchVolcengineArkCatalog() {
  const response = await fetch(
    "https://arkbff-cn-beijing.console.volcengine.com/api/2024-10-01/GetModelSquareCardViewBootstrap?",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        origin: "https://ark.volcengine.com",
        referer: SOURCE_ENDPOINTS.volcengine_ark.url,
        "user-agent": "local-model-catalog/0.1",
      },
      body: JSON.stringify({ region: "cn-beijing" }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) throw new Error(`火山方舟：${response.status} ${response.statusText}`);
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

async function readOfficialPriceSnapshot(
  providerId: LiveOfficialPriceResult["providerId"],
) {
  try {
    const snapshotPath = path.join(
      getDataDirectory(),
      "raw",
      `official-${providerId}-pricing.json`,
    );
    const payload = object(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
    return Array.isArray(payload.prices)
      ? (payload.prices.filter(isObject) as OfficialPriceRecord[])
      : [];
  } catch {
    return [];
  }
}

async function readOfficialWeightRepositorySnapshot(): Promise<OfficialWeightRepositoryResult> {
  try {
    const snapshotPath = path.join(
      getDataDirectory(),
      "raw",
      "official-open-weight-repositories.json",
    );
    const payload = object(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
    return {
      fetchedAt: stringValue(payload.fetchedAt) ?? new Date(0).toISOString(),
      repositories: Array.isArray(payload.repositories)
        ? payload.repositories.filter(isObject).flatMap((record) => {
            const developer = stringValue(record.developer);
            const organization = stringValue(record.organization);
            const repositoryId = stringValue(record.repositoryId);
            const modelName = stringValue(record.modelName);
            const sourceUrl = stringValue(record.sourceUrl);
            return developer && organization && repositoryId && modelName && sourceUrl
              ? [{ developer, organization, repositoryId, modelName, sourceUrl }]
              : [];
          })
        : [],
      successfulOrganizations: stringArray(payload.successfulOrganizations),
      errors: stringArray(payload.errors),
    };
  } catch {
    return {
      fetchedAt: new Date(0).toISOString(),
      repositories: [],
      successfulOrganizations: [],
      errors: [],
    };
  }
}

function mergeOfficialWeightRepositorySnapshots(
  fresh: OfficialWeightRepositoryResult,
  previous: OfficialWeightRepositoryResult,
): OfficialWeightRepositoryResult {
  const successful = new Set(fresh.successfulOrganizations);
  const repositories = [
    ...fresh.repositories,
    ...previous.repositories.filter((item) => !successful.has(item.organization)),
  ];
  const deduplicated = new Map(
    repositories.map((item) => [`${item.organization}/${item.repositoryId}`, item]),
  );
  return {
    ...fresh,
    repositories: [...deduplicated.values()],
  };
}

async function readOfficialMediaPriceSnapshot(): Promise<OfficialMediaPriceResult> {
  try {
    const snapshotPath = path.join(
      getDataDirectory(),
      "raw",
      "official-us-media-pricing.json",
    );
    const payload = object(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
    return {
      fetchedAt: stringValue(payload.fetchedAt) ?? new Date(0).toISOString(),
      successfulProviders: stringArray(payload.successfulProviders),
      records: Array.isArray(payload.records)
        ? (payload.records.filter(isObject) as unknown as OfficialMediaPriceRecord[])
        : [],
      errors: stringArray(payload.errors),
    };
  } catch {
    return {
      fetchedAt: new Date(0).toISOString(),
      successfulProviders: [],
      records: [],
      errors: [],
    };
  }
}

function mergeOfficialMediaPriceSnapshots(
  fresh: OfficialMediaPriceResult,
  previous: OfficialMediaPriceResult,
): OfficialMediaPriceResult {
  const successful = new Set(fresh.successfulProviders);
  const records = [
    ...fresh.records,
    ...previous.records.filter((item) => !successful.has(item.providerId)),
  ];
  const deduplicated = new Map(records.map((item) => [item.canonicalId, item]));
  return { ...fresh, records: [...deduplicated.values()] };
}

async function readVolcenginePricingSnapshot(): Promise<VolcenginePricingResult> {
  try {
    const snapshotPath = path.join(
      getDataDirectory(),
      "raw",
      "volcengine-detail-pricing.json",
    );
    const payload = object(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
    return {
      fetchedAt: stringValue(payload.fetchedAt) ?? new Date(0).toISOString(),
      successfulModels: stringArray(payload.successfulModels),
      records: Array.isArray(payload.records)
        ? (payload.records.filter(isObject) as unknown as VolcenginePricingRecord[])
        : [],
      errors: stringArray(payload.errors),
    };
  } catch {
    return {
      fetchedAt: new Date(0).toISOString(),
      successfulModels: [],
      records: [],
      errors: [],
    };
  }
}

function mergeVolcenginePricingSnapshots(
  fresh: VolcenginePricingResult,
  previous: VolcenginePricingResult,
): VolcenginePricingResult {
  const successful = new Set(fresh.successfulModels);
  const records = [
    ...fresh.records,
    ...previous.records.filter((item) => !successful.has(item.modelName)),
  ];
  const deduplicated = new Map(records.map((item) => [item.modelName, item]));
  return { ...fresh, records: [...deduplicated.values()] };
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
      id, name, developer, developer_country, model_type, family, description, release_date, knowledge_cutoff,
      last_updated, context_window, max_output, input_modalities, output_modalities,
      reasoning, tool_call, structured_output, attachment, open_weights,
      benchmarks_json, weights_json, specs_json, source, raw_json, active, created_at, updated_at
    ) VALUES (
      @id, @name, @developer, @developerCountry, @modelType, @family, @description, @releaseDate, @knowledgeCutoff,
      @lastUpdated, @contextWindow, @maxOutput, @inputModalities, @outputModalities,
      @reasoning, @toolCall, @structuredOutput, @attachment, @openWeights,
      @benchmarks, @weights, '{}', 'models.dev', @raw, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      developer = excluded.developer,
      developer_country = excluded.developer_country,
      model_type = excluded.model_type,
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
    const outputModalities = stringArray(modalities.output);
    statement.run({
      id,
      name: stringValue(model.name) ?? id,
      developer,
      developerCountry: developerCountry(developer),
      modelType: inferModelType(id, stringValue(model.name) ?? id, outputModalities),
      family: stringValue(model.family),
      description: stringValue(model.description),
      releaseDate: stringValue(model.release_date),
      knowledgeCutoff: stringValue(model.knowledge),
      lastUpdated: stringValue(model.last_updated),
      contextWindow: numberValue(limits.context),
      maxOutput: numberValue(limits.output),
      inputModalities: JSON.stringify(stringArray(modalities.input)),
      outputModalities: JSON.stringify(outputModalities),
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

const QIANWEN_DEVELOPER_MAP: Record<string, string> = {
  qwen: "alibaba",
  "qwen-domain-model": "alibaba",
  wan: "alibaba",
  deepseek: "deepseek",
  "zhipu-ai": "zhipuai",
  "moonshot-ai": "moonshotai",
  "mini-max": "minimax",
  xiaomi: "xiaomi",
  stepfun: "stepfun",
  kling: "kuaishou",
  vidu: "shengshu",
  pixverse: "pixverse",
  tripo: "tripo",
  happyhorse: "happyhorse",
};

const ARK_DEVELOPER_MAP: Record<string, string> = {
  Bytedance: "bytedance-seed",
  DeepSeek: "deepseek",
  "智谱AI": "zhipuai",
  "影眸科技（上海）有限公司": "hyper3d",
  "北京数美万物科技有限公司": "hitem3d",
};

function catalogSlug(value: string) {
  const suffix = value.split("/").at(-1) ?? value;
  return suffix
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(".", "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const VERSION_DATE_SUFFIX = /-(?:20\d{6}|20\d{2}-\d{2}-\d{2}|\d{6}|2\d(?:0[1-9]|1[0-2])|(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))$/;
const VERSION_CHANNEL_SUFFIX = /-(?:preview|latest|ga|official|stable|beta)$/;

function productSlug(value: string) {
  let slug = catalogSlug(value);
  for (let index = 0; index < 4; index += 1) {
    const next = slug.replace(VERSION_DATE_SUFFIX, "").replace(VERSION_CHANNEL_SUFFIX, "");
    if (next === slug) break;
    slug = next;
  }
  return slug;
}

export function canonicalProductId(developer: string, modelId: string) {
  const suffix = modelId.split("/").at(-1) ?? modelId;
  let slug = productSlug(suffix);
  if (developer.toLowerCase() === "bytedance-seed") {
    slug = slug.replace(/^doubao-/, "");
  }
  return `${developer.toLowerCase()}/${slug}`;
}

type CanonicalProductRow = {
  id: string;
  name: string;
  developer: string;
  developer_country: string | null;
  model_type: string;
  family: string | null;
  description: string | null;
  release_date: string | null;
  knowledge_cutoff: string | null;
  last_updated: string | null;
  context_window: number | null;
  max_output: number | null;
  input_modalities: string;
  output_modalities: string;
  reasoning: number | null;
  tool_call: number | null;
  structured_output: number | null;
  attachment: number | null;
  open_weights: number | null;
  benchmarks_json: string;
  weights_json: string;
  specs_json: string;
  source: string;
  raw_json: string;
  active: number;
  retired_at: string | null;
};

function parsedJson(value: string): JsonObject {
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

function productSourcePriority(row: CanonicalProductRow) {
  const raw = parsedJson(row.raw_json);
  if (row.source === "official-cn" && stringValue(raw.canonical_id)) return 140;
  if (row.source === "curated-official") return 130;
  if (row.source === "official-cn") return 115;
  if (row.source === "qianwen-catalog") {
    return row.developer === "alibaba" ? 110 : 90;
  }
  if (row.source === "volcengine-ark") {
    return row.developer === "bytedance-seed" ? 110 : 90;
  }
  if (row.source === "models.dev") return 50;
  return 60;
}

function versionKind(row: CanonicalProductRow, productId: string) {
  const suffix = catalogSlug(row.id.split("/").at(-1) ?? row.id);
  const identity = `${suffix} ${row.name}`.toLowerCase();
  if (/(?:^|[-_\s])(preview|beta)(?:$|[-_\s])/.test(identity)) return "preview";
  if (/(?:^|[-_\s])(ga|official|stable|latest)(?:$|[-_\s])/.test(identity) || identity.includes("正式版")) {
    return "alias";
  }
  if (VERSION_DATE_SUFFIX.test(suffix)) return "snapshot";
  if (row.id.toLowerCase() !== productId.toLowerCase()) return "superseded";
  return "stable";
}

function latestText(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function mergedBoolean(
  rows: CanonicalProductRow[],
  key: "reasoning" | "tool_call" | "structured_output" | "attachment" | "open_weights",
) {
  if (rows.some((row) => row[key] === 1)) return 1;
  if (rows.some((row) => row[key] === 0)) return 0;
  return null;
}

function mergedStringArray(rows: CanonicalProductRow[], key: "input_modalities" | "output_modalities") {
  return JSON.stringify([
    ...new Set(
      rows.flatMap((row) => {
        try {
          return stringArray(JSON.parse(row[key]));
        } catch {
          return [];
        }
      }),
    ),
  ]);
}

function preferredJson(rows: CanonicalProductRow[], key: "benchmarks_json" | "weights_json" | "specs_json") {
  const emptyValue = key === "specs_json" ? "{}" : "[]";
  return rows.find((row) => row[key] && row[key] !== emptyValue)?.[key] ?? emptyValue;
}

/**
 * Canonical rows keep source versions for traceability, while the library exposes
 * exactly one current product row. A stable API id wins identity; official/direct
 * metadata wins content for Chinese models.
 */
function applyCanonicalProductNormalization(now: string, previouslyActiveProducts: Set<string>) {
  const database = getDatabase();
  const rows = database
    .prepare(`
      SELECT id, name, developer, developer_country, model_type, family, description,
        release_date, knowledge_cutoff, last_updated, context_window, max_output,
        input_modalities, output_modalities, reasoning, tool_call, structured_output,
        attachment, open_weights, benchmarks_json, weights_json, specs_json,
        source, raw_json, active, retired_at
      FROM canonical_models
    `)
    .all() as CanonicalProductRow[];
  const groups = new Map<string, CanonicalProductRow[]>();

  for (const row of rows) {
    const productId = canonicalProductId(row.developer, row.id);
    groups.set(productId, [...(groups.get(productId) ?? []), row]);
  }

  const markVersion = database.prepare(`
    UPDATE canonical_models SET
      product_id = @productId,
      lifecycle_status = @lifecycleStatus,
      retired_at = @retiredAt,
      callable = @callable,
      is_current = @isCurrent,
      updated_at = @now
    WHERE id = @id
  `);
  const mergeCurrent = database.prepare(`
    UPDATE canonical_models SET
      name = @name,
      developer_country = COALESCE(@developerCountry, developer_country),
      model_type = @modelType,
      family = COALESCE(@family, family),
      description = COALESCE(@description, description),
      release_date = COALESCE(@releaseDate, release_date),
      knowledge_cutoff = COALESCE(@knowledgeCutoff, knowledge_cutoff),
      last_updated = COALESCE(@lastUpdated, last_updated),
      context_window = COALESCE(@contextWindow, context_window),
      max_output = COALESCE(@maxOutput, max_output),
      input_modalities = @inputModalities,
      output_modalities = @outputModalities,
      reasoning = @reasoning,
      tool_call = @toolCall,
      structured_output = @structuredOutput,
      attachment = @attachment,
      open_weights = @openWeights,
      benchmarks_json = @benchmarks,
      weights_json = @weights,
      specs_json = @specs,
      source = @source,
      raw_json = @raw,
      updated_at = @now
    WHERE id = @id
  `);

  let currentProducts = 0;
  let hiddenVersions = 0;
  for (const [productId, productRows] of groups) {
    const activeRows = productRows.filter((row) => row.active === 1);
    if (!activeRows.length) {
      const shouldArchive =
        previouslyActiveProducts.has(productId) ||
        productRows.some((row) => Boolean(row.retired_at));
      const archived = [...productRows].sort((left, right) => {
        const leftStable = Number(left.id.toLowerCase() === productId.toLowerCase());
        const rightStable = Number(right.id.toLowerCase() === productId.toLowerCase());
        if (leftStable !== rightStable) return rightStable - leftStable;
        const sourceDifference = productSourcePriority(right) - productSourcePriority(left);
        if (sourceDifference) return sourceDifference;
        return (right.release_date ?? "").localeCompare(left.release_date ?? "");
      })[0];
      for (const row of productRows) {
        markVersion.run({
          id: row.id,
          productId,
          lifecycleStatus: "retired",
          retiredAt: shouldArchive ? (row.retired_at ?? now) : null,
          callable: 0,
          isCurrent: Number(shouldArchive && row.id === archived.id),
          now,
        });
      }
      continue;
    }

    const ranked = [...activeRows].sort((left, right) => {
      const leftStable = Number(left.id.toLowerCase() === productId.toLowerCase());
      const rightStable = Number(right.id.toLowerCase() === productId.toLowerCase());
      if (leftStable !== rightStable) return rightStable - leftStable;
      const sourceDifference = productSourcePriority(right) - productSourcePriority(left);
      if (sourceDifference) return sourceDifference;
      return (right.release_date ?? "").localeCompare(left.release_date ?? "");
    });
    const current = ranked[0];
    const metadataRows = [...activeRows].sort((left, right) => {
      const sourceDifference = productSourcePriority(right) - productSourcePriority(left);
      if (sourceDifference) return sourceDifference;
      const leftStable = Number(left.id.toLowerCase() === productId.toLowerCase());
      const rightStable = Number(right.id.toLowerCase() === productId.toLowerCase());
      if (leftStable !== rightStable) return rightStable - leftStable;
      return (right.release_date ?? "").localeCompare(left.release_date ?? "");
    });
    const preferred = metadataRows[0];
    const hasReplacement = activeRows.some((row) => versionKind(row, productId) !== "preview");

    for (const row of productRows) {
      const isCurrent = row.id === current.id && row.active === 1;
      const kind = versionKind(row, productId);
      const lifecycleStatus = isCurrent
        ? kind === "preview" ? "preview" : "current"
        : kind === "preview" && hasReplacement ? "retired" : kind === "stable" ? "superseded" : kind;
      markVersion.run({
        id: row.id,
        productId,
        lifecycleStatus,
        retiredAt: null,
        callable: Number(isCurrent),
        isCurrent: Number(isCurrent),
        now,
      });
      if (!isCurrent && row.active === 1) hiddenVersions += 1;
    }

    mergeCurrent.run({
      id: current.id,
      name: preferred.name,
      developerCountry: preferred.developer_country,
      modelType: preferred.model_type,
      family: metadataRows.find((row) => row.family)?.family ?? null,
      description: metadataRows.find((row) => row.description)?.description ?? null,
      releaseDate: latestText(activeRows.map((row) => row.release_date)),
      knowledgeCutoff: latestText(activeRows.map((row) => row.knowledge_cutoff)),
      lastUpdated: latestText(activeRows.map((row) => row.last_updated)),
      contextWindow: metadataRows.find((row) => row.context_window)?.context_window ?? null,
      maxOutput: metadataRows.find((row) => row.max_output)?.max_output ?? null,
      inputModalities: mergedStringArray(metadataRows, "input_modalities"),
      outputModalities: mergedStringArray(metadataRows, "output_modalities"),
      reasoning: mergedBoolean(metadataRows, "reasoning"),
      toolCall: mergedBoolean(metadataRows, "tool_call"),
      structuredOutput: mergedBoolean(metadataRows, "structured_output"),
      attachment: mergedBoolean(metadataRows, "attachment"),
      openWeights: mergedBoolean(metadataRows, "open_weights"),
      benchmarks: preferredJson(metadataRows, "benchmarks_json"),
      weights: preferredJson(metadataRows, "weights_json"),
      specs: preferredJson(metadataRows, "specs_json"),
      source: preferred.source,
      raw: preferred.raw_json,
      now,
    });
    currentProducts += 1;
  }

  const duplicateGroups = database
    .prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT product_id
        FROM canonical_models
        WHERE active = 1 AND is_current = 1
        GROUP BY product_id
        HAVING COUNT(*) > 1
      )
    `)
    .get() as { count: number };
  if (duplicateGroups.count > 0) {
    throw new Error(`产品模型归并校验失败：仍有 ${duplicateGroups.count} 个重复组。`);
  }

  return { currentProducts, hiddenVersions };
}

const REPOSITORY_PACKAGING_SUFFIX =
  /-(?:gguf|awq|gptq|fp8|fp4|int4|int8|bf16|mlx|onnx|hf|safetensors|4bit|8bit)$/;
const CATALOG_BRAND_PREFIX = /^(?:moonshot|siliconflow|vanchin|modelscope)-/;

function officialWeightIdentity(value: string) {
  let slug = productSlug(value.split("/").at(-1) ?? value);
  for (let index = 0; index < 4; index += 1) {
    const next = slug.replace(REPOSITORY_PACKAGING_SUFFIX, "");
    if (next === slug) break;
    slug = next;
  }
  return slug;
}

function officialWeightCandidates(id: string, name: string) {
  const candidates = new Set<string>();
  for (const value of [id, name]) {
    const identity = officialWeightIdentity(value);
    if (!identity) continue;
    candidates.add(identity);
    candidates.add(identity.replace(CATALOG_BRAND_PREFIX, ""));
  }
  return candidates;
}

function firstWeightUrl(weightsJson: string) {
  try {
    const weights: unknown = JSON.parse(weightsJson);
    if (!Array.isArray(weights)) return null;
    const first = weights.find((value): value is string => typeof value === "string");
    return first ?? null;
  } catch {
    return null;
  }
}

function applyOfficialOpennessClassification(
  repositories: OfficialWeightRepository[],
  now: string,
) {
  const database = getDatabase();
  const rows = database
    .prepare(`
      SELECT id, name, developer, source, open_weights, weights_json
      FROM canonical_models
      WHERE active = 1 AND is_current = 1
      ORDER BY id
    `)
    .all() as Array<{
    id: string;
    name: string;
    developer: string;
    source: string;
    open_weights: number | null;
    weights_json: string;
  }>;
  const repositoriesByDeveloper = new Map<string, OfficialWeightRepository[]>();
  for (const repository of repositories) {
    repositoriesByDeveloper.set(repository.developer, [
      ...(repositoriesByDeveloper.get(repository.developer) ?? []),
      repository,
    ]);
  }

  const evidenceByModel = new Map<string, OfficialWeightRepository>();
  const inheritedOpenness = new Map<
    string,
    { baseId: string; sourceUrl: string | null }
  >();
  const markOpen = database.prepare(`
    UPDATE canonical_models
    SET open_weights = 1, updated_at = @now
    WHERE id = @id AND active = 1 AND is_current = 1
  `);

  for (const row of rows) {
    const candidates = officialWeightCandidates(row.id, row.name);
    const repository = (repositoriesByDeveloper.get(row.developer) ?? []).find((item) => {
      const repositoryIdentity = officialWeightIdentity(item.modelName);
      return candidates.has(repositoryIdentity);
    });
    if (!repository) continue;
    markOpen.run({ id: row.id, now });
    evidenceByModel.set(row.id, repository);
  }

  const speedVariants = database
    .prepare(`
      SELECT id, open_weights, weights_json
      FROM canonical_models
      WHERE active = 1 AND is_current = 1
      ORDER BY id
    `)
    .all() as Array<{ id: string; open_weights: number | null; weights_json: string }>;
  const variantsById = new Map(speedVariants.map((row) => [row.id, row]));
  for (const variant of speedVariants) {
    const baseId = variant.id.replace(/-(?:highspeed|ultraspeed)$/, "");
    if (baseId === variant.id) continue;
    const base = variantsById.get(baseId);
    if (base?.open_weights !== 1) continue;
    markOpen.run({ id: variant.id, now });
    inheritedOpenness.set(variant.id, {
      baseId,
      sourceUrl:
        evidenceByModel.get(baseId)?.sourceUrl ?? firstWeightUrl(base.weights_json),
    });
  }

  database.prepare(`
    UPDATE canonical_models
    SET open_weights = 0, updated_at = @now
    WHERE active = 1 AND open_weights IS NULL
  `).run({ now });
  database.prepare(`
    UPDATE offerings
    SET open_weights = COALESCE(
      (SELECT model.open_weights FROM canonical_models model WHERE model.id = offerings.canonical_model_id),
      0
    ), updated_at = @now
    WHERE active = 1
  `).run({ now });

  database.prepare("DELETE FROM model_openness_evidence").run();
  const writeEvidence = database.prepare(`
    INSERT INTO model_openness_evidence (
      canonical_model_id, open_weights, basis, source_url, verified_at, updated_at
    ) VALUES (
      @canonicalModelId, @openWeights, @basis, @sourceUrl, @verifiedAt, @now
    )
  `);
  const classifiedRows = database
    .prepare(`
      SELECT id, name, source, open_weights, weights_json
      FROM canonical_models
      WHERE active = 1 AND is_current = 1
      ORDER BY id
    `)
    .all() as Array<{
    id: string;
    name: string;
    source: string;
    open_weights: number;
    weights_json: string;
  }>;

  for (const row of classifiedRows) {
    const repository = evidenceByModel.get(row.id);
    const inherited = inheritedOpenness.get(row.id);
    const openWeights = Number(row.open_weights === 1);
    const sourceUrl =
      repository?.sourceUrl ?? inherited?.sourceUrl ?? firstWeightUrl(row.weights_json);
    const basis = repository
      ? `厂商官方账号已公开 ${repository.repositoryId} 权重仓库。`
      : inherited
        ? `该记录是 ${inherited.baseId} 的高速 API 档位，开放性继承其已确认开放权重的底层模型。`
      : openWeights
        ? "上游模型资料或官方模型目录已明确标记为开放权重。"
        : "截至本次同步，官方模型目录未标记为开放权重，且未匹配到厂商官方权重仓库；按当前未开放权重归为闭源。";
    writeEvidence.run({
      canonicalModelId: row.id,
      openWeights,
      basis,
      sourceUrl,
      verifiedAt: now,
      now,
    });
  }

  return evidenceByModel.size;
}

function catalogCanonicalId(developer: string, sourceModelId: string) {
  const sourceSuffix = sourceModelId.split("/").at(-1) ?? sourceModelId;
  const miniMaxLanguageModel = sourceSuffix.match(/^minimax-(m[0-9].*)$/i);
  if (developer === "minimax" && miniMaxLanguageModel) {
    return canonicalProductId(developer, `MiniMax-${miniMaxLanguageModel[1]}`);
  }
  return canonicalProductId(developer, sourceModelId);
}

function normalizedModalities(value: unknown) {
  return [...new Set(stringArray(value).flatMap((item) => {
    const normalized = item.toLowerCase();
    if (normalized.includes("3d")) return ["3d"];
    if (normalized.includes("embedding")) return ["embedding"];
    if (["text", "image", "video", "audio", "pdf", "score"].includes(normalized)) {
      return [normalized];
    }
    return [];
  }))];
}

function inferCatalogModelType(
  id: string,
  name: string,
  capabilities: string[],
  inputModalities: string[],
  outputModalities: string[],
) {
  const identity = `${id} ${name}`.toLowerCase();
  const normalizedCapabilities = capabilities.map((item) => item.toLowerCase());
  if (identity.includes("ocr")) return "ocr";
  if (identity.includes("rerank")) return "rerank";
  if (identity.includes("3d") || normalizedCapabilities.some((item) => item.includes("3dgeneration"))) {
    return "three_d_generation";
  }
  if (identity.includes("podcast")) return "audio_generation";
  if (identity.includes("voice-design") || identity.includes("voiceclone")) {
    return "text_to_speech";
  }
  if (identity.includes("embedding") || identity.includes("embed")) {
    return inputModalities.some((item) => item !== "text")
      ? "multimodal_embedding"
      : "embedding";
  }
  if (normalizedCapabilities.some((item) => item === "asr" || item.includes("speechrecognition"))) {
    return "speech_to_text";
  }
  if (normalizedCapabilities.some((item) => item === "tts" || item.includes("speechsynthesis"))) {
    return "text_to_speech";
  }
  if (
    normalizedCapabilities.some((item) =>
      ["realtime-omni", "realtime-chatting", "realtime-audio-translate"].includes(item),
    )
  ) {
    return "speech_to_speech";
  }
  if (normalizedCapabilities.some((item) => item.includes("videogeneration"))) {
    return "video_generation";
  }
  if (normalizedCapabilities.some((item) => item.includes("imagegeneration"))) {
    return "image_generation";
  }
  if (normalizedCapabilities.some((item) => item.includes("musicgeneration"))) {
    return "music_generation";
  }
  if (
    normalizedCapabilities.some((item) =>
      item.includes("simultaneousinterpretation") || item.includes("realtimespeech"),
    )
  ) {
    return "speech_to_speech";
  }
  if (outputModalities.includes("3d")) return "three_d_generation";
  if (outputModalities.includes("video")) return "video_generation";
  if (outputModalities.includes("image")) return "image_generation";
  if (outputModalities.includes("audio")) return "audio_generation";
  return "chat";
}

function isoDate(value: unknown) {
  const parsed = stringValue(value);
  return parsed ? parsed.slice(0, 10) : null;
}

function catalogContextTokens(value: string) {
  const match =
    value.match(/(\d+(?:\.\d+)?)\s*([km])(?:\s*tokens?)?\s*(?:长)?上下文/i) ??
    value.match(/上下文(?:窗口)?(?:至|为|支持)?\s*(\d+(?:\.\d+)?)\s*([km])/i) ??
    value.match(/(?:^|[-_])(\d+(?:\.\d+)?)([km])(?:$|[-_])/i);
  if (!match) return null;
  const multiplier = match[2].toLowerCase() === "m" ? 1_000_000 : 1_024;
  return Math.round(Number(match[1]) * multiplier);
}

type CatalogCanonicalWrite = {
  id: string;
  name: string;
  developer: string;
  developerCountry: string | null;
  modelType: string;
  family: string | null;
  description: string | null;
  releaseDate: string | null;
  lastUpdated: string | null;
  contextWindow: number | null;
  maxOutput: number | null;
  inputModalities: string;
  outputModalities: string;
  reasoning: number | null;
  toolCall: number | null;
  structuredOutput: number | null;
  openWeights: number | null;
  weights: string;
  specs: string;
  source: string;
  raw: string;
  now: string;
};

function catalogCanonicalStatement() {
  return getDatabase().prepare(`
    INSERT INTO canonical_models (
      id, name, developer, developer_country, model_type, family, description,
      release_date, knowledge_cutoff, last_updated, context_window, max_output,
      input_modalities, output_modalities, reasoning, tool_call, structured_output,
      attachment, open_weights, benchmarks_json, weights_json, specs_json,
      source, raw_json, active, created_at, updated_at
    ) VALUES (
      @id, @name, @developer, @developerCountry, @modelType, @family, @description,
      @releaseDate, NULL, @lastUpdated, @contextWindow, @maxOutput,
      @inputModalities, @outputModalities, @reasoning, @toolCall, @structuredOutput,
      NULL, @openWeights, '[]', @weights, @specs,
      @source, @raw, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark') THEN excluded.name
        ELSE canonical_models.name
      END,
      developer = excluded.developer,
      developer_country = COALESCE(excluded.developer_country, canonical_models.developer_country),
      model_type = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark')
          OR (canonical_models.model_type = 'chat' AND excluded.model_type <> 'chat')
          THEN excluded.model_type
        ELSE canonical_models.model_type
      END,
      family = COALESCE(canonical_models.family, excluded.family),
      description = COALESCE(canonical_models.description, excluded.description),
      release_date = COALESCE(canonical_models.release_date, excluded.release_date),
      last_updated = COALESCE(excluded.last_updated, canonical_models.last_updated),
      context_window = COALESCE(canonical_models.context_window, excluded.context_window),
      max_output = COALESCE(canonical_models.max_output, excluded.max_output),
      input_modalities = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark')
          OR canonical_models.input_modalities = '[]'
          OR (canonical_models.model_type = 'chat' AND excluded.model_type <> 'chat')
          THEN excluded.input_modalities
        ELSE canonical_models.input_modalities
      END,
      output_modalities = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark')
          OR canonical_models.output_modalities = '[]'
          OR (canonical_models.model_type = 'chat' AND excluded.model_type <> 'chat')
          THEN excluded.output_modalities
        ELSE canonical_models.output_modalities
      END,
      reasoning = CASE WHEN excluded.reasoning = 1 THEN 1 ELSE COALESCE(canonical_models.reasoning, excluded.reasoning) END,
      tool_call = CASE WHEN excluded.tool_call = 1 THEN 1 ELSE COALESCE(canonical_models.tool_call, excluded.tool_call) END,
      structured_output = CASE WHEN excluded.structured_output = 1 THEN 1 ELSE COALESCE(canonical_models.structured_output, excluded.structured_output) END,
      open_weights = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark')
          THEN excluded.open_weights
        WHEN excluded.open_weights = 1 THEN 1
        ELSE COALESCE(canonical_models.open_weights, excluded.open_weights)
      END,
      weights_json = CASE WHEN excluded.weights_json <> '[]' THEN excluded.weights_json ELSE canonical_models.weights_json END,
      specs_json = CASE WHEN excluded.specs_json <> '{}' THEN excluded.specs_json ELSE canonical_models.specs_json END,
      raw_json = CASE
        WHEN canonical_models.source IN ('qianwen-catalog', 'volcengine-ark') THEN excluded.raw_json
        ELSE canonical_models.raw_json
      END,
      active = 1,
      updated_at = excluded.updated_at
  `);
}

function catalogEntryStatement() {
  return getDatabase().prepare(`
    INSERT INTO model_catalog_entries (
      source, source_model_id, canonical_model_id, platform_provider, developer,
      name, source_url, raw_json, active, created_at, updated_at
    ) VALUES (
      @source, @sourceModelId, @canonicalModelId, @platformProvider, @developer,
      @name, @sourceUrl, @raw, 1, @now, @now
    )
    ON CONFLICT(source, source_model_id) DO UPDATE SET
      canonical_model_id = excluded.canonical_model_id,
      platform_provider = excluded.platform_provider,
      developer = excluded.developer,
      name = excluded.name,
      source_url = excluded.source_url,
      raw_json = excluded.raw_json,
      active = 1,
      updated_at = excluded.updated_at
  `);
}

function upsertQianwenCatalog(payload: unknown, now: string) {
  const database = getDatabase();
  database.prepare("UPDATE canonical_models SET active = 0 WHERE source = 'qianwen-catalog'").run();
  database.prepare("UPDATE model_catalog_entries SET active = 0 WHERE source = 'qianwen-catalog'").run();
  const writeModel = catalogCanonicalStatement();
  const writeEntry = catalogEntryStatement();
  const data = object(object(payload).data);
  const groups = Array.isArray(data.Data) ? data.Data : [];
  let count = 0;

  for (const rawGroup of groups) {
    const group = object(rawGroup);
    const groupName = stringValue(group.Name) ?? "千问模型市场";
    const items = Array.isArray(group.Items) ? group.Items : [];
    for (const rawItem of items) {
      const item = object(rawItem);
      const sourceModelId = stringValue(item.Model) ?? stringValue(item.Name);
      if (!sourceModelId) continue;
      const rawProvider = stringValue(item.Provider) ?? "unknown";
      const developer = QIANWEN_DEVELOPER_MAP[rawProvider] ?? catalogSlug(rawProvider) ?? "unknown";
      const slug = catalogSlug(sourceModelId);
      if (!slug) continue;
      const canonicalModelId = catalogCanonicalId(developer, sourceModelId);
      const name = stringValue(item.Name) ?? sourceModelId;
      const description = stringValue(item.Description) ?? stringValue(item.ShortDescription);
      const metadata = object(item.InferenceMetadata);
      const inputModalities = normalizedModalities(metadata.RequestModality);
      const outputModalities = normalizedModalities(metadata.ResponseModality);
      const capabilities = stringArray(item.Capabilities);
      const features = stringArray(item.Features);
      const modelInfo = object(item.ModelInfo);
      const positiveOpenSignal =
        item.OpenSource === true ||
        groupName.includes("开源") ||
        /开源(?:模型|大模型|权重)|开放模型权重/.test(description ?? "");
      const sourceUrl = `https://www.qianwenai.com/models/${encodeURIComponent(sourceModelId)}`;
      const raw = JSON.stringify({ group_name: groupName, item });

      writeModel.run({
        id: canonicalModelId,
        name,
        developer,
        developerCountry: "CN",
        modelType: inferCatalogModelType(
          sourceModelId,
          name,
          capabilities,
          inputModalities,
          outputModalities,
        ),
        family: groupName,
        description,
        releaseDate: isoDate(item.LatestOnlineAt),
        lastUpdated: isoDate(item.UpdateAt),
        contextWindow: numberValue(item.ContextWindow) ?? numberValue(modelInfo.ContextWindow),
        maxOutput: numberValue(item.MaxOutputTokens) ?? numberValue(modelInfo.MaxOutputTokens),
        inputModalities: JSON.stringify(inputModalities),
        outputModalities: JSON.stringify(outputModalities),
        reasoning: Number(capabilities.includes("Reasoning")),
        toolCall: Number(features.includes("function-calling")),
        structuredOutput: Number(features.includes("structured-outputs")),
        openWeights: positiveOpenSignal ? 1 : item.OpenSource === false ? 0 : null,
        weights: "[]",
        specs: "{}",
        source: "qianwen-catalog",
        raw,
        now,
      } satisfies CatalogCanonicalWrite);
      writeEntry.run({
        source: "qianwen-catalog",
        sourceModelId,
        canonicalModelId,
        platformProvider: stringValue(item.InferenceProvider) ?? "qianwen-platform",
        developer,
        name,
        sourceUrl,
        raw,
        now,
      });
      count += 1;
    }
  }
  return count;
}

function upsertVolcengineArkCatalog(payload: unknown, now: string) {
  const database = getDatabase();
  database.prepare("UPDATE canonical_models SET active = 0 WHERE source = 'volcengine-ark'").run();
  database.prepare("UPDATE model_catalog_entries SET active = 0 WHERE source = 'volcengine-ark'").run();
  const writeModel = catalogCanonicalStatement();
  const writeEntry = catalogEntryStatement();
  const result = object(object(payload).Result);
  const cards = Array.isArray(result.cards) ? result.cards : [];
  let count = 0;

  for (const rawCard of cards) {
    const card = object(rawCard);
    const model = object(card.model);
    const version = object(card.version);
    const vendor = object(model.vendor);
    const vendorCode = stringValue(vendor.code) ?? "unknown";
    const developer = ARK_DEVELOPER_MAP[vendorCode] ?? catalogSlug(vendorCode) ?? "unknown";
    const modelName = stringValue(model.modelName);
    if (!modelName) continue;
    const sourceModelId = stringValue(version.modelId) ?? modelName;
    const canonicalModelId = canonicalProductId(developer, modelName);
    const name = stringValue(model.displayName) ?? modelName;
    const modalities = object(version.modalities);
    const inputModalities = Array.isArray(modalities.input)
      ? normalizedModalities(modalities.input.map((value) => stringValue(object(value).key)).filter(Boolean))
      : [];
    const outputModalities = Array.isArray(modalities.output)
      ? normalizedModalities(modalities.output.map((value) => stringValue(object(value).key)).filter(Boolean))
      : [];
    const categories = stringArray(object(card.filterValues).category);
    const contextValues = object(card.filterValues).context;
    const contextWindow = Array.isArray(contextValues)
      ? contextValues.reduce<number | null>((maximum, value) => {
          const parsed = numberValue(value);
          if (parsed === null) return maximum;
          return maximum === null ? parsed : Math.max(maximum, parsed);
        }, null)
      : numberValue(contextValues);
    const taskTypes = [
      ...stringArray(version.taskTypes),
      ...stringArray(model.filterTaskTypes),
      ...stringArray(model.filterDomains),
    ];
    const description = stringValue(model.displayDescription);
    const sourceUrl = `${SOURCE_ENDPOINTS.volcengine_ark.url.split("?")[0]}/detail?name=${encodeURIComponent(modelName)}`;
    const raw = JSON.stringify(card);

    writeModel.run({
      id: canonicalModelId,
      name,
      developer,
      developerCountry: "CN",
      modelType: inferCatalogModelType(
        modelName,
        name,
        [...taskTypes, stringValue(version.domain) ?? "", ...categories],
        inputModalities,
        outputModalities,
      ),
      family: stringValue(version.domain) ?? categories[0] ?? null,
      description,
      releaseDate: isoDate(object(card.sortValues).CreateTime),
      lastUpdated: isoDate(object(card.sortValues).UpdateTime),
      contextWindow:
        contextWindow ??
        catalogContextTokens(description ?? "") ??
        catalogContextTokens(name),
      maxOutput: null,
      inputModalities: JSON.stringify(inputModalities),
      outputModalities: JSON.stringify(outputModalities),
      reasoning: categories.some((value) => value.includes("Thinking")) ? 1 : null,
      toolCall: null,
      structuredOutput: null,
      openWeights: Number(vendorCode === "DeepSeek" || vendorCode === "智谱AI"),
      weights: "[]",
      specs: "{}",
      source: "volcengine-ark",
      raw,
      now,
    } satisfies CatalogCanonicalWrite);
    writeEntry.run({
      source: "volcengine-ark",
      sourceModelId,
      canonicalModelId,
      platformProvider: "volcengine-ark",
      developer,
      name,
      sourceUrl,
      raw,
      now,
    });
    count += 1;
  }
  return count;
}

function upsertCuratedRecentModels(now: string) {
  const database = getDatabase();
  database.prepare("UPDATE canonical_models SET active = 0 WHERE source = 'curated-official'").run();
  const writeModel = catalogCanonicalStatement();
  const makeOfficial = database.prepare(`
    UPDATE canonical_models SET
      name = @name,
      developer = @developer,
      developer_country = @developerCountry,
      model_type = @modelType,
      family = @family,
      description = @description,
      release_date = @releaseDate,
      context_window = @contextWindow,
      max_output = @maxOutput,
      input_modalities = @inputModalities,
      output_modalities = @outputModalities,
      reasoning = @reasoning,
      tool_call = @toolCall,
      structured_output = @structuredOutput,
      open_weights = @openWeights,
      weights_json = @weights,
      specs_json = @specs,
      source = 'curated-official',
      raw_json = @raw,
      active = 1,
      updated_at = @now
    WHERE id = @id
  `);

  for (const model of curatedRecentModels.models) {
    const values: CatalogCanonicalWrite = {
      id: model.id,
      name: model.name,
      developer: model.developer,
      developerCountry: model.developer_country,
      modelType: model.model_type,
      family: model.family,
      description: model.description,
      releaseDate: model.release_date,
      lastUpdated: curatedRecentModels.verified_at,
      contextWindow: model.context_window,
      maxOutput: model.max_output,
      inputModalities: JSON.stringify(model.input_modalities),
      outputModalities: JSON.stringify(model.output_modalities),
      reasoning: model.reasoning === null ? null : Number(model.reasoning),
      toolCall: Number(model.tool_call),
      structuredOutput: model.structured_output === null ? null : Number(model.structured_output),
      openWeights: Number(model.open_weights),
      weights: JSON.stringify([model.weights_url]),
      specs: JSON.stringify(model.specs),
      source: "curated-official",
      raw: JSON.stringify(model),
      now,
    };
    writeModel.run(values);
    makeOfficial.run(values);
  }
  return curatedRecentModels.models.length;
}

function upsertCuratedRetrievalModels(now: string) {
  const database = getDatabase();
  database.prepare("UPDATE canonical_models SET active = 0 WHERE source = 'curated-retrieval'").run();
  const writeModel = catalogCanonicalStatement();
  const makeOfficial = database.prepare(`
    UPDATE canonical_models SET
      name = @name,
      developer = @developer,
      developer_country = @developerCountry,
      model_type = @modelType,
      family = @family,
      description = @description,
      release_date = @releaseDate,
      context_window = @contextWindow,
      max_output = @maxOutput,
      input_modalities = @inputModalities,
      output_modalities = @outputModalities,
      reasoning = @reasoning,
      tool_call = @toolCall,
      structured_output = @structuredOutput,
      open_weights = @openWeights,
      weights_json = @weights,
      specs_json = @specs,
      source = 'curated-retrieval',
      raw_json = @raw,
      active = 1,
      updated_at = @now
    WHERE id = @id
  `);

  for (const model of curatedRetrievalModels.models) {
    const weights = model.weights_url ? [model.weights_url] : [];
    const values: CatalogCanonicalWrite = {
      id: model.id,
      name: model.name,
      developer: model.developer,
      developerCountry: model.developer_country,
      modelType: model.model_type,
      family: model.family,
      description: model.description,
      releaseDate: model.release_date,
      lastUpdated: curatedRetrievalModels.verified_at,
      contextWindow: model.context_window,
      maxOutput: model.max_output,
      inputModalities: JSON.stringify(model.input_modalities),
      outputModalities: JSON.stringify(model.output_modalities),
      reasoning: Number(model.reasoning),
      toolCall: Number(model.tool_call),
      structuredOutput: Number(model.structured_output),
      openWeights: Number(model.open_weights),
      weights: JSON.stringify(weights),
      specs: JSON.stringify(model.specs),
      source: "curated-retrieval",
      raw: JSON.stringify(model),
      now,
    };
    writeModel.run(values);
    makeOfficial.run(values);
  }
  return curatedRetrievalModels.models.length;
}

function applyCuratedOpennessEvidence(now: string) {
  const write = getDatabase().prepare(`
    UPDATE canonical_models SET
      open_weights = CASE
        WHEN @status = 'announced_pending' AND open_weights = 1 THEN 1
        ELSE @openWeights
      END,
      updated_at = @now
    WHERE id = @canonicalId AND active = 1
  `);
  let count = 0;
  for (const record of opennessEvidence.records) {
    const result = write.run({
      canonicalId: record.canonical_id,
      status: record.status,
      openWeights:
        record.open_weights === null ? null : Number(record.open_weights),
      now,
    });
    count += result.changes;
  }
  return count;
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
  priceDisplay: string | null;
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
      is_official_api, market, price_note, price_display, verified_at, pricing_tiers_json,
      reasoning, tool_call, structured_output,
      open_weights, release_date, deprecation_date, status, match_status,
      match_confidence, source_url, raw_json, active, created_at, updated_at
    ) VALUES (
      @uid, @source, @sourceModelId, @canonicalModelId, @providerId, @providerName,
      @name, @developer, @family, @description, @mode, @inputModalities, @outputModalities,
      @contextWindow, @maxInput, @maxOutput, @inputPrice, @outputPrice,
      @cacheReadPrice, @cacheWritePrice, @currency, @priceUnit, @priceStatus,
      @isOfficialApi, @market, @priceNote, @priceDisplay, @verifiedAt, @pricingTiers,
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
      price_display = excluded.price_display,
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

function deactivateOfferings(source: string, now: string) {
  getDatabase()
    .prepare(`
      UPDATE offerings
      SET
        active = 0,
        status = 'retired',
        deprecation_date = COALESCE(deprecation_date, @date),
        updated_at = @now
      WHERE source = @source
    `)
    .run({ source, date: now.slice(0, 10), now });
}

type QianwenPriceRow = {
  type: string;
  name: string;
  unit: string;
  price: number | null;
};

function qianwenPriceRows(value: unknown): QianwenPriceRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((row) => ({
    type: stringValue(row.Type) ?? "unknown",
    name: stringValue(row.PriceName) ?? stringValue(row.Type) ?? "价格",
    unit: stringValue(row.PriceUnit) ?? "",
    price: numberValue(row.Price),
  }));
}

function qianwenPriceUnit(rows: QianwenPriceRow[]) {
  const units = rows.map((row) => row.unit.toLowerCase()).join(" ");
  if (/百万\s*tokens?|每百万token/i.test(units)) return "per_million_tokens";
  if (units.includes("万字符")) return "per_ten_thousand_characters";
  if (units.includes("每秒")) return "per_second";
  if (units.includes("每张")) return "per_image";
  if (units.includes("每次") || units.includes("次调用")) return "per_request";
  if (units.includes("音色")) return "per_voice";
  return rows.length ? "flexible" : null;
}

function qianwenPriceDisplay(rows: QianwenPriceRow[], unit: string | null) {
  if (!rows.length || unit === "per_million_tokens") return null;
  const priced = rows.filter((row) => row.price !== null && row.price > 0);
  if (!priced.length) return null;
  const uniqueUnits = new Set(priced.map((row) => row.unit));
  if (uniqueUnits.size === 1) {
    const values = priced.map((row) => row.price as number);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = minimum === maximum ? String(minimum) : `${minimum}–${maximum}`;
    return `¥${range} / ${priced[0].unit.replace(/^每/, "")}`;
  }
  return priced
    .slice(0, 3)
    .map((row) => `${row.name} ¥${row.price}/${row.unit.replace(/^每/, "")}`)
    .join("；");
}

function qianwenTokenPrice(rows: QianwenPriceRow[], types: string[]) {
  return rows.find((row) => types.includes(row.type))?.price ?? null;
}

function upsertQianwenPricingOfferings(payload: unknown, now: string) {
  deactivateOfferings("qianwen-pricing", now);
  const write = offeringStatement();
  const data = object(object(payload).data);
  const groups = Array.isArray(data.Data) ? data.Data : [];
  let count = 0;

  for (const rawGroup of groups) {
    const group = object(rawGroup);
    const groupName = stringValue(group.Name) ?? "千问模型市场";
    const items = Array.isArray(group.Items) ? group.Items : [];
    for (const rawItem of items) {
      const item = object(rawItem);
      const supports = object(item.Supports);
      const permissions = object(item.Permissions);
      if (supports.Inference !== true && permissions.Inference !== true) continue;
      const sourceModelId = stringValue(item.Model) ?? stringValue(item.Name);
      if (!sourceModelId) continue;
      const rawProvider = stringValue(item.Provider) ?? "unknown";
      const developer = QIANWEN_DEVELOPER_MAP[rawProvider] ?? catalogSlug(rawProvider) ?? "unknown";
      const canonicalModelId = catalogCanonicalId(developer, sourceModelId);
      const name = stringValue(item.Name) ?? sourceModelId;
      const description = stringValue(item.Description) ?? stringValue(item.ShortDescription);
      const metadata = object(item.InferenceMetadata);
      const inputModalities = normalizedModalities(metadata.RequestModality);
      const outputModalities = normalizedModalities(metadata.ResponseModality);
      const capabilities = stringArray(item.Capabilities);
      const features = stringArray(item.Features);
      const modelInfo = object(item.ModelInfo);
      const prices = qianwenPriceRows(item.Prices);
      const priceUnit = qianwenPriceUnit(prices);
      const positivePrices = prices.filter((row) => row.price !== null && row.price > 0);
      const priceStatus = positivePrices.length
        ? "priced"
        : item.FreeTierOnly === true && prices.length
          ? "free"
          : "unknown";
      const sourceUrl = `https://www.qianwenai.com/models/${encodeURIComponent(sourceModelId)}`;
      const positiveOpenSignal =
        item.OpenSource === true ||
        groupName.includes("开源") ||
        /开源(?:模型|大模型|权重)|开放模型权重/.test(description ?? "");

      write.run({
        uid: stableUid("qianwen-pricing", "qianwen-platform", sourceModelId),
        source: "qianwen-pricing",
        sourceModelId,
        canonicalModelId,
        providerId: "qianwen-platform",
        providerName: "阿里云百炼 / 千问模型市场",
        name,
        developer,
        family: groupName,
        description,
        mode: inferCatalogModelType(
          sourceModelId,
          name,
          capabilities,
          inputModalities,
          outputModalities,
        ),
        inputModalities: JSON.stringify(inputModalities),
        outputModalities: JSON.stringify(outputModalities),
        contextWindow: numberValue(item.ContextWindow) ?? numberValue(modelInfo.ContextWindow),
        maxInput: numberValue(item.MaxInputTokens) ?? numberValue(modelInfo.MaxInputTokens),
        maxOutput: numberValue(item.MaxOutputTokens) ?? numberValue(modelInfo.MaxOutputTokens),
        inputPrice: qianwenTokenPrice(prices, ["input_token"]),
        outputPrice: qianwenTokenPrice(prices, ["output_token"]),
        cacheReadPrice: qianwenTokenPrice(prices, [
          "input_token_cache",
          "input_token_cache_read",
        ]),
        cacheWritePrice: qianwenTokenPrice(prices, [
          "input_token_cache_creation_5m",
          "input_token_cache_creation_1h",
        ]),
        currency: "CNY",
        priceUnit,
        priceStatus,
        isOfficialApi: 1,
        market: "CN",
        priceNote:
          "阿里云百炼 / 千问模型市场人民币 API 渠道价；第三方模型不等同于开发商直连价。",
        priceDisplay: qianwenPriceDisplay(prices, priceUnit),
        verifiedAt: now.slice(0, 10),
        pricingTiers: JSON.stringify(
          prices.map((row) => ({
            type: row.type,
            name: row.name,
            unit: row.unit,
            price: row.price,
            currency: "CNY",
          })),
        ),
        reasoning: Number(capabilities.includes("Reasoning")),
        toolCall: Number(features.includes("function-calling")),
        structuredOutput: Number(features.includes("structured-outputs")),
        openWeights: positiveOpenSignal ? 1 : item.OpenSource === false ? 0 : null,
        releaseDate: isoDate(item.LatestOnlineAt),
        deprecationDate: null,
        status: "active",
        matchStatus: "exact",
        matchConfidence: 1,
        sourceUrl,
        raw: JSON.stringify({ group_name: groupName, item }),
        now,
      } satisfies OfferingWrite);
      count += 1;
    }
  }

  return count;
}

function upsertOfficialMediaPriceOfferings(
  records: OfficialMediaPriceRecord[],
  now: string,
) {
  const database = getDatabase();
  deactivateOfferings("official-us-media-live", now);
  const write = offeringStatement();
  const seedStatement = database.prepare(`
    SELECT model_type, family, description, input_modalities, output_modalities,
      context_window, max_output, reasoning, tool_call, structured_output,
      open_weights, release_date
    FROM canonical_models
    WHERE id = ? AND active = 1
  `);

  for (const record of records) {
    const seed = seedStatement.get(record.canonicalId) as
      | {
          model_type: string;
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
        }
      | undefined;
    const developer = record.canonicalId.split("/")[0] ?? record.providerId;
    write.run({
      uid: stableUid("official-us-media-live", record.providerId, record.modelId),
      source: "official-us-media-live",
      sourceModelId: record.modelId,
      canonicalModelId: record.canonicalId,
      providerId: record.providerId,
      providerName: record.providerName,
      name: record.name,
      developer,
      family: seed?.family ?? null,
      description: seed?.description ?? record.note,
      mode: seed?.model_type ?? "unknown",
      inputModalities: seed?.input_modalities ?? "[]",
      outputModalities: seed?.output_modalities ?? "[]",
      contextWindow: seed?.context_window ?? null,
      maxInput: null,
      maxOutput: seed?.max_output ?? null,
      inputPrice: record.inputPrice,
      outputPrice: record.outputPrice,
      cacheReadPrice: null,
      cacheWritePrice: null,
      currency: "USD",
      priceUnit: record.unit,
      priceStatus: record.priceStatus,
      isOfficialApi: 1,
      market: "US",
      priceNote: record.note,
      priceDisplay: record.priceDisplay,
      verifiedAt: now.slice(0, 10),
      pricingTiers: JSON.stringify(record.tiers),
      reasoning: seed?.reasoning ?? null,
      toolCall: seed?.tool_call ?? null,
      structuredOutput: seed?.structured_output ?? null,
      openWeights: seed?.open_weights ?? null,
      releaseDate: seed?.release_date ?? null,
      deprecationDate: null,
      status: "active",
      matchStatus: seed ? "exact" : "unmatched",
      matchConfidence: seed ? 1 : 0,
      sourceUrl: record.sourceUrl,
      raw: JSON.stringify(record),
      now,
    } satisfies OfferingWrite);
  }

  return records.length;
}

function upsertVolcenginePricingOfferings(
  records: VolcenginePricingRecord[],
  now: string,
) {
  const database = getDatabase();
  deactivateOfferings("volcengine-pricing", now);
  const write = offeringStatement();
  const seedStatement = database.prepare(`
    SELECT model_type, family, description, input_modalities, output_modalities,
      context_window, max_output, reasoning, tool_call, structured_output,
      open_weights, release_date
    FROM canonical_models
    WHERE id = ? AND active = 1
  `);
  const updateCanonical = database.prepare(`
    UPDATE canonical_models SET
      context_window = COALESCE(@contextWindow, context_window),
      max_output = COALESCE(@maxOutput, max_output),
      input_modalities = CASE WHEN @inputModalities <> '[]' THEN @inputModalities ELSE input_modalities END,
      output_modalities = CASE WHEN @outputModalities <> '[]' THEN @outputModalities ELSE output_modalities END,
      updated_at = @now
    WHERE id = @canonicalModelId AND active = 1
  `);
  let count = 0;

  for (const record of records) {
    const developer =
      ARK_DEVELOPER_MAP[record.developerCode] ??
      ARK_DEVELOPER_MAP[record.developerName] ??
      catalogSlug(record.developerCode) ??
      "unknown";
    const canonicalModelId = canonicalProductId(developer, record.modelName);
    const seed = seedStatement.get(canonicalModelId) as CanonicalOfferingSeed | undefined;
    if (!seed) continue;
    const inputModalities = record.inputModalities.length
      ? JSON.stringify(record.inputModalities)
      : seed.input_modalities;
    const outputModalities = record.outputModalities.length
      ? JSON.stringify(record.outputModalities)
      : seed.output_modalities;
    updateCanonical.run({
      canonicalModelId,
      contextWindow: record.contextWindow,
      maxOutput: record.maxOutput,
      inputModalities,
      outputModalities,
      now,
    });
    const retirementNote = record.deprecationDate
      ? `；该渠道状态为${record.serviceStatus}，日期 ${record.deprecationDate}`
      : "";
    write.run({
      uid: stableUid("volcengine-pricing", "volcengine-ark", record.modelId),
      source: "volcengine-pricing",
      sourceModelId: record.modelId,
      canonicalModelId,
      providerId: "volcengine-ark",
      providerName: "火山方舟",
      name: record.name,
      developer,
      family: seed.family,
      description: seed.description,
      mode: seed.model_type,
      inputModalities,
      outputModalities,
      contextWindow: record.contextWindow ?? seed.context_window,
      maxInput: record.maxInput,
      maxOutput: record.maxOutput ?? seed.max_output,
      inputPrice: record.inputPrice,
      outputPrice: record.outputPrice,
      cacheReadPrice: record.cacheReadPrice,
      cacheWritePrice: record.cacheWritePrice,
      currency: record.currency,
      priceUnit: record.priceUnit,
      priceStatus: record.priceStatus,
      isOfficialApi: 1,
      market: "CN",
      priceNote: `火山方舟平台人民币 API 价格；开发者字段保留实际模型厂商${retirementNote}。`,
      priceDisplay: record.priceDisplay,
      verifiedAt: now.slice(0, 10),
      pricingTiers: JSON.stringify(record.tiers),
      reasoning: seed.reasoning,
      toolCall: seed.tool_call,
      structuredOutput: seed.structured_output,
      openWeights: seed.open_weights,
      releaseDate: seed.release_date,
      deprecationDate: record.deprecationDate,
      status: record.serviceStatus,
      matchStatus: "exact",
      matchConfidence: 1,
      sourceUrl: record.sourceUrl,
      raw: JSON.stringify(record.raw),
      now,
    } satisfies OfferingWrite);
    count += 1;
  }
  return count;
}

function upsertModelsDevOfferings(payload: unknown, now: string) {
  const providers = object(payload);
  deactivateOfferings("models.dev", now);
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
      if (!isOfficialApi) continue;

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
        priceNote: "美国厂商官方 API 直连价",
        priceDisplay: null,
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

function upsertOpenRouterOfferings(payload: unknown, now: string) {
  const records = Array.isArray(object(payload).data) ? object(payload).data : [];
  deactivateOfferings("openrouter", now);
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
      priceDisplay: null,
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

type AliyunPricingModel = (typeof aliyunPricingData.models)[number];
type AliyunModelSpec = {
  context_window?: number;
  [key: string]: unknown;
};
const ALIYUN_MODEL_SPECS = aliyunModelSpecs.models as Record<string, AliyunModelSpec>;

function aliyunContextWindow(model: AliyunPricingModel) {
  const documented = ALIYUN_MODEL_SPECS[model.model_id]?.context_window;
  if (documented) return documented;
  let maximum: number | null = null;
  for (const row of model.pricing_rows) {
    for (const cell of row.cells) {
      for (const match of cell.matchAll(/≤\s*(\d+(?:\.\d+)?)\s*(K|M)/gi)) {
        const amount = Number(match[1]);
        const multiplier = match[2].toUpperCase() === "M" ? 1_000_000 : 1_000;
        const value = amount * multiplier;
        maximum = maximum === null ? value : Math.max(maximum, value);
      }
    }
  }
  return maximum;
}

function aliyunPriceUnit(model: AliyunPricingModel) {
  const text = model.pricing_rows
    .flatMap((row) => [...row.headers, ...row.cells])
    .join(" ");
  if (text.includes("元/秒") || text.includes("每秒")) return "per_second";
  if (text.includes("元/张")) return "per_image";
  if (text.includes("元/次")) return "per_request";
  if (text.includes("每个音色")) return "per_voice";
  if (text.includes("每万字符")) return "per_ten_thousand_characters";
  if (text.includes("每百万Token")) return "per_million_tokens";
  return model.pricing_rows.length ? "flexible" : null;
}

function aliyunNumericPrices(model: AliyunPricingModel) {
  const firstPricedRow = model.pricing_rows.find((row) =>
    row.cells.some((cell) => cell.includes("元")),
  );
  if (!firstPricedRow) return [];
  return firstPricedRow.cells
    .filter((cell) => cell.includes("元"))
    .flatMap((cell) => {
      const match = cell.match(/(\d+(?:\.\d+)?)\s*元/);
      return match ? [Number(match[1])] : [];
    });
}

function aliyunPriceDisplay(model: AliyunPricingModel, unit: string | null) {
  const prices = aliyunNumericPrices(model);
  if (!prices.length) return null;
  const suffix: Record<string, string> = {
    per_million_tokens: "/百万 Token",
    per_ten_thousand_characters: "/万字符",
    per_second: "/秒",
    per_image: "/张",
    per_request: "/次",
    per_voice: "/个音色",
  };
  const range = prices.length > 1 ? `${prices[0]}–${prices.at(-1)}` : String(prices[0]);
  return `¥${range}${unit ? (suffix[unit] ?? "") : ""}`;
}

function aliyunTierSummary(model: AliyunPricingModel) {
  return model.pricing_rows.slice(0, 8).map((row) => ({
    headers: row.headers,
    values: row.cells,
  }));
}

function qianwenCatalogDevelopers() {
  const rows = getDatabase()
    .prepare(`
      SELECT source_model_id, developer
      FROM model_catalog_entries
      WHERE source = 'qianwen-catalog' AND active = 1
    `)
    .all() as Array<{ source_model_id: string; developer: string }>;
  return new Map(rows.map((row) => [row.source_model_id.toLowerCase(), row.developer]));
}

function aliyunModelDeveloper(
  model: AliyunPricingModel,
  catalogDevelopers: Map<string, string>,
) {
  const catalogDeveloper = catalogDevelopers.get(model.model_id.toLowerCase());
  if (catalogDeveloper) return catalogDeveloper;
  const identity = `${model.model_id} ${model.group}`.toLowerCase();
  if (identity.includes("minimax")) return "minimax";
  if (identity.includes("happyhorse")) return "happyhorse";
  return "alibaba";
}

function upsertAliyunCanonicalModels(now: string) {
  const database = getDatabase();
  const catalogDevelopers = qianwenCatalogDevelopers();
  database.prepare("UPDATE canonical_models SET active = 0 WHERE source = 'official-cn'").run();
  const write = database.prepare(`
    INSERT INTO canonical_models (
      id, name, developer, developer_country, model_type, family, description,
      release_date, knowledge_cutoff, last_updated, context_window, max_output,
      input_modalities, output_modalities, reasoning, tool_call, structured_output,
      attachment, open_weights, benchmarks_json, weights_json, source, raw_json,
      specs_json, active, created_at, updated_at
    ) VALUES (
      @id, @name, @developer, 'CN', @modelType, @family, @description,
      NULL, NULL, @verifiedAt, @contextWindow, NULL,
      @inputModalities, @outputModalities, NULL, NULL, NULL,
      NULL, @openWeights, '[]', '[]', 'official-cn', @raw,
      @specs, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      developer_country = 'CN',
      model_type = CASE
        WHEN canonical_models.model_type = 'chat' AND excluded.model_type <> 'chat'
          THEN excluded.model_type
        ELSE canonical_models.model_type
      END,
      family = COALESCE(canonical_models.family, excluded.family),
      description = COALESCE(canonical_models.description, excluded.description),
      context_window = COALESCE(canonical_models.context_window, excluded.context_window),
      input_modalities = CASE
        WHEN excluded.input_modalities <> '[]' THEN excluded.input_modalities
        ELSE canonical_models.input_modalities
      END,
      output_modalities = CASE
        WHEN canonical_models.source = 'official-cn' THEN excluded.output_modalities
        ELSE canonical_models.output_modalities
      END,
      raw_json = CASE
        WHEN canonical_models.source = 'official-cn' THEN excluded.raw_json
        ELSE canonical_models.raw_json
      END,
      specs_json = CASE
        WHEN excluded.specs_json <> '{}' THEN excluded.specs_json
        ELSE canonical_models.specs_json
      END,
      open_weights = CASE
        WHEN canonical_models.source = 'official-cn' THEN excluded.open_weights
        WHEN excluded.open_weights = 1 THEN 1
        ELSE canonical_models.open_weights
      END,
      active = 1,
      updated_at = excluded.updated_at
  `);

  for (const model of aliyunPricingData.models) {
    const profile = aliyunModelProfile(model.section, model.group, model.model_id);
    const developer = aliyunModelDeveloper(model, catalogDevelopers);
    write.run({
      id: canonicalProductId(developer, model.model_id),
      name: model.model_id,
      developer,
      modelType: profile.modelType,
      family: model.group,
      description: `${model.group}；阿里云百炼中国大陆官方模型。`,
      verifiedAt: aliyunPricingData.verified_at,
      contextWindow: aliyunContextWindow(model),
      inputModalities: JSON.stringify(profile.input),
      outputModalities: JSON.stringify(profile.output),
      openWeights: model.section === "文本生成-千问-开源版" ? 1 : null,
      specs: JSON.stringify(ALIYUN_MODEL_SPECS[model.model_id] ?? {}),
      raw: JSON.stringify(model),
      now,
    });
  }
}

function upsertAliyunOfferings(write: ReturnType<typeof offeringStatement>, now: string) {
  const catalogDevelopers = qianwenCatalogDevelopers();
  for (const model of aliyunPricingData.models) {
    const profile = aliyunModelProfile(model.section, model.group, model.model_id);
    const developer = aliyunModelDeveloper(model, catalogDevelopers);
    const canonicalModelId = canonicalProductId(developer, model.model_id);
    const unit = aliyunPriceUnit(model);
    const prices = aliyunNumericPrices(model);
    const tokenBased = unit === "per_million_tokens";
    const inputOnly = ["embedding", "multimodal_embedding", "rerank"].includes(
      profile.modelType,
    );
    const inputPrice = tokenBased ? (prices[0] ?? null) : null;
    const outputPrice = tokenBased
      ? inputOnly
        ? null
        : prices.length > 1
          ? (prices.at(-1) ?? null)
          : null
      : (prices[0] ?? null);
    const priceStatus = prices.length ? "priced" : "unknown";
    const tiers = aliyunTierSummary(model);
    const contextWindow = aliyunContextWindow(model);

    write.run({
      uid: stableUid("official-cn", "alibaba", model.model_id),
      source: "official-cn",
      sourceModelId: model.model_id,
      canonicalModelId,
      providerId: "alibaba",
      providerName: "阿里云 / 百炼",
      name: model.model_id,
      developer,
      family: model.group,
      description: `${model.group}；阿里云百炼中国大陆官方模型。`,
      mode: profile.modelType,
      inputModalities: JSON.stringify(profile.input),
      outputModalities: JSON.stringify(profile.output),
      contextWindow,
      maxInput: contextWindow,
      maxOutput: null,
      inputPrice,
      outputPrice,
      cacheReadPrice: null,
      cacheWritePrice: null,
      currency: "CNY",
      priceUnit: unit,
      priceStatus,
      isOfficialApi: Number(developer === "alibaba"),
      market: "CN",
      priceNote:
        developer === "alibaba"
          ? `${aliyunPricingData.scope} 计费明细按官网原始单位保存。`
          : `阿里云百炼提供的第三方模型平台价；模型开发商为 ${developer}，不作为厂商官方直连价。`,
      priceDisplay: aliyunPriceDisplay(model, unit),
      verifiedAt: aliyunPricingData.verified_at,
      pricingTiers: JSON.stringify(tiers),
      reasoning: null,
      toolCall: null,
      structuredOutput: null,
      openWeights: model.section === "文本生成-千问-开源版" ? 1 : null,
      releaseDate: null,
      deprecationDate: null,
      status: "active",
      matchStatus: "exact",
      matchConfidence: 1,
      sourceUrl: aliyunPricingData.source_url,
      raw: JSON.stringify(model),
      now,
    } satisfies OfferingWrite);
  }
}

type CanonicalOfferingSeed = {
  model_type: string;
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

function mergeOfficialPrices(liveResults: LiveOfficialPriceResult[]) {
  const localPrices = chinaOfficialData.prices as unknown as OfficialPriceRecord[];
  const merged = new Map(
    localPrices.map((price) => [`${price.provider_id}/${price.model_id}`, price]),
  );
  for (const price of liveResults.flatMap((result) => result.prices)) {
    merged.set(`${price.provider_id}/${price.model_id}`, price);
  }
  return [...merged.values()];
}

function ensureOfficialPriceCanonicalModels(
  prices: OfficialPriceRecord[],
  now: string,
) {
  const write = getDatabase().prepare(`
    INSERT INTO canonical_models (
      id, name, developer, developer_country, model_type, family, description,
      release_date, knowledge_cutoff, last_updated, context_window, max_output,
      input_modalities, output_modalities, reasoning, tool_call, structured_output,
      attachment, open_weights, benchmarks_json, weights_json, specs_json,
      source, raw_json, active, created_at, updated_at
    ) VALUES (
      @id, @name, @developer, 'CN', @modelType, @family, @description,
      NULL, NULL, @verifiedAt, @contextWindow, NULL,
      @inputModalities, @outputModalities, NULL, NULL, NULL,
      NULL, NULL, '[]', '[]', '{}',
      'official-cn', @raw, 1, @now, @now
    )
    ON CONFLICT(id) DO UPDATE SET
      name = CASE
        WHEN excluded.name = json_extract(excluded.raw_json, '$.model_id')
          AND canonical_models.name <> excluded.name
          THEN canonical_models.name
        ELSE excluded.name
      END,
      developer_country = 'CN',
      model_type = CASE
        WHEN canonical_models.source = 'official-cn' THEN excluded.model_type
        WHEN canonical_models.model_type = 'chat' AND excluded.model_type <> 'chat'
          THEN excluded.model_type
        ELSE canonical_models.model_type
      END,
      description = excluded.description,
      last_updated = excluded.last_updated,
      context_window = COALESCE(excluded.context_window, canonical_models.context_window),
      input_modalities = CASE
        WHEN excluded.input_modalities <> '[]' THEN excluded.input_modalities
        ELSE canonical_models.input_modalities
      END,
      output_modalities = CASE
        WHEN excluded.output_modalities <> '[]' THEN excluded.output_modalities
        ELSE canonical_models.output_modalities
      END,
      source = 'official-cn',
      raw_json = excluded.raw_json,
      active = 1,
      updated_at = excluded.updated_at
  `);

  for (const price of prices) {
    const developer = price.canonical_id.split("/")[0] ?? price.provider_id;
    const canonicalId = canonicalProductId(developer, price.canonical_id);
    const outputModalities = price.output_modalities ?? ["text"];
    const modelType =
      price.model_type ?? inferModelType(price.canonical_id, price.name, outputModalities);
    write.run({
      id: canonicalId,
      name: price.name,
      developer,
      modelType,
      family: null,
      description: `${price.name}；${price.note}`,
      verifiedAt: price.verified_at ?? chinaOfficialData.verified_at,
      contextWindow: price.context_window,
      inputModalities: JSON.stringify(price.input_modalities ?? ["text"]),
      outputModalities: JSON.stringify(outputModalities),
      raw: JSON.stringify(price),
      now,
    });
  }
}

function upsertOfficialChinaPrices(
  now: string,
  liveResults: LiveOfficialPriceResult[] = [],
) {
  const database = getDatabase();
  const verifiedAt = chinaOfficialData.verified_at;
  const prices = mergeOfficialPrices(liveResults);
  const liveVerified = new Map(
    liveResults
      .filter((result) => !result.error)
      .map((result) => [result.providerId, now.slice(0, 10)]),
  );
  upsertAliyunCanonicalModels(now);
  ensureOfficialPriceCanonicalModels(prices, now);

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
      verifiedAt: liveVerified.get(provider.id as LiveOfficialPriceResult["providerId"]) ?? verifiedAt,
      now,
    });

    for (const developer of provider.developer_ids) {
      database
        .prepare("UPDATE canonical_models SET developer_country = 'CN' WHERE developer = ?")
        .run(developer);
    }
  }

  deactivateOfferings("official-cn", now);

  const providerNames = new Map(
    chinaOfficialData.providers.map((provider) => [provider.id, provider.name]),
  );
  const write = offeringStatement();
  const match = createMatcher();
  for (const price of prices) {
    const developer = price.canonical_id.split("/")[0] ?? price.provider_id;
    const canonicalId = canonicalProductId(developer, price.canonical_id);
    const identity = match(
      "official-cn",
      price.model_id,
      price.name,
      canonicalId,
    );
    const seed = identity.id
      ? (database
          .prepare(`
            SELECT model_type, family, description, input_modalities, output_modalities,
              context_window, max_output, reasoning, tool_call, structured_output,
              open_weights, release_date
            FROM canonical_models WHERE id = ?
          `)
          .get(identity.id) as CanonicalOfferingSeed | undefined)
      : undefined;
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
      mode: price.model_type ?? seed?.model_type ?? "chat",
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
      priceStatus: price.price_status,
      isOfficialApi: 1,
      market: "CN",
      priceNote: price.note,
      priceDisplay: price.price_display ?? null,
      verifiedAt: price.verified_at ?? verifiedAt,
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
  }

  upsertAliyunOfferings(write, now);

  return (
    database
      .prepare("SELECT COUNT(*) AS count FROM offerings WHERE source = 'official-cn' AND active = 1")
      .get() as { count: number }
  ).count;
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

type SyncSnapshot = {
  activeModels: Map<string, string>;
  retiredModels: Set<string>;
  activeOfferings: Set<string>;
  activePrices: Map<string, string>;
};

type PriceHistoryRow = {
  uid: string;
  canonical_model_id: string | null;
  source: string;
  provider_id: string;
  source_model_id: string;
  currency: string | null;
  price_unit: string | null;
  price_status: string;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  price_display: string | null;
  pricing_tiers_json: string;
  status: string;
  active: number;
  source_url: string | null;
  verified_at: string | null;
};

function modelSnapshotFingerprint(row: Record<string, unknown>) {
  return JSON.stringify({
    name: row.name,
    releaseDate: row.release_date,
    contextWindow: row.context_window,
    maxOutput: row.max_output,
    modelType: row.model_type,
    inputModalities: row.input_modalities,
    outputModalities: row.output_modalities,
    openWeights: row.open_weights,
  });
}

function priceSnapshot(row: PriceHistoryRow) {
  return JSON.stringify({
    currency: row.currency,
    priceUnit: row.price_unit,
    priceStatus: row.price_status,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    cacheReadPrice: row.cache_read_price,
    cacheWritePrice: row.cache_write_price,
    priceDisplay: row.price_display,
    pricingTiers: row.pricing_tiers_json,
    offeringStatus: row.status,
    active: row.active,
  });
}

function captureSyncSnapshot(): SyncSnapshot {
  const database = getDatabase();
  const modelRows = database
    .prepare(`
      SELECT COALESCE(product_id, id) AS product_id, name, active, lifecycle_status,
        release_date, context_window, max_output, model_type, input_modalities,
        output_modalities, open_weights
      FROM canonical_models
      WHERE is_current = 1 AND (active = 1 OR lifecycle_status = 'retired')
    `)
    .all() as Array<Record<string, unknown> & {
    product_id: string;
    active: number;
    lifecycle_status: string;
  }>;
  const offeringRows = database
    .prepare(`
      SELECT uid, canonical_model_id, source, provider_id, source_model_id,
        currency, price_unit, price_status, input_price, output_price,
        cache_read_price, cache_write_price, price_display, pricing_tiers_json,
        status, active, source_url, verified_at
      FROM offerings
      WHERE source <> 'litellm' AND (is_official_api = 1 OR source = 'openrouter')
    `)
    .all() as PriceHistoryRow[];
  const activeModels = new Map<string, string>();
  const retiredModels = new Set<string>();
  for (const row of modelRows) {
    if (row.active === 1 && row.lifecycle_status !== "retired") {
      activeModels.set(row.product_id, modelSnapshotFingerprint(row));
    } else if (row.lifecycle_status === "retired") {
      retiredModels.add(row.product_id);
    }
  }
  const activeOfferings = new Set<string>();
  const activePrices = new Map<string, string>();
  for (const row of offeringRows) {
    if (row.active !== 1) continue;
    activeOfferings.add(row.uid);
    activePrices.set(row.uid, priceSnapshot(row));
  }
  return { activeModels, retiredModels, activeOfferings, activePrices };
}

function recordOfferingPriceHistory(capturedAt: string) {
  const database = getDatabase();
  const offerings = database
    .prepare(`
      SELECT uid, canonical_model_id, source, provider_id, source_model_id,
        currency, price_unit, price_status, input_price, output_price,
        cache_read_price, cache_write_price, price_display, pricing_tiers_json,
        status, active, source_url, verified_at
      FROM offerings
      WHERE source <> 'litellm' AND (is_official_api = 1 OR source = 'openrouter')
    `)
    .all() as PriceHistoryRow[];
  const previousRows = database
    .prepare(`
      SELECT history.offering_uid, history.snapshot_json
      FROM offering_price_history history
      INNER JOIN (
        SELECT offering_uid, MAX(id) AS id
        FROM offering_price_history
        GROUP BY offering_uid
      ) latest ON latest.id = history.id
    `)
    .all() as Array<{ offering_uid: string; snapshot_json: string }>;
  const previous = new Map(previousRows.map((row) => [row.offering_uid, row.snapshot_json]));
  const write = database.prepare(`
    INSERT INTO offering_price_history (
      offering_uid, canonical_model_id, source, provider_id, source_model_id,
      currency, price_unit, price_status, input_price, output_price,
      cache_read_price, cache_write_price, price_display, pricing_tiers_json,
      offering_status, active, source_url, verified_at, snapshot_json, captured_at
    ) VALUES (
      @offeringUid, @canonicalModelId, @source, @providerId, @sourceModelId,
      @currency, @priceUnit, @priceStatus, @inputPrice, @outputPrice,
      @cacheReadPrice, @cacheWritePrice, @priceDisplay, @pricingTiers,
      @offeringStatus, @active, @sourceUrl, @verifiedAt, @snapshot, @capturedAt
    )
  `);
  const execute = () => {
    let changed = 0;
    for (const row of offerings) {
      const snapshot = priceSnapshot(row);
      if (previous.get(row.uid) === snapshot) continue;
      write.run({
        offeringUid: row.uid,
        canonicalModelId: row.canonical_model_id,
        source: row.source,
        providerId: row.provider_id,
        sourceModelId: row.source_model_id,
        currency: row.currency,
        priceUnit: row.price_unit,
        priceStatus: row.price_status,
        inputPrice: row.input_price,
        outputPrice: row.output_price,
        cacheReadPrice: row.cache_read_price,
        cacheWritePrice: row.cache_write_price,
        priceDisplay: row.price_display,
        pricingTiers: row.pricing_tiers_json,
        offeringStatus: row.status,
        active: row.active,
        sourceUrl: row.source_url,
        verifiedAt: row.verified_at,
        snapshot,
        capturedAt,
      });
      changed += 1;
    }
    return changed;
  };
  return database.inTransaction ? execute() : database.transaction(execute)();
}

function diffSyncSnapshots(before: SyncSnapshot, after: SyncSnapshot) {
  const newlyActive = [...after.activeModels.keys()].filter(
    (productId) => !before.activeModels.has(productId),
  );
  return {
    newModels: newlyActive.filter((productId) => !before.retiredModels.has(productId)).length,
    reactivatedModels: newlyActive.filter((productId) => before.retiredModels.has(productId)).length,
    retiredModels: [...after.retiredModels].filter(
      (productId) => !before.retiredModels.has(productId),
    ).length,
    retiredOfferings: [...before.activeOfferings].filter(
      (uid) => !after.activeOfferings.has(uid),
    ).length,
    priceChanges: [...after.activePrices].filter(
      ([uid, fingerprint]) =>
        before.activePrices.has(uid) && before.activePrices.get(uid) !== fingerprint,
    ).length,
    specChanges: [...after.activeModels].filter(
      ([productId, fingerprint]) =>
        before.activeModels.has(productId) && before.activeModels.get(productId) !== fingerprint,
    ).length,
  };
}

export async function syncCatalog(): Promise<SyncResult> {
  const database = getDatabase();
  const startedAt = new Date().toISOString();
  const before = captureSyncSnapshot();
  recordOfferingPriceHistory(startedAt);
  const run = database
    .prepare("INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')")
    .run(startedAt);
  const runId = Number(run.lastInsertRowid);

  try {
    const [
      modelsDevModels,
      modelsDevOfferings,
      openRouter,
      qianwenCatalog,
      volcengineArk,
      liveOfficialPrices,
      freshOfficialWeightRepositories,
      previousOfficialWeightRepositories,
      freshOfficialMediaPrices,
      previousOfficialMediaPrices,
    ] =
      await Promise.all([
        fetchJson(SOURCE_ENDPOINTS.modelsdev_models.url),
        fetchJson(SOURCE_ENDPOINTS.modelsdev_offerings.url),
        fetchJson(SOURCE_ENDPOINTS.openrouter.url),
        fetchQianwenCatalog(),
        fetchVolcengineArkCatalog(),
        fetchLiveOfficialPrices(),
        fetchOfficialWeightRepositories(),
        readOfficialWeightRepositorySnapshot(),
        fetchOfficialMediaPrices(),
        readOfficialMediaPriceSnapshot(),
      ]);

    const officialWeightRepositories = mergeOfficialWeightRepositorySnapshots(
      freshOfficialWeightRepositories,
      previousOfficialWeightRepositories,
    );
    const officialMediaPrices = mergeOfficialMediaPriceSnapshots(
      freshOfficialMediaPrices,
      previousOfficialMediaPrices,
    );
    const [freshVolcenginePricing, previousVolcenginePricing] = await Promise.all([
      fetchVolcenginePricing(volcengineArk),
      readVolcenginePricingSnapshot(),
    ]);
    const volcenginePricing = mergeVolcenginePricingSnapshots(
      freshVolcenginePricing,
      previousVolcenginePricing,
    );

    const effectiveOfficialPrices = await Promise.all(
      liveOfficialPrices.map(async (result) => {
        if (!result.error) return result;
        const snapshotPrices = await readOfficialPriceSnapshot(result.providerId);
        return snapshotPrices.length ? { ...result, prices: snapshotPrices } : result;
      }),
    );

    await Promise.all([
      writeRawSnapshot("modelsdev-models", modelsDevModels),
      writeRawSnapshot("modelsdev-offerings", modelsDevOfferings),
      writeRawSnapshot("openrouter", openRouter),
      writeRawSnapshot("qianwen-catalog", qianwenCatalog),
      writeRawSnapshot("volcengine-ark", volcengineArk),
      writeRawSnapshot("official-open-weight-repositories", officialWeightRepositories),
      writeRawSnapshot("official-us-media-pricing", officialMediaPrices),
      writeRawSnapshot("volcengine-detail-pricing", volcenginePricing),
      ...liveOfficialPrices
        .filter((result) => !result.error)
        .map((result) =>
          writeRawSnapshot(`official-${result.providerId}-pricing`, {
            fetched_at: new Date().toISOString(),
            source_url: result.sourceUrl,
            prices: result.prices,
            source_payload: result.snapshot,
          }),
        ),
    ]);

    const now = new Date().toISOString();
    const liveBySource = new Map<string, LiveOfficialPriceResult>(
      effectiveOfficialPrices.map((result) => [
        LIVE_OFFICIAL_SOURCE_IDS[result.providerId],
        result,
      ]),
    );
    const counts = database.transaction(() => {
      const result = {
        modelsdev_models: upsertCanonicalModels(modelsDevModels, now),
        qianwen_catalog: upsertQianwenCatalog(qianwenCatalog, now),
        volcengine_ark: upsertVolcengineArkCatalog(volcengineArk, now),
        curated_recent: upsertCuratedRecentModels(now),
        curated_retrieval: upsertCuratedRetrievalModels(now),
        curated_openness: applyCuratedOpennessEvidence(now),
        official_open_weights: officialWeightRepositories.repositories.length,
        modelsdev_offerings: upsertModelsDevOfferings(modelsDevOfferings, now),
        openrouter: upsertOpenRouterOfferings(openRouter, now),
        official_cn: upsertOfficialChinaPrices(now, effectiveOfficialPrices),
        qianwen_pricing: upsertQianwenPricingOfferings(qianwenCatalog, now),
        official_us_media_live: upsertOfficialMediaPriceOfferings(
          officialMediaPrices.records,
          now,
        ),
        volcengine_pricing: upsertVolcenginePricingOfferings(
          volcenginePricing.records,
          now,
        ),
        official_minimax_live:
          effectiveOfficialPrices.find((item) => item.providerId === "minimax")?.prices.length ?? 0,
        official_deepseek_live:
          effectiveOfficialPrices.find((item) => item.providerId === "deepseek")?.prices.length ?? 0,
        official_moonshot_live:
          effectiveOfficialPrices.find((item) => item.providerId === "moonshot")?.prices.length ?? 0,
        official_zhipu_live:
          effectiveOfficialPrices.find((item) => item.providerId === "zhipu")?.prices.length ?? 0,
      };

      applyCanonicalProductNormalization(now, new Set(before.activeModels.keys()));
      applyOfficialOpennessClassification(officialWeightRepositories.repositories, now);

      deactivateOfferings("litellm", now);
      database.prepare("DELETE FROM sources WHERE id = 'litellm'").run();

      for (const [source, count] of Object.entries(result)) {
        const live = liveBySource.get(source as keyof typeof SOURCE_ENDPOINTS);
        const opennessError =
          source === "official_open_weights" && freshOfficialWeightRepositories.errors.length
            ? freshOfficialWeightRepositories.errors.join("；")
            : null;
        const mediaPriceError =
          source === "official_us_media_live" && freshOfficialMediaPrices.errors.length
            ? freshOfficialMediaPrices.errors.join("；")
            : null;
        const volcenginePriceError =
          source === "volcengine_pricing" && freshVolcenginePricing.errors.length
            ? freshVolcenginePricing.errors.join("；")
            : null;
        updateSource(
          source as keyof typeof SOURCE_ENDPOINTS,
          count,
          now,
          live?.error ?? opennessError ?? mediaPriceError ?? volcenginePriceError,
        );
      }

      recordOfferingPriceHistory(now);
      return result;
    })();

    const completedAt = new Date().toISOString();
    const changes = diffSyncSnapshots(before, captureSyncSnapshot());
    const finalCounts = {
      ...counts,
      new_models: changes.newModels,
      reactivated_models: changes.reactivatedModels,
      retired_models: changes.retiredModels,
      retired_offerings: changes.retiredOfferings,
      price_changes: changes.priceChanges,
      spec_changes: changes.specChanges,
    };
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
      .run(completedAt, JSON.stringify(finalCounts), runId);

    return {
      runId,
      startedAt,
      completedAt,
      counts: finalCounts,
      unmatchedOfferings,
      changes,
    };
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
