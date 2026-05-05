'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeoJsonObject } from 'geojson';
import TopStatusBar from './TopStatusBar';
import GcsSidebar from './GcsSidebar';
import UavMap from '../map/UavMap';
import { useSimulationSocket } from '../hooks/useSimulationSocket';
import { useTelemetryHistory } from '../hooks/useTelemetryHistory';
import {
    DEFAULT_LAYER_TOGGLES,
    type DynamicObstacle,
    type LatLng,
    type LayerToggles,
    type ObstacleConfig,
    type ObstacleType,
    type WeatherState
} from '../types/simulation';

export default function GcsDashboard() {
    const socket = useSimulationSocket();
    const telemetryHistory = useTelemetryHistory(socket.droneState);
    const addLocalEvent = socket.addLocalEvent;
    const [buildings, setBuildings] = useState<GeoJsonObject | null>(null);
    const [weather, setWeather] = useState<WeatherState>({ wind_dir: 0, wind_speed: 0, ambient_temp: 25, is_raining: false });
    const [obstacleConfig, setObstacleConfig] = useState<ObstacleConfig>({ radius: 8, height: 25, obstacleType: 'unknown' });
    const [dynamicObstacles, setDynamicObstacles] = useState<DynamicObstacle[]>([]);
    const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYER_TOGGLES);

    useEffect(() => {
        fetch('/hanoi_buildings.geojson')
            .then(res => res.json())
            .then(data => setBuildings(data))
            .catch(() => addLocalEvent('warning', 'BUILDINGS_LOAD_FAILED', 'Could not load building layer.'));
    }, [addLocalEvent]);

    const handleWeatherChange = useCallback((key: keyof WeatherState, value: number | boolean) => {
        setWeather(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleObstacleChange = useCallback((key: keyof ObstacleConfig, value: number | ObstacleType) => {
        setObstacleConfig(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleLayerToggle = useCallback((key: keyof LayerToggles) => {
        setLayers(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const handleMapClick = useCallback((latlng: LatLng) => {
        const obstacle = {
            pos: latlng,
            radius: obstacleConfig.radius,
            height: obstacleConfig.height,
            obstacleType: obstacleConfig.obstacleType
        };
        if (socket.addObstacle(obstacle)) {
            setDynamicObstacles(prev => [...prev, obstacle]);
        }
    }, [obstacleConfig, socket]);

    const handleReset = useCallback(() => {
        socket.resetSimulation();
        telemetryHistory.resetHistory();
        setDynamicObstacles([]);
    }, [socket, telemetryHistory]);

    const handleStop = useCallback(() => {
        socket.stopSimulation();
        telemetryHistory.resetHistory();
        setDynamicObstacles([]);
    }, [socket, telemetryHistory]);

    return (
        <div className="flex h-screen flex-col bg-slate-100 font-sans text-slate-800">
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
                @keyframes wind-blow {
                    from { transform: translateX(-140px); opacity: 0; }
                    15% { opacity: 0.75; }
                    85% { opacity: 0.75; }
                    to { transform: translateX(140px); opacity: 0; }
                }
            `}</style>
            <TopStatusBar
                serverStatus={socket.serverStatus}
                workerStatus={socket.workerStatus}
                simulationStatus={socket.simulationStatus}
                activeSimId={socket.activeSimId}
                frontendId={socket.frontendId}
                latencyMs={socket.latencyMs}
            />
            <div className="flex min-h-0 flex-1">
                <GcsSidebar
                    serverStatus={socket.serverStatus}
                    workerStatus={socket.workerStatus}
                    simulationStatus={socket.simulationStatus}
                    activeSimId={socket.activeSimId}
                    frontendId={socket.frontendId}
                    latencyMs={socket.latencyMs}
                    droneState={socket.droneState}
                    plannedPath3d={socket.plannedPath3d}
                    eventLogs={socket.eventLogs}
                    weather={weather}
                    obstacleConfig={obstacleConfig}
                    layers={layers}
                    batteryHistory={telemetryHistory.batteryHistory}
                    temperatureHistory={telemetryHistory.temperatureHistory}
                    altitudeHistory={telemetryHistory.altitudeHistory}
                    onStart={socket.startSimulation}
                    onPause={socket.pauseSimulation}
                    onResume={socket.resumeSimulation}
                    onStop={handleStop}
                    onReset={handleReset}
                    onWeatherChange={handleWeatherChange}
                    onApplyWeather={() => socket.applyWeather(weather)}
                    onObstacleChange={handleObstacleChange}
                    onLayerToggle={handleLayerToggle}
                />
                <main className="min-w-0 flex-1">
                    <UavMap
                        buildings={buildings}
                        mapConfig={socket.mapConfig}
                        droneState={socket.droneState}
                        plannedPath={socket.plannedPath}
                        pathHistory={telemetryHistory.pathHistory}
                        dynamicObstacles={dynamicObstacles}
                        windShadowZones={socket.windShadowZones}
                        layers={layers}
                        windDir={weather.wind_dir}
                        windSpeed={weather.wind_speed}
                        onMapClick={handleMapClick}
                    />
                </main>
            </div>
        </div>
    );
}
