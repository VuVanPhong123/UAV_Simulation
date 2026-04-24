'use client'
import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import WindOverlay from './WindOverlay';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then(mod => mod.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false });
const MapEvents = dynamic(() => import('./MapEvents'), { ssr: false });

export default function MapDashboard() {
    const [buildings, setBuildings] = useState<any>(null);
    const [droneState, setDroneState] = useState<any>(null);
    const [mapConfig, setMapConfig] = useState<any>(null);
    const [pathHistory, setPathHistory] = useState<[number, number][]>([]);
    const [dynamicObstacles, setDynamicObstacles] = useState<[number, number][]>([]);
    const [windShadowZones, setWindShadowZones] = useState<[number, number][]>([]);
    const [weather, setWeather] = useState({ wind_dir: 0, wind_speed: 0, ambient_temp: 25 });
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        fetch('/hanoi_buildings.geojson')
            .then(res => res.json())
            .then(data => setBuildings(data));

        wsRef.current = new WebSocket('ws://localhost:8080');
        wsRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'config') {
                setMapConfig(data);
                setPathHistory([]);
                setWindShadowZones([]);
            } else if (data.type === 'telemetry') {
                setDroneState(data);
                if (data.pos) {
                    setPathHistory(prev => [...prev.slice(-300), [data.pos[0], data.pos[1]]]);
                }
            } else if (data.type === 'wind_shadow_zones') {
                setWindShadowZones(data.zones);
            }
        };
        return () => wsRef.current?.close();
    }, []);

    const handleMapClick = (latlng: [number, number]) => {
        setDynamicObstacles(prev => [...prev, latlng]);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'add_obstacle', pos: latlng }));
        }
    };

    const sendCommand = (action: 'start' | 'reset') => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'command', action }));
            if (action === 'reset') {
                setDynamicObstacles([]);
                setPathHistory([]);
                setWindShadowZones([]);
            }
        }
    };

    const handleWeatherChange = (key: string, value: number) => {
        setWeather(prev => ({ ...prev, [key]: value }));
    };

    const applyWeatherUpdate = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'weather_update',
                ...weather
            }));
            console.log("Da xac nhan va gui thong so moi truong:", weather);
        }
    };

    const defaultCenter: [number, number] = [21.0285, 105.8542];
    const mapCenter = mapConfig ? mapConfig.start : defaultCenter;

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

                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => sendCommand('start')}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-sm transition-all"
                    >
                        BAT DAU BAY
                    </button>
                    <button
                        onClick={() => sendCommand('reset')}
                        className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 px-4 rounded shadow-sm transition-all"
                    >
                        LAM MOI (RESET)
                    </button>
                </div>

                <div className="flex flex-col gap-3 p-4 bg-white rounded border border-slate-200 mt-4">
                    <h3 className="text-sm font-bold text-slate-700 border-b pb-2">Thoi tiet & Moi truong</h3>

                    <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-600">Huong gio: {weather.wind_dir}°</label>
                        <input
                            type="range"
                            min="0"
                            max="360"
                            value={weather.wind_dir}
                            onChange={(e) => handleWeatherChange('wind_dir', parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-600">Toc do gio: {weather.wind_speed} m/s</label>
                        <input
                            type="range"
                            min="0"
                            max="25"
                            value={weather.wind_speed}
                            onChange={(e) => handleWeatherChange('wind_speed', parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-600">Nhiet do: {weather.ambient_temp}°C</label>
                        <input
                            type="range"
                            min="-10"
                            max="50"
                            value={weather.ambient_temp}
                            onChange={(e) => handleWeatherChange('ambient_temp', parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <button
                        onClick={applyWeatherUpdate}
                        className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded shadow-sm text-xs transition-colors"
                    >
                        AP DUNG THOI TIET
                    </button>
                </div>

                {droneState ? (
                    <div className="space-y-4">
                        <div className="p-3 bg-white rounded border border-slate-200">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Trang thai</p>
                            <p className="font-mono text-blue-600 font-bold">{droneState.status}</p>
                        </div>
                        <div className="p-3 bg-white rounded border border-slate-200">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Pin / Do cao</p>
                            <p className="font-mono font-bold text-slate-700">
                                {droneState.battery.toFixed(1)}% / {droneState.altitude}m
                            </p>
                        </div>
                    </div>
                ) : <p className="italic text-slate-400 text-sm">Dang cho telemetry...</p>}
            </div>

            <div className="flex-1 relative overflow-hidden bg-slate-100">
                <WindOverlay windDir={weather.wind_dir} windSpeed={weather.wind_speed} />

                <MapContainer center={mapCenter} zoom={17} className="h-full w-full z-10">
                    <MapEvents onMapClick={handleMapClick} />
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />

                    {buildings && (
                        <GeoJSON
                            data={buildings}
                            style={() => ({ color: '#94a3b8', weight: 1, fillColor: '#e2e8f0', fillOpacity: 0.6 })}
                            onEachFeature={(feature, layer) => {
                                if (feature.properties?.estimated_height) {
                                    layer.bindTooltip(
                                        `${feature.properties.estimated_height}m`,
                                        { permanent: true, direction: 'center', className: 'building-label' }
                                    );
                                }
                            }}
                        />
                    )}

                    <Polyline positions={pathHistory} pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.7, dashArray: '5, 10' }} />

                    {windShadowZones.map((pos, idx) => (
                        <CircleMarker
                            key={`shadow-${idx}`}
                            center={pos}
                            radius={2}
                            pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.5 }}
                        />
                    ))}

                    {mapConfig && (
                        <>
                            <CircleMarker center={mapConfig.start} radius={6} pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 1 }}>
                                <Tooltip>START</Tooltip>
                            </CircleMarker>
                            <CircleMarker center={mapConfig.goal} radius={6} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 1 }}>
                                <Tooltip>GOAL</Tooltip>
                            </CircleMarker>
                            {mapConfig.no_fly_zones && mapConfig.no_fly_zones.map((nfz: any, idx: number) => (
                                <Circle
                                    key={`nfz-${idx}`}
                                    center={nfz.center}
                                    radius={nfz.radius}
                                    pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, dashArray: '5, 5' }}
                                >
                                    <Tooltip direction="center" permanent className="building-label !text-red-700 !bg-transparent">
                                        NO FLY ZONE
                                    </Tooltip>
                                </Circle>
                            ))}
                            {mapConfig.charging_stations.map((pos: [number, number], idx: number) => (
                                <CircleMarker key={idx} center={pos} radius={5} pathOptions={{ color: '#eab308', fillColor: '#eab308', fillOpacity: 1 }}>
                                    <Tooltip permanent className="building-label" direction="top">Tram {idx + 1}</Tooltip>
                                </CircleMarker>
                            ))}
                        </>
                    )}

                    {dynamicObstacles.map((pos, idx) => (
                        <Circle key={`dyn-obs-${idx}`} center={pos} radius={2} pathOptions={{ color: '#f97316', fillColor: '#f97316', fillOpacity: 0.5 }} />
                    ))}

                    {droneState && (
                        <>
                            <Circle
                                center={droneState.pos}
                                radius={30}
                                pathOptions={{
                                    color: '#60a5fa',
                                    fillColor: '#93c5fd',
                                    fillOpacity: 0.15,
                                    weight: 1,
                                    dashArray: '4, 4'
                                }}
                            />
                            <CircleMarker
                                center={droneState.pos}
                                radius={8}
                                pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1, weight: 2 }}
                            >
                                <Tooltip permanent direction="bottom" className="building-label">UAV</Tooltip>
                            </CircleMarker>
                        </>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}