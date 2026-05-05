'use client';

import type { ReactNode } from 'react';
import type { ServerStatus, SimulationStatus, WorkerStatus } from '../types/simulation';

type ControlPanelProps = {
    serverStatus: ServerStatus;
    workerStatus: WorkerStatus;
    simulationStatus: SimulationStatus;
    activeSimId: string | null;
    droneCount: number;
    onDroneCountChange: (value: number) => void;
    onStart: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onReset: () => void;
};

function Button({
    children,
    disabled,
    onClick,
    variant = 'default'
}: {
    children: ReactNode;
    disabled?: boolean;
    onClick: () => void;
    variant?: 'primary' | 'default' | 'danger';
}) {
    const classes = variant === 'primary'
        ? 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500'
        : variant === 'danger'
            ? 'bg-red-50 text-red-700 hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400';
    return (
        <button
            disabled={disabled}
            onClick={onClick}
            className={`rounded border border-transparent px-3 py-2 text-xs font-bold transition-colors ${classes}`}
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
    onDroneCountChange,
    onStart,
    onPause,
    onResume,
    onStop,
    onReset
}: ControlPanelProps) {
    const startDisabled = serverStatus !== 'connected' || workerStatus !== 'idle' || simulationStatus === 'running';
    const pauseDisabled = simulationStatus !== 'running';
    const resumeDisabled = simulationStatus !== 'paused';
    const commandDisabled = !activeSimId;

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">Controls</h2>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
                Drone count: {droneCount}
                <input
                    className="mt-1 w-full"
                    type="range"
                    min="1"
                    max="5"
                    value={droneCount}
                    disabled={Boolean(activeSimId)}
                    onChange={event => onDroneCountChange(Number(event.target.value))}
                />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="primary" disabled={startDisabled} onClick={onStart}>Start</Button>
                <Button disabled={pauseDisabled} onClick={onPause}>Pause</Button>
                <Button disabled={resumeDisabled} onClick={onResume}>Resume</Button>
                <Button disabled={commandDisabled} onClick={onReset}>Reset</Button>
                <div className="col-span-2">
                    <Button variant="danger" disabled={commandDisabled} onClick={onStop}>Stop</Button>
                </div>
            </div>
        </section>
    );
}
