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
  Layers3,
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
import { useEffect, useMemo, useState } from "react";
import type {
  CatalogItem,
  CatalogPayload,
  CatalogView,
  PriceStatus,
} from "@/lib/catalog/types";

const PAGE_SIZE = 50;

type SortKey =
  | "name"
  | "developer"
  | "contextWindow"
  | "inputPrice"
  | "releaseDate"
  | "offeringCount";

type FilterState = {
  search: string;
  developers: string[];
  providers: string[];
  sources: string[];
  countries: string[];
  priceStatuses: string[];
  modalities: string[];
  capabilities: string[];
  matchStatuses: string[];
  minContext: number;
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
  providers: [],
  sources: [],
  countries: [],
  priceStatuses: [],
  modalities: [],
  capabilities: [],
  matchStatuses: [],
  minContext: 0,
};

const CAPABILITIES = [
  { value: "reasoning", label: "推理" },
  { value: "toolCall", label: "工具调用" },
  { value: "structuredOutput", label: "结构化输出" },
  { value: "openWeights", label: "开源权重" },
  { value: "officialApi", label: "官方 API" },
];

const PRICE_STATUS_LABELS: Record<string, string> = {
  priced: "已公布",
  free: "官方免费",
  unknown: "未公布",
};

const COUNTRY_LABELS: Record<string, string> = {
  CN: "中国",
  US: "美国",
};

const MATCH_LABELS: Record<string, string> = {
  canonical: "底层模型",
  manual: "人工确认",
  exact: "精确匹配",
  heuristic: "规则匹配",
  unmatched: "待归并",
};

function formatCompact(value: number | null) {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 ? 1 : 0)}K`;
  return String(value);
}

function formatPrice(
  value: number | null,
  currency: "CNY" | "USD" | null,
  status: PriceStatus,
) {
  if (status === "free") return "免费";
  if (status === "unknown" || value === null || value === undefined) return "未公布";
  const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  if (value < 0.01) return `${symbol}${value.toFixed(4)}`;
  if (value < 1) return `${symbol}${value.toFixed(3)}`;
  return `${symbol}${value.toFixed(2)}`;
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
  options: Array<{ value: string; label: string }>;
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
            options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <label key={option.value} className="filter-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(toggleValue(selected, option.value))}
                  />
                  <span className="checkmark">{checked && <Check size={12} />}</span>
                  <span title={option.label}>{option.label}</span>
                </label>
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

function SourceBadge({ source }: { source: string }) {
  const label =
    source === "official-cn"
      ? "CN 官网"
      : source === "models.dev"
        ? "M.dev"
        : source === "openrouter"
          ? "OR"
          : "Lite";
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
  const [catalogView, setCatalogView] = useState<CatalogView>("models");
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showSources, setShowSources] = useState(false);

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
        if (raw) setSavedViews(JSON.parse(raw) as SavedView[]);
      } catch {
        setSavedViews([]);
      }
    });
  }, []);

  const updateFilters = (patch: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const facets = useMemo(() => {
    const items = payload?.items ?? [];
    return {
      developers: uniqueSorted(items.map((item) => item.developer)),
      providers: uniqueSorted(items.map((item) => item.provider)),
      sources: uniqueSorted(items.map((item) => item.source)),
      countries: uniqueSorted(items.map((item) => item.developerCountry)),
      priceStatuses: uniqueSorted(items.map((item) => item.priceStatus)),
      modalities: uniqueSorted(
        items.flatMap((item) => [...item.inputModalities, ...item.outputModalities]),
      ),
      matchStatuses: uniqueSorted(items.map((item) => item.matchStatus)),
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
        ...item.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && !searchable.includes(query)) return false;
      if (filters.developers.length && !filters.developers.includes(item.developer)) return false;
      if (filters.providers.length && (!item.provider || !filters.providers.includes(item.provider))) return false;
      if (filters.sources.length && !filters.sources.includes(item.source)) return false;
      if (
        filters.countries.length &&
        (!item.developerCountry || !filters.countries.includes(item.developerCountry))
      ) return false;
      if (filters.priceStatuses.length && !filters.priceStatuses.includes(item.priceStatus)) return false;
      if (
        filters.modalities.length &&
        !filters.modalities.some((modality) =>
          [...item.inputModalities, ...item.outputModalities].includes(modality),
        )
      ) return false;
      if (filters.matchStatuses.length && !filters.matchStatuses.includes(item.matchStatus)) return false;
      if (filters.minContext && (item.contextWindow ?? 0) < filters.minContext) return false;
      if (
        filters.capabilities.some((capability) =>
          capability === "reasoning"
            ? !item.reasoning
            : capability === "toolCall"
              ? !item.toolCall
            : capability === "structuredOutput"
                ? !item.structuredOutput
                : capability === "openWeights"
                  ? !item.openWeights
                  : !item.isOfficialApi,
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
    filters.providers.length +
    filters.sources.length +
    filters.countries.length +
    filters.priceStatuses.length +
    filters.modalities.length +
    filters.capabilities.length +
    filters.matchStatuses.length +
    Number(Boolean(filters.minContext));

  const changeSort = (next: SortKey) => {
    if (sortKey === next) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDirection(next === "name" || next === "developer" ? "asc" : "desc");
    }
  };

  const handleViewChange = (next: CatalogView) => {
    setCatalogView(next);
    setFilters(EMPTY_FILTERS);
    setSelectedItem(null);
    setPage(1);
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "同步失败");
      setPayload(await fetchCatalog(catalogView));
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
    setCatalogView(view.catalogView);
    setFilters({ ...EMPTY_FILTERS, ...view.filters });
    setPage(1);
  };

  const exportCsv = () => {
    const headers = [
      "name",
      "id",
      "developer",
      "provider",
      "family",
      "context_window",
      "max_output",
      "input_price_per_million",
      "output_price_per_million",
      "currency",
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
        item.provider,
        item.family,
        item.contextWindow,
        item.maxOutput,
        item.inputPrice,
        item.outputPrice,
        item.currency,
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

  return (
    <div className="catalog-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Model Index">
          <span>M</span><i>/</i>
        </div>
        <nav className="side-nav" aria-label="主导航">
          <button className="side-nav-item is-active" type="button" title="模型库">
            <Database size={18} />
            <span>模型库</span>
          </button>
          <button className="side-nav-item" type="button" disabled title="稍后开放">
            <Layers3 size={18} />
            <span>归并</span>
          </button>
          <button className="side-nav-item" type="button" disabled title="稍后开放">
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
            <span className="eyebrow">AI MODEL INTELLIGENCE / 01</span>
            <h1>模型索引</h1>
            <p>将模型本身与调用渠道分开管理，保留每一条来源记录。</p>
          </div>
          <div className="header-actions">
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
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={16} />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭"><X size={15} /></button>
          </div>
        )}

        <section className="metric-strip" aria-label="数据概览">
          <div className="metric-card metric-emphasis">
            <span>底层模型</span>
            <strong>{stats?.canonicalModels.toLocaleString() ?? "—"}</strong>
            <small>Models.dev 规范身份</small>
          </div>
          <div className="metric-card">
            <span>渠道记录</span>
            <strong>{stats?.activeOfferings.toLocaleString() ?? "—"}</strong>
            <small>聚合来源与官方记录全量保留</small>
          </div>
          <div className="metric-card">
            <span>服务商</span>
            <strong>{stats?.providers.toLocaleString() ?? "—"}</strong>
            <small>按渠道 ID 去重</small>
          </div>
          <button className="metric-card metric-source" type="button" onClick={() => setShowSources(true)}>
            <span>中国厂商来源</span>
            <strong>{stats?.officialChinaSources.toLocaleString() ?? "—"}</strong>
            <small>已核价 {stats?.verifiedChinaSources ?? 0} 家 · 查看来源册</small>
          </button>
          <div className="metric-card metric-warning">
            <span>待归并</span>
            <strong>{stats?.unmatchedOfferings.toLocaleString() ?? "—"}</strong>
            <small>不确定的记录不自动合并</small>
          </div>
        </section>

        <section className="catalog-workspace">
          <div className="workspace-topline">
            <div className="view-switcher" role="tablist" aria-label="目录视图">
              <button
                type="button"
                className={catalogView === "models" ? "is-active" : ""}
                onClick={() => handleViewChange("models")}
              >
                底层模型 <span>{stats?.canonicalModels ?? 0}</span>
              </button>
              <button
                type="button"
                className={catalogView === "offerings" ? "is-active" : ""}
                onClick={() => handleViewChange("offerings")}
              >
                渠道服务 <span>{stats?.activeOfferings ?? 0}</span>
              </button>
            </div>
            <div className="workspace-actions">
              {savedViews.length > 0 && (
                <details className="saved-menu">
                  <summary><Bookmark size={15} /> 已存视图 <ChevronDown size={13} /></summary>
                  <div>
                    {savedViews.map((view) => (
                      <button key={view.id} type="button" onClick={() => applySavedView(view)}>
                        <span>{view.name}</span>
                        <small>{view.catalogView === "models" ? "模型" : "渠道"}</small>
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
              options={facets.developers.map((value) => ({ value, label: value }))}
              selected={filters.developers}
              onChange={(developers) => updateFilters({ developers })}
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
            {catalogView === "offerings" && (
              <MultiFilter
                label="服务渠道"
                options={facets.providers.map((value) => ({ value, label: value }))}
                selected={filters.providers}
                onChange={(providers) => updateFilters({ providers })}
              />
            )}
            <MultiFilter
              label="模态"
              icon={<SlidersHorizontal size={14} />}
              options={facets.modalities.map((value) => ({ value, label: value }))}
              selected={filters.modalities}
              onChange={(modalities) => updateFilters({ modalities })}
            />
            <MultiFilter
              label="能力"
              options={CAPABILITIES}
              selected={filters.capabilities}
              onChange={(capabilities) => updateFilters({ capabilities })}
            />
            {catalogView === "offerings" && (
              <>
                <MultiFilter
                  label="数据来源"
                  options={facets.sources.map((value) => ({ value, label: value }))}
                  selected={filters.sources}
                  onChange={(sources) => updateFilters({ sources })}
                />
                <MultiFilter
                  label="归并状态"
                  options={facets.matchStatuses.map((value) => ({
                    value,
                    label: MATCH_LABELS[value] ?? value,
                  }))}
                  selected={filters.matchStatuses}
                  onChange={(matchStatuses) => updateFilters({ matchStatuses })}
                />
              </>
            )}
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
            <span>价格：中美厂商 API 原币价 / 1M tokens · 人民币不做汇率换算</span>
          </div>

          {loading ? (
            <LoadingState />
          ) : (
            <div className="table-wrap">
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th className="sticky-column row-number">#</th>
                    <th className="sticky-column model-column">
                      <button type="button" onClick={() => changeSort("name")}>
                        模型 <SortIcon active={sortKey === "name"} direction={sortDirection} />
                      </button>
                    </th>
                    {catalogView === "offerings" && <th>渠道</th>}
                    <th>输入 / 输出</th>
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
                    <th>输出价</th>
                    <th className="center">推理</th>
                    <th className="center">工具</th>
                    <th className="center">开源</th>
                    {catalogView === "models" ? (
                      <th>
                        <button type="button" onClick={() => changeSort("offeringCount")}>
                          渠道数 <SortIcon active={sortKey === "offeringCount"} direction={sortDirection} />
                        </button>
                      </th>
                    ) : (
                      <th>归并</th>
                    )}
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
                      <td className="sticky-column row-number">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="sticky-column model-column">
                        <div className="model-cell">
                          <div className="model-avatar">{item.developer.slice(0, 2).toUpperCase()}</div>
                          <div>
                            <strong>{item.name}</strong>
                            <span>{item.rawId}</span>
                          </div>
                        </div>
                      </td>
                      {catalogView === "offerings" && (
                        <td>
                          <div className="provider-cell">
                            <SourceBadge source={item.source} />
                            <span>{item.provider}</span>
                            {item.isOfficialApi && <span className="official-pill">官方</span>}
                          </div>
                        </td>
                      )}
                      <td>
                        <div className="modality-pair">
                          <span>{item.inputModalities.join(" + ") || "—"}</span>
                          <i>→</i>
                          <span>{item.outputModalities.join(" + ") || "—"}</span>
                        </div>
                      </td>
                      <td className="number-cell">{formatCompact(item.contextWindow)}</td>
                      <td className="number-cell price-cell">
                        {formatPrice(item.inputPrice, item.currency, item.priceStatus)}
                      </td>
                      <td className="number-cell price-cell">
                        {formatPrice(item.outputPrice, item.currency, item.priceStatus)}
                      </td>
                      <td className="center"><BooleanMark value={item.reasoning} /></td>
                      <td className="center"><BooleanMark value={item.toolCall} /></td>
                      <td className="center"><BooleanMark value={item.openWeights} /></td>
                      {catalogView === "models" ? (
                        <td><span className="count-pill">{item.offeringCount}</span></td>
                      ) : (
                        <td>
                          <span className={`match-pill match-${item.matchStatus}`}>
                            {MATCH_LABELS[item.matchStatus] ?? item.matchStatus}
                          </span>
                        </td>
                      )}
                      <td className="date-cell">{formatDate(item.releaseDate)}</td>
                    </tr>
                  ))}
                  {!visibleItems.length && (
                    <tr>
                      <td colSpan={catalogView === "models" ? 11 : 12}>
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

        <footer className="page-footer">
          <span>MODEL INDEX · LOCAL DATA WORKBENCH</span>
          <span>原始数据与人工标签隔离保存</span>
        </footer>
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
                <span className="eyebrow">{selectedItem.view === "models" ? "MODEL RECORD" : "OFFERING RECORD"}</span>
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
              <div><span>开发商</span><strong>{selectedItem.developer}</strong></div>
              <div><span>家族</span><strong>{selectedItem.family || "—"}</strong></div>
              <div><span>上下文</span><strong>{formatCompact(selectedItem.contextWindow)}</strong></div>
              <div><span>最大输出</span><strong>{formatCompact(selectedItem.maxOutput)}</strong></div>
              <div><span>输入价 / 1M</span><strong>{formatPrice(selectedItem.inputPrice, selectedItem.currency, selectedItem.priceStatus)}</strong></div>
              <div><span>输出价 / 1M</span><strong>{formatPrice(selectedItem.outputPrice, selectedItem.currency, selectedItem.priceStatus)}</strong></div>
              <div><span>渠道</span><strong>{selectedItem.provider || `${selectedItem.offeringCount} 个渠道`}</strong></div>
              <div><span>数据来源</span><strong>{selectedItem.source}</strong></div>
              <div><span>价格状态</span><strong>{PRICE_STATUS_LABELS[selectedItem.priceStatus] ?? selectedItem.priceStatus}</strong></div>
              <div><span>核验日期</span><strong>{selectedItem.verifiedAt || "—"}</strong></div>
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
            <div className="capability-list">
              <div><BooleanMark value={selectedItem.reasoning} /><span>推理能力</span></div>
              <div><BooleanMark value={selectedItem.toolCall} /><span>工具调用</span></div>
              <div><BooleanMark value={selectedItem.structuredOutput} /><span>结构化输出</span></div>
              <div><BooleanMark value={selectedItem.openWeights} /><span>开源权重</span></div>
            </div>
            {selectedItem.view === "offerings" && (
              <div className="mapping-note">
                <span>归并状态</span>
                <strong>{MATCH_LABELS[selectedItem.matchStatus] ?? selectedItem.matchStatus}</strong>
                <p>{selectedItem.canonicalId ? `已关联到 ${selectedItem.canonicalId}` : "暂未找到足够可信的底层模型，原始记录已完整保留。"}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
