# Analysis Output Contract

All analysis starts from audited standard JSON. Text-dependent claims additionally require confirmed text material. Every conclusion links back to source work IDs and evidence paths.

## 1. Viral Breakdown

Input: one or more selected works with engagement fields, title, description, type, and completed transcript text, plus the audited full directory used to calculate account-relative benchmarks.

当前产品边界：只接受已经完成并落盘的转写材料。同一作品同时存在本地 Whisper 和云端原文时，分析优先读取 Whisper；只有云端原文时仍可分析。后台只加载项目自带的 `skills/viral-breakdown/SKILL.md`，不依赖全局 Agent Skill。报告不得读取未审核 JSON，写入 `analyses/viral-breakdowns/<douyin-id>/`。模型调用必须由用户在页面确认，抓取或转写完成后不得自动触发。

Execution and retention: confirmation creates a persistent `viral-breakdown` task and a `viral_reports` SQLite index row before the model request starts. The local analysis queue records evidence loading, model processing, completion, failure, output path, duration, token usage when supplied by the model API, and the selected work IDs. Completed reports remain available after a page refresh through the report index. Re-running creates a new task and report; it never overwrites the prior report.

Output:

- scope and evidence list;
- account-relative rank, percentile, median comparison, and selection rationale;
- title, spoken hook, value promise, structure, expression, CTA, and sharing/saving hypotheses;
- cross-work repeated patterns, distinguished from single-work observations;
- reusable writing or topic patterns with applicable conditions;
- explicit uncertainty where only metadata is available.

The report must not infer cover visuals, frame-level events, duration, impressions, CTR, completion rate, audience feedback, or causality when those fields are absent.

## 2. 选题顾问

输入是一份或多份已完成爆款拆解报告。每次生成都会创建独立任务和 SQLite 批次记录，输出写入 `analyses/topic-library/`，不会覆盖旧批次。

Each topic stores:

- title, target audience, problem, hook, and angle;
- supporting creator/work IDs;
- evidence path and creation time;
- 拍摄前必须补充的事实核验或素材采集；
- 最容易被夸大或误解的风险；
- status: draft, selected, published, or archived.

选题可以是新构想，但不得把证据中没有出现的数字、实验、产品或成功案例写成已发生事实。每条必须引用真实 report ID 和 work ID；非法引用使任务失败。

## 3. Creator Agent

输入是同一博主跨抓取批次去重后的已完成转写。存在同一作品的双通道材料时优先本地 Whisper。

少于 5 条不能生成；5 至 9 条只能生成试用画像；10 条以上达到建议线。材料不代表完整创作生涯，页面和产物必须显示边界。画像中的引用只能使用输入材料包的完整 transcript ID 或 video ID。

Output:

- stable themes and recurring viewpoints;
- title, opening, explanation, example, and closing patterns;
- content-series and topic structure;
- a draft-analysis result that distinguishes evidence from inference.

审稿时画像只提供结构、判断方法和表达特征，不能把旧作品的数据或经历移植进新稿。原稿缺少的事实必须使用 `[补充真实数据]` 等占位符。

## 4. Optional Full-Collection Reports

### Essence Analysis
Use a full directory where possible, then choose high-value works by interaction, saving, sharing, and knowledge density. Answer what is most worth learning, not only what has the highest likes.

### Growth Analysis
Requires a complete time series. Explain phases, first notable breakouts, breakout density, stability, style changes, and uncertainty. Do not claim a growth trajectory from a top-N sample.

### Knowledge Creator Distillation
Requires a full directory. Identify long-term topic clusters, repeated ideas, content frameworks, and expression patterns. Text enrichment may proceed in confirmed batches; it is not automatically required for every work.
