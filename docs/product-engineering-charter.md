# CreatorDistill 产品与工程章程

> 文档语言规则：项目自有、供用户和后续智能体长期维护的文档默认使用中文。代码标识、配置字段、命令、文件名、固定协议格式和第三方原文可以保留英文。新增内容不得仅因旧文档使用英文而继续沿用英文。

## 1. Product Boundary

This is a single-user local product. A user enters a public creator profile, a single work link, or their own favorites collection; the product first creates an auditable content directory and standard JSON, then the user decides whether to transcribe, break down, distill, or index selected works.

The first version does not include accounts, tenants, cloud storage, billing, team collaboration, or automatic bypass of login, CAPTCHA, paywalls, or platform security.

## 2. Fixed Stage Gates

```text
source -> directory crawl -> JSON audit -> user confirmation -> text enrichment -> analysis / knowledge assets
```

- Standard JSON is the first evidence layer.
- Text enrichment, model analysis, indexing, or any external quota-consuming operation must not start before JSON audit and explicit user confirmation.
- Every stage must show its input scope, output location, state, and allowed next action.

## 3. Runtime Rules

- The web page only calls a local orchestration API. It does not run shell commands, read secrets, or write asset files directly.
- The product is a standalone local agent. Runtime code, product-owned skills, configuration examples, and required adapters live inside this repository; normal operation must not depend on a developer's global Codex/Claude skills or the current development conversation.
- External skills are stored as pinned, auditable snapshots. Product behavior is defined by product-owned skills, so upstream updates cannot silently change runtime behavior.
- External Douyin work uses a serial queue per browser profile.
- A completed task is archived; running, queued, waiting-for-decision, and failed tasks stay in Task Center.
- Failed or invalid runs never advance an incremental baseline.
- Safe reads may use limited backoff retries. Login expiry, CAPTCHA, quota exhaustion, and non-idempotent operations pause for user action.

## 4. Assets and Credentials

- A user selects one knowledge-asset root: an Obsidian library location or a normal local folder.
- JSON, text, reports, topics, and agent material keep separate directories below that root.
- SQLite stores runtime state and indexes; files remain the durable evidence and can rebuild indexes.
- API keys are read only by the local backend from Git-ignored project configuration files. Example files stay in the repository, while real credentials, cookies, and browser profiles remain outside version control and are never exposed to the page or logs.

## 5. Change Discipline

Small, localized changes do not need prior user confirmation. The agent states the purpose and scope, implements the smallest safe fix, then reports verification and limits.

Examples of small changes:

- A localized UI wording, layout, state-display, or interaction correction.
- A bug fix confined to an existing module that does not change the product workflow, external requests, persistent data contract, or security boundary.
- Focused test, documentation, or validation improvements that do not alter runtime behavior.

Explicit user confirmation is required before a major change. The change note must state purpose, scope, exact behavior, verification, and known limits.

Major changes include:

- Changing the product architecture, stage gates, or primary workflow.
- Adding or changing external requests, quota consumption, automated retries, browser automation behavior, or provider semantics.
- Changing SQLite schema, moving or deleting durable files, changing asset roots, or migrating historical data.
- Adding dependencies, changing runtime configuration, credentials, permissions, or security boundaries.
- Broad refactors across modules, or any change whose classification is uncertain.

The stage gates above still apply: external quota-consuming work, text enrichment, model analysis, indexing, or other non-idempotent operations always require the user's explicit operational confirmation before they run.

Static checks do not prove live platform behavior. Any claim about crawl completeness, rate limits, or recovery requires recorded evidence from the relevant environment.
