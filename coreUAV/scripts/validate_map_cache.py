import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_cache import cache_exists, find_cache_dir, load_map_cache


def _node_in_bounds(node, rows, cols):
    return (
        isinstance(node, list)
        and len(node) == 2
        and 0 <= int(node[0]) < cols
        and 0 <= int(node[1]) < rows
    )


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
    if not _node_in_bounds(metadata.get("startNode"), rows, cols):
        raise ValueError("startNode outside cache bounds")
    if not _node_in_bounds(metadata.get("goalNode"), rows, cols):
        raise ValueError("goalNode outside cache bounds")
    for node in metadata.get("chargingStationNodes", []):
        if not _node_in_bounds(node, rows, cols):
            raise ValueError(f"charging station outside cache bounds: {node}")

    print("[PASS] cache arrays valid")
    print(f"[PASS] {map_id} cache valid")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Validate static map cache package.")
    parser.add_argument("--map-id", default="hanoi_my_dinh_me_tri")
    args = parser.parse_args()
    try:
        return validate(args.map_id)
    except Exception as exc:
        print(f"[FAIL] {args.map_id} cache invalid: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
