import { getDatabase } from "../src/lib/catalog/database";

type CountRow = { count: number };

const database = getDatabase();
const summary = database
  .prepare(`
    SELECT
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1) AS source_versions,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1) AS current_products,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 0) AS hidden_versions,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND product_id IS NULL) AS missing_product_ids,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1 AND open_weights = 1) AS open_models,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1 AND open_weights = 0) AS closed_models,
      (SELECT COUNT(*) FROM canonical_models WHERE active = 1 AND is_current = 1 AND open_weights IS NULL) AS unknown_openness,
      (SELECT COUNT(*) FROM model_openness_evidence) AS openness_evidence_records
  `)
  .get() as {
  source_versions: number;
  current_products: number;
  hidden_versions: number;
  missing_product_ids: number;
  open_models: number;
  closed_models: number;
  unknown_openness: number;
  openness_evidence_records: number;
};

const duplicateCurrentGroups = database
  .prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT product_id
      FROM canonical_models
      WHERE active = 1 AND is_current = 1
      GROUP BY product_id
      HAVING COUNT(*) > 1
    )
  `)
  .get() as CountRow;

const duplicateCurrentNames = database
  .prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT developer, lower(replace(replace(replace(name, '-', ''), ' ', ''), '_', '')) AS name_key
      FROM canonical_models
      WHERE active = 1 AND is_current = 1
      GROUP BY developer, name_key
      HAVING COUNT(*) > 1
    )
  `)
  .get() as CountRow;

const deepSeekV4Pro = database
  .prepare(`
    SELECT id, product_id, name, lifecycle_status, callable, is_current, source, release_date
    FROM canonical_models
    WHERE active = 1 AND product_id = 'deepseek/deepseek-v4-pro'
    ORDER BY is_current DESC, release_date DESC, id
  `)
  .all();

const recencyCoverage = database
  .prepare(`
    WITH api_coverage AS (
      SELECT COALESCE(model.product_id, offering.canonical_model_id) AS product_id,
        1 AS has_api,
        MAX(CASE WHEN offering.price_status IN ('priced', 'free') THEN 1 ELSE 0 END) AS has_price
      FROM offerings offering
      LEFT JOIN canonical_models model ON model.id = offering.canonical_model_id
      WHERE offering.active = 1 AND offering.is_official_api = 1
      GROUP BY COALESCE(model.product_id, offering.canonical_model_id)
    ), current_models AS (
      SELECT model.*,
        CASE
          WHEN model.release_date >= '2026-01-01' THEN '2026'
          WHEN model.release_date >= '2025-01-01' THEN '2025'
          WHEN model.release_date >= '2024-01-01' THEN '2024'
          WHEN model.release_date IS NULL THEN '无发布日期'
          ELSE '更早'
        END AS release_band,
        CASE WHEN model.model_type IN ('chat', 'embedding', 'multimodal_embedding', 'rerank', 'ocr')
          THEN 1 ELSE 0 END AS needs_context
      FROM canonical_models model
      WHERE model.active = 1 AND model.is_current = 1
    )
    SELECT current.release_band,
      COUNT(*) AS models,
      SUM(current.needs_context) AS context_relevant_models,
      SUM(CASE WHEN current.needs_context = 1 AND current.context_window IS NOT NULL THEN 1 ELSE 0 END)
        AS context_verified_models,
      SUM(COALESCE(api.has_api, 0)) AS api_models,
      SUM(COALESCE(api.has_price, 0)) AS api_models_with_published_price
    FROM current_models current
    LEFT JOIN api_coverage api ON api.product_id = COALESCE(current.product_id, current.id)
    GROUP BY current.release_band
    ORDER BY CASE current.release_band
      WHEN '2026' THEN 1 WHEN '2025' THEN 2 WHEN '2024' THEN 3
      WHEN '更早' THEN 4 ELSE 5 END
  `)
  .all();

const verificationPriority = database
  .prepare(`
    WITH api_coverage AS (
      SELECT COALESCE(model.product_id, offering.canonical_model_id) AS product_id,
        MAX(CASE WHEN offering.price_status IN ('priced', 'free') THEN 1 ELSE 0 END) AS has_price,
        1 AS has_api
      FROM offerings offering
      LEFT JOIN canonical_models model ON model.id = offering.canonical_model_id
      WHERE offering.active = 1 AND offering.is_official_api = 1
      GROUP BY COALESCE(model.product_id, offering.canonical_model_id)
    )
    SELECT model.id, model.name, model.release_date,
      CASE WHEN model.model_type IN ('chat', 'embedding', 'multimodal_embedding', 'rerank', 'ocr')
          AND model.context_window IS NULL THEN 1 ELSE 0 END AS missing_context,
      CASE WHEN COALESCE(api.has_api, 0) = 1 AND COALESCE(api.has_price, 0) = 0
        THEN 1 ELSE 0 END AS missing_api_price
    FROM canonical_models model
    LEFT JOIN api_coverage api ON api.product_id = COALESCE(model.product_id, model.id)
    WHERE model.active = 1 AND model.is_current = 1
      AND (
        (model.model_type IN ('chat', 'embedding', 'multimodal_embedding', 'rerank', 'ocr')
          AND model.context_window IS NULL)
        OR (COALESCE(api.has_api, 0) = 1 AND COALESCE(api.has_price, 0) = 0)
      )
    ORDER BY model.release_date DESC, model.id
    LIMIT 30
  `)
  .all();

const audit = {
  ...summary,
  duplicate_current_product_groups: duplicateCurrentGroups.count,
  duplicate_current_name_groups: duplicateCurrentNames.count,
  deepseek_v4_pro: deepSeekV4Pro,
  recency_coverage: recencyCoverage,
  verification_priority_newest_first: verificationPriority,
};

console.log(JSON.stringify(audit, null, 2));

if (
  summary.missing_product_ids ||
  duplicateCurrentGroups.count ||
  summary.unknown_openness ||
  summary.openness_evidence_records !== summary.current_products
) {
  process.exitCode = 1;
}
