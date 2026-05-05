'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { Feature, GeoJsonObject, GeoJsonProperties, Geometry } from 'geojson';
import type { Layer } from 'leaflet';
import MapEvents from './MapEvents';
import WindOverlay from './WindOverlay';
import type {
    DroneTelemetry,
    DynamicObstacle,
    LatLng,
    LayerToggles,
    MapConfig
} from '../types/simulation';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then(mod => mod.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false });

type UavMapProps = {
    buildings: GeoJsonObject | null;
    mapConfig: MapConfig | null;
    droneState: DroneTelemetry | null;
    plannedPath: LatLng[];
    pathHistory: LatLng[];
    dynamicObstacles: DynamicObstacle[];
    windShadowZones: LatLng[];
    layers: LayerToggles;
    windDir: number;
    windSpeed: number;
    onMapClick: (latlng: LatLng) => void;
};

function droneColors(status?: string) {
    if (status === 'failed' || status === 'emergency_landing') {
        return { color: '#dc2626', halo: '#fca5a5' };
    }
    if (status === 'charging') return { color: '#f59e0b', halo: '#fde68a' };
    if (status === 'success') return { color: '#16a34a', halo: '#86efac' };
    if (status === 'paused') return { color: '#64748b', halo: '#cbd5e1' };
    if (status === 'rerouting' || status === 'planning') return { color: '#f97316', halo: '#fed7aa' };
    return { color: '#2563eb', halo: '#93c5fd' };
}

export default function UavMap({
    buildings,
    mapConfig,
    droneState,
    plannedPath,
    pathHistory,
    dynamicObstacles,
    windShadowZones,
    layers,
    windDir,
    windSpeed,
    onMapClick
}: UavMapProps) {
    const defaultCenter: LatLng = [21.0285, 105.8542];
    const mapCenter = mapConfig ? mapConfig.start : defaultCenter;
    const colors = droneColors(droneState?.status);
    const sampledZones = useMemo(() => {
        if (windShadowZones.length <= 2000) return windShadowZones;
        const step = Math.ceil(windShadowZones.length / 2000);
        return windShadowZones.filter((_, idx) => idx % step === 0);
    }, [windShadowZones]);

    return (
        <div className="relative h-full w-full overflow-hidden bg-slate-100">
            {layers.weatherOverlay && <WindOverlay windDir={windDir} windSpeed={windSpeed} />}
            <MapContainer center={mapCenter} zoom={17} preferCanvas={true} className="h-full w-full z-10">
                <MapEvents onMapClick={onMapClick} />
                <TileLayer url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png" />

                {layers.buildings && buildings && (
                    <GeoJSON
                        key={`buildings-${layers.buildingLabels ? 'labels' : 'plain'}`}
                        data={buildings}
                        style={() => ({ color: '#94a3b8', weight: 1, fillColor: '#e2e8f0', fillOpacity: 0.6 })}
                        onEachFeature={(feature: Feature<Geometry, GeoJsonProperties>, layer: Layer) => {
                            if (layers.buildingLabels && feature.properties?.estimated_height) {
                                layer.bindTooltip(`${feature.properties.estimated_height}m`, {
                                    permanent: true,
                                    direction: 'center',
                                    className: 'building-label'
                                });
                            }
                        }}
                    />
                )}

                {mapConfig && (
                    <>
                        <CircleMarker center={mapConfig.start} radius={6} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }}>
                            <Tooltip>START</Tooltip>
                        </CircleMarker>
                        <CircleMarker center={mapConfig.goal} radius={6} pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }}>
                            <Tooltip>GOAL</Tooltip>
                        </CircleMarker>
                        {layers.noFlyZones && mapConfig.no_fly_zones?.map((nfz, idx) => (
                            <Circle key={`nfz-${idx}`} center={nfz.center} radius={nfz.radius} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, dashArray: '5,5' }}>
                                <Tooltip direction="center" permanent className="building-label !text-red-700 !bg-transparent">NO FLY ZONE</Tooltip>
                            </Circle>
                        ))}
                        {layers.chargingStations && mapConfig.charging_stations?.map((pos, idx) => (
                            <CircleMarker key={`station-${idx}`} center={pos} radius={5} pathOptions={{ color: '#eab308', fillColor: '#eab308', fillOpacity: 1 }}>
                                <Tooltip permanent className="building-label" direction="top">Station {idx + 1}</Tooltip>
                            </CircleMarker>
                        ))}
                    </>
                )}

                {layers.plannedPath && plannedPath.length > 0 && (
                    <Polyline positions={plannedPath} pathOptions={{ color: '#f97316', weight: 4, opacity: 0.8, dashArray: '8, 8' }} />
                )}

                {layers.pathHistory && pathHistory.length > 0 && (
                    <Polyline positions={pathHistory} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.7 }} />
                )}

                {layers.windShadow && sampledZones.map((pos, idx) => (
                    <CircleMarker key={`shadow-${idx}`} center={pos} radius={2} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.5 }} />
                ))}

                {layers.dynamicObstacles && dynamicObstacles.map((obstacle, idx) => {
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
                        {layers.sensorRange && (
                            <Circle center={droneState.pos} radius={30} pathOptions={{ color: colors.halo, fillColor: colors.halo, fillOpacity: 0.12, weight: 1, dashArray: '4,4' }} />
                        )}
                        <CircleMarker center={droneState.pos} radius={8} pathOptions={{ color: colors.color, fillColor: colors.color, fillOpacity: 1, weight: 2 }}>
                            <Tooltip permanent direction="bottom" className="building-label">UAV</Tooltip>
                        </CircleMarker>
                    </>
                )}
            </MapContainer>
        </div>
    );
}
