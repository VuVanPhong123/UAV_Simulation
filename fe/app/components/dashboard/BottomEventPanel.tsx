'use client';

import { useState } from 'react';
import EventLogPanel from '../panels/EventLogPanel';
import type { EventLogEntry } from '../types/simulation';

type BottomEventPanelProps = {
    events: EventLogEntry[];
};

export default function BottomEventPanel({ events }: BottomEventPanelProps) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <section className="border-t border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
                <div>
                    <h2 className="text-xs font-bold uppercase text-slate-600">Nhật ký sự kiện</h2>
                    <p className="text-[11px] font-medium text-slate-400">{events.length} sự kiện đã ghi nhận</p>
                </div>
                <button
                    onClick={() => setCollapsed(prev => !prev)}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                    {collapsed ? 'Mở rộng' : 'Thu gọn'}
                </button>
            </div>
            {!collapsed && (
                <div className="h-48 overflow-y-auto p-2">
                    <EventLogPanel events={events} limit={12} />
                </div>
            )}
        </section>
    );
}
