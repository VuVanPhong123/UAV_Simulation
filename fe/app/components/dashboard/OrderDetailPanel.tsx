'use client';

import {
    formatLatLng,
    formatTimestamp,
    missionIdOf,
    orderIdOf,
    translateMissionStatus,
    translateOrderStatus,
    translatePriority
} from '../utils/labels';
import type { DeliveryOrder, DroneTelemetry, Mission } from '../types/simulation';

type OrderDetailPanelProps = {
    selectedOrder: DeliveryOrder | null;
    relatedMission: Mission | null;
    relatedDrone: DroneTelemetry | null;
};

function value(value: unknown) {
    if (value === null || value === undefined || value === '') return '--';
    return String(value);
}

export default function OrderDetailPanel({ selectedOrder, relatedMission, relatedDrone }: OrderDetailPanelProps) {
    if (!selectedOrder) {
        return (
            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Chi tiết đơn hàng</h2>
                <p className="mt-3 text-sm italic text-slate-400">Chọn một đơn hàng để xem chi tiết.</p>
            </section>
        );
    }

    const payloadKg = selectedOrder.payloadKg ?? selectedOrder.payload_kg;
    const assignedDroneId = selectedOrder.assignedDroneId ?? selectedOrder.assigned_drone_id;
    const failedReason = selectedOrder.failedReason ?? selectedOrder.failed_reason;
    const completedAt = selectedOrder.completedAt ?? selectedOrder.completed_at;

    const rows = [
        ['Mã đơn', orderIdOf(selectedOrder)],
        ['Trạng thái', translateOrderStatus(selectedOrder.status)],
        ['Điểm lấy hàng', formatLatLng(selectedOrder.pickup)],
        ['Điểm giao hàng', formatLatLng(selectedOrder.dropoff)],
        ['Khối lượng', payloadKg !== undefined ? `${payloadKg} kg` : '--'],
        ['Ưu tiên', translatePriority(selectedOrder.priority)],
        ['UAV được gán', assignedDroneId],
        ['Nhiệm vụ', selectedOrder.missionId ?? selectedOrder.mission_id],
        ['Trạng thái nhiệm vụ', translateMissionStatus(relatedMission?.status)],
        ['UAV liên quan', relatedDrone?.droneId],
        ['Hoàn thành lúc', formatTimestamp(completedAt)],
        ['Lý do lỗi', failedReason]
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Chi tiết đơn hàng</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-slate-700">
                {rows.map(([label, rowValue]) => (
                    <div key={String(label)} className="contents">
                        <span className="text-slate-500">{label}</span>
                        <span className="truncate text-right font-mono">{value(rowValue)}</span>
                    </div>
                ))}
            </div>
            {relatedMission && (
                <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                    Nhiệm vụ {missionIdOf(relatedMission)} đang ở trạng thái {translateMissionStatus(relatedMission.status)}.
                </div>
            )}
        </section>
    );
}
