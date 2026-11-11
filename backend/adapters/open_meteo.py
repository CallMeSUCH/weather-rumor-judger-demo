"""Open-Meteo adapter: geocoding + forecast + archive.

Open-Meteo is an open weather API, not a Chinese official station dataset.
Use it as auxiliary evidence; final judgments should prefer CMA/local station data.
"""
from __future__ import annotations

from datetime import date, datetime
from urllib.parse import urlencode

from .http_client import cached_json

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

DAILY = "precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max"

# 省级代表点（省会/首府/直辖市）。仅用于“省级”查询的辅助定位，
# 不代表全省平均；正式判断应使用省级格点/站点数据。
PROVINCE_CAPITALS = {
    "北京": ("北京", 39.9042, 116.4074),
    "上海": ("上海", 31.2304, 121.4737),
    "天津": ("天津", 39.0842, 117.2009),
    "重庆": ("重庆", 29.5630, 106.5516),
    "广东": ("广州", 23.1291, 113.2644),
    "海南": ("海口", 20.0440, 110.1999),
    "山东": ("济南", 36.6512, 117.1201),
    "江苏": ("南京", 32.0603, 118.7969),
    "浙江": ("杭州", 30.2741, 120.1551),
    "福建": ("福州", 26.0745, 119.2965),
    "辽宁": ("沈阳", 41.8057, 123.4315),
    "河北": ("石家庄", 38.0428, 114.5149),
    "河南": ("郑州", 34.7466, 113.6254),
    "湖北": ("武汉", 30.5928, 114.3055),
    "湖南": ("长沙", 28.2282, 112.9388),
    "四川": ("成都", 30.5728, 104.0668),
    "云南": ("昆明", 25.0389, 102.7183),
    "贵州": ("贵阳", 26.6470, 106.6302),
    "广西": ("南宁", 22.8170, 108.3665),
    "江西": ("南昌", 28.6820, 115.8579),
    "安徽": ("合肥", 31.8206, 117.2272),
    "山西": ("太原", 37.8706, 112.5489),
    "陕西": ("西安", 34.3416, 108.9398),
    "甘肃": ("兰州", 36.0611, 103.8343),
    "青海": ("西宁", 36.6171, 101.7782),
    "宁夏": ("银川", 38.4872, 106.2309),
    "新疆": ("乌鲁木齐", 43.8256, 87.6168),
    "西藏": ("拉萨", 29.6520, 91.1721),
    "内蒙古": ("呼和浩特", 40.8426, 111.7492),
    "黑龙江": ("哈尔滨", 45.8038, 126.5350),
    "吉林": ("长春", 43.8171, 125.3235),
    "香港": ("香港", 22.3193, 114.1694),
    "澳门": ("澳门", 22.1987, 113.5439),
    "台湾": ("台北", 25.0330, 121.5654),
}


CITY_COORDS = {
    "阳江": ("阳江", "广东", 21.859, 111.982),
    "阳春": ("阳春", "广东", 22.170, 111.790),
    "顺昌": ("顺昌", "福建", 26.793, 117.810),
    "南平": ("南平", "福建", 26.642, 118.178),
}


def _strip_admin(name: str) -> str:
    return (name or "").strip().replace("省", "").replace("市", "").replace("自治区", "").replace("特别行政区", "")


def _local_city(name: str) -> dict | None:
    text = _strip_admin(name)
    for city, (label, admin1, lat, lon) in CITY_COORDS.items():
        if city in text:
            return {
                "adapter": "local_city_geocode",
                "source_type": "local_city",
                "query": name,
                "name": label,
                "admin1": admin1,
                "country": "中国",
                "latitude": lat,
                "longitude": lon,
                "timezone": "Asia/Shanghai",
                "source_url": "local-city-coordinate-table",
                "note": "本地城市坐标表；用于避免 Open-Meteo 对中文重名城市的误匹配。",
            }
    return None


def province_capital(name: str) -> dict | None:
    key = _strip_admin(name)
    if key not in PROVINCE_CAPITALS:
        return None
    capital, lat, lon = PROVINCE_CAPITALS[key]
    return {
        "adapter": "province_capital",
        "source_type": "province_capital",
        "query": name,
        "name": capital,
        "admin1": key if key != capital else capital,
        "country": "中国",
        "latitude": lat,
        "longitude": lon,
        "timezone": "Asia/Shanghai",
        "source_url": "https://www.open-meteo.com/",
        "note": "省级代表点（省会/首府/直辖市），不代表全省平均；仅用于辅助查询。正式判断请用省级格点/站点数据。",
    }


def geocode(name: str, count: int = 1) -> dict:
    local = _local_city(name)
    if local:
        return local
    params = {
        "name": name,
        "count": count,
        "language": "zh",
        "format": "json",
    }
    url = f"{GEO_URL}?{urlencode(params)}"
    data = cached_json(url, ttl=86400)
    results = (data.get("json") or {}).get("results") or []
    if not results:
        raise RuntimeError(f"未找到地点：{name}")
    first = results[0]
    return {
        "adapter": "open_meteo_geocode",
        "query": name,
        "name": first.get("name"),
        "country": first.get("country"),
        "admin1": first.get("admin1"),
        "latitude": first.get("latitude"),
        "longitude": first.get("longitude"),
        "timezone": first.get("timezone"),
        "source_url": url,
        "fetched_at": data["fetched_at_iso"],
        "sha256": data["sha256"],
    }


def forecast(lat: float, lon: float, days: int = 7, ttl: int = 1800, past_days: int = 0) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": DAILY,
        "timezone": "Asia/Shanghai",
        "forecast_days": max(1, min(int(days), 16)),
    }
    if past_days:
        params["past_days"] = max(0, min(int(past_days), 92))
    url = f"{FORECAST_URL}?{urlencode(params)}"
    data = cached_json(url, ttl=ttl)
    payload = data.get("json") or {}
    return {
        "adapter": "open_meteo_forecast",
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "timezone": payload.get("timezone"),
        "elevation": payload.get("elevation"),
        "daily_units": payload.get("daily_units"),
        "daily": payload.get("daily"),
        "source_url": url,
        "fetched_at": data["fetched_at_iso"],
        "sha256": data["sha256"],
        "note": "Open-Meteo 为开放预报/近期接口，不是中国官方站点观测；仅作辅助核验。",
    }


def recent(lat: float, lon: float, start_date: str, end_date: str, ttl: int = 1800) -> dict:
    """近几天的实况近似：Archive 有 5 天左右延迟，改用 forecast 的 past_days。"""
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
    except Exception as exc:
        raise ValueError("近期天气日期格式应为 YYYY-MM-DD") from exc
    past_days = max(1, min(92, (date.today() - start).days + 2))
    data = forecast(lat, lon, days=1, ttl=ttl, past_days=past_days)
    daily = data.get("daily") or {}
    times = daily.get("time") or []
    keep = [i for i, t in enumerate(times) if start_date <= t <= end_date]
    filtered = {}
    for key, values in daily.items():
        if isinstance(values, list) and len(values) == len(times):
            filtered[key] = [values[i] for i in keep]
        else:
            filtered[key] = values
    data["daily"] = filtered
    data["adapter"] = "open_meteo_recent"
    data["note"] = "Open-Meteo 近期实况近似（forecast past_days），不是中国官方站点观测；仅作辅助核验。"
    return data


def archive(lat: float, lon: float, start_date: str, end_date: str, ttl: int = 3600) -> dict:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": DAILY,
        "timezone": "Asia/Shanghai",
    }
    url = f"{ARCHIVE_URL}?{urlencode(params)}"
    data = cached_json(url, ttl=ttl)
    payload = data.get("json") or {}
    return {
        "adapter": "open_meteo_archive",
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "timezone": payload.get("timezone"),
        "daily_units": payload.get("daily_units"),
        "daily": payload.get("daily"),
        "source_url": url,
        "fetched_at": data["fetched_at_iso"],
        "sha256": data["sha256"],
        "note": "Open-Meteo Archive 为再分析/历史天气接口，不是中国官方站点观测；仅作辅助核验。",
    }
