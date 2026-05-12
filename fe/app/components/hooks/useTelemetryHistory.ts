'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DroneTelemetry, DronesById, LatLng, PathHistoryByDrone } from '../types/simulation';

const MAX_HISTORY_POINTS_PER_DRONE = 160;
const MAX_SPARKLINE_POINTS = 120;
const MIN_HISTORY_POINT_DISTANCE_METERS = 2;
const TELEMETRY_HISTORY_SAMPLE_EVERY = 2;

function pushLimited<T>(items: T[], item: T, limit: number) {
    return [...items, item].slice(-limit);
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
    const sampleCounterByDroneRef = useRef<Record<string, number>>({});

    const resetHistory = useCallback(() => {
        lastStepByDroneRef.current = {};
        sampleCounterByDroneRef.current = {};
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

                const sampleCounter = (sampleCounterByDroneRef.current[droneId] ?? 0) + 1;
                sampleCounterByDroneRef.current[droneId] = sampleCounter;
                const shouldSampleSparkline = sampleCounter === 1 || sampleCounter % TELEMETRY_HISTORY_SAMPLE_EVERY === 0;

                const battery = droneState.batteryPercent ?? droneState.battery;
                if (shouldSampleSparkline && typeof battery === 'number') {
                    next.batteryHistoryByDrone[droneId] = pushLimited(next.batteryHistoryByDrone[droneId] ?? [], battery, MAX_SPARKLINE_POINTS);
                    changed = true;
                }
                if (shouldSampleSparkline && typeof droneState.temperature === 'number') {
                    next.temperatureHistoryByDrone[droneId] = pushLimited(next.temperatureHistoryByDrone[droneId] ?? [], droneState.temperature, MAX_SPARKLINE_POINTS);
                    changed = true;
                }
                if (shouldSampleSparkline && typeof droneState.altitude === 'number') {
                    next.altitudeHistoryByDrone[droneId] = pushLimited(next.altitudeHistoryByDrone[droneId] ?? [], droneState.altitude, MAX_SPARKLINE_POINTS);
                    changed = true;
                }
                if (droneState.pos) {
                    const pos = droneState.pos as LatLng;
                    const previousPath = next.pathHistoryByDrone[droneId] ?? [];
                    const lastPos = previousPath[previousPath.length - 1];
                    if (!lastPos || distanceMeters(lastPos, pos) >= MIN_HISTORY_POINT_DISTANCE_METERS) {
                        next.pathHistoryByDrone[droneId] = pushLimited(previousPath, pos, MAX_HISTORY_POINTS_PER_DRONE);
                        changed = true;
                    }
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
