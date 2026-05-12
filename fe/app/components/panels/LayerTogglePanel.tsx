'use client';

import type { LayerToggles } from '../types/simulation';

type LayerTogglePanelProps = {
    layers: LayerToggles;
    onToggle: (key: keyof LayerToggles) => void;
};

const labels: Array<[keyof LayerToggles, string]> = [
    ['buildings', 'Tòa nhà'],
    ['buildingLabels', 'Nhãn độ cao'],
    ['noFlyZones', 'Vùng cấm bay'],
    ['chargingStations', 'Trạm sạc'],
    ['plannedPath', 'Tuyến bay'],
    ['dynamicObstacles', 'Vật cản'],
    ['windShadow', 'Vùng cản gió'],
    ['sensorRange', 'Vùng cảm biến'],
    ['weatherOverlay', 'Hiệu ứng thời tiết']
];

export default function LayerTogglePanel({ layers, onToggle }: LayerTogglePanelProps) {
    return (
        <section data-testid="layer-toggle-panel" className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Lớp bản đồ</h2>
            <div className="mt-3 space-y-2">
                {labels.map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                        <span>{label}</span>
                        <input type="checkbox" checked={layers[key]} onChange={() => onToggle(key)} />
                    </label>
                ))}
            </div>
        </section>
    );
}
