'use client';

import { useState } from 'react';
import type { DroneConfigOverride, DroneConfigsById } from '../types/simulation';
import { ActionStatusMessage, MiniSpinner } from '../ui/ActionStatus';

type DroneConfigPanelProps = {
    selectedDroneId: string | null;
    activeSimId: string | null;
    droneIds: string[];
    droneConfigs: DroneConfigsById;
    applyStatus: 'idle' | 'loading' | 'success' | 'error';
    onApply: (droneId: string, config: DroneConfigOverride) => void;
    onClearConfig: (droneId: string) => void;
};

type FieldDef = {
    key: keyof DroneConfigOverride;
    label: string;
    min: number;
    max: number;
    step: number;
    placeholder: string;
};

const FIELDS: FieldDef[] = [
    { key: 'max_battery', label: 'Max battery (%)', min: 1, max: 500, step: 1, placeholder: '100' },
    { key: 'discharge_rate_base', label: 'Discharge rate base (%/s)', min: 0.001, max: 10, step: 0.001, placeholder: '0.05' },
    { key: 'discharge_rate_climb', label: 'Discharge rate climb (%/s)', min: 0.001, max: 50, step: 0.001, placeholder: '1.2' },
    { key: 'speed', label: 'Speed (m/s)', min: 0.1, max: 100, step: 0.1, placeholder: '20' },
    { key: 'battery_low_threshold', label: 'Battery low threshold (%)', min: 1, max: 99, step: 1, placeholder: '30' },
    { key: 'battery_safe_target', label: 'Battery safe target (%)', min: 1, max: 100, step: 1, placeholder: '80' },
    { key: 'recharge_rate', label: 'Recharge rate (%/s)', min: 0.1, max: 100, step: 0.1, placeholder: '10' },
    { key: 'max_altitude', label: 'Max altitude (m)', min: 1, max: 500, step: 1, placeholder: '50' },
    { key: 'min_altitude', label: 'Min altitude (m)', min: 1, max: 100, step: 1, placeholder: '5' },
    { key: 'normal_altitude', label: 'Normal altitude (m)', min: 1, max: 200, step: 1, placeholder: '20' },
    { key: 'payload_weight', label: 'Payload weight (kg)', min: 0, max: 50, step: 0.1, placeholder: '2.5' },
    { key: 'payload_penalty', label: 'Payload penalty (per kg)', min: 0, max: 10, step: 0.001, placeholder: '0.05' },
];

type FieldValues = Partial<Record<keyof DroneConfigOverride, string>>;

function configToFieldValues(config: DroneConfigOverride): FieldValues {
    const out: FieldValues = {};
    for (const field of FIELDS) {
        const val = config[field.key];
        if (val !== undefined) {
            out[field.key] = String(val);
        }
    }
    return out;
}

function fieldValuesToConfig(values: FieldValues): DroneConfigOverride {
    const config: DroneConfigOverride = {};
    for (const field of FIELDS) {
        const raw = values[field.key];
        if (raw === undefined || raw.trim() === '') continue;
        const num = Number(raw);
        if (Number.isFinite(num)) {
            (config as Record<string, number>)[field.key] = num;
        }
    }
    return config;
}

type FieldEditorProps = {
    droneId: string;
    isMidSim: boolean;
    initialValues: FieldValues;
    hasStoredConfig: boolean;
    applyStatus: 'idle' | 'loading' | 'success' | 'error';
    onApply: (droneId: string, config: DroneConfigOverride) => void;
    onClear: (droneId: string) => void;
};

function FieldEditor({ droneId, isMidSim, initialValues, hasStoredConfig, applyStatus, onApply, onClear }: FieldEditorProps) {
    const [fieldValues, setFieldValues] = useState<FieldValues>(initialValues);

    const handleFieldChange = (key: keyof DroneConfigOverride, value: string) => {
        setFieldValues(prev => ({ ...prev, [key]: value }));
    };

    const hasValues = Object.values(fieldValues).some(v => v !== undefined && v.trim() !== '');
    const isApplyDisabled = applyStatus === 'loading' || !hasValues;

    return (
        <>
            <div className="grid grid-cols-1 gap-2">
                {FIELDS.map(field => (
                    <label key={field.key} className="block text-xs font-semibold text-slate-600">
                        {field.label}
                        <input
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            placeholder={field.placeholder}
                            value={fieldValues[field.key] ?? ''}
                            onChange={e => handleFieldChange(field.key, e.target.value)}
                            className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                    </label>
                ))}
            </div>
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={isApplyDisabled}
                    onClick={() => onApply(droneId, fieldValuesToConfig(fieldValues))}
                    className="flex-1 cursor-pointer rounded bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                    <span className="inline-flex items-center justify-center gap-2">
                        {applyStatus === 'loading' && <MiniSpinner />}
                        {isMidSim ? 'Apply' : 'Stage'}
                    </span>
                </button>
                {(hasValues || hasStoredConfig) && (
                    <button
                        type="button"
                        onClick={() => { setFieldValues({}); onClear(droneId); }}
                        className="cursor-pointer rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                    >
                        Clear
                    </button>
                )}
            </div>
            {applyStatus === 'success' && (
                <ActionStatusMessage tone="success">
                    {isMidSim ? 'Config applied to drone.' : 'Config staged for simulation start.'}
                </ActionStatusMessage>
            )}
            {applyStatus === 'error' && (
                <ActionStatusMessage tone="error">Failed to apply config.</ActionStatusMessage>
            )}
        </>
    );
}

export default function DroneConfigPanel({
    selectedDroneId,
    activeSimId,
    droneIds,
    droneConfigs,
    applyStatus,
    onApply,
    onClearConfig
}: DroneConfigPanelProps) {
    const [localDroneId, setLocalDroneId] = useState<string>('');

    const effectiveDroneId = activeSimId
        ? selectedDroneId
        : (localDroneId || droneIds[0] || '');

    const storedConfig = effectiveDroneId ? droneConfigs[effectiveDroneId] : undefined;
    const hasStoredConfig = Boolean(storedConfig && Object.keys(storedConfig).length > 0);

    return (
        <section className="rounded border border-slate-200 bg-white p-3">
            <h2 className="border-b border-slate-100 pb-2 text-xs font-bold uppercase text-slate-500">
                Cấu hình UAV
            </h2>
            <div className="mt-3 space-y-3">
                {!activeSimId && (
                    <div>
                        <label className="block text-xs font-semibold text-slate-600">
                            UAV
                            <select
                                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                value={effectiveDroneId ?? ''}
                                onChange={e => setLocalDroneId(e.target.value)}
                            >
                                {droneIds.length === 0 && (
                                    <option value="">-- no drones --</option>
                                )}
                                {droneIds.map(id => (
                                    <option key={id} value={id}>{id}</option>
                                ))}
                            </select>
                        </label>
                        {hasStoredConfig && (
                            <p className="mt-1 text-[11px] font-semibold text-emerald-600">
                                Config staged for {effectiveDroneId}
                            </p>
                        )}
                    </div>
                )}

                {activeSimId && selectedDroneId && (
                    <p className="text-xs font-semibold text-slate-600">
                        UAV: <span className="font-mono font-bold text-slate-800">{selectedDroneId}</span>
                    </p>
                )}

                {activeSimId && !selectedDroneId && (
                    <ActionStatusMessage tone="info">Select a drone to configure it.</ActionStatusMessage>
                )}

                {(!activeSimId || selectedDroneId) && effectiveDroneId && (
                    <FieldEditor
                        key={effectiveDroneId}
                        droneId={effectiveDroneId}
                        isMidSim={Boolean(activeSimId)}
                        initialValues={storedConfig ? configToFieldValues(storedConfig) : {}}
                        hasStoredConfig={hasStoredConfig}
                        applyStatus={applyStatus}
                        onApply={onApply}
                        onClear={onClearConfig}
                    />
                )}

                {!activeSimId && (
                    <p className="text-[11px] text-slate-400">
                        Staged configs will be sent when the simulation starts.
                    </p>
                )}
            </div>
        </section>
    );
}
