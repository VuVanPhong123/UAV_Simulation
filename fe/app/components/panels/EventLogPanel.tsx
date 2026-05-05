'use client';

import type { EventLogEntry } from '../types/simulation';

type EventLogPanelProps = {
    events: EventLogEntry[];
};

function levelClass(level: string) {
    if (level === 'error') return 'text-red-600';
    if (level === 'warning') return 'text-amber-600';
    if (level === 'success') return 'text-emerald-600';
    return 'text-blue-600';
}

export default function EventLogPanel({ events }: EventLogPanelProps) {
    return (
        <section className="min-h-0 rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Event Log</h2>
            <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                {events.slice(0, 20).map((log, idx) => (
                    <div key={`${log.timestamp ?? 'event'}-${idx}`} className="rounded border border-slate-100 bg-slate-50 p-2 text-xs leading-snug">
                        <div className="flex items-center justify-between gap-2">
                            <span className={`font-bold uppercase ${levelClass(log.level)}`}>{log.level}</span>
                            <span className="truncate font-mono text-[10px] font-bold text-slate-500">{log.droneId ? `${log.droneId} / ` : ''}{log.code}</span>
                        </div>
                        <p className="mt-1 text-slate-700">{log.message}</p>
                    </div>
                ))}
                {events.length === 0 && <p className="italic text-slate-400 text-sm">No events yet.</p>}
            </div>
        </section>
    );
}
