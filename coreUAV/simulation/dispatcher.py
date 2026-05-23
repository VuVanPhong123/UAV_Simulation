import math
import time

import numpy as np

from dispatch_engine import dispatch_score
from models.order import DeliveryOrder, Mission, serialize_mission, serialize_order
from models.statuses import DroneStatus, EventCode, EventLevel, MissionStatus, OrderStatus


def _now_ms():
    return int(time.time() * 1000)


def _scoped_id_prefix(world, base):
    if world.drone_id_offset <= 0:
        return base
    return f"{base}_g{world.drone_id_offset + 1}"


def _next_order_id(world):
    prefix = _scoped_id_prefix(world, "order")
    while True:
        order_id = f"{prefix}_{world.order_seq}"
        world.order_seq += 1
        if order_id not in world.orders:
            return order_id


def _next_mission_id(world):
    prefix = _scoped_id_prefix(world, "mission")
    while True:
        mission_id = f"{prefix}_{world.mission_seq}"
        world.mission_seq += 1
        if mission_id not in world.missions:
            return mission_id


def _is_finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _validate_latlng_node(world, value, field_name, altitude, errors):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        errors.append(f"{field_name} must be a [lat, lon] pair.")
        return None
    if not _is_finite_number(value[0]) or not _is_finite_number(value[1]):
        errors.append(f"{field_name} must contain finite numeric lat/lon values.")
        return None
    try:
        if not world.graph.is_latlng_within_bounds(value, margin_cells=2):
            errors.append(f"{field_name} is outside supported map area.")
            return None
        node = world.graph.latlng_to_node(value)
    except Exception as exc:
        errors.append(f"{field_name} could not be mapped to graph: {exc}")
        return None
    if not world.graph.is_node_clear_at_altitude(node, altitude):
        clear_node = world.graph.find_nearest_clear_node(value, altitude, max_radius_cells=8)
        if clear_node != node and world.graph.is_node_clear_at_altitude(clear_node, altitude):
            world.queue_event(
                "system",
                EventLevel.WARNING.value,
                EventCode.ORDER_STATE_UPDATED.value,
                f"{field_name} snapped from blocked node {node} to nearest clear node {clear_node}.",
            )
            return clear_node
        errors.append(f"{field_name} maps to blocked node {node} at altitude {altitude}.")
        return node
    return node


def _normalize_order_payloads(world, orders_payload):
    if isinstance(orders_payload, dict) and isinstance(orders_payload.get("orders"), list):
        return orders_payload["orders"]
    if isinstance(orders_payload, list):
        return orders_payload
    if isinstance(orders_payload, dict) and ("pickup" in orders_payload or "dropoff" in orders_payload):
        return [orders_payload]
    return [{
        "orderId": _next_order_id(world),
        "_batch_error": "order batch must be a list or an object with an orders list.",
    }]


def get_available_agents(world):
    available_statuses = {
        DroneStatus.IDLE.value,
        DroneStatus.PLANNING.value,
        DroneStatus.FLYING.value,
        DroneStatus.SUCCESS.value,
    }
    return [
        agent for agent in world.get_agents()
        if agent.available
        and agent.current_mission_id is None
        and agent.drone.status in available_statuses
    ]


def _estimate_path_cost_between(world, start_node, goal_node, altitude):
    path = world.graph.a_star_2_5d(
        start_node,
        goal_node,
        current_altitude=altitude,
        wind_dir=world.wind_dir,
        wind_speed=world.wind_speed,
        ambient_temp=world.ambient_temp,
        is_raining=world.is_raining,
    )
    if not path:
        return None, float("inf")
    cost = world.graph.estimate_path_cost(
        path,
        altitude,
        world.wind_dir,
        world.wind_speed,
        world.ambient_temp,
        world.is_raining,
    )
    return path, cost


def fail_mission(world, agent, reason):
    now = _now_ms()
    order = world.orders.get(agent.current_order_id) if agent.current_order_id else None
    mission = world.missions.get(agent.current_mission_id) if agent.current_mission_id else None

    if order:
        order.status = OrderStatus.FAILED.value
        order.failed_reason = reason
        order.updated_at = now
        world.queue_order_update(order)
        world.queue_event(
            order.order_id,
            EventLevel.ERROR.value,
            EventCode.ORDER_FAILED.value,
            f"Order {order.order_id} failed: {reason}",
        )

    if mission:
        mission.status = MissionStatus.FAILED.value
        mission.failed_reason = reason
        mission.updated_at = now
        world.queue_mission_update(mission)
        world.queue_event(
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


def handle_pickup_arrival(world, agent):
    order = world.orders.get(agent.current_order_id)
    mission = world.missions.get(agent.current_mission_id)
    if not order or not mission:
        fail_mission(world, agent, "Mission state missing at pickup.")
        return

    now = _now_ms()
    order.status = OrderStatus.PICKED_UP.value
    order.updated_at = now
    mission.status = MissionStatus.PICKUP_ARRIVED.value
    mission.updated_at = now
    agent.drone.payload_weight = float(order.payload_kg)
    world.queue_order_update(order)
    world.queue_mission_update(mission)
    world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.PICKUP_ARRIVED.value, f"Pickup reached for order {order.order_id}.")
    world.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.PACKAGE_PICKED_UP.value, f"Package picked up for order {order.order_id}.")

    order.status = OrderStatus.DELIVERING.value
    order.updated_at = now
    mission.status = MissionStatus.TO_DROPOFF.value
    mission.updated_at = now
    agent.current_target_node = order.dropoff_node
    agent.current_target_type = "dropoff"
    agent.drone.node = order.pickup_node
    raw_path = world._plan_path(agent.drone.node, order.dropoff_node, agent.drone.altitude)
    dropoff_path = world.graph.smooth_path(raw_path, agent.drone.altitude) if raw_path else []
    mission.dropoff_path = dropoff_path

    if not dropoff_path:
        fail_mission(world, agent, "No safe path from pickup to dropoff.")
        return

    agent.path = dropoff_path
    agent.path_index = 0
    agent.current_target_altitude = world._next_target_altitude(agent)
    agent.drone.status = DroneStatus.FLYING.value
    world.queue_order_update(order)
    world.queue_mission_update(mission)
    world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.MISSION_TO_DROPOFF.value, f"{agent.drone_id} flying to dropoff for order {order.order_id}.")


def handle_dropoff_arrival(world, agent):
    order = world.orders.get(agent.current_order_id)
    mission = world.missions.get(agent.current_mission_id)
    if not order or not mission:
        fail_mission(world, agent, "Mission state missing at dropoff.")
        return

    now = _now_ms()
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

    world.queue_order_update(order)
    world.queue_mission_update(mission)
    world.queue_event(agent.drone_id, EventLevel.SUCCESS.value, EventCode.DROPOFF_ARRIVED.value, f"Dropoff reached for order {order.order_id}.")
    world.queue_event(order.order_id, EventLevel.SUCCESS.value, EventCode.ORDER_COMPLETED.value, f"Order {order.order_id} completed.")
    dispatch_pending_orders(world)


def dispatch_pending_orders(world):
    changed_orders = []
    changed_missions = []
    assigned_count = 0
    pending_orders = [
        order for order in world.orders.values()
        if order.status == OrderStatus.PENDING.value and not order.validation_errors
    ]
    max_payload_kg = float(world.config.get("drone", {}).get("max_payload_kg", 5.0))

    world.queue_event(
        "system",
        EventLevel.INFO.value,
        EventCode.DISPATCH_STARTED.value,
        f"Dispatch started for {len(pending_orders)} pending order(s).",
    )

    for order in pending_orders:
        best_candidate = None
        for agent in get_available_agents(world):
            if order.payload_kg > max_payload_kg:
                continue
            if agent.drone.battery < agent.drone.low_threshold:
                continue

            altitude = float(agent.drone.altitude or world.config.get("drone", {}).get("normal_altitude", 20.0))
            _, cost_to_pickup = _estimate_path_cost_between(world, agent.drone.node, order.pickup_node, altitude)
            if not np.isfinite(cost_to_pickup):
                continue
            _, cost_delivery = _estimate_path_cost_between(world, order.pickup_node, order.dropoff_node, altitude)
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
                best_candidate = {"agent": agent, "score": score}

        if best_candidate is None:
            world.queue_event(
                "system",
                EventLevel.WARNING.value,
                EventCode.DISPATCH_NO_DRONE_AVAILABLE.value,
                f"No available drone for order {order.order_id}.",
            )
            continue

        agent = best_candidate["agent"]
        if agent.drone.pos is not None:
            agent.drone.node = world._current_grid_node(agent)
        raw_pickup_path = world._plan_path(agent.drone.node, order.pickup_node, agent.drone.altitude)
        pickup_path = world.graph.smooth_path(raw_pickup_path, agent.drone.altitude) if raw_pickup_path else []
        if not pickup_path:
            world.queue_event(
                agent.drone_id,
                EventLevel.WARNING.value,
                EventCode.DISPATCH_NO_DRONE_AVAILABLE.value,
                f"Dispatch skipped for order {order.order_id}: no current safe path to pickup.",
            )
            continue

        now = _now_ms()
        mission_id = _next_mission_id(world)
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
        world.missions[mission_id] = mission

        order.status = OrderStatus.GOING_TO_PICKUP.value
        order.assigned_drone_id = agent.drone_id
        order.mission_id = mission_id
        order.updated_at = now

        agent.current_order_id = order.order_id
        agent.current_mission_id = mission_id
        agent.available = False
        agent.current_target_node = order.pickup_node
        agent.current_target_type = "pickup"
        agent.path = pickup_path
        agent.path_index = 0
        agent.current_target_altitude = world._next_target_altitude(agent)
        agent.drone.status = DroneStatus.FLYING.value

        assigned_count += 1
        world.queue_order_update(order)
        world.queue_mission_update(mission)
        changed_orders.append(serialize_order(order))
        changed_missions.append(serialize_mission(mission))
        world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.MISSION_STARTED.value, f"Mission {mission_id} started for order {order.order_id}.")
        world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.DISPATCH_ASSIGNED.value, f"Order {order.order_id} assigned to {agent.drone_id} as {mission_id}.")
        world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.MISSION_CREATED.value, f"Mission {mission_id} created for order {order.order_id}.")
        world.queue_event(agent.drone_id, EventLevel.INFO.value, EventCode.MISSION_TO_PICKUP.value, f"{agent.drone_id} flying to pickup for order {order.order_id}.")

    return {
        "orders": changed_orders,
        "missions": changed_missions,
        "assignedCount": assigned_count,
    }


def receive_order_batch(world, orders_payload, auto_dispatch=True):
    raw_orders = _normalize_order_payloads(world, orders_payload)
    accepted = []
    now = _now_ms()
    normal_altitude = float(world.config.get("drone", {}).get("normal_altitude", 20.0))
    max_payload_kg = float(world.config.get("drone", {}).get("max_payload_kg", 5.0))

    world.queue_event(
        "system",
        EventLevel.INFO.value,
        EventCode.ORDER_BATCH_RECEIVED.value,
        f"Order batch received: {len(raw_orders)} order(s).",
    )

    for raw in raw_orders:
        errors = []
        if not isinstance(raw, dict):
            raw = {"orderId": _next_order_id(world), "_batch_error": "order payload must be an object."}

        order_id = raw.get("orderId") or raw.get("order_id") or _next_order_id(world)
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
            if _is_finite_number(payload_value):
                payload_kg = float(payload_value)
                if payload_kg <= 0:
                    errors.append("payloadKg must be greater than 0.")
                elif payload_kg > max_payload_kg:
                    errors.append(f"payloadKg must be <= {max_payload_kg}.")
            else:
                errors.append("payloadKg must be a finite number.")

        normalized_deadline = None
        if deadline_ts is not None:
            if _is_finite_number(deadline_ts):
                normalized_deadline = int(deadline_ts)
            else:
                errors.append("deadlineTs must be a finite number when provided.")

        pickup_node = _validate_latlng_node(world, pickup, "pickup", normal_altitude, errors) if pickup is not None else None
        dropoff_node = _validate_latlng_node(world, dropoff, "dropoff", normal_altitude, errors) if dropoff is not None else None

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
        world.orders[order.order_id] = order

        if errors:
            world.queue_event(
                order.order_id,
                EventLevel.WARNING.value,
                EventCode.ORDER_REJECTED.value,
                f"Order {order.order_id} rejected: {'; '.join(errors)}",
            )
        else:
            world.queue_event(
                order.order_id,
                EventLevel.INFO.value,
                EventCode.ORDER_ACCEPTED.value,
                f"Order {order.order_id} accepted.",
            )
        accepted.append(serialize_order(order))

    dispatch_result = {"orders": [], "missions": [], "assignedCount": 0}
    if auto_dispatch:
        dispatch_result = dispatch_pending_orders(world)

    world.queue_event(
        "system",
        EventLevel.INFO.value,
        EventCode.ORDER_STATE_UPDATED.value,
        f"Order state updated: {len(world.orders)} stored order(s).",
    )
    return {
        "orders": accepted + dispatch_result["orders"],
        "missions": dispatch_result["missions"],
        "assignedCount": dispatch_result["assignedCount"],
    }
