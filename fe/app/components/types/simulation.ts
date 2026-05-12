'use client';

export type LatLng = [number, number];

export type MapBounds = {
    south: number;
    west: number;
    north: number;
    east: number;
};

export type MapPresetId = 'hanoi_my_dinh_me_tri_large';

export type MapPresetOption = {
    mapId: MapPresetId;
    label: string;
    description: string;
    sizeLabel: string;
    recommendedUse: string;
    buildingGeoJsonUrl: string;
};

export const DEFAULT_DEMO_DRONE_COUNT = 5;
export const MAX_DEMO_DRONE_COUNT = 30;
export const DEFAULT_MAP_PRESET_ID: MapPresetId = 'hanoi_my_dinh_me_tri_large';

export const MAP_PRESET_OPTIONS: MapPresetOption[] = [
    {
        mapId: 'hanoi_my_dinh_me_tri_large',
        label: 'Mỹ Đình - Mễ Trì Large',
        description: 'Vùng lớn khoảng x9.5 diện tích, phù hợp demo nhiều đơn.',
        sizeLabel: 'Large',
        recommendedUse: '5-15 UAV, 50-100 đơn',
        buildingGeoJsonUrl: '/maps/hanoi_my_dinh_me_tri_large/buildings.geojson'
    }
];

export type ServerStatus = 'connecting' | 'connected' | 'disconnected';
export type WorkerStatus = 'idle' | 'busy' | 'disconnected' | 'error' | 'unknown';
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'failed';
export type AsyncRequestStatus = 'idle' | 'loading' | 'success' | 'warning' | 'error';

export type SimulationShardInfo = {
    shardId: string;
    shardIndex: number;
    shardCount: number;
    workerId: string;
    droneCount: number;
    droneIdOffset: number;
    startDroneId?: string;
    endDroneId?: string;
};

export type WorkerInfo = {
    workerId: string;
    workerName?: string;
    status: WorkerStatus | 'unknown';
    simId?: string | null;
    shardId?: string | null;
    maxDrones?: number | null;
    supportsSharding?: boolean;
    currentMapId?: string | null;
};

export type WorkersById = Record<string, WorkerInfo>;

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
    collisionState?: string;
    collisionPeerId?: string | null;
    collisionDistanceM?: number | null;
    collisionAction?: string | null;
    collisionAvoidanceReason?: string | null;
};

export type MapConfig = {
    mapId?: string;
    mapLabel?: string;
    buildingGeoJsonUrl?: string;
    bounds?: MapBounds;
    start: LatLng;
    goal: LatLng;
    depot?: LatLng;
    simulationMode?: string;
    hasFixedGoal?: boolean;
    charging_stations?: LatLng[];
    no_fly_zones?: { center: LatLng; radius: number }[];
    safeOrderPoints?: LatLng[];
    droneCount?: number;
    drones?: { droneId: string; start: LatLng; goal: LatLng }[];
};

export const PRESET_PREVIEW_MAP_CONFIGS: Record<MapPresetId, MapConfig> = {
    hanoi_my_dinh_me_tri_large: {
        mapId: 'hanoi_my_dinh_me_tri_large',
        mapLabel: 'Mỹ Đình - Mễ Trì Large',
        buildingGeoJsonUrl: '/maps/hanoi_my_dinh_me_tri_large/buildings.geojson',
        bounds: {
            south: 21.0037,
            west: 105.7680,
            north: 21.0292,
            east: 105.8015
        },
        start: [21.0068, 105.7722],
        goal: [21.0266, 105.7972],
        depot: [21.0068, 105.7722],
        simulationMode: 'order_dispatch',
        hasFixedGoal: false,
        charging_stations: [
            [21.0068, 105.7722],
            [21.0147, 105.7819],
            [21.0184, 105.7918],
            [21.0254, 105.7956]
        ],
        no_fly_zones: [
            { center: [21.0169, 105.7835], radius: 90.0 },
            { center: [21.0218, 105.7908], radius: 120.0 },
            { center: [21.0092, 105.7775], radius: 85.0 }
        ],
        safeOrderPoints: [
            [21.0058, 105.7708],
            [21.0064, 105.7768],
            [21.0072, 105.7832],
            [21.0069, 105.7901],
            [21.0080, 105.7975],
            [21.0109, 105.7715],
            [21.0118, 105.7792],
            [21.0126, 105.7864],
            [21.0116, 105.7937],
            [21.0125, 105.7992],
            [21.0152, 105.7696],
            [21.0142, 105.7814],
            [21.0148, 105.7854],
            [21.0162, 105.7890],
            [21.0158, 105.7970],
            [21.0187, 105.7724],
            [21.0175, 105.7815],
            [21.0194, 105.7856],
            [21.0187, 105.7894],
            [21.0190, 105.7990],
            [21.0219, 105.7706],
            [21.0228, 105.7778],
            [21.0235, 105.7848],
            [21.0248, 105.7932],
            [21.0242, 105.7994],
            [21.0270, 105.7726],
            [21.0275, 105.7797],
            [21.0268, 105.7867],
            [21.0272, 105.7939],
            [21.0278, 105.8002]
        ]
    }
};
export type EventLogEntry = {
    timestamp?: number;
    droneId?: string | null;
    orderId?: string | null;
    missionId?: string | null;
    level: string;
    code: string;
    message: string;
};

export type DronesById = Record<string, DroneTelemetry>;
export type PlannedPathsByDrone = Record<string, LatLng[]>;
export type PlannedPath3dByDrone = Record<string, PlannedPath3DPoint[]>;
export type PathHistoryByDrone = Record<string, LatLng[]>;

export type ActiveDashboardSection = 'overview' | 'orders' | 'drones' | 'environment' | 'map_tools' | 'events';
export type EventFilter = 'all' | 'selected_drone' | 'selected_order' | 'selected_mission';
export type MapInteractionMode = 'none' | 'obstacle' | 'no_fly_zone' | 'select_pickup' | 'select_dropoff';
export type OrderPriority = 'low' | 'normal' | 'high' | 'urgent';

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

export type DynamicNoFlyZone = {
    id: string;
    center: LatLng;
    radius: number;
    height?: number;
    label?: string;
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

export type DraftOrder = {
    orderId: string;
    pickup: LatLng | null;
    dropoff: LatLng | null;
    payloadKg: number;
    priority: OrderPriority;
    deadlineTs?: number | null;
};

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
    orders: boolean;
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
    workerIds?: string[];
    workerName?: string;
    maxDrones?: number | null;
    supportsSharding?: boolean;
    shardId?: string | null;
    workers?: WorkerInfo[];
    shards?: SimulationShardInfo[];
    sharded?: boolean;
    totalDrones?: number;
    globalDroneCount?: number;
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
        workers?: WorkerInfo[];
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
    orders: true,
    windShadow: true,
    sensorRange: true,
    weatherOverlay: true,
};

