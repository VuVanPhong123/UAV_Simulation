'use client';

import { useState } from 'react';
import EventLogPanel from '../panels/EventLogPanel';
import type { EventFilter, EventLogEntry } from '../types/simulation';
import { translateEventFilter } from '../utils/labels';
import EventFilterBar from './EventFilterBar';

type BottomEventPanelProps = {
    events: EventLogEntry[];
    selectedDroneId: string | null;
    selectedOrderId: string | null;
    selectedMissionId: string | null;
    eventFilter: EventFilter;
    onEventFilterChange: (value: EventFilter) => void;
};

function includesId(log: EventLogEntry, id: string | null) {
    if (!id) return false;
    return [log.orderId, log.missionId, log.droneId, log.code, log.message]
        .filter(Boolean)
        .some(value => String(value).includes(id));
}

function filterEvents(
    events: EventLogEntry[],
    eventFilter: EventFilter,
    selectedDroneId: string | null,
    selectedOrderId: string | null,
    selectedMissionId: string | null
) {
    if (eventFilter === 'selected_drone') {
        return events.filter(log => selectedDroneId && log.droneId === selectedDroneId);
    }
    if (eventFilter === 'selected_order') {
        return events.filter(log => includesId(log, selectedOrderId));
    }
    if (eventFilter === 'selected_mission') {
        return events.filter(log => includesId(log, selectedMissionId));
    }
    return events;
}

export default function BottomEventPanel({
    events,
    selectedDroneId,
    selectedOrderId,
    selectedMissionId,
    eventFilter,
    onEventFilterChange
}: BottomEventPanelProps) {
    const [collapsed, setCollapsed] = useState(false);
    const filteredEvents = filterEvents(events, eventFilter, selectedDroneId, selectedOrderId, selectedMissionId);

    return (
        <section className="border-t border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
                <div>
                    <h2 className="text-xs font-bold uppercase text-slate-600">Nhật ký sự kiện</h2>
                    <p className="text-[11px] font-medium text-slate-400">
                        {filteredEvents.length}/{events.length} sự kiện · {translateEventFilter(eventFilter)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <EventFilterBar
                        value={eventFilter}
                        selectedDroneId={selectedDroneId}
                        selectedOrderId={selectedOrderId}
                        selectedMissionId={selectedMissionId}
                        onChange={onEventFilterChange}
                    />
                    <button
                        onClick={() => setCollapsed(prev => !prev)}
                        className="cursor-pointer rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                        {collapsed ? 'Mở rộng' : 'Thu gọn'}
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="h-48 overflow-y-auto p-2">
                    {filteredEvents.length > 0 ? (
                        <EventLogPanel events={filteredEvents} limit={12} />
                    ) : (
                        <section className="rounded border border-slate-200 bg-white p-3">
                            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Nhật ký sự kiện</h2>
                            <p className="mt-3 text-sm italic text-slate-400">Không có sự kiện phù hợp với bộ lọc hiện tại.</p>
                        </section>
                    )}
                </div>
            )}
        </section>
    );
}
