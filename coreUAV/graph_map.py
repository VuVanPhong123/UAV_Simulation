import numpy as np
import heapq
from typing import List, Tuple, Dict, Optional

class WaypointGraph:
    def __init__(self, config):
        self.grid_size = config['map']['grid_size']
        self.spacing = config['map']['node_spacing']
        self.nodes = {}
        self.edges = {}
        self._build_grid()
        self.no_fly_zones = config['map'].get('no_fly_zones', [])
        self.charging_stations = [tuple(c) for c in config['map']['charging_stations']]
        self.start = tuple(config['map']['start'])
        self.goal = tuple(config['map']['goal'])
        
    def _build_grid(self):
        for i in range(self.grid_size):
            for j in range(self.grid_size):
                x = j * self.spacing
                y = i * self.spacing
                self.nodes[(i,j)] = (x, y)
                self.edges[(i,j)] = []
        for i in range(self.grid_size):
            for j in range(self.grid_size):
                if i > 0:
                    self.edges[(i,j)].append((i-1,j))
                if i < self.grid_size-1:
                    self.edges[(i,j)].append((i+1,j))
                if j > 0:
                    self.edges[(i,j)].append((i,j-1))
                if j < self.grid_size-1:
                    self.edges[(i,j)].append((i,j+1))
    
    def is_in_no_fly_zone(self, node):
        i,j = node
        x,y = self.nodes[node]
        for zone in self.no_fly_zones:
            ci, cj = zone['center']
            cx, cy = self.nodes[(ci,cj)]
            radius_m = zone['radius'] * self.spacing
            if np.hypot(x-cx, y-cy) < radius_m:
                return True
        return False
    
    def heuristic(self, a, b):
        x1,y1 = self.nodes[a]
        x2,y2 = self.nodes[b]
        return np.hypot(x1-x2, y1-y2)
    
    def a_star(self, start, goal, dynamic_weights=None):
        if dynamic_weights is None:
            dynamic_weights = {}
        frontier = []
        heapq.heappush(frontier, (0, start))
        came_from = {start: None}
        cost_so_far = {start: 0}
        
        while frontier:
            _, current = heapq.heappop(frontier)
            if current == goal:
                break
            for nxt in self.edges[current]:
                if self.is_in_no_fly_zone(nxt):
                    continue
                edge = (current, nxt)
                base_cost = np.hypot(
                    self.nodes[current][0]-self.nodes[nxt][0],
                    self.nodes[current][1]-self.nodes[nxt][1]
                )
                weight = dynamic_weights.get(edge, 1.0)
                new_cost = cost_so_far[current] + base_cost * weight
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
        if len(path) > 0 and path[0] == start:
            return path
        return []