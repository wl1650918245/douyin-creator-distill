# Project Skills

This directory belongs to the standalone CreatorDistill agent. Runtime behavior must not depend on skills installed in a developer's global Codex or Claude directories.

- `viral-breakdown/`: product-owned runtime skill. The backend reads this skill when generating a viral-breakdown report.
- `vendor/`: audited upstream snapshots used as methodology references. It includes all 47 skills from `coreyhaines31/marketingskills`, plus Nuwa and MrBeast.
- `vendor-lock.json`: source repository, commit, license, and local purpose for every upstream snapshot.

Upstream skills do not directly control runtime prompts, and installing all of them does not mean every request invokes all of them. Relevant methods are selectively translated into a product-owned workflow so upstream changes cannot silently change product behavior.
