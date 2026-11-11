"""NOAA CPC Oceanic Niño Index (ONI) adapter.

Source: https://cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
ONI = 3-month running mean of Niño3.4 SST anomalies (ERSSTv5, 1991-2020 base).
Note: China's National Climate Center may use a different dataset/baseline;
do not treat CPC ONI and CMA/NCC indices as numerically identical.
"""
from __future__ import annotations

from datetime import datetime

from .http_client import cached_text

DATA_URL = "https://cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
PAGE_URL = "https://cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php"


def _classify_noaa(anom: float) -> str:
    if anom >= 2.0:
        return "very strong（很强）"
    if anom >= 1.5:
        return "strong（强）"
    if anom >= 1.0:
        return "moderate（中等）"
    if anom >= 0.5:
        return "weak（弱）"
    if anom <= -0.5:
        return "La Niña"
    return "neutral（中性）"


def _classify_cn(anom: float) -> str:
    # GB/T 33666-2017 style thresholds for El Niño event strength.
    if anom >= 2.5:
        return "超强"
    if anom >= 2.0:
        return "强"
    if anom >= 1.3:
        return "中等"
    if anom >= 0.5:
        return "弱"
    return "未达事件标准"


SEASON_BY_MONTH = {
    1: "DJF", 2: "JFM", 3: "FMA", 4: "MAM", 5: "AMJ", 6: "MJJ",
    7: "JJA", 8: "JAS", 9: "ASO", 10: "SON", 11: "OND", 12: "NDJ",
}
SEASON_ORDER = {s: i for i, s in enumerate(["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"])}


def get_oni(date_str: str | None = None, ttl: int = 3600) -> dict:
    cached = cached_text(DATA_URL, ttl=ttl)
    records = []
    for line in cached["text"].splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            season = parts[0]
            year = int(parts[1])
            total = float(parts[2])
            anom = float(parts[3])
        except ValueError:
            continue
        records.append({
            "season": season,
            "year": year,
            "total": total,
            "anom": anom,
        })

    if not records:
        raise RuntimeError("ONI 文件解析失败：没有可用记录")

    latest = records[-1]
    warmest = max(records, key=lambda r: r["anom"])
    coldest = min(records, key=lambda r: r["anom"])

    selected = None
    query = None
    if date_str:
        try:
            dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
            season = SEASON_BY_MONTH[dt.month]
            query = {"date": dt.strftime("%Y-%m-%d"), "year": dt.year, "month": dt.month, "season": season}
            target_key = (dt.year, SEASON_ORDER[season])
            eligible = [
                r for r in records
                if (r["year"], SEASON_ORDER.get(r["season"], -1)) <= target_key
            ]
            selected = eligible[-1] if eligible else None
            if selected:
                selected = {
                    **selected,
                    "classification_noaa": _classify_noaa(selected["anom"]),
                    "classification_cn": _classify_cn(selected["anom"]),
                }
        except Exception:
            query = {"date": date_str, "error": "无法解析日期，返回最新值"}
            selected = None

    return {
        "adapter": "cpc_oni",
        "source": "NOAA CPC Oceanic Niño Index (ONI)",
        "data_url": DATA_URL,
        "page_url": PAGE_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache", "unknown"),
        "query": query,
        "selected": selected,
        "latest": {
            **latest,
            "classification_noaa": _classify_noaa(latest["anom"]),
            "classification_cn": _classify_cn(latest["anom"]),
        },
        "record_warmest": warmest,
        "record_coldest": coldest,
        "recent": records[-12:],
        "note": (
            "ONI 是 Niño3.4 区海温距平的 3 个月滑动平均，NOAA 使用 ERSSTv5、1991—2020 基准。"
            "中国国家气候中心可能使用不同资料/基准，数值不可直接等同；"
            "比较“最强”时必须注明指数、数据集与基准期。"
        ),
    }
