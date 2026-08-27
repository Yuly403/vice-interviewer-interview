# 已知限制与未验证项

## 1. 跨进程实时推送

SSE 订阅者和 `publishEvent` 事件总线保存在进程内内存。API 与 Worker 分进程部署时不共享该内存，因此字幕或建议虽然可能已写入数据库，浏览器却未必立即收到事件。需要 Redis Pub/Sub、PostgreSQL LISTEN/NOTIFY 或事务 Outbox relay 才能形成可靠跨进程链路。

## 2. 飞书 E2E

代码包含 OAuth、会议查询、Minutes 产物和实时采集适配边界，但仓库没有真实凭据，也没有可证明生产权限、网络、长会议稳定性和回调配置均通过的记录。不能声称真实飞书 E2E 已完成。

## 3. 会前来源引用

Topic / Criteria 支持 `sourceRefs` 数据结构，编辑路径有校验，但当前计划生成路由没有像会后 Review 一样对模型输出逐条建立和原文片段的硬绑定。会前内容仍需面试官核对。

## 4. 产品效果

现有自动化测试属于工程验证，没有完成 Golden Dataset、历史时点回放、Suggestion Precision、Coverage、Redundancy、Evidence Accuracy、Latency 或 Silence Quality 的真实测量。

## 5. 上游招聘系统

脱敏版从标准 Interview Package 开始，不包含真实 ATS 的账号、API 映射、候选人授权或自动同步实现。手工/合成导入可验证后续链路，但不是最终企业工作流。

## 6. 运行与运维

仓库故意排除了生产 migration、Docker/网关配置、日志、备份、监控、容量数据和密钥管理。它适合代码审阅和本地技术验证，不是可直接上线的部署包。

## 7. 权利边界

自动工具无法判断公司代码的知识产权和保密义务。即使内容已脱敏，提交者仍须取得对外展示许可，并人工复核所有核心源文件和第三方依赖许可。

