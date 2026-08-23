"use client";

import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  Filter,
  LoaderCircle,
  PanelRightClose,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Workbench } from "@/components/catalog/workbench";
import type {
  CatalogItem,
  CatalogPayload,
  CatalogView,
  PriceStatus,
  SyncResult,
} from "@/lib/catalog/types";

const PAGE_SIZE = 50;

type SortKey =
  | "name"
  | "developer"
  | "contextWindow"
  | "inputPrice"
  | "releaseDate";

type FilterState = {
  search: string;
  developers: string[];
  countries: string[];
  priceStatuses: string[];
  classifications: string[];
  openness: string[];
  minContext: number;
};

type LegacyFilterState = Partial<FilterState> & {
  modelTypes?: string[];
  modalities?: string[];
  capabilities?: string[];
};

type SavedView = {
  id: string;
  name: string;
  catalogView: CatalogView;
  filters: FilterState;
};

const EMPTY_FILTERS: FilterState = {
  search: "",
  developers: [],
  countries: [],
  priceStatuses: [],
  classifications: [],
  openness: [],
  minContext: 0,
};

const OPENNESS_OPTIONS = [
  { value: "open", label: "开源（已确认开放权重）" },
  { value: "closed", label: "闭源（当前未开放权重）" },
];

const OPENNESS_VALUES = new Set(OPENNESS_OPTIONS.map((option) => option.value));

const PRICE_STATUS_LABELS: Record<string, string> = {
  priced: "已公布",
  free: "官方免费",
  unknown: "未公布",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  current: "当前在售",
  preview: "预览版",
  retired: "已下架 / 不可调用",
  superseded: "已被新版本替代",
};

const COUNTRY_LABELS: Record<string, string> = {
  CN: "中国",
  US: "美国",
};

const DEVELOPER_LABELS: Record<string, string> = {
  alibaba: "阿里巴巴（Qwen / Wan）",
  amazon: "Amazon（Nova / Titan）",
  baai: "北京智源（BAAI / BGE）",
  "bytedance-seed": "字节跳动（豆包）",
  deepseek: "深度求索（DeepSeek）",
  minimax: "MiniMax",
  moonshotai: "月之暗面（Kimi）",
  openai: "OpenAI",
  voyage: "Voyage AI",
  zhipuai: "智谱 AI（GLM）",
  xiaomi: "小米（MiMo）",
  stepfun: "阶跃星辰（Step）",
  kuaishou: "快手（可灵 Kling）",
  shengshu: "生数科技（Vidu）",
  pixverse: "爱诗科技（PixVerse）",
  tripo: "Tripo",
  happyhorse: "HappyHorse",
  hyper3d: "影眸科技（Hyper3D）",
  hitem3d: "数美万物（Hitem3D）",
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  text_generation: "文本生成（LLM）",
  multimodal_generation: "多模态生成（VLM）",
  chat: "对话生成（Chat）",
  image_generation: "图像生成（Image Generation）",
  video_generation: "视频生成（Video Generation）",
  three_d_generation: "3D 生成（3D Generation）",
  audio_generation: "音频生成（Audio Generation）",
  music_generation: "音乐生成（Music Generation）",
  text_to_speech: "语音合成（TTS）",
  speech_to_text: "语音识别（ASR）",
  speech_to_speech: "语音对话（S2S）",
  embedding: "文本向量（Embedding）",
  multimodal_embedding: "多模态向量（Multimodal Embedding）",
  rerank: "排序模型（Rerank）",
  ocr: "文字识别（OCR）",
  industry: "行业模型（Industry Model）",
};

const INPUT_MODALITY_LABELS: Record<string, string> = {
  text: "文本输入（Text）",
  image: "图像输入（Image）",
  audio: "音频输入（Audio）",
  video: "视频输入（Video）",
  pdf: "PDF 输入（PDF）",
};

const PRICE_UNIT_LABELS: Record<string, string> = {
  per_million_tokens: "/ 百万 Token",
  per_ten_thousand_characters: "/ 万字符",
  per_second: "/ 秒",
  per_image: "/ 张",
  per_request: "/ 次",
  per_voice: "/ 个音色",
  flexible: "（详见计费明细）",
};

const SPEC_LABELS: Record<string, string> = {
  embedding_dimensions: "可选向量维度",
  default_dimension: "默认向量维度",
  max_items: "单次最大条数",
  max_item_tokens: "单条最大 Token",
  max_documents: "最大文档数",
  max_images: "最大图片数",
  max_videos: "最大视频数",
};

function formatCompact(value: number | null) {
  if (value === null || value === undefined || value <= 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 ? 1 : 0)}K`;
  return String(value);
}

function formatPrice(
  value: number | null,
  currency: "CNY" | "USD" | null,
  status: PriceStatus,
  unit: string | null,
) {
  if (status === "free") return "免费";
  if (status === "unknown") return "未公布";
  if (value === null || value === undefined) return "—";
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  const suffix = unit ? (PRICE_UNIT_LABELS[unit] ?? "") : "";
  if (value < 0.01) return `${symbol}${value.toFixed(4)} ${suffix}`.trim();
  if (value < 1) return `${symbol}${value.toFixed(3)} ${suffix}`.trim();
  return `${symbol}${value.toFixed(2)} ${suffix}`.trim();
}

function pricingTierText(tier: Record<string, unknown>) {
  if (Array.isArray(tier.values)) {
    return tier.values.filter((value) => typeof value === "string").join(" · ");
  }
  return Object.values(tier)
    .filter((value): value is string | number => ["string", "number"].includes(typeof value))
    .join(" · ");
}

function formatSpec(value: unknown) {
  if (Array.isArray(value)) return value.join("、");
  return String(value ?? "—");
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function formatSyncTime(value: string | null) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function uniqueSorted(items: Array<string | null | undefined>) {
  return [...new Set(items.filter((item): item is string => Boolean(item)))].sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  );
}

function normalizeFilters(value?: LegacyFilterState): FilterState {
  const legacyClassifications = [
    ...(value?.modelTypes ?? []).map((item) => `type:${item}`),
    ...(value?.modalities ?? []).flatMap((item) =>
      item === "embedding"
        ? ["type:embedding", "type:multimodal_embedding"]
        : item === "score"
          ? ["type:rerank"]
          : INPUT_MODALITY_LABELS[item]
            ? [`modality:${item}`]
            : [],
    ),
  ];

  const legacyOpenness = value?.capabilities?.includes("openWeights") ? ["open"] : [];
  const openness = (value?.openness ?? legacyOpenness)
    .map((item) => (item === "openWeights" ? "open" : item))
    .filter((item) => OPENNESS_VALUES.has(item));

  return {
    search: value?.search ?? "",
    developers: value?.developers ?? [],
    countries: value?.countries ?? [],
    priceStatuses: value?.priceStatuses ?? [],
    classifications: uniqueSorted(
      (value?.classifications ?? legacyClassifications).flatMap((classification) =>
        classification === "type:chat"
          ? ["type:text_generation", "type:multimodal_generation"]
          : [classification],
      ),
    ),
    openness: uniqueSorted(openness),
    minContext: value?.minContext ?? 0,
  };
}

async function fetchCatalog(view: CatalogView) {
  const response = await fetch(`/api/catalog?view=${view}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`读取失败（${response.status}）`);
  return (await response.json()) as CatalogPayload;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function MultiFilter({
  label,
  icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ value: string; label: string; group?: string }>;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className="filter-menu">
      <summary className={selected.length ? "filter-trigger is-active" : "filter-trigger"}>
        {icon}
        <span>{label}</span>
        {selected.length > 0 && <b>{selected.length}</b>}
        <ChevronDown size={14} />
      </summary>
      <div className="filter-popover">
        <div className="filter-popover-head">
          <span>{label}</span>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])}>
              清空
            </button>
          )}
        </div>
        <div className="filter-options">
          {options.length ? (
            options.map((option, index) => {
              const checked = selected.includes(option.value);
              return (
                <Fragment key={option.value}>
                  {option.group && option.group !== options[index - 1]?.group && (
                    <div className="filter-option-group">{option.group}</div>
                  )}
                  <label className="filter-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onChange(toggleValue(selected, option.value))}
                    />
                    <span className="checkmark">{checked && <Check size={12} />}</span>
                    <span title={option.label}>{option.label}</span>
                  </label>
                </Fragment>
              );
            })
          ) : (
            <p className="empty-option">暂无可选项</p>
          )}
        </div>
      </div>
    </details>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return null;
  return direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function BooleanMark({ value }: { value: boolean | null }) {
  if (value === null) return <span className="boolean-mark unknown">—</span>;
  return value ? (
    <span className="boolean-mark yes"><Check size={13} /></span>
  ) : (
    <span className="boolean-mark no">×</span>
  );
}

function OpennessMark({ value }: { value: boolean | null }) {
  if (value === true) {
    return <span className="openness-mark is-open"><Check size={11} />开源</span>;
  }
  return <span className="openness-mark is-closed">闭源</span>;
}

function SourceBadge({ source }: { source: string }) {
  const label =
    source === "official-cn"
      ? "CN 官网"
      : source === "models.dev"
        ? "M.dev"
        : source === "openrouter"
          ? "OR"
          : source === "qianwen-catalog"
            ? "千问目录"
            : source === "qianwen-pricing"
              ? "千问价"
              : source === "official-us-media-live"
                ? "US 官网"
                : source === "volcengine-pricing"
                  ? "方舟价"
                  : source === "volcengine-ark"
                    ? "方舟目录"
              : source === "curated-official"
                ? "官网"
                : "目录";
  return <span className={`source-badge source-${source.replace(".", "-")}`}>{label}</span>;
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-orbit"><LoaderCircle size={28} /></div>
      <strong>正在读取本地模型库</strong>
      <span>SQLite 正在组织模型与渠道数据…</span>
    </div>
  );
}

export function CatalogApp() {
  const catalogView: CatalogView = "models";
  const [activeSection, setActiveSection] = useState<"models" | "workbench">("models");
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [workbenchModels, setWorkbenchModels] = useState<CatalogItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog(catalogView)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "无法读取模型库");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogView]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem("model-index-saved-views");
        if (raw) {
          const parsed = JSON.parse(raw) as Array<Omit<SavedView, "filters"> & { filters?: LegacyFilterState }>;
          setSavedViews(parsed.map((view) => ({ ...view, filters: normalizeFilters(view.filters) })));
        }
      } catch {
        setSavedViews([]);
      }
    });
  }, []);

  useEffect(() => {
    const closeFilterMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      document
        .querySelectorAll<HTMLDetailsElement>("details.filter-menu[open]")
        .forEach((menu) => {
          if (!menu.contains(target)) menu.open = false;
        });
    };
    const closeFilterMenusWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      document
        .querySelectorAll<HTMLDetailsElement>("details.filter-menu[open]")
        .forEach((menu) => {
          menu.open = false;
        });
    };
    document.addEventListener("pointerdown", closeFilterMenus);
    document.addEventListener("keydown", closeFilterMenusWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFilterMenus);
      document.removeEventListener("keydown", closeFilterMenusWithEscape);
    };
  }, []);

  const updateFilters = (patch: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const facets = useMemo(() => {
    const items = payload?.items ?? [];
    return {
      developers: uniqueSorted(items.map((item) => item.developer)),
      countries: uniqueSorted(items.map((item) => item.developerCountry)),
      priceStatuses: uniqueSorted(items.map((item) => item.priceStatus)),
      classifications: [
        ...uniqueSorted(items.map((item) => item.modelType)).map((value) => ({
          value: `type:${value}`,
          label: MODEL_TYPE_LABELS[value] ?? value,
          group: "任务类型",
        })),
        ...uniqueSorted(items.flatMap((item) => item.inputModalities))
          .filter((value) => Boolean(INPUT_MODALITY_LABELS[value]))
          .map((value) => ({
            value: `modality:${value}`,
            label: INPUT_MODALITY_LABELS[value] ?? value,
            group: "支持的输入模态",
          })),
      ],
    };
  }, [payload]);

  const filteredItems = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const items = (payload?.items ?? []).filter((item) => {
      const searchable = [
        item.name,
        item.rawId,
        item.developer,
        item.family,
        item.provider,
        item.description,
        item.modelType,
        ...item.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && !searchable.includes(query)) return false;
      if (filters.developers.length && !filters.developers.includes(item.developer)) return false;
      if (
        filters.countries.length &&
        (!item.developerCountry || !filters.countries.includes(item.developerCountry))
      ) return false;
      if (filters.priceStatuses.length && !filters.priceStatuses.includes(item.priceStatus)) return false;
      if (
        filters.classifications.length &&
        !filters.classifications.some((classification) => {
          const [kind, value] = classification.split(":", 2);
          return kind === "type"
            ? item.modelType === value
            : kind === "modality"
              ? item.inputModalities.includes(value)
              : false;
        })
      ) return false;
      if (filters.minContext && (item.contextWindow ?? 0) < filters.minContext) return false;
      if (
        filters.openness.length &&
        !filters.openness.some((value) =>
          value === "open"
            ? item.openWeights === true
            : value === "closed"
              ? item.openWeights !== true
              : false,
        )
      ) return false;
      return true;
    });

    return items.sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      const result =
        typeof aValue === "string"
          ? aValue.localeCompare(String(bValue), "zh-CN")
          : Number(aValue) - Number(bValue);
      return sortDirection === "asc" ? result : -result;
    });
  }, [filters, payload, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const activeFilterCount =
    filters.developers.length +
    filters.countries.length +
    filters.priceStatuses.length +
    filters.classifications.length +
    filters.openness.length +
    Number(Boolean(filters.minContext));

  const changeSort = (next: SortKey) => {
    if (sortKey === next) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDirection(next === "name" || next === "developer" ? "asc" : "desc");
    }
  };

  const toggleModelSelection = (item: CatalogItem) => {
    setError(null);
    setSelectedModelIds((current) => {
      const next = new Set(current);
      if (next.has(item.uid)) {
        next.delete(item.uid);
      } else if (next.size >= 12) {
        setError("工作台单次最多比较 12 个模型，请先取消部分选择。");
      } else {
        next.add(item.uid);
      }
      return next;
    });
  };

  const toggleVisibleModels = () => {
    const selectable = visibleItems;
    const areAllSelected = selectable.length > 0 && selectable.every((item) => selectedModelIds.has(item.uid));
    setSelectedModelIds((current) => {
      const next = new Set(current);
      if (areAllSelected) {
        selectable.forEach((item) => next.delete(item.uid));
        return next;
      }
      for (const item of selectable) {
        if (next.size >= 12) break;
        next.add(item.uid);
      }
      if (next.size >= 12 && selectable.some((item) => !next.has(item.uid))) {
        setError("已选择前 12 个模型；工作台单次最多比较 12 个。");
      }
      return next;
    });
  };

  const importToWorkbench = () => {
    if (!payload || selectedModelIds.size === 0) return;
    const selected = payload.items.filter((item) => selectedModelIds.has(item.uid));
    setWorkbenchModels(selected);
    setSelectedItem(null);
    setActiveSection("workbench");
  };

  const removeWorkbenchModel = (uid: string) => {
    setWorkbenchModels((current) => current.filter((model) => model.uid !== uid));
    setSelectedModelIds((current) => {
      const next = new Set(current);
      next.delete(uid);
      return next;
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const result = (await response.json()) as SyncResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "同步失败");
      const nextPayload = await fetchCatalog(catalogView);
      setPayload(nextPayload);
      setSyncResult(result);
      setSortKey("releaseDate");
      setSortDirection("desc");
      setPage(1);
      setSelectedItem(null);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const saveCurrentView = () => {
    const name = window.prompt("为当前筛选视图命名");
    if (!name?.trim()) return;
    const next = [
      ...savedViews,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        catalogView,
        filters,
      },
    ];
    setSavedViews(next);
    localStorage.setItem("model-index-saved-views", JSON.stringify(next));
  };

  const applySavedView = (view: SavedView) => {
    setFilters({ ...EMPTY_FILTERS, ...view.filters });
    setPage(1);
  };

  const exportCsv = () => {
    const headers = [
      "name",
      "id",
      "developer",
      "model_type",
      "provider",
      "family",
      "context_window",
      "max_output",
      "input_price_per_million",
      "output_price_per_million",
      "currency",
      "price_unit",
      "price_display",
      "price_status",
      "official_api",
      "price_source_url",
      "reasoning",
      "tool_call",
      "open_weights",
      "source",
      "match_status",
    ];
    const rows = filteredItems.map((item) =>
      [
        item.name,
        item.rawId,
        item.developer,
        item.modelType,
        item.provider,
        item.family,
        item.contextWindow,
        item.maxOutput,
        item.inputPrice,
        item.outputPrice,
        item.currency,
        item.priceUnit,
        item.priceDisplay,
        item.priceStatus,
        item.isOfficialApi,
        item.sourceUrl,
        item.reasoning,
        item.toolCall,
        item.openWeights,
        item.source,
        item.matchStatus,
      ]
        .map(csvEscape)
        .join(","),
    );
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `model-index-${catalogView}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const stats = payload?.stats;
  const liveOfficialSources = (stats?.sources ?? []).filter((source) =>
    source.id.endsWith("_live"),
  );

  return (
    <div className="catalog-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Model Index">
          <span>M</span><i>/</i><strong>Model Index</strong>
        </div>
        <nav className="side-nav" aria-label="主导航">
          <button
            className={activeSection === "models" ? "side-nav-item is-active" : "side-nav-item"}
            type="button"
            title="模型库"
            onClick={() => {
              setSelectedItem(null);
              setActiveSection("models");
            }}
          >
            <Database size={18} />
            <span>模型库</span>
          </button>
          <button
            className={activeSection === "workbench" ? "side-nav-item is-active" : "side-nav-item"}
            type="button"
            title="模型对比工作台"
            onClick={() => {
              setSelectedItem(null);
              setActiveSection("workbench");
            }}
          >
            <Sparkles size={18} />
            <span>工作台</span>
          </button>
        </nav>
        <div className="sidebar-foot">
          <span className="local-indicator"><i /> LOCAL</span>
          <small>SQLite · 本机数据</small>
        </div>
      </aside>

      <main className="catalog-main">
        <header className="catalog-header">
          <div>
            <span className="eyebrow">
              {activeSection === "models" ? "AI MODEL INTELLIGENCE / 01" : "MODEL EVALUATION / 02"}
            </span>
            <h1>{activeSection === "models" ? "模型索引" : "模型工作台"}</h1>
            <p>
              {activeSection === "models"
                ? "面向模型选型的本地资料库：生成、向量、排序与多模态模型统一筛选。"
                : "用同一套系统提示词和输入，并行比较多个模型的真实 API 输出。"}
            </p>
          </div>
          <div className="header-actions">
            {activeSection === "models" ? (
              <>
                <div className="sync-meta">
                  <span>最后同步</span>
                  <strong>{formatSyncTime(stats?.lastSyncAt ?? null)}</strong>
                </div>
                <button className="button button-source" type="button" onClick={() => setShowSources(true)}>
                  <ShieldCheck size={16} /> 厂商来源
                </button>
                <button className="button button-primary" type="button" onClick={handleSync} disabled={syncing}>
                  {syncing ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                  {syncing ? "正在同步" : "立即同步"}
                </button>
              </>
            ) : (
              <>
                <span className="workbench-header-count">{workbenchModels.length} 个模型</span>
                <button className="button button-source" type="button" onClick={() => setActiveSection("models")}>
                  <Database size={15} /> 返回模型库
                </button>
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={16} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭"><X size={15} /></button>
          </div>
        )}

        {syncResult && (
          <div className="sync-success-banner" role="status">
            <Check size={16} />
            <div>
              <strong>同步完成，模型库已按发布时间从新到旧刷新。</strong>
              <span>
                新增 {syncResult.changes.newModels} · 重新上架 {syncResult.changes.reactivatedModels} ·
                已下架模型 {syncResult.changes.retiredModels} · 停用调用记录 {syncResult.changes.retiredOfferings} ·
                改价 {syncResult.changes.priceChanges} · 规格更新 {syncResult.changes.specChanges}
              </span>
            </div>
            <button type="button" onClick={() => setSyncResult(null)} aria-label="关闭同步结果"><X size={15} /></button>
          </div>
        )}

        <div className={activeSection === "models" ? "catalog-section" : "catalog-section is-hidden"}>
        <section className="sync-policy" aria-label="立即同步规则">
          <div className="sync-policy-heading">
            <RefreshCw size={15} />
            <div>
              <strong>本地主库优先 · 外部来源只做增量</strong>
              <span>Models.dev、模型市场等只新增模型或补空字段，不覆盖本地已有资料，也不能据此判定下架。</span>
            </div>
          </div>
          <div className="sync-policy-item">
            <b>01 · 新模型</b>
            <span>只把本地不存在的模型加入主库；保存发布日期，并按发布时间从新到旧排列。</span>
          </div>
          <div className="sync-policy-item">
            <b>02 · 官网动态字段</b>
            <span>仅厂商官网可更新价格等动态字段；旧价格继续保留在本地历史，市场数据不覆盖人工资料。</span>
          </div>
          <div className="sync-policy-item">
            <b>03 · 厂商确认停用</b>
            <span>只有官方停用日期或明确状态才会移出在用列表；记录仍保留，并标记“已下架 / 不可调用”。</span>
          </div>
        </section>
        <section className="metric-strip" aria-label="数据概览">
          <div className="metric-card metric-emphasis">
            <span>底层模型</span>
            <strong>{stats?.canonicalModels.toLocaleString() ?? "—"}</strong>
            <small>在用 {stats?.activeModels ?? 0} · 已下架 {stats?.retiredModels ?? 0}</small>
          </div>
          <div className="metric-card">
            <span>官方定价模型</span>
            <strong>{stats?.officialPricedModels.toLocaleString() ?? "—"}</strong>
            <small>按官网实际计费单位记录</small>
          </div>
          <div className="metric-card">
            <span>Embedding</span>
            <strong>{stats?.embeddingModels.toLocaleString() ?? "—"}</strong>
            <small>文本与多模态向量模型</small>
          </div>
          <div className="metric-card">
            <span>Rerank</span>
            <strong>{stats?.rerankModels.toLocaleString() ?? "—"}</strong>
            <small>独立排序模型</small>
          </div>
          <button className="metric-card metric-source" type="button" onClick={() => setShowSources(true)}>
            <span>中国厂商来源</span>
            <strong>{stats?.officialChinaSources.toLocaleString() ?? "—"}</strong>
            <small>已核价 {stats?.verifiedChinaSources ?? 0} 家 · 查看来源册</small>
          </button>
        </section>

        <section className="catalog-workspace">
          <div className="workspace-topline">
            <div className="workspace-title">
              <span>MODEL LIBRARY</span>
              <strong>全部模型</strong>
              <b>{stats?.canonicalModels ?? 0}</b>
            </div>
            <div className="workspace-actions">
              {savedViews.length > 0 && (
                <details className="saved-menu">
                  <summary><Bookmark size={15} /> 已存视图 <ChevronDown size={13} /></summary>
                  <div>
                    {savedViews.map((view) => (
                      <button key={view.id} type="button" onClick={() => applySavedView(view)}>
                        <span>{view.name}</span>
                        <small>模型</small>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <button className="button button-quiet" type="button" onClick={saveCurrentView}>
                <Bookmark size={15} /> 保存视图
              </button>
              <button className="button button-quiet" type="button" onClick={exportCsv} disabled={!filteredItems.length}>
                <Download size={15} /> 导出
              </button>
            </div>
          </div>

          <div className="filter-toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                value={filters.search}
                onChange={(event) => updateFilters({ search: event.target.value })}
                placeholder="搜索模型、ID、家族或标签…"
              />
              {filters.search && (
                <button type="button" onClick={() => updateFilters({ search: "" })} aria-label="清空搜索">
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="filter-divider" />
            <MultiFilter
              label="开发商"
              options={facets.developers.map((value) => ({
                value,
                label: DEVELOPER_LABELS[value] ?? value,
              }))}
              selected={filters.developers}
              onChange={(developers) => updateFilters({ developers })}
            />
            <MultiFilter
              label="模型分类"
              icon={<SlidersHorizontal size={14} />}
              options={facets.classifications}
              selected={filters.classifications}
              onChange={(classifications) => updateFilters({ classifications })}
            />
            <MultiFilter
              label="国家"
              options={facets.countries.map((value) => ({
                value,
                label: COUNTRY_LABELS[value] ?? value,
              }))}
              selected={filters.countries}
              onChange={(countries) => updateFilters({ countries })}
            />
            <MultiFilter
              label="价格状态"
              options={facets.priceStatuses.map((value) => ({
                value,
                label: PRICE_STATUS_LABELS[value] ?? value,
              }))}
              selected={filters.priceStatuses}
              onChange={(priceStatuses) => updateFilters({ priceStatuses })}
            />
            <MultiFilter
              label="开源情况"
              options={OPENNESS_OPTIONS}
              selected={filters.openness}
              onChange={(openness) => updateFilters({ openness })}
            />
            <details className="filter-menu">
              <summary className={filters.minContext ? "filter-trigger is-active" : "filter-trigger"}>
                <span>上下文</span>
                {filters.minContext > 0 && <b>{formatCompact(filters.minContext)}+</b>}
                <ChevronDown size={14} />
              </summary>
              <div className="filter-popover context-options">
                {[
                  [0, "不限"],
                  [32_000, "32K 以上"],
                  [128_000, "128K 以上"],
                  [200_000, "200K 以上"],
                  [1_000_000, "1M 以上"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={filters.minContext === value ? "is-selected" : ""}
                    onClick={() => updateFilters({ minContext: Number(value) })}
                  >
                    <span>{label}</span>
                    {filters.minContext === value && <Check size={13} />}
                  </button>
                ))}
              </div>
            </details>
            {activeFilterCount > 0 && (
              <button className="clear-filters" type="button" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X size={13} /> 清除 {activeFilterCount} 项
              </button>
            )}
          </div>

          <div className="result-bar">
            <span><Filter size={14} /> 筛选结果 <strong>{filteredItems.length.toLocaleString()}</strong></span>
            <span>价格按官网实际单位展示：Token、秒、张、次、字符等 · 人民币不做汇率换算</span>
          </div>

          {loading ? (
            <LoadingState />
          ) : (
            <div className="table-wrap">
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th className="sticky-column selection-cell">
                      <label className="row-selector select-all-selector" title="选择本页模型">
                        <input
                          type="checkbox"
                          checked={
                            visibleItems.length > 0 &&
                            visibleItems.every((item) => selectedModelIds.has(item.uid))
                          }
                          onChange={toggleVisibleModels}
                          aria-label="选择本页模型"
                        />
                        <span>{visibleItems.some((item) => selectedModelIds.has(item.uid)) && <Check size={12} />}</span>
                      </label>
                    </th>
                    <th className="sticky-column row-number">#</th>
                    <th className="sticky-column model-column">
                      <button type="button" onClick={() => changeSort("name")}>
                        模型 <SortIcon active={sortKey === "name"} direction={sortDirection} />
                      </button>
                    </th>
                    <th>类型 / 模态</th>
                    <th>
                      <button type="button" onClick={() => changeSort("contextWindow")}>
                        上下文 <SortIcon active={sortKey === "contextWindow"} direction={sortDirection} />
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => changeSort("inputPrice")}>
                        输入价 <SortIcon active={sortKey === "inputPrice"} direction={sortDirection} />
                      </button>
                    </th>
                    <th>输出 / 调用价</th>
                    <th className="center">推理</th>
                    <th className="center">工具</th>
                    <th className="center">开放性</th>
                    <th>价格来源</th>
                    <th>
                      <button type="button" onClick={() => changeSort("releaseDate")}>
                        发布 <SortIcon active={sortKey === "releaseDate"} direction={sortDirection} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item, index) => (
                    <tr key={item.uid} onClick={() => setSelectedItem(item)}>
                      <td className="sticky-column selection-cell" onClick={(event) => event.stopPropagation()}>
                        <label
                          className="row-selector"
                          title={`选择 ${item.name}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedModelIds.has(item.uid)}
                            onChange={() => toggleModelSelection(item)}
                            aria-label={`选择 ${item.name}`}
                          />
                          <span>{selectedModelIds.has(item.uid) && <Check size={12} />}</span>
                        </label>
                      </td>
                      <td className="sticky-column row-number">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="sticky-column model-column">
                        <div className="model-cell">
                          <div className="model-avatar">{item.developer.slice(0, 2).toUpperCase()}</div>
                          <div>
                            <div className="model-name-line">
                              <strong>{item.name}</strong>
                              {!item.callable && <b className="retired-pill">已下架</b>}
                            </div>
                            <span>{item.rawId}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="type-modality-cell">
                          <span className={`model-type-pill type-${item.modelType}`}>
                            {MODEL_TYPE_LABELS[item.modelType] ?? item.modelType}
                          </span>
                          <div className="modality-pair">
                            <span className="modality-group" aria-label={`输入模态：${item.inputModalities.join("、") || "无"}`}>
                              {item.inputModalities.length > 0
                                ? item.inputModalities.map((modality) => (
                                  <span
                                    className={`modality-chip modality-${modality.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                    key={`${item.uid}-input-${modality}`}
                                  >
                                    {modality}
                                  </span>
                                ))
                                : <span className="modality-empty">—</span>}
                            </span>
                            <i>→</i>
                            <span className="modality-group" aria-label={`输出模态：${item.outputModalities.join("、") || "无"}`}>
                              {item.outputModalities.length > 0
                                ? item.outputModalities.map((modality) => (
                                  <span
                                    className={`modality-chip modality-${modality.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                    key={`${item.uid}-output-${modality}`}
                                  >
                                    {modality}
                                  </span>
                                ))
                                : <span className="modality-empty">—</span>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="number-cell">{formatCompact(item.contextWindow)}</td>
                      <td className="number-cell price-cell">
                        {formatPrice(item.inputPrice, item.currency, item.priceStatus, item.priceUnit)}
                      </td>
                      <td className="number-cell price-cell">
                        {item.priceDisplay || formatPrice(item.outputPrice, item.currency, item.priceStatus, item.priceUnit)}
                      </td>
                      <td className="center"><BooleanMark value={item.reasoning} /></td>
                      <td className="center"><BooleanMark value={item.toolCall} /></td>
                      <td className="center"><OpennessMark value={item.openWeights} /></td>
                      <td>
                        <div className="provider-cell">
                          <SourceBadge source={item.source} />
                          <span>{item.provider || "暂未核价"}</span>
                          {item.isOfficialApi && <span className="official-pill">官方</span>}
                          {!item.callable && item.inputPrice !== null && <span className="history-pill">历史价</span>}
                        </div>
                      </td>
                      <td className="date-cell">{formatDate(item.releaseDate)}</td>
                    </tr>
                  ))}
                  {!visibleItems.length && (
                    <tr>
                      <td colSpan={12}>
                        <div className="no-results">
                          <Search size={24} />
                          <strong>没有找到符合条件的记录</strong>
                          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>清除全部筛选</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <footer className="table-footer">
            <span>每页 {PAGE_SIZE} 条</span>
            <div className="pagination">
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
              <span><b>{safePage}</b> / {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button>
            </div>
            <span>{filteredItems.length.toLocaleString()} 条记录</span>
          </footer>
        </section>

        {selectedModelIds.size > 0 && (
          <div className="selection-tray" role="status">
            <div>
              <span>已选择</span>
              <strong>{selectedModelIds.size}</strong>
              <small>可混选不同类型 · 工作台内按评测类型切换</small>
            </div>
            <button type="button" className="button button-quiet" onClick={() => setSelectedModelIds(new Set())}>
              <X size={14} /> 清空选择
            </button>
            <button type="button" className="button button-primary" onClick={importToWorkbench}>
              <Sparkles size={15} /> 一键导入工作台
            </button>
          </div>
        )}

        <footer className="page-footer">
          <span>MODEL INDEX · LOCAL DATA WORKBENCH</span>
          <span>原始数据与人工标签隔离保存</span>
        </footer>
        </div>
        <div className={activeSection === "workbench" ? "workbench-section" : "workbench-section is-hidden"}>
          <Workbench
            models={workbenchModels}
            onBack={() => setActiveSection("models")}
            onRemove={removeWorkbenchModel}
          />
        </div>
      </main>

      {showSources && (
        <div className="detail-backdrop" onMouseDown={() => setShowSources(false)}>
          <aside
            className="detail-panel source-panel"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="中国模型厂商来源册"
          >
            <div className="detail-head">
              <div>
                <span className="eyebrow">OFFICIAL SOURCE REGISTRY</span>
                <h2>中国厂商来源册</h2>
                <code>{payload?.providerSources.length ?? 0} 家已登记 · 不做汇率换算</code>
              </div>
              <button type="button" onClick={() => setShowSources(false)} aria-label="关闭来源册">
                <PanelRightClose size={20} />
              </button>
            </div>
            <p className="source-intro">
              只把中国大陆官方页面公开的 API 按量价写入人民币价格；没有公开价的厂商保留来源和状态，不用第三方美元价补位。
            </p>
            {liveOfficialSources.length > 0 && (
              <section className="live-source-overview" aria-label="官网实时价格同步状态">
                <div className="live-source-heading">
                  <div>
                    <strong>本次官网价格同步</strong>
                    <span>每次点击“立即同步”都会重新读取这四家官网</span>
                  </div>
                  <RefreshCw size={15} />
                </div>
                <div className="live-source-grid">
                  {liveOfficialSources.map((source) => (
                    <article
                      key={source.id}
                      className={`live-source-card is-${source.status}`}
                      title={source.error ?? undefined}
                    >
                      <div>
                        <strong>{source.name.replace("官网实时价格", "")}</strong>
                        <span>{formatSyncTime(source.lastSyncedAt)}</span>
                      </div>
                      <b>{source.status === "ok" ? "官网实时" : source.status === "error" ? "快照兜底" : "尚未同步"}</b>
                      <small>
                        {source.status === "ok"
                          ? `读取 ${source.recordCount} 条价格`
                          : source.status === "error"
                            ? `保留 ${source.recordCount} 条本地价格 · ${source.error ?? "官网暂时不可读"}`
                            : "等待第一次同步"}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="source-registry-list">
              {(payload?.providerSources ?? []).map((provider) => (
                <article key={provider.id} className="source-registry-item">
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{provider.company}</span>
                  </div>
                  <span className={`source-status status-${provider.priceStatus}`}>
                    {provider.priceStatus === "verified"
                      ? "价格已核验"
                      : provider.priceStatus === "pending"
                        ? "待核验"
                        : "未公开"}
                  </span>
                  <p>{provider.notes}</p>
                  <nav>
                    {provider.homepageUrl && (
                      <a href={provider.homepageUrl} target="_blank" rel="noreferrer">
                        官方网站 <ExternalLink size={11} />
                      </a>
                    )}
                    {provider.pricingUrl && (
                      <a href={provider.pricingUrl} target="_blank" rel="noreferrer">
                        计费页面 <ExternalLink size={11} />
                      </a>
                    )}
                    {provider.verifiedAt && <span>核验 {provider.verifiedAt}</span>}
                  </nav>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}

      {selectedItem && (
        <div className="detail-backdrop" onMouseDown={() => setSelectedItem(null)}>
          <aside className="detail-panel" onMouseDown={(event) => event.stopPropagation()} aria-label="模型详情">
            <div className="detail-head">
              <div>
                <span className="eyebrow">MODEL RECORD</span>
                <h2>{selectedItem.name}</h2>
                <code>{selectedItem.rawId}</code>
              </div>
              <button type="button" onClick={() => setSelectedItem(null)} aria-label="关闭详情">
                <PanelRightClose size={20} />
              </button>
            </div>
            <p className="detail-description">{selectedItem.description || "该来源暂未提供模型描述。"}</p>
            <div className="detail-tags">
              {selectedItem.tags.map((tag) => <span key={tag}><Tag size={11} />{tag}</span>)}
            </div>
            <div className="detail-grid">
              <div><span>开发商</span><strong>{DEVELOPER_LABELS[selectedItem.developer] ?? selectedItem.developer}</strong></div>
              <div><span>家族</span><strong>{selectedItem.family || "—"}</strong></div>
              <div><span>模型类型</span><strong>{MODEL_TYPE_LABELS[selectedItem.modelType] ?? selectedItem.modelType}</strong></div>
              <div><span>计费单位</span><strong>{selectedItem.priceUnit ? (PRICE_UNIT_LABELS[selectedItem.priceUnit] ?? selectedItem.priceUnit) : "—"}</strong></div>
              <div><span>上下文</span><strong>{formatCompact(selectedItem.contextWindow)}</strong></div>
              <div><span>最大输出</span><strong>{formatCompact(selectedItem.maxOutput)}</strong></div>
              <div><span>输入价</span><strong>{formatPrice(selectedItem.inputPrice, selectedItem.currency, selectedItem.priceStatus, selectedItem.priceUnit)}</strong></div>
              <div><span>输出 / 调用价</span><strong>{selectedItem.priceDisplay || formatPrice(selectedItem.outputPrice, selectedItem.currency, selectedItem.priceStatus, selectedItem.priceUnit)}</strong></div>
              <div><span>计费摘要</span><strong>{selectedItem.priceDisplay || "—"}</strong></div>
              <div><span>数据来源</span><strong>{selectedItem.source}</strong></div>
              <div><span>价格状态</span><strong>{selectedItem.callable ? (PRICE_STATUS_LABELS[selectedItem.priceStatus] ?? selectedItem.priceStatus) : "下架前最后记录"}</strong></div>
              <div><span>核验日期</span><strong>{selectedItem.verifiedAt || "—"}</strong></div>
              <div><span>产品状态</span><strong>{LIFECYCLE_LABELS[selectedItem.lifecycleStatus] ?? selectedItem.lifecycleStatus}</strong></div>
              <div><span>归并版本</span><strong>{selectedItem.versionCount > 1 ? `${selectedItem.versionCount} 个来源版本` : "单一记录"}</strong></div>
            </div>
            {(selectedItem.priceNote || selectedItem.sourceUrl) && (
              <div className="price-evidence">
                <span>{selectedItem.isOfficialApi ? "官方 API 价格证据" : "价格说明"}</span>
                <p>{selectedItem.priceNote || "该记录保留了原始来源链接。"}</p>
                {selectedItem.sourceUrl && (
                  <a href={selectedItem.sourceUrl} target="_blank" rel="noreferrer">
                    打开来源页面 <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            {selectedItem.pricingTiers.length > 0 && (
              <div className="pricing-detail">
                <span>官网计费明细</span>
                <div>
                  {selectedItem.pricingTiers.slice(0, 12).map((tier, index) => (
                    <p key={`${selectedItem.uid}-tier-${index}`}>{pricingTierText(tier)}</p>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(selectedItem.specs).length > 0 && (
              <div className="spec-detail">
                <span>模型规格</span>
                <dl>
                  {Object.entries(selectedItem.specs)
                    .filter(([key]) => key !== "context_window")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{SPEC_LABELS[key] ?? key}</dt>
                        <dd>{formatSpec(value)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
            {selectedItem.opennessBasis && (
              <div className="price-evidence">
                <span>开源 / 闭源核验依据</span>
                <p>{selectedItem.opennessBasis}</p>
                {selectedItem.opennessSourceUrl && (
                  <a href={selectedItem.opennessSourceUrl} target="_blank" rel="noreferrer">
                    打开权重来源 <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            <div className="capability-list">
              <div><BooleanMark value={selectedItem.reasoning} /><span>推理能力</span></div>
              <div><BooleanMark value={selectedItem.toolCall} /><span>工具调用</span></div>
              <div><BooleanMark value={selectedItem.structuredOutput} /><span>结构化输出</span></div>
              <div><OpennessMark value={selectedItem.openWeights} /><span>模型开放性</span></div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
