import numpy as np
import heapq
import geopandas as gpd
from pyproj import Transformer
from shapely.geometry import Point

class WaypointGraph:
    def __init__(self, config):
        self.config = config
        self.resolution = 10.0
        
        print("Đang nạp dữ liệu tòa nhà 2.5D...")
        self.buildings = gpd.read_file('hanoi_buildings.geojson')
        
        self.buildings = self.buildings.to_crs(epsg=32648) 
        self.crs_utm = self.buildings.crs
        self.transformer = Transformer.from_crs("epsg:4326", self.crs_utm, always_xy=True)
        
        print("Đang giăng lưới Không gian bay...")
        self._build_2_5d_grid(config)
        
        print(f"-> Môi trường 2.5D hoàn tất với {self.cols}x{self.rows} mắt lưới!")

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
        
        sindex = self.buildings.sindex
        self.nodes = {}
        self.heights = {}
        
        for i in range(self.cols):
            for j in range(self.rows):
                x = self.min_x + i * self.resolution
                y = self.min_y + j * self.resolution
                self.nodes[(i, j)] = (x, y)
                
                point = Point(x, y)
                possible_matches_index = list(sindex.intersection(point.bounds))
                possible_matches = self.buildings.iloc[possible_matches_index]
                precise_matches = possible_matches[possible_matches.intersects(point)]
                
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

    def a_star(self, start, goal, current_altitude=20.0):
        print(f"   [A*] Bắt đầu quét từ node {start} đến {goal}...")
        frontier = []
        heapq.heappush(frontier, (0, start))
        came_from = {start: None}
        cost_so_far = {start: 0}
        
        directions = [(0,1), (1,0), (0,-1), (-1,0), (1,1), (-1,1), (1,-1), (-1,-1)]
        
        while frontier:
            _, current = heapq.heappop(frontier)
            if current == goal: break
                
            for dx, dy in directions:
                nxt = (current[0] + dx, current[1] + dy)
                if not (0 <= nxt[0] < self.cols and 0 <= nxt[1] < self.rows): continue
                    
                if self.heights[nxt] >= current_altitude and nxt != goal and nxt not in self.charging_stations: 
                    continue 
                    
                base_cost = np.hypot(dx, dy) * self.resolution
                new_cost = cost_so_far[current] + base_cost
                
                if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                    cost_so_far[nxt] = new_cost
                    priority = new_cost + self.heuristic(nxt, goal)
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