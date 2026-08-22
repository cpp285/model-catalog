"use client";

import {
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  FileAudio,
  FileImage,
  Image as ImageIcon,
  KeyRound,
  ListOrdered,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Mic,
  Music2,
  Play,
  Save,
  ScanText,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogItem } from "@/lib/catalog/types";

type WorkbenchKind =
  | "chat"
  | "image"
  | "audio"
  | "tts"
  | "asr"
  | "s2s"
  | "embedding"
  | "rerank"
  | "ocr"
  | "industry"
  | "video"
  | "three_d";

type WorkbenchInput = {
  system: string;
  primary: string;
  secondary: string;
};

type AssetState = {
  file: File;
  url: string;
};

type OutputState = {
  status: "idle" | "loading" | "ok" | "error";
  text: string;
  latencyMs?: number;
};

type RunResult = {
  uid: string;
  status: "ok" | "error";
  text: string;
  latencyMs: number;
};

const KIND_ORDER: WorkbenchKind[] = [
  "chat",
  "image",
  "tts",
  "asr",
  "s2s",
  "audio",
  "embedding",
  "rerank",
  "ocr",
  "industry",
  "video",
  "three_d",
];

const KIND_META: Record<WorkbenchKind, {
  label: string;
  english: string;
  description: string;
  outputLabel: string;
  runnable: boolean;
}> = {
  chat: {
    label: "大语言 / 多模态生成",
    english: "LLM / VLM",
    description: "同一系统提示词和问题，并行比较文本输出。",
    outputLabel: "模型回答",
    runnable: true,
  },
  image: {
    label: "图像生成",
    english: "IMAGE GENERATION",
    description: "比较提示词理解、画面质量、风格一致性和参考图遵循度。",
    outputLabel: "生成图像",
    runnable: false,
  },
  audio: {
    label: "音频 / 音乐生成",
    english: "AUDIO / MUSIC",
    description: "比较音乐结构、音质、提示词遵循和时长稳定性。",
    outputLabel: "生成音频",
    runnable: false,
  },
  tts: {
    label: "语音合成",
    english: "TTS",
    description: "用同一段文字比较音色、自然度、情绪和停顿控制。",
    outputLabel: "合成语音",
    runnable: false,
  },
  asr: {
    label: "语音识别",
    english: "ASR",
    description: "录音或上传同一段音频，比较转写准确率、标点和延迟。",
    outputLabel: "转写结果",
    runnable: false,
  },
  s2s: {
    label: "语音对话",
    english: "SPEECH TO SPEECH",
    description: "用同一段语音比较理解、响应内容和端到端延迟。",
    outputLabel: "语音回复",
    runnable: false,
  },
  embedding: {
    label: "向量模型",
    english: "EMBEDDING",
    description: "以查询和候选文本测试余弦相似度、Top-K 召回与向量维度。",
    outputLabel: "向量与相似度",
    runnable: false,
  },
  rerank: {
    label: "排序模型",
    english: "RERANK",
    description: "输入同一查询和候选文档，比较排序结果、相关性分数和延迟。",
    outputLabel: "重排结果",
    runnable: false,
  },
  ocr: {
    label: "文字识别",
    english: "OCR",
    description: "上传同一图片或 PDF，比较文字、表格和版面还原能力。",
    outputLabel: "识别结果",
    runnable: false,
  },
  industry: {
    label: "行业模型",
    english: "INDUSTRY MODEL",
    description: "先按文本任务测试专业知识、术语和输出约束。",
    outputLabel: "模型回答",
    runnable: true,
  },
  video: {
    label: "视频生成",
    english: "VIDEO GENERATION",
    description: "已支持选型和编组；视频评测参数与结果播放器稍后建设。",
    outputLabel: "视频结果",
    runnable: false,
  },
  three_d: {
    label: "3D 生成",
    english: "3D GENERATION",
    description: "已支持选型和编组；3D 预览和几何质量评测稍后建设。",
    outputLabel: "3D 结果",
    runnable: false,
  },
};

function kindForModel(modelType: string): WorkbenchKind {
  if (modelType === "image_generation") return "image";
  if (modelType === "video_generation") return "video";
  if (modelType === "three_d_generation") return "three_d";
  if (modelType === "text_to_speech") return "tts";
  if (modelType === "speech_to_text") return "asr";
  if (modelType === "speech_to_speech") return "s2s";
  if (modelType === "audio_generation" || modelType === "music_generation") return "audio";
  if (modelType === "embedding" || modelType === "multimodal_embedding") return "embedding";
  if (modelType === "rerank") return "rerank";
  if (modelType === "ocr") return "ocr";
  if (modelType === "industry") return "industry";
  return "chat";
}

function kindIcon(kind: WorkbenchKind) {
  if (kind === "chat" || kind === "industry") return <MessageSquareText size={17} />;
  if (kind === "image") return <ImageIcon size={17} />;
  if (kind === "video") return <Video size={17} />;
  if (kind === "three_d") return <Box size={17} />;
  if (kind === "tts") return <Volume2 size={17} />;
  if (kind === "asr" || kind === "s2s") return <Mic size={17} />;
  if (kind === "audio") return <Music2 size={17} />;
  if (kind === "rerank") return <ListOrdered size={17} />;
  return <ScanText size={17} />;
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

function FieldActions({
  value,
  onClear,
  label,
  copiedField,
  fieldId,
  onCopied,
}: {
  value: string;
  onClear: () => void;
  label: string;
  copiedField: string | null;
  fieldId: string;
  onCopied: (fieldId: string) => void;
}) {
  const copyValue = async () => {
    if (!value) return;
    await copyToClipboard(value);
    onCopied(fieldId);
  };

  return (
    <div className="field-actions" aria-label={`${label}操作`}>
      <button type="button" onClick={copyValue} disabled={!value} title={`复制${label}`}>
        {copiedField === fieldId ? <Check size={13} /> : <Copy size={13} />}
        <span>{copiedField === fieldId ? "已复制" : "复制"}</span>
      </button>
      <button type="button" onClick={onClear} disabled={!value} title={`清空${label}`}>
        <X size={13} />
        <span>清空</span>
      </button>
    </div>
  );
}

function EditableTextarea({
  label,
  optional,
  value,
  placeholder,
  fieldId,
  copiedField,
  onChange,
  onCopied,
  accent,
}: {
  label: string;
  optional?: boolean;
  value: string;
  placeholder: string;
  fieldId: string;
  copiedField: string | null;
  onChange: (value: string) => void;
  onCopied: (fieldId: string) => void;
  accent?: boolean;
}) {
  return (
    <label className={accent ? "editable-field textarea-field user-input-field" : "editable-field textarea-field"}>
      <span>{label} <small>{optional ? "选填" : "必填"}</small></span>
      <div className="field-control">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={6}
        />
        <FieldActions
          value={value}
          onClear={() => onChange("")}
          label={label}
          fieldId={fieldId}
          copiedField={copiedField}
          onCopied={onCopied}
        />
      </div>
    </label>
  );
}

export function Workbench({
  models,
  onBack,
  onRemove,
}: {
  models: CatalogItem[];
  onBack: () => void;
  onRemove: (uid: string) => void;
}) {
  const [requestedKind, setRequestedKind] = useState<WorkbenchKind>("chat");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [apiModelIds, setApiModelIds] = useState<Record<string, string>>({});
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, boolean>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [inputs, setInputs] = useState<Partial<Record<WorkbenchKind, WorkbenchInput>>>({});
  const [assets, setAssets] = useState<Partial<Record<WorkbenchKind, AssetState>>>({});
  const [outputs, setOutputs] = useState<Record<string, OutputState>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const modelGroups = useMemo(() => {
    const groups = new Map<WorkbenchKind, CatalogItem[]>();
    models.forEach((model) => {
      const kind = kindForModel(model.modelType);
      groups.set(kind, [...(groups.get(kind) ?? []), model]);
    });
    return groups;
  }, [models]);
  const availableKinds = KIND_ORDER.filter((kind) => modelGroups.has(kind));
  const activeKind = availableKinds.includes(requestedKind)
    ? requestedKind
    : availableKinds[0] ?? "chat";
  const activeModels = modelGroups.get(activeKind) ?? [];
  const meta = KIND_META[activeKind];
  const activeInput = inputs[activeKind] ?? { system: "", primary: "", secondary: "" };
  const activeAsset = assets[activeKind];

  useEffect(() => {
    if (!models.length) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    models.forEach((model) => params.append("uid", model.uid));
    fetch(`/api/workbench/credentials?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((body: { configured?: Record<string, boolean> }) => {
        if (body.configured) setConfiguredKeys((current) => ({ ...current, ...body.configured }));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMediaError("暂时无法读取本机保存的 API Key 状态。");
        }
      });
    return () => controller.abort();
  }, [models]);

  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const updateActiveInput = (patch: Partial<WorkbenchInput>) => {
    setInputs((current) => ({
      ...current,
      [activeKind]: { ...activeInput, ...patch },
    }));
  };

  const configuredCount = activeModels.filter(
    (model) => configuredKeys[model.uid] || Boolean(apiKeys[model.uid]?.trim()),
  ).length;

  const saveCredential = async (uid: string) => {
    const apiKey = apiKeys[uid]?.trim();
    if (!apiKey || savingKeys[uid]) return;
    setSavingKeys((current) => ({ ...current, [uid]: true }));
    try {
      const response = await fetch("/api/workbench/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, apiKey }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "保存失败");
      setConfiguredKeys((current) => ({ ...current, [uid]: true }));
      setApiKeys((current) => ({ ...current, [uid]: "" }));
      setVisibleKeys((current) => ({ ...current, [uid]: false }));
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "API Key 保存失败。");
    } finally {
      setSavingKeys((current) => ({ ...current, [uid]: false }));
    }
  };

  const copyCredential = async (uid: string) => {
    try {
      let apiKey = apiKeys[uid]?.trim();
      if (!apiKey && configuredKeys[uid]) {
        const response = await fetch("/api/workbench/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid }),
        });
        const body = (await response.json()) as { apiKey?: string; error?: string };
        if (!response.ok || !body.apiKey) throw new Error(body.error ?? "读取失败");
        apiKey = body.apiKey;
      }
      if (!apiKey) return;
      await copyToClipboard(apiKey);
      setCopiedField(`api-key-${uid}`);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "API Key 复制失败。");
    }
  };

  const clearCredential = async (uid: string) => {
    setApiKeys((current) => ({ ...current, [uid]: "" }));
    if (!configuredKeys[uid]) return;
    try {
      await fetch("/api/workbench/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      setConfiguredKeys((current) => ({ ...current, [uid]: false }));
    } catch {
      setMediaError("删除本机 API Key 失败，请稍后重试。");
    }
  };

  const setAsset = (kind: WorkbenchKind, file: File) => {
    const current = assets[kind];
    if (current) URL.revokeObjectURL(current.url);
    setAssets((value) => ({ ...value, [kind]: { file, url: URL.createObjectURL(file) } }));
    setMediaError(null);
  };

  const clearAsset = () => {
    if (activeAsset) URL.revokeObjectURL(activeAsset.url);
    setAssets((current) => ({ ...current, [activeKind]: undefined }));
  };

  const startRecording = async () => {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const recordingKind = activeKind;
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setAsset(recordingKind, new File([blob], `recording-${Date.now()}.webm`, { type: blob.type }));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
    } catch {
      setMediaError("无法使用麦克风，请检查浏览器的麦克风权限，也可以直接上传音频文件。");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const clearOutput = (uid: string) => {
    setOutputs((current) => ({ ...current, [uid]: { status: "idle", text: "" } }));
  };

  const runComparison = async () => {
    if (!activeInput.primary.trim() || running || !activeModels.length || !meta.runnable) return;
    const nextOutputs: Record<string, OutputState> = {};
    activeModels.forEach((model) => {
      const hasKey = configuredKeys[model.uid] || Boolean(apiKeys[model.uid]?.trim());
      nextOutputs[model.uid] = hasKey
        ? { status: "loading", text: "正在等待模型响应…" }
        : { status: "error", text: "请先填写并保存这个模型的 API Key。" };
    });
    setOutputs((current) => ({ ...current, ...nextOutputs }));

    const runnableModels = activeModels.filter(
      (model) =>
        (configuredKeys[model.uid] || apiKeys[model.uid]?.trim()) &&
        (apiModelIds[model.uid] ?? model.apiModelId).trim(),
    );
    if (!runnableModels.length) return;

    await Promise.all(runnableModels.map((model) => saveCredential(model.uid)));
    setRunning(true);
    try {
      const response = await fetch("/api/workbench/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: activeInput.system,
          userInput: activeInput.primary,
          models: runnableModels.map((model) => ({
            uid: model.uid,
            name: model.name,
            developer: model.developer,
            apiModelId: (apiModelIds[model.uid] ?? model.apiModelId).trim(),
            apiKey: apiKeys[model.uid]?.trim() || undefined,
          })),
        }),
      });
      const body = (await response.json()) as { results?: RunResult[]; error?: string };
      if (!response.ok || !body.results) throw new Error(body.error ?? `调用失败（${response.status}）`);
      setOutputs((current) => {
        const updated = { ...current };
        body.results?.forEach((result) => {
          updated[result.uid] = {
            status: result.status,
            text: result.text,
            latencyMs: result.latencyMs,
          };
        });
        return updated;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作台调用失败";
      setOutputs((current) => {
        const updated = { ...current };
        runnableModels.forEach((model) => {
          updated[model.uid] = { status: "error", text: message };
        });
        return updated;
      });
    } finally {
      setRunning(false);
    }
  };

  const renderAssetInput = (accept: string, imagePreview = false) => (
    <div className="asset-input-panel">
      <div className="asset-dropzone">
        <div>{imagePreview ? <FileImage size={25} /> : <FileAudio size={25} />}</div>
        <strong>{activeAsset ? activeAsset.file.name : imagePreview ? "上传参考图片或待识别文件" : "上传测试音频"}</strong>
        <span>{activeAsset ? `${(activeAsset.file.size / 1024 / 1024).toFixed(2)} MB` : "文件只在当前工作台中使用"}</span>
        <label className="button button-source asset-upload-button">
          <Upload size={14} /> 选择文件
          <input
            type="file"
            accept={accept}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setAsset(activeKind, file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {activeAsset && (
        <div className="asset-preview">
          {imagePreview && activeAsset.file.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeAsset.url} alt="测试文件预览" />
          ) : !imagePreview ? (
            <audio src={activeAsset.url} controls />
          ) : (
            <div className="pdf-preview"><ScanText size={28} /><span>PDF 已就绪</span></div>
          )}
          <div className="field-actions" aria-label="测试文件操作">
            <button
              type="button"
              onClick={async () => {
                await copyToClipboard(activeAsset.file.name);
                setCopiedField(`asset-${activeKind}`);
              }}
            >
              {copiedField === `asset-${activeKind}` ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedField === `asset-${activeKind}` ? "已复制" : "复制文件名"}</span>
            </button>
            <button type="button" onClick={clearAsset}><X size={13} /><span>清空</span></button>
          </div>
        </div>
      )}
    </div>
  );

  const renderComposer = () => {
    if (activeKind === "video" || activeKind === "three_d") {
      return (
        <div className="deferred-workbench">
          {activeKind === "video" ? <Video size={31} /> : <Box size={31} />}
          <strong>{meta.label}工作台暂缓建设</strong>
          <p>{meta.description} 当前已经可以选择模型、保存密钥和完成模型编组。</p>
        </div>
      );
    }

    if (activeKind === "asr" || activeKind === "s2s") {
      return (
        <>
          <div className="media-capture-column">
            {renderAssetInput("audio/*")}
            <div className={recording ? "microphone-card is-recording" : "microphone-card"}>
              <div className="mic-pulse"><Mic size={21} /></div>
              <div><strong>{recording ? "正在录音…" : "直接使用麦克风"}</strong><span>录制完成后会作为所有模型的共同输入</span></div>
              <button className="button button-primary" type="button" onClick={recording ? stopRecording : startRecording}>
                {recording ? <Square size={14} /> : <Mic size={14} />}{recording ? "停止录音" : "开始录音"}
              </button>
            </div>
          </div>
          <div className="composer-fields vertical-fields">
            <EditableTextarea
              label={activeKind === "asr" ? "热词 / 上下文" : "对话指令"}
              optional
              value={activeInput.primary}
              placeholder={activeKind === "asr" ? "填写人名、产品名等需要优先识别的词…" : "例如：用简洁、自然的中文语音回答。"}
              fieldId={`${activeKind}-primary`}
              copiedField={copiedField}
              onChange={(primary) => updateActiveInput({ primary })}
              onCopied={setCopiedField}
              accent
            />
            <EditableTextarea
              label="参考文本"
              optional
              value={activeInput.secondary}
              placeholder="选填人工参考文本，后续用于计算字错率 / 词错率。"
              fieldId={`${activeKind}-secondary`}
              copiedField={copiedField}
              onChange={(secondary) => updateActiveInput({ secondary })}
              onCopied={setCopiedField}
            />
          </div>
        </>
      );
    }

    if (activeKind === "ocr") {
      return (
        <>
          <div className="media-capture-column">{renderAssetInput("image/*,.pdf", true)}</div>
          <div className="composer-fields vertical-fields">
            <EditableTextarea label="识别要求" optional value={activeInput.primary} placeholder="例如：保留表格结构，并按 Markdown 输出。" fieldId="ocr-primary" copiedField={copiedField} onChange={(primary) => updateActiveInput({ primary })} onCopied={setCopiedField} accent />
            <EditableTextarea label="参考文本" optional value={activeInput.secondary} placeholder="选填人工校对文本，后续用于计算识别准确率。" fieldId="ocr-secondary" copiedField={copiedField} onChange={(secondary) => updateActiveInput({ secondary })} onCopied={setCopiedField} />
          </div>
        </>
      );
    }

    if (activeKind === "image") {
      return (
        <>
          <div className="media-capture-column">{renderAssetInput("image/*", true)}</div>
          <div className="composer-fields vertical-fields">
            <EditableTextarea label="共同画面提示词" value={activeInput.primary} placeholder="描述主体、场景、镜头、光线、风格和画幅…" fieldId="image-primary" copiedField={copiedField} onChange={(primary) => updateActiveInput({ primary })} onCopied={setCopiedField} accent />
            <EditableTextarea label="负面提示词" optional value={activeInput.secondary} placeholder="填写不希望出现在画面中的内容…" fieldId="image-secondary" copiedField={copiedField} onChange={(secondary) => updateActiveInput({ secondary })} onCopied={setCopiedField} />
          </div>
        </>
      );
    }

    const labels: Record<Exclude<WorkbenchKind, "asr" | "s2s" | "ocr" | "image" | "video" | "three_d">, {
      primary: string;
      primaryPlaceholder: string;
      secondary: string;
      secondaryPlaceholder: string;
      system?: string;
    }> = {
      chat: { primary: "共同输入", primaryPlaceholder: "输入本轮要同时测试的同一个问题…", secondary: "补充约束", secondaryPlaceholder: "选填格式、长度或必须覆盖的要点…", system: "系统提示词" },
      industry: { primary: "行业问题", primaryPlaceholder: "输入专业任务、案例或行业问题…", secondary: "评分要点", secondaryPlaceholder: "填写必须命中的术语、事实或合规要求…", system: "角色与行业约束" },
      audio: { primary: "音频 / 音乐提示词", primaryPlaceholder: "描述曲风、情绪、乐器、速度和时长…", secondary: "歌词 / 结构", secondaryPlaceholder: "选填歌词、段落结构或时间轴要求…" },
      tts: { primary: "共同朗读文本", primaryPlaceholder: "输入所有模型需要朗读的同一段文字…", secondary: "音色与情绪要求", secondaryPlaceholder: "例如：成熟女声、平静、语速 0.9、重点词加重…" },
      embedding: { primary: "查询文本", primaryPlaceholder: "输入要进行语义检索的 Query…", secondary: "候选文本集", secondaryPlaceholder: "每行一条候选文本；建议同时包含强相关、弱相关和不相关样本。" },
      rerank: { primary: "查询文本", primaryPlaceholder: "输入需要重排的 Query…", secondary: "候选文档集", secondaryPlaceholder: "每段一条候选文档，可用空行或 --- 分隔。" },
    };
    const label = labels[activeKind as keyof typeof labels];
    return (
      <>
        {label.system && (
          <EditableTextarea label={label.system} optional value={activeInput.system} placeholder="填写角色、语气、边界和输出格式…" fieldId={`${activeKind}-system`} copiedField={copiedField} onChange={(system) => updateActiveInput({ system })} onCopied={setCopiedField} />
        )}
        <EditableTextarea label={label.primary} value={activeInput.primary} placeholder={label.primaryPlaceholder} fieldId={`${activeKind}-primary`} copiedField={copiedField} onChange={(primary) => updateActiveInput({ primary })} onCopied={setCopiedField} accent />
        <EditableTextarea label={label.secondary} optional value={activeInput.secondary} placeholder={label.secondaryPlaceholder} fieldId={`${activeKind}-secondary`} copiedField={copiedField} onChange={(secondary) => updateActiveInput({ secondary })} onCopied={setCopiedField} />
      </>
    );
  };

  if (!models.length) {
    return (
      <section className="workbench-empty">
        <div className="workbench-empty-icon"><Clipboard size={28} /></div>
        <span className="eyebrow">COMPARISON WORKBENCH</span>
        <h2>工作台还没有模型</h2>
        <p>先回到模型库，勾选任意类型的模型，再点击“一键导入工作台”。</p>
        <button className="button button-primary" type="button" onClick={onBack}>
          <ArrowLeft size={15} /> 返回模型库选择
        </button>
      </section>
    );
  }

  return (
    <div className="workbench-shell">
      <section className="workbench-modebar">
        <div className="modebar-copy">
          <span className="eyebrow">TEST TYPE</span>
          <strong>{kindIcon(activeKind)} {meta.label}</strong>
          <p>{meta.description}</p>
        </div>
        <label className="workbench-kind-select">
          <span>选择本次评测类型</span>
          <div>
            <select value={activeKind} onChange={(event) => setRequestedKind(event.target.value as WorkbenchKind)}>
              {availableKinds.map((kind) => (
                <option value={kind} key={kind}>
                  {KIND_META[kind].label}（{modelGroups.get(kind)?.length ?? 0}）
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </div>
        </label>
        <div className="kind-summary">
          <strong>{activeModels.length}</strong><span>个当前模型</span>
          <i />
          <strong>{availableKinds.length}</strong><span>种评测类型</span>
        </div>
      </section>

      {mediaError && <div className="workbench-notice"><X size={14} /><span>{mediaError}</span><button type="button" onClick={() => setMediaError(null)}>关闭</button></div>}

      <section className="workbench-credentials">
        <div className="workbench-section-head">
          <div>
            <span className="eyebrow">01 / MODEL CONNECTIONS</span>
            <h2>{meta.label}模型与密钥</h2>
            <p>这里只显示当前评测类型的模型；切换类型不会丢失其他模型。</p>
          </div>
          <span className="configured-count"><KeyRound size={13} /> 已配置 {configuredCount} / {activeModels.length}</span>
        </div>

        <div className="credential-table" role="list">
          {activeModels.map((model, index) => {
            const hasStoredKey = Boolean(configuredKeys[model.uid]);
            const typedKey = apiKeys[model.uid] ?? "";
            return (
              <article className="credential-row" key={model.uid} role="listitem">
                <div className="credential-model">
                  <span className="credential-index">{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{model.name}</strong><span>{model.developer} · {model.provider || "官方接口"}</span></div>
                  <button className="remove-model" type="button" onClick={() => onRemove(model.uid)} title={`从工作台移除 ${model.name}`} aria-label={`从工作台移除 ${model.name}`}><Trash2 size={14} /></button>
                </div>

                <label className="editable-field compact-field">
                  <span>API 模型 ID</span>
                  <div className="field-control">
                    <input value={apiModelIds[model.uid] ?? model.apiModelId} onChange={(event) => setApiModelIds((current) => ({ ...current, [model.uid]: event.target.value }))} placeholder="厂商接口使用的模型 ID" autoComplete="off" />
                    <FieldActions value={apiModelIds[model.uid] ?? model.apiModelId} onClear={() => setApiModelIds((current) => ({ ...current, [model.uid]: "" }))} label={`${model.name} API 模型 ID`} fieldId={`model-id-${model.uid}`} copiedField={copiedField} onCopied={setCopiedField} />
                  </div>
                </label>

                <label className="editable-field compact-field">
                  <span>API Key {hasStoredKey && <small className="saved-key-label"><LockKeyhole size={10} /> 已保存在本机</small>}</span>
                  <div className="field-control api-key-control">
                    <input type={visibleKeys[model.uid] ? "text" : "password"} value={typedKey} onChange={(event) => setApiKeys((current) => ({ ...current, [model.uid]: event.target.value }))} onBlur={() => saveCredential(model.uid)} placeholder={hasStoredKey ? "••••••••••••（已配置）" : "输入后自动加密保存"} autoComplete="new-password" />
                    <button className="key-visibility" type="button" onClick={() => setVisibleKeys((current) => ({ ...current, [model.uid]: !current[model.uid] }))} title={visibleKeys[model.uid] ? "隐藏 API Key" : "显示 API Key"} aria-label={visibleKeys[model.uid] ? "隐藏 API Key" : "显示 API Key"}>{visibleKeys[model.uid] ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                    <div className="secret-actions" aria-label={`${model.name} API Key操作`}>
                      <button type="button" onClick={() => copyCredential(model.uid)} disabled={!typedKey && !hasStoredKey} title="复制 API Key">{copiedField === `api-key-${model.uid}` ? <Check size={13} /> : <Copy size={13} />}<span>{copiedField === `api-key-${model.uid}` ? "已复制" : "复制"}</span></button>
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => clearCredential(model.uid)} disabled={!typedKey && !hasStoredKey} title="清空并删除 API Key"><X size={13} /><span>清空</span></button>
                      <button className="save-key" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => saveCredential(model.uid)} disabled={!typedKey || savingKeys[model.uid]} title="保存 API Key">{savingKeys[model.uid] ? <LoaderCircle className="spin" size={13} /> : <Save size={13} />}<span>保存</span></button>
                    </div>
                  </div>
                </label>
              </article>
            );
          })}
        </div>

        <div className="key-safety-note"><ShieldCheck size={15} /><span>API Key 按模型加密保存在本机；再次选择同一模型会自动复用，不在表格和页面中显示明文。</span></div>
      </section>

      <section className={`prompt-composer composer-${activeKind}`}>
        <div className="workbench-section-head">
          <div><span className="eyebrow">02 / TEST INPUT</span><h2>{meta.label}测试输入</h2><p>{meta.description}</p></div>
          {!meta.runnable && activeKind !== "video" && activeKind !== "three_d" && <span className="adapter-status">评测界面已就绪 · 厂商调用待接入</span>}
        </div>
        <div className="dynamic-composer">{renderComposer()}</div>
        {activeKind !== "video" && activeKind !== "three_d" && (
          <div className="run-row">
            <span>{meta.runnable ? (configuredCount ? `${configuredCount} 个模型会参与本轮测试` : "填写 API Key 后即可开始") : "当前先用于整理评测样本和模型配置，不会生成假结果"}</span>
            <button className="button button-primary run-button" type="button" onClick={runComparison} disabled={!meta.runnable || !activeInput.primary.trim() || running}>{running ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{running ? "正在并行生成" : meta.runnable ? "运行对比" : "调用协议待接入"}</button>
          </div>
        )}
      </section>

      <section className="output-section">
        <div className="workbench-section-head"><div><span className="eyebrow">03 / MODEL OUTPUTS</span><h2>{meta.outputLabel}</h2><p>每个模型单独保留结果；切换评测类型不会清空其他类型的内容。</p></div></div>
        <div className="output-grid">
          {activeModels.map((model, index) => {
            const output = outputs[model.uid] ?? { status: "idle", text: "" };
            return (
              <article className={`output-card is-${output.status}`} key={model.uid}>
                <header><div><span>{String(index + 1).padStart(2, "0")}</span><strong>{model.name}</strong></div>{output.latencyMs !== undefined && <small>{(output.latencyMs / 1000).toFixed(1)}s</small>}</header>
                <div className="output-body">{output.status === "loading" && <LoaderCircle className="spin" size={18} />}<p>{output.text || (meta.runnable ? `运行后，这里会显示${meta.outputLabel}。` : `${meta.label}的真实 API 调用协议尚未接入；当前不生成模拟结果。`)}</p></div>
                <FieldActions value={output.text} onClear={() => clearOutput(model.uid)} label={`${model.name} 输出`} fieldId={`output-${model.uid}`} copiedField={copiedField} onCopied={setCopiedField} />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
