# HTTP 接口约定

API 服务一个公开共享工作台，JSON 响应为 `Cache-Control: no-store`。完整数据类型见 `lib/talent.ts`。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET | `/api/state` | 配置、报名、附件元信息、最近 100 条操作、revision |
| POST | `/api/state` | 保存、导入、设置、批量结果、撤回、恢复 |
| GET | `/api/registration-sync` | 自动同步状态、最近成功时间、数量与冲突，不含 Token |
| POST | `/api/registration-sync` | 立即同步，需有效编辑席位和同源校验；与后台共用互斥租约 |
| GET | `/api/presence` | 上限、在线浏览器数、署名列表 |
| POST | `/api/presence` | `join` 入场/续期，`leave` 释放标签页会话 |
| POST | `/api/files` | multipart 字段 `candidateId`、`file` |
| GET | `/api/files/:id` | 读取附件 |
| DELETE | `/api/files/:id` | 删除附件 |

## 席位

```json
{
  "op": "join",
  "clientId": "browser-uuid-at-least-16-characters",
  "sessionId": "tab-uuid-at-least-16-characters",
  "name": "面试官姓名"
}
```

编号为 16–80 位字母、数字、下划线或短横线。成功 200，名额满 429。返回 `admitted`、`limit`、`count` 和只含署名的 `members`，不暴露他人会话编号。15 秒续期，60 秒到期。

## 状态变更

状态与附件写入必须携带自己的有效席位头：

```text
x-editor-client: <clientId>
x-editor-session: <sessionId>
x-interviewer-name: <encodeURIComponent(署名)>
```

如提供 Origin 必须同源；署名不承担登录认证职责。`POST /api/state` 公共字段为 `op` 与读取到的 `revision`。

| op | 额外字段 |
| --- | --- |
| `save` | `candidate`，已有报名需 `expectedUpdatedAt` |
| `import` | `candidates`，每次 1–500 人 |
| `restore` | `candidates`、`config`，合并恢复 |
| `bulk` | `ids`、`status`、`reason` |
| `settings` | `config`、`expectedConfig`（当前配置 JSON 字符串） |
| `interviewRubric` | `expectedConfig`，采用五问题规则，归档旧规则 |
| `clearDemo` | 无，仅清理显式标记为 demo 的报名 |
| `undo` | `eventId` |

成功返回最新快照及 `message`。错误为 `{ "error": "说明" }`：400 校验失败、403 来源不符、409 版本冲突、413 请求过大、423 无编辑席位、429 入场满员、503 存储未连接；附件不存在可返回 404。
