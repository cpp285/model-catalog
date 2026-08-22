export type OfficialMediaPriceRecord = {
  canonicalId: string;
  modelId: string;
  name: string;
  providerId: "amazon" | "google" | "openai" | "voyage" | "xai";
  providerName: string;
  unit: "per_image" | "per_second" | "per_request" | "per_million_tokens";
  inputPrice: number | null;
  outputPrice: number | null;
  priceStatus: "priced" | "free";
  priceDisplay: string | null;
  tiers: Array<Record<string, unknown>>;
  sourceUrl: string;
  note: string;
};

export type OfficialMediaPriceResult = {
  fetchedAt: string;
  successfulProviders: string[];
  records: OfficialMediaPriceRecord[];
  errors: string[];
};

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "local-model-catalog/0.1",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function markdownPrice(markdown: string, modelId: string) {
  const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*\\$(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(image|sec)\\s*\\|`, "i"),
  );
  if (!match) throw new Error(`xAI 定价表未找到 ${modelId}`);
  return { price: Number(match[1]), unit: match[2].toLowerCase() };
}

async function fetchXaiPrices() {
  const sourceUrl = "https://docs.x.ai/developers/pricing";
  const markdown = await fetchText(`${sourceUrl}.md`);
  const image = markdownPrice(markdown, "grok-imagine-image-2.0");
  const video = markdownPrice(markdown, "grok-imagine-video-1.5");
  return [
    {
      canonicalId: "xai/grok-imagine-image-2.0",
      modelId: "grok-imagine-image-2.0",
      name: "Grok Imagine Image 2.0",
      providerId: "xai",
      providerName: "xAI",
      unit: "per_image",
      inputPrice: null,
      outputPrice: image.price,
      priceStatus: "priced",
      priceDisplay: `$${image.price.toFixed(2)} / 张`,
      tiers: [{ name: "图像生成", price: image.price, currency: "USD", unit: image.unit }],
      sourceUrl,
      note: "xAI 官网 Imagine API 实时价格。",
    },
    {
      canonicalId: "xai/grok-imagine-video-1.5",
      modelId: "grok-imagine-video-1.5",
      name: "Grok Imagine Video 1.5",
      providerId: "xai",
      providerName: "xAI",
      unit: "per_second",
      inputPrice: null,
      outputPrice: video.price,
      priceStatus: "priced",
      priceDisplay: `$${video.price.toFixed(3)} / 秒`,
      tiers: [{ name: "视频生成", price: video.price, currency: "USD", unit: video.unit }],
      sourceUrl,
      note: "xAI 官网 Imagine API 实时价格。",
    },
  ] satisfies OfficialMediaPriceRecord[];
}

function htmlText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ");
}

function googlePrices(text: string, pattern: RegExp, label: string) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Google 定价页未找到 ${label}`);
  return match.slice(1).map(Number);
}

async function fetchGooglePrices() {
  const sourceUrl = "https://ai.google.dev/gemini-api/docs/pricing";
  const text = htmlText(await fetchText(sourceUrl));
  const veo = googlePrices(
    text,
    /Veo 3\.1 Lite video with audio price \(default\).*?\$(\d+(?:\.\d+)?) \(720p\).*?\$(\d+(?:\.\d+)?) \(1080p\)/i,
    "Veo 3.1 Lite",
  );
  const veoStandard = googlePrices(
    text,
    /Veo 3\.1 standard video with audio price.*?\$(\d+(?:\.\d+)?) \(720p and 1080p\).*?\$(\d+(?:\.\d+)?) \(4k\)/i,
    "Veo 3.1",
  );
  const veoFast = googlePrices(
    text,
    /Veo 3\.1 Fast video with audio price \(default\).*?\$(\d+(?:\.\d+)?) \(720p\).*?\$(\d+(?:\.\d+)?) \(1080p\).*?\$(\d+(?:\.\d+)?) \(4k\)/i,
    "Veo 3.1 Fast",
  );
  const lyriaClip = googlePrices(
    text,
    /Lyria 3 Clip Preview \(30s\).*?\$(\d+(?:\.\d+)?) per song/i,
    "Lyria 3 Clip Preview",
  )[0];
  const lyriaPro = googlePrices(
    text,
    /Lyria 3 Pro Preview \(Full Song\).*?\$(\d+(?:\.\d+)?) per song/i,
    "Lyria 3 Pro Preview",
  )[0];
  if (!/Gemma 4.*?Input price.*?Free of charge.*?Not available/i.test(text)) {
    throw new Error("Google 定价页未找到 Gemma 4 免费层说明");
  }

  const records: OfficialMediaPriceRecord[] = [
    {
      canonicalId: "google/veo-3.1-generate-preview",
      modelId: "veo-3.1-generate-preview",
      name: "Veo 3.1 Preview",
      providerId: "google",
      providerName: "Google",
      unit: "per_second",
      inputPrice: null,
      outputPrice: veoStandard[0],
      priceStatus: "priced",
      priceDisplay: `$${veoStandard[0].toFixed(2)}/秒（720p/1080p）；$${veoStandard[1].toFixed(2)}/秒（4K）`,
      tiers: [
        { name: "720p/1080p 视频（含音频）", price: veoStandard[0], currency: "USD", unit: "per_second" },
        { name: "4K 视频（含音频）", price: veoStandard[1], currency: "USD", unit: "per_second" },
      ],
      sourceUrl,
      note: "Google Gemini Developer API 官网实时价格。",
    },
    {
      canonicalId: "google/veo-3.1-fast-generate-preview",
      modelId: "veo-3.1-fast-generate-preview",
      name: "Veo 3.1 Fast Preview",
      providerId: "google",
      providerName: "Google",
      unit: "per_second",
      inputPrice: null,
      outputPrice: veoFast[0],
      priceStatus: "priced",
      priceDisplay: `$${veoFast[0].toFixed(2)}/秒（720p）；$${veoFast[1].toFixed(2)}/秒（1080p）；$${veoFast[2].toFixed(2)}/秒（4K）`,
      tiers: [
        { name: "720p 视频（含音频）", price: veoFast[0], currency: "USD", unit: "per_second" },
        { name: "1080p 视频（含音频）", price: veoFast[1], currency: "USD", unit: "per_second" },
        { name: "4K 视频（含音频）", price: veoFast[2], currency: "USD", unit: "per_second" },
      ],
      sourceUrl,
      note: "Google Gemini Developer API 官网实时价格。",
    },
    {
      canonicalId: "google/veo-3.1-lite-generate-preview",
      modelId: "veo-3.1-lite-generate-preview",
      name: "Veo 3.1 Lite Preview",
      providerId: "google",
      providerName: "Google",
      unit: "per_second",
      inputPrice: null,
      outputPrice: veo[0],
      priceStatus: "priced",
      priceDisplay: `$${veo[0].toFixed(2)}/秒（720p）；$${veo[1].toFixed(2)}/秒（1080p）`,
      tiers: [
        { name: "720p 视频（含音频）", price: veo[0], currency: "USD", unit: "per_second" },
        { name: "1080p 视频（含音频）", price: veo[1], currency: "USD", unit: "per_second" },
      ],
      sourceUrl,
      note: "Google Gemini Developer API 官网实时价格。",
    },
    {
      canonicalId: "google/lyria-3-clip-preview",
      modelId: "lyria-3-clip-preview",
      name: "Lyria 3 Clip Preview",
      providerId: "google",
      providerName: "Google",
      unit: "per_request",
      inputPrice: null,
      outputPrice: lyriaClip,
      priceStatus: "priced",
      priceDisplay: `$${lyriaClip.toFixed(2)} / 首（30 秒）`,
      tiers: [{ name: "30 秒歌曲", price: lyriaClip, currency: "USD", unit: "per_song" }],
      sourceUrl,
      note: "Google Gemini Developer API 官网实时价格。",
    },
    {
      canonicalId: "google/lyria-3-pro-preview",
      modelId: "lyria-3-pro-preview",
      name: "Lyria 3 Pro Preview",
      providerId: "google",
      providerName: "Google",
      unit: "per_request",
      inputPrice: null,
      outputPrice: lyriaPro,
      priceStatus: "priced",
      priceDisplay: `$${lyriaPro.toFixed(2)} / 首（完整歌曲）`,
      tiers: [{ name: "完整歌曲", price: lyriaPro, currency: "USD", unit: "per_song" }],
      sourceUrl,
      note: "Google Gemini Developer API 官网实时价格。",
    },
  ];

  for (const [canonicalId, name] of [
    ["google/gemma-4-26b-a4b-it", "Gemma 4 26B A4B IT"],
    ["google/gemma-4-31b-it", "Gemma 4 31B IT"],
    ["google/gemma-4-E2B-it", "Gemma 4 E2B IT"],
    ["google/gemma-4-E4B-it", "Gemma 4 E4B IT"],
  ]) {
    records.push({
      canonicalId,
      modelId: canonicalId.split("/").at(-1) ?? canonicalId,
      name,
      providerId: "google",
      providerName: "Google",
      unit: "per_million_tokens",
      inputPrice: null,
      outputPrice: null,
      priceStatus: "free",
      priceDisplay: "免费层可用；付费层当前不可用",
      tiers: [{ name: "Gemini Developer API 免费层", price: 0, currency: "USD" }],
      sourceUrl,
      note: "Google 官网明确标注 Gemma 4 输入、输出和上下文缓存在免费层免费，付费层当前不可用。",
    });
  }
  return records;
}

type OpenAiImagePriceSet = {
  textInput: number;
  textCachedInput: number;
  textOutput: number | null;
  imageInput: number;
  imageCachedInput: number;
  imageOutput: number;
  generation: Record<"low" | "medium" | "high", number[]>;
};

function openAiImagePrices(text: string, label: string): OpenAiImagePriceSet {
  const textTokens = text.match(
    /Text tokens Per 1M tokens Input \$(\d+(?:\.\d+)?) Cached input \$(\d+(?:\.\d+)?)(?: Output \$(\d+(?:\.\d+)?))? Image tokens/i,
  );
  const imageTokens = text.match(
    /Image tokens Per 1M tokens Input \$(\d+(?:\.\d+)?) Cached input \$(\d+(?:\.\d+)?) Output \$(\d+(?:\.\d+)?)/i,
  );
  const generation = Object.fromEntries(
    (["low", "medium", "high"] as const).map((quality) => {
      const match = text.match(
        new RegExp(
          `Image generation Per image Quality ${quality} 1024x1024 \\$(\\d+(?:\\.\\d+)?) 1024x1536 \\$(\\d+(?:\\.\\d+)?) 1536x1024 \\$(\\d+(?:\\.\\d+)?)`,
          "i",
        ),
      );
      if (!match) throw new Error(`OpenAI 模型页未找到 ${label} ${quality} 图像价格`);
      return [quality, match.slice(1).map(Number)];
    }),
  ) as OpenAiImagePriceSet["generation"];
  if (!textTokens || !imageTokens) throw new Error(`OpenAI 模型页未找到 ${label} Token 价格`);
  return {
    textInput: Number(textTokens[1]),
    textCachedInput: Number(textTokens[2]),
    textOutput: textTokens[3] ? Number(textTokens[3]) : null,
    imageInput: Number(imageTokens[1]),
    imageCachedInput: Number(imageTokens[2]),
    imageOutput: Number(imageTokens[3]),
    generation,
  };
}

async function fetchOpenAiPrices() {
  const configurations = [
    {
      canonicalId: "openai/gpt-image-1.5",
      modelId: "gpt-image-1.5",
      name: "GPT-Image-1.5",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-image-1.5",
    },
    {
      canonicalId: "openai/gpt-image-1",
      modelId: "gpt-image-1",
      name: "GPT-Image-1",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-image-1",
    },
  ];
  const imageRecords = await Promise.all(
    configurations.map(async (configuration) => {
      const prices = openAiImagePrices(
        htmlText(await fetchText(configuration.sourceUrl)),
        configuration.name,
      );
      const allGenerationPrices = Object.values(prices.generation).flat();
      const minimum = Math.min(...allGenerationPrices);
      const maximum = Math.max(...allGenerationPrices);
      return {
        ...configuration,
        providerId: "openai",
        providerName: "OpenAI",
        unit: "per_image",
        inputPrice: null,
        outputPrice: minimum,
        priceStatus: "priced",
        priceDisplay: `图像 Token：输入 $${prices.imageInput}/百万、输出 $${prices.imageOutput}/百万；生成 $${minimum}–$${maximum}/张`,
        tiers: [
          { name: "文本输入", price: prices.textInput, cached_price: prices.textCachedInput, currency: "USD", unit: "per_million_tokens" },
          ...(prices.textOutput === null
            ? []
            : [{ name: "文本输出", price: prices.textOutput, currency: "USD", unit: "per_million_tokens" }]),
          { name: "图像输入", price: prices.imageInput, cached_price: prices.imageCachedInput, currency: "USD", unit: "per_million_tokens" },
          { name: "图像输出", price: prices.imageOutput, currency: "USD", unit: "per_million_tokens" },
          ...(["low", "medium", "high"] as const).flatMap((quality) =>
            ["1024x1024", "1024x1536", "1536x1024"].map((size, index) => ({
              name: `${quality} · ${size}`,
              price: prices.generation[quality][index],
              currency: "USD",
              unit: "per_image",
            })),
          ),
        ],
        note: "OpenAI Docs 模型页实时 Token 与按张生成价格。",
      } satisfies OfficialMediaPriceRecord;
    }),
  );

  const embeddingRecords = await Promise.all(
    [
      {
        canonicalId: "openai/text-embedding-3-large",
        modelId: "text-embedding-3-large",
        name: "Text Embedding 3 Large",
      },
      {
        canonicalId: "openai/text-embedding-3-small",
        modelId: "text-embedding-3-small",
        name: "Text Embedding 3 Small",
      },
    ].map(async (configuration) => {
      const sourceUrl = `https://developers.openai.com/api/docs/models/${configuration.modelId}`;
      const text = htmlText(await fetchText(sourceUrl));
      const match = text.match(/Embeddings Per 1M tokens.*?Cost \$(\d+(?:\.\d+)?)/i);
      if (!match) throw new Error(`OpenAI 模型页未找到 ${configuration.name} 向量价格`);
      const price = Number(match[1]);
      return {
        ...configuration,
        providerId: "openai",
        providerName: "OpenAI",
        unit: "per_million_tokens",
        inputPrice: price,
        outputPrice: null,
        priceStatus: "priced",
        priceDisplay: `$${price} / 百万输入 Token`,
        tiers: [{ name: "向量化输入", price, currency: "USD", unit: "per_million_tokens" }],
        sourceUrl,
        note: "OpenAI Docs 模型页实时向量 API 价格。",
      } satisfies OfficialMediaPriceRecord;
    }),
  );

  return [...imageRecords, ...embeddingRecords];
}

function voyageMillionPrice(markdown: string, modelId: string) {
  const row = markdown
    .split("\n")
    .find((line) => line.trim().startsWith("|") && line.includes(`\`${modelId}\``));
  if (!row) throw new Error(`Voyage 定价表未找到 ${modelId}`);
  const values = [...row.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  if (values.length < 2) throw new Error(`Voyage 定价表未找到 ${modelId} 百万 Token 价格`);
  return values[1];
}

async function fetchVoyagePrices() {
  const sourceUrl = "https://docs.voyageai.com/docs/pricing";
  const markdown = await fetchText(`${sourceUrl}.md`);
  const textModels = [
    ["voyage-code-4", "Voyage Code 4"],
    ["voyage-context-4", "Voyage Context 4"],
    ["voyage-4-large", "Voyage 4 Large"],
    ["voyage-4", "Voyage 4"],
    ["voyage-4-lite", "Voyage 4 Lite"],
  ] as const;
  const rerankModels = [
    ["rerank-2.5", "Voyage Rerank 2.5"],
    ["rerank-2.5-lite", "Voyage Rerank 2.5 Lite"],
  ] as const;
  const records: OfficialMediaPriceRecord[] = [];

  for (const [modelId, name] of textModels) {
    const price = voyageMillionPrice(markdown, modelId);
    records.push({
      canonicalId: `voyage/${modelId}`,
      modelId,
      name,
      providerId: "voyage",
      providerName: "Voyage AI",
      unit: "per_million_tokens",
      inputPrice: price,
      outputPrice: null,
      priceStatus: "priced",
      priceDisplay: `$${price} / 百万输入 Token`,
      tiers: [
        { name: "向量化输入", price, currency: "USD", unit: "per_million_tokens" },
        { name: "每账户免费额度", amount: 200_000_000, unit: "tokens" },
      ],
      sourceUrl,
      note: "Voyage AI 官网实时向量 API 价格；账户免费额度是用量额度，不把模型标记为免费。",
    });
  }

  for (const [modelId, name] of rerankModels) {
    const price = voyageMillionPrice(markdown, modelId);
    records.push({
      canonicalId: `voyage/${modelId}`,
      modelId,
      name,
      providerId: "voyage",
      providerName: "Voyage AI",
      unit: "per_million_tokens",
      inputPrice: price,
      outputPrice: null,
      priceStatus: "priced",
      priceDisplay: `$${price} / 百万处理 Token`,
      tiers: [
        { name: "重排序处理 Token", price, currency: "USD", unit: "per_million_tokens" },
        { name: "每账户免费额度", amount: 200_000_000, unit: "tokens" },
      ],
      sourceUrl,
      note: "Voyage AI 官网实时 Rerank API 价格；按查询与候选文档合计处理 Token 计费。",
    });
  }

  const multimodalRow = markdown
    .split("\n")
    .find(
      (line) => line.trim().startsWith("|") && line.includes("`voyage-multimodal-3.5`"),
    );
  const multimodalValues = multimodalRow
    ? [...multimodalRow.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
    : [];
  if (multimodalValues.length < 2) {
    throw new Error("Voyage 定价表未找到 voyage-multimodal-3.5 价格");
  }
  records.push({
    canonicalId: "voyage/voyage-multimodal-3.5",
    modelId: "voyage-multimodal-3.5",
    name: "Voyage Multimodal 3.5",
    providerId: "voyage",
    providerName: "Voyage AI",
    unit: "per_million_tokens",
    inputPrice: multimodalValues[0],
    outputPrice: null,
    priceStatus: "priced",
    priceDisplay: `$${multimodalValues[0]} / 百万文本 Token；$${multimodalValues[1]} / 十亿像素`,
    tiers: [
      { name: "文本输入", price: multimodalValues[0], currency: "USD", unit: "per_million_tokens" },
      { name: "图像/视频像素", price: multimodalValues[1], currency: "USD", unit: "per_billion_pixels" },
      { name: "每账户文本免费额度", amount: 200_000_000, unit: "tokens" },
      { name: "每账户像素免费额度", amount: 150_000_000_000, unit: "pixels" },
    ],
    sourceUrl,
    note: "Voyage AI 官网实时多模态向量价格；免费额度是用量额度，不把模型标记为免费。",
  });

  return records;
}

async function fetchAmazonEmbeddingPrices() {
  const sourceUrl = "https://aws.amazon.com/blogs/machine-learning/get-started-with-amazon-titan-text-embeddings-v2-a-new-state-of-the-art-embeddings-model-on-amazon-bedrock/";
  const text = htmlText(await fetchText(sourceUrl));
  const match = text.match(/Titan Text Embeddings V2[\s\S]*?Price per million tokens[\s\S]*?\$(\d+(?:\.\d+)?) per 1 million tokens/i);
  if (!match) throw new Error("AWS 官网未找到 Titan Text Embeddings V2 价格");
  const price = Number(match[1]);
  return [
    {
      canonicalId: "amazon/titan-text-embeddings-v2",
      modelId: "amazon.titan-embed-text-v2:0",
      name: "Amazon Titan Text Embeddings V2",
      providerId: "amazon",
      providerName: "Amazon Bedrock",
      unit: "per_million_tokens",
      inputPrice: price,
      outputPrice: null,
      priceStatus: "priced",
      priceDisplay: `$${price} / 百万输入 Token`,
      tiers: [{ name: "按需向量化输入", price, currency: "USD", unit: "per_million_tokens" }],
      sourceUrl,
      note: "AWS 官方 Titan V2 发布与定价页实时价格。",
    },
  ] satisfies OfficialMediaPriceRecord[];
}

export async function fetchOfficialMediaPrices(): Promise<OfficialMediaPriceResult> {
  const results = await Promise.allSettled([
    fetchXaiPrices(),
    fetchGooglePrices(),
    fetchOpenAiPrices(),
    fetchVoyagePrices(),
    fetchAmazonEmbeddingPrices(),
  ]);
  const providers = ["xai", "google", "openai", "voyage", "amazon"];
  const records: OfficialMediaPriceRecord[] = [];
  const successfulProviders: string[] = [];
  const errors: string[] = [];
  results.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      successfulProviders.push(provider);
      records.push(...result.value);
    } else {
      errors.push(`${provider}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });
  return { fetchedAt: new Date().toISOString(), successfulProviders, records, errors };
}
