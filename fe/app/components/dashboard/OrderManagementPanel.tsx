'use client';

import { useState } from 'react';
import {
    formatLatLng,
    orderIdOf,
    translateMissionStatus,
    translateOrderStatus,
    translatePriority
} from '../utils/labels';
import type {
    DeliveryOrder,
    DraftOrder,
    MapInteractionMode,
    Mission,
    MissionsById,
    OrderPriority,
    OrdersById
} from '../types/simulation';

type OrderManagementPanelProps = {
    orders: OrdersById;
    missions: MissionsById;
    draftOrder: DraftOrder;
    draftOrders: DraftOrder[];
    selectedOrderId: string | null;
    activeSimId: string | null;
    mapInteractionMode: MapInteractionMode;
    importError: string | null;
    droneCount: number;
    canStartWithOrders: boolean;
    startHint: string;
    onSelectOrder: (orderId: string) => void;
    onAddDemoDraftOrders: (orders: DraftOrder[]) => void;
    onStartWithDraftOrders: () => void;
    onDraftChange: <K extends keyof DraftOrder>(key: K, value: DraftOrder[K]) => void;
    onAddDraftOrder: () => void;
    onRemoveDraftOrder: (orderId: string) => void;
    onSubmitDraftOrders: () => void;
    onImportJson: (text: string) => void;
    onDispatchOrders: () => void;
    onSetMapInteractionMode: (mode: MapInteractionMode) => void;
};

const priorities: OrderPriority[] = ['low', 'normal', 'high', 'urgent'];

const demoScenarios: Record<string, DraftOrder[]> = {
    single: [
        {
            orderId: 'demo_1_order',
            pickup: [21.0285, 105.8542],
            dropoff: [21.0290, 105.8550],
            payloadKg: 1.2,
            priority: 'high'
        }
    ],
    multi: [
        {
            orderId: 'demo_multi_1',
            pickup: [21.0285, 105.8542],
            dropoff: [21.0290, 105.8550],
            payloadKg: 0.8,
            priority: 'normal'
        },
        {
            orderId: 'demo_multi_2',
            pickup: [21.0278, 105.8536],
            dropoff: [21.0300, 105.8560],
            payloadKg: 1.1,
            priority: 'high'
        },
        {
            orderId: 'demo_multi_3',
            pickup: [21.0268, 105.8528],
            dropoff: [21.0296, 105.8538],
            payloadKg: 1.5,
            priority: 'urgent'
        },
        {
            orderId: 'demo_multi_4',
            pickup: [21.0290, 105.8550],
            dropoff: [21.0278, 105.8536],
            payloadKg: 1.8,
            priority: 'normal'
        },
        {
            orderId: 'demo_multi_5',
            pickup: [21.0300, 105.8560],
            dropoff: [21.0268, 105.8528],
            payloadKg: 2.0,
            priority: 'high'
        }
    ],
    overweight: [
        {
            orderId: 'demo_payload_too_heavy',
            pickup: [21.0285, 105.8542],
            dropoff: [21.0290, 105.8550],
            payloadKg: 999,
            priority: 'normal'
        }
    ]
};

function NumberInput({
    label,
    value,
    onChange,
    placeholder
}: {
    label: string;
    value: number | '';
    onChange: (value: number | '') => void;
    placeholder?: string;
}) {
    return (
        <label className="block text-xs font-semibold text-slate-600">
            {label}
            <input
                value={value}
                placeholder={placeholder}
                onChange={event => {
                    const next = event.target.value;
                    onChange(next === '' ? '' : Number(next));
                }}
                type="number"
                step="0.000001"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700"
            />
        </label>
    );
}

function systemOrderMission(order: DeliveryOrder, missions: MissionsById): Mission | null {
    const missionId = order.missionId ?? order.mission_id;
    return missionId ? missions[missionId] ?? null : null;
}

export default function OrderManagementPanel({
    orders,
    missions,
    draftOrder,
    draftOrders,
    selectedOrderId,
    activeSimId,
    mapInteractionMode,
    importError,
    droneCount,
    canStartWithOrders,
    startHint,
    onSelectOrder,
    onAddDemoDraftOrders,
    onStartWithDraftOrders,
    onDraftChange,
    onAddDraftOrder,
    onRemoveDraftOrder,
    onSubmitDraftOrders,
    onImportJson,
    onDispatchOrders,
    onSetMapInteractionMode
}: OrderManagementPanelProps) {
    const [jsonText, setJsonText] = useState('');
    const [demoHint, setDemoHint] = useState<string | null>(null);
    const systemOrders = Object.values(orders);
    const canAddDraft = Boolean(draftOrder.orderId.trim() && draftOrder.pickup && draftOrder.dropoff && draftOrder.payloadKg > 0);
    const interactionText = mapInteractionMode === 'select_pickup'
        ? 'Đang chọn điểm lấy hàng trên bản đồ'
        : mapInteractionMode === 'select_dropoff'
            ? 'Đang chọn điểm giao hàng trên bản đồ'
            : mapInteractionMode === 'obstacle'
                ? 'Đang đặt vật cản'
                : null;

    return (
        <div className="space-y-3">
            {interactionText && (
                <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                    {interactionText}
                </div>
            )}
            {!activeSimId && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                    Hãy bắt đầu mô phỏng trước khi gửi đơn hàng.
                </div>
            )}

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Kịch bản demo</h2>
                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                    Tạo nhanh các đơn hàng mẫu để kiểm thử dispatch và mission runtime.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                    <button
                        onClick={() => {
                            setDemoHint(activeSimId ? 'Đã thêm 1 đơn mẫu vào danh sách nháp.' : 'Hãy bắt đầu mô phỏng trước khi gửi đơn demo.');
                            onAddDemoDraftOrders(demoScenarios.single);
                        }}
                        className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs font-bold text-blue-700 hover:bg-blue-100"
                    >
                        Demo: 1 đơn / 1 UAV
                    </button>
                    <button
                        onClick={() => {
                            setDemoHint(!activeSimId
                                ? 'Hãy bắt đầu mô phỏng trước. Nên chạy với 3 UAV cho kịch bản 5 đơn.'
                                : droneCount < 3
                                    ? 'Nên chạy với 3 UAV cho kịch bản 5 đơn.'
                                    : 'Đã thêm 5 đơn mẫu vào danh sách nháp.');
                            onAddDemoDraftOrders(demoScenarios.multi);
                        }}
                        className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                    >
                        Demo: 5 đơn / 3 UAV
                    </button>
                    <button
                        onClick={() => {
                            setDemoHint(activeSimId ? 'Đơn payload quá nặng dùng để kiểm thử validate lỗi.' : 'Hãy bắt đầu mô phỏng trước khi gửi đơn demo.');
                            onAddDemoDraftOrders(demoScenarios.overweight);
                        }}
                        className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-bold text-amber-700 hover:bg-amber-100"
                    >
                        Demo: Payload quá nặng
                    </button>
                </div>
                {demoHint && <p className="mt-2 text-xs font-semibold text-slate-500">{demoHint}</p>}
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Khởi tạo mô phỏng</h2>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-700">
                    <span className="text-slate-500">Số UAV</span>
                    <span className="text-right font-mono">{droneCount}</span>
                    <span className="text-slate-500">Đơn nháp</span>
                    <span className="text-right font-mono">{draftOrders.length}</span>
                </div>
                <button
                    disabled={Boolean(activeSimId) || !canStartWithOrders}
                    onClick={onStartWithDraftOrders}
                    className="mt-3 w-full rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
                >
                    Bắt đầu mô phỏng với danh sách đơn
                </button>
                {(Boolean(activeSimId) || !canStartWithOrders) && (
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                        {activeSimId ? 'Mô phỏng đang chạy, dùng nút gửi thêm đơn hàng bên dưới.' : startHint}
                    </p>
                )}
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Đơn hàng trong hệ thống</h2>
                <div className="mt-2 space-y-2">
                    {systemOrders.map(order => {
                        const orderId = orderIdOf(order);
                        const selected = selectedOrderId === orderId;
                        const relatedMission = systemOrderMission(order, missions);
                        return (
                            <button
                                key={orderId}
                                onClick={() => onSelectOrder(orderId)}
                                className={`w-full rounded border p-2 text-left text-xs transition-colors ${
                                    selected ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono font-bold text-slate-800">{orderId}</span>
                                    <span className="font-bold text-slate-600">{translateOrderStatus(order.status)}</span>
                                </div>
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                                    <span>Tải trọng</span>
                                    <span className="text-right font-mono">{order.payloadKg ?? order.payload_kg ?? '--'}kg</span>
                                    <span>UAV</span>
                                    <span className="truncate text-right font-mono">{order.assignedDroneId ?? order.assigned_drone_id ?? '--'}</span>
                                    <span>Nhiệm vụ</span>
                                    <span className="truncate text-right font-mono">{order.missionId ?? order.mission_id ?? '--'}</span>
                                    <span>Trạng thái NV</span>
                                    <span className="truncate text-right">{translateMissionStatus(relatedMission?.status)}</span>
                                </div>
                            </button>
                        );
                    })}
                    {systemOrders.length === 0 && <p className="text-sm italic text-slate-400">Chưa có đơn hàng trong hệ thống.</p>}
                </div>
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Tạo đơn thủ công</h2>
                <div className="mt-3 space-y-3">
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
                            label="Pickup lat"
                            value={draftOrder.pickup ? draftOrder.pickup[0] : ''}
                            onChange={value => onDraftChange('pickup', value === '' ? null : [Number(value), draftOrder.pickup?.[1] ?? 105.8542] as [number, number])}
                        />
                        <NumberInput
                            label="Pickup lon"
                            value={draftOrder.pickup ? draftOrder.pickup[1] : ''}
                            onChange={value => onDraftChange('pickup', value === '' ? null : [draftOrder.pickup?.[0] ?? 21.0285, Number(value)] as [number, number])}
                        />
                    </div>
                    <button
                        onClick={() => onSetMapInteractionMode('select_pickup')}
                        className="w-full rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                    >
                        Chọn điểm lấy hàng trên bản đồ
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                        <NumberInput
                            label="Dropoff lat"
                            value={draftOrder.dropoff ? draftOrder.dropoff[0] : ''}
                            onChange={value => onDraftChange('dropoff', value === '' ? null : [Number(value), draftOrder.dropoff?.[1] ?? 105.8550] as [number, number])}
                        />
                        <NumberInput
                            label="Dropoff lon"
                            value={draftOrder.dropoff ? draftOrder.dropoff[1] : ''}
                            onChange={value => onDraftChange('dropoff', value === '' ? null : [draftOrder.dropoff?.[0] ?? 21.0290, Number(value)] as [number, number])}
                        />
                    </div>
                    <button
                        onClick={() => onSetMapInteractionMode('select_dropoff')}
                        className="w-full rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700 hover:bg-orange-100"
                    >
                        Chọn điểm giao hàng trên bản đồ
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                        <NumberInput label="Khối lượng kg" value={draftOrder.payloadKg} onChange={value => onDraftChange('payloadKg', Number(value || 0))} />
                        <label className="block text-xs font-semibold text-slate-600">
                            Ưu tiên
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
                    <NumberInput
                        label="Deadline timestamp (tuỳ chọn)"
                        value={draftOrder.deadlineTs ?? ''}
                        onChange={value => onDraftChange('deadlineTs', value === '' ? null : Number(value))}
                    />
                    <button
                        disabled={!canAddDraft}
                        onClick={onAddDraftOrder}
                        className="w-full rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                        Thêm vào danh sách nháp
                    </button>
                </div>
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Import JSON</h2>
                <textarea
                    value={jsonText}
                    onChange={event => setJsonText(event.target.value)}
                    rows={8}
                    placeholder={`[\n  {\n    "orderId": "order_1",\n    "pickup": [21.0285, 105.8542],\n    "dropoff": [21.0290, 105.8550],\n    "payloadKg": 1.2,\n    "priority": "normal"\n  }\n]`}
                    className="mt-3 w-full rounded border border-slate-300 bg-white px-2 py-2 font-mono text-xs text-slate-700"
                />
                {importError && <p className="mt-2 text-xs font-semibold text-red-600">{importError}</p>}
                <button
                    onClick={() => onImportJson(jsonText)}
                    className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                    Nạp JSON vào danh sách nháp
                </button>
            </section>

            <section className="rounded border border-slate-200 bg-white p-3">
                <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Danh sách nháp</h2>
                <div className="mt-2 space-y-2">
                    {draftOrders.map(order => (
                        <div key={order.orderId} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-slate-800">{order.orderId}</span>
                                <button onClick={() => onRemoveDraftOrder(order.orderId)} className="text-xs font-bold text-red-600">Xóa</button>
                            </div>
                            <p className="mt-1 text-slate-600">Lấy: {formatLatLng(order.pickup)}</p>
                            <p className="text-slate-600">Giao: {formatLatLng(order.dropoff)}</p>
                            <p className="text-slate-600">Tải: {order.payloadKg}kg / {translatePriority(order.priority)}</p>
                        </div>
                    ))}
                    {draftOrders.length === 0 && <p className="text-sm italic text-slate-400">Chưa có đơn nháp.</p>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                        disabled={!activeSimId || draftOrders.length === 0}
                        onClick={onSubmitDraftOrders}
                        className="rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                        Gửi thêm đơn hàng
                    </button>
                    <button
                        disabled={!activeSimId}
                        onClick={onDispatchOrders}
                        className="rounded bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                        Tự động phân công
                    </button>
                </div>
            </section>
        </div>
    );
}
