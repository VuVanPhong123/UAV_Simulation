'use client';

import type { DronesById } from '../types/simulation';
import { translateDroneStatus } from '../utils/labels';

type DroneListPanelProps = {
    drones: DronesById;
    selectedDroneId: string | null;
    onSelect: (droneId: string) => void;
};

export default function DroneListPanel({ drones, selectedDroneId, onSelect }: DroneListPanelProps) {
    const rows = Object.values(drones).sort((a, b) => (a.droneId ?? '').localeCompare(b.droneId ?? ''));

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Đội UAV</h2>
            <div className="mt-2 space-y-2">
                {rows.map(drone => {
                    const droneId = drone.droneId ?? 'drone_1';
                    const selected = droneId === selectedDroneId;
                    const battery = drone.batteryPercent ?? drone.battery;
                    return (
                        <button
                            key={droneId}
                            onClick={() => onSelect(droneId)}
                            className={`w-full rounded border px-2 py-2 text-left transition-colors ${
                                selected
                                    ? 'border-blue-300 bg-blue-50'
                                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-xs font-bold text-slate-800">{droneId}</span>
                                <span className="text-[10px] font-bold uppercase text-slate-500">{translateDroneStatus(drone.status)}</span>
                            </div>
                            <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[11px] font-bold text-slate-600">
                                <span>{typeof battery === 'number' ? `${battery.toFixed(1)}%` : '--'}</span>
                                <span className="text-right">{typeof drone.altitude === 'number' ? `${drone.altitude.toFixed(1)}m` : '--'}</span>
                            </div>
                        </button>
                    );
                })}
                {rows.length === 0 && <p className="text-sm italic text-slate-400">Đang chờ telemetry UAV.</p>}
            </div>
        </section>
    );
}
