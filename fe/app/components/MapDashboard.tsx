'use client'
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const droneIcon = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/683/683214.png', iconSize: [40, 40], iconAnchor: [20, 20] });
const startIcon = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/2555/2555572.png', iconSize: [35, 35], iconAnchor: [17, 35] });
const goalIcon = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/1409/1409014.png', iconSize: [35, 35], iconAnchor: [17, 35] });
const chargeIcon = new L.Icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/8803/8803273.png', iconSize: [30, 30], iconAnchor: [15, 30] });

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });

export default function MapDashboard() {
    const [mapConfig, setMapConfig] = useState<any>(null);
    const [droneState, setDroneState] = useState<any>(null);
    const [pathHistory, setPathHistory] = useState<[number, number][]>([]);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'config') {
                setMapConfig(data);
                setPathHistory([]);
            } 
            else if (data.type === 'telemetry') {
                setDroneState(data);
                if (data.pos) {
                    setPathHistory(prev => [...prev.slice(-200), [data.pos[0], data.pos[1]]]);
                }
            }
        };
        return () => ws.close();
    }, []);

    // Tọa độ mặc định nếu chưa nhận được gì
    const defaultCenter: [number, number] = [21.0285, 105.8542];
    const mapCenter = mapConfig ? mapConfig.start : defaultCenter;
    const currentPosition = droneState?.pos ? [droneState.pos[0], droneState.pos[1]] : mapCenter;

    return (
        <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
            {/* Sidebar Debug */}
            <div className="w-80 bg-white shadow-xl z-[1000] border-r border-slate-200 overflow-y-auto">
                <div className="p-5 bg-blue-600 text-white">
                    <h2 className="text-xl font-bold uppercase tracking-wider">UAV Ground Control</h2>
                </div>

                <div className="p-5 space-y-6">
                    <section>
                        <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">Thông số UAV</h3>
                        {droneState ? (
                            <div className="space-y-3">
                                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                                    <p className="text-xs text-blue-500 font-bold uppercase">Trạng thái</p>
                                    <p className="text-lg font-black text-blue-900">{droneState.status}</p>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <p className="text-xs text-slate-500 font-bold uppercase">Pin: {droneState.battery.toFixed(1)}%</p>
                                </div>
                                <div className="flex justify-between p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                    <p>Cao: <span className="font-bold">{droneState.altitude.toFixed(1)}m</span></p>
                                    <p>Nhiệt: <span className="font-bold">{droneState.temperature.toFixed(1)}°C</span></p>
                                </div>
                            </div>
                        ) : <div className="text-slate-400 text-sm animate-pulse italic">Đang đợi Telemetry...</div>}
                    </section>

                    <section className="border-t pt-5">
                        <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">YAML Config Đã Nạp</h3>
                        {mapConfig ? (
                            <div className="space-y-2 text-xs font-mono bg-slate-800 text-green-400 p-3 rounded-md shadow-inner">
                                <p>START: [{mapConfig.start[0].toFixed(4)}, {mapConfig.start[1].toFixed(4)}]</p>
                                <p>GOAL: [{mapConfig.goal[0].toFixed(4)}, {mapConfig.goal[1].toFixed(4)}]</p>
                                <p>STATIONS: {mapConfig.charging_stations.length} trạm</p>
                            </div>
                        ) : <div className="text-slate-400 text-sm italic">Đang đợi Config từ Python Worker...</div>}
                    </section>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative">
                <MapContainer center={mapCenter} zoom={15} className="h-full w-full">
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    
                    {/* Render động dựa trên dữ liệu server gửi qua */}
                    {mapConfig && (
                        <>
                            <Marker position={mapConfig.start} icon={startIcon}><Popup>XUẤT PHÁT</Popup></Marker>
                            <Marker position={mapConfig.goal} icon={goalIcon}><Popup>ĐÍCH ĐẾN</Popup></Marker>
                            {mapConfig.charging_stations.map((pos: [number, number], idx: number) => (
                                <Marker key={`charge-${idx}`} position={pos} icon={chargeIcon}>
                                    <Popup>Trạm sạc #{idx+1}</Popup>
                                </Marker>
                            ))}
                        </>
                    )}

                    <Polyline positions={pathHistory} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.6 }} />

                    {droneState && (
                        <Marker position={currentPosition as [number, number]} icon={droneIcon}>
                            <Popup>UAV-01 ({droneState.status})</Popup>
                        </Marker>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}