# CreatorDistill 文档

这些文档是 `douyin-creator-distill` 独立项目的产品与工程规则，不依赖旧工作流才能理解。

- `product-engineering-charter.md`：产品边界、安全规则、修改确认与验收纪律。
- `账号体系规格.md`：内容采集账号、收藏夹账号及共用/独立登录规则。
- `data-contract.md`：标准 JSON 证据契约与审核门禁。
- `task-history-contract.md`：任务状态、抓取归档、关注博主与增量基线。
- `状态管理契约.md`：作品唯一身份、任务与单作品状态不变量。
- `状态与数据流图.md`：抓取、审核、作品总账和下游处理的全链路。
- `任务恢复与重试矩阵.md`：不同错误类型的重试、暂停和人工处理规则。
- `状态表迁移方案.md`：从现有 JSON 与 SQLite 任务记录回填统一状态。
- `adr/0001-采用作品总账统一状态.md`：采用作品总账架构的决策与取舍。
- `product-architecture.md`：页面职责、模块关系和数据流。
- `analysis-output-contract.md`：爆款拆解、选题库与博主智能体输出。
- `本地转写运行环境.md`：FFmpeg、Whisper、模型和依赖诊断边界。
- `iteration-status.md`：已验证能力、未完成事项和迭代证据。
- `Demo验收说明.md`：当前可用 Demo 的验收路线、真实产物和已知边界。
- `GitHub参考与产品决策.md`：外部项目中已借鉴和明确未照搬的做法。
- `开源发布与品牌规划.md`：公开仓库前的命名、定位、README、许可证与发布节奏。
- `../SECURITY.md`：密钥、Cookie、路径、本地接口和漏洞报告规则。
- `../CONTRIBUTING.md`：开发、测试、Pull Request 和脱敏要求。

当前产品已经接入本地编排、SQLite、真实目录抓取、收藏夹选择式抓取、双通道转写、爆款拆解、证据选题和博主智能体。收藏夹已完成单个子文件夹真实回归；全选 35 个收藏夹的数量对账仍未完成。
