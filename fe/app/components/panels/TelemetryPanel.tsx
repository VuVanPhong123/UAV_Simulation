'use client';

import Sparkline from '../charts/Sparkline';
import type { DroneTelemetry } from '../types/simulation';

type TelemetryPanelProps = {
    droneState: DroneTelemetry | null;
    batteryHistory: number[];
    temperatureHistory: number[];
    altitudeHistory: number[];
};

function value(value: unknown, suffix = '') {
    if (typeof value === 'number') return `${value.toFixed(1)}${suffix}`;
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    return '--';
}

export default function TelemetryPanel({
    droneState,
    batteryHistory,
    temperatureHistory,
    altitudeHistory
}: TelemetryPanelProps) {
    const battery = droneState?.batteryPercent ?? droneState?.battery;
    const rows = [
        ['Drone', 'drone_1'],
        ['Status', droneState?.status],
        ['Mode', droneState?.mode],
        ['Battery', typeof battery === 'number' ? `${battery.toFixed(1)}%` : undefined],
        ['Altitude', typeof droneState?.altitude === 'number' ? `${droneState.altitude.toFixed(1)}m` : undefined],
        ['Target alt', typeof droneState?.targetAltitude === 'number' ? `${droneState.targetAltitude.toFixed(1)}m` : undefined],
        ['Speed', typeof droneState?.speed === 'number' ? `${droneState.speed.toFixed(1)}m/s` : undefined],
        ['Heading', typeof droneState?.heading === 'number' ? `${droneState.heading.toFixed(1)} deg` : undefined],
        ['Temperature', typeof droneState?.temperature === 'number' ? `${droneState.temperature.toFixed(1)}C` : undefined],
        ['Energy', typeof droneState?.energyConsumed === 'number' ? droneState.energyConsumed.toFixed(1) : undefined],
        ['Wind', droneState?.windSpeed !== undefined ? `${value(droneState.windSpeed, 'm/s')} to ${value(droneState.windDir, 'deg')}` : undefined],
        ['Rain', droneState?.isRaining],
        ['Path', droneState?.currentPathIndex !== undefined && droneState?.pathLength !== undefined ? `${droneState.currentPathIndex}/${droneState.pathLength}` : undefined],
        ['Step', droneState?.step]
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Telemetry</h2>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs font-bold text-slate-700">
                {rows.map(([label, rowValue]) => (
                    <div key={String(label)} className="contents">
                        <span className="text-slate-500">{label}</span>
                        <span className="truncate text-right">{value(rowValue)}</span>
                    </div>
                ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Battery</p>
                    <Sparkline values={batteryHistory} stroke="#2563eb" />
                </div>
                <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Temp</p>
                    <Sparkline values={temperatureHistory} stroke="#dc2626" />
                </div>
                <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Altitude</p>
                    <Sparkline values={altitudeHistory} stroke="#0891b2" />
                </div>
            </div>
        </section>
    );
}
