"""Curated typhoon samples for the prototype.

This is a placeholder for a real CMA/IBTrACS best-track adapter. Values are
qualitative/rounded and must be re-checked against the official best-track CSV.
"""
from __future__ import annotations

from urllib.parse import quote

TYPHOONS = {
    "山竹": {
        "name": "山竹",
        "name_en": "Mangkhut",
        "year": 2018,
        "peak": "巅峰超强台风（约 17 级以上）",
        "landfall": "登陆广东台山，强台风级（14 级，45 m/s）",
        "note": "“史上最强”不成立；若说“17 级以上”，那是巅峰，不是登陆。",
        "source_url": "https://typhoon.nmc.cn",
    },
    "利奇马": {
        "name": "利奇马",
        "name_en": "Lekima",
        "year": 2019,
        "peak": "巅峰超强台风",
        "landfall": "登陆浙江温岭，超强台风级（16 级，52 m/s）",
        "note": "灾害重，但“史上最强”仍需指标、范围、时段与数据集。",
        "source_url": "https://typhoon.nmc.cn",
    },
    "摩羯": {
        "name": "摩羯",
        "name_en": "Yagi",
        "year": 2024,
        "peak": "巅峰超强台风",
        "landfall": "登陆海南文昌，超强台风级（17 级以上）",
        "note": "“17 级以上”与“超强台风”不是同一个表述；需区分巅峰/登陆。",
        "source_url": "https://typhoon.nmc.cn",
    },
    "威马逊": {
        "name": "威马逊",
        "name_en": "Rammasun",
        "year": 2014,
        "peak": "巅峰超强台风",
        "landfall": "登陆海南文昌，超强台风级（17 级）",
        "note": "常被引用为“建国以来登陆中国最强之一”；必须限定指标、时段与数据集。",
        "source_url": "https://typhoon.nmc.cn",
    },
    "杜苏芮": {
        "name": "杜苏芮",
        "name_en": "Doksuri",
        "year": 2023,
        "peak": "巅峰超强台风",
        "landfall": "登陆福建晋江，强台风级（15 级，50 m/s）",
        "note": "登陆强度与巅峰强度不同；不可用巅峰描述登陆。",
        "source_url": "https://typhoon.nmc.cn",
    },
}


def lookup(name: str) -> dict:
    key = (name or "").strip()
    item = TYPHOONS.get(key)
    if not item:
        raise KeyError(f"原型暂未收录台风：{name}")
    return {
        "adapter": "typhoon_curated",
        "source_type": "curated",
        "data": item,
        "source_url": item["source_url"],
        "search_url": f"https://typhoon.nmc.cn/web.html?name={quote(key)}",
        "note": "原型内置样本，非实时最佳路径；正式版需接 CMA/IBTrACS CSV 并按指标重算。",
    }
