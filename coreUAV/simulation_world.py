from dataclasses import dataclass, field
import math
import time

import numpy as np

from dispatch_engine import dispatch_score
from drone import Drone
from energy_model import rain_factor
from graph_map import WaypointGraph, path_point_altitude, path_point_node
from order_models import DeliveryOrder, Mission, serialize_mission, serialize_order
from statuses import DroneStatus, EventCode, EventLevel, MissionStatus, OrderStatus


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
    current_target_type: str = "idle"
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
    current_order_id: str | None = None
    current_mission_id: str | None = None
    available: bool = True
    return_target_node_after_charging: tuple | None = None
    return_target_type_after_charging: str | None = None
    collision_hold_steps: int = 0
    collision_avoidance_reason: str | None = None
    collision_state: str = "clear"
    collision_peer_id: str | None = None
    collision_distance_m: float | None = None
    collision_action: str | None = None
    temporary_avoidance_altitude: float | None = None
    collision_avoidance_steps: int = 0


class SimulationWorld:
    def __init__(self, config, drone_count=1, idle_on_start=True):
        self.config = config
        self.idle_on_start = bool(idle_on_start)
        self.graph = WaypointGraph(config)
        self.time_step = config["simulation"]["time_step"]
        self.max_steps = config["simulation"]["max_steps"]
        self.sensor_range = config["obstacle_avoidance"]["sensor_range"]
        self.avoid_duration = config["obstacle_avoidance"]["avoidance_duration"]
        self.altitude_boost = config["obstacle_avoidance"]["altitude_boost"]
        self.vertical_speed = config.get("drone", {}).get("vertical_speed", 3.0)
        simulation_config = config.get("simulation", {})
        self.safety_distance = float(simulation_config.get("drone_safety_distance", 15.0))
        self.warning_distance = float(simulation_config.get("drone_warning_distance", max(self.safety_distance * 2, 25.0)))
        self.vertical_separation = float(simulation_config.get("drone_vertical_separation", 8.0))
        self.collision_hold_steps = int(simulation_config.get("drone_collision_hold_steps", 4))
        self.collision_detection_range = float(
            simulation_config.get(
                "drone_collision_detection_range",
                max(self.warning_distance, self.sensor_range),
            )
        )
        self.collision_prediction_steps = max(1, int(simulation_config.get("drone_collision_prediction_steps", 3)))
        self.collision_climb_steps = max(1, int(simulation_config.get("drone_collision_climb_steps", 10)))
        self.collision_prefer_climb = bool(simulation_config.get("drone_collision_prefer_climb", True))
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
        self.drone_count = max(1, min(5, int(drone_count or 1)))
        self.agents = {}
        self.orders = {}
        self.missions = {}
        self.order_seq = 1
        self.mission_seq = 1
        self.reset(self.drone_count)

    def reset(self, drone_count=None):
        if drone_count is not None:
            self.drone_count = max(1, min(5, int(drone_count or 1)))
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
            drone_id = f"drone_{idx + 1}"
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

    def _now_ms(self):
        return int(time.time() * 1000)

    def _next_order_id(self):
        while True:
            order_id = f"order_{self.order_seq}"
            self.order_seq += 1
            if order_id not in self.orders:
                return order_id

    def _is_finite_number(self, value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))

    def _validate_latlng_node(self, value, field_name, altitude, errors):
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            errors.append(f"{field_name} must be a [lat, lon] pair.")
            return None
        if not self._is_finite_number(value[0]) or not self._is_finite_number(value[1]):
            errors.append(f"{field_name} must contain finite numeric lat/lon values.")
            return None
        try:
            if not self.graph.is_latlng_within_bounds(value, margin_cells=2):
                errors.append(f"{field_name} is outside supported map area.")
                return None
            node = self.graph.latlng_to_node(value)
        except Exception as exc:
            errors.append(f"{field_name} could not be mapped to graph: {exc}")
            return None
        if not self.graph.is_node_clear_at_altitude(node, altitude):
            errors.append(f"{field_name} maps to blocked node {node} at altitude {altitude}.")
            return node
        return node

    def _normalize_order_payloads(self, orders_payload):
        if isinstance(orders_payload, dict) and isinstance(orders_payload.get("orders"), list):
            return orders_payload["orders"]
        if isinstance(orders_payload, list):
            return orders_payload
        if isinstance(orders_payload, dict) and ("pickup" in orders_payload or "dropoff" in orders_payload):
            return [orders_payload]
        return [{
            "orderId": self._next_order_id(),
            "_batch_error": "order batch must be a list or an object with an orders list."
        }]

    def get_available_agents(self):
        available_statuses = {
            DroneStatus.IDLE.value,
            DroneStatus.PLANNING.value,
            DroneStatus.FLYING.value,
            DroneStatus.SUCCESS.value,
        }
        return [
            agent for agent in self.get_agents()
            if agent.available
            and agent.current_mission_id is None
            and agent.drone.status in available_statuses
        ]

    def _estimate_path_cost_between(self, start_node, goal_node, altitude):
        path = self.graph.a_star_2_5d(
            start_node,
            goal_node,
            current_altitude=altitude,
            wind_dir=self.wind_dir,
            wind_speed=self.wind_speed,
            ambient_temp=self.ambient_temp,
            is_raining=self.is_raining,
        )
        if not path:
            return None, float("inf")
        cost = self.graph.estimate_path_cost(
            path,
            altitude,
            self.wind_dir,
            self.wind_speed,
            self.ambient_temp,
            self.is_raining,
        )
        return path, cost

    def _next_mission_id(self):
        while True:
            mission_id = f"mission_{self.mission_seq}"
            self.mission_seq += 1
            if mission_id not in self.missions:
                return mission_id

    def dispatch_pending_orders(self):
        changed_orders = []
        changed_missions = []
        assigned_count = 0
        pending_orders = [
            order for order in self.orders.values()
            if order.status == OrderStatus.PENDING.value and not order.validation_errors
        ]
        max_payload_kg = float(self.config.get("drone", {}).get("max_payload_kg", 5.0))

        self.queue_event(
            "system",
            EventLevel.INFO.value,
            EventCode.DISPATCH_STARTED.value,
            f"Dispatch started for {len(pending_orders)} pending order(s).",
        )

        for order in pending_orders:
            best_candidate = None
            for agent in self.get_available_agents():
                if order.payload_kg > max_payload_kg:
                    continue
                if agent.drone.battery < agent.drone.low_threshold:
                    continue

                altitude = float(agent.drone.altitude or self.config.get("drone", {}).get("normal_altitude", 20.0))
                _, cost_to_pickup = self._estimate_path_cost_between(agent.drone.node, order.pickup_node, altitude)
                if not np.isfinite(cost_to_pickup):
                    continue
                _, cost_delivery = self._estimate_path_cost_between(order.pickup_node, order.dropoff_node, altitude)
                if not np.isfinite(cost_delivery):
                    continue

                score = dispatch_score(
                    cost_to_pickup,
                    cost_delivery,
                    order.payload_kg,
                    order.priority,
                    agent.drone.battery,
                    agent.drone.low_threshold,
                )
                if not np.isfinite(score):
                    continue
                if best_candidate is None or score < best_candidate["score"]:
                    best_candidate = {
                        "agent": agent,
                        "score": score,
                    }

            if best_candidate is None:
                self.queue_event(
                    "system",
                    EventLevel.WARNING.value,
                    EventCode.DISPATCH_NO_DRONE_AVAILABLE.value,
                    f"No available drone for order {order.order_id}.",
                )
                continue

            agent = best_candidate["agent"]
            if agent.drone.pos is not None:
                agent.drone.node = self._current_grid_node(agent)
            raw_pickup_path = self._plan_path(agent.drone.node, order.pickup_node, agent.drone.altitude)
            pickup_path = self.graph.smooth_path(raw_pickup_path, agent.drone.altitude) if raw_pickup_path else []

            now = self._now_ms()
            mission_id = self._next_mission_id()
            mission = Mission(
                mission_id=mission_id,
                order_id=order.order_id,
                drone_id=agent.drone_id,
                pickup_node=order.pickup_node,
                dropoff_node=order.dropoff_node,
                status=MissionStatus.TO_PICKUP.value,
                pickup_path=pickup_path,
                created_at=now,
                updated_at=now,
                started_at=now,
            )
            self.missions[mission_id] = mission

            order.status = OrderStatus.GOING_TO_PICKUP.value
            order.assigned_drone_id = agent.drone_id
            order.mission_id = mission_id
            order.updated_at = now

            agent.current_order_id = order.order_id
            agent.current_mission_id = mission_id
            agent.available = False
            agent.current_target_node = order.pickup_node
            agent.current_target_type = "pickup"

            if not pickup_path:
                self._fail_current_mission(agent, "No safe path to pickup.")
                self.queue_event(
                    agent.drone_id,
                    EventLevel.ERROR.value,
                    EventCode.DISPATCH_FAILED.value,
                    f"Dispatch failed for order {order.order_id}: no safe path to pickup.",
                )
                changed_orders.append(serialize_order(order))
                changed_missions.append(serialize_mission(mission))
                continue

            agent.path = pickup_path
            agent.path_index = 0
            agent.current_target_altitude = self._next_target_altitude(agent)
            agent.drone.status = DroneStatus.FLYING.value

            assigned_count += 1
            self.queue_order_update(order)
            self.queue_mission_update(mission)
            changed_orders.append(serialize_order(order))
            changed_missions.append(serialize_mission(mission))
            self.queue_event(
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.MISSION_STARTED.value,
                f"Mission {mission_id} started for order {order.order_id}.",
            )
            self.queue_event(
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.DISPATCH_ASSIGNED.value,
                f"Order {order.order_id} assigned to {agent.drone_id} as {mission_id}.",
            )
            self.queue_event(
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.MISSION_CREATED.value,
                f"Mission {mission_id} created for order {order.order_id}.",
            )
            self.queue_event(
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.MISSION_TO_PICKUP.value,
                f"{agent.drone_id} flying to pickup for order {order.order_id}.",
            )

        return {
            "orders": changed_orders,
            "missions": changed_missions,
            "assignedCount": assigned_count,
        }

    def receive_order_batch(self, orders_payload, auto_dispatch=True):
        raw_orders = self._normalize_order_payloads(orders_payload)
        accepted = []
        now = self._now_ms()
        normal_altitude = float(self.config.get("drone", {}).get("normal_altitude", 20.0))
        max_payload_kg = float(self.config.get("drone", {}).get("max_payload_kg", 5.0))

        self.queue_event(
            "system",
            EventLevel.INFO.value,
            EventCode.ORDER_BATCH_RECEIVED.value,
            f"Order batch received: {len(raw_orders)} order(s).",
        )

        for raw in raw_orders:
            errors = []
            if not isinstance(raw, dict):
                raw = {"orderId": self._next_order_id(), "_batch_error": "order payload must be an object."}

            order_id = raw.get("orderId") or raw.get("order_id") or self._next_order_id()
            pickup = raw.get("pickup")
            dropoff = raw.get("dropoff")
            payload_value = raw.get("payloadKg", raw.get("payload_kg"))
            priority = str(raw.get("priority", "normal") or "normal")
            deadline_ts = raw.get("deadlineTs", raw.get("deadline_ts"))

            if raw.get("_batch_error"):
                errors.append(raw["_batch_error"])
            if pickup is None:
                errors.append("pickup is required.")
            if dropoff is None:
                errors.append("dropoff is required.")
            if payload_value is None:
                errors.append("payloadKg is required.")

            payload_kg = 0.0
            if payload_value is not None:
                if self._is_finite_number(payload_value):
                    payload_kg = float(payload_value)
                    if payload_kg <= 0:
                        errors.append("payloadKg must be greater than 0.")
                    elif payload_kg > max_payload_kg:
                        errors.append(f"payloadKg must be <= {max_payload_kg}.")
                else:
                    errors.append("payloadKg must be a finite number.")

            normalized_deadline = None
            if deadline_ts is not None:
                if self._is_finite_number(deadline_ts):
                    normalized_deadline = int(deadline_ts)
                else:
                    errors.append("deadlineTs must be a finite number when provided.")

            pickup_node = self._validate_latlng_node(pickup, "pickup", normal_altitude, errors) if pickup is not None else None
            dropoff_node = self._validate_latlng_node(dropoff, "dropoff", normal_altitude, errors) if dropoff is not None else None

            status = OrderStatus.FAILED.value if errors else OrderStatus.PENDING.value
            order = DeliveryOrder(
                order_id=str(order_id),
                pickup=list(pickup) if isinstance(pickup, (list, tuple)) else [],
                dropoff=list(dropoff) if isinstance(dropoff, (list, tuple)) else [],
                payload_kg=payload_kg,
                priority=priority,
                deadline_ts=normalized_deadline,
                status=status,
                pickup_node=pickup_node,
                dropoff_node=dropoff_node,
                validation_errors=errors,
                created_at=now,
                updated_at=now,
            )
            self.orders[order.order_id] = order

            if errors:
                self.queue_event(
                    order.order_id,
                    EventLevel.WARNING.value,
                    EventCode.ORDER_REJECTED.value,
                    f"Order {order.order_id} rejected: {'; '.join(errors)}",
                )
            else:
                self.queue_event(
                    order.order_id,
                    EventLevel.INFO.value,
                    EventCode.ORDER_ACCEPTED.value,
                    f"Order {order.order_id} accepted.",
                )
            accepted.append(serialize_order(order))

        dispatch_result = {
            "orders": [],
            "missions": [],
            "assignedCount": 0,
        }
        if auto_dispatch:
            dispatch_result = self.dispatch_pending_orders()

        self.queue_event(
            "system",
            EventLevel.INFO.value,
            EventCode.ORDER_STATE_UPDATED.value,
            f"Order state updated: {len(self.orders)} stored order(s).",
        )
        return {
            "orders": accepted + dispatch_result["orders"],
            "missions": dispatch_result["missions"],
            "assignedCount": dispatch_result["assignedCount"],
        }

    def get_order_state(self):
        return {
            "orders": [serialize_order(order) for order in self.orders.values()],
            "missions": [serialize_mission(mission) for mission in self.missions.values()],
        }

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
        if agent.current_target_type == "idle":
            agent.path = []
            agent.path_index = 0
            agent.current_target_node = agent.drone.node
            agent.current_target_altitude = agent.drone.altitude
            agent.drone.status = DroneStatus.IDLE.value
            return True

        raw_path = self._plan_path(
            agent.drone.node,
            agent.current_target_node,
            agent.drone.altitude,
        )
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

    def _fail_current_mission(self, agent, reason):
        now = self._now_ms()
        order = self.orders.get(agent.current_order_id) if agent.current_order_id else None
        mission = self.missions.get(agent.current_mission_id) if agent.current_mission_id else None

        if order:
            order.status = OrderStatus.FAILED.value
            order.failed_reason = reason
            order.updated_at = now
            self.queue_order_update(order)
            self.queue_event(
                order.order_id,
                EventLevel.ERROR.value,
                EventCode.ORDER_FAILED.value,
                f"Order {order.order_id} failed: {reason}",
            )

        if mission:
            mission.status = MissionStatus.FAILED.value
            mission.failed_reason = reason
            mission.updated_at = now
            self.queue_mission_update(mission)
            self.queue_event(
                mission.drone_id or agent.drone_id,
                EventLevel.ERROR.value,
                EventCode.MISSION_FAILED.value,
                f"Mission {mission.mission_id} failed: {reason}",
            )

        agent.drone.payload_weight = 0.0
        agent.available = True
        agent.current_order_id = None
        agent.current_mission_id = None
        agent.current_target_node = agent.drone.node
        agent.current_target_type = "idle"
        agent.path = []
        agent.path_index = 0
        agent.drone.status = DroneStatus.IDLE.value
        agent.return_target_node_after_charging = None
        agent.return_target_type_after_charging = None

    def _handle_pickup_arrival(self, agent):
        order = self.orders.get(agent.current_order_id)
        mission = self.missions.get(agent.current_mission_id)
        if not order or not mission:
            self._fail_current_mission(agent, "Mission state missing at pickup.")
            return

        now = self._now_ms()
        order.status = OrderStatus.PICKED_UP.value
        order.updated_at = now
        mission.status = MissionStatus.PICKUP_ARRIVED.value
        mission.updated_at = now
        agent.drone.payload_weight = float(order.payload_kg)
        self.queue_order_update(order)
        self.queue_mission_update(mission)
        self.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.PICKUP_ARRIVED.value, f"Pickup reached for order {order.order_id}.")
        self.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.PACKAGE_PICKED_UP.value, f"Package picked up for order {order.order_id}.")

        order.status = OrderStatus.DELIVERING.value
        order.updated_at = now
        mission.status = MissionStatus.TO_DROPOFF.value
        mission.updated_at = now
        agent.current_target_node = order.dropoff_node
        agent.current_target_type = "dropoff"
        agent.drone.node = order.pickup_node
        raw_path = self._plan_path(agent.drone.node, order.dropoff_node, agent.drone.altitude)
        dropoff_path = self.graph.smooth_path(raw_path, agent.drone.altitude) if raw_path else []
        mission.dropoff_path = dropoff_path

        if not dropoff_path:
            self._fail_current_mission(agent, "No safe path from pickup to dropoff.")
            return

        agent.path = dropoff_path
        agent.path_index = 0
        agent.current_target_altitude = self._next_target_altitude(agent)
        agent.drone.status = DroneStatus.FLYING.value
        self.queue_order_update(order)
        self.queue_mission_update(mission)
        self.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.MISSION_TO_DROPOFF.value, f"{agent.drone_id} flying to dropoff for order {order.order_id}.")

    def _handle_dropoff_arrival(self, agent):
        order = self.orders.get(agent.current_order_id)
        mission = self.missions.get(agent.current_mission_id)
        if not order or not mission:
            self._fail_current_mission(agent, "Mission state missing at dropoff.")
            return

        now = self._now_ms()
        order.status = OrderStatus.COMPLETED.value
        order.completed_at = now
        order.updated_at = now
        mission.status = MissionStatus.COMPLETED.value
        mission.completed_at = now
        mission.updated_at = now

        agent.drone.payload_weight = 0.0
        agent.current_order_id = None
        agent.current_mission_id = None
        agent.available = True
        agent.current_target_type = "idle"
        agent.current_target_node = agent.drone.node
        agent.path = []
        agent.path_index = 0
        agent.drone.status = DroneStatus.IDLE.value
        agent.return_target_node_after_charging = None
        agent.return_target_type_after_charging = None

        self.queue_order_update(order)
        self.queue_mission_update(mission)
        self.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.DROPOFF_ARRIVED.value, f"Dropoff reached for order {order.order_id}.")
        self.queue_event(order.order_id, EventLevel.SUCCESS.value, EventCode.ORDER_COMPLETED.value, f"Order {order.order_id} completed.")
        self.dispatch_pending_orders()

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

    def add_no_fly_zone(self, latlng, radius, height=None):
        if not isinstance(latlng, (list, tuple)) or len(latlng) != 2:
            raise ValueError("No-fly zone center must be a [lat, lon] pair.")
        radius_value = float(radius)
        if not math.isfinite(radius_value) or radius_value <= 0:
            raise ValueError("No-fly zone radius must be a positive number.")

        height_value = float("inf") if height is None else float(height)
        if not math.isinf(height_value) and (not math.isfinite(height_value) or height_value <= 0):
            raise ValueError("No-fly zone height must be a positive number.")

        pos_utm = self.graph.latlng_to_utm(latlng)
        self.no_fly_zones.append({
            "center": [float(latlng[0]), float(latlng[1])],
            "pos": pos_utm,
            "radius": radius_value,
            "height": height_value,
        })
        self.graph.add_dynamic_no_fly_zone(pos_utm, radius_value, height_value)
        self.queue_event(
            "system",
            EventLevel.WARNING.value,
            EventCode.NO_FLY_ZONE_ADDED.value,
            f"No-fly zone added: r={radius_value:.1f}m h={'full' if math.isinf(height_value) else f'{height_value:.1f}m'}.",
        )

        replanned = []
        failed = []
        for agent in self.get_agents():
            is_active = (
                agent.current_target_type != "idle"
                or agent.current_order_id is not None
                or agent.current_mission_id is not None
            )
            if not is_active or agent.drone.status in TERMINAL_STATUSES or agent.drone.status == DroneStatus.CHARGING.value:
                continue

            was_paused = agent.drone.status == DroneStatus.PAUSED.value
            agent.drone.node = self._current_grid_node(agent)
            if not was_paused:
                agent.drone.status = DroneStatus.PLANNING.value

            if self._replan_agent(agent, EventCode.NO_FLY_ZONE_REPLAN.value, "Path replanned after no-fly zone update."):
                if was_paused:
                    agent.drone.status = DroneStatus.PAUSED.value
                replanned.append(agent.drone_id)
            else:
                failed.append(agent.drone_id)
                self.queue_event(
                    agent.drone_id,
                    EventLevel.ERROR.value,
                    EventCode.NO_FLY_ZONE_REPLAN_FAILED.value,
                    "No safe path after no-fly zone update.",
                )

        return {
            "replanned": replanned,
            "failed": failed,
        }

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
                if agent.current_mission_id:
                    self._fail_current_mission(agent, "No safe path after obstacle detection.")
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
                agent.drone_id,
                EventLevel.INFO.value,
                EventCode.PATH_REPLANNED.value,
                f"Low battery: rerouting to charging station, cost={station_cost:.1f}.",
            )
        else:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            if agent.current_mission_id:
                self._fail_current_mission(agent, "Low battery and no reachable charging station.")
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Low battery and no reachable charging station.")

    def _horizontal_distance(self, first, second):
        return float(np.hypot(
            first.drone.pos[0] - second.drone.pos[0],
            first.drone.pos[1] - second.drone.pos[1],
        ))

    def _vertical_distance(self, first, second):
        return abs(float(first.drone.altitude or 0.0) - float(second.drone.altitude or 0.0))

    def _choose_yielding_agent(self, first, second):
        first_loaded = bool(first.drone.payload_weight > 0 or first.current_target_type == "dropoff")
        second_loaded = bool(second.drone.payload_weight > 0 or second.current_target_type == "dropoff")
        if first_loaded != second_loaded:
            return second if first_loaded else first
        return max((first, second), key=lambda agent: agent.drone_id)

    def _movement_vector(self, agent):
        if agent.drone.pos is None:
            return None
        if agent.path and agent.path_index < len(agent.path) - 1:
            next_node = self._path_node(agent.path[agent.path_index + 1])
            if next_node in self.graph.nodes:
                x2, y2 = self.graph.nodes[next_node]
                dx = x2 - agent.drone.pos[0]
                dy = y2 - agent.drone.pos[1]
                dist = float(np.hypot(dx, dy))
                if dist > 1e-6:
                    return (dx / dist, dy / dist)
        heading = float(agent.drone.heading or 0.0)
        rad = math.radians(heading)
        return (math.cos(rad), math.sin(rad))

    def _relative_heading_deg(self, first, second):
        first_vector = self._movement_vector(first)
        second_vector = self._movement_vector(second)
        if not first_vector or not second_vector:
            return 0.0
        dot = max(-1.0, min(1.0, first_vector[0] * second_vector[0] + first_vector[1] * second_vector[1]))
        return float(math.degrees(math.acos(dot)))

    def _estimate_closing_risk(self, first, second):
        current_distance = self._horizontal_distance(first, second)
        detection_range = max(self.warning_distance, self.sensor_range, self.collision_detection_range)
        if current_distance > detection_range:
            return False

        first_vector = self._movement_vector(first)
        second_vector = self._movement_vector(second)
        if not first_vector or not second_vector:
            return False

        speed_factor = rain_factor(self.is_raining)["speed_factor"]
        first_speed = max(0.0, float(first.drone.speed) * speed_factor)
        second_speed = max(0.0, float(second.drone.speed) * speed_factor)
        if first_speed <= 0 and second_speed <= 0:
            return False

        first_pos = np.array(first.drone.pos, dtype=float)
        second_pos = np.array(second.drone.pos, dtype=float)
        first_velocity = np.array(first_vector, dtype=float) * first_speed
        second_velocity = np.array(second_vector, dtype=float) * second_speed

        for step in range(1, self.collision_prediction_steps + 1):
            horizon = self.time_step * step
            predicted_first = first_pos + first_velocity * horizon
            predicted_second = second_pos + second_velocity * horizon
            predicted_distance = float(np.hypot(*(predicted_first - predicted_second)))
            if predicted_distance < current_distance - 0.5 or predicted_distance <= self.safety_distance:
                return True
        return False

    def _is_head_on_or_converging(self, first, second):
        return self._relative_heading_deg(first, second) >= 135.0 or self._estimate_closing_risk(first, second)

    def _is_agent_collision_candidate(self, agent):
        return (
            agent.drone.status == DroneStatus.FLYING.value
            and agent.drone.pos is not None
            and agent.drone.status not in {
                DroneStatus.IDLE.value,
                DroneStatus.FAILED.value,
                DroneStatus.EMERGENCY_LANDING.value,
            }
        )

    def _set_collision_state(self, agent, state, peer_id=None, distance=None, action=None, reason=None):
        severity = {
            "clear": 0,
            "proximity_warning": 1,
            "continue_priority": 1,
            "vertical_separated": 2,
            "climbing_avoidance": 3,
            "yielding_hold": 4,
        }
        current = getattr(agent, "collision_state", "clear") or "clear"
        if severity.get(state, 0) < severity.get(current, 0):
            return
        agent.collision_state = state
        agent.collision_peer_id = peer_id
        agent.collision_distance_m = float(distance) if distance is not None else None
        agent.collision_action = action
        if reason is not None:
            agent.collision_avoidance_reason = reason

    def _queue_collision_event(self, agent, peer_agent, distance, code, message, level=None):
        key = tuple(sorted((agent.drone_id, peer_agent.drone_id)) + [code])
        last_step = self.proximity_cooldowns.get(key, -9999)
        if self.step_count - last_step < 25:
            return
        self.queue_event(
            agent.drone_id,
            level or EventLevel.WARNING.value,
            code,
            message.format(other_id=peer_agent.drone_id, distance=distance),
        )
        self.proximity_cooldowns[key] = self.step_count

    def _queue_proximity_warning(self, yielding_agent, other_agent, distance, message):
        self._queue_collision_event(
            yielding_agent,
            other_agent,
            distance,
            EventCode.DRONE_PROXIMITY_WARNING.value,
            message,
        )

    def _nearby_path_nodes(self, agent, lookahead=3):
        nodes = [self._current_grid_node(agent)]
        if agent.path:
            end = min(len(agent.path), agent.path_index + 1 + lookahead)
            for point in agent.path[agent.path_index + 1:end]:
                node = self._path_node(point)
                if node not in nodes:
                    nodes.append(node)
        return nodes

    def _find_temporary_avoidance_altitude(self, agent):
        current_altitude = float(agent.drone.altitude or 0.0)
        max_altitude = float(self.config.get("drone", {}).get("max_altitude", current_altitude))
        candidates = [
            float(level)
            for level in getattr(self.graph, "altitude_levels", [])
            if float(level) >= current_altitude + self.vertical_separation and float(level) <= max_altitude
        ]
        for altitude in candidates:
            if all(self.graph.is_node_clear_at_altitude(node, altitude) for node in self._nearby_path_nodes(agent)):
                return altitude
        return None

    def _reset_collision_state_for_step(self):
        for agent in self.get_agents():
            agent.temp_speed_factor = 1.0
            agent.collision_avoidance_reason = None
            if agent.collision_avoidance_steps > 0:
                agent.collision_avoidance_steps -= 1
            if agent.collision_hold_steps > 0:
                agent.collision_hold_steps -= 1
                agent.temp_speed_factor = 0.0
                self._set_collision_state(
                    agent,
                    "yielding_hold",
                    agent.collision_peer_id,
                    agent.collision_distance_m,
                    "hold_position",
                    "collision_hold",
                )
            elif agent.collision_avoidance_steps > 0 and agent.temporary_avoidance_altitude is not None:
                agent.temp_speed_factor = min(agent.temp_speed_factor, 0.75)
                self._set_collision_state(
                    agent,
                    "climbing_avoidance",
                    agent.collision_peer_id,
                    agent.collision_distance_m,
                    "climb_to_avoid",
                    agent.collision_avoidance_reason or "collision_climb",
                )
            else:
                agent.collision_state = "clear"
                agent.collision_peer_id = None
                agent.collision_distance_m = None
                agent.collision_action = None
                agent.temporary_avoidance_altitude = None

    def _apply_collision_avoidance(self):
        self._reset_collision_state_for_step()

        active = [
            agent for agent in self.get_agents()
            if self._is_agent_collision_candidate(agent)
        ]
        active.sort(key=lambda item: item.drone_id)
        for idx, first in enumerate(active):
            for second in active[idx + 1:]:
                vertical_distance = self._vertical_distance(first, second)
                dist = self._horizontal_distance(first, second)
                detection_range = max(self.warning_distance, self.sensor_range, self.collision_detection_range)
                if dist >= detection_range:
                    continue

                if vertical_distance >= self.vertical_separation:
                    self._set_collision_state(first, "vertical_separated", second.drone_id, dist, None)
                    self._set_collision_state(second, "vertical_separated", first.drone_id, dist, None)
                    self._queue_collision_event(
                        first,
                        second,
                        dist,
                        EventCode.DRONE_COLLISION_VERTICAL_SEPARATED.value,
                        "Vertical separation from {other_id}: {distance:.1f}m horizontal.",
                        EventLevel.INFO.value,
                    )
                    continue

                is_closing = self._estimate_closing_risk(first, second)
                is_head_on_or_converging = self._is_head_on_or_converging(first, second)
                if dist >= self.warning_distance and not is_closing:
                    continue

                yielding_agent = self._choose_yielding_agent(first, second)
                other_agent = second if yielding_agent is first else first

                if self.collision_prefer_climb and is_head_on_or_converging:
                    avoidance_altitude = self._find_temporary_avoidance_altitude(yielding_agent)
                    if avoidance_altitude is not None:
                        yielding_agent.temporary_avoidance_altitude = avoidance_altitude
                        yielding_agent.collision_avoidance_steps = max(
                            yielding_agent.collision_avoidance_steps,
                            self.collision_climb_steps,
                        )
                        yielding_agent.temp_speed_factor = min(yielding_agent.temp_speed_factor, 0.75)
                        self._set_collision_state(
                            yielding_agent,
                            "climbing_avoidance",
                            other_agent.drone_id,
                            dist,
                            "climb_to_avoid",
                            f"climbing_to_avoid_{other_agent.drone_id}",
                        )
                        self._set_collision_state(
                            other_agent,
                            "continue_priority",
                            yielding_agent.drone_id,
                            dist,
                            "continue_priority",
                            f"priority_over_{yielding_agent.drone_id}",
                        )
                        self._queue_collision_event(
                            yielding_agent,
                            other_agent,
                            dist,
                            EventCode.DRONE_COLLISION_CLIMB.value,
                            "Climbing to avoid collision with {other_id}: {distance:.1f}m.",
                        )
                        continue

                if dist < self.safety_distance:
                    yielding_agent.collision_hold_steps = max(
                        yielding_agent.collision_hold_steps,
                        self.collision_hold_steps,
                    )
                    yielding_agent.temp_speed_factor = 0.0
                    self._set_collision_state(
                        yielding_agent,
                        "yielding_hold",
                        other_agent.drone_id,
                        dist,
                        "hold_position",
                        f"holding_to_avoid_{other_agent.drone_id}",
                    )
                    self._set_collision_state(
                        other_agent,
                        "continue_priority",
                        yielding_agent.drone_id,
                        dist,
                        "continue_priority",
                        f"priority_over_{yielding_agent.drone_id}",
                    )
                    self._queue_collision_event(
                        yielding_agent,
                        other_agent,
                        dist,
                        EventCode.DRONE_COLLISION_HOLD.value,
                        "Holding to avoid collision with {other_id}: {distance:.1f}m.",
                    )
                    continue

                yielding_agent.temp_speed_factor = min(yielding_agent.temp_speed_factor, 0.45)
                self._set_collision_state(
                    yielding_agent,
                    "proximity_warning",
                    other_agent.drone_id,
                    dist,
                    "slow_down",
                    f"slowing_to_avoid_{other_agent.drone_id}",
                )
                self._set_collision_state(
                    other_agent,
                    "continue_priority",
                    yielding_agent.drone_id,
                    dist,
                    "continue_priority",
                    f"priority_over_{yielding_agent.drone_id}",
                )
                self._queue_proximity_warning(
                    yielding_agent,
                    other_agent,
                    dist,
                    "Close to {other_id}: {distance:.1f}m. Slowing down to avoid collision.",
                )

    def _apply_proximity_slowdown(self):
        self._apply_collision_avoidance()

    def _move_agent(self, agent, dt):
        agent.altitude_change_rate = 0.0
        agent.last_climbing = False

        if agent.path and agent.path_index < len(agent.path) - 1:
            next_point = agent.path[agent.path_index + 1]
            next_node = self._path_node(next_point)
            path_target_altitude = self._path_altitude(next_point, agent.drone.altitude)
            target_altitude = path_target_altitude
            if agent.temporary_avoidance_altitude is not None and agent.collision_avoidance_steps > 0:
                target_altitude = max(target_altitude, float(agent.temporary_avoidance_altitude))
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
            if agent.current_mission_id:
                self._fail_current_mission(agent, "Battery depleted.")
            self.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Battery depleted. Emergency landing.")

        agent.drone.update_temperature(dt, self.ambient_temp)

    def _has_active_work(self):
        active_order_statuses = {
            OrderStatus.PENDING.value,
            OrderStatus.ASSIGNED.value,
            OrderStatus.GOING_TO_PICKUP.value,
            OrderStatus.PICKED_UP.value,
            OrderStatus.DELIVERING.value,
        }
        active_mission_statuses = {
            MissionStatus.PLANNED.value,
            MissionStatus.TO_PICKUP.value,
            MissionStatus.PICKUP_ARRIVED.value,
            MissionStatus.TO_DROPOFF.value,
        }
        return (
            any(order.status in active_order_statuses for order in self.orders.values())
            or any(mission.status in active_mission_statuses for mission in self.missions.values())
        )

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
            terminal_order_statuses = {
                OrderStatus.COMPLETED.value,
                OrderStatus.FAILED.value,
                OrderStatus.CANCELED.value,
            }
            active_mission_statuses = {
                MissionStatus.PLANNED.value,
                MissionStatus.TO_PICKUP.value,
                MissionStatus.PICKUP_ARRIVED.value,
                MissionStatus.TO_DROPOFF.value,
            }
            return (
                all(order.status in terminal_order_statuses for order in self.orders.values())
                and not any(mission.status in active_mission_statuses for mission in self.missions.values())
            )
        return all(agent.drone.status in TERMINAL_STATUSES for agent in self.get_agents())

    def final_status(self):
        if self.orders:
            terminal_order_statuses = {
                OrderStatus.COMPLETED.value,
                OrderStatus.FAILED.value,
                OrderStatus.CANCELED.value,
            }
            active_mission_statuses = {
                MissionStatus.PLANNED.value,
                MissionStatus.TO_PICKUP.value,
                MissionStatus.PICKUP_ARRIVED.value,
                MissionStatus.TO_DROPOFF.value,
            }
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
