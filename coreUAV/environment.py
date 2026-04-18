import gymnasium as gym
from gymnasium import spaces
import numpy as np
from graph_map import WaypointGraph
from drone import Drone

class DeliveryEnv(gym.Env):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.graph = WaypointGraph(config)
        self.drone = Drone(config)
        self.time_step = config['simulation']['time_step']
        self.max_steps = config['simulation']['max_steps']
        self.step_count = 0
        self.path = []
        self.path_index = 0
        self.charging_mode = False
        self.avoiding = False
        self.avoid_timer = 0.0
        self.avoid_direction = 0
        self.reset()
    
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.drone.battery = self.drone.max_battery
        self.drone.status = "flying"
        self.drone.pos = self.graph.nodes[self.graph.start]
        self.drone.node = self.graph.start
        self.path = self.graph.a_star(self.graph.start, self.graph.goal)
        self.path_index = 0
        self.charging_mode = False
        self.step_count = 0
        self.avoiding = False
        self.avoid_timer = 0.0
        return self._get_obs(), {}
    
    def _get_obs(self):
        return {
            "pos": self.drone.pos,
            "battery": self.drone.battery,
            "altitude": self.drone.altitude,
            "temperature": self.drone.temperature,
            "status": self.drone.status,
            "node": self.drone.node,
            "step": self.step_count
        }
    
    def _detect_obstacle(self):
        if np.random.rand() < 0.005:
            return True
        return False
    
    def _handle_avoidance(self, dt):
        if not self.avoiding:
            if self._detect_obstacle():
                self.avoiding = True
                self.avoid_timer = self.config['obstacle_avoidance']['avoidance_duration']
                if self.drone.altitude < self.drone.max_altitude - 5:
                    self.drone.altitude = min(self.drone.max_altitude, self.drone.altitude + 10)
                else:
                    self.avoid_direction = 1 if np.random.rand() > 0.5 else -1
        else:
            self.avoid_timer -= dt
            if self.avoid_timer <= 0:
                self.avoiding = False
                self.drone.altitude = self.drone.normal_altitude
                self.avoid_direction = 0
        return self.avoiding
    
    def step(self, action=None):
        dt = self.time_step
        self.step_count += 1
        terminated = False
        truncated = False
        
        avoiding = self._handle_avoidance(dt)
        
        if self.drone.status == "charging":
            self.drone.recharge(dt)
            self.drone.update_temperature(dt)
            if self.drone.status == "flying":
                self.path = self.graph.a_star(self.drone.node, self.graph.goal)
                self.path_index = 0
                self.charging_mode = False
            return self._get_obs(), 0, terminated, truncated, {}
        
        if self.drone.battery < self.drone.low_threshold and not self.charging_mode:
            nearest = None
            best_dist = float('inf')
            for station in self.graph.charging_stations:
                dist = self.graph.heuristic(self.drone.node, station)
                if dist < best_dist:
                    best_dist = dist
                    nearest = station
            if nearest is not None:
                self.charging_mode = True
                self.path = self.graph.a_star(self.drone.node, nearest)
                self.path_index = 0
        if self.path and self.path_index < len(self.path) - 1:
            current_node = self.path[self.path_index]
            next_node = self.path[self.path_index+1]
            x1, y1 = self.graph.nodes[current_node]
            x2, y2 = self.graph.nodes[next_node]
            dx = x2 - x1
            dy = y2 - y1
            dist = np.hypot(dx, dy)
            if dist > 0:
                move = min(self.drone.speed * dt, dist)
                ratio = move / dist
                new_x = self.drone.pos[0] + dx * ratio
                new_y = self.drone.pos[1] + dy * ratio
                self.drone.pos = (new_x, new_y)
                if np.hypot(new_x - x2, new_y - y2) < 0.5:
                    self.path_index += 1
                    self.drone.node = next_node
        else:
            if self.drone.node != self.graph.goal:
                terminated = True
        
        if self.drone.node == self.graph.goal and not self.charging_mode:
            terminated = True
        
        if self.drone.status == "flying":
            climbing = (self.drone.altitude > self.drone.normal_altitude)
            self.drone.consume_battery(dt, climbing)
        
        self.drone.update_temperature(dt)
        
        if self.step_count >= self.max_steps:
            truncated = True
        
        return self._get_obs(), 0, terminated, truncated, {}