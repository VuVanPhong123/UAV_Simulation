import math

import numpy as np

from models.statuses import DroneStatus, EventCode, EventLevel
from physics.energy import rain_factor


class CollisionSystem:
    def __init__(self, config, graph):
        simulation_config = config.get("simulation", {})
        self.safety_distance = float(simulation_config.get("drone_safety_distance", 15.0))
        warning_default = max(self.safety_distance * 2, 25.0)
        self.warning_distance = float(simulation_config.get("drone_warning_distance", warning_default))
        self.vertical_separation = float(simulation_config.get("drone_vertical_separation", 8.0))
        self.collision_hold_steps = int(simulation_config.get("drone_collision_hold_steps", 4))
        sensor_range = float(config.get("obstacle_avoidance", {}).get("sensor_range", 30.0))
        self.collision_detection_range = float(
            simulation_config.get(
                "drone_collision_detection_range",
                max(self.warning_distance, sensor_range),
            )
        )
        self.collision_prediction_steps = max(1, int(simulation_config.get("drone_collision_prediction_steps", 3)))
        self.collision_climb_steps = max(1, int(simulation_config.get("drone_collision_climb_steps", 10)))
        self.collision_prefer_climb = bool(simulation_config.get("drone_collision_prefer_climb", True))
        self.sensor_range = sensor_range
        self.graph = graph
        self.config = config

    def apply(self, world):
        self._apply_collision_avoidance(world)

    # ── geometry helpers ──────────────────────────────────────────────────────

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
            next_point = agent.path[agent.path_index + 1]
            next_node = next_point["node"] if isinstance(next_point, dict) else next_point
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

    def _estimate_closing_risk(self, first, second, world):
        current_distance = self._horizontal_distance(first, second)
        detection_range = max(self.warning_distance, self.sensor_range, self.collision_detection_range)
        if current_distance > detection_range:
            return False

        first_vector = self._movement_vector(first)
        second_vector = self._movement_vector(second)
        if not first_vector or not second_vector:
            return False

        speed_factor = rain_factor(world.is_raining)["speed_factor"]
        first_speed = max(0.0, float(first.drone.speed) * speed_factor)
        second_speed = max(0.0, float(second.drone.speed) * speed_factor)
        if first_speed <= 0 and second_speed <= 0:
            return False

        first_pos = np.array(first.drone.pos, dtype=float)
        second_pos = np.array(second.drone.pos, dtype=float)
        first_velocity = np.array(first_vector, dtype=float) * first_speed
        second_velocity = np.array(second_vector, dtype=float) * second_speed

        for step in range(1, self.collision_prediction_steps + 1):
            horizon = world.time_step * step
            predicted_first = first_pos + first_velocity * horizon
            predicted_second = second_pos + second_velocity * horizon
            predicted_distance = float(np.hypot(*(predicted_first - predicted_second)))
            if predicted_distance < current_distance - 0.5 or predicted_distance <= self.safety_distance:
                return True
        return False

    def _is_head_on_or_converging(self, first, second, world):
        return self._relative_heading_deg(first, second) >= 135.0 or self._estimate_closing_risk(first, second, world)

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

    # ── state management ──────────────────────────────────────────────────────

    def _set_collision_state(self, agent, state, peer_id=None, distance=None, action=None, reason=None):
        severity = {
            "clear": 0,
            "proximity_warning": 1,
            "continue_priority": 1,
            "vertical_separated": 2,
            "climbing_avoidance": 3,
            "yielding_hold": 4,
        }
        current = agent.collision.state or "clear"
        if severity.get(state, 0) < severity.get(current, 0):
            return
        agent.collision.state = state
        agent.collision.peer_id = peer_id
        agent.collision.distance_m = float(distance) if distance is not None else None
        agent.collision.action = action
        if reason is not None:
            agent.collision.avoidance_reason = reason

    def _queue_collision_event(self, world, agent, peer_agent, distance, code, message, level=None):
        key = tuple(sorted((agent.drone_id, peer_agent.drone_id)) + [code])
        last_step = world.proximity_cooldowns.get(key, -9999)
        if world.step_count - last_step < 25:
            return
        world.queue_event(
            agent.drone_id,
            level or EventLevel.WARNING.value,
            code,
            message.format(other_id=peer_agent.drone_id, distance=distance),
        )
        world.proximity_cooldowns[key] = world.step_count

    def _queue_proximity_warning(self, world, yielding_agent, other_agent, distance, message):
        self._queue_collision_event(
            world,
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
                node = point["node"] if isinstance(point, dict) else point
                if node not in nodes:
                    nodes.append(node)
        return nodes

    def _current_grid_node(self, agent):
        cx = int(round((agent.drone.pos[0] - self.graph.min_x) / self.graph.resolution))
        cy = int(round((agent.drone.pos[1] - self.graph.min_y) / self.graph.resolution))
        cx = max(0, min(self.graph.cols - 1, cx))
        cy = max(0, min(self.graph.rows - 1, cy))
        return (cx, cy)

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

    # ── main step logic ───────────────────────────────────────────────────────

    def _reset_collision_state_for_step(self, world):
        for agent in world.get_agents():
            agent.temp_speed_factor = 1.0
            agent.collision.avoidance_reason = None
            if agent.collision.avoidance_steps > 0:
                agent.collision.avoidance_steps -= 1
            if agent.collision.hold_steps > 0:
                agent.collision.hold_steps -= 1
                agent.temp_speed_factor = 0.0
                self._set_collision_state(
                    agent,
                    "yielding_hold",
                    agent.collision.peer_id,
                    agent.collision.distance_m,
                    "hold_position",
                    "collision_hold",
                )
            elif agent.collision.avoidance_steps > 0 and agent.collision.temporary_altitude is not None:
                agent.temp_speed_factor = min(agent.temp_speed_factor, 0.75)
                self._set_collision_state(
                    agent,
                    "climbing_avoidance",
                    agent.collision.peer_id,
                    agent.collision.distance_m,
                    "climb_to_avoid",
                    agent.collision.avoidance_reason or "collision_climb",
                )
            else:
                agent.collision.state = "clear"
                agent.collision.peer_id = None
                agent.collision.distance_m = None
                agent.collision.action = None
                agent.collision.temporary_altitude = None

    def _apply_collision_avoidance(self, world):
        self._reset_collision_state_for_step(world)

        active = [
            agent for agent in world.get_agents()
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
                        world,
                        first,
                        second,
                        dist,
                        EventCode.DRONE_COLLISION_VERTICAL_SEPARATED.value,
                        "Vertical separation from {other_id}: {distance:.1f}m horizontal.",
                        EventLevel.INFO.value,
                    )
                    continue

                is_closing = self._estimate_closing_risk(first, second, world)
                is_head_on_or_converging = self._is_head_on_or_converging(first, second, world)
                if dist >= self.warning_distance and not is_closing:
                    continue

                yielding_agent = self._choose_yielding_agent(first, second)
                other_agent = second if yielding_agent is first else first

                if self.collision_prefer_climb and is_head_on_or_converging:
                    avoidance_altitude = self._find_temporary_avoidance_altitude(yielding_agent)
                    if avoidance_altitude is not None:
                        yielding_agent.collision.temporary_altitude = avoidance_altitude
                        yielding_agent.collision.avoidance_steps = max(
                            yielding_agent.collision.avoidance_steps,
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
                            world,
                            yielding_agent,
                            other_agent,
                            dist,
                            EventCode.DRONE_COLLISION_CLIMB.value,
                            "Climbing to avoid collision with {other_id}: {distance:.1f}m.",
                        )
                        continue

                if dist < self.safety_distance:
                    yielding_agent.collision.hold_steps = max(
                        yielding_agent.collision.hold_steps,
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
                        world,
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
                    world,
                    yielding_agent,
                    other_agent,
                    dist,
                    "Close to {other_id}: {distance:.1f}m. Slowing down to avoid collision.",
                )
