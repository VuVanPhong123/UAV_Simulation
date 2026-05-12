import argparse
import shutil
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
    bounds = preset.get("bounds") or map_config.get("bounds")
    if not center:
        raise ValueError(f"missing center/start_latlng for map_id={map_id}")
    radius_m = float(preset.get("asset_radius_m", map_config.get("asset_radius_m", 700.0)))
    return center, radius_m, bounds


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

    center, radius_m, bounds = map_settings(map_id)
    fe_output_dir = PROJECT_ROOT / "fe" / "public" / "maps" / map_id
    core_output_dir = ROOT / "maps" / map_id
    fe_output_dir.mkdir(parents=True, exist_ok=True)
    core_output_dir.mkdir(parents=True, exist_ok=True)
    fe_output_path = fe_output_dir / "buildings.geojson"
    core_output_path = core_output_dir / "buildings.geojson"

    if bounds:
        bbox = (
            float(bounds["west"]),
            float(bounds["south"]),
            float(bounds["east"]),
            float(bounds["north"]),
        )
        print(f"[ASSETS] Downloading buildings for {map_id} bbox={bbox}")
        buildings = ox.features_from_bbox(bbox, tags={"building": True})
    else:
        print(f"[ASSETS] Downloading buildings for {map_id} around {center} r={radius_m:.0f}m")
        buildings = ox.features_from_point((float(center[0]), float(center[1])), tags={"building": True}, dist=radius_m)
    if buildings.empty:
        raise RuntimeError(f"no OSM buildings returned for map_id={map_id}")
    buildings = buildings[buildings.geometry.notna()].copy()
    buildings = buildings[buildings.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if buildings.empty:
        raise RuntimeError(f"no polygon buildings returned for map_id={map_id}")
    buildings["estimated_height"] = buildings.apply(estimate_height, axis=1)
    buildings = buildings[["geometry", "estimated_height"]].to_crs("EPSG:4326")
    buildings.to_file(fe_output_path, driver="GeoJSON")
    shutil.copyfile(fe_output_path, core_output_path)
    print(f"[ASSETS] Wrote {len(buildings)} buildings to {fe_output_path}")
    print(f"[ASSETS] Synced buildings to {core_output_path}")


def main():
    parser = argparse.ArgumentParser(description="Build per-map FE assets from OpenStreetMap.")
    parser.add_argument("--map-id", default="hanoi_my_dinh_me_tri_large")
    args = parser.parse_args()
    try:
        build_buildings(args.map_id)
        return 0
    except Exception as exc:
        print(f"[ASSET_ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
