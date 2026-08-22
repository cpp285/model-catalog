export type OfficialWeightRepository = {
  developer: string;
  organization: string;
  repositoryId: string;
  modelName: string;
  sourceUrl: string;
};

export type OfficialWeightRepositoryResult = {
  fetchedAt: string;
  repositories: OfficialWeightRepository[];
  successfulOrganizations: string[];
  errors: string[];
};

const OFFICIAL_HUGGING_FACE_ORGANIZATIONS = [
  { developer: "alibaba", organization: "Qwen" },
  { developer: "alibaba", organization: "Wan-AI" },
  { developer: "deepseek", organization: "deepseek-ai" },
  { developer: "minimax", organization: "MiniMaxAI" },
  { developer: "moonshotai", organization: "moonshotai" },
  { developer: "zhipuai", organization: "zai-org" },
  { developer: "zhipuai", organization: "THUDM" },
  { developer: "xiaomi", organization: "XiaomiMiMo" },
  { developer: "stepfun", organization: "stepfun-ai" },
  { developer: "tencent", organization: "Tencent-Hunyuan" },
  { developer: "bytedance-seed", organization: "ByteDance-Seed" },
] as const;

type HuggingFaceModel = {
  id?: unknown;
  modelId?: unknown;
};

async function fetchOrganization(
  source: (typeof OFFICIAL_HUGGING_FACE_ORGANIZATIONS)[number],
) {
  const endpoint = new URL("https://huggingface.co/api/models");
  endpoint.searchParams.set("author", source.organization);
  endpoint.searchParams.set("limit", "1000");
  endpoint.searchParams.set("sort", "lastModified");
  endpoint.searchParams.set("direction", "-1");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: { "user-agent": "local-model-catalog/0.1" },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`${source.organization}: ${response.status} ${response.statusText}`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`${source.organization}: 返回格式不是模型列表`);
  }

  return payload.flatMap((rawModel): OfficialWeightRepository[] => {
    const model = rawModel as HuggingFaceModel;
    const repositoryId =
      typeof model.id === "string"
        ? model.id
        : typeof model.modelId === "string"
          ? model.modelId
          : null;
    if (!repositoryId) return [];
    const modelName = repositoryId.split("/").at(-1) ?? repositoryId;
    return [{
      developer: source.developer,
      organization: source.organization,
      repositoryId,
      modelName,
      sourceUrl: `https://huggingface.co/${repositoryId}`,
    }];
  });
}

export async function fetchOfficialWeightRepositories(): Promise<OfficialWeightRepositoryResult> {
  const results = await Promise.allSettled(
    OFFICIAL_HUGGING_FACE_ORGANIZATIONS.map(async (source) => ({
      source,
      repositories: await fetchOrganization(source),
    })),
  );
  const repositories: OfficialWeightRepository[] = [];
  const successfulOrganizations: string[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      repositories.push(...result.value.repositories);
      successfulOrganizations.push(result.value.source.organization);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    repositories,
    successfulOrganizations,
    errors,
  };
}
