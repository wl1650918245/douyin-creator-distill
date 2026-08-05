import argparse
import base64
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def load_records(input_path: Path) -> list[dict]:
    records = []
    with input_path.open("r", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            item = json.loads(line)
            key = str(item.get("key") or "").strip()
            text = str(item.get("text") or "").strip()
            if key and text:
                records.append({"key": key, "text": text})
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="CreatorDistill local semantic embedding worker")
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--kind", choices=["document", "query"], default="document")
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    input_path = Path(args.input).resolve()
    if not (model_path / "model.safetensors").exists():
        raise RuntimeError(f"模型权重不存在：{model_path}")
    if not input_path.exists():
        raise RuntimeError(f"输入文件不存在：{input_path}")

    from sentence_transformers import SentenceTransformer

    emit({"type": "loading", "model": str(model_path)})
    model = SentenceTransformer(
        str(model_path),
        device="cpu",
        local_files_only=True,
        trust_remote_code=False,
    )
    records = load_records(input_path)
    total = len(records)
    if not total:
        emit({"type": "completed", "total": 0, "dimension": 0})
        return

    batch_size = max(1, min(32, args.batch_size))
    completed = 0
    dimension = 0
    for offset in range(0, total, batch_size):
        batch = records[offset:offset + batch_size]
        encode_options = {
            "batch_size": batch_size,
            "convert_to_numpy": True,
            "normalize_embeddings": True,
            "show_progress_bar": False,
        }
        if args.kind == "query" and "query" in getattr(model, "prompts", {}):
            encode_options["prompt_name"] = "query"
        vectors = model.encode([item["text"] for item in batch], **encode_options)
        for item, vector in zip(batch, vectors):
            packed = vector.astype("<f4", copy=False).tobytes()
            dimension = int(vector.shape[0])
            emit({
                "type": "embedding",
                "key": item["key"],
                "dimension": dimension,
                "vector": base64.b64encode(packed).decode("ascii"),
            })
        completed += len(batch)
        emit({"type": "progress", "completed": completed, "total": total})
    emit({"type": "completed", "total": total, "dimension": dimension})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "error", "error": str(error)})
        sys.exit(1)
