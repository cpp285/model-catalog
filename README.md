# Model Index

本地运行的 AI 模型资料库。前端页面、本地 API、数据同步和 SQLite 数据库均位于同一个 Next.js 项目中。

## 已实现

- Models.dev 中美底层模型资料同步
- 中美厂商官方 API 价格，人民币价格直接采用中国官网原价
- 千问模型广场 486 条在售模型记录，覆盖千问、万相、百聆及平台接入的第三方模型
- 火山方舟 54 个模型卡片，用于补充豆包及平台接入模型的身份与模态
- 模型开发商与服务平台分开保存；阿里云、火山方舟中的第三方模型不会被归到平台自研模型下
- MiniMax H3、MiniMax M3 等官网核验的新模型补录
- OpenRouter 可用性与中转价格同步，不在主模型库中混作官方价格
- Token、秒、张、次、万字符、音色等多种实际计费单位
- 底层模型与服务价格分层存储，主界面以底层模型为中心
- 精确匹配、规则匹配、人工确认和待归并状态
- 搜索、中英双语模型分类、开源/闭源/待核验、多维下拉筛选、排序、分页和 CSV 导出；筛选菜单支持点击外部或 Esc 收起
- 浏览器本地保存筛选视图
- 模型详情、官方计费明细、规格和来源证据
- 页面内一键同步
- “立即同步”会读取 Models.dev、OpenRouter、千问模型市场、火山方舟，以及 MiniMax、DeepSeek、Kimi、智谱官网实时价格
- 新增模型按发布时间从新到旧置顶；改价与上下文等规格会更新，并保留价格历史；下架记录不会删除，而是标记为不可调用

## 本地启动

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 数据同步

命令行手动同步：

```bash
npm run catalog:sync
```

查看当前数据统计：

```bash
npm run catalog:stats
```

也可以在页面右上角点击“立即同步”。同步需要联网，已有数据的查询和筛选不需要联网。

### “立即同步”的具体规则

1. **新增模型**：读取成功的数据源出现新模型后，写入本地库并保存发布时间。页面同步完成后自动回到第 1 页、恢复为“发布时间从新到旧”，所以符合当前筛选条件的新模型会出现在最上方。
2. **价格和规格修改**：官网公开的输入价、输出价、缓存价、阶梯价、实际计费单位、上下文和最大输出等字段发生变化时，更新当前值。每次不同的价格状态同时写入 `offering_price_history`，旧价格不会被无痕覆盖。
3. **下架**：某个成功读取的数据源不再返回原有调用记录时，该记录会停用并保存下架日期。如果同一个底层模型仍由其他有效来源提供，只停用消失的调用记录；只有所有当前来源都不再提供时，底层模型才标记为“已下架 / 不可调用”。下架模型仍保留资料和最后一次价格，避免历史项目无法追溯。
4. **来源失败保护**：只有数据源成功读取后才应用差异。Models.dev、OpenRouter、千问模型市场或火山方舟读取失败会让整次同步失败，旧库保持不变；MiniMax、DeepSeek、Kimi、智谱中单一官网暂时读取失败时，使用该厂商上次成功快照，不会把整批模型误判为下架。“厂商来源”面板会显示“官网实时”或“快照兜底”。
5. **结果回执**：页面会显示本次新增、重新上架、已下架、停用调用记录、改价和规格更新的数量。数字均来自同步前后的本地数据差异，不是演示文案。

## 数据位置

```text
data/
├── catalog.db             # 结构化后的本地 SQLite 数据库
├── official/              # 版本化的官网数据与规格
│   ├── aliyun-model-pricing.json
│   ├── aliyun-model-specs.json
│   ├── openness-evidence.json
│   └── curated-recent-models.json
│   └── curated-retrieval-models.json
└── raw/                   # 自动同步来源的最新原始 JSON
    ├── modelsdev-models.json
    ├── modelsdev-offerings.json
    ├── qianwen-catalog.json
    ├── volcengine-ark.json
    ├── official-{minimax,deepseek,moonshot,zhipu}-pricing.json
    └── openrouter.json
```

`catalog.db` 和 `raw` 原始 JSON 默认不提交到 Git；`official` 中经官网核验的数据会提交到 Git。需要备份个人数据时，关闭应用后复制整个 `data` 目录即可。

## 核心表

- `canonical_models`：底层模型身份和稳定能力。
- `model_catalog_entries`：外部模型广场的原始条目，分别保存模型开发商与服务平台。
- `offerings`：官方 API 与 OpenRouter 的区域、价格、计费单位和来源记录。
- `offering_price_history`：每次真实价格或上下架状态发生变化时保存的历史快照。
- `manual_aliases`：人工确认的模型别名和归并关系。
- `user_tags` / `model_user_tags`：与自动数据隔离的人工标签。
- `sources` / `sync_runs`：数据源状态与同步记录。

## 开发检查

```bash
npm run lint
npm run build
```
