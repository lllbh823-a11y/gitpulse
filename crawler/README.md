# GitPulse Crawler（定时抓取与 AI 加工流水线）

负责每日自动抓取 GitHub Trending（`daily` Top 20 + `weekly` Top 10），调用 GitHub REST API 补全 `license` 与精简 README，经 OpenAI 兼容大模型生成结构化中文速览（`RepoAISummary`），并通过 HMAC-SHA256 签名推送到微信云开发 `ingestIssue` 云函数，或导出本地 `SnapshotPayload` 快照供小程序/H5 离线预览。

## 环境要求

- Node.js `>= 24.0.0`
- `pnpm`

## 快速开始

```bash
cd crawler
pnpm install
cp .env.example .env
```

在 `.env` 中按需配置：

| 变量名 | 必填 | 说明 |
| :--- | :--- | :--- |
| `GITHUB_TOKEN` | 推荐 | GitHub PAT（未配置时使用匿名配额，遇 403 限流会自动降级为页面已抓取元数据） |
| `LLM_BASE_URL` | 否 | OpenAI 兼容接口地址，默认 `https://api.openai.com/v1` |
| `LLM_API_KEY` | 生产必填 | 大模型 API Key（本地 `--dry-run` 未配置时自动降级为 `aiStatus: "fallback"` 中文摘要） |
| `LLM_MODEL` | 否 | 模型名称，默认 `gpt-4o-mini` |
| `CLOUDBASE_INGEST_URL` | 生产必填 | 微信云开发 `ingestIssue` 云函数 HTTP 触发地址 |
| `INGEST_SECRET` | 生产必填 | 与 `ingestIssue` 云函数一致的 HMAC-SHA256 签名密钥 |

## 常用命令

```bash
# 1. 类型检查与单元测试
pnpm typecheck
pnpm test

# 2. 本地离线演练（不推送云开发，导出 output/snapshot.json）
pnpm dry-run

# 3. 刷新前端小程序/H5 本地种子快照（支持增量合并与幂等更新 issueNo）
pnpm dry-run --out ../miniprogram/src/data/snapshot.json

# 4. 正式同步并推送至微信云开发 ingestIssue
pnpm sync
```

### CLI 参数

- `--dry-run`：跳过微信云开发推送，仅在本地生成并校验 `SnapshotPayload` JSON。
- `--out <path>`：将合并后的 `SnapshotPayload` 写入指定路径（`--dry-run` 下默认 `output/snapshot.json`）。
- `--date <YYYY-MM-DD>`：指定期刊日期（默认取北京时间 `Asia/Shanghai` 当日）。
- `--periods <daily,weekly>`：指定抓取周期，默认 `daily,weekly`。
- `--daily-limit <n>` / `--weekly-limit <n>`：自定义抓取条数（默认日榜 20、周榜 10）。
- `--skip-ai`：跳过大模型 API 调用，直接使用确定性启发式分类与中文兜底摘要。
