'use client';

import type { ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';

type ConnectionPanelProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    frontendId: string | null;
    latencyMs: number | null;
};

export default function ConnectionPanel(props: ConnectionPanelProps) {
    const rows = [
        ['Server', props.serverStatus],
        ['Worker', props.workerStatus],
        ['Simulation', props.simulationStatus],
        ['Sim ID', props.activeSimId ?? '-'],
        ['Frontend', props.frontendId ?? '-'],
        ['Latency', props.latencyMs !== null ? `${props.latencyMs}ms` : '-']
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Connection</h2>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <span className="text-slate-500">{label}</span>
                        <span className="truncate text-right">{value}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}
