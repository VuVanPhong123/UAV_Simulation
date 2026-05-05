'use client';

import type { ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';

type TopStatusBarProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
};

function StatusPill({ label, value }: { label: string; value: string }) {
    const tone = value === 'connected' || value === 'idle' || value === 'running'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : value === 'paused' || value === 'busy'
            ? 'border-amber-200 bg-amber-50 text-amber-700'
            : value === 'failed' || value === 'error' || value === 'disconnected'
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
    latencyMs
}: TopStatusBarProps) {
    return (
        <div className="flex min-h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div>
                <h1 className="text-sm font-bold text-slate-800">UAV Ground Control Station</h1>
                <p className="text-xs font-medium text-slate-500">Live simulation broker dashboard</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusPill label="Server" value={serverStatus} />
                <StatusPill label="Worker" value={workerStatus} />
                <StatusPill label="Sim" value={simulationStatus} />
                <StatusPill label="Ping" value={latencyMs !== null ? `${latencyMs}ms` : '-'} />
                <StatusPill label="Sim ID" value={activeSimId ?? '-'} />
                <StatusPill label="FE" value={frontendId ?? '-'} />
            </div>
        </div>
    );
}
