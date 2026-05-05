'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    DroneTelemetry,
    DynamicObstacle,
    DronesById,
    EventLogEntry,
    IncomingMessage,
    LatLng,
    MapConfig,
    PlannedPath3DPoint,
    PlannedPath3dByDrone,
    PlannedPathsByDrone,
    ServerStatus,
    SimulationStatus,
    WeatherState,
    WorkerStatus
} from '../types/simulation';

function terminalToStatus(status?: string): SimulationStatus {
    if (status === 'success' || status === 'stopped') return 'stopped';
    if (status === 'paused') return 'paused';
    if (status === 'failed' || status === 'truncated') return 'failed';
    return 'running';
}

export function useSimulationSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const activeSimIdRef = useRef<string | null>(null);
    const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>('unknown');
    const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>('idle');
    const [activeSimId, setActiveSimId] = useState<string | null>(null);
    const [frontendId, setFrontendId] = useState<string | null>(null);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [drones, setDrones] = useState<DronesById>({});
    const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
    const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
    const [plannedPaths, setPlannedPaths] = useState<PlannedPathsByDrone>({});
    const [plannedPaths3d, setPlannedPaths3d] = useState<PlannedPath3dByDrone>({});
    const [windShadowZones, setWindShadowZones] = useState<LatLng[]>([]);
    const [eventLogs, setEventLogs] = useState<EventLogEntry[]>([]);

    useEffect(() => {
        activeSimIdRef.current = activeSimId;
    }, [activeSimId]);

    const addLocalEvent = useCallback((level: string, code: string, message: string, timestamp?: number) => {
        setEventLogs(prev => [
            { level, code, message, timestamp: timestamp ?? Date.now() },
            ...prev
        ].slice(0, 50));
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
        setWindShadowZones([]);
    }, []);

    const selectedDrone = selectedDroneId ? drones[selectedDroneId] ?? null : null;
    const selectedPlannedPath = selectedDroneId ? plannedPaths[selectedDroneId] ?? [] : [];
    const selectedPath3d = selectedDroneId ? plannedPaths3d[selectedDroneId] ?? [] : [];

    const sendCommand = useCallback((action: 'pause' | 'resume' | 'stop' | 'reset') => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', `No active simulation to ${action}.`);
            return;
        }
        sendJson({ type: 'command', simId: activeSimId, action });
        if (action === 'pause') setSimulationStatus('paused');
        if (action === 'resume') setSimulationStatus('running');
        if (action === 'stop') setSimulationStatus('stopped');
        if (action === 'reset') clearSessionVisuals();
    }, [activeSimId, addLocalEvent, clearSessionVisuals, sendJson]);

    const startSimulation = useCallback((droneCount = 1) => {
        sendJson({
            type: 'request_start_simulation',
            payload: {
                mapId: 'hanoi_default',
                droneCount
            }
        });
    }, [sendJson]);

    const applyWeather = useCallback((weather: WeatherState) => {
        if (!activeSimId) {
            addLocalEvent('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before changing weather.');
            return;
        }
        sendJson({
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
                setActiveSimId(data.activeSimId ?? null);
                setSimulationStatus(data.activeSimId ? 'running' : 'idle');
            } else if (data.type === 'worker_status') {
                const status = (data.status ?? data.payload?.status ?? 'unknown') as WorkerStatus;
                setWorkerStatus(status);
            } else if (data.type === 'simulation_assigned') {
                setActiveSimId(data.simId ?? null);
                setSimulationStatus('running');
                setDrones({});
                setPlannedPaths({});
                setPlannedPaths3d({});
                setSelectedDroneId(null);
                addLocalEvent('info', 'SIMULATION_ASSIGNED', `Simulation assigned to worker ${data.workerId ?? '-'}.`, data.timestamp);
            } else if (data.type === 'worker_busy') {
                setSimulationStatus('idle');
                addLocalEvent('warning', 'WORKER_BUSY', data.message ?? 'No idle worker available.', data.timestamp);
            } else if (data.type === 'simulation_finished') {
                const finishedStatus = data.payload?.status;
                setSimulationStatus(terminalToStatus(finishedStatus));
                setActiveSimId(null);
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
            } else if (data.type === 'latency_update') {
                setLatencyMs(data.latencyMs ?? null);
            } else if (data.type === 'config') {
                setMapConfig(data);
            } else if (data.type === 'telemetry') {
                const telemetry = (data.payload ?? data) as DroneTelemetry;
                const droneId = data.droneId ?? telemetry.droneId ?? 'drone_1';
                const nextTelemetry = { ...telemetry, droneId };
                setDrones(prev => ({ ...prev, [droneId]: nextTelemetry }));
                setSelectedDroneId(prev => prev ?? droneId);
                if (telemetry.status === 'paused') setSimulationStatus('paused');
                else if (telemetry.status && !['success', 'failed', 'emergency_landing'].includes(telemetry.status) && activeSimIdRef.current) {
                    setSimulationStatus('running');
                }
            } else if (data.type === 'wind_shadow_zones') {
                setWindShadowZones(data.payload?.zones ?? data.zones ?? []);
            } else if (data.type === 'planned_path') {
                const droneId = data.droneId ?? data.payload?.droneId ?? 'drone_1';
                setPlannedPaths(prev => ({ ...prev, [droneId]: data.payload?.path ?? data.path ?? [] }));
                setPlannedPaths3d(prev => ({ ...prev, [droneId]: data.payload?.path3d ?? data.path3d ?? [] }));
                setSelectedDroneId(prev => prev ?? droneId);
            } else if (data.type === 'event') {
                const payload = data.payload ?? {};
                const droneId = data.droneId ?? payload.droneId ?? null;
                setEventLogs(prev => [
                    {
                        droneId,
                        level: payload.level ?? 'info',
                        code: payload.code ?? 'UNKNOWN',
                        message: payload.message ?? '',
                        timestamp: data.timestamp ?? Date.now()
                    },
                    ...prev
                ].slice(0, 50));
            }
        };

        ws.onclose = () => {
            setServerStatus('disconnected');
            setWorkerStatus('disconnected');
            setSimulationStatus('stopped');
            setActiveSimId(null);
        };

        ws.onerror = () => {
            setServerStatus('disconnected');
        };

        return () => ws.close();
    }, [addLocalEvent]);

    return {
        serverStatus,
        workerStatus,
        simulationStatus,
        activeSimId,
        frontendId,
        latencyMs,
        drones,
        selectedDroneId,
        selectedDrone,
        setSelectedDroneId,
        mapConfig,
        plannedPaths,
        plannedPaths3d,
        selectedPlannedPath,
        selectedPath3d,
        windShadowZones,
        eventLogs,
        addLocalEvent,
        startSimulation,
        pauseSimulation: () => sendCommand('pause'),
        resumeSimulation: () => sendCommand('resume'),
        stopSimulation: () => sendCommand('stop'),
        resetSimulation: () => sendCommand('reset'),
        applyWeather,
        addObstacle,
        clearSessionVisuals
    };
}
