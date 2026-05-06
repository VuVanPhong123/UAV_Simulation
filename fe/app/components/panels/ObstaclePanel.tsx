'use client';

import type { ObstacleConfig, ObstacleType } from '../types/simulation';

type ObstaclePanelProps = {
    obstacleConfig: ObstacleConfig;
    onChange: (key: keyof ObstacleConfig, value: number | ObstacleType) => void;
};

const obstacleTypes: ObstacleType[] = ['unknown', 'tree', 'pole', 'bird', 'building_crane'];
const obstacleLabels: Record<ObstacleType, string> = {
    unknown: 'Không rõ',
    tree: 'Cây',
    pole: 'Cột',
    bird: 'Chim',
    building_crane: 'Cẩu công trình'
};

export default function ObstaclePanel({ obstacleConfig, onChange }: ObstaclePanelProps) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Đặt vật cản</h2>
            <p className="mt-2 text-[11px] font-medium text-slate-500">Chọn thông số rồi click trên bản đồ để đặt vật cản.</p>
            <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                    Bán kính: {obstacleConfig.radius}m
                    <input className="mt-1 w-full" type="range" min="2" max="30" value={obstacleConfig.radius} onChange={e => onChange('radius', Number(e.target.value))} />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Chiều cao: {obstacleConfig.height}m
                    <input className="mt-1 w-full" type="range" min="5" max="120" value={obstacleConfig.height} onChange={e => onChange('height', Number(e.target.value))} />
                </label>
                <select
                    value={obstacleConfig.obstacleType}
                    onChange={e => onChange('obstacleType', e.target.value as ObstacleType)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                >
                    {obstacleTypes.map(type => <option key={type} value={type}>{obstacleLabels[type]}</option>)}
                </select>
            </div>
        </section>
    );
}
