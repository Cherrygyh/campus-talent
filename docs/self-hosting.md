# 自有服务器部署

V1.1 使用 Next.js / Node.js、SQLite 和磁盘附件存储，不需要 ChatGPT Sites 或 Cloudflare 资源。

## 构建与直接运行

需要 Node.js 24+。请在服务器上安装和构建，避免将 macOS 原生依赖直接复制到 Linux。

```sh
npm ci
npm run check
npm run lint
npm run format:check
npm run build
npm run test:integration
```

在项目根目录执行 `npm start`，默认使用 3000 端口及项目的 data 目录。也可以独立部署 `.next/standalone/`，其中已包含静态资源、公开文件及 SQL 迁移：

```sh
cd .next/standalone
DATA_DIR=/srv/campus-talent-data APP_ORIGIN=https://interview.example.com HOSTNAME=0.0.0.0 PORT=3000 node server.js
```

APP_ORIGIN 应填写浏览器实际访问的来源，包含非标准端口。首次访问 API 自动创建数据库、按顺序应用迁移；重启只执行新增迁移。已应用的 SQL 文件会校验内容，不要修改旧迁移。

| 变量       | 用途                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| DATA_DIR   | 数据和附件目录；生产环境使用独立于构建产物的绝对路径                      |
| APP_ORIGIN | 浏览器来源，如 https://interview.example.com:8443；HTTPS 代理部署必须设置 |
| PORT       | HTTP 端口，默认 3000                                                      |
| HOSTNAME   | 监听地址；通过平台映射访问时使用 0.0.0.0                                  |

服务账号需要有 DATA_DIR 的写权限。网页使用单个进程，不使用 PM2 cluster 或多个网页副本共享同一目录。腾讯文档同步由独立后台进程执行，使用 SQLite 租约与事务协调写入。

## PM2 与服务管理

先安装 PM2，再复制配置示例：

```sh
npm install -g pm2@6
cp .env.service.example .env.service
command -v node
command -v pm2
```

编辑 .env.service，将 NODE_BIN、PM2_CLI 替换为当前机器的绝对路径，并填写 PM2_HOME、PORT、DATA_DIR、APP_ORIGIN。配置是由 Bash 读取的环境变量文件，不进入 Git。PM2_CLI 可以使用 `command -v pm2` 返回的入口。

```sh
bash scripts/service.sh start
bash scripts/service.sh status
bash scripts/service.sh health
bash scripts/service.sh logs
bash scripts/service.sh restart
```

start 是幂等的：分别检查网页和同步进程，已运行的进程保持运行，缺失的进程会启动；restart 会应用新构建及配置。PM2 在 SSH 断开后继续运行，并在应用退出时重启进程。[腾讯文档自动同步配置](tencent-sync.md)只保存在私有 DATA_DIR。

普通 Linux/systemd 主机可按 `pm2 startup` 输出注册开机服务。执行时要使用同一个 Node.js、PM2 和 PM2_HOME，不要额外注册另一份应用。

## AutoDL 开机启动

AutoDL 的这类容器通过 PID 1 启动脚本读取 /etc/profile，不能依赖普通 systemd 服务。项目提供对应入口，需在实例内以 root 安装：

```sh
bash scripts/install-autodl-startup.sh
```

安装前需要存在 .env.service 和已经构建的 `.next/standalone/server.js`。安装位置：

- /etc/profile.d/campus-talent-autostart.sh：只在 PID 1 的开机流程触发，普通 SSH 登录不触发。
- /usr/local/lib/campus-talent/boot-start.sh：等待数据盘、启动服务、检查 API；启动失败自动重试。
- /etc/campus-talent-autostart.conf：记录项目绝对路径。
- /tmp/campus-talent-boot.log：当次开机启动记录。

启动过程在后台运行，不阻塞实例内置服务；使用文件锁及 PM2 单进程检查防止重复启动。可使用干净环境模拟开机入口：

```sh
env -i PATH=/usr/bin:/bin CAMPUS_TALENT_BOOT_CHECK=1 /bin/bash -lc true
cat /tmp/campus-talent-boot.log
bash scripts/service.sh health
```

上述模拟不会重启整台实例。若要做完整的关机再开机验收，请先保存其他应用的任务，再通过实例控制台操作；重新启动后检查同一个公网地址和启动记录。

AutoDL 通过“自定义服务”映射端口；本项目可使用空闲的 6008 端口，把 APP_ORIGIN 设置成控制台对应的 HTTPS 地址。平台负责 TLS，6006 端口上的其他服务可以继续使用。实例关机期间网站不可用。参考 [AutoDL 端口说明](https://api.autodl.com/docs/port/)。

## 更新与回滚

使用新的目录构建和测试，保留正在运行的旧部署及独立数据目录。验证通过后停服务、备份 DATA_DIR，切换部署目录，再启动：

```sh
bash scripts/service.sh stop
# 备份完整 DATA_DIR，切换到已验证的新部署目录并保留 .env.service
bash scripts/service.sh start
bash scripts/service.sh health
```

需要回滚时恢复旧部署目录和原配置；如果新版本包含结构迁移，还需恢复与旧版本兼容的完整数据备份。不要删除 data 目录或忽略数据盘上的旧资料。

## Docker Compose

```sh
APP_ORIGIN=https://interview.example.com docker compose up -d --build
docker compose logs --tail=100
```

配置默认暴露在主机 `127.0.0.1:3000`，由 Nginx/Caddy 提供域名和 HTTPS。数据保存在命名卷 campus-data；使用相同的 Compose 项目和卷更新，不要运行 `docker compose down -v`。Docker daemon 需要已经设置随系统启动。此模板尚未进行 Docker 环境实测；本版本验证了 Node.js 独立部署。

## Nginx 示例

在已配置 TLS 证书的 server 块中加入：

```nginx
client_max_body_size 12m;
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_buffering off;
}
```

APP_ORIGIN 也应使用该 HTTPS 来源。附件通过 API 提供，不要把磁盘附件目录直接公开为静态目录。

## 备份与旧站迁移

DATA_DIR 内的 campus-talent.sqlite、WAL/SHM 文件及 attachments 目录共同组成完整数据。最简单的一致备份方式是先停止服务，打包整个 DATA_DIR，再启动服务。不要在数据库运行时只复制 SQLite 主文件。

GitHub 不包含旧 chatgpt.site 上的报名和附件。需要迁移时，在旧站导出 JSON 备份，在新站恢复；附件文件需要另外下载并关联上传。旧站不会自动同步。

实现参考：[Next.js 独立输出](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)、[Node.js SQLite](https://nodejs.org/api/sqlite.html)。
