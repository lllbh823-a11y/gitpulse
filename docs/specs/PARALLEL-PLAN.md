# GitPulse 多会话并行开发分工方案

本文档用于指导在 `e:\Downloads\网页创作\gitpulse\` 内同时开启 **3 个独立会话** 并行开发，做到**目录严格隔离、零文件冲突、按统一契约无缝联调**。

所有会话以 [2026-11-22-gitpulse-design.md](./2026-11-22-gitpulse-design.md) 第 5 节的**共享数据契约**为唯一事实来源（Single Source of Truth）。

---

## 1. 文件所有权矩阵（严禁越界修改）

| 并行轨道 | 独占目录 / 文件（只改这些） | 依赖输入 | 核心交付物 |
| :--- | :--- | :--- | :--- |
| **轨道 1：小程序与 H5 前端** | `gitpulse/miniprogram/**` | 设计文档第 2、3、5 节 | Taro 4 (React+TS) 4 个完整页面 + 视觉系统 + 双端数据适配层 + 初始种子 `src/data/snapshot.json` + Chrome 375×812 视觉验收 |
| **轨道 2：定时抓取与 AI 加工** | `gitpulse/crawler/**`<br>`gitpulse/.github/workflows/daily-sync.yml` | 设计文档第 4、5 节 | GitHub Trending 抓取器 + REST 元信息补全 + OpenAI 兼容 AI 中文速览（含重试与降级）+ HMAC 推送器 + 本地快照导出器 + 单元测试 |
| **轨道 3：微信云开发与上线指南** | `gitpulse/cloudbase/**`<br>`gitpulse/docs/deploy-guide.md` | 设计文档第 1、4、5 节 | 6 个独立云函数（含 `config.json` 定时触发器）+ 云数据库集合/索引说明 + 单元测试 + 微信公众平台提审与配置手册 |

> **零冲突原则**：
> - 三个轨道**完全不共享任何可写目录**，可以同时开工、同时运行构建和测试。
> - 轨道 1 先在 `miniprogram/src/data/snapshot.json` 内置一份符合 `SnapshotPayload` 契约的高质量种子数据；等轨道 2 完成后，在最后联调阶段跑一次 `crawler` 命令即可把最新真实 GitHub 榜单刷新进 `snapshot.json`。

---

## 2. 三个并行会话的开场指令（直接复制粘贴即可开工）

打开新会话时，将对应轨道的整段指令粘贴发送即可：

### 会话 A（轨道 1：Taro 4 小程序 + H5 前端）

```text
请先阅读以下设计规格与并行分工文档，以及工作区规范：
1. e:\Downloads\网页创作\AGENTS.md
2. e:\Downloads\网页创作\.agents\skills\wechat-miniprogram\SKILL.md
3. e:\Downloads\网页创作\gitpulse\docs\specs\2026-11-22-gitpulse-design.md
4. e:\Downloads\网页创作\gitpulse\docs\specs\PARALLEL-PLAN.md

你负责【轨道 1：小程序与 H5 前端】，严格只在 `e:\Downloads\网页创作\gitpulse\miniprogram\` 目录内开发，不要修改 `crawler/`、`cloudbase/` 或 `.github/`。

任务目标：
1. 在 `gitpulse/miniprogram` 初始化 Taro 4 (React + TypeScript) 项目，配置好微信小程序 (`weapp`) 与 H5 (`h5`) 双端构建，确保 `project.config.json`、`app.config.ts`、`sitemap.json` 符合微信正式上线规范（含 `lazyCodeLoading: "requiredComponents"`、安全区与自定义导航栏配置）。
2. 严格按设计文档第 3 节的「极客晨报 · 纸墨与脉冲绿」视觉 Token 与第 5 节的 TypeScript 类型契约，实现全部 4 个页面：
   - `pages/today/index`（期刊头 + 往期日期切换 + 今日风向与预约推送条 + 日/周榜切换 + 分类筛选 + 卡片流）
   - `pages/discover/index`（关键词搜索 + 分类/语言筛选 + 分页加载）
   - `pages/mine/index`（云端收藏夹 + 推送额度管理与偏好 + 隐私说明与原生 feedback 按钮）
   - `pages/detail/index`（AI 结构化拆解 + 基础指标 + 吸底安全区收藏/分享/一键复制链接）
3. 所有页面必须具备骨架屏 Loading、Empty 空态、Error 重试态，并做好胶囊按钮避让与底部安全区适配。
4. 在 `src/services/` 实现统一数据适配层：微信小程序环境优先走 `Taro.cloud.callFunction`（对接设计文档第 5.3 节的云函数名与参数）；H5 或未配置云环境时自动降级读取 `src/data/snapshot.json`（请先创建包含 2 期共 15+ 个真实风格热门项目的种子快照）并用本地存储持久化收藏与订阅次数。
5. 完成验收：`pnpm build:weapp` 与 `pnpm build:h5` 均 0 报错通过，检查 `weapp` 主包体积远小于 2MB；启动 H5 预览并用 Chrome DevTools 在 375×812 视口逐页检查排版、交互和控制台零报错。
```

---

### 会话 B（轨道 2：GitHub 定时抓取 + AI 中文速览 + GitHub Actions）

```text
请先阅读以下设计规格与并行分工文档：
1. e:\Downloads\网页创作\gitpulse\docs\specs\2026-11-22-gitpulse-design.md
2. e:\Downloads\网页创作\gitpulse\docs\specs\PARALLEL-PLAN.md

你负责【轨道 2：定时抓取与 AI 加工流水线】，严格只在 `e:\Downloads\网页创作\gitpulse\crawler\` 和 `e:\Downloads\网页创作\gitpulse\.github\workflows\daily-sync.yml` 内开发，不要修改 `miniprogram/` 或 `cloudbase/`。

任务目标：
1. 在 `gitpulse/crawler` 初始化 TypeScript + Node 24 + Vitest 工程（使用 pnpm），提供 `.env.example`（包含 `GITHUB_TOKEN`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`CLOUDBASE_INGEST_URL`、`INGEST_SECRET`）。
2. 按设计文档第 4、5 节契约实现模块化抓取与加工管线：
   - `src/trendingScraper.ts`：解析 GitHub Trending 页面（支持 `daily` Top 20 和 `weekly` Top 10），提取仓库名、描述、语言、语言色值、总 Star、本期新增 Star、Fork。
   - `src/githubMeta.ts`：调用 GitHub REST API（带限流/容错处理）补全 `license`、精准统计与精简 README 文本（截断前 2500 字）。
   - `src/aiSummarizer.ts`：通过标准 OpenAI 兼容 Chat Completions API 并发限流生成符合 `RepoAISummary` 与 `category`/`tags` 的严格 JSON，并生成整期 `summary`；单条失败重试 2 次后自动降级为 `aiStatus: 'fallback'`，绝不阻断整期任务。
   - `src/cloudPusher.ts`：严格按设计文档第 5.3 节计算 `x-gitpulse-timestamp` 与 `x-gitpulse-signature` (HMAC-SHA256) 并 POST 至 `ingestIssue` 云函数 HTTP 地址。
   - `src/snapshotWriter.ts`：支持 CLI 参数 `--dry-run` 和 `--out <path>` 将抓取结果合并导出为符合 `SnapshotPayload` 契约的 JSON 文件（便于本地离线测试和联调刷新前端快照）。
3. 编写 `gitpulse/.github/workflows/daily-sync.yml`：每天北京时间 07:30（cron `30 23 * * *`）自动执行抓取、AI 加工与推送入库，并支持 `workflow_dispatch` 手动触发。
4. 编写完整的 Vitest 单元测试（覆盖 HTML 解析、AI JSON 校验与降级、HMAC 签名、Snapshot 合并）并全部跑通，同时执行一次 TypeScript 编译检查（`tsc --noEmit`）和 `--dry-run` 烟雾测试确认产出格式 100% 符合契约。
```

---

### 会话 C（轨道 3：微信云开发后端 + 订阅推送 + 正式上线指南）

```text
请先阅读以下设计规格与并行分工文档：
1. e:\Downloads\网页创作\gitpulse\docs\specs\2026-11-22-gitpulse-design.md
2. e:\Downloads\网页创作\gitpulse\docs\specs\PARALLEL-PLAN.md

你负责【轨道 3：微信云开发后端与正式上线指南】，严格只在 `e:\Downloads\网页创作\gitpulse\cloudbase\` 和 `e:\Downloads\网页创作\gitpulse\docs\deploy-guide.md` 内开发，不要修改 `miniprogram/` 或 `crawler/`。

任务目标：
1. 在 `gitpulse/cloudbase/` 搭建标准微信云开发工程结构（含 `cloudbaserc.json`、数据库集合与索引配置清单 `database/collections.json`，以及 6 个独立可部署的云函数目录，每个云函数自带完整 `package.json` 与 `config.json`，不依赖跨目录未打包文件）：
   - `cloudfunctions/ingestIssue`：校验 `x-gitpulse-timestamp`（±300s 防重放）与 `x-gitpulse-signature`（HMAC-SHA256 + `crypto.timingSafeEqual`），幂等 upsert `repos` 与 `daily_issues`（自动维护递增 `issueNo`）。
   - `cloudfunctions/getDailyIssue`：返回指定日期/周期期刊、过滤后的项目列表、最近 14 期 `availableDates`、当前用户 `bookmarkedIds` 及 `PushSubscriptionState`。
   - `cloudfunctions/searchRepos`：支持关键词、分类、语言的分页查询并返回当前用户 `bookmarkedIds`。
   - `cloudfunctions/bookmark`：基于 `OPENID` 实现 `toggle` 和 `list`（分页）。
   - `cloudfunctions/subscription`：基于 `OPENID` 实现 `get`、`increment`（单次 1~3 封顶）、`updatePreference`。
   - `cloudfunctions/sendDailyPush`：配置定时触发器 `0 30 8 * * * *` 与 `openapi.subscribeMessage.send` 权限声明；分批发送当日 Top 1（或用户偏好分类 Top 1）项目提醒，严格截断 `thing` 字段 ≤ 20 字，成功则原子扣减次数并记录 `lastPushedDate`，遇 `43101` 自动将额度归零。
2. 为云函数核心业务逻辑（HMAC 验签防重放、入库幂等性、推送文案截断与 43101 容错、收藏/订阅状态流转）编写可本地运行的自动化单元测试（Vitest/Node test，mock `wx-server-sdk`），确保全部测试通过。
3. 编写一份零歧义、手把手的正式上线手册 `e:\Downloads\网页创作\gitpulse\docs\deploy-guide.md`，覆盖：
   - 个人主体微信小程序注册与「工具 → 信息查询」类目选择
   - 微信云开发环境开通、4 个集合与索引创建、6 个云函数部署与环境变量（`INGEST_SECRET`、`SUBSCRIBE_TEMPLATE_ID`）配置
   - `ingestIssue` HTTP 访问服务开启步骤
   - 一次性订阅消息模板申请与字段映射说明
   - GitHub Actions Secrets 配置与手动首跑验证
   - 微信开发者工具导入 `miniprogram/dist`、隐私保护指引配置与提交审核自检表
```

---

## 3. 三轨合流联调步骤（全部完成后只需 5 分钟）

等 3 个并行会话各自验收通过后，在任一会话执行 3 步合流即可：
1. **数据刷新联调**：运行 `crawler` 的 `--dry-run --out ../miniprogram/src/data/snapshot.json`，确认前端 H5 渲染真实当日 GitHub 热榜零报错。
2. **契约核对**：抽查 `crawler` 输出字段、`cloudbase` 读写字段与 `miniprogram/src/types/` 完全一致。
3. **云端实测**：按 `docs/deploy-guide.md` 填入你的小程序 AppID、云开发环境 ID 与密钥，在微信开发者工具导入 `miniprogram/dist` 完成真机预览与提审。
