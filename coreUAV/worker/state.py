from dataclasses import dataclass, field


@dataclass
class WorkerState:
    # ── set once at connection time ────────────────────────────────────────────
    ws: object
    worker_name: str
    base_config: dict
    max_demo_drones: int
    default_demo_drones: int
    wind_shadow_max_points: int
    telemetry_every_n_steps: int
    send_wind_shadow_by_default: bool

    # ── per-simulation config (replaced on every start_simulation) ─────────────
    config: dict = field(default_factory=dict)
    dt: float = 0.1

    # ── simulation runtime state ──────────────────────────────────────────────
    world: object = None
    transformer: object = None
    sim_id: str | None = None
    frontend_id: str | None = None
    is_assigned: bool = False
    is_running: bool = False
    step: int = 0
    telemetry_counter: int = 0
    drone_count: int = 1
    last_path_ids: dict = field(default_factory=dict)
    wind_shadow_requested: bool = False

    # ── sharding ──────────────────────────────────────────────────────────────
    shard_mode: bool = False
    shard_id: str | None = None
    shard_index: int = 0
    shard_count: int = 1
    drone_id_offset: int = 0
    global_drone_count: int = 1
