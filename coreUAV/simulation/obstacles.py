import math

import numpy as np

from models.statuses import DroneStatus, EventCode, EventLevel
from physics.energy import rain_factor


_TERMINAL_STATUSES = {
    DroneStatus.SUCCESS.value,
    DroneStatus.FAILED.value,
    DroneStatus.EMERGENCY_LANDING.value,
}


def _distance_point_to_segment(point, a, b):
    px, py = point
    ax, ay = a
    bx, by = b
    abx = bx - ax
    aby = by - ay
    denom = abx * abx + aby * aby
    if denom <= 1e-9:
        return float(np.hypot(px - ax, py - ay)), 0.0
    t = ((px - ax) * abx + (py - ay) * aby) / denom
    t = max(0.0, min(1.0, t))
    cx = ax + t * abx
    cy = ay + t * aby
    return float(np.hypot(px - cx, py - cy)), t


def detect_obstacles(world, agent):
    """
    Scan world.obstacles for newly visible obstacles from agent's position.

    world must expose: obstacles (list of dicts with detected_by set and graph_added bool),
    sensor_range, sensor_lookahead_factor, detected_obstacle_buffer, is_raining, graph,
    _next_path_pos(agent), queue_event(drone_id, level, code, message).

    Returns True if any blocking obstacle was newly detected.
    """
    blocking_detected = False
    effective_sensor_range = world.sensor_range * rain_factor(world.is_raining)["sensor_factor"]
    lookahead_factor = getattr(world, "sensor_lookahead_factor", 1.0)
    detected_buffer = getattr(world, "detected_obstacle_buffer", 0.0)

    for obs in world.obstacles:
        if agent.drone_id in obs["detected_by"]:
            continue

        current_pos = agent.drone.pos
        obs_pos = obs["pos"]
        current_distance = float(np.hypot(current_pos[0] - obs_pos[0], current_pos[1] - obs_pos[1]))
        detected = current_distance <= effective_sensor_range + obs["radius"]

        if not detected:
            next_pos = world._next_path_pos(agent)
            if next_pos is not None:
                segment_distance, segment_t = _distance_point_to_segment(obs_pos, current_pos, next_pos)
                corridor_radius = obs["radius"] + world.graph.safety_margin
                if 0.0 <= segment_t <= 1.0 and segment_distance <= corridor_radius:
                    segment_length = float(np.hypot(next_pos[0] - current_pos[0], next_pos[1] - current_pos[1]))
                    projected_distance = segment_length * segment_t
                    lookahead_range = effective_sensor_range * lookahead_factor
                    if (
                        segment_length <= lookahead_range + corridor_radius
                        or projected_distance <= lookahead_range + corridor_radius
                    ):
                        detected = True

        if not detected:
            continue

        obs["detected_by"].add(agent.drone_id)
        if not obs["graph_added"]:
            effective_radius = obs["radius"] + detected_buffer
            world.graph.add_dynamic_obstacle(obs["pos"], effective_radius, obs["height"])
            obs["graph_added"] = True
        world.queue_event(
            agent.drone_id,
            EventLevel.WARNING.value,
            EventCode.OBSTACLE_DETECTED.value,
            f"Obstacle detected: {obs['type']} r={obs['radius']:.1f}m buffer={detected_buffer:.1f}m h={obs['height']:.1f}m.",
        )
        if agent.drone.altitude <= obs["height"] + world.graph.safety_margin:
            blocking_detected = True

    return blocking_detected


def handle_avoidance(world, agent, dt):
    """
    Check for blocking obstacles and trigger rerouting when found.

    world must additionally expose: avoid_duration, altitude_boost,
    _current_grid_node(agent), _replan_agent(agent, code, msg),
    _plan_path(start, goal, alt), _next_target_altitude(agent),
    _fail_current_mission(agent, reason).

    Returns True if avoidance is active (caller should skip normal movement this tick).
    """
    if agent.drone.status in _TERMINAL_STATUSES or agent.drone.status == DroneStatus.CHARGING.value:
        return False

    if not agent.avoiding:
        if not detect_obstacles(world, agent):
            return False
        agent.avoiding = True
        agent.avoid_timer = world.avoid_duration
        agent.drone.status = DroneStatus.REROUTING.value
        agent.drone.node = world._current_grid_node(agent)
        if world._replan_agent(agent, EventCode.PATH_REPLANNED.value, "Path replanned around obstacle."):
            return True

        boosted_altitude = min(agent.drone.max_altitude, agent.drone.altitude + world.altitude_boost)
        raw_path = world._plan_path(agent.drone.node, agent.current_target_node, boosted_altitude)
        if raw_path:
            agent.path = world.graph.smooth_path(raw_path, agent.drone.altitude)
            agent.path.insert(0, {"node": agent.drone.node, "altitude": float(agent.drone.altitude)})
            agent.path_index = 0
            agent.current_target_altitude = world._next_target_altitude(agent)
            agent.drone.status = DroneStatus.FLYING.value
            world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned after altitude pop-up.")
        else:
            agent.drone.status = DroneStatus.EMERGENCY_LANDING.value
            if agent.current_mission_id:
                world._fail_current_mission(agent, "No safe path after obstacle detection.")
            world.queue_event(agent.drone_id, EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "No safe path after obstacle detection.")
        return True
    else:
        agent.avoid_timer -= dt
        if agent.avoid_timer <= 0:
            agent.avoiding = False
    return False


def add_obstacle(world, latlng, radius=8.0, height=25.0, obstacle_type="unknown"):
    x, y = world.graph.transformer.transform(latlng[1], latlng[0])
    world.obstacles.append({
        "pos": (x, y),
        "radius": float(radius),
        "height": float(height),
        "type": obstacle_type,
        "detected_by": set(),
        "graph_added": False,
    })


def add_no_fly_zone(world, latlng, radius, height=None):
    if not isinstance(latlng, (list, tuple)) or len(latlng) != 2:
        raise ValueError("No-fly zone center must be a [lat, lon] pair.")
    radius_value = float(radius)
    if not math.isfinite(radius_value) or radius_value <= 0:
        raise ValueError("No-fly zone radius must be a positive number.")

    height_value = float("inf") if height is None else float(height)
    if not math.isinf(height_value) and (not math.isfinite(height_value) or height_value <= 0):
        raise ValueError("No-fly zone height must be a positive number.")

    pos_utm = world.graph.latlng_to_utm(latlng)
    world.no_fly_zones.append({
        "center": [float(latlng[0]), float(latlng[1])],
        "pos": pos_utm,
        "radius": radius_value,
        "height": height_value,
    })
    world.graph.add_dynamic_no_fly_zone(pos_utm, radius_value, height_value)
    world.queue_event(
        "system",
        EventLevel.WARNING.value,
        EventCode.NO_FLY_ZONE_ADDED.value,
        f"No-fly zone added: r={radius_value:.1f}m h={'full' if math.isinf(height_value) else f'{height_value:.1f}m'}.",
    )

    replanned = []
    failed = []
    for agent in world.get_agents():
        is_active = (
            agent.current_target_type != "idle"
            or agent.current_order_id is not None
            or agent.current_mission_id is not None
        )
        if not is_active or agent.drone.status in _TERMINAL_STATUSES or agent.drone.status == DroneStatus.CHARGING.value:
            continue

        was_paused = agent.drone.status == DroneStatus.PAUSED.value
        agent.drone.node = world._current_grid_node(agent)
        if not was_paused:
            agent.drone.status = DroneStatus.PLANNING.value

        if world._replan_agent(agent, EventCode.NO_FLY_ZONE_REPLAN.value, "Path replanned after no-fly zone update."):
            if was_paused:
                agent.drone.status = DroneStatus.PAUSED.value
            replanned.append(agent.drone_id)
        else:
            failed.append(agent.drone_id)
            world.queue_event(
                agent.drone_id,
                EventLevel.ERROR.value,
                EventCode.NO_FLY_ZONE_REPLAN_FAILED.value,
                "No safe path after no-fly zone update.",
            )

    return {"replanned": replanned, "failed": failed}
