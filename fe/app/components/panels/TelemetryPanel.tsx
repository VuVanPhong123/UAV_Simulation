'use client';

import Sparkline from '../charts/Sparkline';
import type { DroneTelemetry } from '../types/simulation';
import { translateDroneStatus } from '../utils/labels';

type TelemetryPanelProps = {
    droneState: DroneTelemetry | null;
    batteryHistory: number[];
    temperatureHistory: number[];
    altitudeHistory: number[];
};

function value(value: unknown, suffix = '') {
    if (typeof value === 'number') return `${value.toFixed(1)}${suffix}`;
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'Bật' : 'Tắt';
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
        ['UAV', droneState?.droneId ?? 'drone_1'],
        ['Trạng thái', translateDroneStatus(droneState?.status)],
        ['Chế độ', droneState?.mode],
        ['Pin', typeof battery === 'number' ? `${battery.toFixed(1)}%` : undefined],
        ['Độ cao', typeof droneState?.altitude === 'number' ? `${droneState.altitude.toFixed(1)}m` : undefined],
        ['Độ cao mục tiêu', typeof droneState?.targetAltitude === 'number' ? `${droneState.targetAltitude.toFixed(1)}m` : undefined],
        ['Tốc độ', typeof droneState?.speed === 'number' ? `${droneState.speed.toFixed(1)}m/s` : undefined],
        ['Hướng bay', typeof droneState?.heading === 'number' ? `${droneState.heading.toFixed(1)} độ` : undefined],
        ['Nhiệt độ', typeof droneState?.temperature === 'number' ? `${droneState.temperature.toFixed(1)}C` : undefined],
        ['Năng lượng', typeof droneState?.energyConsumed === 'number' ? droneState.energyConsumed.toFixed(1) : undefined],
        ['Gió', droneState?.windSpeed !== undefined ? `${value(droneState.windSpeed, 'm/s')} tới ${value(droneState.windDir, ' độ')}` : undefined],
        ['Mưa', droneState?.isRaining],
        ['Nhiệm vụ', droneState?.currentMissionId],
        ['Đơn hàng', droneState?.currentOrderId],
        ['Tải trọng', typeof droneState?.payloadKg === 'number' ? `${droneState.payloadKg.toFixed(1)}kg` : undefined],
        ['Đường bay', droneState?.currentPathIndex !== undefined && droneState?.pathLength !== undefined ? `${droneState.currentPathIndex}/${droneState.pathLength}` : undefined],
        ['Bước', droneState?.step]
    ];

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Thông số UAV</h2>
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
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Pin</p>
                    <Sparkline values={batteryHistory} stroke="#2563eb" />
                </div>
                <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Nhiệt độ</p>
                    <Sparkline values={temperatureHistory} stroke="#dc2626" />
                </div>
                <div>
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Độ cao</p>
                    <Sparkline values={altitudeHistory} stroke="#0891b2" />
                </div>
            </div>
        </section>
    );
}
