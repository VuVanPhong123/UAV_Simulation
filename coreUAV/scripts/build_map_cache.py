import argparse
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import yaml
from pyproj import Transformer
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_cache import save_map_cache


DEFAULT_ALTITUDE_LEVELS = [20.0, 35.0, 50.0]


def load_config():
    with (ROOT / "config.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def source_buildings_path():
    candidates = [
        ROOT / "hanoi_buildings.geojson",
        ROOT.parent / "fe" / "public" / "hanoi_buildings.geojson",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("hanoi_buildings.geojson not found in coreUAV or fe/public")


def altitude_levels(config):
    perf_levels = config.get("performance", {}).get("altitude_levels")
    drone_config = config.get("drone", {})
    min_altitude = float(drone_config.get("min_altitude", 5.0))
    normal_altitude = float(drone_config.get("normal_altitude", 20.0))
    max_altitude = float(drone_config.get("max_altitude", 50.0))

    candidates = perf_levels or DEFAULT_ALTITUDE_LEVELS
    candidates = [float(level) for level in candidates]
    candidates.extend([normal_altitude, max_altitude])
    clamped = [
        max(min_altitude, min(max_altitude, level))
        for level in candidates
    ]
    return sorted(set(clamped))


def nearest_node(latlng, transformer, min_x, min_y, resolution, cols, rows):
    x, y = transformer.transform(latlng[1], latlng[0])
    i = int(round((x - min_x) / resolution))
    j = int(round((y - min_y) / resolution))
    i = max(0, min(cols - 1, i))
    j = max(0, min(rows - 1, j))
    return [i, j]


def build_cache(map_id):
    config = load_config()
    resolution = float(config.get("performance", {}).get("grid_resolution", 10.0))
    safety_margin = float(config.get("obstacle_avoidance", {}).get("safety_margin", 5.0))
    levels = altitude_levels(config)
    buildings_path = source_buildings_path()

    print("[CACHE] Loading buildings...")
    buildings = gpd.read_file(buildings_path)
    buildings = buildings.to_crs(epsg=32648)
    crs_utm = buildings.crs
    transformer = Transformer.from_crs("epsg:4326", crs_utm, always_xy=True)

    print("[CACHE] Building grid...")
    pts_gps = [config["map"]["start_latlng"], config["map"]["goal_latlng"]]
    pts_gps.extend(config["map"].get("charging_stations_latlng", []))
    pts_utm = [transformer.transform(lon, lat) for lat, lon in pts_gps]
    xs = [p[0] for p in pts_utm]
    ys = [p[1] for p in pts_utm]
    pad = 200
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_y, max_y = min(ys) - pad, max(ys) + pad
    cols = int(np.ceil((max_x - min_x) / resolution))
    rows = int(np.ceil((max_y - min_y) / resolution))

    print("[CACHE] Computing height grid...")
    height_grid = np.zeros((rows, cols), dtype=np.float32)
    sindex = buildings.sindex
    for j in range(rows):
        for i in range(cols):
            x = min_x + i * resolution
            y = min_y + j * resolution
            search_area = Point(x, y).buffer(safety_margin)
            possible_idx = list(sindex.intersection(search_area.bounds))
            if not possible_idx:
                continue
            possible = buildings.iloc[possible_idx]
            matches = possible[possible.intersects(search_area)]
            if not matches.empty:
                height_grid[j, i] = float(matches["estimated_height"].max())

    static_nfz_mask = np.zeros((rows, cols), dtype=bool)
    for nfz in config.get("map", {}).get("no_fly_zones", []):
        lat, lon = nfz["center"]
        radius = float(nfz["radius"]) + safety_margin
        nx, ny = transformer.transform(lon, lat)
        for j in range(rows):
            y = min_y + j * resolution
            for i in range(cols):
                x = min_x + i * resolution
                if np.hypot(x - nx, y - ny) <= radius:
                    static_nfz_mask[j, i] = True

    valid_masks = np.zeros((len(levels), rows, cols), dtype=bool)
    for idx, altitude in enumerate(levels):
        valid_masks[idx] = (height_grid + safety_margin < altitude) & (~static_nfz_mask)

    start_node = nearest_node(config["map"]["start_latlng"], transformer, min_x, min_y, resolution, cols, rows)
    goal_node = nearest_node(config["map"]["goal_latlng"], transformer, min_x, min_y, resolution, cols, rows)
    charging_nodes = [
        nearest_node(latlng, transformer, min_x, min_y, resolution, cols, rows)
        for latlng in config["map"].get("charging_stations_latlng", [])
    ]

    metadata = {
        "mapId": map_id,
        "resolution": resolution,
        "minX": float(min_x),
        "minY": float(min_y),
        "rows": rows,
        "cols": cols,
        "crs": str(crs_utm),
        "altitudeLevels": levels,
        "startNode": start_node,
        "goalNode": goal_node,
        "chargingStationNodes": charging_nodes,
        "sourceBuildings": buildings_path.name,
    }

    print("[CACHE] Saving cache...")
    save_map_cache(map_id, metadata, height_grid, static_nfz_mask, valid_masks)
    print("[CACHE] Done.")


def main():
    parser = argparse.ArgumentParser(description="Build static map cache for UAV runtime.")
    parser.add_argument("--map-id", default="hanoi_default")
    args = parser.parse_args()
    try:
        build_cache(args.map_id)
        return 0
    except Exception as exc:
        print(f"[CACHE_ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
