import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from faster_whisper import WhisperModel

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="strict")


def progress(stage, message, **extra):
    payload = {"stage": stage, "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def safe_name(value):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value or "未命名作品"))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    return cleaned[:80] or "未命名作品"


def srt_time(seconds):
    milliseconds = max(0, round(float(seconds) * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def write_srt(path, segments):
    lines = []
    for index, segment in enumerate(segments, 1):
        lines.extend([
            str(index),
            f"{srt_time(segment['start'])} --> {srt_time(segment['end'])}",
            segment["text"].strip(),
            "",
        ])
    path.write_text("\n".join(lines), encoding="utf-8")


def yaml_value(value):
    return json.dumps("" if value is None else str(value), ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--retain-audio", action="store_true")
    args = parser.parse_args()

    source = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8-sig"))
    output_dir.mkdir(parents=True, exist_ok=True)

    published = str(metadata.get("published_at") or "")
    date_digits = re.sub(r"\D", "", published)[:8]
    short_date = date_digits[2:8] if len(date_digits) >= 8 else datetime.now().strftime("%y%m%d")
    stem = f"douyin_{short_date}_{safe_name(metadata.get('title'))}_whisper"
    audio_path = output_dir / f"{stem}.wav"
    json_path = output_dir / f"{stem}.json"
    srt_path = output_dir / f"{stem}.srt"
    markdown_path = output_dir / f"{stem}.md"

    progress("extract_audio", "正在使用项目内 FFmpeg 提取音频")
    subprocess.run([
        str(Path(args.ffmpeg).resolve()), "-y", "-i", str(source),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio_path),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    progress("load_model", "正在加载项目内 Whisper 模型")
    model = WhisperModel(str(Path(args.model_dir).resolve()), device=args.device, compute_type=args.compute_type)
    progress("transcribe", "正在识别音频并生成时间轴")
    generated, info = model.transcribe(
        str(audio_path),
        language=args.language or None,
        vad_filter=True,
        word_timestamps=True,
    )

    segments = []
    for item in generated:
        segments.append({
            "start": item.start,
            "end": item.end,
            "text": item.text.strip(),
            "words": [
                {"start": word.start, "end": word.end, "word": word.word, "probability": word.probability}
                for word in (item.words or [])
            ],
        })
        progress("transcribe", "正在识别音频并生成时间轴", segments=len(segments), seconds=item.end)

    transcript = "\n".join(item["text"] for item in segments).strip()
    local_time = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "schema_version": "1.0",
        "source_platform": "douyin",
        "transcription_provider": "whisper",
        "model": "faster-whisper-small",
        "language": info.language,
        "language_probability": info.language_probability,
        "duration_seconds": info.duration,
        "video_id": str(metadata.get("video_id") or ""),
        "video_url": str(metadata.get("video_url") or ""),
        "created_at": local_time,
        "text": transcript,
        "segments": segments,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_srt(srt_path, segments)

    frontmatter = "\n".join([
        "---",
        f"title: {yaml_value(metadata.get('title'))}",
        'source_platform: "douyin"',
        'transcription_provider: "whisper"',
        'transcription_model: "faster-whisper-small"',
        f"source_url: {yaml_value(metadata.get('video_url'))}",
        f"local_created_at: {yaml_value(local_time)}",
        f"douyin_published_at: {yaml_value(metadata.get('published_at'))}",
        f"creator: {yaml_value(metadata.get('creator'))}",
        f"douyin_id: {yaml_value(metadata.get('douyin_id'))}",
        f"video_id: {yaml_value(metadata.get('video_id'))}",
        f"content_type: {yaml_value(metadata.get('content_type') or 'video')}",
        f"likes: {yaml_value(metadata.get('likes') or 0)}",
        f"comments: {yaml_value(metadata.get('comments') or 0)}",
        f"collects: {yaml_value(metadata.get('collects') or 0)}",
        f"shares: {yaml_value(metadata.get('shares') or 0)}",
        f"interaction_total: {yaml_value(metadata.get('interaction_total') or 0)}",
        "---",
    ])
    markdown = f"{frontmatter}\n\n# {metadata.get('title') or '未命名作品'}\n\n## 音频转写原文\n\n{transcript}\n"
    markdown_path.write_text(markdown, encoding="utf-8")

    if not args.retain_audio:
        audio_path.unlink(missing_ok=True)

    progress(
        "completed",
        "本地 Whisper 转写完成",
        markdown_path=str(markdown_path),
        json_path=str(json_path),
        srt_path=str(srt_path),
        duration_seconds=info.duration,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        progress("failed", str(error))
        raise
