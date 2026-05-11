import argparse
import sys
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent


def load_config():
    with (ROOT / "config.yaml").open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def map_settings(map_id):
    config = load_config()
    map_config = config.get("map", {})
    preset = map_config.get("presets", {}).get(map_id, {})
    center = preset.get("start_latlng") or map_config.get("start_latlng")
    if not center:
        raise ValueError(f"missing center/start_latlng for map_id={map_id}")
    return center, float(preset.get("asset_radius_m", map_config.get("asset_radius_m", 700.0)))


def estimate_height(row):
    height = row.get("height")
    if height is not None and not pd.isna(height):
        try:
            return float(str(height).replace("m", "").strip())
        except Exception:
            pass
    levels = row.get("building:levels")
    if levels is not None and not pd.isna(levels):
        try:
            return float(levels) * 3.5
        except Exception:
            pass
    return 12.0


def build_buildings(map_id):
    try:
        import osmnx as ox
    except ImportError as exc:
        raise RuntimeError("osmnx is required to download OSM building assets") from exc

    center, radius_m = map_settings(map_id)
    output_dir = PROJECT_ROOT / "fe" / "public" / "maps" / map_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "buildings.geojson"

    print(f"[ASSETS] Downloading buildings for {map_id} around {center} r={radius_m:.0f}m")
    buildings = ox.features_from_point((float(center[0]), float(center[1])), tags={"building": True}, dist=radius_m)
    if buildings.empty:
        raise RuntimeError(f"no OSM buildings returned for map_id={map_id}")
    buildings = buildings[buildings.geometry.notna()].copy()
    buildings["estimated_height"] = buildings.apply(estimate_height, axis=1)
    buildings = buildings[["geometry", "estimated_height"]].to_crs("EPSG:4326")
    buildings.to_file(output_path, driver="GeoJSON")
    print(f"[ASSETS] Wrote {len(buildings)} buildings to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Build per-map FE assets from OpenStreetMap.")
    parser.add_argument("--map-id", default="hanoi_my_dinh_me_tri")
    args = parser.parse_args()
    try:
        build_buildings(args.map_id)
        return 0
    except Exception as exc:
        print(f"[ASSET_ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
