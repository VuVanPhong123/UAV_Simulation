'use client';

import type { DynamicNoFlyZone, MapInteractionMode } from '../types/simulation';

export type NoFlyZoneConfig = {
    radius: number;
    height: number;
};

type NoFlyZonePanelProps = {
    config: NoFlyZoneConfig;
    zones: DynamicNoFlyZone[];
    mapInteractionMode: MapInteractionMode;
    onChange: (key: keyof NoFlyZoneConfig, value: number) => void;
    onStartPlacement: () => void;
    onCancelPlacement: () => void;
};

export default function NoFlyZonePanel({
    config,
    zones,
    mapInteractionMode,
    onChange,
    onStartPlacement,
    onCancelPlacement
}: NoFlyZonePanelProps) {
    const isPlacing = mapInteractionMode === 'no_fly_zone';
    const recentZones = zones.slice(-5).reverse();

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Vùng cấm bay</h2>
            <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                    Bán kính mét
                    <input
                        type="number"
                        min="5"
                        max="500"
                        step="5"
                        value={config.radius}
                        onChange={e => onChange('radius', Number(e.target.value))}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                    />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Chiều cao ảnh hưởng mét
                    <input
                        type="number"
                        min="5"
                        max="500"
                        step="5"
                        value={config.height}
                        onChange={e => onChange('height', Number(e.target.value))}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                    />
                </label>
                {isPlacing ? (
                    <div className="space-y-2">
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                            Đang chọn tâm vùng cấm bay...
                        </div>
                        <button
                            type="button"
                            data-testid="cancel-no-fly-zone"
                            onClick={onCancelPlacement}
                            className="w-full cursor-pointer rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                            Hủy
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        data-testid="create-no-fly-zone"
                        onClick={onStartPlacement}
                        className="w-full cursor-pointer rounded bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700"
                    >
                        Chọn tâm vùng cấm bay trên bản đồ
                    </button>
                )}
                <div className="space-y-2">
                    <p className="text-xs font-bold uppercase text-slate-500">Vùng tạm thời đã tạo</p>
                    {zones.length > 0 ? (
                        <div className="max-h-56 space-y-2 overflow-y-auto">
                        {recentZones.map(zone => (
                            <div key={zone.id} className="rounded border border-red-100 bg-red-50 px-2 py-2 text-xs text-slate-700">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-mono font-bold">{zone.label ?? zone.id}</span>
                                    <span className="font-semibold text-red-700">{zone.radius}m</span>
                                </div>
                                <p className="mt-1 text-slate-500">Cao {zone.height ?? '--'}m</p>
                            </div>
                        ))}
                        </div>
                    ) : (
                        <p className="text-xs italic text-slate-400">Chưa có vùng cấm bay tạm thời.</p>
                    )}
                    <p className="text-[11px] text-slate-500">Reset mô phỏng để xóa toàn bộ vùng tạm thời.</p>
                </div>
            </div>
        </section>
    );
}
