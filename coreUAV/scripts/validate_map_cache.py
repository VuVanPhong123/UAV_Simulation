import argparse
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from maps.cache import cache_exists, find_cache_dir, load_map_cache


def _node_in_bounds(node, rows, cols):
    return (
        isinstance(node, list)
        and len(node) == 2
        and 0 <= int(node[0]) < cols
        and 0 <= int(node[1]) < rows
    )


def _validate_bounds(bounds):
    if not bounds:
        return
    required = ("south", "west", "north", "east")
    missing = [key for key in required if key not in bounds]
    if missing:
        raise ValueError(f"bounds missing keys: {missing}")
    south = float(bounds["south"])
    west = float(bounds["west"])
    north = float(bounds["north"])
    east = float(bounds["east"])
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError(f"invalid bounds: {bounds}")


def _latlng_within_bounds(point, bounds):
    if not bounds:
        return True
    lat = float(point[0])
    lon = float(point[1])
    return (
        float(bounds["south"]) <= lat <= float(bounds["north"])
        and float(bounds["west"]) <= lon <= float(bounds["east"])
    )


def _node_clear_near(cache, node, altitude, radius_cells=8):
    metadata = cache.metadata
    rows = int(metadata["rows"])
    cols = int(metadata["cols"])
    levels = [float(level) for level in metadata["altitudeLevels"]]
    if not levels:
        return False
    altitude_idx = min(range(len(levels)), key=lambda idx: abs(levels[idx] - float(altitude)))
    valid_mask = cache.valid_masks[altitude_idx]
    base_i, base_j = node
    for radius in range(0, int(radius_cells) + 1):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if radius > 0 and abs(dx) != radius and abs(dy) != radius:
                    continue
                i = base_i + dx
                j = base_j + dy
                if 0 <= i < cols and 0 <= j < rows and bool(valid_mask[j, i]):
                    return True
    return False


def _latlng_to_node(cache, point):
    try:
        from pyproj import Transformer
    except Exception:
        return None

    metadata = cache.metadata
    transformer = Transformer.from_crs("epsg:4326", metadata["crs"], always_xy=True)
    x, y = transformer.transform(float(point[1]), float(point[0]))
    resolution = float(metadata["resolution"])
    i = int(round((x - float(metadata["minX"])) / resolution))
    j = int(round((y - float(metadata["minY"])) / resolution))
    i = max(0, min(int(metadata["cols"]) - 1, i))
    j = max(0, min(int(metadata["rows"]) - 1, j))
    return (i, j)


def _validate_safe_order_points(cache):
    metadata = cache.metadata
    safe_order_points = metadata.get("safeOrderPoints", [])
    if len(safe_order_points) < 8:
        print(f"[WARN] safeOrderPoints count is low: {len(safe_order_points)}")
    if not safe_order_points:
        return

    bounds = metadata.get("bounds")
    normal_altitude = float(metadata.get("altitudeLevels", [20.0])[0])
    outside_count = 0
    unsafe_count = 0
    checked_nodes = 0

    for point in safe_order_points:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not math.isfinite(float(point[0]))
            or not math.isfinite(float(point[1]))
        ):
            unsafe_count += 1
            continue
        if not _latlng_within_bounds(point, bounds):
            outside_count += 1
        node = _latlng_to_node(cache, point)
        if node is None:
            continue
        checked_nodes += 1
        if not _node_clear_near(cache, node, normal_altitude, radius_cells=8):
            unsafe_count += 1

    if outside_count:
        raise ValueError(f"safeOrderPoints outside bounds: {outside_count}/{len(safe_order_points)}")
    if unsafe_count > max(1, len(safe_order_points) // 5):
        raise ValueError(f"too many unsafe safeOrderPoints: {unsafe_count}/{len(safe_order_points)}")
    if checked_nodes == 0:
        print("[WARN] safeOrderPoints node-clear check skipped because pyproj is unavailable")
    elif unsafe_count:
        print(f"[WARN] safeOrderPoints near-clear warnings: {unsafe_count}/{len(safe_order_points)}")
    else:
        print(f"[PASS] safeOrderPoints clear-near check: {checked_nodes}/{len(safe_order_points)}")


def validate(map_id):
    cache_dir = find_cache_dir(map_id)
    if not cache_exists(map_id):
        print(f"[WARN] cache missing: {cache_dir}")
        return 1

    metadata_path = cache_dir / "metadata.json"
    npz_path = cache_dir / "grid_cache.npz"
    if metadata_path.exists():
        print("[PASS] metadata found")
    if npz_path.exists():
        print("[PASS] grid cache found")

    cache = load_map_cache(map_id)
    metadata = cache.metadata
    rows = int(metadata["rows"])
    cols = int(metadata["cols"])
    resolution = float(metadata["resolution"])
    if rows <= 0 or cols <= 0 or resolution <= 0:
        raise ValueError("rows/cols/resolution must be positive")
    _validate_bounds(metadata.get("bounds"))
    if not _node_in_bounds(metadata.get("startNode"), rows, cols):
        raise ValueError("startNode outside cache bounds")
    if not _node_in_bounds(metadata.get("goalNode"), rows, cols):
        raise ValueError("goalNode outside cache bounds")
    for node in metadata.get("chargingStationNodes", []):
        if not _node_in_bounds(node, rows, cols):
            raise ValueError(f"charging station outside cache bounds: {node}")
    _validate_safe_order_points(cache)

    print("[PASS] cache arrays valid")
    print(f"[PASS] metadata rows={rows} cols={cols} resolution={resolution:g}")
    print(f"[PASS] {map_id} cache valid")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Validate static map cache package.")
    parser.add_argument("--map-id", default="hanoi_my_dinh_me_tri_large")
    args = parser.parse_args()
    try:
        return validate(args.map_id)
    except Exception as exc:
        print(f"[FAIL] {args.map_id} cache invalid: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
