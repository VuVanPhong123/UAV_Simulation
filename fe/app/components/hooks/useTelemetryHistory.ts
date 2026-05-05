'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DroneTelemetry, DronesById, LatLng, PathHistoryByDrone } from '../types/simulation';

const MAX_HISTORY = 300;

function pushLimited<T>(items: T[], item: T) {
    return [...items, item].slice(-MAX_HISTORY);
}

type NumberHistoryByDrone = Record<string, number[]>;

function updateNumberHistory(items: NumberHistoryByDrone, droneId: string, value: number) {
    return {
        ...items,
        [droneId]: pushLimited(items[droneId] ?? [], value)
    };
}

function updatePathHistory(items: PathHistoryByDrone, droneId: string, value: LatLng) {
    return {
        ...items,
        [droneId]: pushLimited(items[droneId] ?? [], value)
    };
}

export function useTelemetryHistory(drones: DronesById, selectedDroneId: string | null) {
    const [batteryHistoryByDrone, setBatteryHistoryByDrone] = useState<NumberHistoryByDrone>({});
    const [temperatureHistoryByDrone, setTemperatureHistoryByDrone] = useState<NumberHistoryByDrone>({});
    const [altitudeHistoryByDrone, setAltitudeHistoryByDrone] = useState<NumberHistoryByDrone>({});
    const [pathHistoryByDrone, setPathHistoryByDrone] = useState<PathHistoryByDrone>({});

    const resetHistory = useCallback(() => {
        setBatteryHistoryByDrone({});
        setTemperatureHistoryByDrone({});
        setAltitudeHistoryByDrone({});
        setPathHistoryByDrone({});
    }, []);

    useEffect(() => {
        Object.values(drones).forEach((droneState: DroneTelemetry) => {
            const droneId = droneState.droneId ?? 'drone_1';
            const battery = droneState.batteryPercent ?? droneState.battery;
            if (typeof battery === 'number') {
                setBatteryHistoryByDrone(prev => updateNumberHistory(prev, droneId, battery));
            }
            if (typeof droneState.temperature === 'number') {
                const temperature = droneState.temperature;
                setTemperatureHistoryByDrone(prev => updateNumberHistory(prev, droneId, temperature));
            }
            if (typeof droneState.altitude === 'number') {
                const altitude = droneState.altitude;
                setAltitudeHistoryByDrone(prev => updateNumberHistory(prev, droneId, altitude));
            }
            if (droneState.pos) {
                setPathHistoryByDrone(prev => updatePathHistory(prev, droneId, droneState.pos as LatLng));
            }
        });
    }, [drones]);

    const selectedId = selectedDroneId ?? '';

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
