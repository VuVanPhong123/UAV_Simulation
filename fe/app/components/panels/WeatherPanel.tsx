'use client';

import type { WeatherState } from '../types/simulation';

type WeatherPanelProps = {
    weather: WeatherState;
    onChange: (key: keyof WeatherState, value: number | boolean) => void;
    onApply: () => void;
    disabled: boolean;
};

export default function WeatherPanel({ weather, onChange, onApply, disabled }: WeatherPanelProps) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Môi trường</h2>
            <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                    Hướng gió: {weather.wind_dir} độ
                    <input className="mt-1 w-full" type="range" min="0" max="360" value={weather.wind_dir} onChange={e => onChange('wind_dir', Number(e.target.value))} />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Tốc độ gió: {weather.wind_speed} m/s
                    <input className="mt-1 w-full" type="range" min="0" max="25" value={weather.wind_speed} onChange={e => onChange('wind_speed', Number(e.target.value))} />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Nhiệt độ: {weather.ambient_temp} C
                    <input className="mt-1 w-full" type="range" min="-10" max="50" value={weather.ambient_temp} onChange={e => onChange('ambient_temp', Number(e.target.value))} />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={weather.is_raining} onChange={e => onChange('is_raining', e.target.checked)} />
                    Mưa
                </label>
                <button disabled={disabled} onClick={onApply} className="w-full rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500">
                    Áp dụng thời tiết
                </button>
            </div>
        </section>
    );
}
