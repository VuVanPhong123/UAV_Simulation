'use client'
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false });

export default function MapDashboard() {
    const [droneState, setDroneState] = useState<any>(null);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setDroneState(data);
        };

        return () => ws.close();
    }, []);

    const position = droneState?.pos ? [droneState.pos[0] / 1000 + 21.0285, droneState.pos[1] / 1000 + 105.8542] : [21.0285, 105.8542];

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar thông số */}
            <div className="w-80 bg-white p-6 shadow-lg z-10 flex flex-col gap-4">
                <h2 className="text-xl font-bold border-b pb-2">UAV Telemetry</h2>
                {droneState ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex justify-between"><span>Trạng thái:</span> <span className="font-semibold uppercase text-blue-600">{droneState.status}</span></div>
                        <div className="flex justify-between"><span>Pin:</span> <span className={`${droneState.battery < 20 ? 'text-red-500' : 'text-green-500'} font-bold`}>{droneState.battery.toFixed(1)}%</span></div>
                        <div className="flex justify-between"><span>Độ cao:</span> <span>{droneState.altitude.toFixed(1)} m</span></div>
                        <div className="flex justify-between"><span>Nhiệt độ:</span> <span>{droneState.temperature.toFixed(1)} °C</span></div>
                        <div className="flex justify-between"><span>Tọa độ (Grid):</span> <span>({droneState.pos[0].toFixed(0)}, {droneState.pos[1].toFixed(0)})</span></div>
                    </div>
                ) : (
                    <p className="text-gray-500">Đang chờ kết nối dữ liệu...</p>
                )}
            </div>

            {/* Bản đồ Leaflet */}
            <div className="flex-1">
                <MapContainer center={[21.0285, 105.8542]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {droneState && (
                        <Marker position={position as any}>
                            <Popup>Drone hiện tại <br /> Pin: {droneState.battery.toFixed(1)}%</Popup>
                        </Marker>
                    )}
                </MapContainer>
            </div>
        </div>
    );
}