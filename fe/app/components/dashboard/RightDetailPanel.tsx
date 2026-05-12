'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import AltitudePanel from '../panels/AltitudePanel';
import ConnectionPanel from '../panels/ConnectionPanel';
import ControlPanel from '../panels/ControlPanel';
import DroneListPanel from '../panels/DroneListPanel';
import EventLogPanel from '../panels/EventLogPanel';
import LayerTogglePanel from '../panels/LayerTogglePanel';
import NoFlyZonePanel, { type NoFlyZoneConfig } from '../panels/NoFlyZonePanel';
import ObstaclePanel from '../panels/ObstaclePanel';
import TelemetryPanel from '../panels/TelemetryPanel';
import WeatherPanel from '../panels/WeatherPanel';
import OrderManagementModal from './OrderManagementModal';
import OrderManagementPanel from './OrderManagementPanel';
import OrderDetailPanel from './OrderDetailPanel';
import DroneMissionPanel from './DroneMissionPanel';
import EventFilterBar from './EventFilterBar';
import MissionProgressPanel from './MissionProgressPanel';
import {
    orderIdOf,
    missionIdOf,
    translateMissionStatus,
    translateOrderStatus
} from '../utils/labels';
import { ActionStatusMessage } from '../ui/ActionStatus';
import type {
    ActiveDashboardSection,
    AsyncRequestStatus,
    DeliveryOrder,
    DraftOrder,
    DroneTelemetry,
    DronesById,
    DynamicNoFlyZone,
    EventFilter,
    EventLogEntry,
    LayerToggles,
    MapConfig,
    MapInteractionMode,
    Mission,
    MissionsById,
    ObstacleConfig,
    ObstacleType,
    OrdersById,
    PlannedPath3DPoint,
    ServerStatus,
    SimulationStatus,
    WeatherState,
    WorkerStatus
} from '../types/simulation';

type RightDetailPanelProps = {
    activeSection: ActiveDashboardSection;
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
    droneState: DroneTelemetry | null;
    drones: DronesById;
    selectedDroneId: string | null;
    plannedPath3d: PlannedPath3DPoint[];
    eventLogs: EventLogEntry[];
    weather: WeatherState;
    obstacleConfig: ObstacleConfig;
    noFlyZoneConfig: NoFlyZoneConfig;
    dynamicNoFlyZones: DynamicNoFlyZone[];
    layers: LayerToggles;
    droneCount: number;
    canStartWithOrders: boolean;
    startHint: string;
    batteryHistory: number[];
    temperatureHistory: number[];
    altitudeHistory: number[];
    orders: OrdersById;
    missions: MissionsById;
    draftOrder: DraftOrder;
    draftOrders: DraftOrder[];
    mapConfig: MapConfig | null;
    selectedMapId: string;
    selectedMapLabel: string;
    activeMapId?: string | null;
    mapChangeDisabled: boolean;
    selectedOrderId: string | null;
    selectedMissionId: string | null;
    eventFilter: EventFilter;
    mapInteractionMode: MapInteractionMode;
    importError: string | null;
    isStartingSimulation: boolean;
    isAwaitingConfig: boolean;
    isAwaitingFirstTelemetry: boolean;
    windShadowRequestStatus: AsyncRequestStatus;
    buildingLoadStatus: 'idle' | 'loading' | 'success' | 'error';
    weatherApplyStatus: AsyncRequestStatus;
    weatherApplyMessage: string | null;
    commandFeedback: { tone: AsyncRequestStatus; message: string } | null;
    onStart: () => void;
    onDroneCountChange: (value: number) => void;
    onSelectDrone: (droneId: string) => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onReset: () => void;
    onWeatherChange: (key: keyof WeatherState, value: number | boolean) => void;
    onApplyWeather: () => void;
    onObstacleChange: (key: keyof ObstacleConfig, value: number | ObstacleType) => void;
    onNoFlyZoneChange: (key: keyof NoFlyZoneConfig, value: number) => void;
    onLayerToggle: (key: keyof LayerToggles) => void;
    onSelectOrder: (orderId: string) => void;
    onSelectMission: (missionId: string) => void;
    onEventFilterChange: (value: EventFilter) => void;
    onAddDemoDraftOrders: (orders: DraftOrder[]) => void;
    onStartWithDraftOrders: () => boolean;
    onDraftChange: <K extends keyof DraftOrder>(key: K, value: DraftOrder[K]) => void;
    onAddDraftOrder: () => void;
    onRemoveDraftOrder: (orderId: string) => void;
    onSubmitDraftOrders: () => boolean;
    onImportJson: (text: string) => boolean;
    onDispatchOrders: () => void;
    onOpenMapSelector: () => void;
    onSetMapInteractionMode: (mode: MapInteractionMode) => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
};

function SectionFrame({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">{title}</h2>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-800">{value}</p>
        </div>
    );
}

function MapPresetPanel({
    selectedMapId,
    selectedMapLabel,
    activeMapId,
    disabled,
    onOpen
}: {
    selectedMapId: string;
    selectedMapLabel: string;
    activeMapId?: string | null;
    disabled: boolean;
    onOpen: () => void;
}) {
    return (
        <SectionFrame title="Bản đồ mô phỏng">
            <div className="space-y-3">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase text-slate-500">Đang chọn</p>
                            <p data-testid="selected-map-label" className="mt-1 truncate text-sm font-bold text-slate-800">{selectedMapLabel}</p>
                            <p className="mt-1 truncate font-mono text-[11px] font-semibold text-slate-500">{selectedMapId}</p>
                        </div>
                        {activeMapId && (
                            <span className="shrink-0 rounded bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                                Đang chạy
                            </span>
                        )}
                    </div>
                </div>
                {disabled && (
                    <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                        Dừng/đặt lại mô phỏng trước khi đổi bản đồ.
                    </p>
                )}
                <button
                    type="button"
                    data-testid="open-map-selector"
                    onClick={onOpen}
                    className="w-full rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700"
                >
                    Chọn bản đồ
                </button>
            </div>
        </SectionFrame>
    );
}

function OrdersSummaryPanel({ orders, missions }: { orders: OrdersById; missions: MissionsById }) {
    const rows = Object.values(orders);
    const missionRows = Object.values(missions);
    const active = rows.filter(order => !['completed', 'failed', 'canceled'].includes(order.status)).length;
    const completed = rows.filter(order => order.status === 'completed').length;
    const failed = rows.filter(order => order.status === 'failed').length;

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
                <SummaryCard label="Tổng đơn" value={rows.length} />
                <SummaryCard label="Đang xử lý" value={active} />
                <SummaryCard label="Hoàn thành" value={completed} />
                <SummaryCard label="Thất bại" value={failed} />
            </div>
            <SectionFrame title="Danh sách đơn hàng">
                <div className="space-y-2">
                    {rows.map((order: DeliveryOrder) => {
                        const id = orderIdOf(order);
                        return (
                            <div key={id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-slate-800">{id}</span>
                                    <span className="font-bold text-slate-600">{translateOrderStatus(order.status)}</span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                                    <span>Tải trọng</span>
                                    <span className="text-right font-mono">{order.payloadKg ?? order.payload_kg ?? '--'}kg</span>
                                    <span>UAV</span>
                                    <span className="truncate text-right font-mono">{order.assignedDroneId ?? order.assigned_drone_id ?? '--'}</span>
                                    <span>Nhiệm vụ</span>
                                    <span className="truncate text-right font-mono">{order.missionId ?? order.mission_id ?? '--'}</span>
                                </div>
                            </div>
                        );
                    })}
                    {rows.length === 0 && (
                        <p className="text-sm italic text-slate-400">Chưa có đơn hàng. Phase 12 sẽ bổ sung form nhập đơn.</p>
                    )}
                </div>
            </SectionFrame>
            <SectionFrame title="Nhiệm vụ">
                <div className="space-y-2">
                    {missionRows.map((mission: Mission) => (
                        <div key={missionIdOf(mission)} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-slate-800">{missionIdOf(mission)}</span>
                                <span className="font-bold text-slate-600">{translateMissionStatus(mission.status)}</span>
                            </div>
                            <p className="mt-1 text-slate-600">UAV: <span className="font-mono">{mission.droneId ?? mission.drone_id ?? '--'}</span></p>
                        </div>
                    ))}
                    {missionRows.length === 0 && <p className="text-sm italic text-slate-400">Chưa có nhiệm vụ.</p>}
                </div>
            </SectionFrame>
        </div>
    );
}

function includesId(log: EventLogEntry, id: string | null) {
    if (!id) return false;
    return [log.orderId, log.missionId, log.droneId, log.code, log.message]
        .filter(Boolean)
        .some(value => String(value).includes(id));
}

function filterEvents(
    events: EventLogEntry[],
    eventFilter: EventFilter,
    selectedDroneId: string | null,
    selectedOrderId: string | null,
    selectedMissionId: string | null
) {
    if (eventFilter === 'selected_drone') {
        return events.filter(log => selectedDroneId && log.droneId === selectedDroneId);
    }
    if (eventFilter === 'selected_order') {
        return events.filter(log => includesId(log, selectedOrderId));
    }
    if (eventFilter === 'selected_mission') {
        return events.filter(log => includesId(log, selectedMissionId));
    }
    return events;
}

export default function RightDetailPanel(props: RightDetailPanelProps) {
    const [orderModalOpen, setOrderModalOpen] = useState(false);
    const droneRows = Object.values(props.drones);
    const orderRows = Object.values(props.orders);
    const totalDrones = droneRows.length || props.droneCount;
    const idleDrones = droneRows.length
        ? droneRows.filter(drone => drone.status === 'idle' && !drone.currentOrderId && !drone.currentMissionId).length
        : totalDrones;
    const remainingOrders = orderRows.filter(order => !['completed', 'failed', 'canceled'].includes(order.status)).length;
    const transportingOrders = orderRows.filter(order => ['going_to_pickup', 'picked_up', 'delivering'].includes(order.status)).length;
    const completedOrders = orderRows.filter(order => order.status === 'completed').length;
    const failedOrders = orderRows.filter(order => order.status === 'failed').length;
    const selectedDrone = props.selectedDroneId ? props.drones[props.selectedDroneId] ?? props.droneState : props.droneState;
    const selectedOrder = props.selectedOrderId
        ? props.orders[props.selectedOrderId] ?? null
        : selectedDrone?.currentOrderId
            ? props.orders[selectedDrone.currentOrderId] ?? null
            : null;
    const orderMissionId = selectedOrder?.missionId ?? selectedOrder?.mission_id ?? null;
    const droneMissionId = selectedDrone?.currentMissionId ?? null;
    const selectedMission = props.selectedMissionId
        ? props.missions[props.selectedMissionId] ?? null
        : orderMissionId
            ? props.missions[orderMissionId] ?? null
            : droneMissionId
                ? props.missions[droneMissionId] ?? null
                : null;
    const missionOrderId = selectedMission?.orderId ?? selectedMission?.order_id ?? null;
    const progressOrder = selectedOrder ?? (missionOrderId ? props.orders[missionOrderId] ?? null : null);
    const missionDroneId = selectedMission?.droneId ?? selectedMission?.drone_id ?? null;
    const orderDroneId = progressOrder?.assignedDroneId ?? progressOrder?.assigned_drone_id ?? null;
    const relatedDrone = selectedDrone ?? (missionDroneId ? props.drones[missionDroneId] ?? null : orderDroneId ? props.drones[orderDroneId] ?? null : null);
    const filteredEvents = filterEvents(props.eventLogs, props.eventFilter, props.selectedDroneId, props.selectedOrderId, props.selectedMissionId);

    if (props.collapsed) {
        return (
            <>
                <aside className="flex h-full w-full shrink-0 items-start justify-center border-l border-slate-200 bg-slate-50 p-2">
                    <button
                        type="button"
                        data-testid="expand-right-panel"
                        title="Mở bảng điều khiển"
                        aria-label="Mở bảng điều khiển"
                        onClick={props.onToggleCollapsed}
                        className="w-full cursor-pointer rounded border border-slate-300 bg-white px-2 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                        Mở
                    </button>
                </aside>
                <OrderManagementModal
                    open={orderModalOpen}
                    onClose={() => setOrderModalOpen(false)}
                    draftOrder={props.draftOrder}
                    draftOrders={props.draftOrders}
                    activeSimId={props.activeSimId}
                    mapConfig={props.mapConfig}
                    dynamicNoFlyZones={props.dynamicNoFlyZones}
                    mapInteractionMode={props.mapInteractionMode}
                    importError={props.importError}
                    isStartingSimulation={props.isStartingSimulation}
                    canStartWithOrders={props.canStartWithOrders && props.serverStatus === 'connected' && props.workerStatus === 'idle' && props.simulationStatus !== 'running'}
                    startHint={props.startHint}
                    onDraftChange={props.onDraftChange}
                    onAddDraftOrder={props.onAddDraftOrder}
                    onRemoveDraftOrder={props.onRemoveDraftOrder}
                    onImportJson={props.onImportJson}
                    onAddDraftOrders={props.onAddDemoDraftOrders}
                    onStartWithDraftOrders={props.onStartWithDraftOrders}
                    onSubmitDraftOrders={props.onSubmitDraftOrders}
                    onSetMapInteractionMode={props.onSetMapInteractionMode}
                />
            </>
        );
    }

    return (
        <>
        <aside className="h-full w-full min-w-0 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
            <div className="space-y-3">
                <div className="sticky top-0 z-10 -mx-3 -mt-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <button
                        type="button"
                        data-testid="collapse-right-panel"
                        onClick={props.onToggleCollapsed}
                        className="w-full cursor-pointer rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100"
                    >
                        Thu gọn
                    </button>
                </div>
                {props.commandFeedback && (
                    <ActionStatusMessage tone={props.commandFeedback.tone === 'idle' ? 'info' : props.commandFeedback.tone}>
                        {props.commandFeedback.message}
                    </ActionStatusMessage>
                )}
                {props.activeSection === 'overview' && (
                    <>
                        <ConnectionPanel {...props} />
                        <ControlPanel {...props} onOpenOrderModal={() => setOrderModalOpen(true)} />
                        <SectionFrame title="Tổng quan vận hành">
                            <div className="grid grid-cols-2 gap-2">
                                <SummaryCard label="Tổng UAV" value={totalDrones} />
                                <SummaryCard label="UAV rảnh" value={idleDrones} />
                                <SummaryCard label="Đơn hàng còn lại" value={remainingOrders} />
                                <SummaryCard label="Đơn đang vận chuyển" value={transportingOrders} />
                                <SummaryCard label="Đơn hoàn thành" value={completedOrders} />
                                <SummaryCard label="Đơn thất bại" value={failedOrders} />
                            </div>
                        </SectionFrame>
                    </>
                )}

                {props.activeSection === 'orders' && (
                    <>
                        <OrderManagementPanel
                            orders={props.orders}
                            missions={props.missions}
                            draftOrderCount={props.draftOrders.length}
                            selectedOrderId={props.selectedOrderId}
                            onSelectOrder={props.onSelectOrder}
                            onOpenOrderModal={() => setOrderModalOpen(true)}
                        />
                        <OrderDetailPanel
                            selectedOrder={progressOrder}
                            relatedMission={selectedMission}
                            relatedDrone={relatedDrone}
                        />
                        {(progressOrder || selectedMission || relatedDrone) && (
                            <MissionProgressPanel
                                order={progressOrder}
                                mission={selectedMission}
                                drone={relatedDrone}
                                plannedPath3d={props.plannedPath3d}
                                onSelectDrone={props.onSelectDrone}
                                onSelectOrder={props.onSelectOrder}
                            />
                        )}
                    </>
                )}

                {props.activeSection === 'drones' && (
                    <>
                        <DroneListPanel drones={props.drones} selectedDroneId={props.selectedDroneId} onSelect={props.onSelectDrone} />
                        <DroneMissionPanel
                            selectedDrone={selectedDrone}
                            selectedOrder={progressOrder}
                            selectedMission={selectedMission}
                            orders={props.orders}
                            missions={props.missions}
                            plannedPath3d={props.plannedPath3d}
                            onSelectOrder={props.onSelectOrder}
                            onSelectMission={props.onSelectMission}
                        />
                        {(progressOrder || selectedMission) && (
                            <MissionProgressPanel
                                order={progressOrder}
                                mission={selectedMission}
                                drone={relatedDrone}
                                plannedPath3d={props.plannedPath3d}
                                onSelectDrone={props.onSelectDrone}
                                onSelectOrder={props.onSelectOrder}
                            />
                        )}
                        <TelemetryPanel
                            droneState={props.droneState}
                            batteryHistory={props.batteryHistory}
                            temperatureHistory={props.temperatureHistory}
                            altitudeHistory={props.altitudeHistory}
                        />
                        <AltitudePanel
                            droneState={props.droneState}
                            plannedPath3d={props.plannedPath3d}
                            altitudeHistory={props.altitudeHistory}
                        />
                    </>
                )}

                {props.activeSection === 'environment' && (
                    <>
                        <WeatherPanel
                            weather={props.weather}
                            onChange={props.onWeatherChange}
                            onApply={props.onApplyWeather}
                            disabled={!props.activeSimId}
                            status={props.weatherApplyStatus}
                            statusMessage={props.weatherApplyMessage}
                        />
                        <ObstaclePanel
                            obstacleConfig={props.obstacleConfig}
                            onChange={props.onObstacleChange}
                            isPlacingObstacle={props.mapInteractionMode === 'obstacle'}
                            onStartPlacement={() => props.onSetMapInteractionMode('obstacle')}
                            onCancelPlacement={() => props.onSetMapInteractionMode('none')}
                        />
                        <NoFlyZonePanel
                            config={props.noFlyZoneConfig}
                            zones={props.dynamicNoFlyZones}
                            mapInteractionMode={props.mapInteractionMode}
                            onChange={props.onNoFlyZoneChange}
                            onStartPlacement={() => props.onSetMapInteractionMode('no_fly_zone')}
                            onCancelPlacement={() => props.onSetMapInteractionMode('none')}
                        />
                    </>
                )}

                {props.activeSection === 'map_tools' && (
                    <>
                        <MapPresetPanel
                            selectedMapId={props.selectedMapId}
                            selectedMapLabel={props.selectedMapLabel}
                            activeMapId={props.activeMapId}
                            disabled={props.mapChangeDisabled}
                            onOpen={props.onOpenMapSelector}
                        />
                        <LayerTogglePanel
                            layers={props.layers}
                            activeSimId={props.activeSimId}
                            windShadowStatus={props.windShadowRequestStatus}
                            buildingLoadStatus={props.buildingLoadStatus}
                            onToggle={props.onLayerToggle}
                        />
                    </>
                )}

                {props.activeSection === 'events' && (
                    <SectionFrame title="Bộ lọc sự kiện">
                        <div className="space-y-3">
                            <EventFilterBar
                                value={props.eventFilter}
                                selectedDroneId={props.selectedDroneId}
                                selectedOrderId={props.selectedOrderId}
                                selectedMissionId={props.selectedMissionId}
                                onChange={props.onEventFilterChange}
                            />
                            {filteredEvents.length > 0 ? (
                                <EventLogPanel events={filteredEvents} limit={40} />
                            ) : (
                                <p className="text-sm italic text-slate-400">Không có sự kiện phù hợp với bộ lọc hiện tại.</p>
                            )}
                        </div>
                    </SectionFrame>
                )}
            </div>
        </aside>
        <OrderManagementModal
            open={orderModalOpen}
            onClose={() => setOrderModalOpen(false)}
            draftOrder={props.draftOrder}
            draftOrders={props.draftOrders}
            activeSimId={props.activeSimId}
            mapConfig={props.mapConfig}
            dynamicNoFlyZones={props.dynamicNoFlyZones}
            mapInteractionMode={props.mapInteractionMode}
            importError={props.importError}
            isStartingSimulation={props.isStartingSimulation}
            canStartWithOrders={props.canStartWithOrders && props.serverStatus === 'connected' && props.workerStatus === 'idle' && props.simulationStatus !== 'running'}
            startHint={props.startHint}
            onDraftChange={props.onDraftChange}
            onAddDraftOrder={props.onAddDraftOrder}
            onRemoveDraftOrder={props.onRemoveDraftOrder}
            onImportJson={props.onImportJson}
            onAddDraftOrders={props.onAddDemoDraftOrders}
            onStartWithDraftOrders={props.onStartWithDraftOrders}
            onSubmitDraftOrders={props.onSubmitDraftOrders}
            onSetMapInteractionMode={props.onSetMapInteractionMode}
        />
        </>
    );
}
