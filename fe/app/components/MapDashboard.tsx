'use client'
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then(mod => mod.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });

export default function MapDashboard() {
    const [buildings, setBuildings] = useState<any>(null);
    const [droneState, setDroneState] = useState<any>(null);
    const [mapConfig, setMapConfig] = useState<any>(null);
    const [pathHistory, setPathHistory] = useState<[number, number][]>([]);

    useEffect(() => {
        fetch('/hanoi_buildings.geojson')
            .then(res => res.json())
            .then(data => setBuildings(data));
        
        const ws = new WebSocket('ws://localhost:8080');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'config') {
                setMapConfig(data);
                setPathHistory([]);
            } else if (data.type === 'telemetry') {
                setDroneState(data);
                if (data.pos) {
                    setPathHistory(prev => [...prev.slice(-300), [data.pos[0], data.pos[1]]]);
                }
            }
        };
        return () => ws.close();
    }, []);

    const defaultCenter: [number, number] = [21.0285, 105.8542];
    const mapCenter = mapConfig ? mapConfig.start : defaultCenter;

    return (
        <div className="flex h-screen bg-white font-sans text-slate-800">
            {/* CSS Tùy chỉnh cho Nhãn độ cao */}
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
                {droneState ? (
                    <div className="space-y-4">
                        <div className="p-3 bg-white rounded border border-slate-200">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Trạng thái</p>
                            <p className="font-mono text-blue-600 font-bold">{droneState.status}</p>
                        </div>
                        <div className="p-3 bg-white rounded border border-slate-200">
                            <p className="text-[10px] uppercase font-bold text-slate-400">Pin / Độ cao</p>
                            <p className="font-mono font-bold text-slate-700">
                                {droneState.battery.toFixed(1)}% / {droneState.altitude}m
                            </p>
                        </div>
                    </div>
                ) : <p className="italic text-slate-400 text-sm">Đang chờ telemetry...</p>}
            </div>

            <div className="flex-1 relative">
                <MapContainer center={mapCenter} zoom={17} className="h-full w-full">
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />

                    {buildings && (
                        <GeoJSON 
                            data={buildings} 
                            style={() => ({ color: '#94a3b8', weight: 1, fillColor: '#e2e8f0', fillOpacity: 0.6 })}
                            onEachFeature={(feature, layer) => {
                                // Gắn số độ cao kèm chữ 'm' lên từng khối nhà
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

                    {mapConfig && (
                        <>
                            <CircleMarker center={mapConfig.start} radius={6} pathOptions={{ color: 'green', fillColor: 'green', fillOpacity: 1 }}>
                                <Tooltip>START</Tooltip>
                            </CircleMarker>
                            <CircleMarker center={mapConfig.goal} radius={6} pathOptions={{ color: 'red', fillColor: 'red', fillOpacity: 1 }}>
                                <Tooltip>GOAL</Tooltip>
                            </CircleMarker>
                            {mapConfig.charging_stations.map((pos: [number, number], idx: number) => (
                                <CircleMarker key={idx} center={pos} radius={5} pathOptions={{ color: '#eab308', fillColor: '#eab308', fillOpacity: 1 }}>
                                    <Tooltip permanent className="building-label" direction="top">Trạm {idx+1}</Tooltip>
                                </CircleMarker>
                            ))}
                        </>
                    )}

                    {droneState && (
                        <CircleMarker center={droneState.pos} radius={8} pathOptions={{ color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1, weight: 2 }}>
                            <Tooltip permanent direction="bottom" className="building-label">UAV</Tooltip>
                        </CircleMarker>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}