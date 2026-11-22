# GitPulse（开源每日脉搏）微信小程序正式上线与运维手册

- **适用版本**：v1.0
- **对应设计规格**：[2026-11-22-gitpulse-design.md](./specs/2026-11-22-gitpulse-design.md)
- **面向主体**：个人主体微信小程序（免服务器域名 ICP 备案、免企业资质）

本手册提供从 **0 注册小程序账号** 到 **开通微信云开发、部署 6 个云函数、配置订阅消息模板、连通 GitHub Actions 每日定时抓取并提交微信审核通过** 的零歧义操作步骤。

---

## 目录

1. [个人主体微信小程序注册与类目设置](#1-个人主体微信小程序注册与类目设置)
2. [微信云开发环境开通与数据库集合/索引创建](#2-微信云开发环境开通与数据库集合索引创建)
3. [6 个云函数部署与环境变量配置](#3-6-个云函数部署与环境变量配置)
4. [`ingestIssue` HTTP 访问服务（云接入）开启与验签测试](#4-ingestissue-http-访问服务云接入开启与验签测试)
5. [一次性订阅消息模板申请与字段映射](#5-一次性订阅消息模板申请与字段映射)
6. [GitHub Actions Secrets 配置与手动首跑验证](#6-github-actions-secrets-配置与手动首跑验证)
7. [前端构建、微信开发者工具导入与隐私保护指引配置](#7-前端构建微信开发者工具导入与隐私保护指引配置)
8. [提交微信审核前终极自检表与提审备注模板](#8-提交微信审核前终极自检表与提审备注模板)

---

## 1. 个人主体微信小程序注册与类目设置

### 1.1 注册个人小程序账号并获取 AppID

1. 打开 [微信公众平台](https://mp.weixin.qq.com/) → 点击右上角 **「立即注册」** → 选择账号类型 **「小程序」**。
2. 按指引填写未绑定过其他公众号/小程序的邮箱、完成管理员微信扫码实名认证（主体类型选择 **「个人」**）。
3. 登录小程序后台 → 进入左侧菜单 **「开发与服务」 → 「开发管理」 → 「开发设置」**：
   - 复制并保存你的 **AppID（小程序 ID）**（格式如 `wx1234567890abcdef`）。

### 1.2 填写小程序基本信息（避开商标与敏感词驳回）

进入左侧菜单 **「设置」 → 「基本设置」**：

- **小程序名称**：建议使用 **「开源每日脉搏」**、**「极客开源脉搏」** 或 **「GitPulse开源速览」**。
  - *避坑提示*：个人主体名称中**不要**使用「GitHub官方」「GitHub热榜官方」等含他人注册商标且易被判定侵权的字样。
- **小程序简称**：如 `开源脉搏` 或 `GitPulse`。
- **小程序头像**：使用简洁几何脉冲/代码图标（纯原创 PNG，尺寸 `144×144 px` 以上，小于 2MB）。
- **小程序介绍**：
  > 面向开发者的开源项目中文速览工具，每日整理热门开源项目核心功能、技术亮点与适用场景，支持分类检索与收藏管理。

### 1.3 选择合规服务类目（核心过审关键）

1. 在 **「设置」 → 「基本设置」 → 「服务类目」** 中点击 **「详情」 → 「添加服务类目」**。
2. 管理员扫码验证后，严格选择：
   - **一级类目**：`工具`
   - **二级类目**：`信息查询`
3. **合规红线说明**：
   - **「工具 → 信息查询」** 对个人主体完全开放，无需任何前置审批资质。
   - **严禁**添加「社交 → 社区/论坛」或「资讯」类目（个人主体不可选），小程序内已严格剔除评论、发帖、点赞互动等 UGC 功能，确保 100% 契合「工具 → 信息查询」定位。

---

## 2. 微信云开发环境开通与数据库集合/索引创建

GitPulse 采用微信云开发（CloudBase）承载后端数据库与 API，小程序端通过 `Taro.cloud.callFunction` 免域名直连，**无需购买云服务器或办理 ICP 域名备案**。

### 2.1 开通云开发环境

1. 下载并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，使用管理员微信扫码登录。
2. 随便新建或导入一个填入上述 **AppID** 的项目，点击工具顶部工具栏的 **「云开发」** 按钮。
3. 按提示开通云开发环境：
   - **环境名称**：例如 `gitpulse-prod`
   - **计费方式**：建议选择「包年包月（基础版/个人版）」或「按量付费」（GitPulse 每日仅固定写入 1~2 次，读取走索引，日常消耗极低）。
4. 环境初始化完成后，在 **「云开发控制台」 → 「设置」 → 「环境设置」** 中复制 **环境 ID（`envId`）**（格式如 `gitpulse-prod-6gxxxxxx`）。

### 2.2 创建 5 个数据库集合与权限设置

在 **「云开发控制台」 → 「数据库」** 中，依次点击 **「+ 添加集合」** 创建以下 **5 个集合**：

| 序号 | 集合名称（严格区分大小写） | 主键 `_id` 格式 | 数据权限设置（全部统一） | 用途说明 |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `daily_issues` | `${date}_${period}`（如 `2026-11-22_daily`） | **所有用户不可读写**（仅云函数可读写） | 每日/每周期刊主表，记录递增 `issueNo`、风向摘要与有序 `repoIds` |
| 2 | `repos` | `${owner}__${name}`（全小写，如 `anthropics__claude-code`） | **所有用户不可读写**（仅云函数可读写） | 仓库元信息与 AI 中文深度拆解 |
| 3 | `user_bookmarks` | 自动生成 | **所有用户不可读写**（仅云函数可读写） | 用户云端收藏夹（按微信 `OPENID` 隔离） |
| 4 | `push_subscriptions` | `${openid}` | **所有用户不可读写**（仅云函数可读写） | 一次性订阅消息剩余额度、关注分类偏好与上次推送日期 |
| 5 | `moderation_pending` | 审核对象与文本的哈希 | 仅管理员可读写 | 待复核及接口故障记录 |

> **安全加固说明**：每个集合创建后，点击右侧 **「权限设置」** → 选择 **「所有用户不可读写」**（即 `{"read": false, "write": false}`，`ADMINONLY`）。GitPulse 所有读写均经由云函数（自带管理员权限）完成，彻底杜绝前端越权篡改或遍历他人数据。

### 2.3 为 5 个集合配置索引

完整索引规范已固化在 [`cloudbase/database/collections.json`](../cloudbase/database/collections.json)。请在 **「云开发控制台」 → 「数据库」 → 选中对应集合 → 「索引管理」 → 「添加索引」** 中逐一添加：

#### 1) `daily_issues` 集合索引
| 索引名称 | 索引属性 | 字段 1（排序） | 字段 2（排序） |
| :--- | :--- | :--- | :--- |
| `idx_period_date_desc` | 非唯一 | `period`（升序 `ASC`） | `date`（降序 `DESC`） |
| `uniq_period_issueNo_desc` | **唯一** | `period`（升序 `ASC`） | `issueNo`（降序 `DESC`） |

#### 2) `repos` 集合索引
| 索引名称 | 索引属性 | 字段 1（排序） | 字段 2（排序） |
| :--- | :--- | :--- | :--- |
| `idx_category_latestDate_desc` | 非唯一 | `category`（升序 `ASC`） | `latestDate`（降序 `DESC`） |
| `idx_starsToday_desc` | 非唯一 | `starsToday`（降序 `DESC`） | — |
| `idx_latestDate_starsToday_desc` | 非唯一 | `latestDate`（降序 `DESC`） | `starsToday`（降序 `DESC`） |

#### 3) `user_bookmarks` 集合索引
| 索引名称 | 索引属性 | 字段 1（排序） | 字段 2（排序） |
| :--- | :--- | :--- | :--- |
| `uniq_openid_repoId` | **唯一** | `openid`（升序 `ASC`） | `repoId`（升序 `ASC`） |
| `idx_openid_createdAt_desc` | 非唯一 | `openid`（升序 `ASC`） | `createdAt`（降序 `DESC`） |

#### 4) `push_subscriptions` 集合索引
| 索引名称 | 索引属性 | 字段 1（排序） | 字段 2（排序） |
| :--- | :--- | :--- | :--- |
| `idx_remainingCount_lastPushedDate` | 非唯一 | `remainingCount`（升序 `ASC`） | `lastPushedDate`（升序 `ASC`） |

---

## 3. 6 个云函数部署与环境变量配置

所有云函数位于 [`cloudbase/cloudfunctions/`](../cloudbase/cloudfunctions/) 下，每个目录均自带独立的 `package.json`、`config.json` 与 `index.js`，**无任何跨目录外部文件依赖**。

### 3.1 生成高强度 `INGEST_SECRET` 签名密钥

在本地终端运行以下 Node.js 命令，生成一个 64 位随机十六进制密钥（请妥善保存，后续云函数与 GitHub Actions 需使用**完全相同**的值）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3.2 部署 6 个云函数（两种方式任选其一）

#### 方式 A：通过微信开发者工具图形界面部署（推荐新手）

1. 确保项目的 `project.config.json` 中已关联 `"cloudfunctionRoot": "../cloudbase/cloudfunctions/"`（或将 `cloudbase/cloudfunctions` 挂载为云函数根目录）。
2. 在微信开发者工具左侧目录树展开 `cloudfunctions`，确认当前云环境已切换为刚才创建的 `gitpulse-prod-xxxx`。
3. 依次右键点击以下 **6 个云函数文件夹** → 选择 **「上传并部署：云端安装依赖（不上传 node_modules）」**：
   - `ingestIssue`
   - `getDailyIssue`
   - `searchRepos`
   - `bookmark`
   - `subscription`
   - `sendDailyPush`
4. **特别步骤（定时触发器）**：右键点击 `sendDailyPush` → 选择 **「上传触发器」**，使 [`sendDailyPush/config.json`](../cloudbase/cloudfunctions/sendDailyPush/config.json) 中的 `0 30 8 * * * *`（每日北京时间 08:30 自动触发）生效。

#### 方式 B：通过 CloudBase CLI 一键部署

如果你安装了 `@cloudbase/cli`（`npm i -g @cloudbase/cli`）：

```bash
cd e:\Downloads\网页创作\gitpulse\cloudbase
tcb login
# 将环境变量注入并一键部署全部 6 个云函数与触发器
tcb fn deploy --all --e <你的云开发环境ID>
tcb fn trigger create sendDailyPush --e <你的云开发环境ID>
```

### 3.3 配置云函数环境变量

打开 **「云开发控制台」 → 「云函数」 → 点击具体云函数名 → 「函数配置」 → 「编辑环境变量」**，按下表填入：

| 云函数名 | 环境变量 Key | 环境变量 Value 示例 | 是否必填 | 说明 |
| :--- | :--- | :--- | :---: | :--- |
| **`ingestIssue`** | `INGEST_SECRET` | `8f9d2a...`（3.1 生成的 64 位随机串） | **必填** | HMAC-SHA256 验签密钥；未设置时接口将拒绝一切入库请求（500 Fail-Closed） |
| **ingestIssue** | MSG_SEC_CHECK_OPENID | 测试或生产环境对应的有效 OpenID | 必填 | 微信 V2 文本审核需要有效的调用上下文，接口异常会暂停入库 |
| **`ingestIssue`** | `COMPLIANCE_EXTRA_BLOCKLIST` | `关键词1,关键词2` | 选填 | 追加自定义拦截关键词（逗号分隔，用于动态补充敏感词） |
| **`ingestIssue`** | `COMPLIANCE_ALLOWLIST` | `owner/repo#规则ID` | 选填 | 元数据误判豁免，格式 owner/repo#规则ID，逗号分隔 |
| **`getDailyIssue`** | `SUBSCRIBE_TEMPLATE_ID` | `xYz123abc...`（第 5 节申请的模板 ID） | **必填** | 下发给小程序前端用于调起 `wx.requestSubscribeMessage` |
| **`subscription`** | `SUBSCRIBE_TEMPLATE_ID` | `xYz123abc...`（同上） | **必填** | 用户默认关联的订阅消息模板 ID |
| **`sendDailyPush`** | `SUBSCRIBE_TEMPLATE_ID` | `xYz123abc...`（同上） | **必填** | 发送订阅消息使用的模板 ID |
| **`sendDailyPush`** | `PUSH_KEY_TITLE` | `thing1`（默认 `thing1`） | 选填 | 对应订阅模板中「项目名称/今日热榜」字段 Key |
| **`sendDailyPush`** | `PUSH_KEY_DESC` | `thing2`（默认 `thing2`） | 选填 | 对应订阅模板中「温馨提示/项目简介」字段 Key |
| **`sendDailyPush`** | `PUSH_KEY_DATE` | `time3`（默认 `time3`） | 选填 | 对应订阅模板中「发布时间/日期」字段 Key（支持 `time*` 或 `date*`） |
| **`sendDailyPush`** | `MINIPROGRAM_STATE` | `formal`（正式版）/ `trial`（体验版） | 选填 | 默认 `formal`；上线前真机调试订阅推送时可临时设为 `trial` 或 `developer` |

> **建议超时时间确认**：在「函数配置」中，建议将 `ingestIssue` 超时时间设为 **20 秒**，将 `sendDailyPush` 超时时间设为 **60 秒**（已在 [`cloudbase/cloudbaserc.json`](../cloudbase/cloudbaserc.json) 中预设）。

---

## 4. `ingestIssue` HTTP 访问服务（云接入）开启与验签测试

为了让 GitHub Actions 每天早上 07:30 能将抓取并经 AI 总结好的期刊数据自动推送到微信云开发，需要为 `ingestIssue` 开启 **HTTP 访问服务**。

### 4.1 开启步骤

1. 打开 **「云开发控制台」 → 「环境设置」 → 「HTTP 访问服务」（或「云接入」）**。
2. 查看顶部默认域名（格式通常为 `https://<env-id>.service.tcloudbase.com`）。
3. 在「关联资源」列表中点击 **「+ 新建」**：
   - **触发路径**：填写 `/ingestIssue`
   - **关联资源类型**：选择 `云函数`
   - **关联云函数**：选择 `ingestIssue`
   - **鉴权开关**：保持关闭（`ingestIssue` 内部已实现更高安全级别的 **HMAC-SHA256 + ±300 秒时间戳防重放 + `crypto.timingSafeEqual` 恒定时间比对**）。
4. 保存后，拼接得到完整的入库 URL（记为 `CLOUDBASE_INGEST_URL`）：
   ```text
   https://<你的环境ID>.service.tcloudbase.com/ingestIssue
   ```

### 4.2 本地一行命令验证 HTTP 验签与入库

在配置 GitHub Actions 前，可在本地终端用 Node.js 发送一条带 HMAC 签名的测试请求（将环境变量替换为你自己的值）：

```powershell
$env:CLOUDBASE_INGEST_URL="https://<你的环境ID>.service.tcloudbase.com/ingestIssue"
$env:INGEST_SECRET="<你的64位INGEST_SECRET>"

node -e '
const crypto = require("crypto");
const url = process.env.CLOUDBASE_INGEST_URL;
const secret = process.env.INGEST_SECRET;
const ts = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify({
  date: "2026-11-22",
  period: "daily",
  summary: "AI Agent 与现代全栈工具链持续领跑今日开源热榜。",
  topCategory: "ai-agent",
  repos: [{
    _id: "anthropics__claude-code",
    fullName: "anthropics/claude-code",
    owner: "anthropics",
    name: "claude-code",
    url: "https://github.com/anthropics/claude-code",
    description: "An agentic coding tool that lives in your terminal.",
    language: "TypeScript",
    languageColor: "#3178c6",
    stars: 42000,
    starsToday: 1280,
    forks: 3400,
    license: "MIT",
    category: "ai-agent",
    tags: ["AI Agent", "CLI", "TypeScript"],
    ai: {
      tagline: "终端原生 AI 编程智能体，自动规划并执行跨文件开发任务",
      whyHot: "无需离开终端即可完成复杂代码检索、重构与自动化测试。",
      highlights: ["深度理解代码库上下文", "自动执行单测与修复", "轻量 CLI 零侵入接入"],
      targetAudience: "全栈工程师与命令行重度开发者",
      aiStatus: "ok"
    },
    latestDate: "2026-11-22",
    updatedAt: new Date().toISOString()
  }]
});
const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-gitpulse-timestamp": ts,
    "x-gitpulse-signature": sig
  },
  body
}).then(async (r) => console.log("HTTP", r.status, await r.text()));
'
```

预期输出：
```text
HTTP 200 {"code":0,"message":"ok","data":{"issueId":"2026-11-22_daily","issueNo":1,"upsertedRepos":1}}
```
再次重复执行同一命令，由于 `ingestIssue` 的幂等设计，返回的 `issueNo` 依然保持为 `1`，不会产生重复脏数据。

---

## 5. 一次性订阅消息模板申请与字段映射

### 5.1 申请一次性订阅消息模板

1. 登录 [微信公众平台](https://mp.weixin.qq.com/) → 左侧菜单 **「功能」 → 「订阅消息」** → 点击 **「开通」**。
2. 在 **「公共模板库」**（类型：**一次性订阅**）中搜索并选用一个包含 **2 个事物（`thing`）字段 + 1 个时间/日期（`time` 或 `date`）字段** 的模板，例如：
   - 常见可选模板标题：**「内容更新通知」「资讯更新提醒」「日报更新提醒」「订阅内容更新通知」**。
3. 勾选以下 3 类关键词并提交：
   - **项目/内容名称**（类型：`thing*.DATA`，如 `thing1`）
   - **更新内容/简介/温馨提示**（类型：`thing*.DATA`，如 `thing2`）
   - **更新时间/发布日期**（类型：`time*.DATA` 或 `date*.DATA`，如 `time3` 或 `date4`）
4. 添加成功后，在 **「我的模板」** 中：
   - 复制 **模板 ID**（填入第 3.3 节各云函数的 `SUBSCRIBE_TEMPLATE_ID` 及前端环境变量）。
   - 点击 **「详情」** 查看该模板的真实字段名（例如 `thing1`、`thing2`、`time3`）。

### 5.2 字段映射与微信 20 字长度限制自动保护

微信官方对订阅消息 `thing` 类型字段有严格限制：**长度不得超过 20 个字符，否则接口直接报错拒绝下发**。

[`cloudfunctions/sendDailyPush/index.js`](../cloudbase/cloudfunctions/sendDailyPush/index.js) 已内置全自动适配与截断逻辑：

| 环境变量名 | 默认字段名 | 填充内容来源 | 格式与安全截断规则 |
| :--- | :--- | :--- | :--- |
| `PUSH_KEY_TITLE` | `thing1` | 当日 Top 1（或用户偏好分类 Top 1）仓库名 + 今日新增 Star（如 `claude-code +1280★`） | 自动按 Unicode 码点安全截断至 **≤ 20 字**（超长尾部替换为 `…`，绝不截断 Emoji 代理对） |
| `PUSH_KEY_DESC` | `thing2` | 该项目的 AI 一句话核心价值 `ai.tagline`（降级取期刊 `summary`） | 自动按 Unicode 码点安全截断至 **≤ 20 字** |
| `PUSH_KEY_DATE` | `time3` | 当日北京时间日期 | 若 Key 以 `time` 开头自动格式化为 `2026年11月22日 08:30`；若以 `date` 开头自动格式化为 `2026-11-22` |

> **零改代码映射**：如果你在微信后台选用的模板字段名不是默认的 `thing1 / thing2 / time3`（例如是 `thing4 / thing7 / date2`），只需在 `sendDailyPush` 云函数环境变量中将 `PUSH_KEY_TITLE=thing4`、`PUSH_KEY_DESC=thing7`、`PUSH_KEY_DATE=date2` 改掉即可，无需修改任何一行代码！

---

## 6. GitHub Actions Secrets 配置与手动首跑验证

### 6.1 配置 GitHub 仓库 Secrets

将代码推送到你的 GitHub 仓库后，进入仓库页面 **「Settings」 → 「Secrets and variables」 → 「Actions」 → 「New repository secret」**，依次添加以下 Secrets：

| Secret 名称 | 示例值 / 说明 | 是否必填 |
| :--- | :--- | :---: |
| `CLOUDBASE_INGEST_URL` | `https://<你的环境ID>.service.tcloudbase.com/ingestIssue`（第 4.1 节获取） | **必填** |
| `INGEST_SECRET` | 第 3.1 节生成的 64 位随机十六进制密钥（与 `ingestIssue` 云函数环境变量严格一致） | **必填** |
| `LLM_BASE_URL` | OpenAI 兼容接口地址，**中国大陆公开上线建议优先使用国内已备案大模型**，例如 `https://api.deepseek.com/v1` 或通义千问/智谱兼容地址 | **必填** |
| `LLM_API_KEY` | 对应大模型服务商的 API Key (`sk-...`) | **必填** |
| `LLM_MODEL` | 模型名称，例如 `deepseek-chat`、`qwen-plus` | **必填** |
| `GH_PAT`（或默认 `GITHUB_TOKEN`） | GitHub Actions 默认自带 `secrets.GITHUB_TOKEN`；若需更高 REST API 速率配额可配置个人 Fine-grained Read-only Token | 选填 |
| `COMPLIANCE_EXTRA_BLOCKLIST` | 追加自定义内容合规拦截词（逗号分隔） | 选填 |
| `COMPLIANCE_ALLOWLIST` | 元数据误判豁免，格式 owner/repo#规则ID，逗号分隔 | 选填 |

### 6.2 手动触发首次抓取与入库验证

[`daily-sync.yml`](../.github/workflows/daily-sync.yml) 配置了每日北京时间 **07:30**（UTC `23:30`）自动运行，并支持 `workflow_dispatch` 手动触发：

1. 打开 GitHub 仓库顶栏的 **「Actions」** 标签页。
2. 在左侧选择 **「Daily GitPulse Sync」** 工作流 → 点击右侧 **「Run workflow」** 按钮。
3. 等待约 1~2 分钟任务变为绿色勾（Succeeded）：
   - 打开 **「微信云开发控制台」 → 「数据库」**：
     - 查看 `daily_issues` 集合：应出现 `${今日日期}_daily` 与 `${今日日期}_weekly` 文档，`issueNo` 为 `1`。
     - 查看 `repos` 集合：应出现 20+ 条包含完整 `ai.tagline`、`ai.whyHot`、`ai.highlights`、`ai.targetAudience` 的中文速览数据。

---

## 7. 前端构建、微信开发者工具导入与隐私保护指引配置

### 7.1 配置前端 AppID 与云环境参数并构建

1. 打开 `miniprogram/project.config.json`，确认 `"appid"` 已替换为你在第 1.1 节获取的真实小程序 **AppID**。
2. 在 `miniprogram/` 目录下配置生产环境变量（或在构建前设置）：
   - `TARO_APP_CLOUDBASE_ENV_ID=<你的云开发环境ID>`
   - `TARO_APP_SUBSCRIBE_TEMPLATE_ID=<你的订阅消息模板ID>`
3. 执行微信小程序生产构建：
   ```bash
   cd e:\Downloads\网页创作\gitpulse\miniprogram
   pnpm install
   pnpm build:weapp
   ```
4. 构建完成后，在 **微信开发者工具** 中点击 **「导入项目」**：
   - **项目目录**：选择 `e:\Downloads\网页创作\gitpulse\miniprogram`（含 `project.config.json` 的目录，其 `miniprogramRoot` 指向编译产物 `dist/`）或直接按 `project.config.json` 导入。
   - 在模拟器与真机预览中测试「今日」「发现」「我的」「项目详情」4 个页面，确认云函数调用正常、控制台 0 报错。

### 7.2 配置《用户隐私保护指引》（提审必配！）

由于小程序详情页与收藏夹提供了 **「一键复制 GitHub 链接」** 功能（调用了 `wx.setClipboardData`），根据微信最新隐私合规要求，**必须在后台声明剪贴板权限**，否则真机调用剪贴板或提审可能受阻：

1. 登录 [微信公众平台](https://mp.weixin.qq.com/) → **「设置」 → 「基本设置」 → 「服务内容声明」 → 「用户隐私保护指引」 → 点击「更新/配置」**。
2. 选择 **「本小程序收集你选中的信息」**，点击 **「+ 增加信息类型」**：
   - 勾选 **「剪贴板（Clipboard）」**（若后台列表中仅要求对读取剪贴板声明，也建议如实勾选或确认）：
     - **用途填写**：`仅在用户主动点击「复制 GitHub 链接」按钮时，将项目开源仓库地址写入系统剪贴板，方便用户在外部浏览器中访问。`
3. 确认未勾选任何多余的手机号、位置、相册、通讯录权限（GitPulse 仅使用云开发免登录天然注入的 `OPENID`，不收集昵称、头像、手机号或地理位置）。
4. 保存并等待隐私协议生效（通常 5 分钟内生效）。

---

## 8. 提交微信审核前终极自检表与提审备注模板

### 8.1 提审 10 项自检清单

在微信开发者工具点击右上角 **「上传」** 版本并前往微信公众平台 **「管理」 → 「版本管理」 → 「提交审核」** 前，请逐项核对：

- [ ] **1. 类目合规**：服务类目已设为 **「工具 → 信息查询」**，全站无任何评论框、发帖按钮或用户互动流。
- [ ] **2. 外链合规**：全站无任何 `<web-view>` 跳转外部未验证域名；点击仓库地址均走「一键复制 GitHub 链接」+ 友好提示。
- [ ] **3. 订阅合规**：首次进入小程序**绝不**自动弹窗索要订阅消息授权；仅在用户主动点击首页「预约明日推送」或「我的」页「补充推送额度」按钮时才触发 `wx.requestSubscribeMessage`。
- [ ] **4. 真实数据非空**：云数据库 `daily_issues` 与 `repos` 已至少入库 1 期真实数据（严禁空屏或满屏 `Lorem ipsum` 测试占位文字提审）。
- [ ] **5. 主包体积达标**：在微信开发者工具「详情 → 基本信息 → 本地代码」中检查主包体积严格 **< 2MB**（Taro 构建产物通常 < 500KB）。
- [ ] **6. 胶囊与安全区对齐**：自定义顶部导航栏右侧留出微信原生胶囊按钮避让区，底部 TabBar 与详情页底栏在全面屏手机上已适配 `env(safe-area-inset-bottom)`，无遮挡重叠。
- [ ] **7. 状态完备性**：首屏加载有 Skeleton 骨架屏；搜索无结果、筛选为空、收藏夹为空时有明确的 Empty 空态与引导按钮；断网时有 Error 重试按钮，无任何点不动/无响应的假死按钮。
- [ ] **8. 数据库权限封闭**：4 个云数据库集合权限均为 **「所有用户不可读写」**，全部通过 6 个云函数访问。
- [ ] **9. 定时推送就绪**：`sendDailyPush` 云函数已上传 `0 30 8 * * * *` 定时触发器，且 `MINIPROGRAM_STATE` 已设为 `formal`。
- [ ] **10. 隐私指引一致**：微信公众平台后台《用户隐私保护指引》已提交并生效，与小程序「我的」页内展示的隐私说明一致。
- [ ] **11. 微信小程序 ICP 备案**：已在微信公众平台完成个人主体微信小程序备案（实名核验通过）。
- [ ] **12. 内容合规与 AI 标识就绪**：已启用 3 层内容安全过滤（抓取前置黑名单 + AI 合规二审 + 云函数 `security.msgSecCheck`），后台接入国内已备案大模型，且前端卡片/详情页均已展示「AI 辅助生成」显著标识。

### 8.2 推荐提审版本说明（可直接复制粘贴至微信提审框）

> **版本描述 / 审核备注**：
> 本小程序为面向软件开发者的「开源技术项目信息查询工具」（服务类目：工具 -> 信息查询）：
> 1. **今日热榜**：查询每日/每周热门开源软件项目的功能简介、核心技术亮点与适用开发场景，支持按技术领域筛选与往期日期回看；
> 2. **发现检索**：支持按关键词、技术分类与编程语言检索历史收录的开源项目；
> 3. **我的收藏与订阅**：基于微信云开发自动同步个人项目收藏夹；用户主动点击「预约明日推送」按钮后可订阅每日更新提醒；不含任何注册登录墙、不含用户评论发帖等社交模块，无需测试账号即可直接体验全部功能。

### 内容复核与重试

部署前按集合清单创建仅管理员可读写的 moderation_pending。先部署 ingestIssue，再同步爬虫。复核记录以日期、周期、对象和文本生成唯一键，重复请求更新同一条记录。管理员核对原文并修正来源后，从同步入口重新送审。只有本次送审明确通过才可发布。接口故障触发爬虫有限重试，耗尽后工作流失败，需要恢复审核服务并重跑。首次联调应在独立测试环境从定时任务使用的 HTTP 入口验证实际发布结果。


---

## 附录：自动发布公开网页版 + RSS 源（GitHub Pages 零成本方案）

除了微信小程序，本项目已内置 **公开网页版（H5）+ 标准 RSS 2.0 (`rss.xml`) + JSON Feed 1.1 (`feed.json`)** 自动发布流水线，**无需服务器、无需备案域名、完全免费**，甚至在小程序尚未完成注册提审前就可以率先对外传播。

### 3 步开启自动发布

1. **推送代码到 GitHub 仓库**（公开或私有仓库均可，公开仓库免费支持 GitHub Pages）。
2. **开启 GitHub Pages（GitHub Actions 模式）**：
   - 打开仓库 `Settings → Pages → Build and deployment → Source`，选择 **`GitHub Actions`**。
3. **触发首次发布**：
   - 进入仓库 `Actions` 标签页，手动运行 **`GitPulse Daily Sync & Web Publish`**（或直接推送到 `main` 分支触发 **`GitPulse Deploy Public Web & RSS`**）。
   - 如果你尚未配置微信云开发密钥（`CLOUDBASE_INGEST_URL` / `INGEST_SECRET`），流水线会自动跳过云开发入库，直接用最新抓取的数据生成网页版与 RSS 源；配置好云开发密钥后则会**同时同步小程序与公开网页版**。

### 发布后你会获得 4 个公开地址

假设你的 GitHub Pages 网址为 `https://<你的用户名>.github.io/<仓库名>`（如需绑定自定义域名，在仓库 `Settings → Variables → Actions` 新增 `GITPULSE_SITE_URL` 即可）：

- **公开网页版首页**：`https://<你的用户名>.github.io/<仓库名>/`（手机端全屏、电脑端自动居中为 `430px` 极客晨报专栏）
- **RSS 2.0 订阅源**：`https://<你的用户名>.github.io/<仓库名>/rss.xml`（兼容 Folo、Feedly、Inoreader、Readwise Reader）
- **JSON Feed 1.1 订阅源**：`https://<你的用户名>.github.io/<仓库名>/feed.json`
- **最新公开数据快照**：`https://<你的用户名>.github.io/<仓库名>/snapshot.json`
