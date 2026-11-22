# GitPulse CloudBase 后端工程

本目录包含 GitPulse（开源每日脉搏）微信小程序的微信云开发（CloudBase）服务端全部代码、数据库集合/索引清单及本地自动化单元测试。

## 目录结构

```text
cloudbase/
├── cloudbaserc.json              # CloudBase CLI / 云开发部署配置（6 个云函数 + 定时触发器）
├── package.json                  # 本地测试入口（零外部依赖，基于 Node 内置 node:test）
├── database/
│   └── collections.json          # 4 个云数据库集合、ADMINONLY 权限与索引清单
├── cloudfunctions/               # 6 个完全独立、无跨目录引用的云函数
│   ├── ingestIssue/              # HTTP 触发：HMAC-SHA256 验签 + ±300s 防重放 + 幂等入库
│   ├── getDailyIssue/            # 小程序端：拉取期刊、分类项目、近 14 期日期、收藏与订阅态
│   ├── searchRepos/              # 小程序端：关键词/分类/语言分页检索 + 收藏态
│   ├── bookmark/                 # 小程序端：按 OPENID 切换/分页查询云端收藏
│   ├── subscription/             # 小程序端：按 OPENID 查询/累加（单次 1~3 封顶）/偏好设置
│   └── sendDailyPush/            # 每日 08:30 定时触发：分批推送 Top 1 + thing ≤ 20 字截断 + 43101 自愈
└── tests/                        # 自动化单元测试（mock wx-server-sdk）
```

## 本地运行测试

需要 Node.js >= 18（推荐 Node 20/24）：

```bash
cd cloudbase
npm run test:verbose
```

## 正式部署与上线步骤

完整零歧义手把手配置与提审流程请参见 [docs/deploy-guide.md](../docs/deploy-guide.md)。
