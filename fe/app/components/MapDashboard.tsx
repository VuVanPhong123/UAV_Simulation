'use client'
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const droneIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/683/683214.png',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
});

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });

const DEFAULT_CENTER: [number, number] = [21.0285, 105.8542];

export default function MapDashboard() {
    const [droneState, setDroneState] = useState<any>(null);
    const [pathHistory, setPathHistory] = useState<[number, number][]>([]);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setDroneState(data);
            
            if (data.pos) {
                setPathHistory(prev => [...prev.slice(-100), [data.pos[0], data.pos[1]]]);
            }
        };
        return () => ws.close();
    }, []);

    const currentPosition = droneState?.pos 
        ? [droneState.pos[0], droneState.pos[1]] 
        : DEFAULT_CENTER;

    return (
        <div className="flex h-screen bg-gray-900 text-white">
            <div className="w-80 bg-gray-800 p-6 shadow-2xl z-[1000] border-r border-gray-700">
                <h2 className="text-xl font-bold text-cyan-400 mb-4">GCS Telemetry</h2>
                {droneState ? (
                    <div className="space-y-4">
                        <div className="p-3 bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-400 uppercase">Trạng thái</p>
                            <p className="font-bold text-lg text-cyan-300">{droneState.status}</p>
                        </div>
                        <div className="p-3 bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-400 uppercase">Pin</p>
                            <p className={`font-bold text-lg ${droneState.battery < 20 ? 'text-red-500' : 'text-green-400'}`}>
                                {droneState.battery.toFixed(1)}%
                            </p>
                        </div>
                        <div className="p-3 bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-400 uppercase">Độ cao / Nhiệt độ</p>
                            <p className="font-mono">{droneState.altitude.toFixed(1)}m / {droneState.temperature.toFixed(1)}°C</p>
                        </div>
                        <div className="p-3 bg-gray-700 rounded-lg mt-4 border-t border-gray-600">
                            <p className="text-xs text-gray-400 uppercase">Tọa độ GPS</p>
                            <p className="font-mono text-sm">{droneState.pos[0].toFixed(5)}, {droneState.pos[1].toFixed(5)}</p>
                        </div>
                    </div>
                ) : <p className="animate-pulse">Waiting for telemetry...</p>}
            </div>

            <div className="flex-1 relative">
                <MapContainer center={DEFAULT_CENTER} zoom={16} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                    
                    {/* Vẽ vệt đường bay */}
                    <Polyline positions={pathHistory} pathOptions={{ color: '#00e5ff', weight: 4, opacity: 0.8 }} />

                    {/* Vẽ UAV */}
                    {droneState && (
                        <Marker position={currentPosition as [number, number]} icon={droneIcon}>
                            <Popup>UAV-01: {droneState.status}</Popup>
                        </Marker>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}