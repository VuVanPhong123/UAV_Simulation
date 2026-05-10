'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
    formatLatLng,
    translatePriority
} from '../utils/labels';
import type {
    DraftOrder,
    LatLng,
    MapConfig,
    MapInteractionMode,
    OrderPriority
} from '../types/simulation';

type OrderManagementModalProps = {
    open: boolean;
    onClose: () => void;
    draftOrder: DraftOrder;
    draftOrders: DraftOrder[];
    activeSimId: string | null;
    mapConfig: MapConfig | null;
    mapInteractionMode: MapInteractionMode;
    importError: string | null;
    canStartWithOrders: boolean;
    startHint: string;
    onDraftChange: <K extends keyof DraftOrder>(key: K, value: DraftOrder[K]) => void;
    onAddDraftOrder: () => void;
    onRemoveDraftOrder: (orderId: string) => void;
    onImportJson: (text: string) => boolean;
    onAddDraftOrders: (orders: DraftOrder[]) => void;
    onStartWithDraftOrders: () => boolean;
    onSubmitDraftOrders: () => boolean;
    onSetMapInteractionMode: (mode: MapInteractionMode) => void;
};

const priorities: OrderPriority[] = ['low', 'normal', 'high', 'urgent'];
const randomPriorities: OrderPriority[] = ['low', 'normal', 'high'];
const NO_FLY_BUFFER_METERS = 20;
const DEMO_SAFE_ORDER_POINTS: LatLng[] = [
    [21.0260, 105.8500],
    [21.0261, 105.8539],
    [21.0286, 105.8501],
    [21.0309, 105.8520],
    [21.0310, 105.8569],
    [21.0270, 105.8568],
    [21.0252, 105.8527],
    [21.0292, 105.8580]
];

function clampOrderCount(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.min(30, Math.floor(value)));
}

function randomIndex(max: number) {
    return Math.floor(Math.random() * max);
}

function toRadians(value: number) {
    return value * Math.PI / 180;
}

function distanceMeters(a: LatLng, b: LatLng) {
    const earthRadiusMeters = 6371000;
    const dLat = toRadians(b[0] - a[0]);
    const dLng = toRadians(b[1] - a[1]);
    const lat1 = toRadians(a[0]);
    const lat2 = toRadians(b[0]);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function isInsideNoFlyZone(point: LatLng, noFlyZones: MapConfig['no_fly_zones'] = []) {
    return noFlyZones.some(zone => (
        distanceMeters(point, zone.center) <= Number(zone.radius ?? 0) + NO_FLY_BUFFER_METERS
    ));
}

function midpoint(a: LatLng, b: LatLng): LatLng {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function isReasonableDemoPoint(point: LatLng, mapConfig: MapConfig | null) {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return false;
    }
    if (!mapConfig) return true;

    const start = mapConfig.start ?? mapConfig.depot;
    const goal = mapConfig.goal ?? start;
    if (!start || !goal) return true;

    const demoCenter = midpoint(start, goal);
    const mapSpan = distanceMeters(start, goal);
    const maxRadius = Math.max(450, Math.min(550, mapSpan * 0.56));
    return distanceMeters(point, demoCenter) <= maxRadius;
}

function safeDemoPoints(mapConfig: MapConfig | null) {
    const noFlyZones = mapConfig?.no_fly_zones ?? [];
    const filtered = DEMO_SAFE_ORDER_POINTS.filter(point => (
        isReasonableDemoPoint(point, mapConfig)
        && !isInsideNoFlyZone(point, noFlyZones)
    ));
    if (filtered.length >= 2) return filtered;

    const fallback = DEMO_SAFE_ORDER_POINTS.filter(point => !isInsideNoFlyZone(point, noFlyZones));
    return fallback.length >= 2 ? fallback : DEMO_SAFE_ORDER_POINTS;
}

function createRandomOrders(count: number, mapConfig: MapConfig | null): DraftOrder[] {
    const safeCount = clampOrderCount(count);
    const timestamp = Date.now();
    const points = safeDemoPoints(mapConfig);
    return Array.from({ length: safeCount }).map((_, idx) => {
        const pickupIndex = randomIndex(points.length);
        let dropoffIndex = randomIndex(points.length);
        if (dropoffIndex === pickupIndex) {
            dropoffIndex = (dropoffIndex + 1) % points.length;
        }

        return {
            orderId: `random_order_${timestamp}_${idx + 1}`,
            pickup: points[pickupIndex],
            dropoff: points[dropoffIndex],
            payloadKg: Number((0.5 + Math.random() * 2.5).toFixed(1)),
            priority: randomPriorities[randomIndex(randomPriorities.length)]
        };
    });
}

function NumberInput({
    label,
    value,
    onChange,
    step = '0.000001',
    testId
}: {
    label: string;
    value: number | '';
    onChange: (value: number | '') => void;
    step?: string;
    testId?: string;
}) {
    return (
        <label className="block text-xs font-semibold text-slate-600">
            {label}
            <input
                data-testid={testId}
                value={value}
                onChange={event => {
                    const next = event.target.value;
                    onChange(next === '' ? '' : Number(next));
                }}
                type="number"
                step={step}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
            />
        </label>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h3 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">{title}</h3>
            <div className="mt-3">{children}</div>
        </section>
    );
}

function draftOrderValid(order: DraftOrder) {
    return Boolean(
        order.orderId.trim()
        && order.pickup
        && order.dropoff
        && Number.isFinite(order.payloadKg)
        && order.payloadKg > 0
    );
}

export default function OrderManagementModal({
    open,
    onClose,
    draftOrder,
    draftOrders,
    activeSimId,
    mapConfig,
    mapInteractionMode,
    importError,
    canStartWithOrders,
    startHint,
    onDraftChange,
    onAddDraftOrder,
    onRemoveDraftOrder,
    onImportJson,
    onAddDraftOrders,
    onStartWithDraftOrders,
    onSubmitDraftOrders,
    onSetMapInteractionMode
}: OrderManagementModalProps) {
    const [jsonText, setJsonText] = useState('');
    const [randomCount, setRandomCount] = useState(5);
    const [randomHint, setRandomHint] = useState<string | null>(null);
    const canAddDraft = draftOrderValid(draftOrder);
    const allDraftsValid = draftOrders.length > 0 && draftOrders.every(draftOrderValid);
    const submitDisabled = activeSimId ? !allDraftsValid : !canStartWithOrders;
    const actionHint = activeSimId
        ? 'Cần có ít nhất một đơn nháp hợp lệ để gửi thêm đơn hàng.'
        : startHint;
    const interactionText = mapInteractionMode === 'select_pickup'
        ? 'Đang chọn điểm lấy hàng trên bản đồ'
        : mapInteractionMode === 'select_dropoff'
            ? 'Đang chọn điểm giao hàng trên bản đồ'
            : null;

    if (!open) return null;

    return (
        <div data-testid="order-modal" className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded border border-slate-200 bg-slate-50 shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                    <div>
                        <h2 className="text-sm font-bold text-slate-800">Quản lý đơn hàng</h2>
                        <p className="text-xs font-semibold text-slate-500">
                            Đơn nháp: {draftOrders.length} · {activeSimId ? 'Mô phỏng đang chạy' : 'Chưa bắt đầu mô phỏng'}
                        </p>
                    </div>
                    <button
                        data-testid="close-order-modal"
                        onClick={onClose}
                        className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                        Đóng
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <Section title="Tạo đơn thủ công">
                            <div className="space-y-3">
                                {interactionText && (
                                    <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                                        {interactionText}
                                    </div>
                                )}
                                <label className="block text-xs font-semibold text-slate-600">
                                    Mã đơn
                                    <input
                                        value={draftOrder.orderId}
                                        onChange={event => onDraftChange('orderId', event.target.value)}
                                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                                    />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <NumberInput
                                        label="Vĩ độ lấy hàng"
                                        value={draftOrder.pickup ? draftOrder.pickup[0] : ''}
                                        onChange={value => onDraftChange('pickup', value === '' ? null : [Number(value), draftOrder.pickup?.[1] ?? 105.8542] as LatLng)}
                                    />
                                    <NumberInput
                                        label="Kinh độ lấy hàng"
                                        value={draftOrder.pickup ? draftOrder.pickup[1] : ''}
                                        onChange={value => onDraftChange('pickup', value === '' ? null : [draftOrder.pickup?.[0] ?? 21.0285, Number(value)] as LatLng)}
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        onSetMapInteractionMode('select_pickup');
                                        onClose();
                                    }}
                                    className="w-full rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                >
                                    Chọn điểm lấy hàng trên bản đồ
                                </button>
                                <div className="grid grid-cols-2 gap-2">
                                    <NumberInput
                                        label="Vĩ độ giao hàng"
                                        value={draftOrder.dropoff ? draftOrder.dropoff[0] : ''}
                                        onChange={value => onDraftChange('dropoff', value === '' ? null : [Number(value), draftOrder.dropoff?.[1] ?? 105.8550] as LatLng)}
                                    />
                                    <NumberInput
                                        label="Kinh độ giao hàng"
                                        value={draftOrder.dropoff ? draftOrder.dropoff[1] : ''}
                                        onChange={value => onDraftChange('dropoff', value === '' ? null : [draftOrder.dropoff?.[0] ?? 21.0290, Number(value)] as LatLng)}
                                    />
                                </div>
                                <button
                                    onClick={() => {
                                        onSetMapInteractionMode('select_dropoff');
                                        onClose();
                                    }}
                                    className="w-full rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-100"
                                >
                                    Chọn điểm giao hàng trên bản đồ
                                </button>
                                <div className="grid grid-cols-2 gap-2">
                                    <NumberInput
                                        label="Khối lượng kg"
                                        value={draftOrder.payloadKg}
                                        step="0.1"
                                        onChange={value => onDraftChange('payloadKg', Number(value || 0))}
                                    />
                                    <label className="block text-xs font-semibold text-slate-600">
                                        Mức ưu tiên
                                        <select
                                            value={draftOrder.priority}
                                            onChange={event => onDraftChange('priority', event.target.value as OrderPriority)}
                                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
                                        >
                                            {priorities.map(priority => (
                                                <option key={priority} value={priority}>{translatePriority(priority)}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <button
                                    disabled={!canAddDraft}
                                    onClick={onAddDraftOrder}
                                    className="w-full rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                                >
                                    Thêm vào danh sách nháp
                                </button>
                            </div>
                        </Section>

                        <div className="space-y-3">
                            <Section title="Tạo ngẫu nhiên đơn hàng">
                                <div className="space-y-3">
                                    <NumberInput
                                        label="Số đơn hàng"
                                        value={randomCount}
                                        step="1"
                                        testId="random-order-count"
                                        onChange={value => setRandomCount(clampOrderCount(Number(value || 1)))}
                                    />
                                    <button
                                        data-testid="generate-random-orders"
                                        onClick={() => {
                                            const orders = createRandomOrders(randomCount, mapConfig);
                                            onAddDraftOrders(orders);
                                            setRandomHint(`Đã tạo ${orders.length} đơn ngẫu nhiên từ các điểm demo hợp lệ.`);
                                        }}
                                        className="w-full rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                                    >
                                        Tạo ngẫu nhiên
                                    </button>
                                    {randomHint && <p className="text-xs font-semibold text-slate-500">{randomHint}</p>}
                                </div>
                            </Section>

                            <Section title="Import JSON">
                                <textarea
                                    value={jsonText}
                                    onChange={event => setJsonText(event.target.value)}
                                    rows={8}
                                    placeholder={`[\n  {\n    "orderId": "order_1",\n    "pickup": [21.0285, 105.8542],\n    "dropoff": [21.0290, 105.8550],\n    "payloadKg": 1.2,\n    "priority": "normal"\n  }\n]`}
                                    className="w-full rounded border border-slate-300 bg-white px-2 py-2 font-mono text-xs text-slate-700"
                                />
                                {importError && <p className="mt-2 text-xs font-semibold text-red-600">{importError}</p>}
                                <button
                                    onClick={() => onImportJson(jsonText)}
                                    className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                                >
                                    Nạp JSON vào danh sách nháp
                                </button>
                            </Section>
                        </div>

                        <div className="lg:col-span-2">
                            <Section title="Danh sách đơn nháp">
                                <div data-testid="draft-order-list" className="max-h-72 space-y-2 overflow-y-auto">
                                    {draftOrders.map(order => (
                                        <div key={order.orderId} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-mono font-bold text-slate-800">{order.orderId}</span>
                                                <button onClick={() => onRemoveDraftOrder(order.orderId)} className="text-xs font-bold text-red-600">Xóa</button>
                                            </div>
                                            <div className="mt-1 grid grid-cols-1 gap-1 text-slate-600 md:grid-cols-2">
                                                <p>Lấy hàng: {formatLatLng(order.pickup)}</p>
                                                <p>Giao hàng: {formatLatLng(order.dropoff)}</p>
                                                <p>Khối lượng: {order.payloadKg}kg</p>
                                                <p>Ưu tiên: {translatePriority(order.priority)}</p>
                                            </div>
                                        </div>
                                    ))}
                                    {draftOrders.length === 0 && <p className="text-sm italic text-slate-400">Chưa có đơn nháp.</p>}
                                </div>
                            </Section>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <p className="text-xs font-semibold text-slate-500">
                        {submitDisabled ? actionHint : activeSimId ? 'Sẵn sàng gửi thêm đơn hàng.' : 'Sẵn sàng bắt đầu mô phỏng với danh sách đơn hiện tại.'}
                    </p>
                    <button
                        data-testid="start-simulation"
                        disabled={submitDisabled}
                        onClick={() => {
                            if (submitDisabled) return;
                            const sent = activeSimId ? onSubmitDraftOrders() : onStartWithDraftOrders();
                            if (sent) onClose();
                        }}
                        className="rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                        {activeSimId ? 'Gửi thêm đơn hàng' : 'Bắt đầu mô phỏng'}
                    </button>
                </div>
            </div>
        </div>
    );
}
