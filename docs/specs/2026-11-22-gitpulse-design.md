# GitPulse（开源每日脉搏）微信小程序完整设计规格

- **文档版本**：v1.0
- **创建日期**：2026-11-22
- **项目根目录**：`e:\Downloads\网页创作\gitpulse\`
- **目标定位**：面向公开发布的个人主体微信小程序，每日自动搜罗 GitHub 热门项目并生成 AI 中文深度速览，配合微信一次性订阅消息推送，让用户每天 3 分钟高效掌握最新开源成果。

---

## 1. 产品定位与合规边界

### 1.1 核心价值
- **痛点**：GitHub Trending 原始列表全英文、缺乏场景化价值提炼、手机端访问慢且容易漏看。
- **解法**：每日自动抓取 GitHub 日榜/周榜热门仓库 + 读取 README 核心信息 → 生成结构化中文速览（一句话价值、爆火原因、3 大亮点、适用人群）→ 在微信小程序内按「极客晨报」体验呈现，并支持一键收藏、一键复制仓库链接与每日订阅消息提醒。

### 1.2 个人主体正式上线合规红线
1. **服务类目**：选择「**工具 → 信息查询**」。严禁包含用户评论、发帖、私信等 UGC 社交功能，避开个人主体不可过审的社区/资讯类目。
2. **外链合规**：不使用 `web-view` 打开 `github.com`（个人主体无法验证第三方域名）。项目详情页通过 AI 深度速览 + 核心特性卡片承载阅读价值，并提供「一键复制 GitHub 链接」（触发前符合微信剪贴板隐私授权指引）。
3. **推送合规**：使用微信官方「一次性订阅消息」。禁止首次进入小程序强制弹窗索要授权；改为首页顶栏与「我的」页内主动点击「预约明日推送」，并透明展示剩余可推送次数。
4. **免备案与域名安全**：生产环境小程序端全部通过 `Taro.cloud.callFunction` 访问微信云开发，不直连未备案外部域名。

---

## 2. 信息架构与页面设计

采用 **3 Tab + 1 详情页** 的精简信息架构：

| 页面路径 | 页面角色 | 核心模块 |
| :--- | :--- | :--- |
| `pages/today/index` | Tab 1：今日 | 自定义期刊导航栏（避让微信胶囊）、往期日期选择器、今日风向摘要条 + 「预约明日推送（剩余 N 次）」按钮、`日榜 / 周榜` 切换、领域分类横向筛选条、高信息密度项目卡片流 |
| `pages/discover/index` | Tab 2：发现 | 历史入库仓库关键词搜索框、热门搜索标签、按赛道/编程语言筛选、分页加载列表 |
| `pages/mine/index` | Tab 3：我的 | 云端收藏夹（无感 `openid` 同步，支持取消收藏与一键复制链接）、推送订阅管理（剩余推送次数、一键补充预约、关注领域偏好）、隐私指引与微信原生反馈按钮（`open-type="feedback"`） |
| `pages/detail/index` | 独立详情页 (`?id=<repoId>`) | 仓库头信息（名称/作者/语言/License/总 Star/今日新增 Star/Fork）、AI 结构化拆解卡片（一句话定位、为什么今日爆火、3 大核心亮点、最适合谁用）、原始英文简介折叠区、吸底安全区操作栏（收藏 / 转发好友卡片 / 一键复制 GitHub 链接） |

### 2.1 状态完备性要求（所有页面必须实现）
- **Loading 态**：首屏使用与卡片结构一致的骨架屏（Skeleton），禁止白屏或仅有居中转圈。
- **Empty 态**：筛选无结果、搜索无命中、收藏夹为空时展示清晰的空态插画/图标与引导按钮（如「重置筛选」「去今日热榜逛逛」）。
- **Error 态**：云函数异常或网络失败时展示明确提示与「重新加载」按钮。
- **双端运行提示**：H5 浏览器预览模式下展示可关闭的轻量顶部提示或环境徽标，表明当前使用本地快照数据，不影响核心交互体验。

---

## 3. 视觉设计系统（Design Tokens）

视觉方向：**「极客晨报 · 纸墨与脉冲绿」（Editorial Tech Digest）**，拒绝紫蓝渐变通用模板。

```css
:root {
  /* 背景与表面 */
  --gp-bg-canvas: #F7F6F2;      /* 暖纸白主画布 */
  --gp-bg-surface: #FFFFFF;     /* 卡片纯白表面 */
  --gp-bg-subtle: #EFECE4;      /* 标签/次级区块底色 */

  /* 边框 */
  --gp-border: #E8E6DF;         /* 1px 细腻卡片描边 */
  --gp-border-strong: #D5D1C5;

  /* 文本层级 */
  --gp-text-primary: #14171A;   /* 深炭墨主标题 */
  --gp-text-secondary: #5A626A; /* 次级正文与摘要 */
  --gp-text-muted: #8C949C;     /* 辅助时间/指标标签 */

  /* 品牌强调色 */
  --gp-accent: #0F9D58;         /* 脉冲翠绿：Star 增速、订阅 CTA、活跃状态 */
  --gp-accent-soft: #E8F7EF;    /* 脉冲浅绿徽章底色 */
  --gp-accent-dark: #0B7A43;    /* 按压态 */

  /* 排名与收藏点缀色 */
  --gp-gold: #D97706;           /* Top 3 与收藏点亮 */
  --gp-gold-soft: #FEF3C7;

  /* 语义色 */
  --gp-danger: #DC2626;
  --gp-danger-soft: #FEE2E2;

  /* 圆角与间距 */
  --gp-radius-sm: 12rpx;
  --gp-radius-md: 20rpx;
  --gp-radius-lg: 28rpx;
  --gp-radius-pill: 999rpx;
}
```

### 3.1 移动端人体工学规范
- **顶部安全区**：自定义导航栏通过 `Taro.getWindowInfo()` 与 `Taro.getMenuButtonBoundingClientRect()` 动态计算 `statusBarHeight`、`navBarHeight` 与右侧胶囊避让宽度；H5 环境降级为 `statusBarHeight = 0, navBarHeight = 44px`。
- **底部安全区**：自定义 TabBar 与详情页吸底操作栏必须声明 `padding-bottom: env(safe-area-inset-bottom)`。
- **触控热区**：所有按钮、筛选胶囊、收藏图标点击热区不小于 `44×44px`（`88×88rpx`）。
- **数字排版**：Star 数、今日增速、期号使用 `font-variant-numeric: tabular-nums`。

---

## 4. 系统整体架构与数据流

```text
[GitHub Actions: 每日北京时间 07:30]
   ├── crawler/src/trendingScraper.ts  抓取 GitHub Trending (daily Top 20 + weekly Top 10)
   ├── crawler/src/githubMeta.ts       GitHub REST API 补全 stars / forks / license / README 片段
   ├── crawler/src/aiSummarizer.ts     调用 OpenAI 兼容大模型生成结构化中文速览 (失败自动重试+降级)
   ├── crawler/src/cloudPusher.ts      HMAC-SHA256 签名 POST 至微信云开发 ingestIssue
   └── crawler/src/snapshotWriter.ts   可选输出 miniprogram/src/data/snapshot.json 供本地 H5 预览

[微信云开发 CloudBase]
   ├── 云函数 ingestIssue              校验签名并幂等 upsert repos & daily_issues
   ├── 云函数 getDailyIssue            返回指定日期/周期榜单 + 趋势摘要 + 用户收藏态 + 订阅额度
   ├── 云函数 searchRepos              历史仓库多维检索与分页
   ├── 云函数 bookmark                 基于 OPENID 切换/查询个人收藏
   ├── 云函数 subscription             查询/累加一次性订阅次数、保存领域偏好
   └── 云函数 sendDailyPush            每日北京时间 08:30 定时触发，分批推送订阅消息并扣减额度

[Taro 4 React + TS 小程序端]
   ├── 微信小程序运行时                 通过 Taro.cloud.callFunction 直连云开发
   └── H5 浏览器预览运行时              通过统一 api 适配层消费 src/data/snapshot.json + localStorage 模拟收藏/订阅
```

---

## 5. 共享数据契约（Single Source of Truth）

> **所有并行开发会话必须严格遵守本节定义的字段名、类型、集合名与接口返回结构，禁止私自重命名字段。**

### 5.1 核心领域类型（TypeScript）

```ts
export type TrendingPeriod = 'daily' | 'weekly';

export type CategoryId =
  | 'all'
  | 'ai-agent'
  | 'frontend'
  | 'dev-tools'
  | 'backend-infra'
  | 'open-models'
  | 'other';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'all', label: '全部' },
  { id: 'ai-agent', label: 'AI & Agent' },
  { id: 'frontend', label: '前端与 UI' },
  { id: 'dev-tools', label: '效率工具' },
  { id: 'backend-infra', label: '后端与架构' },
  { id: 'open-models', label: '开源模型' },
  { id: 'other', label: '其他精选' },
];

export interface RepoAISummary {
  tagline: string;          // 15~32字，一句话看懂核心价值
  whyHot: string;           // 40~90字，解释为什么近期爆火/解决什么痛点
  highlights: string[];     // 固定 3 条核心亮点，每条 12~36 字
  targetAudience: string;   // 15~40字，最适合什么角色/场景使用
  aiStatus: 'ok' | 'fallback';
}

export interface RepoItem {
  _id: string;              // 规范化唯一主键：`${owner}__${name}`.toLowerCase()
  fullName: string;         // 例如 "anthropics/claude-code"
  owner: string;
  name: string;
  url: string;              // "https://github.com/owner/name"
  description: string;      // GitHub 原始英文简介
  language: string;         // 无语言时为 "Unknown"
  languageColor: string;    // 十六进制色值，如 "#3178c6"
  stars: number;            // 总 Star 数
  starsToday: number;       // 本期（日/周）新增 Star 数
  forks: number;
  license: string;          // 如 "MIT" / "Apache-2.0" / "Unknown"
  category: Exclude<CategoryId, 'all'>;
  tags: string[];           // 2~3 个中文/技术短标签，如 ["AI Agent", "CLI", "TypeScript"]
  ai: RepoAISummary;
  latestDate: string;       // 最近上榜日期 "YYYY-MM-DD"
  updatedAt: string;        // ISO 8601 时间戳
}

export interface DailyIssue {
  _id: string;              // `${date}_${period}`，如 "2026-11-22_daily"
  date: string;             // "YYYY-MM-DD"（北京时间）
  period: TrendingPeriod;
  issueNo: number;          // 递增期刊号，从 1 开始
  summary: string;          // 当日一句趋势风向总结（20~48字）
  topCategory: Exclude<CategoryId, 'all'>;
  repoIds: string[];        // 按榜单排名有序排列的 RepoItem._id 数组
  publishedAt: string;      // ISO 8601 时间戳
}

export interface PushSubscriptionState {
  remainingCount: number;
  preferredCategory: CategoryId;
  lastPushedDate: string | null;
  templateId: string;
}

export interface SnapshotPayload {
  generatedAt: string;
  availableDates: string[];
  issues: Record<string, DailyIssue>; // key: `${date}_${period}`
  repos: Record<string, RepoItem>;    // key: RepoItem._id
}
```

### 5.2 微信云数据库集合规范

| 集合名 | 主键 `_id` | 关键索引 | 权限设置 |
| :--- | :--- | :--- | :--- |
| `daily_issues` | `${date}_${period}` | `period + date (DESC)` | 仅云函数读写（前端不直连写） |
| `repos` | `${owner}__${name}` (小写) | `category + latestDate (DESC)`, `starsToday (DESC)` | 仅云函数读写 |
| `user_bookmarks` | 自动生成 | 唯一复合索引 `openid + repoId`；索引 `openid + createdAt (DESC)` | 仅云函数读写 |
| `push_subscriptions` | `openid` | `remainingCount + lastPushedDate` | 仅云函数读写 |

### 5.3 云函数统一接口协议

所有云函数统一返回格式：
```ts
export interface CloudResponse<T> {
  code: number;      // 0 表示成功，非 0 为业务/系统错误码
  message: string;   // "ok" 或可读错误信息
  data?: T;
}
```
错误码约定：`0` 成功，`400` 参数错误，`401` 签名/身份校验失败，`404` 目标不存在，`500` 服务端内部异常。

#### 1) `ingestIssue`（HTTP 触发器，供 GitHub Actions 调用）
- **鉴权头**：
  - `x-gitpulse-timestamp`: Unix 秒级时间戳（允许 ±300 秒误差，防重放）
  - `x-gitpulse-signature`: `HMAC_SHA256(INGEST_SECRET, "${timestamp}.${rawBody}")` 的 hex 编码
- **请求体**：
  ```ts
  {
    date: string;           // "YYYY-MM-DD"
    period: TrendingPeriod; // "daily" | "weekly"
    summary: string;
    topCategory: Exclude<CategoryId, 'all'>;
    repos: RepoItem[];      // 按榜单顺序排列
  }
  ```
- **返回**：`{ code: 0, message: "ok", data: { issueId: string, issueNo: number, upsertedRepos: number } }`

#### 2) `getDailyIssue`（小程序端调用）
- **入参**：`{ date?: string; period?: TrendingPeriod; category?: CategoryId }`（`date` 为空时返回最新一期；`period` 默认 `'daily'`；`category` 默认 `'all'`）
- **返回 `data`**：
  ```ts
  {
    issue: DailyIssue | null;
    repos: RepoItem[];
    availableDates: string[];          // 最近 14 期可用日期降序
    bookmarkedIds: string[];           // 当前用户已收藏的 repoId 列表
    subscription: PushSubscriptionState;
  }
  ```

#### 3) `searchRepos`（小程序端调用）
- **入参**：`{ keyword?: string; category?: CategoryId; language?: string; page?: number; pageSize?: number }`（`page` 默认 1，`pageSize` 默认 15，最大 30）
- **返回 `data`**：
  ```ts
  {
    items: RepoItem[];
    total: number;
    hasMore: boolean;
    bookmarkedIds: string[];
  }
  ```

#### 4) `bookmark`（小程序端调用）
- **入参**：
  - 切换收藏：`{ action: 'toggle', repoId: string }` → 返回 `{ bookmarked: boolean }`
  - 查询列表：`{ action: 'list', page?: number, pageSize?: number }` → 返回 `{ items: RepoItem[], total: number, hasMore: boolean }`

#### 5) `subscription`（小程序端调用）
- **入参**：
  - 查询状态：`{ action: 'get' }`
  - 授权后加次：`{ action: 'increment', delta?: number, templateId?: string }`（`delta` 默认 1，单次上限 3）
  - 更新偏好：`{ action: 'updatePreference', preferredCategory: CategoryId }`
- **返回 `data`**：`PushSubscriptionState`

#### 6) `sendDailyPush`（定时触发云函数：每日 08:30）
- **CloudBase `config.json` 定时配置**：`"0 30 8 * * * *"`
- **发送逻辑**：
  1. 查询当日（北京时间）`daily_issues` 中的 `daily` 期刊与排名第 1 的 `RepoItem`。若当日尚未入库，记录告警并安全退出，不扣减用户次数。
  2. 分批（每批 50 人）查询 `push_subscriptions` 中 `remainingCount > 0` 且 `lastPushedDate != today` 的用户。
  3. 若用户设置了 `preferredCategory !== 'all'`，优先取该分类下当日排名最高的项目作为推送亮点，否则取总榜 Top 1。
  4. 调用 `cloud.openapi.subscribeMessage.send` 发送订阅消息，跳转路径 `pages/today/index?date=${today}`；字段键名通过环境变量可配置（默认 `PUSH_KEY_TITLE=thing1`、`PUSH_KEY_DESC=thing2`、`PUSH_KEY_DATE=time3`），且 `thing` 类型字段严格截断至 ≤ 20 字以符合微信订阅消息规范。
  5. 发送成功则原子扣减 `remainingCount - 1` 并更新 `lastPushedDate = today`；若微信返回 `errCode === 43101`（拒绝/无额度），将 `remainingCount` 置 0；其他瞬时错误记录日志跳过，不阻断后续批次。

---

## 6. 工程目录结构

```text
e:\Downloads\网页创作\gitpulse\
├── docs/
│   ├── specs/
│   │   ├── 2026-11-22-gitpulse-design.md   # 本设计规格（唯一契约源）
│   │   └── PARALLEL-PLAN.md                # 多会话并行开发分工与提示词手册
│   └── deploy-guide.md                     # 微信公众平台配置、云开发部署与提审清单
├── miniprogram/                            # [轨道 1] Taro 4 (React + TS) 小程序与 H5 端
├── crawler/                                # [轨道 2] GitHub 抓取 + AI 摘要 + 入库脚本
├── .github/workflows/daily-sync.yml        # [轨道 2] 每日 07:30 定时抓取流水线
└── cloudbase/                              # [轨道 3] 微信云开发 6 个云函数与数据库配置
```

---

## 7. 测试与上线验收标准

1. **抓取与 AI 模块 (`crawler`)**：通过 Vitest 单元测试（Trending HTML 解析、AI JSON 校验与 fallback 降级、HMAC 签名生成、快照导出）；本地运行一次 `dry-run` 可成功拉取真实 GitHub 热门数据并生成符合 `SnapshotPayload` 契约的 JSON。
2. **云开发后端 (`cloudbase`)**：通过单元测试（HMAC 验签防重放、幂等入库、`sendDailyPush` 43101 自愈与字符截断、收藏切换）；所有云函数具备独立 `package.json` 且无跨目录悬空引用。
3. **前端双端 (`miniprogram`)**：
   - `pnpm build:weapp` 与 `pnpm build:h5` 均 0 错误通过；小程序主包产物严格 < 2MB。
   - H5 预览在 `Chrome DevTools` `375×812` 视口逐页验证 4 个页面（视觉排版、筛选、搜索、收藏、订阅交互、骨架屏/空态/错误态、控制台零报错）。
4. **上线交付**：`docs/deploy-guide.md` 覆盖从 0 到提审的全部步骤（AppID 填入、CloudBase 环境开通、集合与索引创建、订阅消息模板字段配置、GitHub Actions Secrets 设置、微信隐私保护指引声明）。
