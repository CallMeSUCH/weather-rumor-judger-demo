"""Meteorology Term Checker · local backend.

Serves the static prototype and a small evidence API (stdlib only).

Run:
    python backend/server.py
    # or: python backend/server.py 8766

Then open:
    http://127.0.0.1:8766
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import date, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = Path(__file__).resolve().parent.parent
WEB = BASE / "web"
DATA = WEB / "data"

try:
    from adapters import cpc_oni, open_meteo, typhoon, nmc, cma_typhoon, nmefc, piyao, cma_station, ncc_enso, ogimet, ocr, nasa_power, meteostat, china_weather, gsod, datashareclub
except ImportError:  # python -m backend.server
    from backend.adapters import cpc_oni, open_meteo, typhoon, nmc, cma_typhoon, nmefc, piyao, cma_station, ncc_enso, ogimet, ocr, nasa_power, meteostat, china_weather, gsod, datashareclub


def read_json(name: str):
    with open(DATA / name, "r", encoding="utf-8") as f:
        return json.load(f)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    # ---------- helpers ----------
    def json_response(self, obj, status: int = 200):
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def error_response(self, message: str, status: int = 502, extra: dict | None = None):
        payload = {"ok": False, "error": message}
        if extra:
            payload.update(extra)
        self.json_response(payload, status=status)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- routing ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/editor/save":
            try:
                length = int(self.headers.get("Content-Length", "0") or 0)
                if length <= 0:
                    self.error_response("没有收到编辑数据", status=400)
                    return
                if length > 5 * 1024 * 1024:
                    self.error_response("编辑数据超过 5 MB", status=413)
                    return
                body = self.rfile.read(length)
                payload = json.loads(body.decode("utf-8"))
                page = str(payload.get("page") or "home")
                if page not in {"home", "terms", "result", "live"}:
                    self.error_response(f"不支持的页面：{page}", status=400)
                    return
                target = DATA / f"{page}_editor.json"
                target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                self.json_response({
                    "ok": True,
                    "path": f"web/data/{target.name}",
                    "bytes": len(body),
                    "blocks": len(payload.get("blocks") or []),
                    "saved_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
                })
            except Exception as exc:  # noqa: BLE001
                self.error_response(f"保存编辑失败：{exc}", status=500)
            return

        if path != "/api/ocr":
            self.error_response(f"未知 API：{parsed.path}", status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0:
                self.error_response("没有收到图片数据", status=400)
                return
            if length > 20 * 1024 * 1024:
                self.error_response("图片超过 20 MB，请先压缩或截图", status=413)
                return

            content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            ext_map = {
                "image/png": ".png",
                "image/jpeg": ".jpg",
                "image/jpg": ".jpg",
                "image/bmp": ".bmp",
                "image/gif": ".gif",
                "image/tiff": ".tif",
                "image/webp": ".webp",
            }
            if content_type not in ext_map:
                self.error_response(f"不支持的图片类型：{content_type or '未提供'}", status=415)
                return

            body = self.rfile.read(length)
            cache_dir = BASE / "backend" / "cache"
            cache_dir.mkdir(parents=True, exist_ok=True)
            temp_path = cache_dir / f"ocr_{uuid.uuid4().hex}{ext_map[content_type]}"
            temp_path.write_bytes(body)
            try:
                result = ocr.recognize(str(temp_path))
                result["bytes"] = len(body)
                self.json_response({"ok": True, "data": result})
            finally:
                try:
                    temp_path.unlink(missing_ok=True)
                except Exception:
                    pass
        except Exception as exc:  # noqa: BLE001
            self.error_response(str(exc), status=502, extra={"path": parsed.path})

    def handle_api(self, parsed):
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        try:
            if path == "/api/health":
                self.json_response({
                    "ok": True,
                    "service": "meteorology-term-checker",
                    "version": "0.1",
                    "web_root": str(WEB),
                    "adapters": ["cpc_oni", "open_meteo_forecast", "open_meteo_archive", "typhoon_curated", "nmc_weather", "nmc_alarms", "nmc_rank_1h", "cma_typhoon", "nmefc_warnings", "piyao_search", "cma_station", "ncc_enso", "ogimet_synop", "nasa_power", "meteostat_hourly", "china_weather_daily", "china_weather_window", "datashareclub_window", "noaa_gsod_daily", "windows_ocr"],
                })
                return

            if path == "/api/editor/load":
                page = qs.get("page", ["home"])[0]
                if page not in {"home", "terms", "result", "live"}:
                    self.error_response(f"不支持的页面：{page}", status=400)
                    return
                target = DATA / f"{page}_editor.json"
                if not target.exists():
                    self.json_response({"ok": True, "data": None})
                    return
                self.json_response({"ok": True, "data": json.loads(target.read_text(encoding="utf-8"))})
                return

            if path == "/api/terms":
                self.json_response({"ok": True, "items": read_json("terms.json")})
                return

            if path == "/api/cases":
                self.json_response({"ok": True, "items": read_json("cases.json")})
                return

            if path == "/api/sources":
                self.json_response({"ok": True, "items": read_json("sources.json")})
                return

            if path == "/api/evidence/oni":
                date_str = qs.get("date", [None])[0]
                self.json_response({"ok": True, "data": cpc_oni.get_oni(date_str=date_str)})
                return

            if path == "/api/evidence/weather":
                lat = qs.get("lat", [None])[0]
                lon = qs.get("lon", [None])[0]
                if lat is None or lon is None:
                    self.error_response("需要 lat 和 lon 参数", status=400)
                    return
                start = qs.get("start", [None])[0]
                end = qs.get("end", [None])[0]
                if start and end:
                    try:
                        start_day = date.fromisoformat(start)
                        recent_cutoff = date.today() - timedelta(days=10)
                        if start_day >= recent_cutoff:
                            data = open_meteo.recent(float(lat), float(lon), start, end)
                        else:
                            data = open_meteo.archive(float(lat), float(lon), start, end)
                    except Exception:
                        data = open_meteo.archive(float(lat), float(lon), start, end)
                else:
                    days = int(qs.get("days", ["7"])[0])
                    data = open_meteo.forecast(float(lat), float(lon), days=days)
                self.json_response({"ok": True, "data": data})
                return

            if path == "/api/evidence/geocode":
                name = qs.get("name", [None])[0]
                if not name:
                    self.error_response("需要 name 参数", status=400)
                    return
                pc = open_meteo.province_capital(name)
                if pc:
                    self.json_response({"ok": True, "data": pc})
                    return
                self.json_response({"ok": True, "data": open_meteo.geocode(name)})
                return

            if path == "/api/evidence/typhoon":
                name = qs.get("name", [None])[0]
                if not name:
                    self.error_response("需要 name 参数", status=400)
                    return
                self.json_response({"ok": True, "data": typhoon.lookup(name)})
                return

            if path == "/api/evidence/nmc/weather":
                city = qs.get("city", [None])[0]
                if not city:
                    self.error_response("需要 city 参数", status=400)
                    return
                self.json_response({"ok": True, "data": nmc.get_weather(city)})
                return

            if path == "/api/evidence/nmc/alarms":
                province = qs.get("province", [None])[0]
                pages = int(qs.get("pages", ["2"])[0])
                self.json_response({"ok": True, "data": nmc.get_alarms(province=province, pages=pages)})
                return

            if path == "/api/evidence/nmc/rank1h":
                self.json_response({"ok": True, "data": nmc.get_rank_1h()})
                return

            if path == "/api/evidence/nmc/provinces":
                self.json_response({"ok": True, "data": nmc.get_provinces()})
                return

            if path == "/api/evidence/nmc/cities":
                pcode = qs.get("province", [None])[0]
                if not pcode:
                    self.error_response("需要 province 参数（省码，如 AGD）", status=400)
                    return
                self.json_response({"ok": True, "data": nmc.get_cities(pcode)})
                return

            if path == "/api/evidence/cma/typhoons":
                self.json_response({"ok": True, "data": cma_typhoon.get_list()})
                return

            if path == "/api/evidence/cma/typhoon":
                name = qs.get("name", [None])[0]
                tid = qs.get("id", [None])[0]
                year = qs.get("year", [None])[0]
                if tid:
                    self.json_response({"ok": True, "data": cma_typhoon.get_track(int(tid))})
                    return
                if not name:
                    self.error_response("需要 name 或 id 参数", status=400)
                    return
                self.json_response({"ok": True, "data": cma_typhoon.get_by_name(name, year=int(year) if year else None)})
                return

            if path == "/api/evidence/cma/latest":
                self.json_response({"ok": True, "data": cma_typhoon.get_latest()})
                return

            if path == "/api/evidence/cma/news":
                self.json_response({"ok": True, "data": cma_typhoon.get_news()})
                return

            if path == "/api/evidence/nmefc/warnings":
                type_ = qs.get("type", ["wave"])[0]
                year = qs.get("year", [None])[0]
                self.json_response({"ok": True, "data": nmefc.get_warnings(type_=type_, year=int(year) if year else None)})
                return

            if path == "/api/evidence/nmefc/years":
                type_ = qs.get("type", ["wave"])[0]
                self.json_response({"ok": True, "data": nmefc.get_years(type_=type_)})
                return

            if path == "/api/evidence/piyao/search":
                q = qs.get("q", [None])[0]
                if not q:
                    self.error_response("需要 q 参数", status=400)
                    return
                limit = int(qs.get("limit", ["10"])[0])
                self.json_response({"ok": True, "data": piyao.search(q, page_size=limit)})
                return

            if path == "/api/evidence/cma/station/status":
                self.json_response({"ok": True, "data": cma_station.status()})
                return

            if path == "/api/evidence/cma/station/surface":
                stations = qs.get("stations", [None])[0]
                start = qs.get("start", [None])[0]
                end = qs.get("end", [None])[0]
                if not (stations and start and end):
                    self.error_response("需要 stations/start/end 参数", status=400)
                    return
                elements = qs.get("elements", ["Station_Id_C,Datetime,TEM,DPT,RHU,PRE_1h,PRS,WIN_D_Avg_10mi,WIN_S_Avg_10mi,VIS"])[0]
                self.json_response({
                    "ok": True,
                    "data": cma_station.query_surface(stations, start, end, elements=elements),
                })
                return

            if path == "/api/ocr/status":
                self.json_response({"ok": True, "data": ocr.engine_status()})
                return

            if path == "/api/evidence/china-weather/daily":
                city = qs.get("city", [None])[0]
                date = qs.get("date", [None])[0]
                if not (city and date):
                    self.error_response("需要 city/date 参数", status=400)
                    return
                self.json_response({"ok": True, "data": china_weather.get_daily(city, date)})
                return

            if path == "/api/evidence/china-weather/window":
                city = qs.get("city", [None])[0]
                date = qs.get("date", [None])[0]
                if not (city and date):
                    self.error_response("需要 city/date 参数", status=400)
                    return
                before = int(qs.get("before", ["2"])[0])
                after = int(qs.get("after", ["1"])[0])
                self.json_response({
                    "ok": True,
                    "data": china_weather.get_window(city, date, before=before, after=after),
                })
                return

            if path == "/api/evidence/datashareclub/window":
                city = qs.get("city", [None])[0]
                date = qs.get("date", [None])[0]
                if not (city and date):
                    self.error_response("需要 city/date 参数", status=400)
                    return
                before = int(qs.get("before", ["2"])[0])
                after = int(qs.get("after", ["1"])[0])
                self.json_response({
                    "ok": True,
                    "data": datashareclub.get_window(city, date, before=before, after=after),
                })
                return

            if path == "/api/evidence/gsod/daily":
                station = qs.get("station", ["54511"])[0]
                start = qs.get("start", [None])[0]
                end = qs.get("end", [None])[0]
                if not (start and end):
                    self.error_response("需要 start/end 参数", status=400)
                    return
                self.json_response({"ok": True, "data": gsod.get_daily(station, start, end)})
                return

            if path == "/api/evidence/meteostat/hourly":
                station = qs.get("station", [None])[0]
                date = qs.get("date", [None])[0]
                if not (station and date):
                    self.error_response("需要 station/date 参数", status=400)
                    return
                self.json_response({"ok": True, "data": meteostat.get_hourly(station, date)})
                return

            if path == "/api/evidence/nasa/power":
                lat = qs.get("lat", [None])[0]
                lon = qs.get("lon", [None])[0]
                start = qs.get("start", [None])[0]
                end = qs.get("end", [None])[0]
                if not (lat and lon and start and end):
                    self.error_response("需要 lat/lon/start/end 参数", status=400)
                    return
                parameters = qs.get("parameters", ["PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,WS2M,RH2M"])[0]
                self.json_response({
                    "ok": True,
                    "data": nasa_power.get_daily(float(lat), float(lon), start, end, parameters=parameters),
                })
                return

            if path == "/api/evidence/ogimet/synop":
                station = qs.get("station", [None])[0]
                start = qs.get("start", [None])[0]
                end = qs.get("end", [None])[0]
                if not (station and start and end):
                    self.error_response("需要 station/start/end 参数", status=400)
                    return
                self.json_response({"ok": True, "data": ogimet.get_synop(station, start, end)})
                return

            if path == "/api/evidence/ncc/enso":
                self.json_response({"ok": True, "data": ncc_enso.get_status()})
                return

            if path == "/api/evidence/ncc/news":
                q = qs.get("q", ["厄尔尼诺"])[0]
                limit = int(qs.get("limit", ["5"])[0])
                self.json_response({"ok": True, "data": ncc_enso.get_public_news(q, limit=limit)})
                return

            if path == "/api/evidence/registry":
                self.json_response({
                    "ok": True,
                    "adapters": [
                        {"id": "cpc_oni", "type": "live", "source": "NOAA CPC", "endpoint": "/api/evidence/oni"},
                        {"id": "open_meteo_forecast", "type": "live", "source": "Open-Meteo", "endpoint": "/api/evidence/weather?lat=39.9&lon=116.4&days=7"},
                        {"id": "open_meteo_archive", "type": "live", "source": "Open-Meteo", "endpoint": "/api/evidence/weather?lat=39.9&lon=116.4&start=2025-10-08&end=2025-10-11"},
                        {"id": "typhoon_curated", "type": "curated", "source": "CMA 台风网（样本）", "endpoint": "/api/evidence/typhoon?name=山竹"},
                        {"id": "nmc_weather", "type": "live", "source": "中央气象台", "endpoint": "/api/evidence/nmc/weather?city=北京"},
                        {"id": "nmc_alarms", "type": "live", "source": "中央气象台", "endpoint": "/api/evidence/nmc/alarms?province=北京&pages=2"},
                        {"id": "nmc_rank_1h", "type": "live", "source": "中央气象台", "endpoint": "/api/evidence/nmc/rank1h"},
                        {"id": "cma_typhoon", "type": "live", "source": "CMA/NMC 台风", "endpoint": "/api/evidence/cma/latest"},
                        {"id": "nmefc_warnings", "type": "live", "source": "国家海洋预报台", "endpoint": "/api/evidence/nmefc/warnings?type=wave"},
                        {"id": "piyao_search", "type": "live", "source": "中国互联网联合辟谣平台", "endpoint": "/api/evidence/piyao/search?q=台风"},
                        {"id": "cma_station", "type": "credential", "source": "中国气象数据网", "endpoint": "/api/evidence/cma/station/status"},
                        {"id": "ncc_enso", "type": "login", "source": "国家气候中心", "endpoint": "/api/evidence/ncc/enso"},
                        {"id": "ogimet_synop", "type": "live", "source": "Ogimet / WMO SYNOP", "endpoint": "/api/evidence/ogimet/synop?station=54511&start=2025-10-08&end=2025-10-09"},
                        {"id": "nasa_power", "type": "live", "source": "NASA POWER", "endpoint": "/api/evidence/nasa/power?lat=23.1291&lon=113.2644&start=2026-05-20&end=2026-05-20"},
                        {"id": "meteostat_hourly", "type": "third_party", "source": "Meteostat", "endpoint": "/api/evidence/meteostat/hourly?station=54511&date=2025-10-08"},
                        {"id": "china_weather_daily", "type": "live", "source": "中国天气网", "endpoint": "/api/evidence/china-weather/daily?city=北京&date=2026-10-17"},
                        {"id": "windows_ocr", "type": "local", "source": "Windows Media OCR", "endpoint": "POST /api/ocr"},
                    ],
                })
                return

            self.error_response(f"未知 API：{path}", status=404)
        except Exception as exc:  # noqa: BLE001 - prototype: return the error to the UI
            self.error_response(str(exc), status=502, extra={"path": path, "query": parsed.query})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8766"))
    if not (WEB / "index.html").exists():
        print(f"找不到 {WEB / 'index.html'}", file=sys.stderr)
        sys.exit(1)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("=" * 60)
    print("气象信息判别器 · 本地后端")
    print(f"网页：http://127.0.0.1:{port}")
    print(f"API ：http://127.0.0.1:{port}/api/health")
    print("按 Ctrl+C 停止")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
