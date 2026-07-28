#!/usr/bin/env python3
"""COMMUNITY.md 收录PR的半自动检查。

机器检查（本脚本）：
1. PR只改动 COMMUNITY.md（动了SKILL.md等核心文件直接判❌）
2. 新增行里的GitHub仓库真实存在且公开
3. 若目标仓库含SKILL.md（人物/主题skill类）→ 额外要求：
   - FIDELITY.md 存在且总分≥70（B级）
   - SKILL.md 含「诚实边界」章节
   - 有 references/ 调研底稿目录
   若不含SKILL.md（合集/工具类）→ 仅存在性检查，标注请人工确认类别
4. 结果贴成PR评论

人工检查（维护者）：伦理红线 + 内容质量抽查 + 合并。

本地测试：python3 community_check.py --check-repo owner/repo
"""
import json
import os
import re
import sys
import urllib.request

API = "https://api.github.com"


def gh(path, token, raw=False):
    req = urllib.request.Request(API + path)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if raw:
        req.add_header("Accept", "application/vnd.github.raw+json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read().decode("utf-8", "replace")
            return data if raw else json.loads(data)
    except Exception:
        return None


def check_target_repo(slug, token):
    """检查被收录的仓库，返回 (是否通过, 检查项列表)。"""
    items = []
    repo = gh(f"/repos/{slug}", token)
    if not repo:
        return False, [("❌", f"`{slug}` 仓库不存在或不可访问")]
    items.append(("✅", f"[`{slug}`](https://github.com/{slug}) 存在（★{repo.get('stargazers_count', 0)}）"))

    skill_md = gh(f"/repos/{slug}/contents/SKILL.md", token, raw=True)
    if skill_md is None:
        items.append(("ℹ️", "无根目录SKILL.md → 按「合集/工具类」处理，请人工确认类别与内容"))
        return True, items
    items.append(("✅", "含 SKILL.md（按skill类审核）"))

    if "诚实边界" in skill_md or "Honest" in skill_md or "honest-limits" in skill_md.lower():
        items.append(("✅", "SKILL.md 含诚实边界章节"))
    else:
        items.append(("❌", "SKILL.md 缺「诚实边界」章节（收录门槛之一）"))

    refs = gh(f"/repos/{slug}/contents/references", token)
    if isinstance(refs, list) and refs:
        items.append(("✅", "含 references/ 调研底稿"))
    else:
        items.append(("❌", "缺 references/ 调研底稿（skill需自包含可溯源）"))

    fidelity = gh(f"/repos/{slug}/contents/FIDELITY.md", token, raw=True)
    if fidelity is None:
        items.append(("❌", "缺 FIDELITY.md 保真度评分卡（见 references/fidelity-scorecard.md）"))
    else:
        m = re.search(r"总分[：:]\s*(\d+)\s*/\s*100", fidelity)
        if not m:
            items.append(("❌", "FIDELITY.md 存在但未解析到「总分：NN/100」"))
        elif int(m.group(1)) >= 70:
            items.append(("✅", f"保真度 {m.group(1)}/100 ≥ 70（B级门槛）"))
        else:
            items.append(("❌", f"保真度 {m.group(1)}/100 未达B级门槛（70）"))

    ok = all(mark != "❌" for mark, _ in items)
    return ok, items


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--check-repo":
        ok, items = check_target_repo(sys.argv[2], os.environ.get("GITHUB_TOKEN", ""))
        for mark, text in items:
            print(mark, text)
        sys.exit(0 if ok else 1)

    token = os.environ["GITHUB_TOKEN"]
    repo = os.environ["GITHUB_REPOSITORY"]
    pr = os.environ["PR_NUMBER"]

    files = gh(f"/repos/{repo}/pulls/{pr}/files?per_page=100", token) or []
    names = [f["filename"] for f in files]
    lines = ["## 🤖 社区收录检查\n"]
    all_ok = True

    core_touched = [n for n in names if n != "COMMUNITY.md"]
    if core_touched:
        all_ok = False
        lines.append(f"❌ PR改动了 COMMUNITY.md 以外的文件：`{'`, `'.join(core_touched[:10])}`")
        if any(n == "SKILL.md" for n in core_touched):
            lines.append("　　⚠️ SKILL.md 是核心资产，不接受外部PR改动（见 CONTRIBUTING.md），请从PR中移除")
    else:
        lines.append("✅ 只改动 COMMUNITY.md")

    added = []
    for f in files:
        if f["filename"] == "COMMUNITY.md":
            for ln in (f.get("patch") or "").splitlines():
                if ln.startswith("+") and not ln.startswith("+++"):
                    added += re.findall(r"github\.com/([\w.-]+/[\w.-]+)", ln)
    added = list(dict.fromkeys(s.rstrip(")/") for s in added))

    if not added:
        all_ok = False
        lines.append("❌ 未在新增行中检测到GitHub仓库链接")
    for slug in added[:5]:
        ok, items = check_target_repo(slug, token)
        all_ok = all_ok and ok
        lines.append(f"\n**{slug}**")
        lines += [f"- {mark} {text}" for mark, text in items]

    lines.append("\n---")
    lines.append(("✅ **机器检查通过**。" if all_ok else "❌ **机器检查未通过**，请按上述项修改后推送更新（会自动重跑）。"))
    lines.append("最终合并前维护者还会人工确认：伦理红线（CONTRIBUTING.md）+ 内容质量抽查。")

    body = "\n".join(lines)
    req = urllib.request.Request(
        f"{API}/repos/{repo}/issues/{pr}/comments",
        data=json.dumps({"body": body}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=15)
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
