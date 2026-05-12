'use client';

import {
    orderIdOf,
    translateMissionStatus,
    translateOrderStatus
} from '../utils/labels';
import type {
    DeliveryOrder,
    MissionsById,
    OrdersById
} from '../types/simulation';

type OrderManagementPanelProps = {
    orders: OrdersById;
    missions: MissionsById;
    draftOrderCount: number;
    selectedOrderId: string | null;
    onSelectOrder: (orderId: string) => void;
    onOpenOrderModal: () => void;
};

function SummaryCard({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-800">{value}</p>
        </div>
    );
}

function systemMissionStatus(order: DeliveryOrder, missions: MissionsById) {
    const missionId = order.missionId ?? order.mission_id;
    return missionId ? translateMissionStatus(missions[missionId]?.status) : '--';
}

export default function OrderManagementPanel({
    orders,
    missions,
    draftOrderCount,
    selectedOrderId,
    onSelectOrder,
    onOpenOrderModal
}: OrderManagementPanelProps) {
    const systemOrders = Object.values(orders);
    const transportingOrders = systemOrders.filter(order => ['going_to_pickup', 'picked_up', 'delivering'].includes(order.status)).length;
    const completedOrders = systemOrders.filter(order => order.status === 'completed').length;
    const failedOrders = systemOrders.filter(order => order.status === 'failed').length;

    return (
        <div className="space-y-3">
            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Quản lý đơn hàng</h2>
                <button
                    onClick={onOpenOrderModal}
                    className="mt-3 w-full cursor-pointer rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                    Mở quản lý đơn hàng
                </button>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <SummaryCard label="Tổng đơn" value={systemOrders.length} />
                    <SummaryCard label="Đơn nháp" value={draftOrderCount} />
                    <SummaryCard label="Đang vận chuyển" value={transportingOrders} />
                    <SummaryCard label="Hoàn thành" value={completedOrders} />
                    <SummaryCard label="Thất bại" value={failedOrders} />
                </div>
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Đơn hàng trong hệ thống</h2>
                <div className="mt-2 space-y-2">
                    {systemOrders.map(order => {
                        const orderId = orderIdOf(order);
                        const selected = selectedOrderId === orderId;
                        return (
                            <button
                                key={orderId}
                                onClick={() => onSelectOrder(orderId)}
                                className={`w-full cursor-pointer rounded border p-2 text-left text-xs transition-colors ${
                                    selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-mono font-bold text-slate-800">{orderId}</span>
                                    <span className="shrink-0 font-bold text-slate-600">{translateOrderStatus(order.status)}</span>
                                </div>
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                                    <span>Tải trọng</span>
                                    <span className="text-right font-mono">{order.payloadKg ?? order.payload_kg ?? '--'}kg</span>
                                    <span>UAV</span>
                                    <span className="truncate text-right font-mono">{order.assignedDroneId ?? order.assigned_drone_id ?? '--'}</span>
                                    <span>Trạng thái nhiệm vụ</span>
                                    <span className="truncate text-right">{systemMissionStatus(order, missions)}</span>
                                </div>
                            </button>
                        );
                    })}
                    {systemOrders.length === 0 && <p className="text-sm italic text-slate-400">Chưa có đơn hàng trong hệ thống.</p>}
                </div>
            </section>
        </div>
    );
}
