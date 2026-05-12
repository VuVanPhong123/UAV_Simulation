'use client';

import { Fragment, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { Feature, GeoJsonObject, GeoJsonProperties, Geometry } from 'geojson';
import type { Layer } from 'leaflet';
import MapEvents from './MapEvents';
import MapResizeController from './MapResizeController';
import MapZoomSlider from './MapZoomSlider';
import AltitudeLegend from './AltitudeLegend';
import SmoothDroneMarker, { getUavAltitudeColors } from './SmoothDroneMarker';
import WindOverlay from './WindOverlay';
import type {
    DroneTelemetry,
    DronesById,
    DynamicNoFlyZone,
    DynamicObstacle,
    LatLng,
    LayerToggles,
    MapInteractionMode,
    MapConfig,
    MissionsById,
    OrdersById,
    PathHistoryByDrone,
    PlannedPathsByDrone
} from '../types/simulation';
import { orderIdOf } from '../utils/labels';

const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const GeoJSON = dynamic(() => import('react-leaflet').then(mod => mod.GeoJSON), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false });
const Pane = dynamic(() => import('react-leaflet').then(mod => mod.Pane), { ssr: false });

const MAX_WIND_SHADOW_POINTS = 400;
const MAX_RENDERED_PLANNED_PATH_POINTS = 250;
const MAX_RENDERED_HISTORY_POINTS = 200;

type UavMapProps = {
    buildings: GeoJsonObject | null;
    mapConfig: MapConfig | null;
    drones: DronesById;
    orders: OrdersById;
    missions: MissionsById;
    selectedOrderId: string | null;
    selectedMissionId: string | null;
    selectedDroneId: string | null;
    plannedPaths: PlannedPathsByDrone;
    pathHistoryByDrone: PathHistoryByDrone;
    dynamicObstacles: DynamicObstacle[];
    dynamicNoFlyZones: DynamicNoFlyZone[];
    windShadowZones: LatLng[];
    layers: LayerToggles;
    buildingLoadStatus?: 'idle' | 'loading' | 'success' | 'error';
    windDir: number;
    windSpeed: number;
    mapInteractionMode: MapInteractionMode;
    resizeKey?: string | number | boolean;
    onMapClick: (latlng: LatLng) => void;
    onSelectDrone: (droneId: string) => void;
    onSelectOrder?: (orderId: string) => void;
};

const HIDDEN_ORDER_MARKER_STATUSES = new Set(['completed', 'failed', 'canceled']);

function samplePolylinePositions(points: LatLng[], maxPoints: number) {
    if (points.length <= maxPoints) return points;
    const step = Math.ceil(points.length / maxPoints);
    return points.filter((_, idx) => idx % step === 0).slice(0, maxPoints);
}

export default function UavMap({
    buildings,
    mapConfig,
    drones,
    orders,
    missions,
    selectedOrderId,
    selectedMissionId,
    selectedDroneId,
    plannedPaths,
    pathHistoryByDrone,
    dynamicObstacles,
    dynamicNoFlyZones,
    windShadowZones,
    layers,
    buildingLoadStatus = 'idle',
    windDir,
    windSpeed,
    mapInteractionMode,
    resizeKey,
    onMapClick,
    onSelectDrone,
    onSelectOrder
}: UavMapProps) {
    const defaultCenter: LatLng = [21.0163, 105.7840];
    const depot = mapConfig?.depot ?? mapConfig?.start ?? defaultCenter;
    const hasFixedGoal = mapConfig?.hasFixedGoal !== false && mapConfig?.simulationMode !== 'order_dispatch';
    const mapCenter = mapConfig ? depot : defaultCenter;
    const selectedDrone = selectedDroneId ? drones[selectedDroneId] : null;
    const sampledZones = useMemo(() => {
        if (!layers.windShadow) return [];
        return samplePolylinePositions(windShadowZones, MAX_WIND_SHADOW_POINTS);
    }, [layers.windShadow, windShadowZones]);
    const selectedPlannedPath = selectedDroneId ? plannedPaths[selectedDroneId] ?? [] : [];
    const selectedPathHistory = selectedDroneId ? pathHistoryByDrone[selectedDroneId] ?? [] : [];
    const renderedPlannedPath = useMemo(
        () => samplePolylinePositions(selectedPlannedPath, MAX_RENDERED_PLANNED_PATH_POINTS),
        [selectedPlannedPath]
    );
    const renderedPathHistory = useMemo(
        () => samplePolylinePositions(selectedPathHistory, MAX_RENDERED_HISTORY_POINTS),
        [selectedPathHistory]
    );
    const selectedMission = selectedMissionId ? missions[selectedMissionId] ?? null : null;
    const selectedMissionOrderId = selectedMission?.orderId ?? selectedMission?.order_id ?? null;
    const visibleOrderIds = useMemo(() => {
        const ids = new Set<string>();
        if (selectedOrderId) ids.add(selectedOrderId);
        if (selectedMissionOrderId) ids.add(selectedMissionOrderId);
        if (selectedDroneId) {
            if (selectedDrone?.currentOrderId) ids.add(selectedDrone.currentOrderId);
            Object.values(orders).forEach(order => {
                const assignedDroneId = order.assignedDroneId ?? order.assigned_drone_id;
                if (assignedDroneId === selectedDroneId) {
                    ids.add(orderIdOf(order));
                }
            });
            Object.values(missions).forEach(mission => {
                const missionDroneId = mission.droneId ?? mission.drone_id;
                const missionOrderId = mission.orderId ?? mission.order_id;
                if (missionDroneId === selectedDroneId && missionOrderId) {
                    ids.add(missionOrderId);
                }
            });
        }
        return ids;
    }, [missions, orders, selectedDrone, selectedDroneId, selectedMissionOrderId, selectedOrderId]);
    const interactionText = mapInteractionMode === 'select_pickup'
        ? 'Đang chọn điểm lấy hàng trên bản đồ'
        : mapInteractionMode === 'select_dropoff'
            ? 'Đang chọn điểm giao hàng trên bản đồ'
            : mapInteractionMode === 'obstacle'
                ? 'Đang chọn vị trí đặt vật cản. Click lên bản đồ để đặt.'
                : null;

    const displayInteractionText = mapInteractionMode === 'no_fly_zone'
        ? 'Đang chọn tâm vùng cấm bay...'
        : interactionText;

    return (
        <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-slate-100">
            {layers.weatherOverlay && <WindOverlay windDir={windDir} windSpeed={windSpeed} />}
            {displayInteractionText && (
                <div className="pointer-events-none absolute left-4 top-4 z-[500] rounded border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 shadow-sm">
                    {displayInteractionText}
                </div>
            )}
            {buildingLoadStatus === 'loading' && layers.buildings && (
                <div className="pointer-events-none absolute right-4 top-4 z-[500] rounded border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm">
                    Đang tải lớp tòa nhà...
                </div>
            )}
            {buildingLoadStatus === 'error' && layers.buildings && (
                <div className="pointer-events-none absolute right-4 top-4 z-[500] max-w-xs rounded border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm">
                    Không tải được lớp tòa nhà.
                </div>
            )}
            <MapContainer
                key={`map-${mapConfig?.mapId ?? 'hanoi_my_dinh_me_tri'}`}
                center={mapCenter}
                zoom={17}
                minZoom={13}
                maxZoom={19}
                scrollWheelZoom={true}
                zoomAnimation={true}
                zoomSnap={0.25}
                zoomDelta={0.25}
                wheelPxPerZoomLevel={120}
                preferCanvas={true}
                zoomControl={false}
                attributionControl={false}
                className="h-full w-full z-10"
            >
                <MapResizeController resizeKey={resizeKey} />
                <MapEvents onMapClick={onMapClick} />
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                    maxNativeZoom={19}
                    maxZoom={19}
                    keepBuffer={6}
                    updateWhenIdle={true}
                    updateWhenZooming={false}
                />
                <div className="leaflet-top leaflet-right" style={{ zIndex: 650 }}>
                    <div className="leaflet-control mr-2 mt-16 flex flex-col gap-2">
                        <MapZoomSlider />
                        <AltitudeLegend />
                    </div>
                </div>
                <Pane name="uavSensorPane" style={{ zIndex: 690, pointerEvents: 'none' }} />
                <Pane name="uavPane" style={{ zIndex: 700 }} />

                {layers.buildings && buildings && (
                    <GeoJSON
                        key={`buildings-${layers.buildingLabels ? 'labels' : 'plain'}`}
                        data={buildings}
                        filter={(feature: Feature<Geometry, GeoJsonProperties>) => {
                            const geometryType = feature.geometry?.type;
                            return geometryType === 'Polygon' || geometryType === 'MultiPolygon';
                        }}
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
                        <CircleMarker center={depot} radius={7} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }}>
                            <Tooltip permanent direction="top" className="building-label">Kho UAV</Tooltip>
                        </CircleMarker>
                        {hasFixedGoal && (
                            <CircleMarker center={mapConfig.goal} radius={6} pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1 }}>
                                <Tooltip>Điểm đích mô phỏng</Tooltip>
                            </CircleMarker>
                        )}
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

                {layers.noFlyZones && dynamicNoFlyZones.map(zone => (
                    <Circle
                        key={zone.id}
                        center={zone.center}
                        radius={zone.radius}
                        pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 0.18, weight: 2, dashArray: '4,4' }}
                    >
                        <Tooltip>Vùng cấm bay</Tooltip>
                    </Circle>
                ))}

                {layers.plannedPath && selectedDroneId && renderedPlannedPath.length > 0 && (
                    <Polyline
                        key={`planned-${selectedDroneId}`}
                        positions={renderedPlannedPath}
                        pathOptions={{
                            color: '#f97316',
                            weight: 4,
                            opacity: 0.85,
                            dashArray: '8, 8'
                        }}
                    />
                )}

                {layers.pathHistory && selectedDroneId && renderedPathHistory.length > 0 && (
                    <Polyline
                        key={`history-${selectedDroneId}`}
                        positions={renderedPathHistory}
                        pathOptions={{
                            color: '#2563eb',
                            weight: 3,
                            opacity: 0.7
                        }}
                    />
                )}

                {layers.windShadow && sampledZones.length === 0 && (
                    <div className="absolute right-4 top-50 z-[500] rounded border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 shadow-sm">
                        Không có gió
                    </div>
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

                {Object.values(orders).filter(order => {
                    const orderId = orderIdOf(order);
                    const forceVisible = selectedOrderId === orderId || selectedMissionOrderId === orderId;
                    if (HIDDEN_ORDER_MARKER_STATUSES.has(order.status) && !forceVisible) return false;
                    return forceVisible || (layers.orders && visibleOrderIds.has(orderId));
                }).map(order => {
                    const orderId = orderIdOf(order);
                    const pickup = order.pickup;
                    const dropoff = order.dropoff;
                    const selected = selectedOrderId === orderId || selectedMissionOrderId === orderId;
                    const completed = ['completed', 'failed', 'canceled'].includes(order.status);
                    const pickupColor = completed ? '#64748b' : '#0ea5e9';
                    const dropoffColor = completed ? '#64748b' : '#f97316';
                    return (
                        <Fragment key={`order-${orderId}`}>
                            {Array.isArray(pickup) && pickup.length === 2 && (
                                <CircleMarker
                                    center={pickup}
                                    radius={selected ? 10 : 5}
                                    eventHandlers={{ click: () => onSelectOrder?.(orderId) }}
                                    pathOptions={{ color: pickupColor, fillColor: pickupColor, fillOpacity: selected ? 1 : 0.75, weight: selected ? 5 : 2 }}
                                >
                                    <Tooltip permanent={selected} direction="top">Điểm lấy hàng</Tooltip>
                                </CircleMarker>
                            )}
                            {Array.isArray(dropoff) && dropoff.length === 2 && (
                                <CircleMarker
                                    center={dropoff}
                                    radius={selected ? 10 : 5}
                                    eventHandlers={{ click: () => onSelectOrder?.(orderId) }}
                                    pathOptions={{ color: dropoffColor, fillColor: dropoffColor, fillOpacity: selected ? 1 : 0.75, weight: selected ? 5 : 2 }}
                                >
                                    <Tooltip permanent={selected} direction="bottom">Điểm giao hàng</Tooltip>
                                </CircleMarker>
                            )}
                        </Fragment>
                    );
                })}

                {Object.values(drones).map((drone: DroneTelemetry) => {
                    if (!drone.pos) return null;
                    const droneId = drone.droneId ?? 'drone_1';
                    const selected = droneId === selectedDroneId;
                    const colors = getUavAltitudeColors(drone.altitude);
                    const battery = drone.batteryPercent ?? drone.battery;
                    return (
                        <SmoothDroneMarker
                            key={`drone-${droneId}`}
                            droneId={droneId}
                            drone={drone}
                            selected={selected}
                            radius={selected ? 10 : 7}
                            pathOptions={{ color: colors.color, fillColor: colors.color, fillOpacity: 1, weight: selected ? 3 : 2 }}
                            battery={typeof battery === 'number' ? battery : undefined}
                            showSensorRange={layers.sensorRange && selected}
                            sensorRangeMeters={selected ? 30 : undefined}
                            sensorPathOptions={{ color: colors.halo, fillColor: colors.halo, fillOpacity: 0.52, weight: 1, dashArray: '4,4' }}
                            markerPane="uavPane"
                            sensorPane="uavSensorPane"
                            onSelect={onSelectDrone}
                        />
                    );
                })}
            </MapContainer>
        </div>
    );
}
