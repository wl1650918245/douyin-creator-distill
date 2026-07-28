# GitHub 参考与产品决策

更新时间：2026-07-28

外部项目用于验证成熟产品模式，不直接替换本项目已经跑通的抓取主链。

| 参考项目 | 借鉴点 | 本项目决策 |
| --- | --- | --- |
| [TubeArchivist](https://github.com/tubearchivist/tubearchivist) | 订阅、重新扫描、队列、可检索本地资产 | “关注与更新”只发现增量，再由用户决定转写和分析 |
| [Postiz](https://github.com/gitroomhq/postiz-app) | 内容资产与分析模块分离 | 保留内容工作台、任务中心、分析资产三层，不把所有操作堆在首页 |
| [OpenAI Knowledge Retrieval](https://github.com/openai/openai-knowledge-retrieval) | 有来源回答、配置与评估分离 | 选题和智能体增加来源 ID、质量门禁和可重复浏览器测试 |
| [Nuwa Skill](https://github.com/alchaincyf/nuwa-skill) | 基于材料的认知蒸馏，不等同于模仿口头禅 | 博主智能体聚合多条材料，明确“不是本人”，保留证据不足项 |
| [MarketingSkills](https://github.com/coreyhaines31/marketingskills) | 内容策略与反向工程方法 | 爆款拆解后再生成选题，不从空白提示直接制造选题库 |

## 明确没有照搬

- 没有引入 TubeArchivist 的容器和服务架构。
- 没有引入 Postiz 的多人协作、社媒发布和云端账号体系。
- 没有把外部 Skill 当成不可审计黑盒；运行提示词保存在项目自己的 `skills/`。
- 没有因新增分析模块重写现有 Node、SQLite、Chrome Profile 和 JSON 证据链。
