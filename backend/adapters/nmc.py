"""Central Meteorological Observatory (nmc.cn) adapter.

Public endpoints used by the NMC site itself:
  /rest/province/all                 -> provinces
  /rest/province/{pcode}             -> cities in a province
  /rest/weather?stationid={code}     -> real-time + 7-day forecast + city warning
  /rest/findAlarm?pageNo=&pageSize=  -> national warning list
  /product/realrank/1hour/list.json  -> latest 1-hour ranking timestamps
  /product/realrank/1hour/{ts}.json  -> top 10 rain/temp/wind stations

These are public JSON endpoints. We cache aggressively and cite the source URL.
"""
from __future__ import annotations

import time
from urllib.parse import urlencode

from .http_client import cached_json

BASE = "https://www.nmc.cn"
PROVINCE_URL = f"{BASE}/rest/province/all"
WEATHER_URL = f"{BASE}/rest/weather"
ALARM_URL = f"{BASE}/rest/findAlarm"
RANK_LIST_URL = f"{BASE}/product/realrank/1hour/list.json"

# Province code -> capital city (NMC city name). Used when the user asks for a province.
PROVINCE_CAPITAL_CITY = {
    "北京": "北京", "天津": "天津", "上海": "上海", "重庆": "重庆",
    "河北": "石家庄", "山西": "太原", "内蒙古": "呼和浩特", "辽宁": "沈阳",
    "吉林": "长春", "黑龙江": "哈尔滨", "江苏": "南京", "浙江": "杭州",
    "安徽": "合肥", "福建": "福州", "江西": "南昌", "山东": "济南",
    "河南": "郑州", "湖北": "武汉", "湖南": "长沙", "广东": "广州",
    "广西": "南宁", "海南": "海口", "四川": "成都", "贵州": "贵阳",
    "云南": "昆明", "西藏": "拉萨", "陕西": "西安", "甘肃": "兰州",
    "青海": "西宁", "宁夏": "银川", "新疆": "乌鲁木齐",
    "香港": "香港", "澳门": "澳门", "台湾": "台北",
}

# Major city -> province code. Extend as needed; unknown cities fall back to Open-Meteo.
CITY_PROVINCE = {
    "北京": "ABJ", "天津": "ATJ", "上海": "ASH", "重庆": "ACQ",
    "石家庄": "AHE", "太原": "ASX", "呼和浩特": "ANM", "沈阳": "ALN",
    "大连": "ALN", "长春": "AJL", "哈尔滨": "AHL", "南京": "AJS",
    "苏州": "AJS", "杭州": "AZJ", "宁波": "AZJ", "温州": "AZJ",
    "合肥": "AAH", "福州": "AFJ", "厦门": "AFJ", "南昌": "AJX",
    "济南": "ASD", "青岛": "ASD", "郑州": "AHA", "武汉": "AHB",
    "长沙": "AHN", "广州": "AGD", "深圳": "AGD", "珠海": "AGD",
    "汕头": "AGD", "湛江": "AGD", "南宁": "AGX", "海口": "AHI",
    "三亚": "AHI", "成都": "ASC", "贵阳": "AGZ", "昆明": "AYN",
    "拉萨": "AXZ", "西安": "ASN", "兰州": "AGS", "西宁": "AQH",
    "银川": "ANX", "乌鲁木齐": "AXJ",
}


def _norm(name: str) -> str:
    s = (name or "").strip()
    for suffix in ("特别行政区", "自治区", "自治州", "地区", "省", "市", "区", "县"):
        if s.endswith(suffix) and len(s) > len(suffix):
            s = s[: -len(suffix)]
    return s


def _clean_num(value):
    if value in (None, "", "9999", 9999):
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return value


def _clean_text(value):
    if value in (None, "", "9999"):
        return None
    return value


def get_provinces(ttl: int = 86400) -> dict:
    cached = cached_json(PROVINCE_URL, ttl=ttl)
    return {
        "adapter": "nmc_provinces",
        "items": cached["json"],
        "source_url": PROVINCE_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
    }


def get_cities(province_code: str, ttl: int = 86400) -> dict:
    url = f"{BASE}/rest/province/{province_code}"
    cached = cached_json(url, ttl=ttl)
    return {
        "adapter": "nmc_cities",
        "province_code": province_code,
        "items": cached["json"],
        "source_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
    }


def find_city(name: str) -> dict | None:
    target = _norm(name)
    provinces = get_provinces()["items"]

    # 1) province name -> capital city
    for p in provinces:
        if _norm(p.get("name", "")) == target:
            pcode = p["code"]
            cities = get_cities(pcode)["items"]
            capital = PROVINCE_CAPITAL_CITY.get(target)
            for c in cities:
                if _norm(c.get("city", "")) == _norm(capital or ""):
                    return {**c, "province_code": pcode, "source": "province_capital"}
            if cities:
                return {**cities[0], "province_code": pcode, "source": "province_first_city"}
            return None

    # 2) major city -> province code -> exact city
    pcode = CITY_PROVINCE.get(target)
    if pcode:
        cities = get_cities(pcode)["items"]
        for c in cities:
            if _norm(c.get("city", "")) == target:
                return {**c, "province_code": pcode, "source": "city_index"}
        # fallback: first city in the province
        if cities:
            return {**cities[0], "province_code": pcode, "source": "province_first_city"}

    return None


def get_weather(city: str, ttl: int = 600) -> dict:
    city_info = find_city(city)
    if not city_info:
        raise KeyError(f"中央气象台未找到城市：{city}")

    code = city_info["code"]
    url = f"{WEATHER_URL}?{urlencode({'stationid': code})}"
    cached = cached_json(url, ttl=ttl)
    payload = cached["json"]
    if payload.get("code") != 0 or not payload.get("data"):
        raise RuntimeError(f"中央气象台返回异常：{payload.get('msg')}")

    data = payload["data"]
    real = data.get("real") or {}
    predict = data.get("predict") or {}
    warn = real.get("warn") or {}

    warning = None
    if warn.get("alert") not in (None, "", "9999"):
        warning = {
            "alert": _clean_text(warn.get("alert")),
            "signaltype": _clean_text(warn.get("signaltype")),
            "signallevel": _clean_text(warn.get("signallevel")),
            "issuetime": _clean_text(warn.get("issuetime")),
            "content": _clean_text(warn.get("issuecontent")),
            "url": _clean_text(warn.get("url")),
        }

    forecast = []
    for d in predict.get("detail") or []:
        day = d.get("day") or {}
        night = d.get("night") or {}
        forecast.append({
            "date": d.get("date"),
            "day_weather": _clean_text((day.get("weather") or {}).get("info")),
            "day_temp": _clean_num((day.get("weather") or {}).get("temperature")),
            "day_wind": _clean_text((day.get("wind") or {}).get("direct")),
            "day_power": _clean_text((day.get("wind") or {}).get("power")),
            "night_weather": _clean_text((night.get("weather") or {}).get("info")),
            "night_temp": _clean_num((night.get("weather") or {}).get("temperature")),
            "night_wind": _clean_text((night.get("wind") or {}).get("direct")),
            "night_power": _clean_text((night.get("wind") or {}).get("power")),
            "precipitation": _clean_num(d.get("precipitation")),
        })

    return {
        "adapter": "nmc_weather",
        "station": {
            "code": city_info.get("code"),
            "province": city_info.get("province"),
            "city": city_info.get("city"),
            "url": city_info.get("url"),
            "source": city_info.get("source"),
        },
        "publish_time": _clean_text(real.get("publish_time")),
        "real": {
            "temperature": _clean_num((real.get("weather") or {}).get("temperature")),
            "humidity": _clean_num((real.get("weather") or {}).get("humidity")),
            "rain": _clean_num((real.get("weather") or {}).get("rain")),
            "weather": _clean_text((real.get("weather") or {}).get("info")),
            "feelst": _clean_num((real.get("weather") or {}).get("feelst")),
            "wind_direct": _clean_text((real.get("wind") or {}).get("direct")),
            "wind_power": _clean_text((real.get("wind") or {}).get("power")),
            "wind_speed": _clean_num((real.get("wind") or {}).get("speed")),
        },
        "warning": warning,
        "forecast": forecast,
        "source_url": f"{BASE}{city_info.get('url', '')}",
        "api_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "中央气象台城市预报；省级名称默认取省会代表点，不代表全省平均。",
    }


def get_alarms(province: str | None = None, pages: int = 2, page_size: int = 30, ttl: int = 300) -> dict:
    items = []
    source_urls = []
    for page in range(1, max(1, pages) + 1):
        url = f"{ALARM_URL}?{urlencode({'pageNo': page, 'pageSize': page_size})}"
        cached = cached_json(url, ttl=ttl)
        payload = cached["json"]
        page_data = ((payload.get("data") or {}).get("page") or {})
        items.extend(page_data.get("list") or [])
        source_urls.append(url)

    target = _norm(province) if province else None
    if target:
        filtered = [x for x in items if target in (x.get("title") or "")]
        # If the province filter is too strict, keep the national list but annotate.
        if filtered:
            items = filtered

    return {
        "adapter": "nmc_alarms",
        "province_filter": province,
        "count": len(items),
        "items": items[:60],
        "source_url": f"{BASE}/publish/alarm.html",
        "api_urls": source_urls,
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "note": "中央气象台灾害预警列表；省份过滤按标题匹配，未匹配时保留全国列表。",
    }


def get_rank_1h(ttl: int = 600) -> dict:
    cached_list = cached_json(RANK_LIST_URL, ttl=ttl)
    listing = cached_list["json"]
    if not isinstance(listing, list) or not listing:
        raise RuntimeError("中央气象台 1 小时排行列表为空")
    latest = listing[0]
    url = latest.get("url")
    cached = cached_json(url, ttl=ttl)
    payload = cached["json"]

    def top(key):
        block = payload.get(key) or {}
        return {
            "unit": block.get("unit"),
            "list": block.get("list") or [],
        }

    return {
        "adapter": "nmc_rank_1h",
        "obs_time": payload.get("obs_time"),
        "source": payload.get("source"),
        "tem_max": top("tem_max"),
        "tem_min": top("tem_min"),
        "pre_1h": top("pre_1h"),
        "win_s": top("win_s"),
        "source_url": url,
        "list_url": RANK_LIST_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "中央气象台 2418 个国家级站 1 小时实况排行；用于辅助核对短时强降水/极端温度/大风。",
    }
