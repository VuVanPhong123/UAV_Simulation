'use client';

import type { ObstacleConfig, ObstacleType } from '../types/simulation';

type ObstaclePanelProps = {
    obstacleConfig: ObstacleConfig;
    onChange: (key: keyof ObstacleConfig, value: number | ObstacleType) => void;
    isPlacingObstacle?: boolean;
    onStartPlacement?: () => void;
    onCancelPlacement?: () => void;
};

const obstacleTypes: ObstacleType[] = ['unknown', 'tree', 'pole', 'bird', 'building_crane'];
const obstacleLabels: Record<ObstacleType, string> = {
    unknown: 'Không rõ',
    tree: 'Cây',
    pole: 'Cột',
    bird: 'Chim',
    building_crane: 'Cẩu công trình'
};

export default function ObstaclePanel({
    obstacleConfig,
    onChange,
    isPlacingObstacle = false,
    onStartPlacement,
    onCancelPlacement
}: ObstaclePanelProps) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Vật cản</h2>
            <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold text-slate-600">
                    Bán kính: {obstacleConfig.radius}m
                    <input className="mt-1 w-full" type="range" min="2" max="30" value={obstacleConfig.radius} onChange={e => onChange('radius', Number(e.target.value))} />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Độ cao: {obstacleConfig.height}m
                    <input className="mt-1 w-full" type="range" min="5" max="120" value={obstacleConfig.height} onChange={e => onChange('height', Number(e.target.value))} />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                    Loại vật cản
                    <select
                        value={obstacleConfig.obstacleType}
                        onChange={e => onChange('obstacleType', e.target.value as ObstacleType)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                    >
                        {obstacleTypes.map(type => <option key={type} value={type}>{obstacleLabels[type]}</option>)}
                    </select>
                </label>
                {isPlacingObstacle ? (
                    <div className="space-y-2">
                        <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">
                            Đang chọn vị trí đặt vật cản. Click lên bản đồ để đặt.
                        </div>
                        <button
                            type="button"
                            data-testid="cancel-obstacle"
                            onClick={onCancelPlacement}
                            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                            Hủy đặt vật cản
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        data-testid="create-obstacle"
                        onClick={onStartPlacement}
                        className="w-full rounded bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-700"
                    >
                        Tạo vật cản
                    </button>
                )}
            </div>
        </section>
    );
}
