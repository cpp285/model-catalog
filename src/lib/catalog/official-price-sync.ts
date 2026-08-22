type PriceStatus = "priced" | "free" | "unknown";

export type OfficialPriceRecord = {
  provider_id: string;
  model_id: string;
  canonical_id: string;
  name: string;
  currency: "CNY";
  unit: string;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  price_status: PriceStatus;
  price_display?: string | null;
  context_window: number | null;
  source_url: string;
  note: string;
  tiers: Array<Record<string, unknown>>;
  model_type?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  verified_at?: string;
};

export type LiveOfficialPriceResult = {
  providerId: "minimax" | "deepseek" | "moonshot" | "zhipu";
  sourceUrl: string;
  prices: OfficialPriceRecord[];
  snapshot: unknown;
  error: string | null;
};

const USER_AGENT = "local-model-catalog/0.1";

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: string | undefined) {
  if (!value) return null;
  if (value.includes("免费")) return 0;
  const values = [...value.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  return values.length ? values.at(-1) ?? null : null;
}

function contextTokens(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replaceAll(",", "").toLowerCase();
  const tokenValue = normalized.match(/([\d.]+)\s*tokens?/);
  if (tokenValue) return Number(tokenValue[1]);
  const compact = normalized.match(/([\d.]+)\s*([km])/);
  if (!compact) return null;
  return Math.round(Number(compact[1]) * (compact[2] === "m" ? 1_000_000 : 1_000));
}

function markdownRows(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) =>
          cell
            .replace(/<[^>]+>/g, " ")
            .replace(/[~*_`]/g, "")
            .replace(/\\([*_])/g, "$1")
            .replace(/\s+/g, " ")
            .trim(),
        ),
    );
}

function priceRecord(
  values: Omit<OfficialPriceRecord, "currency" | "verified_at">,
): OfficialPriceRecord {
  return { ...values, currency: "CNY", verified_at: currentDate() };
}

async function fetchMiniMaxPrices(): Promise<LiveOfficialPriceResult> {
  const markdownUrl = "https://platform.minimaxi.com/docs/guides/pricing-paygo.md";
  const sourceUrl = "https://platform.minimaxi.com/docs/guides/pricing-paygo";
  const markdown = await fetchText(markdownUrl);
  const rows = markdownRows(markdown);
  const prices: OfficialPriceRecord[] = [];

  const standardBlock = markdown.match(/<Tab title="标准">([\s\S]*?)<\/Tab>/)?.[1] ?? "";
  const priorityBlock = markdown.match(/<Tab title="优先\*">([\s\S]*?)<\/Tab>/)?.[1] ?? "";
  const standardRows = markdownRows(standardBlock).filter((row) => row[0]?.includes("MiniMax-M3"));
  const priorityRows = markdownRows(priorityBlock).filter((row) => row[0]?.includes("MiniMax-M3"));
  if (standardRows.length >= 2 && priorityRows.length >= 2) {
    const tiers = [
      ...standardRows.map((row, index) => ({
        name: index === 0 ? "标准 · ≤512K" : "标准 · 512K–1M",
        input_price: money(row[1]),
        output_price: money(row[2]),
        cache_read_price: money(row[3]),
      })),
      ...priorityRows.map((row, index) => ({
        name: index === 0 ? "优先 · ≤512K" : "优先 · 512K–1M",
        input_price: money(row[1]),
        output_price: money(row[2]),
        cache_read_price: money(row[3]),
      })),
    ];
    prices.push(
      priceRecord({
        provider_id: "minimax",
        model_id: "MiniMax-M3",
        canonical_id: "minimax/MiniMax-M3",
        name: "MiniMax M3",
        unit: "per_million_tokens",
        input_price: tiers[0].input_price,
        output_price: tiers[0].output_price,
        cache_read_price: tiers[0].cache_read_price,
        cache_write_price: null,
        price_status: "priced",
        context_window: 1_048_576,
        source_url: sourceUrl,
        note: "官网实时价；主价为标准服务 ≤512K 的当前有效价，长上下文和 Priority 价格见明细。",
        tiers,
        model_type: "chat",
        input_modalities: ["text", "image", "video"],
        output_modalities: ["text"],
      }),
    );
  }

  for (const modelId of ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]) {
    const row = rows.find((candidate) => candidate[0] === modelId);
    if (!row) continue;
    prices.push(
      priceRecord({
        provider_id: "minimax",
        model_id: modelId,
        canonical_id: `minimax/${modelId}`,
        name: modelId.replace("-highspeed", " Highspeed"),
        unit: "per_million_tokens",
        input_price: money(row[1]),
        output_price: money(row[2]),
        cache_read_price: money(row[3]),
        cache_write_price: money(row[4]),
        price_status: "priced",
        context_window: null,
        source_url: sourceUrl,
        note: "MiniMax 官网实时按量 API 价格。",
        tiers: [],
        model_type: "chat",
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
      }),
    );
  }

  for (const modelId of ["speech-2.8-hd", "speech-2.8-turbo"]) {
    const row = rows.find((candidate) => candidate[1] === modelId);
    if (!row) continue;
    const outputPrice = money(row.at(-1));
    prices.push(
      priceRecord({
        provider_id: "minimax",
        model_id: modelId,
        canonical_id: `minimax/${modelId}`,
        name: modelId,
        unit: "per_ten_thousand_characters",
        input_price: null,
        output_price: outputPrice,
        cache_read_price: null,
        cache_write_price: null,
        price_status: "priced",
        context_window: null,
        source_url: sourceUrl,
        note: `官网实时语音合成价；音色设计或快速复刻另收 ¥9.9/音色。`,
        tiers: [
          { 计费项: "同步/异步语音合成", 价格: `¥${outputPrice}/万字符` },
          { 计费项: "音色设计/快速复刻", 价格: "¥9.9/音色" },
        ],
        model_type: "text_to_speech",
        input_modalities: ["text"],
        output_modalities: ["audio"],
      }),
    );
  }

  const videoRows = rows.filter((row) => row[0]?.includes("MiniMax-H3"));
  const twoK = videoRows.find((row) => row[1] === "2K" && row.some((cell) => cell.includes("元/秒")));
  const p768 = videoRows.find((row) => row[1] === "768P" && row.some((cell) => cell.includes("元/秒")));
  const contextIr = rows.find((row) => row[0]?.includes("MiniMax-H3-Context-IR"));
  if (twoK && p768 && contextIr) {
    const twoKPrice = money(twoK.at(-1));
    const p768Price = money(p768.at(-1));
    const contextInput = money(contextIr[1]);
    const contextOutput = money(contextIr[2]);
    prices.push(
      priceRecord({
        provider_id: "minimax",
        model_id: "MiniMax-H3",
        canonical_id: "minimax/minimax-h3",
        name: "MiniMax H3",
        unit: "flexible",
        input_price: null,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        price_status: "priced",
        price_display: `视频生成 ¥${p768Price?.toFixed(2)}–${twoKPrice?.toFixed(2)}/秒；Context-IR 另计`,
        context_window: null,
        source_url: sourceUrl,
        note: "官网实时价；视频输出、输入素材、再生成和 Context-IR 使用不同计费单位。",
        tiers: [
          { 计费项: "视频生成输出", 规格: "2K", 价格: `¥${twoKPrice}/秒` },
          { 计费项: "视频生成输出", 规格: "768P", 价格: `¥${p768Price}/秒` },
          { 计费项: "输入音频", 价格: "免费" },
          { 计费项: "输入图片", 价格: "5 张以内免费，超出 ¥0.20/张" },
          { 计费项: "视频再生成", 价格: "¥0.30/秒" },
          { 计费项: "H3-Context-IR", 价格: `输入 ¥${contextInput}；输出 ¥${contextOutput}/百万 Token` },
        ],
        model_type: "video_generation",
        input_modalities: ["text", "image", "video", "audio"],
        output_modalities: ["video", "audio"],
      }),
    );
  }

  if (prices.length < 6) throw new Error(`解析结果不足：${prices.length}/6`);
  return { providerId: "minimax", sourceUrl, prices, snapshot: { markdown }, error: null };
}

function htmlText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

type HtmlCell = { text: string; rowspan: number; colspan: number };

function htmlTableGrid(table: string) {
  const rawRows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) =>
    [...rowMatch[1].matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((cellMatch) => {
      const attributes = cellMatch[1];
      return {
        text: htmlText(cellMatch[2]),
        rowspan: Number(attributes.match(/rowspan=["']?(\d+)/i)?.[1] ?? 1),
        colspan: Number(attributes.match(/colspan=["']?(\d+)/i)?.[1] ?? 1),
      } satisfies HtmlCell;
    }),
  );
  const spans = new Map<number, { text: string; remaining: number }>();
  const grid: string[][] = [];

  for (const rawRow of rawRows) {
    const row: string[] = [];
    let column = 0;
    const consumeSpans = () => {
      while (spans.has(column)) {
        const span = spans.get(column)!;
        row[column] = span.text;
        span.remaining -= 1;
        if (span.remaining <= 0) spans.delete(column);
        column += 1;
      }
    };
    consumeSpans();
    for (const cell of rawRow) {
      consumeSpans();
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        row[column + offset] = cell.text;
        if (cell.rowspan > 1) {
          spans.set(column + offset, { text: cell.text, remaining: cell.rowspan - 1 });
        }
      }
      column += cell.colspan;
    }
    consumeSpans();
    grid.push(row);
  }
  return grid;
}

async function fetchDeepSeekPrices(): Promise<LiveOfficialPriceResult> {
  const sourceUrl = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
  const html = await fetchText(sourceUrl);
  const table = [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)]
    .map((match) => match[0])
    .find((candidate) => candidate.includes("deepseek-v4-flash"));
  if (!table) throw new Error("未找到官方模型价格表");
  const grid = htmlTableGrid(table);
  const modelRow = grid.find((row) => row[0] === "模型");
  const modelIds = modelRow?.slice(1).filter((value) => value?.startsWith("deepseek-")) ?? [];
  const priceRows = grid.filter((row) => row.some((cell) => cell?.includes("百万tokens")));
  const peakRows = priceRows.filter((row) => row.includes("高峰时段"));
  const idleRows = priceRows.filter((row) => row.includes("空闲时段"));
  const prices = modelIds.map((modelId, index) => {
    const peakHit = peakRows.find((row) => row.some((cell) => cell.includes("缓存命中")));
    const peakMiss = peakRows.find((row) => row.some((cell) => cell.includes("缓存未命中")));
    const peakOutput = peakRows.find((row) => row.some((cell) => cell.includes("百万tokens输出")));
    const column = index + 3;
    const tiers = [
      ...idleRows.map((row) => ({
        name: `${row.find((cell) => cell.includes("百万tokens"))} · 空闲时段`,
        price: money(row[column]),
      })),
      ...peakRows.map((row) => ({
        name: `${row.find((cell) => cell.includes("百万tokens"))} · 高峰时段`,
        price: money(row[column]),
      })),
    ];
    return priceRecord({
      provider_id: "deepseek",
      model_id: modelId,
      canonical_id: `deepseek/${modelId}`,
      name: modelId,
      unit: "per_million_tokens",
      input_price: money(peakMiss?.[column]),
      output_price: money(peakOutput?.[column]),
      cache_read_price: money(peakHit?.[column]),
      cache_write_price: null,
      price_status: "priced",
      context_window: 1_000_000,
      source_url: sourceUrl,
      note: "官网实时价；主价为北京时间高峰时段，空闲时段价格见明细。",
      tiers,
      model_type: "chat",
      input_modalities: modelId.includes("vision") ? ["text", "image"] : ["text"],
      output_modalities: ["text"],
    });
  });
  if (prices.length < 3 || prices.some((price) => price.output_price === null)) {
    throw new Error(`解析结果异常：${prices.length} 个模型`);
  }
  return { providerId: "deepseek", sourceUrl, prices, snapshot: { html }, error: null };
}

function parseQuotedRows(markdown: string) {
  const start = markdown.indexOf("rows={[");
  if (start < 0) return [];
  const end = markdown.indexOf("]}", start);
  if (end < 0) return [];
  const block = markdown.slice(start + "rows={[".length, end);
  return [...block.matchAll(/\[(?:\s*"(?:\\.|[^"\\])*"\s*,?)+\]/g)]
    .map((match) => {
      try {
        return JSON.parse(match[0]) as string[];
      } catch {
        return [];
      }
    })
    .filter((row) => row.length > 0);
}

async function fetchKimiPrices(): Promise<LiveOfficialPriceResult> {
  const indexUrl = "https://platform.kimi.com/docs/pricing/chat.md";
  const sourceUrl = "https://platform.kimi.com/docs/pricing/chat";
  const index = await fetchText(indexUrl);
  const slugs = [...index.matchAll(/href="\/docs\/pricing\/([^"]+)"/g)].map((match) => match[1]);
  const uniqueSlugs = [...new Set(slugs)];
  if (!uniqueSlugs.length) throw new Error("未找到模型定价子页面");
  const pages = await Promise.all(
    uniqueSlugs.map(async (slug) => ({
      slug,
      markdown: await fetchText(`https://platform.kimi.com/docs/pricing/${slug}.md`),
    })),
  );
  const prices: OfficialPriceRecord[] = [];
  for (const page of pages) {
    const rows = parseQuotedRows(page.markdown);
    const hasCachePrice = page.markdown.includes("输入价格（缓存命中）");
    for (const row of rows) {
      const [modelId] = row;
      if (!modelId) continue;
      const cacheReadPrice = hasCachePrice ? money(row[2]) : null;
      const inputPrice = money(row[hasCachePrice ? 3 : 2]);
      const outputPrice = money(row[hasCachePrice ? 4 : 3]);
      const contextWindow = contextTokens(row[hasCachePrice ? 5 : 4]);
      const multimodal = /图片|视频|多模态/.test(page.markdown);
      prices.push(
        priceRecord({
          provider_id: "moonshot",
          model_id: modelId,
          canonical_id: `moonshotai/${modelId.toLowerCase()}`,
          name: modelId,
          unit: "per_million_tokens",
          input_price: inputPrice,
          output_price: outputPrice,
          cache_read_price: cacheReadPrice,
          cache_write_price: null,
          price_status: "priced",
          context_window: contextWindow,
          source_url: `https://platform.kimi.com/docs/pricing/${page.slug}`,
          note: "Kimi 开放平台官网实时按量 API 价格。",
          tiers: [],
          model_type: "chat",
          input_modalities: multimodal ? ["text", "image", "video"] : ["text"],
          output_modalities: ["text"],
        }),
      );
    }
  }
  if (prices.length < 4 || prices.some((price) => price.output_price === null)) {
    throw new Error(`解析结果异常：${prices.length} 个模型`);
  }
  return {
    providerId: "moonshot",
    sourceUrl,
    prices,
    snapshot: { index, pages },
    error: null,
  };
}

function extractBalanced(source: string, start: number, open: string, close: string) {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function jsStringProperty(source: string, key: string) {
  const match = source.match(new RegExp(`${key}:"((?:\\\\.|[^"\\\\])*)"`));
  return match?.[1]?.replaceAll('\\"', '"').replaceAll("\\\\", "\\") ?? "";
}

function jsStringArrayProperty(source: string, key: string) {
  const match = source.match(new RegExp(`${key}:\\[([^\\]]*)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((item) => item[1]);
}

function topLevelObjects(arraySource: string) {
  const objects: string[] = [];
  for (let index = 1; index < arraySource.length - 1; index += 1) {
    if (arraySource[index] !== "{") continue;
    const value = extractBalanced(arraySource, index, "{", "}");
    if (!value) break;
    objects.push(value);
    index += value.length - 1;
  }
  return objects;
}

async function fetchZhipuPrices(): Promise<LiveOfficialPriceResult> {
  const sourceUrl = "https://open.bigmodel.cn/pricing";
  const embeddingSourceUrl = "https://docs.bigmodel.cn/cn/guide/models/embedding/embedding-3";
  const knowledgeSourceUrl = "https://docs.bigmodel.cn/cn/guide/tools/knowledge/price";
  const [html, embeddingMarkdown, knowledgeMarkdown] = await Promise.all([
    fetchText(sourceUrl),
    fetchText(`${embeddingSourceUrl}.md`),
    fetchText(`${knowledgeSourceUrl}.md`),
  ]);
  const appUrl = html.match(/https:\/\/static\.bigmodel\.cn\/[^"']+\/js\/app\.[^"']+\.js/)?.[0];
  if (!appUrl) throw new Error("未找到官网价格脚本");
  const script = await fetchText(appUrl);
  const marker = 'newModel:{name:"旗舰模型"';
  const markerIndex = script.indexOf(marker);
  if (markerIndex < 0) throw new Error("未找到旗舰模型价格数据");
  const objectStart = script.indexOf("{", markerIndex);
  const newModel = extractBalanced(script, objectStart, "{", "}");
  if (!newModel) throw new Error("旗舰模型价格结构不完整");
  const sections: Array<{ name: string; models: string }> = [];
  const sectionPattern = /modelName:"([^"]+)"/g;
  for (const match of newModel.matchAll(sectionPattern)) {
    const listStart = newModel.indexOf("[", (match.index ?? 0) + match[0].length);
    if (listStart < 0) continue;
    const models = extractBalanced(newModel, listStart, "[", "]");
    if (models) sections.push({ name: match[1], models });
  }

  const prices: OfficialPriceRecord[] = [];
  for (const section of sections) {
    const grouped = new Map<
      string,
      { input: number | null; output: number | null; cache: number | null; context: number | null; tiers: Array<Record<string, unknown>> }
    >();
    let currentModel = "";
    for (const row of topLevelObjects(section.models)) {
      currentModel = jsStringProperty(row, "name") || currentModel;
      if (!currentModel) continue;
      const inputLabel = jsStringArrayProperty(row, "inPrice")[0] ?? "";
      const outputLabel = jsStringArrayProperty(row, "outPrice")[0] ?? "";
      const cacheLabel = jsStringArrayProperty(row, "hit")[0] ?? "";
      const range = jsStringArrayProperty(row, "upDownText").join(" · ");
      const tier = {
        name: range || "默认",
        input_price: money(inputLabel),
        output_price: money(outputLabel),
        cache_read_price: money(cacheLabel),
      };
      const current = grouped.get(currentModel);
      if (current) {
        current.tiers.push(tier);
        const tierContext = contextTokens(range);
        if (tierContext !== null) {
          current.context = Math.max(current.context ?? 0, tierContext);
        }
      }
      else {
        grouped.set(currentModel, {
          input: tier.input_price,
          output: tier.output_price,
          cache: tier.cache_read_price,
          context: contextTokens(range),
          tiers: [tier],
        });
      }
    }

    const vision = section.name.includes("视觉");
    for (const [modelName, values] of grouped) {
      const isFree = values.input === 0 && values.output === 0;
      const modelId = modelName.toLowerCase();
      prices.push(
        priceRecord({
          provider_id: "zhipu",
          model_id: modelId,
          canonical_id: `zhipuai/${modelId}`,
          name: modelName,
          unit: "per_million_tokens",
          input_price: values.input,
          output_price: values.output,
          cache_read_price: values.cache,
          cache_write_price: null,
          price_status: isFree ? "free" : "priced",
          context_window: values.context,
          source_url: sourceUrl,
          note:
            values.tiers.length > 1
              ? "智谱官网实时价；主价为首档，其他上下文阶梯见明细。"
              : "智谱官网实时按量 API 价格。",
          tiers: values.tiers,
          model_type: "chat",
          input_modalities: vision ? ["text", "image", "video", "pdf"] : ["text"],
          output_modalities: ["text"],
        }),
      );
    }
  }

  const embeddingPriceMatch = embeddingMarkdown.match(
    /title="价格"[\s\S]*?(\d+(?:\.\d+)?)\s*元\s*\/\s*百万\s*Tokens/i,
  );
  if (!embeddingPriceMatch) throw new Error("未找到 Embedding-3 官网价格");
  const embeddingPrice = Number(embeddingPriceMatch[1]);
  prices.push(
    priceRecord({
      provider_id: "zhipu",
      model_id: "embedding-3",
      canonical_id: "zhipuai/embedding-3",
      name: "Embedding-3",
      unit: "per_million_tokens",
      input_price: embeddingPrice,
      output_price: null,
      cache_read_price: null,
      cache_write_price: null,
      price_status: "priced",
      price_display: `¥${embeddingPrice} / 百万输入 Token`,
      context_window: 8192,
      source_url: embeddingSourceUrl,
      note: "智谱官网实时文本向量 API 价格。",
      tiers: [],
      model_type: "embedding",
      input_modalities: ["text"],
      output_modalities: ["embedding"],
    }),
  );

  const knowledgeRows = markdownRows(knowledgeMarkdown);
  const managedRetrievalModels = [
    {
      modelId: "embedding-3-pro",
      sourceName: "Embedding-3-pro",
      name: "Embedding-3-Pro",
      modelType: "embedding",
      contextWindow: null,
      inputModalities: ["text"],
      outputModalities: ["embedding"],
      note: "智谱知识库官网实时向量化价格；这是知识库托管模型，不等同于独立 Embeddings 端点。",
    },
    {
      modelId: "embedding-multimodal",
      sourceName: "Embedding-Multimodal",
      name: "Embedding-Multimodal",
      modelType: "multimodal_embedding",
      contextWindow: null,
      inputModalities: ["text", "image", "audio", "video"],
      outputModalities: ["embedding"],
      note: "智谱全模态知识库官网实时向量化价格；这是知识库托管模型。",
    },
    {
      modelId: "glm-rerank-pro",
      sourceName: "GLM-rerank-pro",
      name: "GLM-Rerank-Pro",
      modelType: "rerank",
      contextWindow: 4096,
      inputModalities: ["text"],
      outputModalities: ["score"],
      note: "智谱知识库官网实时重排价格；这是知识库托管模型，不等同于独立 Rerank 端点。",
    },
    {
      modelId: "glm-rerank",
      sourceName: "GLM-rerank",
      name: "GLM-Rerank",
      modelType: "rerank",
      contextWindow: 4096,
      inputModalities: ["text"],
      outputModalities: ["score"],
      note: "智谱知识库官网实时重排价格；这是知识库托管模型，不等同于独立 Rerank 端点。",
    },
  ];
  for (const model of managedRetrievalModels) {
    const row = knowledgeRows.find((candidate) => candidate[2] === model.sourceName);
    const price = money(row?.[3]);
    if (price === null) throw new Error(`未找到 ${model.sourceName} 官网价格`);
    prices.push(
      priceRecord({
        provider_id: "zhipu",
        model_id: model.modelId,
        canonical_id: `zhipuai/${model.modelId}`,
        name: model.name,
        unit: "per_million_tokens",
        input_price: price,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        price_status: "priced",
        price_display: `¥${price} / 百万处理 Token`,
        context_window: model.contextWindow,
        source_url: knowledgeSourceUrl,
        note: model.note,
        tiers: [],
        model_type: model.modelType,
        input_modalities: model.inputModalities,
        output_modalities: model.outputModalities,
      }),
    );
  }

  if (prices.length < 10) throw new Error(`解析结果不足：${prices.length} 个模型`);
  return {
    providerId: "zhipu",
    sourceUrl,
    prices,
    snapshot: {
      pricing_html: html,
      app_url: appUrl,
      flagship_data: newModel,
      embedding_markdown: embeddingMarkdown,
      knowledge_pricing_markdown: knowledgeMarkdown,
    },
    error: null,
  };
}

async function safeFetch(
  providerId: LiveOfficialPriceResult["providerId"],
  sourceUrl: string,
  operation: () => Promise<LiveOfficialPriceResult>,
) {
  try {
    return await operation();
  } catch (error) {
    return {
      providerId,
      sourceUrl,
      prices: [],
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    } satisfies LiveOfficialPriceResult;
  }
}

export async function fetchLiveOfficialPrices() {
  return Promise.all([
    safeFetch(
      "minimax",
      "https://platform.minimaxi.com/docs/guides/pricing-paygo",
      fetchMiniMaxPrices,
    ),
    safeFetch(
      "deepseek",
      "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
      fetchDeepSeekPrices,
    ),
    safeFetch("moonshot", "https://platform.kimi.com/docs/pricing/chat", fetchKimiPrices),
    safeFetch("zhipu", "https://open.bigmodel.cn/pricing", fetchZhipuPrices),
  ]);
}
