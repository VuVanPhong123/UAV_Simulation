'use client';

import type { AsyncRequestStatus, WeatherState } from '../types/simulation';
import { ActionStatusMessage, MiniSpinner } from '../ui/ActionStatus';

type WeatherPanelProps = {
    weather: WeatherState;
    onChange: (key: keyof WeatherState, value: number | boolean) => void;
    onApply: () => void;
    disabled: boolean;
    status?: AsyncRequestStatus;
    statusMessage?: string | null;
};

export default function WeatherPanel({
    weather,
    onChange,
    onApply,
    disabled,
    status = 'idle',
    statusMessage
}: WeatherPanelProps) {
    const applyDisabled = disabled || status === 'loading';

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Môi trường</h2>
            <div className="mt-3 space-y-3">
                <label className="block cursor-pointer text-xs font-semibold text-slate-600">
                    Hướng gió: {weather.wind_dir} độ
                    <input className="mt-1 w-full cursor-pointer" type="range" min="0" max="360" value={weather.wind_dir} onChange={e => onChange('wind_dir', Number(e.target.value))} />
                </label>
                <label className="block cursor-pointer text-xs font-semibold text-slate-600">
                    Tốc độ gió: {weather.wind_speed} m/s
                    <input className="mt-1 w-full cursor-pointer" type="range" min="0" max="25" value={weather.wind_speed} onChange={e => onChange('wind_speed', Number(e.target.value))} />
                </label>
                <label className="block cursor-pointer text-xs font-semibold text-slate-600">
                    Nhiệt độ: {weather.ambient_temp} C
                    <input className="mt-1 w-full cursor-pointer" type="range" min="-10" max="50" value={weather.ambient_temp} onChange={e => onChange('ambient_temp', Number(e.target.value))} />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                    <input className="cursor-pointer" type="checkbox" checked={weather.is_raining} onChange={e => onChange('is_raining', e.target.checked)} />
                    Mưa
                </label>
                <button disabled={applyDisabled} onClick={onApply} className="w-full cursor-pointer rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">
                    <span className="inline-flex items-center justify-center gap-2">
                        {status === 'loading' && <MiniSpinner />}
                        {status === 'loading' ? 'Đang áp dụng...' : 'Áp dụng thời tiết'}
                    </span>
                </button>
                {disabled && status !== 'loading' && (
                    <ActionStatusMessage tone="warning">Cần bắt đầu mô phỏng trước khi áp dụng môi trường.</ActionStatusMessage>
                )}
                {status !== 'idle' && statusMessage && (
                    <ActionStatusMessage tone={status}>{statusMessage}</ActionStatusMessage>
                )}
            </div>
        </section>
    );
}
