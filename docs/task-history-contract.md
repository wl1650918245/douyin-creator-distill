# Task, Archive, and Follow Contract

## 1. Separate Objects

| Object | Responsibility |
| --- | --- |
| Creator profile | Stable identity, display metadata, and asset workspace reference |
| Task | One requested execution and its live state |
| Crawl run | One completed or failed evidence-producing attempt |
| Work index | Seen work IDs used for incremental comparison |
| Follow rule | Whether a creator may be checked again and how |
| Downstream task | Transcription, comment collection, breakdown, distillation, or indexing status |

## 2. Task State

```text
draft -> queued -> running -> waiting_for_audit -> waiting_for_user -> completed
```

Any task may also become `partial`, `failed`, `cancelled`, or `interrupted_recoverable`.

Task Center only prioritizes queued, running, waiting-for-user, and exception states. A task row shows: type, object, input range, phase/counts, output or error, latest event time, queue position when relevant, and allowed actions.

## 3. Crawl Archive

Every crawl run retains: run ID, creator ID, source type, start and finish times, status, JSON path, audit result, total/new/duplicate/failed counts, and a sanitized error reason when applicable.

Archive is not a generic event log. It is the durable record of completed crawl attempts and their JSON evidence. It supports filtering by creator, time, source mode, and audit status.

## 4. Follow and Incremental Rules

1. A follow rule can exist only after one successful creator-post crawl creates a baseline.
2. Each new check first obtains a current directory, then compares `creatorId + videoId` against the work index.
3. New works create a separate incremental JSON and crawl run; old runs are never overwritten.
4. A failed run, failed audit, or unexplained count anomaly does not update the index, last successful run, or baseline.
5. Discovery of new works creates a waiting-for-user directory only. It does not automatically start text enrichment or analysis.
6. Favorites collections are manual re-crawl and comparison in the first version; they do not create automatic incremental follow rules.

## 5. Storage Paths

The selected knowledge-asset root contains:

```text
raw/douyin-analysis/<creator>/
get-note/<creator>/
analyses/<creator>/
topic-library/
agents/
```

Changing an asset root or moving existing files requires explicit user confirmation and a migration plan.
