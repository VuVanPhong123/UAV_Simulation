import numpy as np
import heapq
import geopandas as gpd
from pyproj import Transformer
from shapely.geometry import Point
from energy_model import rain_factor, temperature_factor, wind_factor


ALTITUDE_LEVELS = [20.0, 35.0, 50.0, 70.0, 90.0, 120.0]


def path_point_node(point):
    if isinstance(point, dict):
        return point["node"]
    return point


def path_point_altitude(point, default_altitude):
    if isinstance(point, dict):
        return float(point.get("altitude", default_altitude))
    return float(default_altitude)


class WaypointGraph:
    def __init__(self, config):
        self.config = config
        self.resolution = 5.0
        self.safety_margin = config.get('obstacle_avoidance', {}).get('safety_margin', 5.0)
        self.altitude_levels = self._build_altitude_levels(config)
        print("Đang nạp dữ liệu tòa nhà 2.5D...")
        self.buildings = gpd.read_file('hanoi_buildings.geojson')
        
        self.buildings = self.buildings.to_crs(epsg=32648) 
        self.crs_utm = self.buildings.crs
        self.transformer = Transformer.from_crs("epsg:4326", self.crs_utm, always_xy=True)
        
        print("Đang giăng lưới Không gian bay...")
        self._build_2_5d_grid(config)
        self.dynamic_obstacles = []
        
        print(f"-> Môi trường 2.5D hoàn tất với {self.cols}x{self.rows} mắt lưới!")

    def _build_altitude_levels(self, config):
        drone_config = config.get("drone", {})
        min_altitude = float(drone_config.get("min_altitude", min(ALTITUDE_LEVELS)))
        normal_altitude = float(drone_config.get("normal_altitude", 20.0))
        max_altitude = float(drone_config.get("max_altitude", max(ALTITUDE_LEVELS)))

        if max_altitude < min_altitude:
            min_altitude, max_altitude = max_altitude, min_altitude

        candidates = [
            float(level) for level in ALTITUDE_LEVELS
            if min_altitude <= float(level) <= max_altitude
        ]
        candidates.extend([min_altitude, normal_altitude, max_altitude])
        clamped = [
            max(min_altitude, min(max_altitude, float(level)))
            for level in candidates
        ]
        return sorted(set(clamped))

    def get_nearest_altitude_level(self, altitude):
        if not self.altitude_levels:
            return float(altitude)
        return min(self.altitude_levels, key=lambda level: abs(level - float(altitude)))

    def get_altitude_index(self, altitude):
        nearest = self.get_nearest_altitude_level(altitude)
        return self.altitude_levels.index(nearest)

    def is_in_nfz(self, node):
        x, y = self.nodes.get(node, (0, 0))
        for nx, ny, r in self.nfz_utm:
            if np.hypot(x - nx, y - ny) <= (r + self.safety_margin):
                return True
        return False
    
    def add_dynamic_obstacle(self, pos_utm, radius=8.0, height=25.0):
        self.dynamic_obstacles.append({
            'pos': pos_utm,
            'radius': float(radius),
            'height': float(height)
        })

    def is_in_dynamic_obs(self, node, altitude=None):
        x, y = self.nodes.get(node, (0, 0))
        for obs in self.dynamic_obstacles:
            if isinstance(obs, dict):
                ox, oy = obs['pos']
                radius = float(obs.get('radius', 8.0))
                height = float(obs.get('height', 25.0))
            else:
                ox, oy = obs
                radius = 3.0
                height = float('inf')

            if np.hypot(x - ox, y - oy) <= (radius + getattr(self, 'safety_margin', 5.0)):
                if altitude is not None and altitude > height + getattr(self, 'safety_margin', 5.0):
                    continue
                return True
        return False

    def is_node_clear_at_altitude(self, node, altitude):
        """
        Return True if node can be occupied at this altitude.
        """
        if node not in self.nodes:
            return False
        if self.is_in_nfz(node):
            return False
        if self.heights.get(node, 0.0) + self.safety_margin >= altitude:
            return False
        if self.is_in_dynamic_obs(node, altitude):
            return False
        return True
    
    def clear_dynamic_obstacles(self):
        self.dynamic_obstacles = []
        print("   [Graph] Da don dep toan bo vat can dong khoi ban do.")
    
    def _build_2_5d_grid(self, config):
        pts_gps = [config['map']['start_latlng'], config['map']['goal_latlng']]
        if 'charging_stations_latlng' in config['map']:
            pts_gps.extend(config['map']['charging_stations_latlng'])
            
        pts_utm = [self.transformer.transform(lon, lat) for lat, lon in pts_gps]
        
        xs = [p[0] for p in pts_utm]
        ys = [p[1] for p in pts_utm]
        pad = 200 
        self.min_x, max_x = min(xs) - pad, max(xs) + pad
        self.min_y, max_y = min(ys) - pad, max(ys) + pad
        
        self.cols = int(np.ceil((max_x - self.min_x) / self.resolution))
        self.rows = int(np.ceil((max_y - self.min_y) / self.resolution))
        
        self.nfz_utm = []
        if 'no_fly_zones' in config.get('map', {}):
            for nfz in config['map']['no_fly_zones']:
                lat, lon = nfz['center']
                r = nfz['radius']
                x, y = self.transformer.transform(lon, lat)
                self.nfz_utm.append((x, y, r))

        sindex = self.buildings.sindex
        self.nodes = {}
        self.heights = {}
        
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
                    self.heights[(i, j)] = float(precise_matches['estimated_height'].max())
                else:
                    self.heights[(i, j)] = 0.0

        self.start = self._get_nearest_node(config['map']['start_latlng'])
        self.goal = self._get_nearest_node(config['map']['goal_latlng'])
        self.charging_stations = [self._get_nearest_node(ll) for ll in config['map'].get('charging_stations_latlng', [])]

    def _get_nearest_node(self, latlng):
        x, y = self.transformer.transform(latlng[1], latlng[0])
        i = int(round((x - self.min_x) / self.resolution))
        j = int(round((y - self.min_y) / self.resolution))
        i = max(0, min(self.cols - 1, i))
        j = max(0, min(self.rows - 1, j))
        return (i, j)

    def heuristic(self, a, b):
        return np.hypot(a[0]-b[0], a[1]-b[1]) * self.resolution

    def check_wind_shadow(self, node, wind_dir_deg, altitude, shadow_length=5):
        reverse_wind_rad = np.radians((wind_dir_deg + 180) % 360)
        dx = np.cos(reverse_wind_rad)
        dy = np.sin(reverse_wind_rad)
        
        curr_x, curr_y = node
        
        for step in range(1, shadow_length + 1):
            check_x = int(curr_x + dx * step)
            check_y = int(curr_y + dy * step)
            
            if not (0 <= check_x < self.cols and 0 <= check_y < self.rows):
                break
            if self.heights.get((check_x, check_y), 0.0) >= altitude:
                return True
                
        return False

    def _legacy_energy_multiplier(self, current, nxt, wind_dir_deg, wind_speed, altitude):
        """
        Tính toán hệ số tiêu hao năng lượng dựa trên Tích vô hướng (Dot Product).
        """
        if wind_speed <= 0:
            return 1.0 # Không có gió
            
        move_x = nxt[0] - current[0]
        move_y = nxt[1] - current[1]
        dist = np.hypot(move_x, move_y)
        if dist == 0: return 1.0
        
        uv_x = move_x / dist
        uv_y = move_y / dist
        
        wind_rad = np.radians(wind_dir_deg)
        w_x = np.cos(wind_rad)
        w_y = np.sin(wind_rad)
        
        wind_impact = (uv_x * w_x) + (uv_y * w_y)
        
        is_shielded = self.check_wind_shadow(current, wind_dir_deg, altitude)
        
        effective_wind_speed = wind_speed * 0.2 if is_shielded else wind_speed
        
        penalty_coefficient = 0.05
        
        energy_multiplier = 1.0 - (wind_impact * effective_wind_speed * penalty_coefficient)
        
        return max(0.1, energy_multiplier)

    def get_energy_multiplier(
        self,
        current,
        nxt,
        wind_dir_deg,
        wind_speed,
        altitude,
        ambient_temp=25.0,
        is_raining=False
    ):
        move_x = nxt[0] - current[0]
        move_y = nxt[1] - current[1]
        if move_x == 0 and move_y == 0:
            return 1.0

        move_heading_deg = np.degrees(np.arctan2(move_y, move_x))
        is_shielded = self.check_wind_shadow(current, wind_dir_deg, altitude)
        wf = wind_factor(move_heading_deg, wind_dir_deg, wind_speed, is_shielded)
        tf = temperature_factor(ambient_temp)
        rf = rain_factor(is_raining)["energy_factor"]
        return wf * tf * rf

    def a_star(self, start, goal, current_altitude=20.0, wind_dir=0.0, wind_speed=0.0, ambient_temp=25.0, is_raining=False):
        print(f"   [A*] Tìm đường Energy-Aware từ {start} đến {goal} | Gió {wind_speed}m/s hướng {wind_dir}°")
        frontier = []
        heapq.heappush(frontier, (0, start))
        came_from = {start: None}
        cost_so_far = {start: 0}
        
        directions = [
            (0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0),
            (1, 1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (-1, -1, 1.4142)
        ]
        WEIGHT = 1.8 
        
        while frontier:
            _, current = heapq.heappop(frontier)
            if current == goal: break
                
            for dx, dy, step_dist in directions:
                nxt = (current[0] + dx, current[1] + dy)
                if not (0 <= nxt[0] < self.cols and 0 <= nxt[1] < self.rows): continue

                if getattr(self, 'is_in_dynamic_obs', lambda x, altitude=None: False)(nxt, current_altitude):
                    continue
                if self.is_in_nfz(nxt):
                    continue
                if self.heights[nxt] >= current_altitude and nxt != goal and nxt not in self.charging_stations: 
                    continue 
                    
                energy_multiplier = self.get_energy_multiplier(
                    current,
                    nxt,
                    wind_dir,
                    wind_speed,
                    current_altitude,
                    ambient_temp,
                    is_raining
                )
                
                step_energy_cost = (step_dist * self.resolution) * energy_multiplier
                new_cost = cost_so_far[current] + step_energy_cost
                
                if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                    cost_so_far[nxt] = new_cost
                    priority = new_cost + (WEIGHT * self.heuristic(nxt, goal))
                    heapq.heappush(frontier, (priority, nxt))
                    came_from[nxt] = current
                    
        path = []
        node = goal
        while node is not None:
            path.append(node)
            node = came_from.get(node)
            
        if path and path[-1] == start:
            path.reverse()
            print(f"   [A*] Tìm thấy đường đi! (Gồm {len(path)} node)")
            return path
        print(f"   [A*] THẤT BẠI: Bị kẹt, không thể tìm thấy đường đi!")
        return []

    def a_star_2_5d(
        self,
        start,
        goal,
        current_altitude=20.0,
        wind_dir=0.0,
        wind_speed=0.0,
        ambient_temp=25.0,
        is_raining=False
    ):
        print(f"   [A* 2.5D] Planning from {start} to {goal} | wind {wind_speed}m/s to {wind_dir} deg")

        if start not in self.nodes or goal not in self.nodes:
            print("   [A* 2.5D] Failed: start or goal is outside graph.")
            return []

        normal_altitude = float(self.config.get("drone", {}).get("normal_altitude", current_altitude))
        start_idx = self.get_altitude_index(current_altitude)

        if not self.is_node_clear_at_altitude(start, self.altitude_levels[start_idx]):
            clear_indices = [
                idx for idx, level in enumerate(self.altitude_levels)
                if self.is_node_clear_at_altitude(start, level)
            ]
            if not clear_indices:
                print("   [A* 2.5D] Failed: start node is blocked at all altitude levels.")
                return []
            start_idx = min(clear_indices, key=lambda idx: abs(self.altitude_levels[idx] - current_altitude))

        if not any(self.is_node_clear_at_altitude(goal, level) for level in self.altitude_levels):
            print("   [A* 2.5D] Failed: goal node is blocked at all altitude levels.")
            return []

        start_state = (start[0], start[1], start_idx)
        frontier = []
        heapq.heappush(frontier, (0.0, start_state))
        came_from = {start_state: None}
        cost_so_far = {start_state: 0.0}

        directions = [
            (0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0),
            (1, 1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (-1, -1, 1.4142)
        ]
        weight = 1.8
        goal_state = None

        while frontier:
            _, current_state = heapq.heappop(frontier)
            current_node = (current_state[0], current_state[1])
            altitude_idx = current_state[2]
            altitude = self.altitude_levels[altitude_idx]

            if current_node == goal:
                goal_state = current_state
                break

            for dx, dy, step_dist in directions:
                nxt = (current_node[0] + dx, current_node[1] + dy)
                if not (0 <= nxt[0] < self.cols and 0 <= nxt[1] < self.rows):
                    continue
                if not self.is_node_clear_at_altitude(nxt, altitude):
                    continue

                next_state = (nxt[0], nxt[1], altitude_idx)
                energy_multiplier = self.get_energy_multiplier(
                    current_node,
                    nxt,
                    wind_dir,
                    wind_speed,
                    altitude,
                    ambient_temp,
                    is_raining
                )
                movement_cost = (step_dist * self.resolution) * energy_multiplier
                altitude_penalty = 0.01 * max(0.0, altitude - normal_altitude)
                new_cost = cost_so_far[current_state] + movement_cost + altitude_penalty

                if next_state not in cost_so_far or new_cost < cost_so_far[next_state]:
                    cost_so_far[next_state] = new_cost
                    altitude_bias = abs(altitude - normal_altitude) * 0.1
                    priority = new_cost + (weight * self.heuristic(nxt, goal)) + altitude_bias
                    heapq.heappush(frontier, (priority, next_state))
                    came_from[next_state] = current_state

            for next_altitude_idx in (altitude_idx - 1, altitude_idx + 1):
                if not (0 <= next_altitude_idx < len(self.altitude_levels)):
                    continue
                next_altitude = self.altitude_levels[next_altitude_idx]
                if not self.is_node_clear_at_altitude(current_node, next_altitude):
                    continue

                next_state = (current_node[0], current_node[1], next_altitude_idx)
                climb_m = abs(next_altitude - altitude)
                transition_cost = climb_m * (2.0 if next_altitude > altitude else 0.5)
                new_cost = cost_so_far[current_state] + transition_cost

                if next_state not in cost_so_far or new_cost < cost_so_far[next_state]:
                    cost_so_far[next_state] = new_cost
                    altitude_bias = abs(next_altitude - normal_altitude) * 0.1
                    priority = new_cost + (weight * self.heuristic(current_node, goal)) + altitude_bias
                    heapq.heappush(frontier, (priority, next_state))
                    came_from[next_state] = current_state

        if goal_state is None:
            print("   [A* 2.5D] Failed: no safe path found.")
            return []

        states = []
        state = goal_state
        while state is not None:
            states.append(state)
            state = came_from.get(state)
        states.reverse()

        path = [
            {
                "node": (state[0], state[1]),
                "altitude": float(self.altitude_levels[state[2]])
            }
            for state in states
        ]
        print(f"   [A* 2.5D] Found path with {len(path)} points.")
        return path

    def clear_dynamic_obstacles(self):
        self.dynamic_obstacles = []
        print("   [Graph] Đã dọn dẹp toàn bộ vật cản động khỏi bản đồ.")

    def is_line_of_sight(self, node_a, node_b, altitude):
        x0, y0 = int(node_a[0]), int(node_a[1])
        x1, y1 = int(node_b[0]), int(node_b[1])
        
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        
        while True:
            if (x0, y0) != (int(node_a[0]), int(node_a[1])) and (x0, y0) != (int(node_b[0]), int(node_b[1])):
                if not self.is_node_clear_at_altitude((x0, y0), altitude):
                    return False
            if x0 == x1 and y0 == y1:
                break
                
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy
                
        return True

    def smooth_path(self, raw_path, altitude):
        if not raw_path:
            return []
        points = [
            {
                "node": path_point_node(point),
                "altitude": path_point_altitude(point, altitude)
            }
            for point in raw_path
        ]
        if len(points) <= 2:
            return points
        
        print(f"   [Làm mịn] Đang ép thẳng quỹ đạo bay...")
        smoothed = [points[0]]
        curr = 0
        while curr < len(points) - 1:
            next_node = len(points) - 1
            while next_node > curr + 1:
                segment_altitude = min(
                    path_point_altitude(points[curr], altitude),
                    path_point_altitude(points[next_node], altitude)
                )
                if self.is_line_of_sight(
                    path_point_node(points[curr]),
                    path_point_node(points[next_node]),
                    segment_altitude
                ):
                    break
                next_node -= 1
            smoothed.append(points[next_node])
            curr = next_node
            
        print(f"   [Làm mịn] Rút gọn từ {len(raw_path)} node xuống còn {len(smoothed)} node.")
        return smoothed

    def estimate_path_cost(self, path, altitude, wind_dir=0.0, wind_speed=0.0, ambient_temp=25.0, is_raining=False):
        if not path:
            return float('inf')
        if len(path) < 2:
            return 0.0

        total = 0.0
        for current_point, next_point in zip(path, path[1:]):
            current = path_point_node(current_point)
            nxt = path_point_node(next_point)
            current_altitude = path_point_altitude(current_point, altitude)
            next_altitude = path_point_altitude(next_point, altitude)
            segment_altitude = min(current_altitude, next_altitude)
            dx = nxt[0] - current[0]
            dy = nxt[1] - current[1]
            step_dist = np.hypot(dx, dy)
            energy_multiplier = self.get_energy_multiplier(
                current,
                nxt,
                wind_dir,
                wind_speed,
                segment_altitude,
                ambient_temp,
                is_raining
            )
            total += step_dist * self.resolution * energy_multiplier
            if next_altitude > current_altitude:
                total += (next_altitude - current_altitude) * 2.0
            elif next_altitude < current_altitude:
                total += (current_altitude - next_altitude) * 0.5
        return total

    def get_wind_shadow_nodes(self, wind_dir_deg, altitude, shadow_length=5):
        shadow_nodes = []
        for i in range(self.cols):
            for j in range(self.rows):
                node = (i, j)
                if self.check_wind_shadow(node, wind_dir_deg, altitude, shadow_length):
                    x, y = self.nodes[node]
                    shadow_nodes.append((x, y))
        return shadow_nodes
