# Model Index

A local-first AI model catalog and evaluation workbench for product managers, researchers, and engineering teams.

Model Index combines model metadata, official API pricing, lifecycle information, source evidence, filtering, comparison, and lightweight model testing in one Next.js application. The application and its SQLite database run locally; no hosted backend is required.

> The current product interface is in Simplified Chinese. This README is maintained in English.

## Why this project exists

Choosing an AI model usually requires checking several unrelated sources: vendor documentation, model marketplaces, pricing pages, routing platforms, and open-weight repositories. Those sources also describe different concepts. A base model, a versioned snapshot, and a provider offering are often incorrectly treated as the same thing.

Model Index keeps them separate and makes the data traceable:

- **Model**: the underlying model identity, developer, family, release date, modalities, context window, openness, and capabilities.
- **Offering**: a callable API product with a provider-specific model ID, currency, billing unit, price, availability, region, and source URL.
- **Evidence**: the official page or repository used to verify a field, together with the verification time.

## Highlights

- Local Next.js application with a local SQLite database
- Search, sorting, pagination, CSV export, and multi-dimensional filters
- Chinese and English model-type labels such as LLM, VLM, Embedding, Rerank, ASR, TTS, and OCR
- Separate developer and platform identities, preventing third-party marketplace models from being attributed to the marketplace owner
- Explicit open-weight and closed-weight classification with source evidence
- Model lifecycle tracking for current, superseded, preview, and retired models
- New models sorted by release date, newest first
- Pricing support for tokens, requests, images, seconds, characters, voices, pixels, and other vendor-defined units
- CNY prices taken directly from Chinese vendor pages, never converted from USD
- Missing prices shown as **Unknown**, not **Free**
- Official price history and sync-change summaries
- Select models from the catalog and send them to a comparison workbench
- Encrypted local API-key storage for the workbench

## Data policy

The catalog currently focuses on models developed in China and the United States and on public API invocation pricing.

The following rules are enforced:

1. Chinese vendor prices must come from Chinese official pages and remain in CNY.
2. US vendor prices remain in USD.
3. Exchange-rate conversion is not used as a substitute for a local official price.
4. A missing price is `unknown`; it is only marked `free` when the source explicitly says it is free.
5. Vendor APIs take priority over marketplaces and routing platforms.
6. OpenRouter and major model platforms are treated as provider offerings, not model developers.
7. Old or rarely used retrieval models are excluded when a clearly better current replacement exists.
8. The local catalog is the source of truth. Aggregators may insert missing models or fill empty fields, but they cannot overwrite existing local model metadata.
9. An aggregator removing or changing a record never retires the corresponding local model.
10. Mutable prices may be refreshed from official vendor sources. A model is retired only from an explicit official retirement status or an effective official deprecation date; historical records are preserved.

## Data sources

| Source | Purpose |
| --- | --- |
| [Models.dev](https://models.dev) | Base model metadata and US official API offerings |
| [OpenRouter](https://openrouter.ai/models) | Current routing availability and intermediary pricing |
| [Qianwen Model Market](https://www.qianwenai.com/models) | Model identity, developer attribution, modality, and availability checks |
| [Volcengine Ark](https://ark.volcengine.com/region:cn-beijing/model?view=CARD_VIEW&preset=ModelGroups) | Model identity, vendor attribution, modality, context, and official Volcengine pricing |
| [Alibaba Cloud Model Studio](https://help.aliyun.com/zh/model-studio/model-pricing) | Mainland China API prices and specifications for Qwen, Wan, Bailian, and other Alibaba model families |
| [MiniMax](https://platform.minimaxi.com/docs/guides/pricing-paygo) | Live Mainland China API pricing |
| [DeepSeek](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) | Live Mainland China API pricing, including peak and off-peak tiers |
| [Kimi](https://platform.kimi.com/docs/pricing/chat) | Live Mainland China API pricing |
| [Zhipu AI](https://open.bigmodel.cn/pricing) | Live Mainland China API pricing, including Embedding and managed Rerank products |
| OpenAI, Google, xAI, Voyage AI, and AWS documentation | Live US vendor pricing for supported media and retrieval models |
| Official Hugging Face organizations | Open-weight repository evidence |

Every source remains subject to its own license and terms of service. This repository does not grant redistribution rights for third-party data.

## Getting started

### Requirements

- Node.js 20 or later
- npm
- Internet access for the initial sync and future updates

### Install and run

```bash
npm install
npm run dev
```

The catalog remains searchable offline after data has been synchronized. A network connection is only required when refreshing sources or calling model APIs from the workbench.

## Commands

```bash
# Start the development server
npm run dev

# Synchronize all configured sources
npm run catalog:sync

# Print catalog statistics
npm run catalog:stats

# Audit deduplication, openness, recency, context, and price coverage
npm run catalog:audit

# Run static checks
npm run lint

# Create a production build
npm run build
```

## What “Sync now” does

The **Sync now** button calls the same synchronization pipeline as `npm run catalog:sync`.

- **New models** missing from the local catalog are inserted and appear according to their release date.
- **Existing local metadata** is never replaced wholesale by Models.dev, Qianwen Model Market, Volcengine Ark, or another aggregator. Those sources can only fill fields that are still empty.
- **Models.dev records and offerings are append-only** after their first import; later upstream rewrites cannot alter the local copy.
- **Official vendor prices** remain mutable and keep price-history snapshots when they change.
- **Provider offerings** can be deactivated without deleting their historical records.
- A base model is marked retired only after an explicit retirement signal or an effective deprecation date from an authoritative vendor source. Marketplace disappearance alone is insufficient.
- **Partial vendor failures** use the most recent successful vendor snapshot so that a temporary website failure does not retire an entire model family.
- The UI reports actual counts for new models, reactivated models, retired models, retired offerings, price changes, and specification changes.

Source discovery is automatic for Models.dev, OpenRouter, Qianwen Model Market, and Volcengine Ark. Some vendor-specific parsers intentionally use an allowlist of verified model families; newly announced models from those vendors may require a parser update before they become first-class catalog records.

## Evaluation workbench

Models can be selected from the catalog and imported into the workbench.

The text-model workflow provides:

- One shared system prompt
- One shared user input
- One output panel per selected model
- Per-model API model ID and API key
- Parallel execution and latency display
- Copy and clear actions for editable fields and outputs

The interface also contains task-specific layouts for audio, image, OCR, Embedding, and Rerank evaluation. Some non-text workflows are currently UI scaffolds and will be connected to provider-specific APIs incrementally.

### API-key security

Workbench API keys are:

- Stored only in the local SQLite database
- Encrypted with AES-256-GCM
- Protected by a randomly generated local key in `data/.secrets/`
- Masked in the interface after saving
- Excluded from Git by default

This is designed for a trusted local machine. Do not expose the application directly to the public internet without adding authentication, authorization, rate limiting, and a production secret-management system.

## Local data

```text
data/
├── catalog.db                         # Local SQLite database; ignored by Git
├── .secrets/                          # Local encryption keys; ignored by Git
├── official/                          # Versioned, manually verified source data
│   ├── aliyun-model-pricing.json
│   ├── aliyun-model-specs.json
│   ├── china-api-prices.json
│   ├── curated-recent-models.json
│   ├── curated-retrieval-models.json
│   └── openness-evidence.json
└── raw/                               # Latest source snapshots; ignored by Git
    ├── modelsdev-models.json
    ├── modelsdev-offerings.json
    ├── openrouter.json
    ├── qianwen-catalog.json
    ├── volcengine-ark.json
    └── official-*-pricing.json
```

To back up the local catalog, stop the application and copy the entire `data` directory. The database, raw snapshots, and secrets are intentionally not committed.

## Core database tables

| Table | Purpose |
| --- | --- |
| `canonical_models` | Stable model identity, specifications, release data, and lifecycle |
| `model_catalog_entries` | Raw marketplace entries with separate platform and developer identities |
| `offerings` | Provider-specific API IDs, prices, units, regions, and availability |
| `offering_price_history` | Historical price and availability snapshots |
| `model_openness_evidence` | Evidence used for open/closed classification |
| `manual_aliases` | Human-confirmed aliases and merge decisions |
| `user_tags` / `model_user_tags` | Local user annotations, isolated from synchronized data |
| `sources` / `sync_runs` | Source health, timestamps, counts, and sync results |
| `workbench_credentials` | Locally encrypted provider credentials |

## Project structure

```text
src/
├── app/
│   ├── api/                            # Catalog, sync, and workbench routes
│   ├── globals.css
│   └── page.tsx
├── components/catalog/                 # Catalog and workbench UI
└── lib/catalog/                        # Database, queries, sync, pricing, and evidence

scripts/
├── sync-catalog.ts
├── catalog-stats.ts
└── catalog-audit.ts
```

## Validation

Before committing source or data changes, run:

```bash
npm run lint
npm run catalog:audit
npm run build
```

The catalog audit checks current-product deduplication, hidden snapshots, openness evidence, recent-model context coverage, and API-price coverage.

## Known limitations

- The current UI is optimized for local single-user use.
- Vendor website parsers may require maintenance when official pages change structure.
- Some managed retrieval products do not expose a standalone Embedding or Rerank endpoint; this is stated in their model notes.
- Benchmark normalization and user-defined model scoring are not yet implemented.
- Video and 3D evaluation workflows are intentionally deferred.
