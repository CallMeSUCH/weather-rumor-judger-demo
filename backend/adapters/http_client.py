"""Tiny stdlib HTTP client with disk cache + snapshot hash.

No third-party dependencies. Used by the evidence adapters.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import time
import zlib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 MeteorologyTermChecker/0.1"


def fetch_text(url: str, timeout: int = 25, encoding: str | None = None, headers: dict | None = None) -> str:
    req_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        req_headers.update(headers)
    req = Request(url, headers=req_headers)
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        content_encoding = (resp.headers.get("Content-Encoding") or "").lower()
        if "gzip" in content_encoding:
            raw = gzip.decompress(raw)
        elif "deflate" in content_encoding:
            raw = zlib.decompress(raw)
        if encoding:
            return raw.decode(encoding, errors="replace")
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def fetch_json(url: str, timeout: int = 25, encoding: str | None = None, headers: dict | None = None):
    return json.loads(fetch_text(url, timeout, encoding=encoding, headers=headers))


def _cache_path(url: str, encoding: str | None = None) -> Path:
    key = url if not encoding else f"{url}|{encoding}"
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / f"{h}.json"


def cached_text(url: str, ttl: int = 3600, timeout: int = 25, encoding: str | None = None, headers: dict | None = None) -> dict:
    """Return {url, fetched_at, fetched_at_iso, sha256, text}. Cache for ttl seconds."""
    p = _cache_path(url, encoding)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if time.time() - float(data.get("fetched_at", 0)) < ttl:
                data["cache"] = "hit"
                return data
        except Exception:
            pass

    text = fetch_text(url, timeout=timeout, encoding=encoding, headers=headers)
    now = time.time()
    data = {
        "url": url,
        "encoding": encoding,
        "fetched_at": now,
        "fetched_at_iso": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "text": text,
        "cache": "miss",
    }
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def cached_json(url: str, ttl: int = 3600, timeout: int = 25, encoding: str | None = None, headers: dict | None = None) -> dict:
    data = cached_text(url, ttl=ttl, timeout=timeout, encoding=encoding, headers=headers)
    data["json"] = json.loads(data["text"])
    return data
