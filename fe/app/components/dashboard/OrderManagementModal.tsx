'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ActionStatusMessage, type ActionStatusTone } from '../ui/ActionStatus';
import {
    formatLatLng,
    translatePriority
} from '../utils/labels';
import type {
    DraftOrder,
    DynamicNoFlyZone,
    LatLng,
    MapBounds,
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
    dynamicNoFlyZones?: DynamicNoFlyZone[];
    mapInteractionMode: MapInteractionMode;
    importError: string | null;
    isStartingSimulation?: boolean;
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
const DEFAULT_RANDOM_ORDER_COUNT = 20;
const MAX_RANDOM_ORDER_COUNT = 100;
const MAX_IMPORT_ORDER_COUNT = 200;
const MIN_PICKUP_DROPOFF_DISTANCE_METERS = 100;
const RANDOM_POINT_MAX_ATTEMPTS_PER_POINT = 80;
const RANDOM_ORDER_MAX_ATTEMPTS = 200;
const NO_FLY_BUFFER_METERS = 20;
const FALLBACK_BOUNDS_PADDING_METERS = 200;
const LOCAL_SAFE_ORDER_POINTS_BY_MAP: Record<string, LatLng[]> = {
    hanoi_my_dinh_me_tri: [
        [21.0142, 105.7814],
        [21.0148, 105.7854],
        [21.0162, 105.7890],
        [21.0187, 105.7894],
        [21.0194, 105.7856],
        [21.0175, 105.7815],
        [21.0129, 105.7833],
        [21.0201, 105.7876]
    ],
    hanoi_my_dinh_me_tri_large: [
        [21.0058, 105.7708],
        [21.0064, 105.7768],
        [21.0072, 105.7832],
        [21.0109, 105.7715],
        [21.0126, 105.7864],
        [21.0158, 105.7970],
        [21.0187, 105.7724],
        [21.0194, 105.7856],
        [21.0248, 105.7932],
        [21.0278, 105.8002]
    ]
};

function clampOrderCount(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_RANDOM_ORDER_COUNT;
    return Math.max(1, Math.min(MAX_RANDOM_ORDER_COUNT, Math.floor(value)));
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

type NoFlyZoneLike = { center: LatLng; radius: number };

function isFiniteLatLng(point: LatLng | null | undefined): point is LatLng {
    return Boolean(
        Array.isArray(point)
        && point.length === 2
        && Number.isFinite(point[0])
        && Number.isFinite(point[1])
        && point[0] >= -90
        && point[0] <= 90
        && point[1] >= -180
        && point[1] <= 180
    );
}

function isInsideNoFlyZone(point: LatLng, noFlyZones: NoFlyZoneLike[] = []) {
    return noFlyZones.some(zone => (
        isFiniteLatLng(zone.center)
        && distanceMeters(point, zone.center) <= Number(zone.radius ?? 0) + NO_FLY_BUFFER_METERS
    ));
}

function isValidBounds(bounds: MapBounds | null | undefined): bounds is MapBounds {
    return Boolean(
        bounds
        && Number.isFinite(bounds.south)
        && Number.isFinite(bounds.west)
        && Number.isFinite(bounds.north)
        && Number.isFinite(bounds.east)
        && bounds.south >= -90
        && bounds.north <= 90
        && bounds.west >= -180
        && bounds.east <= 180
        && bounds.south < bounds.north
        && bounds.west < bounds.east
    );
}

function paddedBoundsForPoints(points: LatLng[], paddingMeters = FALLBACK_BOUNDS_PADDING_METERS): MapBounds | null {
    const finitePoints = points.filter(isFiniteLatLng);
    if (finitePoints.length === 0) return null;

    const lats = finitePoints.map(point => point[0]);
    const lngs = finitePoints.map(point => point[1]);
    const centerLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
    const latPadding = paddingMeters / 111320;
    const lngPadding = paddingMeters / Math.max(20000, 111320 * Math.cos(toRadians(centerLat)));
    const bounds = {
        south: Math.max(-90, Math.min(...lats) - latPadding),
        west: Math.max(-180, Math.min(...lngs) - lngPadding),
        north: Math.min(90, Math.max(...lats) + latPadding),
        east: Math.min(180, Math.max(...lngs) + lngPadding)
    };
    return isValidBounds(bounds) ? bounds : null;
}

function normalizeBounds(mapConfig: MapConfig | null): MapBounds | null {
    if (isValidBounds(mapConfig?.bounds)) {
        return mapConfig.bounds;
    }

    const inferredPoints: LatLng[] = [];
    if (isFiniteLatLng(mapConfig?.start)) inferredPoints.push(mapConfig.start);
    if (isFiniteLatLng(mapConfig?.goal)) inferredPoints.push(mapConfig.goal);
    if (isFiniteLatLng(mapConfig?.depot)) inferredPoints.push(mapConfig.depot);
    mapConfig?.safeOrderPoints?.forEach(point => {
        if (isFiniteLatLng(point)) inferredPoints.push(point);
    });
    mapConfig?.charging_stations?.forEach(point => {
        if (isFiniteLatLng(point)) inferredPoints.push(point);
    });
    mapConfig?.no_fly_zones?.forEach(zone => {
        if (isFiniteLatLng(zone.center)) inferredPoints.push(zone.center);
    });

    return paddedBoundsForPoints(inferredPoints);
}

function randomPointInBounds(bounds: MapBounds): LatLng {
    return [
        bounds.south + Math.random() * (bounds.north - bounds.south),
        bounds.west + Math.random() * (bounds.east - bounds.west)
    ];
}

function isPointInsideBounds(point: LatLng, bounds: MapBounds | null) {
    if (!bounds) return true;
    return point[0] >= bounds.south
        && point[0] <= bounds.north
        && point[1] >= bounds.west
        && point[1] <= bounds.east;
}

function isUsableRandomPoint(
    point: LatLng,
    mapConfig: MapConfig | null,
    bounds: MapBounds | null,
    dynamicNoFlyZones: DynamicNoFlyZone[] = []
) {
    if (!isFiniteLatLng(point) || !isPointInsideBounds(point, bounds)) return false;
    if (isInsideNoFlyZone(point, mapConfig?.no_fly_zones ?? [])) return false;
    if (isInsideNoFlyZone(point, dynamicNoFlyZones)) return false;
    return true;
}

function randomUsablePoint(
    mapConfig: MapConfig | null,
    bounds: MapBounds,
    dynamicNoFlyZones: DynamicNoFlyZone[] = []
) {
    for (let attempt = 0; attempt < RANDOM_POINT_MAX_ATTEMPTS_PER_POINT; attempt += 1) {
        const point = randomPointInBounds(bounds);
        if (isUsableRandomPoint(point, mapConfig, bounds, dynamicNoFlyZones)) return point;
    }
    return null;
}

function shuffleItems<T>(items: T[]) {
    const shuffled = [...items];
    for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
        const swapIdx = randomIndex(idx + 1);
        [shuffled[idx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[idx]];
    }
    return shuffled;
}

function getPathFriendlyOrderPoints(
    mapConfig: MapConfig | null,
    dynamicNoFlyZones: DynamicNoFlyZone[] = []
) {
    const bounds = normalizeBounds(mapConfig);
    const noFlyZones = [...(mapConfig?.no_fly_zones ?? []), ...dynamicNoFlyZones];
    const localFallback = LOCAL_SAFE_ORDER_POINTS_BY_MAP[mapConfig?.mapId ?? 'hanoi_my_dinh_me_tri_large']
        ?? LOCAL_SAFE_ORDER_POINTS_BY_MAP.hanoi_my_dinh_me_tri_large;
    const sourcePoints = mapConfig?.safeOrderPoints && mapConfig.safeOrderPoints.length >= 2
        ? mapConfig.safeOrderPoints
        : localFallback;
    const filtered = sourcePoints.filter(point => (
        isFiniteLatLng(point)
        && isPointInsideBounds(point, bounds)
        && !isInsideNoFlyZone(point, noFlyZones)
    ));
    if (filtered.length >= 2) return filtered;

    return localFallback.filter(point => (
        isFiniteLatLng(point)
        && isPointInsideBounds(point, bounds)
        && !isInsideNoFlyZone(point, noFlyZones)
    ));
}

function eligibleOrderPairs(points: LatLng[]) {
    const eligiblePairs: Array<[LatLng, LatLng]> = [];
    points.forEach((pickup, pickupIndex) => {
        points.forEach((dropoff, dropoffIndex) => {
            if (pickupIndex !== dropoffIndex && distanceMeters(pickup, dropoff) >= MIN_PICKUP_DROPOFF_DISTANCE_METERS) {
                eligiblePairs.push([pickup, dropoff]);
            }
        });
    });
    return shuffleItems(eligiblePairs);
}

function createRandomOrders(
    count: number,
    mapConfig: MapConfig | null,
    dynamicNoFlyZones: DynamicNoFlyZone[] = []
): DraftOrder[] {
    const safeCount = clampOrderCount(count);
    const timestamp = Date.now();
    const bounds = normalizeBounds(mapConfig);
    const pathFriendlyPairs = eligibleOrderPairs(getPathFriendlyOrderPoints(mapConfig, dynamicNoFlyZones));
    const orders: DraftOrder[] = [];

    for (let idx = 0; idx < safeCount; idx += 1) {
        let pair: [LatLng, LatLng] | null = null;
        if (pathFriendlyPairs.length > 0) {
            pair = pathFriendlyPairs[idx % pathFriendlyPairs.length];
        }
        if (bounds) {
            if (!pair) {
                for (let attempt = 0; attempt < RANDOM_ORDER_MAX_ATTEMPTS; attempt += 1) {
                    const pickup = randomUsablePoint(mapConfig, bounds, dynamicNoFlyZones);
                    const dropoff = randomUsablePoint(mapConfig, bounds, dynamicNoFlyZones);
                    if (
                        pickup
                        && dropoff
                        && distanceMeters(pickup, dropoff) >= MIN_PICKUP_DROPOFF_DISTANCE_METERS
                    ) {
                        pair = [pickup, dropoff];
                        break;
                    }
                }
            }
        }

        if (!pair) continue;

        orders.push({
            orderId: `random_order_${timestamp}_${idx + 1}`,
            pickup: pair[0],
            dropoff: pair[1],
            payloadKg: Number((0.5 + Math.random() * 2.5).toFixed(1)),
            priority: randomPriorities[randomIndex(randomPriorities.length)]
        });
    }

    return orders;
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
    dynamicNoFlyZones = [],
    mapInteractionMode,
    importError,
    isStartingSimulation = false,
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
    const [randomCount, setRandomCount] = useState(DEFAULT_RANDOM_ORDER_COUNT);
    const [randomHint, setRandomHint] = useState<string | null>(null);
    const [actionFeedback, setActionFeedback] = useState<{ tone: ActionStatusTone; message: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const canAddDraft = draftOrderValid(draftOrder);
    const allDraftsValid = draftOrders.length > 0 && draftOrders.every(draftOrderValid);
    const submitDisabled = activeSimId ? !allDraftsValid || isSubmitting : !canStartWithOrders || isSubmitting || isStartingSimulation;
    const actionHint = activeSimId
        ? 'Cần có ít nhất một đơn nháp hợp lệ để gửi thêm đơn hàng.'
        : startHint;
    const interactionText = mapInteractionMode === 'select_pickup'
        ? 'Đang chọn điểm lấy hàng trên bản đồ'
        : mapInteractionMode === 'select_dropoff'
            ? 'Đang chọn điểm giao hàng trên bản đồ'
            : null;

    if (!open) return null;

    const setSuccessFeedback = (message: string) => {
        setActionFeedback({ tone: 'success', message });
        window.setTimeout(() => setActionFeedback(null), 2800);
    };

    const importedRowCount = () => {
        try {
            const parsed = JSON.parse(jsonText);
            return Array.isArray(parsed) ? parsed.length : 1;
        } catch {
            return 0;
        }
    };

    return (
        <div data-testid="order-modal" className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4 [&_button]:cursor-pointer [&_button:disabled]:cursor-not-allowed">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded border border-slate-200 bg-slate-50 shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                    <div>
                        <h2 className="text-sm font-bold text-slate-800">Quản lý đơn hàng</h2>
                        <p className="text-xs font-semibold text-slate-500">
                            Đơn nháp: {draftOrders.length} · {activeSimId ? 'Mô phỏng đang chạy' : 'Chưa bắt đầu mô phỏng'}
                        </p>
                    </div>
                    {actionFeedback && (
                        <div className="min-w-0 flex-1">
                            <ActionStatusMessage tone={actionFeedback.tone}>{actionFeedback.message}</ActionStatusMessage>
                        </div>
                    )}
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
                                    onClick={() => {
                                        onAddDraftOrder();
                                        setSuccessFeedback('Đã thêm đơn vào danh sách nháp.');
                                    }}
                                    className="w-full rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                                >
                                    Thêm vào danh sách nháp
                                </button>
                            </div>
                        </Section>

                        <div className="space-y-3">
                            <Section title="Tạo ngẫu nhiên đơn hàng">
                                <div className="space-y-3">
                                    <div className="rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                        <p className="mt-1">Tối đa {MAX_RANDOM_ORDER_COUNT} đơn/lần.</p>
                                    </div>
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
                                            const requestedCount = clampOrderCount(randomCount);
                                            const orders = createRandomOrders(requestedCount, mapConfig, dynamicNoFlyZones);
                                            if (orders.length > 0) {
                                                onAddDraftOrders(orders);
                                            }
                                            if (orders.length === requestedCount) {
                                                setSuccessFeedback(`Đã tạo ${orders.length} đơn ngẫu nhiên`);
                                                setRandomHint(`Đã tạo ${orders.length} đơn ngẫu nhiên`);
                                                return;
                                            }
                                            if (orders.length > 0) {
                                                const message = `Chỉ tạo được ${orders.length}/${requestedCount} đơn do vùng hợp lệ hạn chế/no-fly-zone.`;
                                                setActionFeedback({ tone: 'warning', message });
                                                setRandomHint(message);
                                                return;
                                            }
                                            const message = 'Không tạo được đơn ngẫu nhiên trong vùng bản đồ hiện tại. Hãy chọn thủ công hoặc kiểm tra vùng cấm bay.';
                                            setActionFeedback({ tone: 'warning', message });
                                            setRandomHint(message);
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
                                    onClick={() => {
                                        const count = importedRowCount();
                                        if (count > MAX_IMPORT_ORDER_COUNT) {
                                            setActionFeedback({ tone: 'error', message: `Tối đa ${MAX_IMPORT_ORDER_COUNT} đơn/lần import.` });
                                            return;
                                        }
                                        const imported = onImportJson(jsonText);
                                        if (imported) {
                                            setSuccessFeedback(`Đã nạp ${count} đơn vào danh sách nháp.`);
                                            return;
                                        }
                                        setActionFeedback({ tone: 'error', message: 'Không nạp được JSON đơn hàng.' });
                                    }}
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
                            setIsSubmitting(true);
                            setActionFeedback({
                                tone: 'loading',
                                message: activeSimId ? 'Đang gửi đơn hàng...' : 'Đang gửi yêu cầu bắt đầu mô phỏng...'
                            });
                            const sent = activeSimId ? onSubmitDraftOrders() : onStartWithDraftOrders();
                            if (sent) {
                                setActionFeedback({
                                    tone: 'success',
                                    message: activeSimId ? 'Đã gửi danh sách đơn hàng.' : 'Đã gửi yêu cầu bắt đầu mô phỏng.'
                                });
                                window.setTimeout(() => {
                                    setIsSubmitting(false);
                                    onClose();
                                }, 700);
                                return;
                            }
                            setIsSubmitting(false);
                            setActionFeedback({
                                tone: 'error',
                                message: activeSimId ? 'Không gửi được đơn hàng. Kiểm tra kết nối/worker.' : 'Không gửi được yêu cầu bắt đầu. Kiểm tra kết nối/worker.'
                            });
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
