'use client';

import {
    MAP_PRESET_OPTIONS,
    type MapPresetId
} from '../types/simulation';

type MapSelectorModalProps = {
    open: boolean;
    selectedMapId: string;
    activeMapId?: string | null;
    disabled?: boolean;
    simulationRunning?: boolean;
    onClose: () => void;
    onSelectMap: (mapId: MapPresetId) => void;
};

export default function MapSelectorModal({
    open,
    selectedMapId,
    activeMapId,
    disabled = false,
    simulationRunning = false,
    onClose,
    onSelectMap
}: MapSelectorModalProps) {
    if (!open) return null;
    const visibleOptions = MAP_PRESET_OPTIONS;

    return (
        <div data-testid="map-selector-modal" className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/45 p-4 [&_button]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
            <div className="w-full max-w-2xl rounded border border-slate-200 bg-slate-50 shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                    <div>
                        <h2 className="text-sm font-bold text-slate-800">Chọn bản đồ mô phỏng</h2>
                        <p className="text-xs font-semibold text-slate-500">Chọn preset map đã có cache để chạy demo.</p>
                    </div>
                    <button
                        type="button"
                        data-testid="close-map-selector"
                        onClick={onClose}
                        className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                        Đóng
                    </button>
                </div>

                <div className="space-y-3 p-4">
                    {(disabled || simulationRunning) && (
                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                            Dừng mô phỏng trước khi đổi bản đồ.
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {visibleOptions.map(option => {
                            const selected = selectedMapId === option.mapId;
                            const active = activeMapId === option.mapId;
                            return (
                                <section
                                    key={option.mapId}
                                    data-testid={`map-option-${option.mapId}`}
                                    className={`rounded border bg-white p-3 ${selected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-800">{option.label}</h3>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">{option.mapId}</p>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1">
                                            {selected && <span className="rounded bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">Đang chọn</span>}
                                            {active && <span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Đang chạy</span>}
                                        </div>
                                    </div>
                                    <p className="mt-3 min-h-10 text-xs font-semibold leading-5 text-slate-600">{option.description}</p>
                                    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600">
                                        <div className="flex items-center justify-between gap-3 rounded bg-slate-50 px-2 py-1">
                                            <dt className="font-bold">Kích thước</dt>
                                            <dd className="font-mono">{option.sizeLabel}</dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 rounded bg-slate-50 px-2 py-1">
                                            <dt className="font-bold">Gợi ý demo</dt>
                                            <dd className="text-right font-mono">{option.recommendedUse}</dd>
                                        </div>
                                    </dl>
                                    <button
                                        type="button"
                                        data-testid={`select-map-${option.mapId}`}
                                        disabled={disabled || selected}
                                        onClick={() => onSelectMap(option.mapId)}
                                        className="mt-3 w-full rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                                    >
                                        Chọn bản đồ này
                                    </button>
                                </section>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
