'use client';

import type {
    DeliveryOrder,
    DroneTelemetry,
    EventLogEntry,
    LatLng,
    Mission,
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

type MissionProgressPanelProps = {
    order: DeliveryOrder | null;
    mission: Mission | null;
    drone: DroneTelemetry | null;
    plannedPath3d: PlannedPath3DPoint[];
    selectedPathHistory?: LatLng[];
    eventLogs?: EventLogEntry[];
    onSelectDrone?: (droneId: string) => void;
    onSelectOrder?: (orderId: string) => void;
};

type StepState = 'pending' | 'active' | 'done' | 'failed';

const steps = ['Nhận đơn', 'Tới điểm lấy hàng', 'Lấy hàng', 'Giao hàng', 'Hoàn tất'];

function pointOf(item: PlannedPath3DPoint | LatLng): LatLng | null {
    if (Array.isArray(item) && item.length === 2) return item;
    if ('pos' in item && Array.isArray(item.pos) && item.pos.length === 2) return item.pos;
    return null;
}

function distanceMeters(a: LatLng, b: LatLng) {
    const radius = 6371000;
    const toRad = (value: number) => value * Math.PI / 180;
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

function stepStates(order: DeliveryOrder | null, mission: Mission | null): StepState[] {
    const status = order?.status;
    const missionStatus = mission?.status;
    if (status === 'failed' || missionStatus === 'failed') return ['done', 'failed', 'pending', 'pending', 'pending'];
    if (status === 'completed' || missionStatus === 'completed') return ['done', 'done', 'done', 'done', 'done'];
    if (status === 'delivering' || missionStatus === 'to_dropoff') return ['done', 'done', 'done', 'active', 'pending'];
    if (status === 'picked_up' || missionStatus === 'pickup_arrived') return ['done', 'done', 'done', 'active', 'pending'];
    if (status === 'assigned' || status === 'going_to_pickup' || missionStatus === 'planned' || missionStatus === 'to_pickup') {
        return ['done', 'active', 'pending', 'pending', 'pending'];
    }
    return ['pending', 'pending', 'pending', 'pending', 'pending'];
}

function progressLabel(order: DeliveryOrder | null, mission: Mission | null) {
    const status = order?.status;
    const missionStatus = mission?.status;
    if (status === 'failed' || missionStatus === 'failed') return 'Thất bại';
    if (status === 'completed' || missionStatus === 'completed') return 'Hoàn thành';
    if (status === 'delivering' || missionStatus === 'to_dropoff') return 'Đang tới điểm giao hàng';
    if (status === 'picked_up' || missionStatus === 'pickup_arrived') return 'Đã lấy hàng';
    if (status === 'assigned' || status === 'going_to_pickup' || missionStatus === 'planned' || missionStatus === 'to_pickup') {
        return 'Đang tới điểm lấy hàng';
    }
    return 'Chưa gán';
}

function stateClass(state: StepState) {
    if (state === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (state === 'active') return 'border-blue-300 bg-blue-50 text-blue-700';
    if (state === 'failed') return 'border-red-300 bg-red-50 text-red-700';
    return 'border-slate-200 bg-slate-50 text-slate-500';
}

function stateMark(state: StepState) {
    if (state === 'done') return '✓';
    if (state === 'active') return '•';
    if (state === 'failed') return '!';
    return '';
}

function value(value?: string | number | null) {
    if (value === null || value === undefined || value === '') return '--';
    return String(value);
}

export default function MissionProgressPanel({
    order,
    mission,
    drone,
    plannedPath3d,
    onSelectDrone,
    onSelectOrder
}: MissionProgressPanelProps) {
    const orderId = order ? orderIdOf(order) : mission?.orderId ?? mission?.order_id ?? drone?.currentOrderId ?? null;
    const missionId = mission ? missionIdOf(mission) : order?.missionId ?? order?.mission_id ?? drone?.currentMissionId ?? null;
    const droneId = drone?.droneId ?? mission?.droneId ?? mission?.drone_id ?? order?.assignedDroneId ?? order?.assigned_drone_id ?? null;
    const payloadKg = order?.payloadKg ?? order?.payload_kg ?? drone?.payloadKg ?? null;
    const remainingMeters = estimatePathDistanceMeters(plannedPath3d, drone?.currentPathIndex);
    const etaSeconds = remainingMeters !== null && typeof drone?.speed === 'number' && drone.speed > 0
        ? remainingMeters / drone.speed
        : null;
    const states = stepStates(order, mission);

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <h2 className="text-xs font-bold uppercase text-slate-500">Tiến trình nhiệm vụ</h2>
                {(order?.status === 'failed' || mission?.status === 'failed') && (
                    <span className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase text-red-700">
                        Thất bại
                    </span>
                )}
            </div>

            <div className="mt-3 space-y-2">
                {steps.map((label, idx) => (
                    <div key={label} className={`flex items-center gap-2 rounded border px-2 py-2 text-xs font-semibold ${stateClass(states[idx])}`}>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current font-mono text-[11px]">
                            {stateMark(states[idx]) || idx + 1}
                        </span>
                        <span>{label}</span>
                    </div>
                ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-slate-700">
                <span className="text-slate-500">UAV phụ trách</span>
                <button
                    disabled={!droneId || !onSelectDrone}
                    onClick={() => droneId && onSelectDrone?.(droneId)}
                    className="truncate text-right font-mono text-blue-700 disabled:text-slate-700"
                >
                    {value(droneId)}
                </button>
                <span className="text-slate-500">Đơn hàng</span>
                <button
                    disabled={!orderId || !onSelectOrder}
                    onClick={() => orderId && onSelectOrder?.(orderId)}
                    className="truncate text-right font-mono text-blue-700 disabled:text-slate-700"
                >
                    {value(orderId)}
                </button>
                <span className="text-slate-500">Nhiệm vụ</span>
                <span className="truncate text-right font-mono">{value(missionId)}</span>
                <span className="text-slate-500">Tải trọng</span>
                <span className="truncate text-right font-mono">{formatPayloadKg(payloadKg)}</span>
                <span className="text-slate-500">Điểm đến hiện tại</span>
                <span className="truncate text-right">{translateTargetType(drone?.currentTargetType)}</span>
                <span className="text-slate-500">Tiến độ</span>
                <span className="truncate text-right">{progressLabel(order, mission)}</span>
                <span className="text-slate-500">Trạng thái đơn</span>
                <span className="truncate text-right">{translateOrderStatus(order?.status)}</span>
                <span className="text-slate-500">Trạng thái nhiệm vụ</span>
                <span className="truncate text-right">{translateMissionStatus(mission?.status)}</span>
                <span className="text-slate-500">Trạng thái UAV</span>
                <span className="truncate text-right">{translateDroneStatus(drone?.status)}</span>
                <span className="text-slate-500">Quãng đường còn lại</span>
                <span className="truncate text-right font-mono">{formatDistanceMeters(remainingMeters)}</span>
                <span className="text-slate-500">Thời gian dự kiến</span>
                <span className="truncate text-right font-mono">{formatEtaSeconds(etaSeconds)}</span>
            </div>
        </section>
    );
}
