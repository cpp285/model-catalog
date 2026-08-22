# Model Index

本地运行的 AI 模型资料库。前端页面、本地 API、数据同步和 SQLite 数据库均位于同一个 Next.js 项目中。

## 已实现

- Models.dev 底层模型和渠道数据同步
- LiteLLM 价格库同步
- OpenRouter 全部输出模态数据同步
- 底层模型与渠道服务分层存储
- 精确匹配、规则匹配、人工确认和待归并状态
- 搜索、多维下拉筛选、排序、分页和 CSV 导出
- 浏览器本地保存筛选视图
- 模型和渠道详情面板
- 页面内一键同步

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

## 数据位置

```text
data/
├── catalog.db             # 结构化后的本地 SQLite 数据库
└── raw/                   # 各数据源的最新原始 JSON
    ├── modelsdev-models.json
    ├── modelsdev-offerings.json
    ├── litellm.json
    └── openrouter.json
```

`catalog.db` 和原始 JSON 默认不提交到 Git。如需备份，关闭应用后复制整个 `data` 目录即可。

## 核心表

- `canonical_models`：底层模型身份和稳定能力。
- `offerings`：各来源、服务商、区域和价格记录。
- `manual_aliases`：人工确认的模型别名和归并关系。
- `user_tags` / `model_user_tags`：与自动数据隔离的人工标签。
- `sources` / `sync_runs`：数据源状态与同步记录。

## 开发检查

```bash
npm run lint
npm run build
```
