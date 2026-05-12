'use client';

import type {
    DeliveryOrder,
    DroneTelemetry,
    Mission,
    MissionsById,
    OrdersById,
    PlannedPath3DPoint
} from '../types/simulation';
import {
    formatDistanceMeters,
    formatEtaSeconds,
    formatPayloadKg,
    missionIdOf,
    orderIdOf,
    translateDroneStatus,
    translateMissionStatus,
    translateOrderStatus,
    translateTargetType
} from '../utils/labels';

type DroneMissionPanelProps = {
    selectedDrone: DroneTelemetry | null;
    selectedOrder: DeliveryOrder | null;
    selectedMission: Mission | null;
    orders: OrdersById;
    missions: MissionsById;
    plannedPath3d: PlannedPath3DPoint[];
    onSelectOrder: (orderId: string) => void;
    onSelectMission: (missionId: string) => void;
};

function value(value?: string | number | null) {
    if (value === null || value === undefined || value === '') return '--';
    return String(value);
}

function haversineMeters(a: [number, number], b: [number, number]) {
    const radius = 6371000;
    const toRad = (input: number) => input * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimatePathDistanceMeters(path: PlannedPath3DPoint[], startIndex?: number) {
    if (path.length < 2) return null;
    const safeStart = typeof startIndex === 'number' && startIndex >= 0 && startIndex < path.length - 1 ? startIndex : 0;
    let total = 0;
    for (let idx = safeStart; idx < path.length - 1; idx += 1) {
        total += haversineMeters(path[idx].pos, path[idx + 1].pos);
    }
    return total;
}

export default function DroneMissionPanel({
    selectedDrone,
    selectedOrder,
    selectedMission,
    orders,
    missions,
    plannedPath3d,
    onSelectOrder,
    onSelectMission
}: DroneMissionPanelProps) {
    if (!selectedDrone) {
        return (
            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">UAV đang chọn</h2>
                <p className="mt-3 text-sm italic text-slate-400">Chọn một UAV để xem nhiệm vụ hiện tại.</p>
            </section>
        );
    }

    const droneId = selectedDrone.droneId ?? 'drone_1';
    const currentOrderId = selectedDrone.currentOrderId ?? selectedMission?.orderId ?? selectedMission?.order_id ?? null;
    const currentMissionId = selectedDrone.currentMissionId ?? selectedOrder?.missionId ?? selectedOrder?.mission_id ?? null;
    const relatedOrder = selectedOrder ?? (currentOrderId ? orders[currentOrderId] ?? null : null);
    const relatedMission = selectedMission ?? (currentMissionId ? missions[currentMissionId] ?? null : null);
    const battery = selectedDrone.batteryPercent ?? selectedDrone.battery;
    const payloadKg = selectedDrone.payloadKg ?? relatedOrder?.payloadKg ?? relatedOrder?.payload_kg ?? null;
    const remainingMeters = estimatePathDistanceMeters(plannedPath3d, selectedDrone.currentPathIndex);
    const etaSeconds = remainingMeters !== null && typeof selectedDrone.speed === 'number' && selectedDrone.speed > 0
        ? remainingMeters / selectedDrone.speed
        : null;

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">UAV đang chọn</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-slate-700">
                <span className="text-slate-500">Mã UAV</span>
                <span className="truncate text-right font-mono">{droneId}</span>
                <span className="text-slate-500">Trạng thái UAV</span>
                <span className="truncate text-right">{translateDroneStatus(selectedDrone.status)}</span>
                <span className="text-slate-500">Pin</span>
                <span className="truncate text-right font-mono">{typeof battery === 'number' ? `${battery.toFixed(1)}%` : '--'}</span>
                <span className="text-slate-500">Độ cao</span>
                <span className="truncate text-right font-mono">{typeof selectedDrone.altitude === 'number' ? `${selectedDrone.altitude.toFixed(1)} m` : '--'}</span>
                <span className="text-slate-500">Tốc độ</span>
                <span className="truncate text-right font-mono">{typeof selectedDrone.speed === 'number' ? `${selectedDrone.speed.toFixed(1)} m/s` : '--'}</span>
                <span className="text-slate-500">Tải trọng hiện tại</span>
                <span className="truncate text-right font-mono">{formatPayloadKg(payloadKg)}</span>
                <span className="text-slate-500">Đơn hiện tại</span>
                <span className="truncate text-right font-mono">{value(currentOrderId)}</span>
                <span className="text-slate-500">Nhiệm vụ hiện tại</span>
                <span className="truncate text-right font-mono">{value(currentMissionId)}</span>
                <span className="text-slate-500">Điểm đến hiện tại</span>
                <span className="truncate text-right">{translateTargetType(selectedDrone.currentTargetType)}</span>
                <span className="text-slate-500">Quãng đường còn lại</span>
                <span className="truncate text-right font-mono">{formatDistanceMeters(remainingMeters)}</span>
                <span className="text-slate-500">Thời gian dự kiến</span>
                <span className="truncate text-right font-mono">{formatEtaSeconds(etaSeconds)}</span>
            </div>

            {relatedOrder || relatedMission ? (
                <div className="mt-3 space-y-2 rounded border border-slate-100 bg-slate-50 p-2 text-xs font-semibold text-slate-700">
                    {relatedOrder && (
                        <button
                            onClick={() => onSelectOrder(orderIdOf(relatedOrder))}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                        >
                            <span>Đơn liên kết</span>
                            <span className="truncate font-mono text-blue-700">
                                {orderIdOf(relatedOrder)} / {translateOrderStatus(relatedOrder.status)}
                            </span>
                        </button>
                    )}
                    {relatedMission && (
                        <button
                            onClick={() => onSelectMission(missionIdOf(relatedMission))}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
                        >
                            <span>Nhiệm vụ liên kết</span>
                            <span className="truncate font-mono text-blue-700">
                                {missionIdOf(relatedMission)} / {translateMissionStatus(relatedMission.status)}
                            </span>
                        </button>
                    )}
                </div>
            ) : (
                <p className="mt-3 text-sm italic text-slate-400">UAV này chưa nhận nhiệm vụ giao hàng.</p>
            )}
        </section>
    );
}
