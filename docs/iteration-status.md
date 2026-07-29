# CreatorDistill 迭代状态

Last reviewed: 2026-07-28

## Purpose And Update Rule

This file is the working baseline for future product iterations. Update it only when there is implementation evidence, a completed test, or an explicit product decision.

- `Implemented` means code exists locally.
- `Verified locally` means syntax, local API, or local file evidence was checked.
- `Externally verified` means a real Douyin or Get Notes request completed and its evidence was retained.
- Do not upgrade a status based only on a planned design or a passing static check.

## Current Product State

### Product Boundary

The product is a single-user local application. Its main chain is:

```text
Douyin source -> directory crawl -> JSON audit -> user confirmation -> text enrichment -> analysis
```

JSON is the first evidence layer. The product must not automatically call Get Notes, transcribe, analyze, or index content before the user selects works and confirms the next stage.

### Runtime And Storage

| Item | Status | Evidence / Limit |
| --- | --- | --- |
| Local web service | Implemented and verified locally | Runs at `http://127.0.0.1:8780/`. |
| Asset root | Implemented and verified locally | Default: `%USERPROFILE%\Documents\DouyinKnowledgeAssets`. |
| Runtime SQLite | Implemented and verified locally | `.runtime\agent-state.sqlite` stores workflow state, not the source evidence. |
| Source evidence | Implemented and verified locally | Raw exports live in `raw\douyin-analysis\<account>\*.json`. |
| Cold start | Verified locally | SQLite task, crawl-run, and transcript-job rows were cleared on 2026-07-14. Raw JSON was retained but is not displayed. |

### Directory Crawl

| Item | Status | Evidence / Limit |
| --- | --- | --- |
| Dedicated Chrome profile and serial lock | Implemented | Only one process may use the Douyin profile at a time. |
| Profile crawler migrated into this subproject | Implemented and verified locally | No import from the legacy workflow runtime. |
| CLI real-data regression | Externally verified | An anonymized regression account produced one retained JSON with 104 works: 99 videos and 5 image posts. |
| Web-page initiated crawl | Externally verified | 2026-07-18: an anonymized regression account produced an audited JSON directory with 107 works: 102 videos and 5 image posts. |
| JSON audit | Implemented and verified locally | Checks count, required fields, and unique work IDs before a run is presented as ready. |
| 目标驱动抓取 Loop | 已实现、本地测试通过并完成首轮真实回归 | 两轮 Chrome 后才允许内部接口补充；每轮产物按 `videoId` 合并，尝试记录写入 `task_attempts`。`feitianshanke` 首轮 Chrome 真实抓取通过；恢复轮和接口补充未被此次成功任务触发，仅完成自动化验证。 |
| 风控熔断 | 已实现并完成本地测试 | 登录失效、验证码、`403`、`429` 进入 `waiting_for_action`，不会继续重试或切换接口。 |

### 账号中心与收藏夹

| 项目 | 状态 | 证据 / 边界 |
| --- | --- | --- |
| 产品品牌 | 已实现并完成本地检查 | 页面标题、侧栏品牌和重启提示统一为“自媒体工作台”。 |
| 双用途账号 | 已实现并完成本地检查 | 内容采集账号负责公开主页和单条作品；收藏夹账号只负责当前登录账号自己的收藏夹。 |
| 共用/独立登录 | 已实现并完成本地检查 | 默认共用同一 Profile；用户可切换为独立 Profile。公开 API 不返回 Profile 路径或 Cookie。 |
| 任务来源追溯 | 已实现并完成本地检查 | SQLite 任务保存 `sourceMode`、`accountRole`、`profileId`；标准 JSON 保存同名 `sourceContext`。 |
| 收藏夹目录适配器 | 已实现并完成首轮真实回归 | 已支持“先发现收藏夹目录、再选择子文件夹、最后分页抓取作品”；跨子文件夹按 `videoId` 去重，使用收藏夹账号 Profile，任务参数写入 SQLite。2026-07-26 实测发现 35 个收藏夹；选择 `AI` 收藏夹后读取 19 页，得到 347 条唯一作品，279 条视频、68 条图文，JSON 审核通过。全选 35 个收藏夹的数量对账仍未完成。 |

参考 `jiji262/douyin-downloader` 的收藏夹登录边界和来源隔离，但未把该 Python 项目耦合为本产品依赖。完整规则见 `docs/账号体系规格.md`。

### Progress Reporter

The crawl path uses a local `ProgressReporter` pattern adapted from `douyin-downloader`.

```text
crawler emits structured progress event
-> local orchestration persists it in SQLite
-> page polls the local API once per second while a submitted crawl is active
-> workbench and Task Center render the latest persisted stage
```

- Events are structured JSON lines, not inferred from Chinese console text.
- Stages include Chrome startup, login/page opening, profile count recognition, collection rounds, deduplication, JSON export, and JSON audit.
- The task view shows stage, discovered count, expected total when available, start/update time, and a collapsible recent-log tail.
- No percentage is shown before a denominator is known. A count ratio is shown only when a real expected total is available.
- SQLite persistence means a page refresh does not lose the most recent task state or log tail.
- This is implemented locally. A new externally verified crawl is still required to validate every emitted stage in the page.

### 双通道文本提取

当前产品没有隐藏的“唯一主通道”。用户每次提交时选择“云端优先”或“Whisper 优先”，系统只按已展示并确认的规则续接备用通道，批次总数不受 100 条限制。

```text
User selects audited works
-> confirms count and quota impact
-> create Get Notes link note
-> poll task progress
-> read note detail
-> save Markdown text and per-work status
```

| Item | Status | Evidence / Limit |
| --- | --- | --- |
| `save -> progress -> detail` service | Implemented | Uses the project-local Get Notes configuration only in the local backend. |
| Rate limit guard | Implemented | Requests are serialized with at least a 2-second interval. |
| Per-work state | Implemented | SQLite records provider, provider task ID, note ID, status, error, and output path. |
| Text output | Implemented | Markdown is written below `raw\get-notes\<account>\<videoId>.md`. |
| Real Get Notes API request from this new product | Externally verified | 2026-07-18: video `7663157184638105158` completed through `save -> progress -> detail`; Markdown and note ID `1915925745428633464` were retained locally. |
| 优先级续接 | 已实现并自动化验证 | 云端额度耗尽后续接 Whisper；Whisper 图文或单条失败后续接云端；普通云端网络错误仍按有限重试处理。 |

### Viral Breakdown

| Item | Status | Evidence / Limit |
| --- | --- | --- |
| Project-local model configuration | Implemented and verified locally | `config/model.config.json` is Git-ignored. The service does not read `DEEPSEEK_*` or other computer-wide model environment variables. |
| Confirmed analysis boundary | Implemented and verified locally | Only selected works in an audited directory with completed local Get Notes Markdown can be sent; the UI asks for confirmation before the request. |
| Evidence-linked Markdown report | Implemented and verified locally | Reports are written to `analyses\viral-breakdowns\<douyin-id>\` with source JSON path, transcript paths, selected work IDs, model name, and local creation time. |
| Persistent analysis task and report history | Implemented and locally regression-tested | Confirmed requests enter a serial local analysis queue; SQLite retains task/report status, selected work IDs, output path, error, duration, and model usage. The page can reopen a completed report, open its folder, or submit the same evidence as a new report. |
| First real model request | Externally verified | 已保留飞天闪客 3 条作品和姜胡说 1 条作品的成功拆解报告；模型为 `deepseek-v4-flash`。 |
| Project-local analysis skill | Implemented and statically verified | `skills/viral-breakdown/SKILL.md` is loaded by the backend; global Codex/Claude skills are not required at runtime. |
| Upstream methodology snapshots | Installed and pinned | All 47 Marketing Skills plus Nuwa and MrBeast are stored below `skills/vendor/`; exact source commits and the Marketing Skills inventory are recorded in `skills/vendor-lock.json`. These are reference assets and are not all invoked for every analysis. The Nuwa snapshot currently includes about 34 MB of upstream examples and promotional assets pending a safe packaging trim. |

### 本地 Whisper 独立运行边界

`douyin-downloader` 只作为经验参考，不是本产品依赖。当前 Agent 已拥有独立的 Cookie 导出、媒体下载、FFmpeg、faster-whisper、模型、Python 环境、任务状态和产物目录。

- 用户必须明确选择优先级；只有额度耗尽、图文路由或本地单条失败满足已确认规则时才切换通道。
- 默认 CPU `int8`、单执行位，避免抢占本机资源。
- 默认删除下载视频和临时音频，只保留 Markdown、JSON、SRT 与 manifest。
- 爆款拆解和知识蒸馏优先使用 Whisper 时间轴原文；没有 Whisper 时使用云端原文。
- 详细安装、诊断和打包边界见 `docs/本地转写运行环境.md`。

## Task-State Model

| State | Meaning |
| --- | --- |
| `queued` | Waiting for the local serial executor. |
| `running` | Local executor is processing the task. |
| `waiting_for_action` | 登录、验证码或限流要求人工处理；自动请求已停止。 |
| `waiting_for_user` | JSON or text result is ready; the next external or analytical step needs user confirmation. |
| `partial` | Some output exists, but at least one required item failed or is incomplete. |
| `failed` | No usable result; user action is required. |
| `interrupted_recoverable` | The local service restarted while work was active; do not assume the external operation completed. |

## Next Iterations

### P0: Demo 反馈闭环

1. 使用 1 至 3 位外部体验者完成“目录 -> 转写 -> 拆解 -> 选题”的无人工协助测试。
2. 记录每位体验者卡住的位置、完成时间、失败原因和是否愿意继续使用。
3. 对收藏夹全选 35 个子文件夹做一次完整数量对账。

### P1: Product Reliability

1. 为模型任务加入请求级重试和熔断，避免短时网络波动产生重复资产；目录抓取和转写批处理 Loop 已完成，不代表模型任务已经具备同等恢复能力。
3. 为本地调度器增加可选 Windows 开机自启；当前只有本地服务运行时才执行定期检查。
4. 对一个已确认博主重新抓取，使用真实响应验证 `authorAvatarUrl`；旧 JSON 继续使用姓名首字回退。

### P2: Analysis And Fallback

1. 为选题增加“采用、改写、归档、已发布”和效果回填状态。
2. 为博主智能体增加材料覆盖图，提示主题或时间样本偏科。
3. 增加 Demo 反馈导出，形成可排序的问题和需求池。

## Non-Negotiable Operating Rules

- Do not send all crawled works to Get Notes automatically.
- Keep JSON, text, analysis, and runtime state in separate directories.
- Treat API keys, browser cookies, and local profiles as secrets; never expose them in the page or logs.
- Treat static checks as code validation, not platform success evidence.
- Record real count reconciliation, login state, quota behavior, and platform failures with the related task or archive evidence.

## Change Log

| Date | Change | Verification |
| --- | --- | --- |
| 2026-07-14 | Local orchestration, SQLite state, crawl archive, and real JSON loading added. | Static checks and local API checks passed; one prior CLI crawl JSON was inspected. |
| 2026-07-14 | Cold-start reset cleared SQLite task, archive, and transcript-job records while retaining raw JSON. | Post-reset API returned zero tasks and zero runs. |
| 2026-07-14 | Get Notes transcription service and explicit page confirmation entry added. | Static checks and invalid-request rejection passed; no real Get Notes request was made at that time. |
| 2026-07-14 | Structured crawl progress, persisted task progress, and live log-tail UI added. | Static checks passed; requires a future real crawl to validate all page stages. |
| 2026-07-18 | Page-started directory crawl and single-work Get Notes transcription completed. | Audited directory: 107 works; Get Notes note ID `1915925745428633464`; Markdown retained in the configured asset root. |
| 2026-07-18 | Get Notes completion gate aligned with the verified legacy pipeline. | When a provider task ID exists, the new product now waits for `success` and its returned note ID before reading and saving note detail. |
| 2026-07-18 | Added a project-local, confirmed viral-breakdown chain. | Syntax, health endpoint, invalid-request rejection, and empty-config guard passed. No model request was made. |
| 2026-07-18 | Moved text-extraction credentials to a project-local configuration file and hid provider branding in the operating UI. | Both configuration files are Git-ignored; static checks and local health check passed. |
| 2026-07-25 | 建立独立的本地 Whisper 通道。 | FFmpeg、faster-whisper small 模型、Python 3.12 虚拟环境和 yt-dlp 已收口到当前 Agent；`npm run doctor` 全部通过。 |
| 2026-07-25 | 完成真实抖音视频本地转写闭环。 | 作品 `7562030607925120256` 已完成 Cookie 导出、下载、FFmpeg、Whisper、Markdown/JSON/SRT/manifest 落盘和 SQLite 状态更新。 |
| 2026-07-25 | 增加双通道手动选择和设置中心。 | 页面提交时明确选择云端链接提取或本地 Whisper；作品展示实际通道；分析证据优先 Whisper。 |
| 2026-07-29 | 将双通道升级为不限总数的优先级批处理。 | 云端优先在 100 条参考值或错误码 19 后续接 Whisper；Whisper 优先在图文或本地失败后续接云端；路由、配额和批处理测试通过。 |
| 2026-07-18 | Added a persistent creator-distillation material pool. | Local SQLite schema, pool API empty-state check, and static checks passed; it does not invoke a model. |
| 2026-07-18 | Installed three pinned reference skills and added a product-owned viral-breakdown runtime skill. | Runtime prompt now comes from the project repository and includes account-relative ranking, cross-work validation, evidence/inference separation, and explicit missing-data boundaries. No model request was made. |
| 2026-07-18 | Expanded the project-local marketing reference library to the complete 47-skill `coreyhaines31/marketingskills` set. | Every upstream skill has a local `SKILL.md`; the bundle is pinned to commit `67264763cb107d61749f418d081c56e5bcbc0209` and remains separate from the product-owned runtime skill. |
| 2026-07-18 | Closed the persistent viral-breakdown task and report-history loop. | Isolated API and headless-browser regression passed without a real model call: report list returned 200, invalid submissions returned 400, report history rendered, and no page errors occurred. A real confirmed report remains the next acceptance step. |
| 2026-07-18 | Rebuilt Followed Creators as a master-detail asset workspace. | A copied real SQLite baseline rendered two creators; Playwright verified that selecting the second creator updates the right-hand detail panel, preserves global totals, and produces no page errors. |
| 2026-07-21 | Split JSON audit findings into blocking errors and non-blocking title warnings, and added local re-audit for existing evidence. | The real `jianghushuo` JSON passed with 630/630 unique works, 18 title warnings, and zero blocking omissions; SHA-256 was unchanged before and after audit. An isolated SQLite/API regression changed the copied task to `waiting_for_user` without adding a crawl run. |
| 2026-07-21 | 增加 API 能力版本、持久化爆款拆解失败反馈、博主级转写关联和可选头像采集。 | 健康检查与报告 API 均返回 200。Playwright 成功渲染 3 位博主和 5 条去重后的已完成转写资产，其中包含 `jianghushuo` 的真实作品 `7664622271004265734`，页面无报错。一次已确认的真实爆款拆解任务完整记录了三个进度阶段，但模型请求因 `ETIMEDOUT 198.18.0.12:443` 失败，未生成报告。头像采集代码已完成，但要等下一次真实抓取返回该可选字段后才能确认有效。 |
| 2026-07-26 | 建立双用途账号中心并将产品品牌改为“自媒体工作台”。 | 账号配置、共享/独立绑定、登录状态隔离、任务来源字段、公开 API 脱敏和浏览器 UI 回归均已实现；当时收藏夹目录适配器尚未接入，后续已补齐并完成首轮真实回归。 |
| 2026-07-26 | 修复账号登录成功后页面反馈不明显的问题。 | 账号请求禁用缓存；页面重新聚焦立即刷新；已验证账号使用绿色状态卡；登录中按钮锁定以避免重复启动。收藏夹独立 Profile 已实测返回 `login_ready`。 |
| 2026-07-26 | 增加当前页面记忆。 | 左侧页面写入浏览器本地状态；刷新后恢复原页面，无效页面键自动回退内容工作台。Playwright 已验证任务中心刷新后保持不变。 |
| 2026-07-26 | 接入收藏夹目录发现与选择式抓取链路。 | 新增独立收藏夹浏览器适配器、游标分页、跨文件夹 `videoId` 去重、标准 JSON 输出、收藏夹选择弹窗和任务中心入口；静态、纯函数、账号契约、页面无报错检查均通过。真实回归发现 35 个收藏夹；`AI` 收藏夹读取 19 页并导出 347 条唯一作品，审计通过。 |
| 2026-07-26 | 扩大左侧账号中心卡片热区。 | 账号卡片整体可点击并进入设置中心，保留“管理”按钮；点击、Enter 键和页面无报错回归均通过。 |
| 2026-07-26 | 补齐收藏夹主入口并修正收藏夹任务名称。 | 内容工作台新增“抓取我的收藏夹”直达按钮；收藏夹任务统一显示为“我的收藏夹”，不再误用第一条作品作者名；`npm run check`、收藏夹适配器测试、账号中心页面回归均通过，重启服务后现有任务接口已显示“我的收藏夹”。 |
| 2026-07-27 | 修正收藏夹作品目录的博主名称回退并调整收藏夹入口布局。 | 收藏夹目录左侧固定显示“我的收藏夹”；入口移到独立行并与分隔线保持间距；加载现有 347 条收藏夹任务的页面回归通过，页面无错误。 |
| 2026-07-27 | 修正收藏夹头像误用作品作者头像。 | 收藏夹工作台和关注博主归档统一使用“藏”字专用标识；普通博主继续显示真实头像；收藏夹任务不再显示作品作者头像。 |
| 2026-07-28 | 建立收藏夹目录缓存和“关注与更新”订阅模型。 | SQLite 增加 24 小时收藏夹目录缓存和软删除订阅；历史乱码收藏夹按 Profile 合并；取消关注保留资产；独立临时数据库测试通过。 |
| 2026-07-28 | 接入本地串行增量检查。 | 到期规则每分钟扫描一次，默认每日检查并加入现有 Chrome 串行队列；只更新目录，不自动转写或分析；失败和待复核不推进基线。 |
| 2026-07-29 | 完成全量转写批处理编排。 | 单项失败不终止整批；支持有限自动重试、安全暂停、断点继续、失败项重试和服务重启恢复；隔离 SQLite 回归覆盖失败隔离、暂停恢复和重启恢复。 |
| 2026-07-28 | 调整内容工作台和任务中心信息密度。 | 工作台允许纵向滚动，作品列表获得更高可视空间，底部操作栏吸底；任务中心由六张大卡改为紧凑状态与任务类型筛选。 |
| 2026-07-28 | 完成选题顾问、博主智能体和智能体审稿真实闭环。 | 2 份爆款报告生成 6 条带核验项的候选选题；飞天闪客 6 条材料生成试用画像；短稿审阅使用缺失事实占位符。SQLite、Markdown、任务进度和页面均完成回归。 |
| 2026-07-28 | 为模型资产增加程序化可信度门禁。 | 选题只能引用输入 report/work ID；画像必须包含 8 节和至少 8 个合法完整 ID 引用；审稿承认虚构事实时任务失败。 |
| 2026-07-28 | 完成 Demo 页面和文档收口。 | 新增证据选题、博主材料覆盖、画像审稿页面；新增浏览器自动化测试、Demo 验收说明和 GitHub 参考决策。正式 API 版本为 `2026-07-28.2`。 |
| 2026-07-28 | 增加目标驱动目录抓取 Loop。 | 已实现 Chrome 首轮、Chrome 恢复抓取、内部接口补充、按 `videoId` 合并、错误分类、SQLite 尝试记录和重启续跑；`npm run test:loop` 与既有回归全部通过。真实任务 `94bf888b-e094-4e37-8793-c3538ebf15d4` 首轮 Chrome 成功，未触发恢复轮。 |
| 2026-07-28 | 收口博主智能体与选题顾问交互。 | 已有智能体显示“查看并使用”，后端避免重复生成；选题报告按博主分组，默认禁止跨博主混用，只有显式对比模式可放行。 |
| 2026-07-28 | 修复主页混入异作者作品仍被判定通过的问题。 | `feitianshanke` 首轮捕获 82 条，其中作品 `7584734189266717979` 作者为“三联书店三联书情”；新门禁按主页 `sec_user_id` 排除并保留排除证据，纠正版为 81/81 个唯一作品，SHA-256 为 `667EE4C61158373CE95F133CCB5E356AA2BF75568A964A353A459A2EC1B01F5B`。 |
