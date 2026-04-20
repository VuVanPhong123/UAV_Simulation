import gymnasium as gym
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
        self.obstacles = []
        self.sensor_range = config['obstacle_avoidance']['sensor_range']
        self.avoid_duration = config['obstacle_avoidance']['avoidance_duration']
        self.altitude_boost = config['obstacle_avoidance']['altitude_boost']
        self.turn_angle = config['obstacle_avoidance']['turn_angle']
        
        self.reset()
    
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.drone.battery = self.drone.max_battery
        self.drone.status = "flying"
        self.drone.pos = self.graph.nodes[self.graph.start]
        self.drone.node = self.graph.start
        self.drone.altitude = self.drone.normal_altitude
        
        raw_path = self.graph.a_star(self.graph.start, self.graph.goal, current_altitude=self.drone.altitude)
        self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
        
        self.path_index = 0
    
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
        for obs in self.obstacles:
            dx = self.drone.pos[0] - obs[0]
            dy = self.drone.pos[1] - obs[1]
            dist = np.hypot(dx, dy)
            if dist < self.sensor_range:
                return True
        return False
    
    def _handle_avoidance(self, dt):
        if not self.avoiding:
            if self._detect_obstacle():
                self.avoiding = True
                self.avoid_timer = self.avoid_duration
                if self.drone.altitude < self.drone.max_altitude - 5:
                    self.drone.altitude = min(self.drone.max_altitude, self.drone.altitude + self.altitude_boost)
                    print(f"Né tránh: tăng độ cao lên {self.drone.altitude}m")
                else:
                    self.avoid_direction = 1 if np.random.rand() > 0.5 else -1
                    print(f" Né tránh: rẽ {'trái' if self.avoid_direction==-1 else 'phải'} {self.turn_angle}°")
        else:
            self.avoid_timer -= dt
            if self.avoid_timer <= 0:
                self.avoiding = False
                self.drone.altitude = self.drone.normal_altitude
                self.avoid_direction = 0
                print(" Kết thúc né tránh, quay lại đường bay bình thường")
        return self.avoiding
    
    def _is_out_of_bounds(self, pos):
        return False
    
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
                print(f"Sạc xong, pin {self.drone.battery:.1f}%, tiếp tục bay đến goal")
                
                raw_path = self.graph.a_star(self.drone.node, self.graph.goal, current_altitude=self.drone.altitude)
                self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
                
                self.path_index = 0
                self.charging_mode = False
            return self._get_obs(), 0, terminated, truncated, {}
        
        if self.drone.battery < self.drone.low_threshold and not self.charging_mode:
            nearest_station = None
            min_dist = float('inf')
            
            for station_node in self.graph.charging_stations:
                s_pos = self.graph.nodes[station_node]
                dist = np.hypot(self.drone.pos[0] - s_pos[0], self.drone.pos[1] - s_pos[1])
                if dist < min_dist:
                    path_check = self.graph.a_star(self.drone.node, station_node, self.drone.altitude)
                    if path_check:
                        min_dist = dist
                        nearest_station = station_node
                        
            if nearest_station:
                self.charging_mode = True
                raw_path = self.graph.a_star(self.drone.node, nearest_station, self.drone.altitude)
                self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
                self.path_index = 0
        
        if self.path and self.path_index < len(self.path) - 1:
            next_node = self.path[self.path_index+1]
            x2, y2 = self.graph.nodes[next_node]
            
            dx = x2 - self.drone.pos[0]
            dy = y2 - self.drone.pos[1]
            dist = np.hypot(dx, dy)
            
            if dist > 0:
                move = min(self.drone.speed * dt, dist)
                ratio = move / dist
                new_x = self.drone.pos[0] + dx * ratio
                new_y = self.drone.pos[1] + dy * ratio
                self.drone.pos = (new_x, new_y)
                
                if dist <= self.drone.speed * dt + 1e-4:
                    self.path_index += 1
                    self.drone.node = next_node
                    self.drone.pos = (x2, y2)
        else:
            if self.drone.node != self.graph.goal:
                print("Hết path nhưng chưa đến goal!")
                terminated = True
        
        if self.drone.node == self.graph.goal and not self.charging_mode:
            terminated = True
            print("Giao hàng thành công!")
        
        if self.drone.status == "flying":
            climbing = (self.drone.altitude > self.drone.normal_altitude)
            self.drone.consume_battery(dt, climbing)
        
        if self.drone.battery <= 0:
            terminated = True
            print("Hết pin! Giao hàng thất bại.")
        
        self.drone.update_temperature(dt)
        
        if self.step_count >= self.max_steps:
            truncated = True
        
        return self._get_obs(), 0, terminated, truncated, {}