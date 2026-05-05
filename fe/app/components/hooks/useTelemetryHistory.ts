'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DroneTelemetry, LatLng } from '../types/simulation';

const MAX_HISTORY = 300;

function pushLimited<T>(items: T[], item: T) {
    return [...items, item].slice(-MAX_HISTORY);
}

export function useTelemetryHistory(droneState: DroneTelemetry | null) {
    const [batteryHistory, setBatteryHistory] = useState<number[]>([]);
    const [temperatureHistory, setTemperatureHistory] = useState<number[]>([]);
    const [altitudeHistory, setAltitudeHistory] = useState<number[]>([]);
    const [pathHistory, setPathHistory] = useState<LatLng[]>([]);

    const resetHistory = useCallback(() => {
        setBatteryHistory([]);
        setTemperatureHistory([]);
        setAltitudeHistory([]);
        setPathHistory([]);
    }, []);

    useEffect(() => {
        if (!droneState) return;

        const battery = droneState.batteryPercent ?? droneState.battery;
        if (typeof battery === 'number') {
            setBatteryHistory(prev => pushLimited(prev, battery));
        }
        if (typeof droneState.temperature === 'number') {
            const temperature = droneState.temperature;
            setTemperatureHistory(prev => pushLimited(prev, temperature));
        }
        if (typeof droneState.altitude === 'number') {
            const altitude = droneState.altitude;
            setAltitudeHistory(prev => pushLimited(prev, altitude));
        }
        if (droneState.pos) {
            setPathHistory(prev => pushLimited(prev, droneState.pos as LatLng));
        }
    }, [droneState]);

    return {
        batteryHistory,
        temperatureHistory,
        altitudeHistory,
        pathHistory,
        resetHistory
    };
}
