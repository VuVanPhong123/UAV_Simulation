import numpy as np
import heapq
import networkx as nx
import geopandas as gpd

class WaypointGraph:
    def __init__(self, config):
        self.config = config
        
        print("Đang nạp bản đồ OSM...")
        self.G = nx.read_graphml('hanoi_uav_network.graphml')
        
        self.nodes = {}
        self.edges = {}
        for node, data in self.G.nodes(data=True):
            self.nodes[node] = (float(data['x']), float(data['y']))
            self.edges[node] = []
            
        for u, v in self.G.edges():
            self.edges[u].append(v)
            self.edges[v].append(u) 

        # Đọc dữ liệu tòa nhà
        self.buildings = gpd.read_file('hanoi_buildings.geojson')
        
        self.start = self._get_nearest_node(config['map']['start_latlng'])
        self.goal = self._get_nearest_node(config['map']['goal_latlng'])
        
    def _get_nearest_node(self, latlng):
        import osmnx as ox
        return ox.distance.nearest_nodes(self.G, latlng[1], latlng[0])

    def heuristic(self, a, b):
        x1, y1 = self.nodes[a]
        x2, y2 = self.nodes[b]
        return np.hypot(x1-x2, y1-y2)

    def a_star(self, start, goal, current_altitude=20.0):
        frontier = []
        heapq.heappush(frontier, (0, start))
        came_from = {start: None}
        cost_so_far = {start: 0}
        
        while frontier:
            _, current = heapq.heappop(frontier)
            if current == goal:
                break
                
            for nxt in self.edges[current]:
                base_cost = np.hypot(
                    self.nodes[current][0] - self.nodes[nxt][0],
                    self.nodes[current][1] - self.nodes[nxt][1]
                )

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
        path.reverse()
        return path if path[0] == start else []