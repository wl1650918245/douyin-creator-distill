import argparse
import fnmatch
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
_domestic_no_proxy = "modelscope.cn,www.modelscope.cn,.modelscope.cn"
os.environ["NO_PROXY"] = ",".join(filter(None, [os.environ.get("NO_PROXY", ""), _domestic_no_proxy]))
os.environ["no_proxy"] = os.environ["NO_PROXY"]

from huggingface_hub import snapshot_download as huggingface_snapshot_download


MODEL_PATTERNS = [
    "*.json",
    "*.txt",
    "*.model",
    "*.safetensors",
    "*.py",
    "*.tiktoken",
    "merges.txt",
    "vocab.json",
]


def matches_model_file(file_path: str) -> bool:
    return any(fnmatch.fnmatch(file_path, pattern) for pattern in MODEL_PATTERNS)


def download_modelscope_file(model_id: str, revision: str, file_info: dict, target_path: Path) -> None:
    import requests
    from modelscope.hub.file_download import get_file_download_url

    relative_path = str(file_info["Path"]).replace("\\", "/").lstrip("/")
    destination = (target_path / relative_path).resolve()
    if destination != target_path and not str(destination).startswith(f"{target_path}{os.sep}"):
        raise RuntimeError(f"Model file path escaped target directory: {relative_path}")
    expected_size = int(file_info.get("Size") or 0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and (not expected_size or destination.stat().st_size == expected_size):
        return

    incomplete = destination.with_name(f"{destination.name}.incomplete")
    downloaded = incomplete.stat().st_size if incomplete.exists() else 0
    headers = {"Range": f"bytes={downloaded}-"} if downloaded else {}
    url = get_file_download_url(model_id, relative_path, revision)
    with requests.get(url, headers=headers, stream=True, timeout=(20, 120)) as response:
        if response.status_code == 416 and expected_size and downloaded == expected_size:
            incomplete.replace(destination)
            return
        response.raise_for_status()
        append = response.status_code == 206 and downloaded > 0
        if not append:
            downloaded = 0
        with incomplete.open("ab" if append else "wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                output.write(chunk)
                downloaded += len(chunk)
                if expected_size:
                    percent = min(100, int(downloaded * 100 / expected_size))
                    print(json.dumps({"status": "downloading", "file": relative_path, "downloadedBytes": downloaded, "expectedBytes": expected_size, "progress": percent}), flush=True)
    if expected_size and incomplete.stat().st_size != expected_size:
        raise RuntimeError(f"Incomplete model file: {relative_path} ({incomplete.stat().st_size}/{expected_size})")
    incomplete.replace(destination)


def download_model(source: str, repo_id: str, target: str) -> None:
    target_path = Path(target).resolve()
    target_path.mkdir(parents=True, exist_ok=True)
    cache_path = Path(tempfile.gettempdir()) / "creator-distill-hf-cache"
    if source == "modelscope":
        from modelscope.hub.api import HubApi

        revision = "master"
        files = HubApi().get_model_files(repo_id, revision=revision, recursive=True)
        selected_files = [file_info for file_info in files if matches_model_file(str(file_info.get("Path") or ""))]
        if not selected_files:
            raise RuntimeError(f"No model files matched in ModelScope repository: {repo_id}")
        for file_info in selected_files:
            download_modelscope_file(repo_id, revision, file_info, target_path)
    else:
        snapshot_path = Path(huggingface_snapshot_download(
            repo_id=repo_id,
            cache_dir=str(cache_path),
            max_workers=1,
            allow_patterns=MODEL_PATTERNS,
        ))
        shutil.copytree(snapshot_path, target_path, dirs_exist_ok=True)
    shutil.rmtree(target_path / ".cache", ignore_errors=True)
    for incomplete in target_path.rglob("*.incomplete"):
        incomplete.unlink(missing_ok=True)
    if (target_path / "model.safetensors").exists():
        (target_path / "pytorch_model.bin").unlink(missing_ok=True)
    marker = {
        "repoId": repo_id,
        "source": source,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    (target_path / ".download-complete.json").write_text(
        json.dumps(marker, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if source == "huggingface":
        shutil.rmtree(cache_path, ignore_errors=True)
    print(json.dumps({"status": "installed", **marker}, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage CreatorDistill local embedding models")
    subparsers = parser.add_subparsers(dest="command", required=True)
    download = subparsers.add_parser("download")
    download.add_argument("--source", choices=["modelscope", "huggingface"], default="modelscope")
    download.add_argument("--repo-id", required=True)
    download.add_argument("--target", required=True)
    args = parser.parse_args()
    if args.command == "download":
        download_model(args.source, args.repo_id, args.target)


if __name__ == "__main__":
    main()
