# 腾讯文档收集结果自动同步

同步方向为腾讯文档 → 拾才。使用腾讯文档官方 MCP，服务器关闭浏览器后仍会运行。网页的手动粘贴来源链接不会自行启用同步。

## 准备结果表与授权

在表主账号中打开收集表的统计页，进入关联的智能表结果，记录结果表链接中的文档编号与 tab 参数。例如 `https://docs.qq.com/smartsheet/Dexample?tab=ss_example` 的 fileId 为 `Dexample`，sheetId 为 `ss_example`。

在[腾讯文档官方授权页](https://docs.qq.com/open/auth/mcp.html)获取个人 Token，保存为服务器 DATA_DIR 内的 `tencent-docs.token` 纯文本文件，权限为 600。Token 可操作账号中有权限的文档，本程序只调用该结果表的 `smartsheet.list_fields` 和 `smartsheet.list_records`，不向腾讯文档回写资料。不要将 Token 放进前端、Git、聊天或日志。

在 DATA_DIR 内创建权限为 600 的 `tencent-sync.json`：

```json
{
  "enabled": true,
  "sourceId": "registration-2026",
  "source": "https://docs.qq.com/form/page/Dexample",
  "fileId": "Dexample",
  "sheetId": "ss_example",
  "batch": "2026-autumn",
  "intervalSeconds": 120,
  "tokenFile": "tencent-docs.token"
}
```

batch 必须是已有招新批次编号。sourceId 是持久化关联标识，接入后不要随意更换。同一来源保留相同 fileId、sheetId 和批次。文件、数据库和 Token 均不进入仓库。

执行 `bash scripts/service.sh start` 启动网页和 `campus-talent-sync` 后台服务。直接运行独立部署包时，需另起一个进程，在相同 DATA_DIR 和工作目录下运行 `node registration-sync-worker.mjs`。PM2/AutoDL 开机脚本会自动启动两个进程。

## 日常操作

数据导入页展示是否启用、最近成功时间、下次同步、数量和错误，支持立即同步。默认每 120 秒完成一次拉取后再安排下一次；最短间隔 60 秒。失败自动退避，最长间隔一小时。可设置 `enabled:false` 暂停，替换 Token 后自动重试或点立即同步。

只同步姓名、班级、学号、电话、邮箱、自我介绍，兼容标题的“（必填）”。报名批次、方向、面试状态、评分、备注、面试官、创建时间和附件不会被覆盖。两边同时改同一字段时保留本地；核对后使本地值与腾讯值一致可消除该字段冲突。源表删除记录不会删除本地报名和面试结果。

完全相同且学号非空的重复答卷合并为一人，记住主答卷与别名，后续不会因顺序变化重复建人。重复答卷内容变得不一致、学号与联系方式指向不同学生、或已关联学生被本地删除时，会停止该轮写入并提示核对，不自动猜测归属。

分页中断、总数变化、编号重复、结构异常或校验失败均不会写入半批资料。重复拉取不改变候选人更新时间或工作台 revision；真实变化与同步关联在同一 SQLite 事务中提交。同步操作记录不能使用普通撤回，避免关联基线与名单不一致。

授权或调用额度错误会显示在同步面板。更新 Token 无需把它发给任何第三方服务。官方参考：[腾讯文档团队 MCP 接入说明](https://developer.cloud.tencent.com/mcp/server/11803)、[腾讯文档 MCP 概述与调用额度](https://docs.qq.com/open/document/mcp/)。
