'use client';

import { translateSimulationStatus, translateWorkerStatus } from '../utils/labels';
import type { DronesById, OrdersById, ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';

type TopStatusBarProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
    drones: DronesById;
    orders: OrdersById;
};

function StatusPill({ label, value, toneValue = value }: { label: string; value: string; toneValue?: string }) {
    const tone = toneValue === 'connected' || toneValue === 'idle' || toneValue === 'running'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : toneValue === 'paused' || toneValue === 'busy'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : toneValue === 'failed' || toneValue === 'error' || toneValue === 'disconnected'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-slate-200 bg-slate-50 text-slate-600';

    return (
        <div className={`flex items-center gap-2 rounded border px-2 py-1 ${tone}`}>
            <span className="text-[10px] font-bold uppercase tracking-normal opacity-70">{label}</span>
            <span className="font-mono text-xs font-bold">{value}</span>
        </div>
    );
}

export default function TopStatusBar({
    serverStatus,
    workerStatus,
    simulationStatus,
    activeSimId,
    frontendId,
    latencyMs,
    drones,
    orders
}: TopStatusBarProps) {
    const orderRows = Object.values(orders);
    const droneRows = Object.values(drones);
    const activeOrders = orderRows.filter(order => !['completed', 'failed', 'canceled'].includes(order.status)).length;
    const completedOrders = orderRows.filter(order => order.status === 'completed').length;
    const busyDrones = droneRows.filter(drone => (
        Boolean(drone.currentOrderId || drone.currentMissionId)
        || (['flying', 'rerouting'].includes(String(drone.status)) && ['pickup', 'dropoff', 'charging_station'].includes(String(drone.currentTargetType)))
    )).length;
    const idleDrones = droneRows.filter(drone => drone.status === 'idle' && !drone.currentOrderId && !drone.currentMissionId).length;
    const chargingDrones = droneRows.filter(drone => drone.status === 'charging').length;
    const failedDrones = droneRows.filter(drone => ['failed', 'emergency_landing'].includes(String(drone.status))).length;

    return (
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
            <div>
                <h1 className="text-base font-bold text-slate-800">Trạm điều phối UAV</h1>
                <p className="text-xs font-medium text-slate-500">Mô phỏng giao hàng UAV thời gian thực</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusPill label="Máy chủ" value={serverStatus === 'connected' ? 'Đã kết nối' : serverStatus} toneValue={serverStatus} />
                <StatusPill label="Worker" value={translateWorkerStatus(workerStatus)} toneValue={workerStatus} />
                <StatusPill label="Mô phỏng" value={translateSimulationStatus(simulationStatus)} toneValue={simulationStatus} />
                <StatusPill label="UAV" value={String(droneRows.length)} />
                <StatusPill label="UAV rảnh" value={String(idleDrones)} toneValue="idle" />
                <StatusPill label="Đang giao" value={String(busyDrones)} toneValue={busyDrones > 0 ? 'running' : 'idle'} />
                <StatusPill label="Sạc/lỗi" value={`${chargingDrones}/${failedDrones}`} toneValue={failedDrones > 0 ? 'failed' : chargingDrones > 0 ? 'busy' : 'idle'} />
                <StatusPill label="Đơn" value={`${orderRows.length}/${activeOrders}/${completedOrders}`} />
                <StatusPill label="Độ trễ" value={latencyMs !== null ? `${latencyMs}ms` : '-'} />
                <StatusPill label="Phiên" value={activeSimId ?? '-'} />
                <StatusPill label="Giao diện" value={frontendId ?? '-'} />
            </div>
        </div>
    );
}
