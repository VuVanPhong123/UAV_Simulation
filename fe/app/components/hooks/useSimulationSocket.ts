'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DEFAULT_MAP_PRESET_ID,
    DEFAULT_DEMO_DRONE_COUNT,
    MAX_DEMO_DRONE_COUNT
} from '../types/simulation';
import type {
    DroneTelemetry,
    DynamicNoFlyZone,
    DynamicObstacle,
    DronesById,
    DeliveryOrder,
    EventLogEntry,
    IncomingMessage,
    LatLng,
    MapConfig,
    Mission,
    MissionsById,
    OrdersById,
    PlannedPath3DPoint,
    PlannedPath3dByDrone,
    PlannedPathsByDrone,
    ServerStatus,
    SimulationShardInfo,
    SimulationStatus,
    AsyncRequestStatus,
    WeatherState,
    WorkerInfo,
    WorkersById,
    WorkerStatus
} from '../types/simulation';

type StartSimulationOptions = {
    droneCount: number;
    orderBatch?: unknown[];
    mapId?: string;
};

type StartSimulationInput = number | StartSimulationOptions;

const MAX_EVENT_LOGS = 200;
const WIND_SHADOW_MAX_POINTS = 400;

function clampDroneCount(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_DEMO_DRONE_COUNT;
    return Math.max(1, Math.min(MAX_DEMO_DRONE_COUNT, Math.floor(value)));
}

function sampleLatLngPoints(points: LatLng[], maxPoints: number) {
    if (points.length <= maxPoints) return points;
    const step = Math.ceil(points.length / maxPoints);
    return points.filter((_, idx) => idx % step === 0).slice(0, maxPoints);
}

function isLatLng(value: unknown): value is LatLng {
    return Boolean(
        Array.isArray(value)
        && value.length === 2
        && Number.isFinite(value[0])
        && Number.isFinite(value[1])
    );
}

function normalizePath3dPoint(value: unknown): PlannedPath3DPoint | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as { pos?: unknown; altitude?: unknown };
    if (!isLatLng(record.pos)) return null;
    const altitude = Number(record.altitude);
    return {
        pos: record.pos,
        altitude: Number.isFinite(altitude) ? altitude : 0
    };
}

function normalizeTelemetry(data: IncomingMessage): DroneTelemetry {
    const payload = (data.payload ?? {}) as Partial<DroneTelemetry>;
    const message = data as IncomingMessage & Partial<DroneTelemetry>;
    const value = <K extends keyof DroneTelemetry>(key: K): DroneTelemetry[K] | undefined => (
        payload[key] ?? message[key]
    );
    const batteryPercent = payload.batteryPercent ?? message.batteryPercent ?? payload.battery ?? message.battery;
    const battery = payload.battery ?? message.battery ?? batteryPercent;
    const pos = payload.pos ?? message.pos;

    return {
        droneId: data.droneId ?? payload.droneId ?? 'drone_1',
        pos: isLatLng(pos) ? pos : undefined,
        battery,
        batteryPercent,
        altitude: value('altitude'),
        targetAltitude: value('targetAltitude'),
        altitudeChangeRate: value('altitudeChangeRate'),
        speed: value('speed'),
        heading: value('heading'),
        temperature: value('temperature'),
        status: value('status'),
        mode: value('mode'),
        step: value('step'),
        energyConsumed: value('energyConsumed'),
        windDir: value('windDir'),
        windSpeed: value('windSpeed'),
        ambientTemp: value('ambientTemp'),
        isRaining: value('isRaining'),
        currentPathIndex: value('currentPathIndex'),
        pathLength: value('pathLength'),
        currentOrderId: value('currentOrderId'),
        currentMissionId: value('currentMissionId'),
        currentTargetType: value('currentTargetType'),
        payloadKg: value('payloadKg'),
        collisionState: value('collisionState'),
        collisionPeerId: value('collisionPeerId'),
        collisionDistanceM: value('collisionDistanceM'),
        collisionAction: value('collisionAction'),
        collisionAvoidanceReason: value('collisionAvoidanceReason')
    };
}

function normalizePlannedPath(data: IncomingMessage) {
    const payload = data.payload ?? {};
    const droneId = data.droneId ?? payload.droneId ?? 'drone_1';
    const rawPath3d = payload.path3d ?? data.path3d;
    const rawPath = payload.path ?? data.path;
    const path3d = Array.isArray(rawPath3d)
        ? rawPath3d.map(normalizePath3dPoint).filter((point): point is PlannedPath3DPoint => point !== null)
        : [];

    if (path3d.length > 0) {
        return {
            droneId,
            path: path3d.map(point => point.pos),
            path3d
        };
    }

    const path = Array.isArray(rawPath)
        ? rawPath.filter(isLatLng)
        : [];
    return {
        droneId,
        path,
        path3d: path.map(pos => ({ pos, altitude: 0 }))
    };
}

function pathSignature(path: LatLng[], path3d: PlannedPath3DPoint[]) {
    const first = path[0];
    const last = path[path.length - 1];
    const first3d = path3d[0];
    const last3d = path3d[path3d.length - 1];
    return [
        path.length,
        first?.join(',') ?? '',
        last?.join(',') ?? '',
        path3d.length,
        first3d ? `${first3d.pos.join(',')}:${first3d.altitude}` : '',
        last3d ? `${last3d.pos.join(',')}:${last3d.altitude}` : ''
    ].join('|');
}

function terminalToStatus(status?: string): SimulationStatus {
    if (status === 'success' || status === 'stopped') return 'stopped';
    if (status === 'paused') return 'paused';
    if (status === 'failed' || status === 'truncated') return 'failed';
    return 'running';
}

function orderKey(order: DeliveryOrder) {
    return order.orderId ?? order.order_id ?? '';
}

function missionKey(mission: Mission) {
    return mission.missionId ?? mission.mission_id ?? '';
}

function mapOrders(items?: DeliveryOrder[]) {
    return (items ?? []).reduce<OrdersById>((acc, order) => {
        const key = orderKey(order);
        if (key) acc[key] = order;
        return acc;
    }, {});
}

function mapMissions(items?: Mission[]) {
    return (items ?? []).reduce<MissionsById>((acc, mission) => {
        const key = missionKey(mission);
        if (key) acc[key] = mission;
        return acc;
    }, {});
}

function mapWorkers(items?: WorkerInfo[]) {
    return (items ?? []).reduce<WorkersById>((acc, worker) => {
        if (worker.workerId) acc[worker.workerId] = worker;
        return acc;
    }, {});
}

export function useSimulationSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const activeSimIdRef = useRef<string | null>(null);
    const locallyStoppedSimIdsRef = useRef<Set<string>>(new Set());
    const plannedPathSignaturesRef = useRef<Record<string, string>>({});
    const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>('unknown');
    const [workers, setWorkers] = useState<WorkersById>({});
    const [simulationShards, setSimulationShards] = useState<SimulationShardInfo[]>([]);
    const [isShardedSimulation, setIsShardedSimulation] = useState(false);
    const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>('idle');
    const [activeSimId, setActiveSimId] = useState<string | null>(null);
    const [frontendId, setFrontendId] = useState<string | null>(null);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [drones, setDrones] = useState<DronesById>({});
    const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
    const selectedDroneIdRef = useRef<string | null>(null);
    const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
    const [plannedPaths, setPlannedPaths] = useState<PlannedPathsByDrone>({});
    const [plannedPaths3d, setPlannedPaths3d] = useState<PlannedPath3dByDrone>({});
    const [windShadowZones, setWindShadowZones] = useState<LatLng[]>([]);
    const [orders, setOrders] = useState<OrdersById>({});
    const [missions, setMissions] = useState<MissionsById>({});
    const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);
    const [isStartingSimulation, setIsStartingSimulation] = useState(false);
    const [isAwaitingConfig, setIsAwaitingConfig] = useState(false);
    const [isAwaitingFirstTelemetry, setIsAwaitingFirstTelemetry] = useState(false);
    const [windShadowRequestStatus, setWindShadowRequestStatus] = useState<AsyncRequestStatus>('idle');

    useEffect(() => {
        activeSimIdRef.current = activeSimId;
    }, [activeSimId]);

    useEffect(() => {
        selectedDroneIdRef.current = selectedDroneId;
    }, [selectedDroneId]);

    const addLocalEvent = useCallback((level: string, code: string, message: string, timestamp?: number) => {
        setEventLogs(prev => [
            { level, code, message, timestamp: timestamp ?? Date.now() },
            ...prev
        ].slice(0, MAX_EVENT_LOGS));
    }, []);

    const sendJson = useCallback((payload: Record<string, unknown>) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(payload));
            return true;
        }
        addLocalEvent('warning', 'WS_NOT_READY', 'WebSocket is not connected.');
        return false;
    }, [addLocalEvent]);

    const clearSessionVisuals = useCallback(() => {
        setPlannedPaths({});
        setPlannedPaths3d({});
        plannedPathSignaturesRef.current = {};
        setWindShadowZones([]);
        setOrders({});
        setMissions({});
    }, []);

    const firstDroneId = Object.keys(drones)[0] ?? null;
    const effectiveSelectedDroneId = selectedDroneId ?? firstDroneId;
    const selectedDrone = effectiveSelectedDroneId ? drones[effectiveSelectedDroneId] ?? null : null;
    const selectedPlannedPath = selectedDroneId ? plannedPaths[selectedDroneId] ?? [] : [];
    const selectedPath3d = selectedDroneId ? plannedPaths3d[selectedDroneId] ?? [] : [];

    const isCurrentSimulationMessage = useCallback((messageSimId?: string | null) => {
        if (!messageSimId) return true;
        return activeSimIdRef.current === messageSimId;
    }, []);

    const clearPendingStart = useCallback(() => {
        setIsStartingSimulation(false);
        setIsAwaitingConfig(false);
        setIsAwaitingFirstTelemetry(false);
    }, []);

    const updateSelectedDroneId = useCallback((droneId: string | null) => {
        selectedDroneIdRef.current = droneId;
        setSelectedDroneId(droneId);
    }, []);

    const sendCommand = useCallback((action: 'pause' | 'resume' | 'stop' | 'reset') => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', `No active simulation to ${action}.`);
            return false;
        }
        const sent = sendJson({ type: 'command', simId: activeSimId, action });
        if (!sent) return false;
        if (action === 'pause') setSimulationStatus('paused');
        if (action === 'resume') setSimulationStatus('running');
        if (action === 'stop') {
            setSimulationStatus('stopped');
            setSimulationShards([]);
            setIsShardedSimulation(false);
            clearSessionVisuals();
            clearPendingStart();
        }
        if (action === 'reset') {
            clearSessionVisuals();
            setIsAwaitingFirstTelemetry(true);
        }
        return true;
    }, [activeSimId, addLocalEvent, clearPendingStart, clearSessionVisuals, sendJson]);

    const resetToSetup = useCallback(() => {
        const simId = activeSimIdRef.current;
        const sentStop = simId
            ? sendJson({ type: 'command', simId, action: 'stop' })
            : true;
        if (!sentStop) return false;

        if (simId) locallyStoppedSimIdsRef.current.add(simId);
        activeSimIdRef.current = null;
        setActiveSimId(null);
        setSimulationShards([]);
        setIsShardedSimulation(false);
        setSimulationStatus('stopped');
        clearPendingStart();
        clearSessionVisuals();
        updateSelectedDroneId(null);
        setDrones({});
        setMapConfig(null);
        return true;
    }, [clearPendingStart, clearSessionVisuals, sendJson, updateSelectedDroneId]);

    const startSimulation = useCallback((input: StartSimulationInput = 1) => {
        const droneCount = clampDroneCount(typeof input === 'number' ? input : input.droneCount);
        const orderBatch = typeof input === 'number' ? undefined : input.orderBatch;
        const mapId = typeof input === 'number' ? DEFAULT_MAP_PRESET_ID : input.mapId ?? DEFAULT_MAP_PRESET_ID;
        const sent = sendJson({
            type: 'request_start_simulation',
            payload: {
                mapId,
                droneCount,
                orderBatch,
                autoDispatch: true,
                simulationMode: 'order_dispatch'
            }
        });
        if (sent) {
            setIsStartingSimulation(true);
            setIsAwaitingConfig(true);
            setIsAwaitingFirstTelemetry(true);
        }
        return sent;
    }, [sendJson]);

    const applyWeather = useCallback((weather: WeatherState) => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before changing weather.');
            return false;
        }
        return sendJson({
            type: 'weather_update',
            simId: activeSimId,
            ...weather,
            payload: weather
        });
    }, [activeSimId, addLocalEvent, sendJson]);

    const addObstacle = useCallback((obstacle: DynamicObstacle) => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before adding obstacles.');
            return false;
        }
        return sendJson({
            type: 'add_obstacle',
            simId: activeSimId,
            payload: obstacle
        });
    }, [activeSimId, addLocalEvent, sendJson]);

    const addNoFlyZone = useCallback((zone: DynamicNoFlyZone) => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before adding no-fly zones.');
            return false;
        }
        return sendJson({
            type: 'add_no_fly_zone',
            simId: activeSimId,
            payload: zone
        });
    }, [activeSimId, addLocalEvent, sendJson]);

    const submitOrderBatch = useCallback((ordersInput: unknown[]) => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before submitting orders.');
            return false;
        }
        return sendJson({
            type: 'order_batch',
            simId: activeSimId,
            payload: {
                orders: ordersInput,
                autoDispatch: true
            }
        });
    }, [activeSimId, addLocalEvent, sendJson]);

    const dispatchOrders = useCallback(() => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before dispatching orders.');
            return false;
        }
        return sendJson({
            type: 'dispatch_orders',
            simId: activeSimId,
            payload: {}
        });
    }, [activeSimId, addLocalEvent, sendJson]);

    const requestWindShadow = useCallback(() => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before requesting wind shadow zones.');
            setWindShadowRequestStatus('warning');
            return false;
        }
        const sent = sendJson({
            type: 'request_wind_shadow',
            simId: activeSimId
        });
        setWindShadowRequestStatus(sent ? 'loading' : 'error');
        return sent;
    }, [activeSimId, addLocalEvent, sendJson]);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');
        wsRef.current = ws;

        ws.onopen = () => {
            setServerStatus('connected');
            ws.send(JSON.stringify({ type: 'register', role: 'frontend' }));
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data) as IncomingMessage & MapConfig;

            if (data.type === 'registered') {
                setFrontendId(data.clientId ?? null);
            } else if (data.type === 'connection_state') {
                setServerStatus(data.server === 'connected' ? 'connected' : 'disconnected');
                setWorkerStatus(data.workerStatus ?? 'unknown');
                if (data.activeSimId && locallyStoppedSimIdsRef.current.has(data.activeSimId)) {
                    activeSimIdRef.current = null;
                    setActiveSimId(null);
                    setSimulationShards([]);
                    setIsShardedSimulation(false);
                    setSimulationStatus('stopped');
                    clearPendingStart();
                    return;
                }
                activeSimIdRef.current = data.activeSimId ?? null;
                setActiveSimId(data.activeSimId ?? null);
                setSimulationStatus(data.activeSimId ? 'running' : 'idle');
                if (!data.activeSimId) {
                    locallyStoppedSimIdsRef.current.clear();
                    setSimulationShards([]);
                    setIsShardedSimulation(false);
                    clearPendingStart();
                }
            } else if (data.type === 'worker_status') {
                const status = (data.status ?? data.payload?.status ?? 'unknown') as WorkerStatus;
                setWorkerStatus(status);
                if (data.workerId) {
                    setWorkers(prev => ({
                        ...prev,
                        [data.workerId as string]: {
                            ...(prev[data.workerId as string] ?? { workerId: data.workerId as string }),
                            workerId: data.workerId as string,
                            workerName: data.workerName,
                            status,
                            simId: data.simId ?? null,
                            shardId: (data as IncomingMessage & { shardId?: string | null }).shardId ?? null,
                            maxDrones: (data as IncomingMessage & { maxDrones?: number | null }).maxDrones ?? prev[data.workerId as string]?.maxDrones ?? null,
                            supportsSharding: (data as IncomingMessage & { supportsSharding?: boolean }).supportsSharding ?? prev[data.workerId as string]?.supportsSharding
                        }
                    }));
                }
            } else if (data.type === 'worker_list') {
                setWorkers(mapWorkers(data.payload?.workers ?? data.workers));
            } else if (data.type === 'simulation_assigned') {
                if (data.simId) locallyStoppedSimIdsRef.current.delete(data.simId);
                activeSimIdRef.current = data.simId ?? null;
                setActiveSimId(data.simId ?? null);
                const shards = data.shards ?? [];
                setSimulationShards(shards);
                setIsShardedSimulation(Boolean(data.sharded || shards.length > 1));
                setSimulationStatus('running');
                setIsStartingSimulation(false);
                setIsAwaitingConfig(true);
                setIsAwaitingFirstTelemetry(true);
                setDrones({});
                setPlannedPaths({});
                setPlannedPaths3d({});
                plannedPathSignaturesRef.current = {};
                setOrders({});
                setMissions({});
                updateSelectedDroneId(null);
                addLocalEvent('info', 'SIMULATION_ASSIGNED', `Simulation assigned to worker ${data.workerId ?? '-'}.`, data.timestamp);
                if (data.sharded || shards.length > 1) {
                    addLocalEvent('info', 'SHARDED_SIMULATION_ASSIGNED', `Da phan cum mo phong: ${data.totalDrones ?? '-'} UAV / ${shards.length} worker.`, data.timestamp);
                }
            } else if (data.type === 'worker_busy') {
                setSimulationStatus('idle');
                clearPendingStart();
                addLocalEvent('warning', 'WORKER_BUSY', data.message ?? 'No idle worker available.', data.timestamp);
            } else if (data.type === 'simulation_finished') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                const finishedStatus = data.payload?.status;
                setSimulationStatus(terminalToStatus(finishedStatus));
                activeSimIdRef.current = null;
                setActiveSimId(null);
                setSimulationShards([]);
                setIsShardedSimulation(false);
                clearPendingStart();
                clearSessionVisuals();
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
            } else if (data.type === 'latency_update') {
                setLatencyMs(data.latencyMs ?? null);
            } else if (data.type === 'config') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                setMapConfig(data);
                setIsStartingSimulation(false);
                setIsAwaitingConfig(false);
            } else if (data.type === 'telemetry') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                setIsStartingSimulation(false);
                setIsAwaitingFirstTelemetry(false);
                const nextTelemetry = normalizeTelemetry(data);
                const droneId = nextTelemetry.droneId ?? 'drone_1';
                setDrones(prev => ({ ...prev, [droneId]: nextTelemetry }));
                if (!selectedDroneIdRef.current) {
                    updateSelectedDroneId(droneId);
                }
                if (nextTelemetry.status === 'paused') setSimulationStatus('paused');
                else if (nextTelemetry.status && !['success', 'failed', 'emergency_landing'].includes(nextTelemetry.status) && activeSimIdRef.current) {
                    setSimulationStatus('running');
                }
            } else if (data.type === 'wind_shadow_zones') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                setWindShadowZones(sampleLatLngPoints(data.payload?.zones ?? data.zones ?? [], WIND_SHADOW_MAX_POINTS));
                setWindShadowRequestStatus('success');
            } else if (data.type === 'planned_path') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                const { droneId, path, path3d } = normalizePlannedPath(data);
                const signature = pathSignature(path, path3d);
                if (plannedPathSignaturesRef.current[droneId] === signature) return;
                plannedPathSignaturesRef.current[droneId] = signature;
                setPlannedPaths(prev => ({ ...prev, [droneId]: path }));
                setPlannedPaths3d(prev => ({ ...prev, [droneId]: path3d }));
            } else if (data.type === 'order_state') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                setOrders(mapOrders(data.payload?.orders as DeliveryOrder[] | undefined));
                setMissions(mapMissions(data.payload?.missions as Mission[] | undefined));
            } else if (data.type === 'order_update') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                const order = data.payload as DeliveryOrder | undefined;
                const key = order ? orderKey(order) : '';
                if (order && key) {
                    setOrders(prev => ({ ...prev, [key]: order }));
                }
            } else if (data.type === 'mission_update') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                const mission = data.payload as Mission | undefined;
                const key = mission ? missionKey(mission) : '';
                if (mission && key) {
                    setMissions(prev => ({ ...prev, [key]: mission }));
                }
            } else if (data.type === 'event') {
                if (!isCurrentSimulationMessage(data.simId)) return;
                const payload = data.payload ?? {};
                const droneId = data.droneId ?? payload.droneId ?? null;
                const code = payload.code ?? 'UNKNOWN';
                const message = payload.message ?? '';
                setEventLogs(prev => [
                    {
                        droneId,
                        orderId: payload.orderId ?? payload.order_id ?? null,
                        missionId: payload.missionId ?? payload.mission_id ?? null,
                        level: payload.level ?? 'info',
                        code,
                        message,
                        timestamp: data.timestamp ?? Date.now()
                    },
                    ...prev
                ].slice(0, MAX_EVENT_LOGS));
                if (code === 'MAP_CACHE_MISSING' || /cache missing|map cache/i.test(String(message))) {
                    setSimulationStatus('failed');
                    activeSimIdRef.current = null;
                    setActiveSimId(null);
                    setSimulationShards([]);
                    setIsShardedSimulation(false);
                    clearPendingStart();
                }
            }
        };

        ws.onclose = () => {
            setServerStatus('disconnected');
            setWorkerStatus('disconnected');
            setSimulationStatus('stopped');
            activeSimIdRef.current = null;
            setActiveSimId(null);
            setSimulationShards([]);
            setIsShardedSimulation(false);
            clearPendingStart();
            clearSessionVisuals();
        };

        ws.onerror = () => {
            setServerStatus('disconnected');
        };

        return () => ws.close();
    }, [addLocalEvent, clearPendingStart, clearSessionVisuals, isCurrentSimulationMessage, updateSelectedDroneId]);

    return {
        serverStatus,
        workerStatus,
        workers,
        simulationShards,
        isShardedSimulation,
        simulationStatus,
        activeSimId,
        frontendId,
        latencyMs,
        drones,
        selectedDroneId,
        selectedDrone,
        setSelectedDroneId: updateSelectedDroneId,
        mapConfig,
        plannedPaths,
        plannedPaths3d,
        selectedPlannedPath,
        selectedPath3d,
        windShadowZones,
        orders,
        missions,
        eventLogs,
        isStartingSimulation,
        isAwaitingConfig,
        isAwaitingFirstTelemetry,
        windShadowRequestStatus,
        addLocalEvent,
        startSimulation,
        pauseSimulation: () => sendCommand('pause'),
        resumeSimulation: () => sendCommand('resume'),
        stopSimulation: () => sendCommand('stop'),
        resetSimulation: () => sendCommand('reset'),
        resetToSetup,
        applyWeather,
        addObstacle,
        addNoFlyZone,
        submitOrderBatch,
        dispatchOrders,
        requestWindShadow,
        clearSessionVisuals
    };
}
