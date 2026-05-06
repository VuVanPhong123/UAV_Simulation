'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeoJsonObject } from 'geojson';
import TopStatusBar from './TopStatusBar';
import LeftNavigation from './LeftNavigation';
import RightDetailPanel from './RightDetailPanel';
import BottomEventPanel from './BottomEventPanel';
import UavMap from '../map/UavMap';
import { useSimulationSocket } from '../hooks/useSimulationSocket';
import { useTelemetryHistory } from '../hooks/useTelemetryHistory';
import {
    DEFAULT_LAYER_TOGGLES,
    type ActiveDashboardSection,
    type DraftOrder,
    type DynamicObstacle,
    type EventFilter,
    type LatLng,
    type LayerToggles,
    type MapInteractionMode,
    type ObstacleConfig,
    type ObstacleType,
    type OrderPriority,
    type WeatherState
} from '../types/simulation';

function createDraftOrder(): DraftOrder {
    return {
        orderId: `order_ui_${Date.now()}`,
        pickup: null,
        dropoff: null,
        payloadKg: 1,
        priority: 'normal'
    };
}

export default function GcsDashboard() {
    const socket = useSimulationSocket();
    const telemetryHistory = useTelemetryHistory(socket.drones, socket.selectedDroneId);
    const addLocalEvent = socket.addLocalEvent;
    const [buildings, setBuildings] = useState<GeoJsonObject | null>(null);
    const [weather, setWeather] = useState<WeatherState>({ wind_dir: 0, wind_speed: 0, ambient_temp: 25, is_raining: false });
    const [obstacleConfig, setObstacleConfig] = useState<ObstacleConfig>({ radius: 8, height: 25, obstacleType: 'unknown' });
    const [dynamicObstacles, setDynamicObstacles] = useState<DynamicObstacle[]>([]);
    const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYER_TOGGLES);
    const [droneCount, setDroneCount] = useState(1);
    const [activeSection, setActiveSection] = useState<ActiveDashboardSection>('overview');
    const [draftOrder, setDraftOrder] = useState<DraftOrder>(createDraftOrder);
    const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
    const [eventFilter, setEventFilter] = useState<EventFilter>('all');
    const [mapInteractionMode, setMapInteractionMode] = useState<MapInteractionMode>('none');
    const [importError, setImportError] = useState<string | null>(null);
    const validDraftOrders = draftOrders.filter(order => (
        order.orderId.trim()
        && order.pickup
        && order.dropoff
        && Number.isFinite(order.payloadKg)
        && order.payloadKg > 0
    ));
    const canStartWithOrders = droneCount >= 1 && draftOrders.length > 0 && validDraftOrders.length === draftOrders.length;
    const startHint = 'Cần chọn số UAV và nhập ít nhất một đơn hàng trước khi bắt đầu mô phỏng.';

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
        if (mapInteractionMode === 'select_pickup') {
            setDraftOrder(prev => ({ ...prev, pickup: latlng }));
            addLocalEvent('info', 'PICKUP_SELECTED', 'Đã chọn điểm lấy hàng.');
            setMapInteractionMode('none');
            return;
        }
        if (mapInteractionMode === 'select_dropoff') {
            setDraftOrder(prev => ({ ...prev, dropoff: latlng }));
            addLocalEvent('info', 'DROPOFF_SELECTED', 'Đã chọn điểm giao hàng.');
            setMapInteractionMode('none');
            return;
        }
        if (mapInteractionMode === 'none') {
            addLocalEvent('info', 'MAP_CLICK_IGNORED', 'Chọn công cụ trước khi click bản đồ.');
            return;
        }
        const obstacle = {
            pos: latlng,
            radius: obstacleConfig.radius,
            height: obstacleConfig.height,
            obstacleType: obstacleConfig.obstacleType
        };
        if (socket.addObstacle(obstacle)) {
            setDynamicObstacles(prev => [...prev, obstacle]);
        }
    }, [addLocalEvent, mapInteractionMode, obstacleConfig, socket]);

    const handleDraftChange = useCallback(<K extends keyof DraftOrder,>(key: K, value: DraftOrder[K]) => {
        setDraftOrder(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleAddDraftOrder = useCallback(() => {
        if (!draftOrder.orderId.trim() || !draftOrder.pickup || !draftOrder.dropoff || draftOrder.payloadKg <= 0) {
            addLocalEvent('warning', 'ORDER_DRAFT_INVALID', 'Đơn nháp thiếu thông tin bắt buộc.');
            return;
        }
        setDraftOrders(prev => [...prev.filter(order => order.orderId !== draftOrder.orderId), draftOrder]);
        setDraftOrder(createDraftOrder());
        addLocalEvent('info', 'ORDER_DRAFT_ADDED', 'Đã thêm đơn vào danh sách nháp.');
    }, [addLocalEvent, draftOrder]);

    const handleRemoveDraftOrder = useCallback((orderId: string) => {
        setDraftOrders(prev => prev.filter(order => order.orderId !== orderId));
    }, []);

    const handleAddDemoDraftOrders = useCallback((orders: DraftOrder[]) => {
        setDraftOrders(prev => [
            ...prev.filter(existing => !orders.some(order => order.orderId === existing.orderId)),
            ...orders
        ]);
        addLocalEvent('info', 'DEMO_ORDERS_ADDED', `Đã thêm ${orders.length} đơn demo vào danh sách nháp.`);
    }, [addLocalEvent]);

    const handleSubmitDraftOrders = useCallback(() => {
        if (draftOrders.length === 0) return;
        if (socket.submitOrderBatch(draftOrders)) {
            setDraftOrders([]);
            addLocalEvent('info', 'ORDER_BATCH_SUBMITTED', 'Đã gửi danh sách đơn hàng.');
        }
    }, [addLocalEvent, draftOrders, socket]);

    const handleStartWithDraftOrders = useCallback(() => {
        if (!canStartWithOrders) {
            addLocalEvent('warning', 'START_NEEDS_ORDERS', startHint);
            return;
        }
        socket.startSimulation({ droneCount, orderBatch: validDraftOrders });
        setDraftOrders([]);
        addLocalEvent('info', 'ORDER_FIRST_START_REQUESTED', `Bắt đầu mô phỏng với ${validDraftOrders.length} đơn hàng.`);
    }, [addLocalEvent, canStartWithOrders, droneCount, socket, startHint, validDraftOrders]);

    const normalizePriority = useCallback((value: unknown): OrderPriority => {
        return ['low', 'normal', 'high', 'urgent'].includes(String(value)) ? String(value) as OrderPriority : 'normal';
    }, []);

    const handleImportJson = useCallback((text: string) => {
        try {
            const parsed = JSON.parse(text);
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            const imported = rows.map((item, idx) => {
                const pickup = Array.isArray(item.pickup) && item.pickup.length === 2 ? [Number(item.pickup[0]), Number(item.pickup[1])] as LatLng : null;
                const dropoff = Array.isArray(item.dropoff) && item.dropoff.length === 2 ? [Number(item.dropoff[0]), Number(item.dropoff[1])] as LatLng : null;
                const payloadKg = Number(item.payloadKg ?? item.payload_kg ?? 0);
                if (!pickup || !dropoff || !Number.isFinite(payloadKg) || payloadKg <= 0) {
                    throw new Error(`Đơn thứ ${idx + 1} thiếu pickup/dropoff/payloadKg hợp lệ.`);
                }
                return {
                    orderId: String(item.orderId ?? item.order_id ?? `order_ui_${Date.now()}_${idx}`),
                    pickup,
                    dropoff,
                    payloadKg,
                    priority: normalizePriority(item.priority),
                    deadlineTs: item.deadlineTs ?? item.deadline_ts ?? null
                };
            });
            setDraftOrders(prev => [...prev, ...imported]);
            setImportError(null);
            addLocalEvent('info', 'ORDER_JSON_IMPORTED', `Đã nạp ${imported.length} đơn vào danh sách nháp.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'JSON không hợp lệ.';
            setImportError(message);
            addLocalEvent('warning', 'ORDER_JSON_INVALID', message);
        }
    }, [addLocalEvent, normalizePriority]);

    const handleDispatchOrders = useCallback(() => {
        if (socket.dispatchOrders()) {
            addLocalEvent('info', 'DISPATCH_REQUESTED', 'Đã yêu cầu tự động phân công.');
        }
    }, [addLocalEvent, socket]);

    const handleSelectDrone = useCallback((droneId: string) => {
        socket.setSelectedDroneId(droneId);
        const drone = socket.drones[droneId];
        const relatedOrder = drone?.currentOrderId
            ? socket.orders[drone.currentOrderId] ?? null
            : Object.values(socket.orders).find(order => (order.assignedDroneId ?? order.assigned_drone_id) === droneId) ?? null;
        const relatedMission = drone?.currentMissionId
            ? socket.missions[drone.currentMissionId] ?? null
            : relatedOrder?.missionId || relatedOrder?.mission_id
                ? socket.missions[relatedOrder.missionId ?? relatedOrder.mission_id ?? ''] ?? null
                : Object.values(socket.missions).find(item => (item.droneId ?? item.drone_id) === droneId) ?? null;
        setSelectedOrderId(relatedOrder ? relatedOrder.orderId ?? relatedOrder.order_id ?? drone?.currentOrderId ?? null : drone?.currentOrderId ?? null);
        setSelectedMissionId(relatedMission ? relatedMission.missionId ?? relatedMission.mission_id ?? drone?.currentMissionId ?? null : drone?.currentMissionId ?? null);
    }, [socket]);

    const handleSelectOrder = useCallback((orderId: string) => {
        setSelectedOrderId(orderId);
        const order = socket.orders[orderId];
        const missionId = order?.missionId ?? order?.mission_id ?? null;
        const assignedDroneId = order?.assignedDroneId ?? order?.assigned_drone_id ?? null;
        setSelectedMissionId(missionId);
        socket.setSelectedDroneId(assignedDroneId);
        setActiveSection('orders');
    }, [socket]);

    const handleSelectMission = useCallback((missionId: string) => {
        setSelectedMissionId(missionId);
        const mission = socket.missions[missionId];
        const orderId = mission?.orderId ?? mission?.order_id ?? null;
        const droneId = mission?.droneId ?? mission?.drone_id ?? null;
        setSelectedOrderId(orderId);
        socket.setSelectedDroneId(droneId);
    }, [socket]);

    const handleReset = useCallback(() => {
        socket.resetSimulation();
        telemetryHistory.resetHistory();
        setDynamicObstacles([]);
        setSelectedOrderId(null);
        setSelectedMissionId(null);
        setEventFilter('all');
        setMapInteractionMode('none');
    }, [socket, telemetryHistory]);

    const handleStop = useCallback(() => {
        socket.stopSimulation();
        telemetryHistory.resetHistory();
        setDynamicObstacles([]);
        setSelectedOrderId(null);
        setSelectedMissionId(null);
        setEventFilter('all');
        setMapInteractionMode('none');
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
                drones={socket.drones}
                orders={socket.orders}
            />
            <div className="grid min-h-0 flex-1 grid-cols-[80px_minmax(0,1fr)_380px]">
                <LeftNavigation activeSection={activeSection} onChange={setActiveSection} />
                <div className="flex min-h-0 flex-col">
                    <main className="min-h-0 flex-1">
                        <UavMap
                            buildings={buildings}
                            mapConfig={socket.mapConfig}
                            drones={socket.drones}
                            orders={socket.orders}
                            missions={socket.missions}
                            selectedOrderId={selectedOrderId}
                            selectedMissionId={selectedMissionId}
                            selectedDroneId={socket.selectedDroneId}
                            plannedPaths={socket.plannedPaths}
                            pathHistoryByDrone={telemetryHistory.pathHistoryByDrone}
                            dynamicObstacles={dynamicObstacles}
                            windShadowZones={socket.windShadowZones}
                            layers={layers}
                            windDir={weather.wind_dir}
                            windSpeed={weather.wind_speed}
                            mapInteractionMode={mapInteractionMode}
                            onMapClick={handleMapClick}
                            onSelectDrone={handleSelectDrone}
                            onSelectOrder={handleSelectOrder}
                        />
                    </main>
                    <BottomEventPanel
                        events={socket.eventLogs}
                        selectedDroneId={socket.selectedDroneId}
                        selectedOrderId={selectedOrderId}
                        selectedMissionId={selectedMissionId}
                        eventFilter={eventFilter}
                        onEventFilterChange={setEventFilter}
                    />
                </div>
                <RightDetailPanel
                    activeSection={activeSection}
                    serverStatus={socket.serverStatus}
                    workerStatus={socket.workerStatus}
                    simulationStatus={socket.simulationStatus}
                    activeSimId={socket.activeSimId}
                    frontendId={socket.frontendId}
                    latencyMs={socket.latencyMs}
                    droneState={socket.selectedDrone}
                    drones={socket.drones}
                    selectedDroneId={socket.selectedDroneId}
                    plannedPath3d={socket.selectedPath3d}
                    eventLogs={socket.eventLogs}
                    weather={weather}
                    obstacleConfig={obstacleConfig}
                    layers={layers}
                    droneCount={droneCount}
                    batteryHistory={telemetryHistory.batteryHistory}
                    temperatureHistory={telemetryHistory.temperatureHistory}
                    altitudeHistory={telemetryHistory.altitudeHistory}
                    orders={socket.orders}
                    missions={socket.missions}
                    draftOrder={draftOrder}
                    draftOrders={draftOrders}
                    selectedOrderId={selectedOrderId}
                    selectedMissionId={selectedMissionId}
                    eventFilter={eventFilter}
                    mapInteractionMode={mapInteractionMode}
                    importError={importError}
                    canStartWithOrders={canStartWithOrders}
                    startHint={startHint}
                    onStart={handleStartWithDraftOrders}
                    onDroneCountChange={setDroneCount}
                    onSelectDrone={handleSelectDrone}
                    onPause={socket.pauseSimulation}
                    onResume={socket.resumeSimulation}
                    onStop={handleStop}
                    onReset={handleReset}
                    onWeatherChange={handleWeatherChange}
                    onApplyWeather={() => socket.applyWeather(weather)}
                    onObstacleChange={handleObstacleChange}
                    onLayerToggle={handleLayerToggle}
                    onSelectOrder={handleSelectOrder}
                    onSelectMission={handleSelectMission}
                    onEventFilterChange={setEventFilter}
                    onAddDemoDraftOrders={handleAddDemoDraftOrders}
                    onStartWithDraftOrders={handleStartWithDraftOrders}
                    onDraftChange={handleDraftChange}
                    onAddDraftOrder={handleAddDraftOrder}
                    onRemoveDraftOrder={handleRemoveDraftOrder}
                    onSubmitDraftOrders={handleSubmitDraftOrders}
                    onImportJson={handleImportJson}
                    onDispatchOrders={handleDispatchOrders}
                    onSetMapInteractionMode={setMapInteractionMode}
                />
            </div>
        </div>
    );
}
