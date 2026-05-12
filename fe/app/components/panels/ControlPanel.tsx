'use client';

import type { ReactNode } from 'react';
import { MAX_DEMO_DRONE_COUNT } from '../types/simulation';
import type { ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';
import { ActionStatusMessage } from '../ui/ActionStatus';

type ControlPanelProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    droneCount: number;
    canStartWithOrders?: boolean;
    startHint?: string;
    isStartingSimulation?: boolean;
    isAwaitingConfig?: boolean;
    isAwaitingFirstTelemetry?: boolean;
    onDroneCountChange?: (value: number) => void;
    onStart: () => boolean | void;
    onPause: () => boolean | void;
    onResume: () => boolean | void;
    onStop?: () => boolean | void;
    onReset: () => boolean | void;
    onOpenOrderModal?: () => void;
};

function Button({
    children,
    disabled,
    onClick,
    variant = 'default',
    testId
}: {
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
    variant?: 'primary' | 'default' | 'danger';
    testId?: string;
}) {
    const classes = variant === 'primary'
        ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500'
        : variant === 'danger'
            ? 'bg-red-50 text-red-700 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400';
    return (
        <button
            data-testid={testId}
            disabled={disabled}
            onClick={onClick}
            className={`cursor-pointer rounded border border-transparent px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed ${classes}`}
        >
            {children}
        </button>
    );
}

export default function ControlPanel({
    serverStatus,
    workerStatus,
    simulationStatus,
    activeSimId,
    droneCount,
    canStartWithOrders = true,
    startHint,
    isStartingSimulation = false,
    isAwaitingConfig = false,
    isAwaitingFirstTelemetry = false,
    onStart,
    onPause,
    onResume,
    onStop,
    onReset,
    onDroneCountChange,
    onOpenOrderModal
}: ControlPanelProps) {
    const startDisabled = serverStatus !== 'connected' || workerStatus !== 'idle' || simulationStatus === 'running' || !canStartWithOrders || isStartingSimulation;
    const pauseDisabled = simulationStatus !== 'running';
    const resumeDisabled = simulationStatus !== 'paused';
    const commandDisabled = !activeSimId;
    const waitingMessage = isStartingSimulation
        ? 'Đang khởi động mô phỏng...'
        : isAwaitingConfig
            ? 'Đang tải cấu hình bản đồ/mô phỏng...'
            : isAwaitingFirstTelemetry
                ? 'Đang chờ telemetry đầu tiên...'
                : null;

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Điều khiển mô phỏng</h2>
            <label className="mt-3 block text-xs font-semibold text-slate-500">
                Số UAV demo
                <input
                    value={droneCount}
                    min={1}
                    max={MAX_DEMO_DRONE_COUNT}
                    type="number"
                    disabled={simulationStatus === 'running'}
                    onChange={event => onDroneCountChange?.(Number(event.target.value))}
                    className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                />
            </label>
            <p className="mt-1 text-[11px] font-semibold text-slate-400">Tối đa {MAX_DEMO_DRONE_COUNT} UAV.</p>
            {onOpenOrderModal && (
                <button
                    data-testid="open-order-modal"
                    onClick={onOpenOrderModal}
                    className="mt-3 w-full cursor-pointer rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                    Đơn hàng
                </button>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="primary" disabled={startDisabled} onClick={onStart}>Bắt đầu</Button>
                <Button disabled={pauseDisabled} onClick={onPause}>Tạm dừng</Button>
                <Button disabled={resumeDisabled} onClick={onResume}>Tiếp tục</Button>
                <Button disabled={commandDisabled} onClick={onReset}>Đặt lại</Button>
            </div>
            {waitingMessage && (
                <div className="mt-2">
                    <ActionStatusMessage tone="loading">{waitingMessage}</ActionStatusMessage>
                </div>
            )}
            {startDisabled && startHint && (
                <p className="mt-2 text-xs font-semibold text-amber-700">{startHint}</p>
            )}
        </section>
    );
}
