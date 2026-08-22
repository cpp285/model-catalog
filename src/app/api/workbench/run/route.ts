import { z } from "zod";
import { getWorkbenchCredential } from "@/lib/catalog/workbench-credentials";

export const runtime = "nodejs";

const requestSchema = z.object({
  systemPrompt: z.string().max(100_000),
  userInput: z.string().trim().min(1).max(100_000),
  models: z
    .array(
      z.object({
        uid: z.string().min(1).max(300),
        name: z.string().min(1).max(300),
        developer: z.string().min(1).max(100),
        apiModelId: z.string().trim().min(1).max(300),
        apiKey: z.string().trim().min(1).max(2_000).optional(),
      }),
    )
    .min(1)
    .max(12),
});

type WorkbenchModel = z.infer<typeof requestSchema>["models"][number];
type ReadyWorkbenchModel = WorkbenchModel & { apiKey: string };

type ProviderResult = {
  text: string;
};

function extractOpenAICompatibleText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const message = choices[0] && typeof choices[0] === "object"
    ? (choices[0] as { message?: unknown }).message
    : null;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return null;
}

function extractOpenAIResponseText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const outputText = (body as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText) return outputText;
  const output = (body as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  return output
    .flatMap((item) =>
      item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content)
        ? ((item as { content: unknown[] }).content)
        : [],
    )
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

function extractAnthropicText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

function extractGoogleText(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const content = candidates[0] && typeof candidates[0] === "object"
    ? (candidates[0] as { content?: unknown }).content
    : null;
  if (!content || typeof content !== "object") return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  return parts
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

async function readError(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const body = JSON.parse(text) as {
      error?: string | { message?: string };
      message?: string;
    };
    const message = typeof body.error === "string"
      ? body.error
      : body.error?.message ?? body.message;
    return message || `${response.status} ${response.statusText}`;
  } catch {
    return text.slice(0, 500);
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`厂商接口返回 ${response.status}：${await readError(response)}`);
  }
  return response.json();
}

async function callOpenAI(
  model: ReadyWorkbenchModel,
  systemPrompt: string,
  userInput: string,
): Promise<ProviderResult> {
  const body = await requestJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.apiModelId,
      instructions: systemPrompt || undefined,
      input: userInput,
      max_output_tokens: 4096,
      store: false,
    }),
  });
  const text = extractOpenAIResponseText(body);
  if (!text) throw new Error("厂商返回成功，但没有可显示的文本内容。");
  return { text };
}

async function callAnthropic(
  model: ReadyWorkbenchModel,
  systemPrompt: string,
  userInput: string,
): Promise<ProviderResult> {
  const body = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.apiModelId,
      system: systemPrompt || undefined,
      messages: [{ role: "user", content: userInput }],
      max_tokens: 4096,
    }),
  });
  const text = extractAnthropicText(body);
  if (!text) throw new Error("厂商返回成功，但没有可显示的文本内容。");
  return { text };
}

async function callGoogle(
  model: ReadyWorkbenchModel,
  systemPrompt: string,
  userInput: string,
): Promise<ProviderResult> {
  const encodedModel = model.apiModelId
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const body = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": model.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: systemPrompt
          ? { parts: [{ text: systemPrompt }] }
          : undefined,
        contents: [{ role: "user", parts: [{ text: userInput }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    },
  );
  const text = extractGoogleText(body);
  if (!text) throw new Error("厂商返回成功，但没有可显示的文本内容。");
  return { text };
}

const compatibleEndpoints: Record<string, string> = {
  alibaba: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  minimax: "https://api.minimaxi.com/v1/chat/completions",
  moonshotai: "https://api.moonshot.cn/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  zhipuai: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
};

async function callOpenAICompatible(
  model: ReadyWorkbenchModel,
  systemPrompt: string,
  userInput: string,
): Promise<ProviderResult> {
  const endpoint = compatibleEndpoints[model.developer];
  if (!endpoint) throw new Error("暂未接入该厂商的官方调用协议。");
  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: userInput },
  ];
  const body = await requestJson(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.apiModelId,
      messages,
      max_tokens: 4096,
      stream: false,
    }),
  });
  const text = extractOpenAICompatibleText(body);
  if (!text) throw new Error("厂商返回成功，但没有可显示的文本内容。");
  return { text };
}

async function callProvider(
  model: ReadyWorkbenchModel,
  systemPrompt: string,
  userInput: string,
) {
  if (model.developer === "openai") return callOpenAI(model, systemPrompt, userInput);
  if (model.developer === "anthropic") return callAnthropic(model, systemPrompt, userInput);
  if (model.developer === "google") return callGoogle(model, systemPrompt, userInput);
  return callOpenAICompatible(model, systemPrompt, userInput);
}

export async function POST(request: Request) {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) {
    return Response.json(
      { error: "工作台输入不完整或超出限制。", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { models, systemPrompt, userInput } = parsed.data;
  const results = await Promise.all(
    models.map(async (model) => {
      const startedAt = performance.now();
      try {
        const apiKey = model.apiKey ?? getWorkbenchCredential(model.uid);
        if (!apiKey) throw new Error("请先填写并保存这个模型的 API Key。");
        const result = await callProvider({ ...model, apiKey }, systemPrompt, userInput);
        return {
          uid: model.uid,
          status: "ok" as const,
          text: result.text,
          latencyMs: Math.round(performance.now() - startedAt),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "模型调用失败。";
        return {
          uid: model.uid,
          status: "error" as const,
          text: message,
          latencyMs: Math.round(performance.now() - startedAt),
        };
      }
    }),
  );

  return Response.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
