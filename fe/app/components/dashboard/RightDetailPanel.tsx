'use client';

import type { ReactNode } from 'react';
import AltitudePanel from '../panels/AltitudePanel';
import ConnectionPanel from '../panels/ConnectionPanel';
import ControlPanel from '../panels/ControlPanel';
import DroneListPanel from '../panels/DroneListPanel';
import EventLogPanel from '../panels/EventLogPanel';
import LayerTogglePanel from '../panels/LayerTogglePanel';
import ObstaclePanel from '../panels/ObstaclePanel';
import TelemetryPanel from '../panels/TelemetryPanel';
import WeatherPanel from '../panels/WeatherPanel';
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
import type {
    ActiveDashboardSection,
    DeliveryOrder,
    DraftOrder,
    DroneTelemetry,
    DronesById,
    EventFilter,
    EventLogEntry,
    LayerToggles,
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
    selectedOrderId: string | null;
    selectedMissionId: string | null;
    eventFilter: EventFilter;
    mapInteractionMode: MapInteractionMode;
    importError: string | null;
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
    onLayerToggle: (key: keyof LayerToggles) => void;
    onSelectOrder: (orderId: string) => void;
    onSelectMission: (missionId: string) => void;
    onEventFilterChange: (value: EventFilter) => void;
    onAddDemoDraftOrders: (orders: DraftOrder[]) => void;
    onStartWithDraftOrders: () => void;
    onDraftChange: <K extends keyof DraftOrder>(key: K, value: DraftOrder[K]) => void;
    onAddDraftOrder: () => void;
    onRemoveDraftOrder: (orderId: string) => void;
    onSubmitDraftOrders: () => void;
    onImportJson: (text: string) => void;
    onDispatchOrders: () => void;
    onSetMapInteractionMode: (mode: MapInteractionMode) => void;
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
    const droneRows = Object.values(props.drones);
    const busyDrones = droneRows.filter(drone => (
        Boolean(drone.currentOrderId || drone.currentMissionId)
        || (['flying', 'rerouting'].includes(String(drone.status)) && ['pickup', 'dropoff', 'charging_station'].includes(String(drone.currentTargetType)))
    )).length;
    const idleDrones = droneRows.filter(drone => drone.status === 'idle' && !drone.currentOrderId && !drone.currentMissionId).length;
    const chargingDrones = droneRows.filter(drone => drone.status === 'charging').length;
    const failedDrones = droneRows.filter(drone => ['failed', 'emergency_landing'].includes(String(drone.status))).length;
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

    return (
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
            <div className="space-y-3">
                {props.activeSection === 'overview' && (
                    <>
                        <ConnectionPanel {...props} />
                        <ControlPanel {...props} />
                        <SectionFrame title="Tổng quan khai thác">
                            <div className="grid grid-cols-2 gap-2">
                                <SummaryCard label="Tổng UAV" value={droneRows.length} />
                                <SummaryCard label="UAV rảnh" value={idleDrones} />
                                <SummaryCard label="UAV đang giao" value={busyDrones} />
                                <SummaryCard label="UAV sạc/lỗi" value={`${chargingDrones}/${failedDrones}`} />
                                <SummaryCard label="Đơn đang giao" value={Object.values(props.orders).filter(order => ['going_to_pickup', 'picked_up', 'delivering'].includes(order.status)).length} />
                                <SummaryCard label="Đơn hoàn thành" value={Object.values(props.orders).filter(order => order.status === 'completed').length} />
                                <SummaryCard label="Đơn thất bại" value={Object.values(props.orders).filter(order => order.status === 'failed').length} />
                            </div>
                        </SectionFrame>
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

                {props.activeSection === 'orders' && (
                    <>
                        <OrderManagementPanel
                            orders={props.orders}
                            missions={props.missions}
                            draftOrder={props.draftOrder}
                            draftOrders={props.draftOrders}
                            selectedOrderId={props.selectedOrderId}
                            activeSimId={props.activeSimId}
                            mapInteractionMode={props.mapInteractionMode}
                            importError={props.importError}
                            droneCount={props.droneCount}
                            canStartWithOrders={props.canStartWithOrders && props.serverStatus === 'connected' && props.workerStatus === 'idle' && props.simulationStatus !== 'running'}
                            startHint={props.startHint}
                            onSelectOrder={props.onSelectOrder}
                            onAddDemoDraftOrders={props.onAddDemoDraftOrders}
                            onStartWithDraftOrders={props.onStartWithDraftOrders}
                            onDraftChange={props.onDraftChange}
                            onAddDraftOrder={props.onAddDraftOrder}
                            onRemoveDraftOrder={props.onRemoveDraftOrder}
                            onSubmitDraftOrders={props.onSubmitDraftOrders}
                            onImportJson={props.onImportJson}
                            onDispatchOrders={props.onDispatchOrders}
                            onSetMapInteractionMode={props.onSetMapInteractionMode}
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
                        />
                        <ObstaclePanel obstacleConfig={props.obstacleConfig} onChange={props.onObstacleChange} />
                    </>
                )}

                {props.activeSection === 'map_tools' && (
                    <>
                        <LayerTogglePanel layers={props.layers} onToggle={props.onLayerToggle} />
                        <SectionFrame title="Chế độ thao tác">
                            <button
                                onClick={() => props.onSetMapInteractionMode(props.mapInteractionMode === 'obstacle' ? 'none' : 'obstacle')}
                                className={`w-full rounded px-3 py-2 text-xs font-bold ${
                                    props.mapInteractionMode === 'obstacle'
                                        ? 'bg-orange-600 text-white'
                                        : 'border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'
                                }`}
                            >
                                {props.mapInteractionMode === 'obstacle' ? 'Tắt chế độ đặt vật cản' : 'Bật chế độ đặt vật cản'}
                            </button>
                        </SectionFrame>
                        <SectionFrame title="Công cụ bản đồ">
                            <p className="text-sm leading-relaxed text-slate-600">
                                Bật/tắt lớp bản đồ và click lên bản đồ để đặt vật cản khi công cụ vật cản đang cấu hình.
                            </p>
                        </SectionFrame>
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
    );
}
