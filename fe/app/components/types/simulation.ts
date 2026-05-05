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
    payload?: DroneTelemetry & {
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
    buildingLabels: true,
    noFlyZones: true,
    chargingStations: true,
    plannedPath: true,
    pathHistory: true,
    dynamicObstacles: true,
    windShadow: true,
    sensorRange: true,
    weatherOverlay: true
};
