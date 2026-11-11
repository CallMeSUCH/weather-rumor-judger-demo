"""Local OCR for pasted/uploaded images.

Uses the Windows built-in OCR engine (Windows.Media.Ocr) through PowerShell.
No cloud service, no API key, no image upload to a third party.

The OCR engine often inserts spaces between Chinese characters and digits
(e.g. "1 0 月", "1 00 毫 米"). normalize_text() removes those spaces while
keeping spaces around Latin words where possible.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "ocr_windows.ps1"


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\u3000", " ").replace("\xa0", " ")
    # Chinese character <-> Chinese character
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    # digit <-> digit, digit <-> Chinese
    text = re.sub(r"(?<=[0-9])\s+(?=[0-9])", "", text)
    text = re.sub(r"(?<=[0-9])\s+(?=[\u4e00-\u9fff])", "", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[0-9])", "", text)
    # punctuation <-> anything
    text = re.sub(r"(?<=[，。！？；：、,.!?;:])\s+", "", text)
    text = re.sub(r"\s+(?=[，。！？；：、,.!?;:])", "", text)
    # collapse remaining whitespace but keep line breaks
    lines = []
    for line in text.splitlines():
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def recognize(path: str, timeout: int = 45) -> dict:
    """Run Windows OCR on an image file and return normalized text."""
    started = time.time()
    if not SCRIPT.exists():
        raise RuntimeError(f"OCR 脚本不存在：{SCRIPT}")

    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy", "Bypass",
        "-File", str(SCRIPT),
        str(path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    raw = (proc.stdout or "").lstrip("\ufeff").strip()
    if not raw:
        detail = (proc.stderr or "").strip()
        raise RuntimeError(f"Windows OCR 没有输出：{detail[:300]}")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Windows OCR 返回非 JSON：{raw[:300]}") from exc

    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "Windows OCR 失败")

    raw_text = data.get("text") or ""
    text = normalize_text(raw_text)
    lines = [normalize_text(x) for x in (data.get("lines") or []) if normalize_text(x)]
    elapsed = int((time.time() - started) * 1000)

    return {
        "adapter": "windows_ocr",
        "engine": data.get("engine") or "windows-media-ocr",
        "lang": data.get("lang") or "zh-Hans-CN",
        "text": text,
        "lines": lines,
        "raw_text": raw_text,
        "chars": len(text),
        "width": data.get("width"),
        "height": data.get("height"),
        "duration_ms": elapsed,
        "note": (
            "本地 Windows OCR，不上传云端；已自动清理中文字符/数字之间的多余空格。"
            "识别结果仍可能有错，请核对后再判定。"
        ),
    }


def engine_status() -> dict:
    """Check whether the Windows OCR engine and Chinese language are available."""
    ps = (
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
        "try{"
        "[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]|Out-Null;"
        "$langs=[Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages|"
        "ForEach-Object{$_.LanguageTag};"
        "[ordered]@{ok=$true;languages=@($langs)}|ConvertTo-Json -Compress"
        "}catch{[ordered]@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress}"
    )
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-Command", ps],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
        data = json.loads((proc.stdout or "").lstrip("\ufeff").strip() or "{}")
        return {
            "adapter": "windows_ocr",
            "available": bool(data.get("ok")),
            "languages": data.get("languages") or [],
            "error": data.get("error"),
            "note": "使用 Windows 本地 OCR；需要系统安装中文识别语言 zh-Hans-CN。",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "adapter": "windows_ocr",
            "available": False,
            "languages": [],
            "error": str(exc),
            "note": "使用 Windows 本地 OCR；需要系统安装中文识别语言 zh-Hans-CN。",
        }
