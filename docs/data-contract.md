# Standard Content Data Contract

## 1. Role

Standard JSON is the only cross-module evidence contract. The page, task system, transcript provider, analysis tools, and archive must use this contract instead of relying on a crawler's private fields.

One JSON file represents one independent crawl run. Existing evidence files are immutable; new fields may be appended, but existing field meaning, units, and empty-value rules cannot silently change.

## 2. File-Level Fields

Each accepted run needs:

- `exportedAt`: export timestamp.
- `source`: submitted source and recognized source type.
- `options`: crawl scope and user-selected limits or filters.
- `pageTotal`: platform-visible count when available.
- `totals`: total works, selected works, videos, image posts, duplicates and failures.
- `works`: an array of standard work records.
- `audit`: audit status, checks, warnings, and any explained count difference.
- `sourceContext`: source mode and the logical account identity used for this run.

`sourceContext` must contain:

| Field | Meaning |
| --- | --- |
| `sourceMode` | `profile`, `single`, or `favorites` |
| `accountRole` | `content` or `favorites` |
| `profileId` | Stable project-local Profile ID; never an absolute filesystem path |

The evidence file must not contain Cookie values, browser Profile paths, API keys, or environment-variable values.

## 3. Work Record Fields

| Group | Required fields |
| --- | --- |
| Identity | `videoId`, `videoUrl`, `shareUrl`, creator stable identifier |
| Time | `publishTimestamp`, `date` |
| Engagement | `likes`, `commentCount`, `collectCount`, `shareCount`, `interactionTotal` |
| Text | `title`, `desc`, `hashtags`, `mentions` when available |
| Type | `contentType`, `awemeType`, `durationMs` |

`authorAvatarUrl` 是可选的博主展示字段，在抖音作者对象可用时采集。该字段缺失不阻断审核：旧 JSON 或远程头像不可用时，页面必须回退显示博主姓名首字，不能因此判定 JSON 审核失败。

`creatorId + videoId` is the incremental deduplication key. `videoId` is the primary work key; links are retained for review and later enrichment.

## 4. Audit Gate

Before a run may enter transcription or analysis, check:

1. File structure: `works`, `options`, `totals`, and `exportedAt` exist.
2. Volume: selected count, total count, and visible page count are consistent or the difference is explained.
3. Samples: identity, link, time, engagement, and content type are usable in representative records; missing titles are counted as metadata warnings.
4. Type coverage: image posts and videos are not silently removed.
5. Time series: dates are plausible when the task needs trend or growth analysis.

Audit conclusion is exactly one of: `passed`, `partial`, or `failed`.

- `passed`: eligible for the user to choose a next stage.
- `partial`: usable only for explicitly limited analysis; not an automatic enrichment input.
- `failed`: requires a new crawl or repair; no downstream task starts.

Blocking audit failures include missing work IDs or links, duplicate work IDs, count inconsistency, and missing time, engagement, or type fields. A missing `title` is a non-blocking warning when the work still has a stable ID and usable link. The UI must display a deterministic fallback such as `未命名图文 · <videoId>` or `未命名视频 · <videoId>`, retain the warning count, and allow transcription and analysis. Re-auditing an existing JSON changes only local task/audit state; it does not modify the evidence file or create a new crawl run.

## 5. Source Scope

Public creator posts, a single work, and the current user's favorites collection are separate source modes. Favorites use the configured favorites account context and must not be represented as a public creator profile. The favorites account may share the content-collection Profile or use an independent Profile. Any filter, limit, or type exclusion must be saved in `options`.

## 6. 缓存与关注状态

收藏夹目录缓存和关注规则属于可重建运行状态，不属于标准作品 JSON：

- `favorites_directory_cache` 按收藏夹账号 `profileId` 保存最近一次文件夹目录和证据路径，默认有效期为 24 小时。
- `subscriptions` 按 `creator:<source>` 或 `favorites:<profileId>` 保存增量检查规则。
- 同一收藏夹 Profile 只能对应一个活动关注来源；显示名称乱码或历史任务来源差异不能产生重复收藏夹。
- 取消关注不得删除标准 JSON、转写文本、分析报告或任务历史。
- 定时检查只有在新 JSON 审核通过后才能更新 `baseline_output_path`；失败和待复核结果不得推进基线。
