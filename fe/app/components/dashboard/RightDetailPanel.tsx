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
    batteryHistory: number[];
    temperatureHistory: number[];
    altitudeHistory: number[];
    orders: OrdersById;
    missions: MissionsById;
    draftOrder: DraftOrder;
    draftOrders: DraftOrder[];
    selectedOrderId: string | null;
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

function CurrentMissionPanel({
    droneState,
    orders,
    missions
}: {
    droneState: DroneTelemetry | null;
    orders: OrdersById;
    missions: MissionsById;
}) {
    const order = droneState?.currentOrderId ? orders[droneState.currentOrderId] : null;
    const mission = droneState?.currentMissionId ? missions[droneState.currentMissionId] : null;
    return (
        <SectionFrame title="Nhiệm vụ hiện tại">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                <span className="text-slate-500">Đơn hàng</span>
                <span className="truncate text-right">{droneState?.currentOrderId ?? '--'}</span>
                <span className="text-slate-500">Nhiệm vụ</span>
                <span className="truncate text-right">{droneState?.currentMissionId ?? '--'}</span>
                <span className="text-slate-500">Mục tiêu</span>
                <span className="truncate text-right">{droneState?.currentTargetType ?? '--'}</span>
                <span className="text-slate-500">Trạng thái đơn</span>
                <span className="truncate text-right">{translateOrderStatus(order?.status)}</span>
                <span className="text-slate-500">Trạng thái nhiệm vụ</span>
                <span className="truncate text-right">{translateMissionStatus(mission?.status)}</span>
            </div>
        </SectionFrame>
    );
}

export default function RightDetailPanel(props: RightDetailPanelProps) {
    const selectedOrder = props.selectedOrderId ? props.orders[props.selectedOrderId] ?? null : null;
    const selectedMissionId = selectedOrder?.missionId ?? selectedOrder?.mission_id;
    const relatedMission = selectedMissionId ? props.missions[selectedMissionId] ?? null : null;
    const relatedDroneId = selectedOrder?.assignedDroneId ?? selectedOrder?.assigned_drone_id;
    const relatedDrone = relatedDroneId ? props.drones[relatedDroneId] ?? null : null;

    return (
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3">
            <div className="space-y-3">
                {props.activeSection === 'overview' && (
                    <>
                        <ConnectionPanel {...props} />
                        <ControlPanel {...props} />
                        <SectionFrame title="Tổng quan khai thác">
                            <div className="grid grid-cols-2 gap-2">
                                <SummaryCard label="Số UAV" value={Object.keys(props.drones).length} />
                                <SummaryCard label="Số đơn hàng" value={Object.keys(props.orders).length} />
                                <SummaryCard label="Đơn đang giao" value={Object.values(props.orders).filter(order => ['going_to_pickup', 'picked_up', 'delivering'].includes(order.status)).length} />
                                <SummaryCard label="Đơn xong/lỗi" value={Object.values(props.orders).filter(order => ['completed', 'failed'].includes(order.status)).length} />
                            </div>
                        </SectionFrame>
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
                            onSelectOrder={props.onSelectOrder}
                            onDraftChange={props.onDraftChange}
                            onAddDraftOrder={props.onAddDraftOrder}
                            onRemoveDraftOrder={props.onRemoveDraftOrder}
                            onSubmitDraftOrders={props.onSubmitDraftOrders}
                            onImportJson={props.onImportJson}
                            onDispatchOrders={props.onDispatchOrders}
                            onSetMapInteractionMode={props.onSetMapInteractionMode}
                        />
                        <OrderDetailPanel
                            selectedOrder={selectedOrder}
                            relatedMission={relatedMission}
                            relatedDrone={relatedDrone}
                        />
                    </>
                )}

                {props.activeSection === 'drones' && (
                    <>
                        <DroneListPanel drones={props.drones} selectedDroneId={props.selectedDroneId} onSelect={props.onSelectDrone} />
                        <CurrentMissionPanel droneState={props.droneState} orders={props.orders} missions={props.missions} />
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

                {props.activeSection === 'events' && <EventLogPanel events={props.eventLogs} limit={40} />}
            </div>
        </aside>
    );
}
