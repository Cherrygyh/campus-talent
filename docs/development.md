# 开发、验证和发布

默认部署目标为自有 Linux 服务器。需要 Node.js 24+、npm 和 Git，不需要 Sites 或 Cloudflare 凭据。

```sh
npm ci
npm run check
npm run dev
```

开发服务默认位于 http://127.0.0.1:5173。首次使用 API 会自动在项目 data 目录建立 SQLite 数据库、应用迁移，并创建附件目录。通过 DATA_DIR 可选择其他数据目录。

```sh
npm run format:check
npm run lint
npm run build
npm run test:integration
```

构建使用 Next.js，生成完整的 `.next/standalone`。集成测试启动该生产构建，并使用 outputs 下每次新建的独立数据库，运行首页、接口、附件、五人协作、冲突和服务重启后的数据保留验证。不会使用开发库或线上库；不要直接对使用中的数据库运行单个接口测试文件。

Node.js 24 的内置 SQLite 可能显示 ExperimentalWarning。GitHub Actions 使用相同命令验证推送和 PR，不自动部署。

新增数据结构请通过 npm run db:generate 生成迁移。已应用的 SQL 不要修改或重放；启动时会检查迁移哈希，变更旧 SQL 会报错。

详细的 Node.js、PM2、Docker、Nginx、AutoDL 和备份步骤见[自有服务器部署](self-hosting.md)。

V1.1 已移除旧 Sites 构建源码、Cloudflare 绑定和相关依赖。服务管理与 AutoDL 开机启动使用 scripts/ 和 deploy/autodl/ 中的脚本。GitHub Pages 无法运行此项目服务端。

报名数据库、附件、备份、环境文件及构建产物不入库。修改版本时请保持 package.json 与 lib/version.ts 一致，并更新 CHANGELOG.md。
