'use client';

import type { EventFilter } from '../types/simulation';
import { translateEventFilter } from '../utils/labels';

type EventFilterBarProps = {
    value: EventFilter;
    selectedDroneId: string | null;
    selectedOrderId: string | null;
    selectedMissionId: string | null;
    onChange: (value: EventFilter) => void;
};

const filters: EventFilter[] = ['all', 'selected_drone', 'selected_order', 'selected_mission'];

export default function EventFilterBar({
    value,
    selectedDroneId,
    selectedOrderId,
    selectedMissionId,
    onChange
}: EventFilterBarProps) {
    const disabledByFilter: Record<EventFilter, boolean> = {
        all: false,
        selected_drone: !selectedDroneId,
        selected_order: !selectedOrderId,
        selected_mission: !selectedMissionId
    };

    return (
        <div className="flex flex-wrap gap-2">
            {filters.map(filter => (
                <button
                    key={filter}
                    disabled={disabledByFilter[filter]}
                    onClick={() => onChange(filter)}
                    className={`cursor-pointer rounded border px-2 py-1 text-[11px] font-bold transition-colors ${
                        value === filter
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    } disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
                >
                    {translateEventFilter(filter)}
                </button>
            ))}
        </div>
    );
}
