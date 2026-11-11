"""Quick adapter smoke test.

Run from project root:
    python backend/test_adapters.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import cpc_oni, open_meteo, typhoon, nmc, cma_typhoon  # noqa: E402


def main():
    print("=== CPC ONI ===")
    oni = cpc_oni.get_oni()
    print("latest:", oni["latest"])
    print("warmest:", oni["record_warmest"])
    print("source:", oni["data_url"])
    print("fetched_at:", oni["fetched_at"])

    print("\n=== Open-Meteo forecast (Beijing) ===")
    fc = open_meteo.forecast(39.9, 116.4, days=3)
    print("time:", fc["daily"]["time"])
    print("rain:", fc["daily"]["precipitation_sum"])
    print("tmax:", fc["daily"]["temperature_2m_max"])
    print("source:", fc["source_url"])

    print("\n=== Typhoon curated sample ===")
    ty = typhoon.lookup("山竹")
    print(ty["data"])
    print("note:", ty["note"])

    print("\n=== NMC city forecast (Beijing) ===")
    w = nmc.get_weather("北京")
    print("station:", w["station"])
    print("publish_time:", w["publish_time"])
    print("real:", w["real"])
    print("forecast days:", len(w["forecast"]))
    print("source:", w["source_url"])

    print("\n=== CMA typhoon (latest) ===")
    cma = cma_typhoon.get_latest()
    print("name:", cma["track"]["name_cn"], cma["track"]["number"])
    print("latest:", cma["track"]["latest"])
    print("max_wind:", cma["track"]["max_wind"]["wind_ms"], "m/s")
    print("forecast points:", len(cma["track"]["forecast"]))
    print("source:", cma["track"]["source_url"])


if __name__ == "__main__":
    main()
