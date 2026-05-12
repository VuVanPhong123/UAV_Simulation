'use client';

import Sparkline from '../charts/Sparkline';
import type { DroneTelemetry, PlannedPath3DPoint } from '../types/simulation';

type AltitudePanelProps = {
    droneState: DroneTelemetry | null;
    plannedPath3d: PlannedPath3DPoint[];
    altitudeHistory: number[];
};

function summarize(points: PlannedPath3DPoint[]) {
    const altitudes = points.map(point => Number(point.altitude)).filter(Number.isFinite);
    if (altitudes.length === 0) return null;
    let changes = 0;
    for (let idx = 1; idx < altitudes.length; idx += 1) {
        if (Math.abs(altitudes[idx] - altitudes[idx - 1]) > 0.1) changes += 1;
    }
    return {
        min: Math.min(...altitudes),
        max: Math.max(...altitudes),
        changes,
        points: altitudes.length,
        altitudes
    };
}

export default function AltitudePanel({ droneState, plannedPath3d, altitudeHistory }: AltitudePanelProps) {
    const summary = summarize(plannedPath3d);
    const rows = [
        ['Hiện tại', typeof droneState?.altitude === 'number' ? `${droneState.altitude.toFixed(1)}m` : '--'],
        ['Mục tiêu', typeof droneState?.targetAltitude === 'number' ? `${droneState.targetAltitude.toFixed(1)}m` : '--'],
        ['Thấp nhất', summary ? `${summary.min.toFixed(1)}m` : '--'],
        ['Cao nhất', summary ? `${summary.max.toFixed(1)}m` : '--'],
        ['Lần đổi cao', summary ? String(summary.changes) : '--'],
        ['Điểm', summary ? String(summary.points) : '--']
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Độ cao</h2>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-right">{value}</span>
                    </div>
                ))}
            </div>
            <div className="mt-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Độ cao dự kiến</p>
                <Sparkline values={summary?.altitudes ?? []} stroke="#0e7490" />
            </div>
            <div className="mt-2">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Độ cao thực tế</p>
                <Sparkline values={altitudeHistory} stroke="#7c3aed" />
            </div>
        </section>
    );
}
