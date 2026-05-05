from dataclasses import dataclass, field

import numpy as np

from drone import Drone
from energy_model import rain_factor
from graph_map import WaypointGraph, path_point_altitude, path_point_node
from statuses import DroneStatus, EventCode, EventLevel


TERMINAL_STATUSES = {
    DroneStatus.SUCCESS.value,
    DroneStatus.FAILED.value,
    DroneStatus.EMERGENCY_LANDING.value,
}


@dataclass
class DroneAgent:
    drone_id: str
    drone: Drone
    start_node: tuple
    goal_node: tuple
    current_target_node: tuple
    current_target_type: str = "goal"
    path: list = field(default_factory=list)
    path_index: int = 0
    charging_mode: bool = False
    avoiding: bool = False
    avoid_timer: float = 0.0
    current_target_altitude: float = 0.0
    altitude_change_rate: float = 0.0
    last_climbing: bool = False
    temp_speed_factor: float = 1.0
    num_replans: int = 0
    num_charging_stops: int = 0
    last_event_step: int = 0


class SimulationWorld:
    def __init__(self, config, drone_count=1):
        self.config = config
        self.graph = WaypointGraph(config)
        self.time_step = config["simulation"]["time_step"]
        self.max_steps = config["simulation"]["max_steps"]
        self.sensor_range = config["obstacle_avoidance"]["sensor_range"]
        self.avoid_duration = config["obstacle_avoidance"]["avoidance_duration"]
        self.altitude_boost = config["obstacle_avoidance"]["altitude_boost"]
        self.vertical_speed = config.get("drone", {}).get("vertical_speed", 3.0)
        self.safety_distance = config.get("simulation", {}).get("drone_safety_distance", 12.0)
        self.wind_dir = 0.0
        self.wind_speed = 0.0
        self.ambient_temp = 25.0
        self.is_raining = False
        self.step_count = 0
        self.pending_events = []
        self.obstacles = []
        self.proximity_cooldowns = {}
        self.drone_count = max(1, min(5, int(drone_count or 1)))
        self.agents = {}
        self.reset(self.drone_count)

    def reset(self, drone_count=None):
        if drone_count is not None:
            self.drone_count = max(1, min(5, int(drone_count or 1)))
        self.step_count = 0
        self.pending_events = []
        self.obstacles = []
        self.proximity_cooldowns = {}
        self.graph.clear_dynamic_obstacles()
        self.agents = {}

        for idx in range(self.drone_count):
            drone_id = f"drone_{idx + 1}"
            drone = Drone(self.config)
            start_node = self._find_nearby_clear_node(self.graph.start, idx, drone.normal_altitude)
            goal_node = self._find_nearby_clear_node(self.graph.goal, idx, drone.normal_altitude)
            drone.pos = self.graph.nodes[start_node]
            drone.node = start_node
            drone.altitude = drone.normal_altitude
            drone.heading = 0.0
            drone.temperature = 30.0
            drone.status = DroneStatus.PLANNING.value

            agent = DroneAgent(
                drone_id=drone_id,
                drone=drone,
                start_node=start_node,
                goal_node=goal_node,
                current_target_node=goal_node,
                current_target_altitude=drone.normal_altitude,
            )
            self.agents[drone_id] = agent
            self._replan_agent(agent, EventCode.PATH_PLANNED.value, "Initial path planned.")

    def _find_nearby_clear_node(self, base_node, offset_index, altitude):
        offsets = [
            (0, 0),
            (2, 0),
            (-2, 0),
            (0, 2),
            (0, -2),
            (2, 2),
            (-2, -2),
            (3, 0),
            (0, 3),
        ]
        preferred = offsets[offset_index % len(offsets)]
        candidates = [preferred] + [offset for offset in offsets if offset != preferred]
        for dx, dy in candidates:
            node = (base_node[0] + dx, base_node[1] + dy)
            if (
                0 <= node[0] < self.graph.cols
                and 0 <= node[1] < self.graph.rows
                and self.graph.is_node_clear_at_altitude(node, altitude)
            ):
                return node
        return base_node

    def queue_event(self, drone_id, level, code, message):
        self.pending_events.append({
            "droneId": drone_id,
            "level": level,
            "code": code,
            "message": message,
        })

    def drain_events(self):
        events = self.pending_events
        self.pending_events = []
        return events

    def get_all_agent_ids(self):
        return list(self.agents.keys())

    def get_agents(self):
        return self.agents.values()

    def get_agent(self, drone_id):
        return self.agents.get(drone_id)

    def _path_node(self, point):
        return path_point_node(point)

    def _path_altitude(self, point, default_altitude):
        return path_point_altitude(point, default_altitude)

    def _next_target_altitude(self, agent):
        if agent.path and agent.path_index < len(agent.path) - 1:
            return self._path_altitude(agent.path[agent.path_index + 1], agent.drone.altitude)
        if agent.path:
            return self._path_altitude(agent.path[-1], agent.drone.altitude)
        return agent.drone.altitude

    def _current_grid_node(self, agent):
        cx = int(round((agent.drone.pos[0] - self.graph.min_x) / self.graph.resolution))
        cy = int(round((agent.drone.pos[1] - self.graph.min_y) / self.graph.resolution))
        cx = max(0, min(self.graph.cols - 1, cx))
        cy = max(0, min(self.graph.rows - 1, cy))
        return (cx, cy)

    def _plan_path(self, start, goal, current_altitude):
        return self.graph.a_star_2_5d(
            start,
            goal,
            current_altitude=current_altitude,
            wind_dir=self.wind_dir,
            wind_speed=self.wind_speed,
            ambient_temp=self.ambient_temp,
            is_raining=self.is_raining,
        )

    def _replan_agent(self, agent, event_code=None, event_message=None):
        raw_path = self._plan_path(
            agent.drone.node,
            agent.current_target_node,
            agent.drone.altitude,
        )
        agent.path = self.graph.smooth_path(raw_path, agent.drone.altitude)
        agent.path_index = 0
        agent.current_target_altitude = self._next_target_altitude(agent)
        if agent.path:
            agent.drone.status = DroneStatus.FLYING.value
            agent.num_replans += 1
            if event_code and event_message:
                self.queue_event(agent.drone_id, EventLevel.INFO.value, event_code, event_message)
            return True

        agent.drone.status = DroneStatus.FAILED.value
        self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "No safe path available.")
        return False

    def update_weather(self, wind_dir, wind_speed, ambient_temp, is_raining=False, replan=True):
        self.wind_dir = float(wind_dir)
        self.wind_speed = float(wind_speed)
        self.ambient_temp = float(ambient_temp)
        self.is_raining = bool(is_raining)
        if not replan:
            return
        for agent in self.get_agents():
            if agent.drone.status in TERMINAL_STATUSES or agent.drone.status == DroneStatus.CHARGING.value:
                continue
            agent.drone.node = self._current_grid_node(agent)
            agent.drone.status = DroneStatus.PLANNING.value
            self._replan_agent(agent, EventCode.PATH_REPLANNED.value, "Path replanned after weather update.")

    def add_obstacle(self, latlng, radius=8.0, height=25.0, obstacle_type="unknown"):
        x, y = self.graph.transformer.transform(latlng[1], latlng[0])
        self.obstacles.append({
            "pos": (x, y),
            "radius": float(radius),
            "height": float(height),
            "type": obstacle_type,
            "detected_by": set(),
            "graph_added": False,
        })

    def _detect_obstacles(self, agent):
        blocking_detected = False
        for obs in self.obstacles:
            if agent.drone_id in obs["detected_by"]:
                continue

            dx = agent.drone.pos[0] - obs["pos"][0]
            dy = agent.drone.pos[1] - obs["pos"][1]
            effective_sensor_range = self.sensor_range * rain_factor(self.is_raining)["sensor_factor"]
            if np.hypot(dx, dy) > effective_sensor_range + obs["radius"]:
                continue

            obs["detected_by"].add(agent.drone_id)
            if not obs["graph_added"]:
                self.graph.add_dynamic_obstacle(obs["pos"], obs["radius"], obs["height"])
                obs["graph_added"] = True
            self.queue_event(
                agent.drone_id,
                EventLevel.WARNING.value,
                EventCode.OBSTACLE_DETECTED.value,
                f"Obstacle detected: {obs['type']} r={obs['radius']:.1f}m h={obs['height']:.1f}m.",
            )
            if agent.drone.altitude <= obs["height"] + self.graph.safety_margin:
                blocking_detected = True

        return blocking_detected

    def _handle_avoidance(self, agent, dt):
        if agent.drone.status in TERMINAL_STATUSES or agent.drone.status == DroneStatus.CHARGING.value:
            return

        if not agent.avoiding:
            if not self._detect_obstacles(agent):
                return
            agent.avoiding = True
            agent.avoid_timer = self.avoid_duration
            agent.drone.status = DroneStatus.REROUTING.value
            agent.drone.node = self._current_grid_node(agent)
            if self._replan_agent(agent, EventCode.PATH_REPLANNED.value, "Path replanned around obstacle."):
                return

            boosted_altitude = min(agent.drone.max_altitude, agent.drone.altitude + self.altitude_boost)
            raw_path = self._plan_path(agent.drone.node, agent.current_target_node, boosted_altitude)
            if raw_path:
                agent.path = self.graph.smooth_path(raw_path, agent.drone.altitude)
                agent.path.insert(0, {"node": agent.drone.node, "altitude": float(agent.drone.altitude)})
                agent.path_index = 0
                agent.current_target_altitude = self._next_target_altitude(agent)
                agent.drone.status = DroneStatus.FLYING.value
                self.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned after altitude pop-up.")
            else:
                agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
                self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "No safe path after obstacle detection.")
        else:
            agent.avoid_timer -= dt
            if agent.avoid_timer <= 0:
                agent.avoiding = False

    def _find_best_charging_station(self, agent):
        best_station = None
        best_path = None
        best_cost = float("inf")
        for station_node in self.graph.charging_stations:
            path = self._plan_path(agent.drone.node, station_node, agent.drone.altitude)
            if not path:
                continue
            cost = self.graph.estimate_path_cost(
                path,
                agent.drone.altitude,
                self.wind_dir,
                self.wind_speed,
                self.ambient_temp,
                self.is_raining,
            )
            if cost < best_cost:
                best_cost = cost
                best_station = station_node
                best_path = path
        return best_station, best_path, best_cost

    def _handle_charging(self, agent, dt):
        agent.drone.recharge(dt)
        agent.drone.update_temperature(dt, self.ambient_temp)
        if agent.drone.status != DroneStatus.FLYING.value:
            return
        self.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.CHARGING_COMPLETED.value, "Charging completed.")
        agent.current_target_node = agent.goal_node
        agent.current_target_type = "goal"
        agent.charging_mode = False
        agent.drone.status = DroneStatus.PLANNING.value
        self._replan_agent(agent, EventCode.PATH_REPLANNED.value, "Path replanned from charging station to goal.")

    def _maybe_reroute_to_charging(self, agent):
        if (
            agent.drone.status != DroneStatus.FLYING.value
            or agent.drone.battery >= agent.drone.low_threshold
            or agent.charging_mode
        ):
            return
        station_node, station_path, station_cost = self._find_best_charging_station(agent)
        if station_node and station_path:
            agent.charging_mode = True
            agent.current_target_node = station_node
            agent.current_target_type = "charging_station"
            agent.path = self.graph.smooth_path(station_path, agent.drone.altitude)
            agent.path_index = 0
            agent.current_target_altitude = self._next_target_altitude(agent)
            agent.drone.status = DroneStatus.FLYING.value
            self.queue_event(
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.PATH_REPLANNED.value,
                f"Low battery: rerouting to charging station, cost={station_cost:.1f}.",
            )
        else:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Low battery and no reachable charging station.")

    def _apply_proximity_slowdown(self):
        for agent in self.get_agents():
            agent.temp_speed_factor = 1.0

        active = [
            agent for agent in self.get_agents()
            if agent.drone.status == DroneStatus.FLYING.value and agent.drone.pos is not None
        ]
        active.sort(key=lambda item: item.drone_id)
        for idx, first in enumerate(active):
            for second in active[idx + 1:]:
                dist = np.hypot(
                    first.drone.pos[0] - second.drone.pos[0],
                    first.drone.pos[1] - second.drone.pos[1],
                )
                if dist >= self.safety_distance:
                    continue
                second.temp_speed_factor = min(second.temp_speed_factor, 0.3)
                key = tuple(sorted((first.drone_id, second.drone_id)))
                last_step = self.proximity_cooldowns.get(key, -9999)
                if self.step_count - last_step >= 25:
                    self.queue_event(
                        second.drone_id,
                        EventLevel.WARNING.value,
                        EventCode.DRONE_PROXIMITY_WARNING.value,
                        f"Close to {first.drone_id}: {dist:.1f}m. Slowing down.",
                    )
                    self.proximity_cooldowns[key] = self.step_count

    def _move_agent(self, agent, dt):
        agent.altitude_change_rate = 0.0
        agent.last_climbing = False

        if agent.path and agent.path_index < len(agent.path) - 1:
            next_point = agent.path[agent.path_index + 1]
            next_node = self._path_node(next_point)
            target_altitude = self._path_altitude(next_point, agent.drone.altitude)
            agent.current_target_altitude = target_altitude
            x2, y2 = self.graph.nodes[next_node]

            alt_delta = target_altitude - agent.drone.altitude
            max_alt_change = max(0.0, self.vertical_speed) * dt
            agent.last_climbing = alt_delta > 0.1
            if max_alt_change <= 0 or abs(alt_delta) <= max_alt_change:
                agent.altitude_change_rate = alt_delta / dt if dt > 0 else 0.0
                agent.drone.altitude = target_altitude
            else:
                alt_step = np.sign(alt_delta) * max_alt_change
                agent.altitude_change_rate = alt_step / dt if dt > 0 else 0.0
                agent.drone.altitude += alt_step

            dx = x2 - agent.drone.pos[0]
            dy = y2 - agent.drone.pos[1]
            dist = np.hypot(dx, dy)
            horizontal_reached = dist <= 1e-4

            if dist > 0:
                agent.drone.heading = np.degrees(np.arctan2(dy, dx))
                effective_speed = (
                    agent.drone.speed
                    * rain_factor(self.is_raining)["speed_factor"]
                    * agent.temp_speed_factor
                )
                move = min(effective_speed * dt, dist)
                ratio = move / dist
                agent.drone.pos = (
                    agent.drone.pos[0] + dx * ratio,
                    agent.drone.pos[1] + dy * ratio,
                )
                horizontal_reached = dist <= effective_speed * dt + 1e-4
                if horizontal_reached:
                    agent.drone.node = next_node
                    agent.drone.pos = (x2, y2)

            altitude_reached = abs(target_altitude - agent.drone.altitude) <= 1e-3
            if horizontal_reached and altitude_reached:
                agent.path_index += 1
                agent.drone.node = next_node
                agent.drone.pos = (x2, y2)
                agent.drone.altitude = target_altitude
                agent.current_target_altitude = self._next_target_altitude(agent)

        target_reached = (
            agent.drone.node == agent.current_target_node
            and (not agent.path or agent.path_index >= len(agent.path) - 1)
        )
        if target_reached:
            if agent.current_target_type == "charging_station":
                agent.path = []
                agent.path_index = 0
                agent.charging_mode = True
                agent.num_charging_stops += 1
                agent.drone.status = DroneStatus.CHARGING.value
                self.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.CHARGING_STARTED.value, "Charging started.")
            else:
                agent.drone.status = DroneStatus.SUCCESS.value
                self.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.DELIVERY_SUCCESS.value, "Delivery completed successfully.")
        elif not agent.path or agent.path_index >= len(agent.path) - 1:
            agent.drone.status = DroneStatus.FAILED.value
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Path ended before reaching target.")

        if agent.drone.status == DroneStatus.FLYING.value:
            is_shielded = self.graph.check_wind_shadow(agent.drone.node, self.wind_dir, agent.drone.altitude)
            agent.drone.consume_battery(
                dt,
                agent.last_climbing,
                wind_speed=self.wind_speed,
                wind_dir=self.wind_dir,
                heading=agent.drone.heading,
                is_shielded=is_shielded,
                is_raining=self.is_raining,
            )

        if agent.drone.battery <= 0:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Battery depleted. Emergency landing.")

        agent.drone.update_temperature(dt, self.ambient_temp)

    def step(self):
        self.step_count += 1
        dt = self.time_step
        self._apply_proximity_slowdown()

        for agent in self.get_agents():
            if agent.drone.status in TERMINAL_STATUSES or agent.drone.status == DroneStatus.PAUSED.value:
                continue
            if agent.drone.status == DroneStatus.CHARGING.value:
                self._handle_charging(agent, dt)
                continue
            self._handle_avoidance(agent, dt)
            if agent.drone.status in TERMINAL_STATUSES:
                continue
            self._maybe_reroute_to_charging(agent)
            if agent.drone.status == DroneStatus.FLYING.value:
                self._move_agent(agent, dt)

        if self.step_count >= self.max_steps:
            for agent in self.get_agents():
                if agent.drone.status not in TERMINAL_STATUSES:
                    agent.drone.status = DroneStatus.FAILED.value
                    self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Simulation reached max steps.")

    def pause(self):
        for agent in self.get_agents():
            if agent.drone.status not in TERMINAL_STATUSES and agent.drone.status != DroneStatus.CHARGING.value:
                agent.drone.status = DroneStatus.PAUSED.value

    def resume(self):
        for agent in self.get_agents():
            if agent.drone.status == DroneStatus.PAUSED.value:
                agent.drone.status = DroneStatus.FLYING.value if agent.path else DroneStatus.PLANNING.value

    def stop(self):
        for agent in self.get_agents():
            if agent.drone.status not in TERMINAL_STATUSES:
                agent.drone.status = DroneStatus.FAILED.value

    def is_all_done(self):
        return all(agent.drone.status in TERMINAL_STATUSES for agent in self.get_agents())

    def final_status(self):
        statuses = [agent.drone.status for agent in self.get_agents()]
        if statuses and all(status == DroneStatus.SUCCESS.value for status in statuses):
            return "success"
        if any(status in (DroneStatus.FAILED.value, DroneStatus.EMERGENCY_LANDING.value) for status in statuses):
            return "failed"
        return "running"
