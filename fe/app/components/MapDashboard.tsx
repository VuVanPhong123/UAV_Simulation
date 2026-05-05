'use client'
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import WindOverlay from './WindOverlay';
import type { Feature, GeoJsonObject, GeoJsonProperties, Geometry } from 'geojson';
import type { Layer } from 'leaflet';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then(mod => mod.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false });
const MapEvents = dynamic(() => import('./MapEvents'), { ssr: false });

type LatLng = [number, number];

type TelemetryState = {
    pos?: LatLng;
    battery?: number;
    batteryPercent?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    temperature?: number;
    status?: string;
    step?: number;
    windDir?: number;
    windSpeed?: number;
    ambientTemp?: number;
    isRaining?: boolean;
};

type MapConfig = {
    start: LatLng;
    goal: LatLng;
    charging_stations?: LatLng[];
    no_fly_zones?: { center: LatLng; radius: number }[];
};

type EventLog = {
    timestamp?: number;
    level: string;
    code: string;
    message: string;
};

type IncomingMessage = {
    type?: string;
    timestamp?: number;
    role?: string;
    clientId?: string;
    server?: string;
    workerStatus?: WorkerStatus;
    activeSimId?: string | null;
    simId?: string | null;
    workerId?: string;
    status?: string;
    message?: string;
    latencyMs?: number;
    payload?: TelemetryState & { zones?: LatLng[]; path?: LatLng[]; level?: string; code?: string; message?: string; status?: string };
    pos?: LatLng;
    zones?: LatLng[];
    path?: LatLng[];
};

type ServerStatus = 'connecting' | 'connected' | 'disconnected';
type WorkerStatus = 'idle' | 'busy' | 'disconnected' | 'error' | 'unknown';
type SimulationStatus = 'idle' | 'running' | 'stopped' | 'failed';
type ObstacleType = 'unknown' | 'tree' | 'pole' | 'bird' | 'building_crane';
type DynamicObstacle = LatLng | {
    pos: LatLng;
    radius: number;
    height: number;
    obstacleType: ObstacleType;
};

export default function MapDashboard() {
    const [buildings, setBuildings] = useState<GeoJsonObject | null>(null);
    const [droneState, setDroneState] = useState<TelemetryState | null>(null);
    const [mapConfig, setMapConfig] = useState<MapConfig | null>(null);
    const [pathHistory, setPathHistory] = useState<[number, number][]>([]);
    const [eventLogs, setEventLogs] = useState<EventLog[]>([]);

    const [plannedPath, setPlannedPath] = useState<[number, number][]>([]);

    const [dynamicObstacles, setDynamicObstacles] = useState<DynamicObstacle[]>([]);
    const [windShadowZones, setWindShadowZones] = useState<[number, number][]>([]);
    const [weather, setWeather] = useState({ wind_dir: 0, wind_speed: 0, ambient_temp: 25, is_raining: false });
    const [obstacleConfig, setObstacleConfig] = useState({
        radius: 8,
        height: 25,
        obstacleType: 'unknown' as ObstacleType
    });
    const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus>('unknown');
    const [simulationStatus, setSimulationStatus] = useState<SimulationStatus>('idle');
    const [activeSimId, setActiveSimId] = useState<string | null>(null);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [frontendId, setFrontendId] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const addEventLog = useCallback((level: string, code: string, message: string, timestamp?: number) => {
        setEventLogs(prev => [
            {
                timestamp: timestamp ?? Date.now(),
                level,
                code,
                message
            },
            ...prev
        ].slice(0, 50));
    }, []);

    useEffect(() => {
        fetch('/hanoi_buildings.geojson')
            .then(res => res.json())
            .then(data => setBuildings(data));

        const ws = new WebSocket('ws://localhost:8080');
        wsRef.current = ws;

        ws.onopen = () => {
            setServerStatus('connected');
            ws.send(JSON.stringify({
                type: 'register',
                role: 'frontend'
            }));
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
                addEventLog('info', 'SIMULATION_ASSIGNED', `Simulation assigned to worker ${data.workerId ?? '-'}.`, data.timestamp);
            } else if (data.type === 'worker_busy') {
                setSimulationStatus('idle');
                addEventLog('warning', 'WORKER_BUSY', data.message ?? 'Không có worker rảnh để chạy simulation.', data.timestamp);
            } else if (data.type === 'simulation_finished') {
                const finishedStatus = data.payload?.status;
                setSimulationStatus(finishedStatus === 'success' ? 'stopped' : 'failed');
                setActiveSimId(null);
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: data.timestamp
                }));
            } else if (data.type === 'latency_update') {
                setLatencyMs(data.latencyMs ?? null);
            } else if (data.type === 'config') {
                setMapConfig(data);
                setPathHistory([]);
            } else if (data.type === 'telemetry') {
                const telemetry = data.payload ?? data;
                setDroneState(telemetry);
                const pos = telemetry.pos;
                if (pos) {
                    setPathHistory(prev => [...prev.slice(-300), [pos[0], pos[1]]]);
                }
            } else if (data.type === 'wind_shadow_zones') {
                const zones = data.payload?.zones ?? data.zones ?? [];
                setWindShadowZones(zones);
            }
            else if (data.type === 'planned_path') {
                const path = data.payload?.path ?? data.path ?? [];
                setPlannedPath(path);
            } else if (data.type === 'event') {
                const eventPayload = data.payload ?? {};
                addEventLog(
                    eventPayload.level ?? "info",
                    eventPayload.code ?? "UNKNOWN",
                    eventPayload.message ?? "",
                    data.timestamp
                );
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
    }, [addEventLog]);

    const handleMapClick = (latlng: [number, number]) => {
        if (!activeSimId) {
            addEventLog('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before adding obstacles.');
            return;
        }
        const obstacle = {
            pos: latlng,
            radius: obstacleConfig.radius,
            height: obstacleConfig.height,
            obstacleType: obstacleConfig.obstacleType
        };
        setDynamicObstacles(prev => [...prev, obstacle]);
        wsRef.current?.send(JSON.stringify({
            type: 'add_obstacle',
            simId: activeSimId,
            payload: obstacle
        }));
    };

    const sendCommand = (action: 'start' | 'reset') => {
        if (action === 'start') {
            wsRef.current?.send(JSON.stringify({
                type: 'request_start_simulation',
                payload: {
                    mapId: 'hanoi_default',
                    droneCount: 1
                }
            }));
            return;
        }

        if (!activeSimId) {
            addEventLog('warning', 'NO_ACTIVE_SIMULATION', 'No active simulation to reset.');
            return;
        }

        wsRef.current?.send(JSON.stringify({ type: 'command', simId: activeSimId, action }));
        if (action === 'reset') {
            setDynamicObstacles([]);
            setPathHistory([]);
            setWindShadowZones([]);
            setPlannedPath([]);
        }
    };

    const handleWeatherChange = (key: keyof typeof weather, value: number | boolean) => {
        setWeather(prev => ({ ...prev, [key]: value }));
    };

    const handleObstacleChange = (key: keyof typeof obstacleConfig, value: number | ObstacleType) => {
        setObstacleConfig(prev => ({ ...prev, [key]: value }));
    };

    const applyWeatherUpdate = () => {
        if (!activeSimId) {
            addEventLog('warning', 'NO_ACTIVE_SIMULATION', 'Start a simulation before changing weather.');
            return;
        }
        wsRef.current?.send(JSON.stringify({
            type: 'weather_update',
            simId: activeSimId,
            ...weather,
            payload: {
                wind_dir: weather.wind_dir,
                wind_speed: weather.wind_speed,
                ambient_temp: weather.ambient_temp,
                is_raining: weather.is_raining
            }
        }));
    };

    const defaultCenter: [number, number] = [21.0285, 105.8542];
    const mapCenter = mapConfig ? mapConfig.start : defaultCenter;
    const battery = droneState?.batteryPercent ?? droneState?.battery;
    const startDisabled = serverStatus !== 'connected' || workerStatus !== 'idle' || simulationStatus === 'running';
    const resetDisabled = !activeSimId;
    const droneStatus = droneState?.status;
    const droneColor = droneStatus === 'failed' || droneStatus === 'emergency_landing'
        ? '#dc2626'
        : droneStatus === 'charging'
            ? '#f59e0b'
            : droneStatus === 'success'
                ? '#16a34a'
                : '#2563eb';
    const droneHaloColor = droneStatus === 'failed' || droneStatus === 'emergency_landing'
        ? '#fca5a5'
        : droneStatus === 'charging'
            ? '#fde68a'
            : droneStatus === 'success'
                ? '#86efac'
                : '#93c5fd';
    const eventLevelClass = (level: string) => {
        if (level === 'error') return 'text-red-600';
        if (level === 'warning') return 'text-amber-600';
        if (level === 'success') return 'text-emerald-600';
        return 'text-slate-600';
    };

    const sampledZones = useMemo(() => {
        if (windShadowZones.length <= 2000) return windShadowZones;
        const step = Math.ceil(windShadowZones.length / 2000);
        return windShadowZones.filter((_, idx) => idx % step === 0);
    }, [windShadowZones]);

    const staticMapLayers = useMemo(() => {
        return (
            <>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />
                {buildings && <GeoJSON data={buildings} style={() => ({ color: '#94a3b8', weight: 1, fillColor: '#e2e8f0', fillOpacity: 0.6 })} onEachFeature={(feature: Feature<Geometry, GeoJsonProperties>, layer: Layer) => { if (feature.properties?.estimated_height) layer.bindTooltip(`${feature.properties.estimated_height}m`, { permanent: true, direction: 'center', className: 'building-label' }); }} />}

                {mapConfig && (
                    <>
                        <CircleMarker center={mapConfig.start} radius={6} pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 1 }}><Tooltip>START</Tooltip></CircleMarker>
                        <CircleMarker center={mapConfig.goal} radius={6} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 1 }}><Tooltip>GOAL</Tooltip></CircleMarker>
                        {mapConfig.no_fly_zones?.map((nfz, idx: number) => <Circle key={`nfz-${idx}`} center={nfz.center} radius={nfz.radius} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, dashArray: '5,5' }}><Tooltip direction="center" permanent className="building-label !text-red-700 !bg-transparent">NO FLY ZONE</Tooltip></Circle>)}
                        {mapConfig.charging_stations?.map((pos: [number, number], idx: number) => <CircleMarker key={idx} center={pos} radius={5} pathOptions={{ color: '#eab308', fillColor: '#eab308', fillOpacity: 1 }}><Tooltip permanent className="building-label" direction="top">Tram {idx + 1}</Tooltip></CircleMarker>)}
                    </>
                )}
            </>
        );
    }, [buildings, mapConfig]);

    return (
        <div className="flex h-screen bg-white font-sans text-slate-800">
            <style>{`
                .building-label {
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                    font-weight: 800 !important;
                    font-size: 10px !important;
                    color: #475569 !important;
                    text-shadow: 1px 1px 0px #fff, -1px -1px 0px #fff, 1px -1px 0px #fff, -1px 1px 0px #fff;
                }
            `}</style>

            <div className="w-64 border-r border-slate-200 p-6 z-[1000] bg-slate-50 flex flex-col gap-6">
                <h2 className="text-lg font-bold border-b pb-2 text-slate-700">UAV Control</h2>
                <div className="p-3 bg-white rounded border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 border-b pb-2">Connection</h3>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                        <span>Server</span><span>{serverStatus}</span>
                        <span>Worker</span><span>{workerStatus}</span>
                        <span>Sim</span><span>{simulationStatus}</span>
                        <span>Sim ID</span><span>{activeSimId ?? '-'}</span>
                        <span>Ping</span><span>{latencyMs !== null ? `${latencyMs}ms` : '-'}</span>
                        <span>FE</span><span>{frontendId ?? '-'}</span>
                    </div>
                </div>
                <div className="flex flex-col gap-3">
                    <button disabled={startDisabled} onClick={() => sendCommand('start')} className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold py-2 px-4 rounded shadow-sm transition-all">BAT DAU BAY</button>
                    <button disabled={resetDisabled} onClick={() => sendCommand('reset')} className="bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 font-bold py-2 px-4 rounded shadow-sm transition-all">LAM MOI (RESET)</button>
                </div>
                <div className="flex flex-col gap-3 p-4 bg-white rounded border border-slate-200 mt-4">
                    <h3 className="text-sm font-bold text-slate-700 border-b pb-2">Thoi tiet & Moi truong</h3>
                    <p className="text-[11px] font-medium text-slate-500">Huong gio = huong gio thoi toi.</p>
                    <div className="flex flex-col gap-1"><label className="text-[11px] font-semibold text-slate-600">Huong gio: {weather.wind_dir}°</label><input type="range" min="0" max="360" value={weather.wind_dir} onChange={e => handleWeatherChange('wind_dir', parseInt(e.target.value))} className="w-full" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[11px] font-semibold text-slate-600">Toc do gio: {weather.wind_speed} m/s</label><input type="range" min="0" max="25" value={weather.wind_speed} onChange={e => handleWeatherChange('wind_speed', parseInt(e.target.value))} className="w-full" /></div>
                    <div className="flex flex-col gap-1"><label className="text-[11px] font-semibold text-slate-600">Nhiet do: {weather.ambient_temp}°C</label><input type="range" min="-10" max="50" value={weather.ambient_temp} onChange={e => handleWeatherChange('ambient_temp', parseInt(e.target.value))} className="w-full" /></div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={weather.is_raining} onChange={e => handleWeatherChange('is_raining', e.target.checked)} />
                        Rain
                    </label>
                    <button onClick={applyWeatherUpdate} className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-xs transition-colors">AP DUNG THOI TIET</button>
                </div>
                <div className="flex flex-col gap-3 p-4 bg-white rounded border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 border-b pb-2">Obstacle</h3>
                    <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-600">Radius: {obstacleConfig.radius}m</label>
                        <input type="range" min="2" max="30" value={obstacleConfig.radius} onChange={e => handleObstacleChange('radius', parseInt(e.target.value))} className="w-full" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-600">Height: {obstacleConfig.height}m</label>
                        <input type="range" min="5" max="120" value={obstacleConfig.height} onChange={e => handleObstacleChange('height', parseInt(e.target.value))} className="w-full" />
                    </div>
                    <select value={obstacleConfig.obstacleType} onChange={e => handleObstacleChange('obstacleType', e.target.value as ObstacleType)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                        <option value="unknown">unknown</option>
                        <option value="tree">tree</option>
                        <option value="pole">pole</option>
                        <option value="bird">bird</option>
                        <option value="building_crane">building_crane</option>
                    </select>
                </div>
                {droneState ? (
                    <div className="space-y-4">
                        <div className="p-3 bg-white rounded border border-slate-200"><p className="text-[10px] uppercase font-bold text-slate-400">Trang thai</p><p className={`font-mono font-bold ${droneState.status === 'failed' || droneState.status === 'emergency_landing' ? 'text-red-600' : droneState.status === 'charging' ? 'text-amber-600' : droneState.status === 'success' ? 'text-emerald-600' : 'text-blue-600'}`}>{droneState.status}</p></div>
                        <div className="p-3 bg-white rounded border border-slate-200">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Telemetry</p>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                                <span>Pin</span><span>{battery !== undefined ? Number(battery).toFixed(1) : '--'}%</span>
                                <span>Do cao</span><span>{droneState.altitude ?? '--'}m</span>
                                <span>Toc do</span><span>{droneState.speed ?? '--'}m/s</span>
                                <span>Heading</span><span>{droneState.heading !== undefined ? Number(droneState.heading).toFixed(1) : '--'}°</span>
                                <span>Nhiet do</span><span>{droneState.temperature !== undefined ? Number(droneState.temperature).toFixed(1) : '--'}°C</span>
                                <span>Wind</span><span>{droneState.windSpeed !== undefined ? `${Number(droneState.windSpeed).toFixed(1)}m/s` : '--'}</span>
                                <span>Wind to</span><span>{droneState.windDir !== undefined ? `${Number(droneState.windDir).toFixed(0)}°` : '--'}</span>
                                <span>Ambient</span><span>{droneState.ambientTemp !== undefined ? `${Number(droneState.ambientTemp).toFixed(1)}°C` : '--'}</span>
                                <span>Rain</span><span>{droneState.isRaining ? 'on' : 'off'}</span>
                                <span>Step</span><span>{droneState.step ?? '--'}</span>
                            </div>
                        </div>
                    </div>
                ) : <p className="italic text-slate-400 text-sm">Dang cho telemetry...</p>}
                <div className="p-3 bg-white rounded border border-slate-200 min-h-0">
                    <h3 className="text-sm font-bold text-slate-700 border-b pb-2">Event Log</h3>
                    <div className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
                        {eventLogs.slice(0, 10).map((log, idx) => (
                            <div key={`${log.timestamp ?? 'event'}-${idx}`} className="text-xs leading-snug">
                                <span className={`font-bold uppercase ${eventLevelClass(log.level)}`}>{log.level}</span>
                                <span className="font-mono text-slate-500"> {log.code}</span>
                                <p className="text-slate-700">{log.message}</p>
                            </div>
                        ))}
                        {eventLogs.length === 0 && <p className="italic text-slate-400 text-sm">Chua co event...</p>}
                    </div>
                </div>
            </div>

            <div className="flex-1 relative overflow-hidden bg-slate-100">
                <WindOverlay windDir={weather.wind_dir} windSpeed={weather.wind_speed} />
                <MapContainer center={mapCenter} zoom={17} preferCanvas={true} className="h-full w-full z-10">
                    <MapEvents onMapClick={handleMapClick} />
                    {staticMapLayers}

                    {plannedPath.length > 0 && (
                        <Polyline
                            positions={plannedPath}
                            pathOptions={{
                                color: '#f97316',
                                weight: 4,
                                opacity: 0.8,
                                dashArray: '8, 8'
                            }}
                        />
                    )}

                    <Polyline positions={pathHistory} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7 }} />

                    {sampledZones.map((pos, idx) => <CircleMarker key={`shadow-${idx}`} center={pos} radius={2} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.5 }} />)}
                    {dynamicObstacles.map((obstacle, idx) => {
                        const pos = Array.isArray(obstacle) ? obstacle : obstacle.pos;
                        const radius = Array.isArray(obstacle) ? 2 : obstacle.radius;
                        const height = Array.isArray(obstacle) ? undefined : obstacle.height;
                        const obstacleType = Array.isArray(obstacle) ? 'unknown' : obstacle.obstacleType;
                        return (
                            <Circle key={`dyn-obs-${idx}`} center={pos} radius={radius} pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.35 }}>
                                <Tooltip>{height !== undefined ? `${obstacleType} / h ${height}m / r ${radius}m` : 'obstacle'}</Tooltip>
                            </Circle>
                        );
                    })}

                    {droneState?.pos && (
                        <>
                            <Circle center={droneState.pos} radius={30} pathOptions={{ color: droneHaloColor, fillColor: droneHaloColor, fillOpacity: 0.15, weight: 1, dashArray: '4,4' }} />
                            <CircleMarker center={droneState.pos} radius={8} pathOptions={{ color: droneColor, fillColor: droneColor, fillOpacity: 1, weight: 2 }}><Tooltip permanent direction="bottom" className="building-label">UAV</Tooltip></CircleMarker>
                        </>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}
