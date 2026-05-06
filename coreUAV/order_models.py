from dataclasses import dataclass, field

from statuses import MissionStatus, OrderStatus


@dataclass
class DeliveryOrder:
    order_id: str
    pickup: list
    dropoff: list
    payload_kg: float
    priority: str = "normal"
    deadline_ts: int | None = None
    status: str = OrderStatus.PENDING.value
    pickup_node: tuple | None = None
    dropoff_node: tuple | None = None
    assigned_drone_id: str | None = None
    mission_id: str | None = None
    validation_errors: list = field(default_factory=list)
    created_at: int = 0
    updated_at: int = 0
    completed_at: int | None = None
    failed_reason: str | None = None


@dataclass
class Mission:
    mission_id: str
    order_id: str
    drone_id: str | None = None
    pickup_node: tuple | None = None
    dropoff_node: tuple | None = None
    status: str = MissionStatus.PLANNED.value
    pickup_path: list = field(default_factory=list)
    dropoff_path: list = field(default_factory=list)
    created_at: int = 0
    updated_at: int = 0
    started_at: int | None = None
    completed_at: int | None = None
    failed_reason: str | None = None


def _node_to_list(node):
    if node is None:
        return None
    return [int(node[0]), int(node[1])]


def _serialize_path_point(point):
    if isinstance(point, dict):
        node = point.get("node")
        return {
            "node": _node_to_list(node),
            "altitude": float(point.get("altitude", 0.0)),
        }
    return {
        "node": _node_to_list(point),
    }


def _serialize_path(path):
    return [_serialize_path_point(point) for point in (path or [])]


def serialize_order(order, graph=None, transformer=None):
    pickup_node = _node_to_list(order.pickup_node)
    dropoff_node = _node_to_list(order.dropoff_node)
    payload = {
        "orderId": order.order_id,
        "order_id": order.order_id,
        "pickup": list(order.pickup) if order.pickup is not None else None,
        "dropoff": list(order.dropoff) if order.dropoff is not None else None,
        "payloadKg": float(order.payload_kg) if order.payload_kg is not None else None,
        "payload_kg": float(order.payload_kg) if order.payload_kg is not None else None,
        "priority": order.priority,
        "deadlineTs": order.deadline_ts,
        "deadline_ts": order.deadline_ts,
        "status": order.status,
        "pickupNode": pickup_node,
        "pickup_node": pickup_node,
        "dropoffNode": dropoff_node,
        "dropoff_node": dropoff_node,
        "assignedDroneId": order.assigned_drone_id,
        "assigned_drone_id": order.assigned_drone_id,
        "missionId": order.mission_id,
        "mission_id": order.mission_id,
        "validationErrors": list(order.validation_errors),
        "validation_errors": list(order.validation_errors),
        "createdAt": int(order.created_at),
        "created_at": int(order.created_at),
        "updatedAt": int(order.updated_at),
        "updated_at": int(order.updated_at),
        "completedAt": order.completed_at,
        "completed_at": order.completed_at,
        "failedReason": order.failed_reason,
        "failed_reason": order.failed_reason,
    }
    return payload


def serialize_mission(mission):
    pickup_node = _node_to_list(mission.pickup_node)
    dropoff_node = _node_to_list(mission.dropoff_node)
    return {
        "missionId": mission.mission_id,
        "mission_id": mission.mission_id,
        "orderId": mission.order_id,
        "order_id": mission.order_id,
        "droneId": mission.drone_id,
        "drone_id": mission.drone_id,
        "pickupNode": pickup_node,
        "pickup_node": pickup_node,
        "dropoffNode": dropoff_node,
        "dropoff_node": dropoff_node,
        "status": mission.status,
        "pickupPath": _serialize_path(mission.pickup_path),
        "pickup_path": _serialize_path(mission.pickup_path),
        "dropoffPath": _serialize_path(mission.dropoff_path),
        "dropoff_path": _serialize_path(mission.dropoff_path),
        "createdAt": int(mission.created_at),
        "created_at": int(mission.created_at),
        "updatedAt": int(mission.updated_at),
        "updated_at": int(mission.updated_at),
        "startedAt": mission.started_at,
        "started_at": mission.started_at,
        "completedAt": mission.completed_at,
        "completed_at": mission.completed_at,
        "failedReason": mission.failed_reason,
        "failed_reason": mission.failed_reason,
    }
