'use client';

import type { ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';
import { translateServerStatus, translateSimulationStatus, translateWorkerStatus } from '../utils/labels';

type ConnectionPanelProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId?: string | null;
    frontendId?: string | null;
    latencyMs?: number | null;
    isAwaitingConfig?: boolean;
    isAwaitingFirstTelemetry?: boolean;
};

export default function ConnectionPanel(props: ConnectionPanelProps) {
    const rows = [
        ['Máy chủ', translateServerStatus(props.serverStatus)],
        ['Bộ xử lý', translateWorkerStatus(props.workerStatus)],
        ['Mô phỏng', translateSimulationStatus(props.simulationStatus)]
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Kết nối</h2>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <span className="text-slate-500">{label}</span>
                        <span className="truncate text-right">{value}</span>
                    </div>
                ))}
            </div>
            <div className="mt-3 space-y-2">
                {(props.workerStatus === 'disconnected' || props.workerStatus === 'unknown') && (
                    <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Chưa có worker kết nối.</p>
                )}
                {props.workerStatus === 'busy' && (
                    <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Worker đang bận, vui lòng dừng mô phỏng khác hoặc chờ worker rảnh.</p>
                )}
                {props.isAwaitingConfig && (
                    <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Đang tải cấu hình bản đồ/mô phỏng...</p>
                )}
                {props.isAwaitingFirstTelemetry && (
                    <p className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">Đang chờ telemetry đầu tiên...</p>
                )}
            </div>
        </section>
    );
}
