import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


class MapCacheError(RuntimeError):
    pass


@dataclass
class MapCache:
    map_id: str
    cache_dir: Path
    metadata: dict
    height_grid: np.ndarray
    static_nfz_mask: np.ndarray
    valid_masks: np.ndarray


def default_maps_dir():
    return Path(__file__).resolve().parent / "maps"


def find_cache_dir(map_id="hanoi_my_dinh_me_tri_large", base_dir=None):
    maps_dir = Path(base_dir) if base_dir is not None else default_maps_dir()
    return maps_dir / map_id


def cache_exists(map_id="hanoi_my_dinh_me_tri_large", base_dir=None):
    cache_dir = find_cache_dir(map_id, base_dir)
    return (cache_dir / "metadata.json").exists() and (cache_dir / "grid_cache.npz").exists()


def _load_metadata(path):
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        raise MapCacheError(f"metadata load failed: {path}: {exc}") from exc


def _load_npz(path):
    try:
        data = np.load(path, allow_pickle=False)
        return {
            "height_grid": data["height_grid"],
            "static_nfz_mask": data["static_nfz_mask"],
            "valid_masks": data["valid_masks"],
        }
    except Exception as exc:
        raise MapCacheError(f"grid cache load failed: {path}: {exc}") from exc


def validate_cache_shapes(metadata, height_grid, static_nfz_mask, valid_masks):
    try:
        rows = int(metadata["rows"])
        cols = int(metadata["cols"])
        altitude_levels = metadata["altitudeLevels"]
    except KeyError as exc:
        raise MapCacheError(f"metadata missing required key: {exc}") from exc

    if height_grid.shape != (rows, cols):
        raise MapCacheError(f"height_grid shape {height_grid.shape} does not match rows/cols {(rows, cols)}")
    if static_nfz_mask.shape != (rows, cols):
        raise MapCacheError(f"static_nfz_mask shape {static_nfz_mask.shape} does not match rows/cols {(rows, cols)}")
    if valid_masks.shape != (len(altitude_levels), rows, cols):
        raise MapCacheError(
            f"valid_masks shape {valid_masks.shape} does not match altitude/rows/cols "
            f"{(len(altitude_levels), rows, cols)}"
        )


def load_map_cache(map_id="hanoi_my_dinh_me_tri_large", base_dir=None):
    cache_dir = find_cache_dir(map_id, base_dir)
    metadata_path = cache_dir / "metadata.json"
    npz_path = cache_dir / "grid_cache.npz"

    if not metadata_path.exists() or not npz_path.exists():
        raise MapCacheError(f"cache package missing for map_id={map_id} at {cache_dir}")

    metadata = _load_metadata(metadata_path)
    arrays = _load_npz(npz_path)
    height_grid = arrays["height_grid"].astype(np.float32, copy=False)
    static_nfz_mask = arrays["static_nfz_mask"].astype(bool, copy=False)
    valid_masks = arrays["valid_masks"].astype(bool, copy=False)

    validate_cache_shapes(metadata, height_grid, static_nfz_mask, valid_masks)

    return MapCache(
        map_id=map_id,
        cache_dir=cache_dir,
        metadata=metadata,
        height_grid=height_grid,
        static_nfz_mask=static_nfz_mask,
        valid_masks=valid_masks,
    )


def save_map_cache(
    map_id,
    metadata,
    height_grid,
    static_nfz_mask,
    valid_masks,
    base_dir=None,
):
    cache_dir = find_cache_dir(map_id, base_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    height_grid = np.asarray(height_grid, dtype=np.float32)
    static_nfz_mask = np.asarray(static_nfz_mask, dtype=bool)
    valid_masks = np.asarray(valid_masks, dtype=bool)
    validate_cache_shapes(metadata, height_grid, static_nfz_mask, valid_masks)

    metadata_path = cache_dir / "metadata.json"
    npz_path = cache_dir / "grid_cache.npz"
    with metadata_path.open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        f.write("\n")
    np.savez_compressed(
        npz_path,
        height_grid=height_grid,
        static_nfz_mask=static_nfz_mask,
        valid_masks=valid_masks,
    )
    return MapCache(map_id, cache_dir, metadata, height_grid, static_nfz_mask, valid_masks)
