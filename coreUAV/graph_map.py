import numpy as np
import heapq
import geopandas as gpd
from pyproj import Transformer
from shapely.geometry import Point

class WaypointGraph:
    def __init__(self, config):
        self.config = config
        self.resolution = 5.0
        self.safety_margin = config.get('obstacle_avoidance', {}).get('safety_margin', 5.0)
        print("Đang nạp dữ liệu tòa nhà 2.5D...")
        self.buildings = gpd.read_file('hanoi_buildings.geojson')
        
        self.buildings = self.buildings.to_crs(epsg=32648) 
        self.crs_utm = self.buildings.crs
        self.transformer = Transformer.from_crs("epsg:4326", self.crs_utm, always_xy=True)
        
        print("Đang giăng lưới Không gian bay...")
        self._build_2_5d_grid(config)
        self.dynamic_obstacles = []
        
        print(f"-> Môi trường 2.5D hoàn tất với {self.cols}x{self.rows} mắt lưới!")

    def is_in_nfz(self, node):
        x, y = self.nodes.get(node, (0, 0))
        for nx, ny, r in self.nfz_utm:
            if np.hypot(x - nx, y - ny) <= (r + self.safety_margin):
                return True
        return False
    
    def add_dynamic_obstacle(self, pos_utm):
        self.dynamic_obstacles.append(pos_utm)

    def is_in_dynamic_obs(self, node):
        x, y = self.nodes.get(node, (0, 0))
        for ox, oy in self.dynamic_obstacles:
            if np.hypot(x - ox, y - oy) <= (3.0 + getattr(self, 'safety_margin', 5.0)):
                return True
        return False
    
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

    def get_energy_multiplier(self, current, nxt, wind_dir_deg, wind_speed, altitude):
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

    def a_star(self, start, goal, current_altitude=20.0, wind_dir=0.0, wind_speed=0.0):
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

                if getattr(self, 'is_in_dynamic_obs', lambda x: False)(nxt):
                    continue
                if self.is_in_nfz(nxt):
                    continue
                if self.heights[nxt] >= current_altitude and nxt != goal and nxt not in self.charging_stations: 
                    continue 
                    
                energy_multiplier = self.get_energy_multiplier(current, nxt, wind_dir, wind_speed, current_altitude)
                
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
                if self.heights.get((x0, y0), 0.0) >= altitude:
                    return False
                if self.is_in_nfz((x0, y0)):
                    return False
                if self.is_in_dynamic_obs((x0, y0)):
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
        if not raw_path or len(raw_path) <= 2: 
            return raw_path
        
        print(f"   [Làm mịn] Đang ép thẳng quỹ đạo bay...")
        smoothed = [raw_path[0]]
        curr = 0
        while curr < len(raw_path) - 1:
            next_node = len(raw_path) - 1
            while next_node > curr + 1:
                if self.is_line_of_sight(raw_path[curr], raw_path[next_node], altitude):
                    break
                next_node -= 1
            smoothed.append(raw_path[next_node])
            curr = next_node
            
        print(f"   [Làm mịn] Rút gọn từ {len(raw_path)} node xuống còn {len(smoothed)} node.")
        return smoothed