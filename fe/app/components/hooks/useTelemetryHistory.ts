'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DroneTelemetry, DronesById, LatLng, PathHistoryByDrone } from '../types/simulation';

const MAX_HISTORY = 120;

function pushLimited<T>(items: T[], item: T) {
    return [...items, item].slice(-MAX_HISTORY);
}

type NumberHistoryByDrone = Record<string, number[]>;

type TelemetryHistories = {
    batteryHistoryByDrone: NumberHistoryByDrone;
    temperatureHistoryByDrone: NumberHistoryByDrone;
    altitudeHistoryByDrone: NumberHistoryByDrone;
    pathHistoryByDrone: PathHistoryByDrone;
};

const EMPTY_HISTORIES: TelemetryHistories = {
    batteryHistoryByDrone: {},
    temperatureHistoryByDrone: {},
    altitudeHistoryByDrone: {},
    pathHistoryByDrone: {}
};

export function useTelemetryHistory(drones: DronesById, selectedDroneId: string | null) {
    const [histories, setHistories] = useState<TelemetryHistories>(EMPTY_HISTORIES);
    const lastStepByDroneRef = useRef<Record<string, number>>({});

    const resetHistory = useCallback(() => {
        lastStepByDroneRef.current = {};
        setHistories(EMPTY_HISTORIES);
    }, []);

    useEffect(() => {
        const droneStates = Object.values(drones);
        if (droneStates.length === 0) return;

        setHistories(prev => {
            let changed = false;
            const next: TelemetryHistories = {
                batteryHistoryByDrone: { ...prev.batteryHistoryByDrone },
                temperatureHistoryByDrone: { ...prev.temperatureHistoryByDrone },
                altitudeHistoryByDrone: { ...prev.altitudeHistoryByDrone },
                pathHistoryByDrone: { ...prev.pathHistoryByDrone }
            };

            droneStates.forEach((droneState: DroneTelemetry) => {
                const droneId = droneState.droneId ?? 'drone_1';
                if (
                    typeof droneState.step === 'number'
                    && lastStepByDroneRef.current[droneId] === droneState.step
                ) {
                    return;
                }
                if (typeof droneState.step === 'number') {
                    lastStepByDroneRef.current[droneId] = droneState.step;
                }

                const battery = droneState.batteryPercent ?? droneState.battery;
                if (typeof battery === 'number') {
                    next.batteryHistoryByDrone[droneId] = pushLimited(next.batteryHistoryByDrone[droneId] ?? [], battery);
                    changed = true;
                }
                if (typeof droneState.temperature === 'number') {
                    next.temperatureHistoryByDrone[droneId] = pushLimited(next.temperatureHistoryByDrone[droneId] ?? [], droneState.temperature);
                    changed = true;
                }
                if (typeof droneState.altitude === 'number') {
                    next.altitudeHistoryByDrone[droneId] = pushLimited(next.altitudeHistoryByDrone[droneId] ?? [], droneState.altitude);
                    changed = true;
                }
                if (droneState.pos) {
                    next.pathHistoryByDrone[droneId] = pushLimited(next.pathHistoryByDrone[droneId] ?? [], droneState.pos as LatLng);
                    changed = true;
                }
            });

            return changed ? next : prev;
        });
    }, [drones]);

    const selectedId = selectedDroneId ?? '';
    const {
        batteryHistoryByDrone,
        temperatureHistoryByDrone,
        altitudeHistoryByDrone,
        pathHistoryByDrone
    } = histories;

    return {
        batteryHistoryByDrone,
        temperatureHistoryByDrone,
        altitudeHistoryByDrone,
        pathHistoryByDrone,
        batteryHistory: batteryHistoryByDrone[selectedId] ?? [],
        temperatureHistory: temperatureHistoryByDrone[selectedId] ?? [],
        altitudeHistory: altitudeHistoryByDrone[selectedId] ?? [],
        pathHistory: pathHistoryByDrone[selectedId] ?? [],
        resetHistory
    };
}
