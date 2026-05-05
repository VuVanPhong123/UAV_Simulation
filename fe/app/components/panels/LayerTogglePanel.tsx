'use client';

import type { LayerToggles } from '../types/simulation';

type LayerTogglePanelProps = {
    layers: LayerToggles;
    onToggle: (key: keyof LayerToggles) => void;
};

const labels: Array<[keyof LayerToggles, string]> = [
    ['buildings', 'Buildings'],
    ['buildingLabels', 'Height labels'],
    ['noFlyZones', 'No-fly zones'],
    ['chargingStations', 'Charging stations'],
    ['plannedPath', 'Planned path'],
    ['pathHistory', 'Path history'],
    ['dynamicObstacles', 'Dynamic obstacles'],
    ['windShadow', 'Wind shadow'],
    ['sensorRange', 'Sensor range'],
    ['weatherOverlay', 'Wind overlay']
];

export default function LayerTogglePanel({ layers, onToggle }: LayerTogglePanelProps) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Map Layers</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
                {labels.map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded border border-slate-100 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={layers[key]} onChange={() => onToggle(key)} />
                        {label}
                    </label>
                ))}
            </div>
        </section>
    );
}
