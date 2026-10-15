# 拾才 · 招新面试工作台 V1.0

学校工作室、社团线下面试使用的网页工具：收集报名表，现场搜索姓名，查看原表和材料，记录评价，再由面试官确认录用、候补或淘汰。

**版本：1.0.0** · [在线使用](https://campus-talent-desk.niftylily8.chatgpt.site/)

## 功能

- 腾讯文档复制粘贴，或导入 XLSX、CSV、TSV、ZIP；字段映射、预览、查重和附件关联。
- 检索姓名、班级、学号、电话、邮箱和原始字段；同名提醒与人工核对。
- 原报名表、PDF 和图片网页预览、DOCX 等附件下载。
- 五项面试评分与分段参考、备注、六种状态、批量结果、操作记录和撤回。
- 最多 5 个浏览器身份同时编辑，第 6 个等待；同浏览器多个标签页共用名额。
- 并发保存校验，避免覆盖另一位面试官已保存的同一报名。
- 云端 D1 保存报名和结果，R2 保存附件；CSV 导出、JSON 备份与合并恢复。

按项目要求使用公开、免登录的共享工作台。任何知道网址的人均可读取资料并申请编辑席位；面试官姓名只作署名。仓库只包含程序和虚构模板，不包含线上报名数据、附件、数据库或凭据。

## 开始使用

1. 在设置中确认工作室名称、招新批次和评分规则。
2. 按[报名表格式](docs/registration-format.md)收集信息，导入时核对重复项和材料归属。
3. 面试时搜索姓名，用班级、学号确认本人，打开详情记录评价与结果。
4. 面试结束后导出名单和 JSON 备份；附件文件需要另行下载。

详细操作与限制见[使用说明](docs/user-guide.md)。

## 开发与验证

需要 **Node.js 24+**、npm、Git。使用 Cloudflare Workers / Vinext / React，GitHub Pages 无法直接运行本项目服务端。

```sh
npm ci
npm run check
npm run build
npm run test:integration
```

集成测试自动创建独立本地 D1/R2，运行接口、附件和六会话模拟，不使用线上数据库；每次运行彼此隔离。报告写入被 Git 忽略的 `outputs/`。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务，默认端口 5173；先初始化本地数据库 |
| `npm start` | 预览已构建的 Worker |
| `npm run check` | TypeScript 检查、核心规则和编辑席位单元测试 |
| `npm run test:integration` | 独立本地库接口与五人并发回归；先构建 |
| `npm run format` / `npm run format:check` | 格式化 / 检查业务代码格式 |
| `npm run db:generate` | 数据结构变更后生成新迁移 |

环境、数据库初始化及发布步骤见[开发和部署](docs/development.md)。

## 代码导航

```text
app/                    页面入口、全局样式与 HTTP API
components/interview/   工作台、报名详情、导入、设置、PDF 与协作界面
lib/                    业务模型、导入、服务端写入、席位与版本常量
db/                     数据表定义及 D1 接入
drizzle/                按顺序执行的 SQL 迁移和元数据
tests/                  核心规则、席位、接口、五人协作测试
scripts/                启动、独立测试及 Sites 平台工具
build/                  Sites 构建插件和 Worker 入口
public/                 图标、PDF.js worker、字体与字符映射
docs/                   使用、报名格式、架构、接口、开发部署文档
.github/workflows/      GitHub 自动验证
.openai/hosting.json    当前 Sites 身份与存储绑定
```

[架构与数据流](docs/architecture.md) · [接口约定](docs/api.md) · [版本记录](CHANGELOG.md) · [第三方组件](THIRD_PARTY_NOTICES.md)
