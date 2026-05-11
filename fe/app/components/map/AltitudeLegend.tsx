'use client';

import { ALTITUDE_COLOR_BANDS } from './SmoothDroneMarker';

export default function AltitudeLegend() {
    return (
        <div className="pointer-events-none rounded border border-slate-200 bg-white/90 px-3 py-2 text-[11px] font-medium text-slate-700 shadow-sm backdrop-blur">
            <div className="mb-1 font-bold text-slate-800">Độ cao UAV</div>
            <div className="space-y-1">
                {ALTITUDE_COLOR_BANDS.map(band => (
                    <div key={band.key} className="flex items-center gap-2 whitespace-nowrap">
                        <span
                            className="h-2.5 w-2.5 rounded-full border border-white shadow-sm"
                            style={{ backgroundColor: band.color }}
                        />
                        <span>{band.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
