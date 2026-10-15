# 开发、验证和发布

## 首次运行

使用 Node.js 24+、npm、Git，按锁文件安装，无需腾讯文档或 AI API key。

```sh
npm ci
npm run check
npm run build
```

本地初次开发按顺序执行两个迁移，仅初始化 `.wrangler/state`，不接触线上数据库：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_fuzzy_proudstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_swift_tomorrow_man.sql
npm run dev
```

已应用的迁移不要重放。后续修改结构新增迁移，不改旧 SQL 和元数据。`npm run dev -- --port 5186` 改开发端口，`npm start -- --port 5186` 预览构建产物。

Windows 若遇 npm shim 错误，可用实际 npm CLI，例如 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" ci`。构建使用 `npm run build`，由 `scripts/run-framework.mjs` 处理平台差异。

## 验证

```sh
npm run check
npm run format:check
npm run build
npm run test:integration
```

集成测试新建 `.wrangler/integration/<随机编号>/state`，应用迁移后用 Miniflare 直接运行构建后的 Worker，随机本地端口、虚构报名与附件彼此隔离，不读取个人开发库，不允许指向线上。结束后关闭服务，数据与报告被 Git 忽略。不要直接对使用中的数据库运行单个接口测试文件。

Windows 本地 workerd 在未读取请求体就拒绝请求时，复用 HTTP 连接可能被重置；测试辅助函数在 Windows 使用独立连接并完整读取响应。Linux CI 保持默认连接复用，业务代码不受此设置影响。

Node 内置 SQLite 可能显示 ExperimentalWarning，这是测试环境提示。GitHub Actions 使用同样命令验证推送与 PR；CI 不包含发布凭据，不自动部署。

## Sites 发布

线上运行于 Sites 的 Cloudflare Worker，D1 为 `DB`，R2 为 `BUCKET`。`.openai/hosting.json` 记录站点身份与绑定，不是密码；维护当前网站需保留，独立副本需通过 Sites 注册新身份。

使用 Sites 官方技能流程：读取当前站点及访问配置，打开受支持的源码工作流，检查、构建、同步源码，保存同一提交的部署包，再发布保存版本。保留当前公开访问方式；Sites 在发布时应用线上迁移。

`build/sites-vite-plugin.ts`、`build/sites-worker.ts`、`vite.config.ts` 与平台脚本是运行集成的一部分，不作为缓存删除；`dist/` 为可生成产物。

上传 GitHub 不会自动部署网站，也不上传 D1/R2。GitHub Pages 不能承载本项目 API。V1.0 提供 Sites 部署方式，迁往其他 Cloudflare 账号还需自行配置资源和发布流程。

## 版本管理

- `package.json` 与 `lib/version.ts` 保持 `1.0.0`；页脚显示版本。
- 记录 `CHANGELOG.md`，使用 `v1.0.0` 标签定版。
- 首次公开上传采用整理后的独立源码快照，不携带本地旧历史。
- `.env*`、`node_modules/`、`dist/`、`.wrangler/`、`.sites-runtime/`、`outputs/`、TypeScript 缓存不入库。
- 报名数据库、附件、备份单独管理，不属于源码发布。
