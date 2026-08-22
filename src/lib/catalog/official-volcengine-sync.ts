type JsonObject = Record<string, unknown>;

export type VolcenginePricingRecord = {
  modelName: string;
  modelId: string;
  modelVersion: string;
  name: string;
  developerCode: string;
  developerName: string;
  contextWindow: number | null;
  maxInput: number | null;
  maxOutput: number | null;
  inputModalities: string[];
  outputModalities: string[];
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  currency: "CNY";
  priceUnit: "per_million_tokens" | "per_image" | "per_second" | "per_request" | "flexible";
  priceStatus: "priced" | "free";
  priceDisplay: string | null;
  tiers: Array<Record<string, unknown>>;
  serviceStatus: string;
  deprecationDate: string | null;
  sourceUrl: string;
  raw: Record<string, unknown>;
};

export type VolcenginePricingResult = {
  fetchedAt: string;
  successfulModels: string[];
  records: VolcenginePricingRecord[];
  errors: string[];
};

const DETAIL_ENDPOINT =
  "https://arkbff-cn-beijing.console.volcengine.com/api/2024-10-01/GetClientModelDetailPage?";
const PRICING_ENDPOINT =
  "https://arkbff-cn-beijing.console.volcengine.com/api/2024-10-01/GetModelSquareTopData?";

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonValue(value: unknown) {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "accept-language": "zh-CN,zh;q=0.9",
      "content-type": "application/json",
      origin: "https://ark.volcengine.com",
      referer: "https://ark.volcengine.com/region:cn-beijing/model",
      "user-agent": "local-model-catalog/0.1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

function yamlNumber(yaml: string, key: string) {
  const match = yaml.match(new RegExp(`^\\s*${key}:\\s*(\\d+)\\s*$`, "mi"));
  return match ? Number(match[1]) : null;
}

function contextFromText(value: string) {
  const match =
    value.match(/(\d+(?:\.\d+)?)\s*([km])(?:\s*tokens?)?\s*(?:长)?上下文/i) ??
    value.match(/上下文(?:窗口)?(?:至|为|支持)?\s*(\d+(?:\.\d+)?)\s*([km])/i);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2].toLowerCase() === "m" ? 1_000_000 : 1_024));
}

function yamlList(yaml: string, key: string) {
  const match = yaml.match(new RegExp(`^\\s*${key}:\\s*\\n((?:\\s+-\\s*[^\\n]+\\n?)+)`, "mi"));
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim().toLowerCase())
    .filter(Boolean);
}

function modelVersionMetadata(payload: unknown, modelName: string) {
  const result = object(object(payload).Result);
  const rawSourceData = object(result.rawSourceData);
  const mongo = object(rawSourceData.mongoDB);
  const versionMap = jsonValue(rawSourceData.modelVersionDO ?? mongo.modelVersionDO);
  const rawVersion = jsonValue(versionMap[modelName]);
  const foundationModel = object(rawVersion.FoundationModel);
  const arkModels = object(rawVersion.Arkmodels);
  const baseConfig = object(rawVersion.BaseConfig ?? arkModels.BaseConfig);
  const yaml = stringValue(baseConfig.RawYaml) ?? "";
  const statusInfo = jsonValue(rawVersion.StatusInfo);
  const description = stringValue(foundationModel.Description) ?? "";
  return {
    contextWindow: yamlNumber(yaml, "ContextWindow") ?? contextFromText(description),
    maxInput: yamlNumber(yaml, "MaxInputTokenLength"),
    maxOutput: yamlNumber(yaml, "MaxCompletionTokenLength"),
    inputModalities: yamlList(yaml, "InputModalities"),
    outputModalities: yamlList(yaml, "OutputModalities"),
    rawVersion,
    rawStatus: stringValue(rawVersion.Status),
    deprecationDate:
      stringValue(statusInfo.ShutdownDate)?.slice(0, 10) ??
      stringValue(statusInfo.RetiringDate)?.slice(0, 10) ??
      null,
  };
}

function primaryDetail(payload: unknown, modelName: string) {
  const result = object(object(payload).Result);
  const tabs = object(result.modelTabs);
  const items = Array.isArray(tabs.items) ? tabs.items.map(object) : [];
  const item =
    items.find((candidate) => stringValue(object(candidate.model).name) === modelName) ?? items[0];
  if (!item) return null;
  const groups = Array.isArray(item.versionGroups) ? item.versionGroups.map(object) : [];
  const versions = groups.flatMap((group) =>
    Array.isArray(group.versions) ? group.versions.map(object) : [],
  );
  const version = versions.find((candidate) => candidate.isPrimary === true) ?? versions[0];
  if (!version) return null;
  const header = object(version.header);
  const modelVersion = stringValue(header.modelVersion);
  const modelId = stringValue(header.modelId);
  if (!modelVersion || !modelId) throw new Error("详情页缺少模型版本或模型 ID");

  const model = object(item.model);
  const vendor = object(model.vendor);
  const introduction = stringValue(model.introductionMarkdown) ?? "";
  const metadata = modelVersionMetadata(payload, modelName);
  const contextWindow = metadata.contextWindow ?? contextFromText(introduction);

  return {
    modelVersion,
    modelId,
    name: stringValue(model.displayName) ?? stringValue(header.title) ?? modelName,
    developerCode: stringValue(vendor.name) ?? "Bytedance",
    developerName: stringValue(vendor.displayName) ?? "字节跳动",
    contextWindow,
    maxInput: metadata.maxInput,
    maxOutput: metadata.maxOutput,
    inputModalities: metadata.inputModalities,
    outputModalities: metadata.outputModalities,
    rawVersion: metadata.rawVersion,
    rawStatus: metadata.rawStatus ?? "active",
    deprecationDate: metadata.deprecationDate,
  };
}

function unitFromLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("百万") && normalized.includes("token")) {
    return "per_million_tokens" as const;
  }
  if (normalized.includes("千") && normalized.includes("token")) {
    return "per_million_tokens" as const;
  }
  if (normalized.includes("秒")) return "per_second" as const;
  if (normalized.includes("张") || normalized.includes("幅")) return "per_image" as const;
  if (normalized.includes("次") || normalized.includes("个")) return "per_request" as const;
  return "flexible" as const;
}

function priceItems(payload: unknown) {
  const result = object(object(payload).Result);
  const clientDetail = object(result.clientDetail);
  const pricing = Array.isArray(clientDetail.pricing) ? clientDetail.pricing.map(object) : [];
  const entry = pricing[0];
  if (!entry) return null;
  const section = object(entry.section);
  const priceConfig = object(section.pricing);
  const segments = Array.isArray(priceConfig.segments) ? priceConfig.segments.map(object) : [];
  const parsedSegments = segments.map((segment) => ({
    name: stringValue(segment.label) ?? "默认",
    items: (Array.isArray(segment.items) ? segment.items.map(object) : [])
      .map((item) => ({
        key: stringValue(item.key) ?? "",
        label: stringValue(item.label) ?? "价格",
        value: numberValue(item.value),
        unit: stringValue(item.unit) ?? "",
      }))
      .filter((item) => item.value !== null),
  }));
  const allItems = parsedSegments.flatMap((segment) => segment.items);
  if (!allItems.length) return null;
  const first = parsedSegments.find((segment) => segment.items.length)?.items ?? [];
  const input = first.find(
    (item) => /InferencePrompt/i.test(item.key) || (/输入/.test(item.label) && !/缓存/.test(item.label)),
  );
  const output = first.find(
    (item) => /InferenceCompletion/i.test(item.key) || /输出/.test(item.label),
  );
  const cacheRead = first.find(
    (item) => /ContextSessionHit/i.test(item.key) || /缓存命中/.test(item.label),
  );
  const cacheWrite = first.find(
    (item) => /ContextSessionStorage/i.test(item.key) || /缓存存储/.test(item.label),
  );
  const unitLabel = input?.unit ?? output?.unit ?? first[0]?.unit ?? "";
  const priceUnit = unitFromLabel(unitLabel);
  const multiplier = /千\s*tokens?/i.test(unitLabel) && !/百万/.test(unitLabel) ? 1_000 : 1;
  const values = allItems.map((item) => item.value ?? 0);
  const priceStatus: "priced" | "free" = values.some((value) => value > 0)
    ? "priced"
    : "free";
  const displayItems = first.slice(0, 4).map((item) => `${item.label} ¥${item.value}/${item.unit.replace(/^元\//, "")}`);
  return {
    inputPrice: input?.value === null || input?.value === undefined ? null : input.value * multiplier,
    outputPrice: output?.value === null || output?.value === undefined ? null : output.value * multiplier,
    cacheReadPrice:
      cacheRead?.value === null || cacheRead?.value === undefined
        ? null
        : cacheRead.value * multiplier,
    cacheWritePrice:
      cacheWrite?.value === null || cacheWrite?.value === undefined
        ? null
        : cacheWrite.value * multiplier,
    priceUnit,
    priceStatus,
    priceDisplay:
      priceUnit === "per_million_tokens" && parsedSegments.length === 1
        ? null
        : `${parsedSegments[0]?.name ?? "默认"}：${displayItems.join("；")}${parsedSegments.length > 1 ? `；共 ${parsedSegments.length} 档` : ""}`,
    tiers: parsedSegments.map((segment) => ({
      name: segment.name,
      prices: segment.items.map((item) => ({
        key: item.key,
        name: item.label,
        price: item.value,
        currency: "CNY",
        unit: item.unit,
      })),
    })),
    rawPricing: entry,
  };
}

function serviceStatus(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("retiring")) return "retiring";
  if (normalized.includes("retired") || normalized.includes("offline") || normalized.includes("shutdown")) {
    return "retired";
  }
  return "active";
}

async function fetchOne(modelName: string): Promise<VolcenginePricingRecord | null> {
  const detailPayload = await postJson(DETAIL_ENDPOINT, {
    modelName,
    region: "cn-beijing",
    includeTopData: false,
  });
  const detail = primaryDetail(detailPayload, modelName);
  if (!detail) return null;
  const pricingPayload = await postJson(PRICING_ENDPOINT, {
    viewType: "detail",
    region: "cn-beijing",
    selections: [{ modelName, modelVersion: detail.modelVersion }],
    modules: ["pricing", "rateLimit"],
  });
  const prices = priceItems(pricingPayload);
  if (!prices) return null;
  const pricingMetadata = modelVersionMetadata(pricingPayload, modelName);
  return {
    modelName,
    modelId: detail.modelId,
    modelVersion: detail.modelVersion,
    name: detail.name,
    developerCode: detail.developerCode,
    developerName: detail.developerName,
    contextWindow: pricingMetadata.contextWindow ?? detail.contextWindow,
    maxInput: pricingMetadata.maxInput ?? detail.maxInput,
    maxOutput: pricingMetadata.maxOutput ?? detail.maxOutput,
    inputModalities: pricingMetadata.inputModalities.length
      ? pricingMetadata.inputModalities
      : detail.inputModalities,
    outputModalities: pricingMetadata.outputModalities.length
      ? pricingMetadata.outputModalities
      : detail.outputModalities,
    inputPrice: prices.inputPrice,
    outputPrice: prices.outputPrice,
    cacheReadPrice: prices.cacheReadPrice,
    cacheWritePrice: prices.cacheWritePrice,
    currency: "CNY",
    priceUnit: prices.priceUnit,
    priceStatus: prices.priceStatus,
    priceDisplay: prices.priceDisplay,
    tiers: prices.tiers,
    serviceStatus: serviceStatus(pricingMetadata.rawStatus ?? detail.rawStatus),
    deprecationDate: pricingMetadata.deprecationDate ?? detail.deprecationDate,
    sourceUrl: `https://ark.volcengine.com/region:cn-beijing/model/detail?name=${encodeURIComponent(modelName)}`,
    raw: {
      detail:
        Object.keys(pricingMetadata.rawVersion).length > 0
          ? pricingMetadata.rawVersion
          : detail.rawVersion,
      pricing: prices.rawPricing,
    },
  };
}

async function mapWithLimit<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
}

export async function fetchVolcenginePricing(
  catalogPayload: unknown,
): Promise<VolcenginePricingResult> {
  const result = object(object(catalogPayload).Result);
  const cards = Array.isArray(result.cards) ? result.cards.map(object) : [];
  const modelNames = [...new Set(
    cards
      .sort((left, right) => {
        const leftDate = stringValue(object(left.sortValues).CreateTime) ?? "";
        const rightDate = stringValue(object(right.sortValues).CreateTime) ?? "";
        return rightDate.localeCompare(leftDate);
      })
      .map((card) => stringValue(object(card.model).modelName))
      .filter((value): value is string => Boolean(value)),
  )];
  const errors: string[] = [];
  const successfulModels: string[] = [];
  const records = await mapWithLimit(modelNames, 8, async (modelName) => {
    try {
      const record = await fetchOne(modelName);
      successfulModels.push(modelName);
      return record;
    } catch (error) {
      errors.push(`${modelName}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  return {
    fetchedAt: new Date().toISOString(),
    successfulModels,
    records: records.filter((record): record is VolcenginePricingRecord => record !== null),
    errors,
  };
}
