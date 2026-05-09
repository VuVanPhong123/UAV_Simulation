'use client';

import { translateServerStatus, translateSimulationStatus, translateWorkerStatus } from '../utils/labels';
import type { DronesById, OrdersById, ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';

type TopStatusBarProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
    droneCount: number;
    drones: DronesById;
    orders: OrdersById;
};

function StatusPill({ label, value, toneValue = value, testId }: { label: string; value: string; toneValue?: string; testId?: string }) {
    const tone = toneValue === 'connected' || toneValue === 'idle' || toneValue === 'running'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : toneValue === 'paused' || toneValue === 'busy'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : toneValue === 'failed' || toneValue === 'error' || toneValue === 'disconnected'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-slate-200 bg-slate-50 text-slate-600';

    return (
        <div data-testid={testId} className={`flex items-center gap-2 rounded border px-2 py-1 ${tone}`}>
            <span className="text-[10px] font-bold uppercase tracking-normal opacity-70">{label}</span>
            <span className="font-mono text-xs font-bold">{value}</span>
        </div>
    );
}

export default function TopStatusBar({
    serverStatus,
    workerStatus,
    simulationStatus,
    droneCount,
    drones,
    orders
}: TopStatusBarProps) {
    const orderRows = Object.values(orders);
    const droneRows = Object.values(drones);
    const totalDrones = droneRows.length || droneCount;
    const completedOrders = orderRows.filter(order => order.status === 'completed').length;
    const failedOrders = orderRows.filter(order => order.status === 'failed').length;
    const transportingOrders = orderRows.filter(order => ['going_to_pickup', 'picked_up', 'delivering'].includes(order.status)).length;
    const idleDrones = droneRows.length
        ? droneRows.filter(drone => drone.status === 'idle' && !drone.currentOrderId && !drone.currentMissionId).length
        : totalDrones;

    return (
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4">
            <div>
                <h1 data-testid="dashboard-title" className="text-base font-bold text-slate-800">Trạm điều phối UAV</h1>
                <p className="text-xs font-medium text-slate-500">Mô phỏng giao hàng UAV thời gian thực</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusPill label="Máy chủ" value={translateServerStatus(serverStatus)} toneValue={serverStatus} />
                <StatusPill label="Bộ xử lý" value={translateWorkerStatus(workerStatus)} toneValue={workerStatus} />
                <StatusPill label="Mô phỏng" value={translateSimulationStatus(simulationStatus)} toneValue={simulationStatus} testId="simulation-status" />
                <StatusPill label="Tổng UAV" value={String(totalDrones)} />
                <StatusPill label="UAV rảnh" value={String(idleDrones)} toneValue="idle" />
                <StatusPill label="Đang giao" value={String(transportingOrders)} toneValue={transportingOrders > 0 ? 'running' : 'idle'} />
                <StatusPill label="Hoàn thành" value={String(completedOrders)} />
                <StatusPill label="Thất bại" value={String(failedOrders)} toneValue={failedOrders > 0 ? 'failed' : 'idle'} />
            </div>
        </div>
    );
}
