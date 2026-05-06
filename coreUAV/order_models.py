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


@dataclass
class Mission:
    mission_id: str
    order_id: str
    drone_id: str | None = None
    pickup_node: tuple | None = None
    dropoff_node: tuple | None = None
    status: str = MissionStatus.PLANNED.value
    created_at: int = 0
    updated_at: int = 0


def _node_to_list(node):
    if node is None:
        return None
    return [int(node[0]), int(node[1])]


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
        "createdAt": int(mission.created_at),
        "created_at": int(mission.created_at),
        "updatedAt": int(mission.updated_at),
        "updated_at": int(mission.updated_at),
    }
