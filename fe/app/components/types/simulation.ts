'use client';

export type LatLng = [number, number];

export type ServerStatus = 'connecting' | 'connected' | 'disconnected';
export type WorkerStatus = 'idle' | 'busy' | 'disconnected' | 'error' | 'unknown';
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'failed';

export type ObstacleType = 'unknown' | 'tree' | 'pole' | 'bird' | 'building_crane';

export type PlannedPath3DPoint = {
    pos: LatLng;
    altitude: number;
};

export type DroneTelemetry = {
    droneId?: string;
    pos?: LatLng;
    battery?: number;
    batteryPercent?: number;
    altitude?: number;
    targetAltitude?: number;
    altitudeChangeRate?: number;
    speed?: number;
    heading?: number;
    temperature?: number;
    status?: string;
    mode?: string;
    step?: number;
    energyConsumed?: number;
    windDir?: number;
    windSpeed?: number;
    ambientTemp?: number;
    isRaining?: boolean;
    currentPathIndex?: number;
    pathLength?: number;
    currentOrderId?: string | null;
    currentMissionId?: string | null;
    currentTargetType?: string | null;
    payloadKg?: number;
};

export type MapConfig = {
    start: LatLng;
    goal: LatLng;
    charging_stations?: LatLng[];
    no_fly_zones?: { center: LatLng; radius: number }[];
    droneCount?: number;
    drones?: { droneId: string; start: LatLng; goal: LatLng }[];
};

export type EventLogEntry = {
    timestamp?: number;
    droneId?: string | null;
    level: string;
    code: string;
    message: string;
};

export type DronesById = Record<string, DroneTelemetry>;
export type PlannedPathsByDrone = Record<string, LatLng[]>;
export type PlannedPath3dByDrone = Record<string, PlannedPath3DPoint[]>;
export type PathHistoryByDrone = Record<string, LatLng[]>;

export type WeatherState = {
    wind_dir: number;
    wind_speed: number;
    ambient_temp: number;
    is_raining: boolean;
};

export type ObstacleConfig = {
    radius: number;
    height: number;
    obstacleType: ObstacleType;
};

export type DynamicObstacle = LatLng | {
    pos: LatLng;
    radius: number;
    height: number;
    obstacleType: ObstacleType;
};

export type OrderStatus =
    | 'pending'
    | 'assigned'
    | 'going_to_pickup'
    | 'picked_up'
    | 'delivering'
    | 'completed'
    | 'failed'
    | 'canceled';

export type MissionStatus =
    | 'planned'
    | 'to_pickup'
    | 'pickup_arrived'
    | 'to_dropoff'
    | 'completed'
    | 'failed';

export type DeliveryOrder = {
    orderId?: string;
    order_id?: string;
    pickup: LatLng;
    dropoff: LatLng;
    payloadKg?: number;
    payload_kg?: number;
    priority?: string;
    deadlineTs?: number | null;
    deadline_ts?: number | null;
    status: OrderStatus;
    pickupNode?: [number, number] | null;
    pickup_node?: [number, number] | null;
    dropoffNode?: [number, number] | null;
    dropoff_node?: [number, number] | null;
    assignedDroneId?: string | null;
    assigned_drone_id?: string | null;
    missionId?: string | null;
    mission_id?: string | null;
    validationErrors?: string[];
    validation_errors?: string[];
    createdAt?: number;
    created_at?: number;
    updatedAt?: number;
    updated_at?: number;
    completedAt?: number | null;
    completed_at?: number | null;
    failedReason?: string | null;
    failed_reason?: string | null;
};

export type Mission = {
    missionId?: string;
    mission_id?: string;
    orderId?: string;
    order_id?: string;
    droneId?: string | null;
    drone_id?: string | null;
    pickupNode?: [number, number] | null;
    pickup_node?: [number, number] | null;
    dropoffNode?: [number, number] | null;
    dropoff_node?: [number, number] | null;
    status: MissionStatus;
    pickupPath?: Array<{ node?: [number, number] | null; altitude?: number }>;
    pickup_path?: Array<{ node?: [number, number] | null; altitude?: number }>;
    dropoffPath?: Array<{ node?: [number, number] | null; altitude?: number }>;
    dropoff_path?: Array<{ node?: [number, number] | null; altitude?: number }>;
    createdAt?: number;
    created_at?: number;
    updatedAt?: number;
    updated_at?: number;
    startedAt?: number | null;
    started_at?: number | null;
    completedAt?: number | null;
    completed_at?: number | null;
    failedReason?: string | null;
    failed_reason?: string | null;
};

export type OrdersById = Record<string, DeliveryOrder>;
export type MissionsById = Record<string, Mission>;

export type OrderStatePayload = {
    orders?: DeliveryOrder[];
    missions?: Mission[];
};

export type LayerToggles = {
    buildings: boolean;
    buildingLabels: boolean;
    noFlyZones: boolean;
    chargingStations: boolean;
    plannedPath: boolean;
    pathHistory: boolean;
    dynamicObstacles: boolean;
    windShadow: boolean;
    sensorRange: boolean;
    weatherOverlay: boolean;
};

export type IncomingMessage = {
    type?: string;
    timestamp?: number;
    role?: string;
    clientId?: string;
    server?: string;
    workerStatus?: WorkerStatus;
    activeSimId?: string | null;
    simId?: string | null;
    droneId?: string | null;
    workerId?: string;
    status?: string;
    message?: string;
    latencyMs?: number;
    payload?: Partial<DroneTelemetry>
    & Partial<Omit<DeliveryOrder, 'status'>>
    & Partial<Omit<Mission, 'status'>>
    & OrderStatePayload
    & {
        droneId?: string;
        zones?: LatLng[];
        path?: LatLng[];
        path3d?: PlannedPath3DPoint[];
        level?: string;
        code?: string;
        message?: string;
        status?: string;
    };
    pos?: LatLng;
    zones?: LatLng[];
    path?: LatLng[];
    path3d?: PlannedPath3DPoint[];
};

export const DEFAULT_LAYER_TOGGLES: LayerToggles = {
    buildings: true,
    buildingLabels: false,
    noFlyZones: true,
    chargingStations: true,
    plannedPath: true,
    pathHistory: true,
    dynamicObstacles: true,
    windShadow: false,
    sensorRange: true,
    weatherOverlay: false
};
