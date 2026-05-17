import math
import time

import numpy as np

from physics.drone import Drone
from physics.energy import rain_factor
from pathfinding.graph import WaypointGraph
from pathfinding.utils import path_point_altitude, path_point_node
from models.order import serialize_mission, serialize_order
from models.statuses import DroneStatus, EventCode, EventLevel, MissionStatus, OrderStatus
from simulation.agent import DroneAgent
from simulation.collision import CollisionSystem
import simulation.dispatcher as _dispatcher
import simulation.obstacles as _obstacles


TERMINAL_STATUSES = {
    DroneStatus.SUCCESS.value,
    DroneStatus.FAILED.value,
    DroneStatus.EMERGENCY_LANDING.value,
}

DEFAULT_MAX_DEMO_DRONES = 15


def clamp_drone_count(value, config):
    max_demo_drones = int(config.get("performance", {}).get("max_demo_drones", DEFAULT_MAX_DEMO_DRONES))
    max_demo_drones = max(1, min(DEFAULT_MAX_DEMO_DRONES, max_demo_drones))
    return max(1, min(max_demo_drones, int(value or 1)))


class SimulationWorld:
    def __init__(self, config, drone_count=1, idle_on_start=True, drone_id_offset=0):
        self.config = config
        self.idle_on_start = bool(idle_on_start)
        self.drone_id_offset = max(0, int(drone_id_offset or 0))
        self.graph = WaypointGraph(config)
        self.time_step = config["simulation"]["time_step"]
        self.max_steps = config["simulation"]["max_steps"]
        self.sensor_range = config["obstacle_avoidance"]["sensor_range"]
        self.avoid_duration = config["obstacle_avoidance"]["avoidance_duration"]
        self.altitude_boost = config["obstacle_avoidance"]["altitude_boost"]
        self.detected_obstacle_buffer = float(config["obstacle_avoidance"].get("detected_obstacle_buffer", 10.0))
        self.sensor_lookahead_factor = float(config["obstacle_avoidance"].get("sensor_lookahead_factor", 1.0))
        self.vertical_speed = config.get("drone", {}).get("vertical_speed", 3.0)
        self.collision_system = CollisionSystem(config, self.graph)
        self.wind_dir = 0.0
        self.wind_speed = 0.0
        self.ambient_temp = 25.0
        self.is_raining = False
        self.step_count = 0
        self.pending_events = []
        self.pending_order_updates = []
        self.pending_mission_updates = []
        self.obstacles = []
        self.no_fly_zones = []
        self.proximity_cooldowns = {}
        self.drone_count = clamp_drone_count(drone_count, self.config)
        self.agents = {}
        self.orders = {}
        self.missions = {}
        self.order_seq = 1
        self.mission_seq = 1
        self.reset(self.drone_count)

    def reset(self, drone_count=None):
        if drone_count is not None:
            self.drone_count = clamp_drone_count(drone_count, self.config)
        self.step_count = 0
        self.pending_events = []
        self.pending_order_updates = []
        self.pending_mission_updates = []
        self.obstacles = []
        self.no_fly_zones = []
        self.proximity_cooldowns = {}
        self.orders = {}
        self.missions = {}
        self.order_seq = 1
        self.mission_seq = 1
        self.graph.clear_dynamic_obstacles()
        self.agents = {}

        for idx in range(self.drone_count):
            global_idx = self.drone_id_offset + idx + 1
            drone_id = f"drone_{global_idx}"
            drone = Drone(self.config)
            start_node = self._find_nearby_clear_node(self.graph.start, idx, drone.normal_altitude)
            goal_node = self._find_nearby_clear_node(self.graph.goal, idx, drone.normal_altitude)
            drone.pos = self.graph.nodes[start_node]
            drone.node = start_node
            drone.altitude = drone.normal_altitude
            drone.heading = 0.0
            drone.temperature = 30.0
            drone.status = DroneStatus.IDLE.value if self.idle_on_start else DroneStatus.PLANNING.value

            agent = DroneAgent(
                drone_id=drone_id,
                drone=drone,
                start_node=start_node,
                goal_node=goal_node,
                current_target_node=start_node if self.idle_on_start else goal_node,
                current_target_type="idle" if self.idle_on_start else "goal",
                current_target_altitude=drone.normal_altitude,
                current_order_id=None,
                current_mission_id=None,
                available=True,
                return_target_node_after_charging=None,
                return_target_type_after_charging=None,
            )
            self.agents[drone_id] = agent
            if not self.idle_on_start:
                self._replan_agent(agent, EventCode.PATH_PLANNED.value, "Initial path planned.")

    # ── event / update queues ─────────────────────────────────────────────────

    def queue_event(self, drone_id, level, code, message):
        self.pending_events.append({"droneId": drone_id, "level": level, "code": code, "message": message})

    def drain_events(self):
        events = self.pending_events
        self.pending_events = []
        return events

    def queue_order_update(self, order):
        if order is not None:
            self.pending_order_updates.append(serialize_order(order))

    def queue_mission_update(self, mission):
        if mission is not None:
            self.pending_mission_updates.append(serialize_mission(mission))

    def drain_order_updates(self):
        updates = self.pending_order_updates
        self.pending_order_updates = []
        return updates

    def drain_mission_updates(self):
        updates = self.pending_mission_updates
        self.pending_mission_updates = []
        return updates

    # ── agent accessors ───────────────────────────────────────────────────────

    def get_all_agent_ids(self):
        return list(self.agents.keys())

    def get_agents(self):
        return self.agents.values()

    def get_agent(self, drone_id):
        return self.agents.get(drone_id)

    def get_available_agents(self):
        return _dispatcher.get_available_agents(self)

    # ── order / mission delegation ────────────────────────────────────────────

    def dispatch_pending_orders(self):
        return _dispatcher.dispatch_pending_orders(self)

    def receive_order_batch(self, orders_payload, auto_dispatch=True):
        return _dispatcher.receive_order_batch(self, orders_payload, auto_dispatch)

    def get_order_state(self):
        return {
            "orders": [serialize_order(order) for order in self.orders.values()],
            "missions": [serialize_mission(mission) for mission in self.missions.values()],
        }

    def _fail_current_mission(self, agent, reason):
        _dispatcher.fail_mission(self, agent, reason)

    def _handle_pickup_arrival(self, agent):
        _dispatcher.handle_pickup_arrival(self, agent)

    def _handle_dropoff_arrival(self, agent):
        _dispatcher.handle_dropoff_arrival(self, agent)

    # ── obstacle / NFZ delegation ─────────────────────────────────────────────

    def add_obstacle(self, latlng, radius=8.0, height=25.0, obstacle_type="unknown"):
        _obstacles.add_obstacle(self, latlng, radius, height, obstacle_type)

    def add_no_fly_zone(self, latlng, radius, height=None):
        return _obstacles.add_no_fly_zone(self, latlng, radius, height)

    def _detect_obstacles(self, agent):
        return _obstacles.detect_obstacles(self, agent)

    def _handle_avoidance(self, agent, dt):
        return _obstacles.handle_avoidance(self, agent, dt)

    # ── navigation helpers ────────────────────────────────────────────────────

    def _find_nearby_clear_node(self, base_node, offset_index, altitude):
        offsets = [(0, 0), (2, 0), (-2, 0), (0, 2), (0, -2), (2, 2), (-2, -2), (3, 0), (0, 3)]
        preferred = offsets[offset_index % len(offsets)]
        candidates = [preferred] + [o for o in offsets if o != preferred]
        for dx, dy in candidates:
            node = (base_node[0] + dx, base_node[1] + dy)
            if (
                0 <= node[0] < self.graph.cols
                and 0 <= node[1] < self.graph.rows
                and self.graph.is_node_clear_at_altitude(node, altitude)
            ):
                return node
        return base_node

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

    def _next_path_pos(self, agent):
        if agent.path and agent.path_index < len(agent.path) - 1:
            next_point = agent.path[agent.path_index + 1]
            next_node = self._path_node(next_point)
            return self.graph.nodes.get(next_node)
        return None

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
        if agent.current_target_type == "idle":
            agent.path = []
            agent.path_index = 0
            agent.current_target_node = agent.drone.node
            agent.current_target_altitude = agent.drone.altitude
            agent.drone.status = DroneStatus.IDLE.value
            return True

        raw_path = self._plan_path(agent.drone.node, agent.current_target_node, agent.drone.altitude)
        agent.path = self.graph.smooth_path(raw_path, agent.drone.altitude) if raw_path else []
        agent.path_index = 0
        agent.current_target_altitude = self._next_target_altitude(agent)
        if agent.path:
            agent.drone.status = DroneStatus.FLYING.value
            agent.num_replans += 1
            if event_code and event_message:
                self.queue_event(agent.drone_id, EventLevel.INFO.value, event_code, event_message)
            return True

        agent.drone.status = DroneStatus.FAILED.value
        if agent.current_mission_id:
            self._fail_current_mission(agent, "No safe path available.")
        self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "No safe path available.")
        return False

    # ── weather ───────────────────────────────────────────────────────────────

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
            if agent.current_target_type == "idle":
                continue
            agent.drone.node = self._current_grid_node(agent)
            agent.drone.status = DroneStatus.PLANNING.value
            self._replan_agent(agent, EventCode.PATH_REPLANNED.value, "Path replanned after weather update.")

    # ── charging ──────────────────────────────────────────────────────────────

    def _find_best_charging_station(self, agent):
        best_station = None
        best_path = None
        best_cost = float("inf")
        for station_node in self.graph.charging_stations:
            path = self._plan_path(agent.drone.node, station_node, agent.drone.altitude)
            if not path:
                continue
            cost = self.graph.estimate_path_cost(
                path, agent.drone.altitude,
                self.wind_dir, self.wind_speed, self.ambient_temp, self.is_raining,
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
        if agent.return_target_node_after_charging is not None:
            agent.current_target_node = agent.return_target_node_after_charging
            agent.current_target_type = agent.return_target_type_after_charging or "goal"
            agent.return_target_node_after_charging = None
            agent.return_target_type_after_charging = None
            event_message = "Path replanned from charging station to mission target."
        else:
            agent.current_target_node = agent.goal_node
            agent.current_target_type = "goal"
            event_message = "Path replanned from charging station to goal."
        agent.charging_mode = False
        agent.drone.status = DroneStatus.PLANNING.value
        self._replan_agent(agent, EventCode.PATH_REPLANNED.value, event_message)

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
            agent.return_target_node_after_charging = agent.current_target_node
            agent.return_target_type_after_charging = agent.current_target_type
            agent.current_target_node = station_node
            agent.current_target_type = "charging_station"
            agent.path = self.graph.smooth_path(station_path, agent.drone.altitude)
            agent.path_index = 0
            agent.current_target_altitude = self._next_target_altitude(agent)
            agent.drone.status = DroneStatus.FLYING.value
            self.queue_event(
                agent.drone_id, EventLevel.INFO.value, EventCode.PATH_REPLANNED.value,
                f"Low battery: rerouting to charging station, cost={station_cost:.1f}.",
            )
        else:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            if agent.current_mission_id:
                self._fail_current_mission(agent, "Low battery and no reachable charging station.")
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Low battery and no reachable charging station.")

    # ── movement ──────────────────────────────────────────────────────────────

    def _move_agent(self, agent, dt):
        agent.altitude_change_rate = 0.0
        agent.last_climbing = False

        if agent.path and agent.path_index < len(agent.path) - 1:
            next_point = agent.path[agent.path_index + 1]
            next_node = self._path_node(next_point)
            path_target_altitude = self._path_altitude(next_point, agent.drone.altitude)
            target_altitude = path_target_altitude
            if agent.collision.temporary_altitude is not None and agent.collision.avoidance_steps > 0:
                target_altitude = max(target_altitude, float(agent.collision.temporary_altitude))
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
                if effective_speed <= 0:
                    horizontal_reached = False
                else:
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
            elif agent.current_target_type == "pickup":
                self._handle_pickup_arrival(agent)
            elif agent.current_target_type == "dropoff":
                self._handle_dropoff_arrival(agent)
            elif agent.current_target_type == "idle":
                agent.drone.status = DroneStatus.IDLE.value
            else:
                agent.drone.status = DroneStatus.SUCCESS.value
                self.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.DELIVERY_SUCCESS.value, "Delivery completed successfully.")
        elif not agent.path or agent.path_index >= len(agent.path) - 1:
            if agent.current_target_type == "idle":
                agent.drone.status = DroneStatus.IDLE.value
            else:
                agent.drone.status = DroneStatus.FAILED.value
                if agent.current_mission_id:
                    self._fail_current_mission(agent, "Path ended before reaching target.")
                self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Path ended before reaching target.")

        if agent.drone.status == DroneStatus.FLYING.value:
            is_shielded = self.graph.check_wind_shadow(agent.drone.node, self.wind_dir, agent.drone.altitude)
            agent.drone.consume_battery(
                dt, agent.last_climbing,
                wind_speed=self.wind_speed, wind_dir=self.wind_dir,
                heading=agent.drone.heading, is_shielded=is_shielded, is_raining=self.is_raining,
            )

        if agent.drone.battery <= 0:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            if agent.current_mission_id:
                self._fail_current_mission(agent, "Battery depleted.")
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Battery depleted. Emergency landing.")

        agent.drone.update_temperature(dt, self.ambient_temp)

    # ── simulation control ────────────────────────────────────────────────────

    def _has_active_work(self):
        active_order_statuses = {
            OrderStatus.PENDING.value, OrderStatus.ASSIGNED.value,
            OrderStatus.GOING_TO_PICKUP.value, OrderStatus.PICKED_UP.value,
            OrderStatus.DELIVERING.value,
        }
        active_mission_statuses = {
            MissionStatus.PLANNED.value, MissionStatus.TO_PICKUP.value,
            MissionStatus.PICKUP_ARRIVED.value, MissionStatus.TO_DROPOFF.value,
        }
        return (
            any(order.status in active_order_statuses for order in self.orders.values())
            or any(mission.status in active_mission_statuses for mission in self.missions.values())
        )

    def step(self):
        self.step_count += 1
        dt = self.time_step
        self.collision_system.apply(self)

        for agent in self.get_agents():
            if agent.drone.status in TERMINAL_STATUSES or agent.drone.status == DroneStatus.PAUSED.value:
                continue
            if agent.drone.status == DroneStatus.CHARGING.value:
                self._handle_charging(agent, dt)
                continue
            if self._handle_avoidance(agent, dt):
                continue
            if agent.drone.status in TERMINAL_STATUSES:
                continue
            self._maybe_reroute_to_charging(agent)
            if agent.drone.status == DroneStatus.FLYING.value:
                self._move_agent(agent, dt)

        if not self.idle_on_start and self.step_count >= self.max_steps and self._has_active_work():
            for agent in self.get_agents():
                if (
                    agent.drone.status not in TERMINAL_STATUSES
                    and (agent.current_mission_id or agent.current_order_id)
                ):
                    agent.drone.status = DroneStatus.FAILED.value
                    if agent.current_mission_id:
                        self._fail_current_mission(agent, "Simulation reached max steps.")
                    self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Simulation reached max steps.")

    def pause(self):
        for agent in self.get_agents():
            if (
                agent.drone.status not in TERMINAL_STATUSES
                and agent.drone.status != DroneStatus.CHARGING.value
                and agent.current_target_type != "idle"
            ):
                agent.drone.status = DroneStatus.PAUSED.value

    def resume(self):
        for agent in self.get_agents():
            if agent.drone.status == DroneStatus.PAUSED.value:
                agent.drone.status = DroneStatus.FLYING.value if agent.path else DroneStatus.IDLE.value

    def stop(self):
        for agent in self.get_agents():
            if agent.drone.status not in TERMINAL_STATUSES:
                agent.drone.status = DroneStatus.FAILED.value
                if agent.current_mission_id:
                    self._fail_current_mission(agent, "Simulation stopped.")

    def is_all_done(self):
        if self.orders:
            terminal_order_statuses = {OrderStatus.COMPLETED.value, OrderStatus.FAILED.value, OrderStatus.CANCELED.value}
            active_mission_statuses = {MissionStatus.PLANNED.value, MissionStatus.TO_PICKUP.value, MissionStatus.PICKUP_ARRIVED.value, MissionStatus.TO_DROPOFF.value}
            return (
                all(order.status in terminal_order_statuses for order in self.orders.values())
                and not any(mission.status in active_mission_statuses for mission in self.missions.values())
            )
        return all(agent.drone.status in TERMINAL_STATUSES for agent in self.get_agents())

    def final_status(self):
        if self.orders:
            terminal_order_statuses = {OrderStatus.COMPLETED.value, OrderStatus.FAILED.value, OrderStatus.CANCELED.value}
            active_mission_statuses = {MissionStatus.PLANNED.value, MissionStatus.TO_PICKUP.value, MissionStatus.PICKUP_ARRIVED.value, MissionStatus.TO_DROPOFF.value}
            orders = list(self.orders.values())
            has_active_mission = any(mission.status in active_mission_statuses for mission in self.missions.values())
            has_pending = any(order.status == OrderStatus.PENDING.value for order in orders)
            if orders and all(order.status in (OrderStatus.COMPLETED.value, OrderStatus.CANCELED.value) for order in orders):
                return "success"
            if (
                any(order.status == OrderStatus.FAILED.value for order in orders)
                and not has_active_mission
                and not has_pending
                and all(order.status in terminal_order_statuses for order in orders)
            ):
                return "failed"
            return "running"
        statuses = [agent.drone.status for agent in self.get_agents()]
        if statuses and all(status == DroneStatus.SUCCESS.value for status in statuses):
            return "success"
        if any(status in (DroneStatus.FAILED.value, DroneStatus.EMERGENCY_LANDING.value) for status in statuses):
            return "failed"
        return "running"
