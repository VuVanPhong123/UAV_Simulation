from dataclasses import dataclass, field


@dataclass
class CollisionState:
    state: str = "clear"
    peer_id: str | None = None
    distance_m: float | None = None
    action: str | None = None
    avoidance_reason: str | None = None
    hold_steps: int = 0
    avoidance_steps: int = 0
    temporary_altitude: float | None = None


@dataclass
class DroneAgent:
    drone_id: str
    drone: object
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
    collision: CollisionState = field(default_factory=CollisionState)
