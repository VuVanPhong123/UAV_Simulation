'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJsonObject } from 'geojson';
import TopStatusBar from './TopStatusBar';
import LeftNavigation from './LeftNavigation';
import RightDetailPanel from './RightDetailPanel';
import BottomDroneInfoPanel from './BottomDroneInfoPanel';
import MapSelectorModal from './MapSelectorModal';
import UavMap from '../map/UavMap';
import { useSimulationSocket } from '../hooks/useSimulationSocket';
import { useTelemetryHistory } from '../hooks/useTelemetryHistory';
import {
    DEFAULT_LAYER_TOGGLES,
    DEFAULT_DEMO_DRONE_COUNT,
    DEFAULT_MAP_PRESET_ID,
    MAP_PRESET_OPTIONS,
    MAX_DEMO_DRONE_COUNT,
    PRESET_PREVIEW_MAP_CONFIGS,
    type ActiveDashboardSection,
    type AsyncRequestStatus,
    type DraftOrder,
    type DynamicNoFlyZone,
    type DynamicObstacle,
    type EventFilter,
    type LatLng,
    type LayerToggles,
    type MapPresetId,
    type MapInteractionMode,
    type ObstacleConfig,
    type ObstacleType,
    type OrderPriority,
    type WeatherState
} from '../types/simulation';

type NoFlyZoneConfig = {
    radius: number;
    height: number;
};

type BuildingLoadStatus = 'idle' | 'loading' | 'success' | 'error';

const SUCCESS_CLEAR_MS = 2800;
const MAX_IMPORT_ORDER_COUNT = 200;

function createDraftOrder(): DraftOrder {
    return {
        orderId: `order_ui_${Date.now()}`,
        pickup: null,
        dropoff: null,
        payloadKg: 1,
        priority: 'normal'
    };
}

function clampDroneCount(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_DEMO_DRONE_COUNT;
    return Math.max(1, Math.min(MAX_DEMO_DRONE_COUNT, Math.floor(value)));
}

export default function GcsDashboard() {
    const socket = useSimulationSocket();
    const telemetryHistory = useTelemetryHistory(socket.drones, socket.selectedDroneId);
    const addLocalEvent = socket.addLocalEvent;
    const [buildings, setBuildings] = useState<GeoJsonObject | null>(null);
    const [weather, setWeather] = useState<WeatherState>({ wind_dir: 0, wind_speed: 0, ambient_temp: 25, is_raining: false });
    const [obstacleConfig, setObstacleConfig] = useState<ObstacleConfig>({ radius: 8, height: 25, obstacleType: 'unknown' });
    const [noFlyZoneConfig, setNoFlyZoneConfig] = useState<NoFlyZoneConfig>({ radius: 60, height: 120 });
    const [dynamicObstacles, setDynamicObstacles] = useState<DynamicObstacle[]>([]);
    const [dynamicNoFlyZones, setDynamicNoFlyZones] = useState<DynamicNoFlyZone[]>([]);
    const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYER_TOGGLES);
    const [buildingLoadStatus, setBuildingLoadStatus] = useState<BuildingLoadStatus>('idle');
    const [weatherApplyStatus, setWeatherApplyStatus] = useState<AsyncRequestStatus>('idle');
    const [weatherApplyMessage, setWeatherApplyMessage] = useState<string | null>(null);
    const [commandFeedback, setCommandFeedback] = useState<{ tone: AsyncRequestStatus; message: string } | null>(null);
    const [droneCount, setDroneCount] = useState(DEFAULT_DEMO_DRONE_COUNT);
    const [activeSection, setActiveSection] = useState<ActiveDashboardSection>('overview');
    const [draftOrder, setDraftOrder] = useState<DraftOrder>(createDraftOrder);
    const [draftOrders, setDraftOrders] = useState<DraftOrder[]>([]);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
    const [eventFilter, setEventFilter] = useState<EventFilter>('all');
    const [mapInteractionMode, setMapInteractionMode] = useState<MapInteractionMode>('none');
    const [selectedMapId, setSelectedMapId] = useState<MapPresetId>(DEFAULT_MAP_PRESET_ID);
    const [mapSelectorOpen, setMapSelectorOpen] = useState(false);
    const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const lastMapErrorKeyRef = useRef<string | null>(null);
    const windShadowRequestedSimRef = useRef<string | null>(null);
    const selectedMapPreset = MAP_PRESET_OPTIONS.find(option => option.mapId === selectedMapId) ?? MAP_PRESET_OPTIONS[0];
    const previewMapConfig = PRESET_PREVIEW_MAP_CONFIGS[selectedMapId];
    const effectiveMapConfig = useMemo(() => {
        if (socket.activeSimId && socket.mapConfig?.mapId === selectedMapId) return socket.mapConfig;
        return previewMapConfig;
    }, [previewMapConfig, selectedMapId, socket.activeSimId, socket.mapConfig]);
    const mapChangeDisabled = Boolean(socket.activeSimId) || socket.simulationStatus === 'running' || socket.isStartingSimulation;
    const activeMapId = socket.activeSimId ? socket.mapConfig?.mapId ?? selectedMapId : null;
    const validDraftOrders = draftOrders.filter(order => (
        order.orderId.trim()
        && order.pickup
        && order.dropoff
        && Number.isFinite(order.payloadKg)
        && order.payloadKg > 0
    ));
    const canStartWithOrders = droneCount >= 1 && droneCount <= MAX_DEMO_DRONE_COUNT && draftOrders.length > 0 && validDraftOrders.length === draftOrders.length;
    const startHint = 'Cần có ít nhất một đơn hàng hợp lệ trước khi bắt đầu mô phỏng.';

    const orderStartHint = startHint;
    const effectiveStartHint = socket.serverStatus !== 'connected'
        ? 'Chưa kết nối máy chủ.'
        : socket.workerStatus === 'disconnected' || socket.workerStatus === 'unknown'
            ? 'Chưa có worker kết nối.'
            : socket.workerStatus === 'busy'
                ? 'Worker đang bận, vui lòng dừng mô phỏng khác hoặc chờ worker rảnh.'
                : socket.workerStatus !== 'idle'
                    ? 'Worker chưa sẵn sàng.'
                    : socket.simulationStatus === 'running'
                        ? 'Mô phỏng đang chạy.'
                        : !canStartWithOrders
                            ? orderStartHint
                            : '';

    useEffect(() => {
        const buildingUrl = effectiveMapConfig?.buildingGeoJsonUrl ?? selectedMapPreset.buildingGeoJsonUrl ?? '/maps/hanoi_my_dinh_me_tri_large/buildings.geojson';
        let cancelled = false;
        setBuildings(null);
        setBuildingLoadStatus('loading');
        fetch(buildingUrl)
            .then(res => res.json())
            .then(data => {
                if (cancelled) return;
                setBuildings(data);
                setBuildingLoadStatus('success');
            })
            .catch(() => {
                if (cancelled) return;
                setBuildingLoadStatus('error');
                addLocalEvent('warning', 'BUILDINGS_LOAD_FAILED', 'Không tải được lớp tòa nhà. Bản đồ vẫn chạy nhưng thiếu layer tòa nhà.');
            });
        return () => {
            cancelled = true;
        };
    }, [addLocalEvent, effectiveMapConfig?.buildingGeoJsonUrl, selectedMapPreset.buildingGeoJsonUrl]);

    useEffect(() => {
        if (!socket.activeSimId) {
            windShadowRequestedSimRef.current = null;
            return;
        }
        if (!layers.windShadow || windShadowRequestedSimRef.current === socket.activeSimId) return;
        windShadowRequestedSimRef.current = socket.activeSimId;
        socket.requestWindShadow();
    }, [layers.windShadow, socket]);

    useEffect(() => {
        const mapId = socket.mapConfig?.mapId;
        if (socket.activeSimId && mapId && mapId in PRESET_PREVIEW_MAP_CONFIGS && mapId !== selectedMapId) {
            setSelectedMapId(mapId as MapPresetId);
        }
    }, [selectedMapId, socket.activeSimId, socket.mapConfig?.mapId]);

    useEffect(() => {
        const latest = socket.eventLogs[0];
        if (!latest) return;
        const code = String(latest.code ?? '');
        const message = String(latest.message ?? '');
        const isMapCacheError = code === 'MAP_CACHE_MISSING' || /cache missing|map cache/i.test(message);
        if (!isMapCacheError) return;
        const key = `${latest.timestamp ?? ''}-${code}-${message}`;
        if (lastMapErrorKeyRef.current === key) return;
        lastMapErrorKeyRef.current = key;
        setCommandFeedback({
            tone: 'error',
            message: 'Không tải được cache bản đồ. Kiểm tra mapId hoặc build cache.'
        });
    }, [socket.eventLogs]);

    const setTemporaryFeedback = useCallback((tone: AsyncRequestStatus, message: string) => {
        setCommandFeedback({ tone, message });
        if (tone === 'success' || tone === 'warning' || tone === 'error') {
            window.setTimeout(() => setCommandFeedback(null), SUCCESS_CLEAR_MS);
        }
    }, []);

    const handleSelectMap = useCallback((nextMapId: MapPresetId) => {
        if (mapChangeDisabled) {
            setTemporaryFeedback('warning', 'Dừng/đặt lại mô phỏng trước khi đổi bản đồ.');
            return;
        }
        if (nextMapId === selectedMapId) {
            setMapSelectorOpen(false);
            return;
        }
        const nextPreset = MAP_PRESET_OPTIONS.find(option => option.mapId === nextMapId);
        setSelectedMapId(nextMapId);
        setBuildings(null);
        setBuildingLoadStatus('loading');
        setDraftOrders([]);
        setDraftOrder(createDraftOrder());
        setSelectedOrderId(null);
        setSelectedMissionId(null);
        setDynamicObstacles([]);
        setDynamicNoFlyZones([]);
        setEventFilter('all');
        setMapInteractionMode('none');
        setImportError(null);
        socket.setSelectedDroneId(null);
        telemetryHistory.resetHistory();
        addLocalEvent('info', 'MAP_PRESET_SELECTED', `Đã chọn bản đồ ${nextPreset?.label ?? nextMapId}.`);
        setMapSelectorOpen(false);
    }, [addLocalEvent, mapChangeDisabled, selectedMapId, setTemporaryFeedback, socket, telemetryHistory]);

    const handleWeatherChange = useCallback((key: keyof WeatherState, value: number | boolean) => {
        setWeather(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleObstacleChange = useCallback((key: keyof ObstacleConfig, value: number | ObstacleType) => {
        setObstacleConfig(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleNoFlyZoneChange = useCallback((key: keyof NoFlyZoneConfig, value: number) => {
        const normalized = Number.isFinite(value) && value > 0 ? value : key === 'height' ? 120 : 60;
        setNoFlyZoneConfig(prev => ({ ...prev, [key]: normalized }));
    }, []);

    const handleLayerToggle = useCallback((key: keyof LayerToggles) => {
        setLayers(prev => {
            const enabled = !prev[key];
            if (key === 'windShadow' && enabled) {
                const sent = socket.requestWindShadow();
                if (!sent) {
                    setTemporaryFeedback('warning', 'Cần bắt đầu mô phỏng trước khi tải vùng cản gió.');
                    return prev;
                }
            }
            return { ...prev, [key]: enabled };
        });
    }, [setTemporaryFeedback, socket]);

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
        if (mapInteractionMode === 'obstacle') {
            const obstacle = {
                pos: latlng,
                radius: obstacleConfig.radius,
                height: obstacleConfig.height,
                obstacleType: obstacleConfig.obstacleType
            };
            if (socket.addObstacle(obstacle)) {
                setDynamicObstacles(prev => [...prev, obstacle]);
                setTemporaryFeedback('success', 'Đã tạo vật cản trên bản đồ.');
                addLocalEvent('info', 'OBSTACLE_PLACED', 'Đã tạo vật cản trên bản đồ.');
            }
            setMapInteractionMode('none');
            return;
        }
        if (mapInteractionMode === 'no_fly_zone') {
            const configuredHeight = Number.isFinite(noFlyZoneConfig.height) && noFlyZoneConfig.height > 0
                ? noFlyZoneConfig.height
                : 120;
            const zone = {
                id: `no_fly_zone_${Date.now()}`,
                center: latlng,
                radius: Number.isFinite(noFlyZoneConfig.radius) && noFlyZoneConfig.radius > 0 ? noFlyZoneConfig.radius : 60,
                height: configuredHeight,
                label: 'Vùng cấm bay'
            };
            if (socket.addNoFlyZone(zone)) {
                setDynamicNoFlyZones(prev => [...prev, zone]);
                setTemporaryFeedback('success', 'Đã tạo vùng cấm bay.');
                addLocalEvent('info', 'NO_FLY_ZONE_PLACED', 'Đã tạo vùng cấm bay.');
            }
            setMapInteractionMode('none');
            return;
        }
        setMapInteractionMode('none');
    }, [addLocalEvent, mapInteractionMode, noFlyZoneConfig, obstacleConfig, setTemporaryFeedback, socket]);

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
        addLocalEvent('info', 'DRAFT_ORDERS_ADDED', `Đã thêm ${orders.length} đơn vào danh sách nháp.`);
    }, [addLocalEvent]);

    const handleSubmitDraftOrders = useCallback(() => {
        if (draftOrders.length === 0) return false;
        if (socket.submitOrderBatch(draftOrders)) {
            setDraftOrders([]);
            addLocalEvent('info', 'ORDER_BATCH_SUBMITTED', 'Đã gửi danh sách đơn hàng.');
            return true;
        }
        return false;
    }, [addLocalEvent, draftOrders, socket]);

    const handleStartWithDraftOrders = useCallback(() => {
        if (!canStartWithOrders) {
            addLocalEvent('warning', 'START_NEEDS_ORDERS', startHint);
            return false;
        }
        const normalizedDroneCount = clampDroneCount(droneCount);
        if (!socket.startSimulation({ mapId: DEFAULT_MAP_PRESET_ID, droneCount: normalizedDroneCount, orderBatch: validDraftOrders })) {
            return false;
        }
        setDroneCount(normalizedDroneCount);
        setDraftOrders([]);
        setTemporaryFeedback('success', 'Đã gửi yêu cầu bắt đầu mô phỏng.');
        addLocalEvent('info', 'ORDER_FIRST_START_REQUESTED', `Bắt đầu mô phỏng với ${validDraftOrders.length} đơn hàng.`);
        return true;
    }, [addLocalEvent, canStartWithOrders, droneCount, setTemporaryFeedback, socket, startHint, validDraftOrders]);

    const handleDroneCountChange = useCallback((value: number) => {
        setDroneCount(clampDroneCount(value));
    }, []);

    const normalizePriority = useCallback((value: unknown): OrderPriority => {
        return ['low', 'normal', 'high', 'urgent'].includes(String(value)) ? String(value) as OrderPriority : 'normal';
    }, []);

    const handleImportJson = useCallback((text: string) => {
        try {
            const parsed = JSON.parse(text);
            const rows = Array.isArray(parsed) ? parsed : [parsed];
            if (rows.length > MAX_IMPORT_ORDER_COUNT) {
                throw new Error(`Tối đa ${MAX_IMPORT_ORDER_COUNT} đơn/lần import.`);
            }
            const imported = rows.map((item, idx) => {
                const pickup = Array.isArray(item.pickup) && item.pickup.length === 2 ? [Number(item.pickup[0]), Number(item.pickup[1])] as LatLng : null;
                const dropoff = Array.isArray(item.dropoff) && item.dropoff.length === 2 ? [Number(item.dropoff[0]), Number(item.dropoff[1])] as LatLng : null;
                const payloadKg = Number(item.payloadKg ?? item.payload_kg ?? 0);
                if (!pickup || !dropoff || !Number.isFinite(payloadKg) || payloadKg <= 0) {
                    throw new Error(`Đơn thứ ${idx + 1} thiếu điểm lấy hàng, điểm giao hàng hoặc khối lượng hợp lệ.`);
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
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'JSON không hợp lệ.';
            setImportError(message);
            addLocalEvent('warning', 'ORDER_JSON_INVALID', message);
            return false;
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
        if (socket.resetSimulation()) {
            telemetryHistory.resetHistory();
            setDynamicObstacles([]);
            setDynamicNoFlyZones([]);
            setSelectedOrderId(null);
            setSelectedMissionId(null);
            setEventFilter('all');
            setMapInteractionMode('none');
            setTemporaryFeedback('success', 'Đã gửi lệnh đặt lại mô phỏng.');
            return;
        }
        setTemporaryFeedback('warning', 'Không có mô phỏng đang chạy để đặt lại.');
    }, [setTemporaryFeedback, socket, telemetryHistory]);

    const handleStop = useCallback(() => {
        if (socket.stopSimulation()) {
            telemetryHistory.resetHistory();
            setDynamicObstacles([]);
            setDynamicNoFlyZones([]);
            setSelectedOrderId(null);
            setSelectedMissionId(null);
            setEventFilter('all');
            setMapInteractionMode('none');
            setTemporaryFeedback('success', 'Đã gửi lệnh dừng mô phỏng.');
            return;
        }
        setTemporaryFeedback('warning', 'Không có mô phỏng đang chạy để dừng.');
    }, [setTemporaryFeedback, socket, telemetryHistory]);

    const handleApplyWeather = useCallback(() => {
        if (!socket.activeSimId) {
            setWeatherApplyStatus('warning');
            setWeatherApplyMessage('Cần bắt đầu mô phỏng trước khi áp dụng môi trường.');
            return;
        }
        setWeatherApplyStatus('loading');
        setWeatherApplyMessage('Đang áp dụng môi trường...');
        const sent = socket.applyWeather(weather);
        if (!sent) {
            setWeatherApplyStatus('error');
            setWeatherApplyMessage('Không áp dụng được môi trường. Kiểm tra kết nối/worker.');
            return;
        }
        window.setTimeout(() => {
            setWeatherApplyStatus('success');
            setWeatherApplyMessage('Đã áp dụng môi trường.');
            window.setTimeout(() => {
                setWeatherApplyStatus('idle');
                setWeatherApplyMessage(null);
            }, SUCCESS_CLEAR_MS);
        }, 600);
    }, [socket, weather]);

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
                droneCount={droneCount}
                drones={socket.drones}
                orders={socket.orders}
            />
            <div
                className="grid min-h-0 flex-1"
                style={{
                    gridTemplateColumns: rightPanelCollapsed
                        ? '80px minmax(0, 1fr) 48px'
                        : '80px minmax(0, 1fr) 380px'
                }}
            >
                <LeftNavigation activeSection={activeSection} onChange={setActiveSection} />
                <div className="flex min-h-0 min-w-0 flex-col">
                    <main className="min-h-0 min-w-0 flex-1">
                        <UavMap
                            buildings={buildings}
                            mapConfig={effectiveMapConfig}
                            drones={socket.drones}
                            orders={socket.orders}
                            missions={socket.missions}
                            selectedOrderId={selectedOrderId}
                            selectedMissionId={selectedMissionId}
                            selectedDroneId={socket.selectedDroneId}
                            plannedPaths={socket.plannedPaths}
                            pathHistoryByDrone={telemetryHistory.pathHistoryByDrone}
                            dynamicObstacles={dynamicObstacles}
                            dynamicNoFlyZones={dynamicNoFlyZones}
                            windShadowZones={socket.windShadowZones}
                            layers={layers}
                            buildingLoadStatus={buildingLoadStatus}
                            windDir={weather.wind_dir}
                            windSpeed={weather.wind_speed}
                            mapInteractionMode={mapInteractionMode}
                            resizeKey={`${rightPanelCollapsed}-${activeSection}`}
                            onMapClick={handleMapClick}
                            onSelectDrone={handleSelectDrone}
                            onSelectOrder={handleSelectOrder}
                        />
                    </main>
                    <BottomDroneInfoPanel
                        selectedDrone={socket.selectedDrone}
                        selectedDroneId={socket.selectedDroneId}
                        orders={socket.orders}
                        missions={socket.missions}
                        plannedPath3d={socket.selectedPath3d}
                        selectedOrderId={selectedOrderId}
                        selectedMissionId={selectedMissionId}
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
                    noFlyZoneConfig={noFlyZoneConfig}
                    dynamicNoFlyZones={dynamicNoFlyZones}
                    layers={layers}
                    droneCount={droneCount}
                    batteryHistory={telemetryHistory.batteryHistory}
                    temperatureHistory={telemetryHistory.temperatureHistory}
                    altitudeHistory={telemetryHistory.altitudeHistory}
                    orders={socket.orders}
                    missions={socket.missions}
                    draftOrder={draftOrder}
                    draftOrders={draftOrders}
                    mapConfig={effectiveMapConfig}
                    selectedMapId={selectedMapId}
                    selectedMapLabel={selectedMapPreset.label}
                    activeMapId={activeMapId}
                    onOpenMapSelector={() => {
                        if (MAP_PRESET_OPTIONS.length > 1) setMapSelectorOpen(true);
                    }}
                    mapChangeDisabled={mapChangeDisabled}
                    selectedOrderId={selectedOrderId}
                    selectedMissionId={selectedMissionId}
                    eventFilter={eventFilter}
                    mapInteractionMode={mapInteractionMode}
                    importError={importError}
                    isStartingSimulation={socket.isStartingSimulation}
                    isAwaitingConfig={socket.isAwaitingConfig}
                    isAwaitingFirstTelemetry={socket.isAwaitingFirstTelemetry}
                    windShadowRequestStatus={socket.windShadowRequestStatus}
                    buildingLoadStatus={buildingLoadStatus}
                    weatherApplyStatus={weatherApplyStatus}
                    weatherApplyMessage={weatherApplyMessage}
                    commandFeedback={commandFeedback}
                    canStartWithOrders={canStartWithOrders}
                    startHint={effectiveStartHint}
                    onStart={handleStartWithDraftOrders}
                    onDroneCountChange={handleDroneCountChange}
                    onSelectDrone={handleSelectDrone}
                    onPause={socket.pauseSimulation}
                    onResume={socket.resumeSimulation}
                    onStop={handleStop}
                    onReset={handleReset}
                    onWeatherChange={handleWeatherChange}
                    onApplyWeather={handleApplyWeather}
                    onObstacleChange={handleObstacleChange}
                    onNoFlyZoneChange={handleNoFlyZoneChange}
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
                    collapsed={rightPanelCollapsed}
                    onToggleCollapsed={() => setRightPanelCollapsed(prev => !prev)}
                />
            </div>
            {MAP_PRESET_OPTIONS.length > 1 && (
                <MapSelectorModal
                    open={mapSelectorOpen}
                    selectedMapId={selectedMapId}
                    activeMapId={activeMapId}
                    disabled={mapChangeDisabled}
                    simulationRunning={socket.simulationStatus === 'running'}
                    onClose={() => setMapSelectorOpen(false)}
                    onSelectMap={handleSelectMap}
                />
            )}
        </div>
    );
}
