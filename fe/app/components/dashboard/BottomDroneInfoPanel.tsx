'use client';

import type {
    DeliveryOrder,
    DroneTelemetry,
    LatLng,
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
    translateTargetType
} from '../utils/labels';

type BottomDroneInfoPanelProps = {
    selectedDrone: DroneTelemetry | null;
    selectedDroneId: string | null;
    orders: OrdersById;
    missions: MissionsById;
    plannedPath3d: PlannedPath3DPoint[];
    selectedOrderId?: string | null;
    selectedMissionId?: string | null;
};

function value(input?: string | number | null) {
    if (input === null || input === undefined || input === '') return '--';
    return String(input);
}

function pointOf(item: PlannedPath3DPoint | LatLng): LatLng | null {
    if (Array.isArray(item) && item.length === 2) return item;
    if ('pos' in item && Array.isArray(item.pos) && item.pos.length === 2) return item.pos;
    return null;
}

function distanceMeters(a: LatLng, b: LatLng) {
    const radius = 6371000;
    const toRad = (input: number) => input * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]);
    const dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]);
    const lat2 = toRad(b[0]);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimatePathDistanceMeters(path: PlannedPath3DPoint[], startIndex?: number) {
    if (path.length < 2) return null;
    const safeStart = typeof startIndex === 'number' && startIndex >= 0 && startIndex < path.length - 1 ? startIndex : 0;
    let total = 0;
    for (let idx = safeStart; idx < path.length - 1; idx += 1) {
        const current = pointOf(path[idx]);
        const next = pointOf(path[idx + 1]);
        if (!current || !next) return null;
        total += distanceMeters(current, next);
    }
    return total;
}

function targetLabel(drone: DroneTelemetry, order: DeliveryOrder | null, mission: Mission | null) {
    if (drone.currentTargetType) return translateTargetType(drone.currentTargetType);
    if (order?.status === 'going_to_pickup' || mission?.status === 'to_pickup') return 'Điểm lấy hàng';
    if (['picked_up', 'delivering'].includes(order?.status ?? '') || mission?.status === 'to_dropoff') return 'Điểm giao hàng';
    return '--';
}

function InfoTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="truncate text-[10px] font-bold uppercase text-slate-500">{label}</p>
            <p className="mt-1 truncate text-xs font-bold text-slate-800">{value}</p>
        </div>
    );
}

export default function BottomDroneInfoPanel({
    selectedDrone,
    selectedDroneId,
    orders,
    missions,
    plannedPath3d,
    selectedOrderId,
    selectedMissionId
}: BottomDroneInfoPanelProps) {
    if (!selectedDrone) {
        return (
            <section className="h-32 border-t border-slate-200 bg-white px-3 py-2">
                <h2 className="text-xs font-bold uppercase text-slate-500">Thông số UAV</h2>
                <div className="mt-4 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm font-semibold text-slate-500">
                    Chọn một UAV trên bản đồ để xem thông số vận hành.
                </div>
            </section>
        );
    }

    const droneId = selectedDrone.droneId ?? selectedDroneId ?? '--';
    const currentOrderId = selectedDrone.currentOrderId ?? selectedOrderId ?? null;
    const currentMissionId = selectedDrone.currentMissionId ?? selectedMissionId ?? null;
    const relatedOrder = currentOrderId ? orders[currentOrderId] ?? null : null;
    const relatedMission = currentMissionId ? missions[currentMissionId] ?? null : null;
    const displayOrderId = relatedOrder ? orderIdOf(relatedOrder) : currentOrderId;
    const displayMissionId = relatedMission ? missionIdOf(relatedMission) : currentMissionId;
    const battery = selectedDrone.batteryPercent ?? selectedDrone.battery;
    const payloadKg = selectedDrone.payloadKg ?? relatedOrder?.payloadKg ?? relatedOrder?.payload_kg ?? null;
    const remainingMeters = estimatePathDistanceMeters(plannedPath3d, selectedDrone.currentPathIndex);
    const etaSeconds = remainingMeters !== null && typeof selectedDrone.speed === 'number' && selectedDrone.speed > 0
        ? remainingMeters / selectedDrone.speed
        : null;

    return (
        <section className="h-40 overflow-hidden border-t border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-xs font-bold uppercase text-slate-500">Thông số UAV</h2>
                    <p className="mt-0.5 truncate text-xs text-slate-500">Dữ liệu vận hành của UAV đang chọn trên bản đồ.</p>
                </div>
                <span className="shrink-0 rounded border border-blue-200 bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">
                    {droneId}
                </span>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-4 xl:grid-cols-6">
                <InfoTile label="Mã UAV" value={droneId} />
                <InfoTile label="Trạng thái UAV" value={translateDroneStatus(selectedDrone.status)} />
                <InfoTile label="Pin" value={typeof battery === 'number' ? `${battery.toFixed(1)}%` : '--'} />
                <InfoTile label="Tốc độ" value={typeof selectedDrone.speed === 'number' ? `${selectedDrone.speed.toFixed(1)} m/s` : '--'} />
                <InfoTile label="Độ cao" value={typeof selectedDrone.altitude === 'number' ? `${selectedDrone.altitude.toFixed(1)} m` : '--'} />
                <InfoTile label="Đơn hàng đang xử lý" value={value(displayOrderId)} />
                <InfoTile label="Nhiệm vụ hiện tại" value={value(displayMissionId)} />
                <InfoTile label="Điểm đến hiện tại" value={targetLabel(selectedDrone, relatedOrder, relatedMission)} />
                <InfoTile label="Tải trọng hiện tại" value={formatPayloadKg(payloadKg)} />
                <InfoTile label="Quãng đường còn lại" value={formatDistanceMeters(remainingMeters)} />
                <InfoTile label="Thời gian dự kiến" value={formatEtaSeconds(etaSeconds)} />
            </div>
        </section>
    );
}
