'use client';

import type { AsyncRequestStatus, LayerToggles } from '../types/simulation';
import { ActionStatusMessage } from '../ui/ActionStatus';

type LayerTogglePanelProps = {
    layers: LayerToggles;
    activeSimId?: string | null;
    windShadowStatus?: AsyncRequestStatus;
    buildingLoadStatus?: 'idle' | 'loading' | 'success' | 'error';
    onToggle: (key: keyof LayerToggles) => void;
};

const labels: Array<[keyof LayerToggles, string]> = [
    ['buildings', 'Tòa nhà'],
    ['buildingLabels', 'Nhãn độ cao'],
    ['noFlyZones', 'Vùng cấm bay'],
    ['chargingStations', 'Trạm sạc'],
    ['plannedPath', 'Tuyến bay'],
    ['pathHistory', 'Lịch sử đường bay'],
    ['dynamicObstacles', 'Vật cản'],
    ['orders', 'Đơn hàng'],
    ['windShadow', 'Vùng cản gió'],
    ['sensorRange', 'Vùng cảm biến'],
    ['weatherOverlay', 'Hiệu ứng thời tiết']
];

export default function LayerTogglePanel({
    layers,
    activeSimId,
    windShadowStatus = 'idle',
    buildingLoadStatus = 'idle',
    onToggle
}: LayerTogglePanelProps) {
    return (
        <section data-testid="layer-toggle-panel" className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Lớp bản đồ</h2>
            <div className="mt-3 space-y-2">
                {labels.map(([key, label]) => (
                    <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                        <span className="min-w-0">
                            <span className="block">{label}</span>
                            {key === 'buildingLabels' && (
                                <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                                    Hiển thị khi zoom &gt;= 16, chỉ show nhãn có độ cao hơn 20m
                                </span>
                            )}
                        </span>
                        <input
                            data-testid={key === 'buildingLabels' ? 'toggle-building-labels' : undefined}
                            className="cursor-pointer"
                            type="checkbox"
                            checked={layers[key]}
                            onChange={() => onToggle(key)}
                        />
                    </label>
                ))}
            </div>
            <div className="mt-3 space-y-2">
                {buildingLoadStatus === 'loading' && (
                    <ActionStatusMessage tone="loading">Đang tải lớp tòa nhà...</ActionStatusMessage>
                )}
                {buildingLoadStatus === 'error' && (
                    <ActionStatusMessage tone="error">Không tải được lớp tòa nhà. Bản đồ vẫn chạy nhưng thiếu layer tòa nhà.</ActionStatusMessage>
                )}
                {layers.windShadow && windShadowStatus === 'loading' && (
                    <ActionStatusMessage tone="loading">Đang tải vùng cản gió...</ActionStatusMessage>
                )}
                {!activeSimId && windShadowStatus === 'warning' && (
                    <ActionStatusMessage tone="warning">Cần bắt đầu mô phỏng trước khi tải vùng cản gió.</ActionStatusMessage>
                )}
                {layers.windShadow && windShadowStatus === 'success' && (
                    <ActionStatusMessage tone="success">Đã tải vùng cản gió.</ActionStatusMessage>
                )}
            </div>
        </section>
    );
}
