import numpy as np
from pyproj import Transformer

from maps.cache import load_map_cache
from pathfinding.astar import (
    a_star as _a_star,
    a_star_2_5d as _a_star_2_5d,
    estimate_path_cost as _estimate_path_cost,
    is_line_of_sight as _is_line_of_sight,
    smooth_path as _smooth_path,
)
from pathfinding.wind import (
    check_wind_shadow as _check_wind_shadow,
    get_energy_multiplier as _get_energy_multiplier,
    get_wind_shadow_nodes as _get_wind_shadow_nodes,
)

ALTITUDE_LEVELS = [20.0, 35.0, 50.0, 70.0, 90.0, 120.0]


class WaypointGraph:
    def __init__(self, config):
        self.config = config
        self.performance_config = config.get("performance", {})
        self.resolution = float(self.performance_config.get("grid_resolution", 10.0))
        self.safety_margin = config.get("obstacle_avoidance", {}).get("safety_margin", 5.0)
        self.altitude_levels = self._build_altitude_levels(config)
        self.loaded_from_cache = False
        self.height_grid = None
        self.static_nfz_mask = None
        self.valid_masks = None
        self.buildings = None
        self.dynamic_obstacles = []
        self.dynamic_no_fly_zones = []

        if self.performance_config.get("use_map_cache", True):
            map_id = config.get("map", {}).get("map_id", "hanoi_my_dinh_me_tri_large")
            try:
                self._load_cached_grid(map_id)
                print(f"[Graph] Loaded map cache '{map_id}' ({self.cols}x{self.rows}, {len(self.altitude_levels)} altitude levels).")
                print(f"-> 2.5D environment ready with {self.cols}x{self.rows} grid.")
                return
            except Exception as exc:
                if self.performance_config.get("require_map_cache", False):
                    raise
                print(f"[Graph] Cache unavailable, falling back to legacy build: {exc}")

        import geopandas as gpd
        print("[Graph] Loading building data for legacy 2.5D grid...")
        map_id = config.get("map", {}).get("map_id", "hanoi_my_dinh_me_tri_large")
        self.buildings = gpd.read_file(f"maps/{map_id}/buildings.geojson")
        self.buildings = self.buildings.to_crs(epsg=32648)
        self.crs_utm = self.buildings.crs
        self.transformer = Transformer.from_crs("epsg:4326", self.crs_utm, always_xy=True)
        print("[Graph] Building legacy flight grid...")
        self._build_2_5d_grid(config)
        print(f"-> 2.5D environment ready with {self.cols}x{self.rows} grid.")

    # ------------------------------------------------------------------
    # Cache loading
    # ------------------------------------------------------------------

    def _load_cached_grid(self, map_id):
        cache = load_map_cache(map_id)
        metadata = cache.metadata
        self.loaded_from_cache = True
        self.resolution = float(metadata["resolution"])
        self.min_x = float(metadata["minX"])
        self.min_y = float(metadata["minY"])
        self.rows = int(metadata["rows"])
        self.cols = int(metadata["cols"])
        self.crs_utm = metadata["crs"]
        self.transformer = Transformer.from_crs("epsg:4326", self.crs_utm, always_xy=True)
        self.altitude_levels = [float(level) for level in metadata["altitudeLevels"]]
        self.height_grid = cache.height_grid
        self.static_nfz_mask = cache.static_nfz_mask
        self.valid_masks = cache.valid_masks
        self.nodes = {
            (i, j): (self.min_x + i * self.resolution, self.min_y + j * self.resolution)
            for j in range(self.rows)
            for i in range(self.cols)
        }
        self.heights = {}
        self.start = tuple(metadata["startNode"])
        self.goal = tuple(metadata["goalNode"])
        self.charging_stations = [tuple(node) for node in metadata.get("chargingStationNodes", [])]
        self._configure_static_nfz_from_config()

    def _configure_static_nfz_from_config(self):
        self.nfz_utm = []
        if "no_fly_zones" in self.config.get("map", {}):
            for nfz in self.config["map"]["no_fly_zones"]:
                lat, lon = nfz["center"]
                r = nfz["radius"]
                x, y = self.transformer.transform(lon, lat)
                self.nfz_utm.append((x, y, r))

    # ------------------------------------------------------------------
    # Legacy grid build (fallback when no cache)
    # ------------------------------------------------------------------

    def _build_2_5d_grid(self, config):
        from shapely.geometry import Point

        pts_gps = [config["map"]["start_latlng"], config["map"]["goal_latlng"]]
        if "charging_stations_latlng" in config["map"]:
            pts_gps.extend(config["map"]["charging_stations_latlng"])

        pts_utm = [self.transformer.transform(lon, lat) for lat, lon in pts_gps]
        xs = [p[0] for p in pts_utm]
        ys = [p[1] for p in pts_utm]
        pad = 200
        self.min_x, max_x = min(xs) - pad, max(xs) + pad
        self.min_y, max_y = min(ys) - pad, max(ys) + pad

        self.cols = int(np.ceil((max_x - self.min_x) / self.resolution))
        self.rows = int(np.ceil((max_y - self.min_y) / self.resolution))

        self.nfz_utm = []
        if "no_fly_zones" in config.get("map", {}):
            for nfz in config["map"]["no_fly_zones"]:
                lat, lon = nfz["center"]
                r = nfz["radius"]
                x, y = self.transformer.transform(lon, lat)
                self.nfz_utm.append((x, y, r))

        sindex = self.buildings.sindex
        self.nodes = {}
        self.heights = {}
        self.height_grid = np.zeros((self.rows, self.cols), dtype=np.float32)
        static_nfz_mask = np.zeros((self.rows, self.cols), dtype=bool)

        for i in range(self.cols):
            for j in range(self.rows):
                x = self.min_x + i * self.resolution
                y = self.min_y + j * self.resolution
                self.nodes[(i, j)] = (x, y)
                search_area = Point(x, y).buffer(self.safety_margin)

                possible_matches_index = list(sindex.intersection(search_area.bounds))
                possible_matches = self.buildings.iloc[possible_matches_index]
                precise_matches = possible_matches[possible_matches.intersects(search_area)]

                if not precise_matches.empty:
                    height = float(precise_matches["estimated_height"].max())
                else:
                    height = 0.0
                self.heights[(i, j)] = height
                self.height_grid[j, i] = height

                for nx, ny, r in self.nfz_utm:
                    if np.hypot(x - nx, y - ny) <= (r + self.safety_margin):
                        static_nfz_mask[j, i] = True
                        break

        self.start = self._get_nearest_node(config["map"]["start_latlng"])
        self.goal = self._get_nearest_node(config["map"]["goal_latlng"])
        self.charging_stations = [
            self._get_nearest_node(ll)
            for ll in config["map"].get("charging_stations_latlng", [])
        ]
        self.static_nfz_mask = static_nfz_mask
        self.valid_masks = np.zeros((len(self.altitude_levels), self.rows, self.cols), dtype=bool)
        for idx, altitude in enumerate(self.altitude_levels):
            self.valid_masks[idx] = (self.height_grid + self.safety_margin < altitude) & (~self.static_nfz_mask)

    # ------------------------------------------------------------------
    # Altitude helpers
    # ------------------------------------------------------------------

    def _build_altitude_levels(self, config):
        drone_config = config.get("drone", {})
        min_altitude = float(drone_config.get("min_altitude", min(ALTITUDE_LEVELS)))
        normal_altitude = float(drone_config.get("normal_altitude", 20.0))
        max_altitude = float(drone_config.get("max_altitude", max(ALTITUDE_LEVELS)))

        if max_altitude < min_altitude:
            min_altitude, max_altitude = max_altitude, min_altitude

        configured_levels = self.performance_config.get("altitude_levels") if hasattr(self, "performance_config") else None
        base_levels = configured_levels or ALTITUDE_LEVELS
        candidates = [
            float(level) for level in base_levels
            if min_altitude <= float(level) <= max_altitude
        ]
        candidates.extend([min_altitude, normal_altitude, max_altitude])
        clamped = [max(min_altitude, min(max_altitude, float(level))) for level in candidates]
        return sorted(set(clamped))

    def get_nearest_altitude_level(self, altitude):
        if not self.altitude_levels:
            return float(altitude)
        return min(self.altitude_levels, key=lambda level: abs(level - float(altitude)))

    def get_altitude_index(self, altitude):
        nearest = self.get_nearest_altitude_level(altitude)
        return self.altitude_levels.index(nearest)

    # ------------------------------------------------------------------
    # Node queries
    # ------------------------------------------------------------------

    def get_height(self, node):
        if self.height_grid is not None:
            i, j = node
            if 0 <= i < self.cols and 0 <= j < self.rows:
                return float(self.height_grid[j, i])
            return 0.0
        return float(self.heights.get(node, 0.0))

    def is_in_nfz(self, node):
        if self.static_nfz_mask is not None:
            i, j = node
            if 0 <= i < self.cols and 0 <= j < self.rows:
                return bool(self.static_nfz_mask[j, i])
            return True
        x, y = self.nodes.get(node, (0, 0))
        for nx, ny, r in self.nfz_utm:
            if np.hypot(x - nx, y - ny) <= (r + self.safety_margin):
                return True
        return False

    def is_in_dynamic_no_fly_zone(self, node, altitude=None):
        x, y = self.nodes.get(node, (0, 0))
        for zone in self.dynamic_no_fly_zones:
            zx, zy = zone["pos"]
            radius = float(zone.get("radius", 0.0))
            height = float(zone.get("height", float("inf")))
            if np.hypot(x - zx, y - zy) <= (radius + self.safety_margin):
                if altitude is None:
                    return True
                if np.isinf(height) or altitude <= height + self.safety_margin:
                    return True
        return False

    def is_in_dynamic_obs(self, node, altitude=None):
        x, y = self.nodes.get(node, (0, 0))
        for obs in self.dynamic_obstacles:
            if isinstance(obs, dict):
                ox, oy = obs["pos"]
                radius = float(obs.get("radius", 8.0))
                height = float(obs.get("height", 25.0))
            else:
                ox, oy = obs
                radius = 3.0
                height = float("inf")
            if np.hypot(x - ox, y - oy) <= (radius + self.safety_margin):
                if altitude is not None and altitude > height + self.safety_margin:
                    continue
                return True
        return False

    def is_node_clear_at_altitude(self, node, altitude):
        if node not in self.nodes:
            return False
        if self.valid_masks is not None:
            altitude_idx = self.get_altitude_index(altitude)
            i, j = node
            if not bool(self.valid_masks[altitude_idx, j, i]):
                return False
        elif self.is_in_nfz(node):
            return False
        elif self.get_height(node) + self.safety_margin >= altitude:
            return False
        if self.is_in_dynamic_no_fly_zone(node, altitude):
            return False
        if self.is_in_dynamic_obs(node, altitude):
            return False
        return True

    # ------------------------------------------------------------------
    # Coordinate conversion
    # ------------------------------------------------------------------

    def _get_nearest_node(self, latlng):
        x, y = self.transformer.transform(latlng[1], latlng[0])
        i = int(round((x - self.min_x) / self.resolution))
        j = int(round((y - self.min_y) / self.resolution))
        i = max(0, min(self.cols - 1, i))
        j = max(0, min(self.rows - 1, j))
        return (i, j)

    def latlng_to_node(self, latlng):
        if not isinstance(latlng, (list, tuple)) or len(latlng) != 2:
            raise ValueError("latlng must be a [lat, lon] pair")
        lat, lon = float(latlng[0]), float(latlng[1])
        if not np.isfinite(lat) or not np.isfinite(lon):
            raise ValueError("latlng values must be finite numbers")
        return self._get_nearest_node([lat, lon])

    def latlng_to_utm(self, latlng):
        if not isinstance(latlng, (list, tuple)) or len(latlng) != 2:
            raise ValueError("latlng must be a [lat, lon] pair")
        lat, lon = float(latlng[0]), float(latlng[1])
        if not np.isfinite(lat) or not np.isfinite(lon):
            raise ValueError("latlng values must be finite numbers")
        return self.transformer.transform(lon, lat)

    def is_latlng_within_bounds(self, latlng, margin_cells=0):
        x, y = self.latlng_to_utm(latlng)
        margin = max(0.0, float(margin_cells)) * self.resolution
        max_x = self.min_x + (self.cols - 1) * self.resolution
        max_y = self.min_y + (self.rows - 1) * self.resolution
        return (
            self.min_x - margin <= x <= max_x + margin
            and self.min_y - margin <= y <= max_y + margin
        )

    def find_nearest_clear_node(self, latlng, altitude, max_radius_cells=8):
        base = self.latlng_to_node(latlng)
        if self.is_node_clear_at_altitude(base, altitude):
            return base
        max_radius_cells = max(0, int(max_radius_cells))
        for radius in range(1, max_radius_cells + 1):
            best = None
            best_dist = float("inf")
            for dx in range(-radius, radius + 1):
                for dy in range(-radius, radius + 1):
                    if abs(dx) != radius and abs(dy) != radius:
                        continue
                    node = (base[0] + dx, base[1] + dy)
                    if node not in self.nodes:
                        continue
                    if not self.is_node_clear_at_altitude(node, altitude):
                        continue
                    dist = dx * dx + dy * dy
                    if dist < best_dist:
                        best = node
                        best_dist = dist
            if best is not None:
                return best
        return base

    # ------------------------------------------------------------------
    # Dynamic obstacles
    # ------------------------------------------------------------------

    def add_dynamic_obstacle(self, pos_utm, radius=8.0, height=25.0):
        self.dynamic_obstacles.append({
            "pos": pos_utm,
            "radius": float(radius),
            "height": float(height),
        })

    def add_dynamic_no_fly_zone(self, pos_utm, radius, height=float("inf")):
        self.dynamic_no_fly_zones.append({
            "pos": pos_utm,
            "radius": float(radius),
            "height": float(height),
        })

    def clear_dynamic_obstacles(self):
        self.dynamic_obstacles = []
        self.dynamic_no_fly_zones = []
        if self.performance_config.get("verbose_planner_logs", False):
            print("   [Graph] Cleared dynamic obstacles.")

    # ------------------------------------------------------------------
    # Pathfinding — delegate to pathfinding.astar
    # ------------------------------------------------------------------

    def heuristic(self, a, b):
        return np.hypot(a[0] - b[0], a[1] - b[1]) * self.resolution

    def a_star(self, start, goal, current_altitude=20.0, wind_dir=0.0, wind_speed=0.0, ambient_temp=25.0, is_raining=False):
        return _a_star(self, start, goal, current_altitude, wind_dir, wind_speed, ambient_temp, is_raining)

    def a_star_2_5d(self, start, goal, current_altitude=20.0, wind_dir=0.0, wind_speed=0.0, ambient_temp=25.0, is_raining=False):
        return _a_star_2_5d(self, start, goal, current_altitude, wind_dir, wind_speed, ambient_temp, is_raining)

    def smooth_path(self, raw_path, altitude):
        return _smooth_path(self, raw_path, altitude)

    def estimate_path_cost(self, path, altitude, wind_dir=0.0, wind_speed=0.0, ambient_temp=25.0, is_raining=False):
        return _estimate_path_cost(self, path, altitude, wind_dir, wind_speed, ambient_temp, is_raining)

    def is_line_of_sight(self, node_a, node_b, altitude):
        return _is_line_of_sight(self, node_a, node_b, altitude)

    # ------------------------------------------------------------------
    # Wind — delegate to pathfinding.wind
    # ------------------------------------------------------------------

    def check_wind_shadow(self, node, wind_dir_deg, altitude, shadow_length=5):
        return _check_wind_shadow(self, node, wind_dir_deg, altitude, shadow_length)

    def get_energy_multiplier(self, current, nxt, wind_dir_deg, wind_speed, altitude, ambient_temp=25.0, is_raining=False):
        return _get_energy_multiplier(self, current, nxt, wind_dir_deg, wind_speed, altitude, ambient_temp, is_raining)

    def get_wind_shadow_nodes(self, wind_dir_deg, altitude, shadow_length=5):
        return _get_wind_shadow_nodes(self, wind_dir_deg, altitude, shadow_length)
