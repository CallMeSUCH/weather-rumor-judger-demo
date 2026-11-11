"""CMA station data adapter (credential-gated).

The China Meteorological Data Service Center (data.cma.cn) exposes a CIMISS-style
API, but requires a registered user / interface permission:

  http://api.data.cma.cn:8090/api
    ?dataCode=SURF_CHN_MUL_HOR
    &interfaceId=getSurfEleByTimeRangeAndStaID
    &elements=Station_Id_C,Datetime,TEM,DPT,RHU,PRE_1h,PRS,WIN_D_Avg_10mi,WIN_S_Avg_10mi,VIS
    &staIDs=54511
    &timeRange=[20211110050000,20211110050000]
    &dataFormat=json
    &userId=...
    &pwd=...

Set environment variables before starting the backend:
  CMA_API_USER=...
  CMA_API_PWD=...
  CMA_API_BASE=http://api.data.cma.cn:8090/api   (optional)

Without credentials this adapter returns a clear "not configured" status.
It never fakes station observations.
"""
from __future__ import annotations

import os
from urllib.parse import urlencode

from .http_client import cached_json

DEFAULT_BASE = "http://api.data.cma.cn:8090/api"


def status() -> dict:
    user = os.environ.get("CMA_API_USER")
    pwd = os.environ.get("CMA_API_PWD")
    return {
        "adapter": "cma_station",
        "configured": bool(user and pwd),
        "required_env": ["CMA_API_USER", "CMA_API_PWD"],
        "optional_env": ["CMA_API_BASE"],
        "real_name_required": True,
        "order_required": True,
        "trial": "每类资料的 API 服务仅提供一次免费 7 天试用（用于调试/验证）",
        "apply_url": "https://data.cma.cn/weatherGis/interface/interfaceUse",
        "market_url": "https://data.cma.cn/Market/MarketList.html",
        "instructions_url": "http://www.nmic.cn/Market/instructions.html",
        "note": (
            "中国气象数据网 API 面向个人/单位/教育科研实名用户，需要先下单获取 userId/pwd。"
            "部分数据标“免费”，部分为“定制/收费”；以 API 订单金额为准。"
            "未配置时本适配器只返回状态，不返回任何伪造观测。"
        ),
    }


def query_surface(
    stations: str,
    start: str,
    end: str,
    elements: str = "Station_Id_C,Datetime,TEM,DPT,RHU,PRE_1h,PRS,WIN_D_Avg_10mi,WIN_S_Avg_10mi,VIS",
    data_code: str = "SURF_CHN_MUL_HOR",
    interface_id: str = "getSurfEleByTimeRangeAndStaID",
    ttl: int = 600,
) -> dict:
    status_info = status()
    if not status_info["configured"]:
        raise RuntimeError(
            "CMA 站点接口未配置：请设置 CMA_API_USER / CMA_API_PWD，"
            "并在 https://data.cma.cn/weatherGis/interface/interfaceUse 申请权限。"
        )

    base = os.environ.get("CMA_API_BASE", DEFAULT_BASE)
    params = {
        "dataCode": data_code,
        "interfaceId": interface_id,
        "elements": elements,
        "staIDs": stations,
        "timeRange": f"[{start},{end}]",
        "dataFormat": "json",
        "userId": os.environ["CMA_API_USER"],
        "pwd": os.environ["CMA_API_PWD"],
    }
    url = f"{base}?{urlencode(params)}"
    cached = cached_json(url, ttl=ttl, encoding="utf-8")
    return {
        "adapter": "cma_station_surface",
        "request": {
            "stations": stations,
            "start": start,
            "end": end,
            "elements": elements,
            "data_code": data_code,
        },
        "data": cached["json"],
        "source_url": "https://data.cma.cn/weatherGis/interface/interfaceUse",
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "中国气象数据网 CIMISS 接口；需账号/权限。",
    }
