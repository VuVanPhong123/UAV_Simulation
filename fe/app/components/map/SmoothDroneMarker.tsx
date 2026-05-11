'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PathOptions } from 'leaflet';
import type { DroneTelemetry, LatLng } from '../types/simulation';

const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });

const FALLBACK_ANIMATION_MS = 950;
const MIN_ANIMATION_MS = 600;
const MAX_ANIMATION_MS = 1800;
const TELEMETRY_BUFFER_MS = 100;
const SNAP_DISTANCE_METERS = 350;
const STILL_DISTANCE_METERS = 0.2;

type SmoothDroneMarkerProps = {
    droneId: string;
    drone: DroneTelemetry;
    selected: boolean;
    radius: number;
    pathOptions: PathOptions;
    battery: number | undefined;
    showSensorRange?: boolean;
    sensorRangeMeters?: number;
    sensorPathOptions?: PathOptions;
    markerPane?: string;
    sensorPane?: string;
    onSelect: (droneId: string) => void;
};

export const ALTITUDE_COLOR_BANDS = [
    { key: 'low', label: 'Thấp <30m', color: '#16a34a', halo: '#bbf7d0' },
    { key: 'medium', label: 'Trung bình 30-45m', color: '#2563eb', halo: '#bfdbfe' },
    { key: 'high', label: 'Cao 45-60m', color: '#ea580c', halo: '#fed7aa' },
    { key: 'very-high', label: 'Rất cao ≥60m', color: '#7e22ce', halo: '#ddd6fe' }
] as const;

export function getUavAltitudeColors(altitude?: number | null) {
    if (typeof altitude !== 'number' || !Number.isFinite(altitude)) {
        return { color: '#475569', halo: '#cbd5e1' };
    }
    if (altitude < 30) return ALTITUDE_COLOR_BANDS[0];
    if (altitude < 45) return ALTITUDE_COLOR_BANDS[1];
    if (altitude < 60) return ALTITUDE_COLOR_BANDS[2];
    return ALTITUDE_COLOR_BANDS[3];
}

function isValidLatLng(pos: LatLng | undefined): pos is LatLng {
    return Array.isArray(pos)
        && pos.length === 2
        && Number.isFinite(pos[0])
        && Number.isFinite(pos[1]);
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

function interpolateLatLng(from: LatLng, to: LatLng, t: number): LatLng {
    return [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t
    ];
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function shouldSnap(from: LatLng | null, to: LatLng, drone: DroneTelemetry) {
    if (!from) return true;
    if (distanceMeters(from, to) > SNAP_DISTANCE_METERS) return true;
    if (drone.status === 'idle' && !drone.currentOrderId && !drone.currentMissionId) return true;
    if (['failed', 'emergency_landing', 'stopped'].includes(String(drone.status))) return true;
    return false;
}

export default function SmoothDroneMarker({
    droneId,
    drone,
    selected,
    radius,
    pathOptions,
    battery,
    showSensorRange = false,
    sensorRangeMeters = 30,
    sensorPathOptions,
    markerPane,
    sensorPane,
    onSelect
}: SmoothDroneMarkerProps) {
    const initialPos = isValidLatLng(drone.pos) ? drone.pos : null;
    const [displayPos, setDisplayPos] = useState<LatLng | null>(initialPos);
    const [hovered, setHovered] = useState(false);
    const displayPosRef = useRef<LatLng | null>(initialPos);
    const animationRef = useRef<number | null>(null);
    const lastTargetUpdateAtRef = useRef<number | null>(null);
    const lastTargetKeyRef = useRef<string | null>(null);
    const targetKey = isValidLatLng(drone.pos) ? `${drone.pos[0]},${drone.pos[1]}` : 'none';

    useEffect(() => {
        return () => {
            if (animationRef.current !== null) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        if (!isValidLatLng(drone.pos)) {
            displayPosRef.current = null;
            setDisplayPos(null);
            return;
        }

        const targetPos = drone.pos;
        const startPos = displayPosRef.current;
        const now = performance.now();
        const targetChanged = lastTargetKeyRef.current !== targetKey;
        const intervalMs = targetChanged && lastTargetUpdateAtRef.current !== null
            ? now - lastTargetUpdateAtRef.current
            : null;
        const animationMs = intervalMs !== null
            ? clamp(intervalMs + TELEMETRY_BUFFER_MS, MIN_ANIMATION_MS, MAX_ANIMATION_MS)
            : FALLBACK_ANIMATION_MS;
        if (targetChanged) {
            lastTargetUpdateAtRef.current = now;
            lastTargetKeyRef.current = targetKey;
        }

        if (shouldSnap(startPos, targetPos, drone)) {
            displayPosRef.current = targetPos;
            setDisplayPos(targetPos);
            return;
        }

        if (!startPos) {
            displayPosRef.current = targetPos;
            setDisplayPos(targetPos);
            return;
        }

        if (distanceMeters(startPos, targetPos) <= STILL_DISTANCE_METERS) {
            displayPosRef.current = targetPos;
            setDisplayPos(targetPos);
            return;
        }

        const startedAt = now;
        const animate = (frameNow: number) => {
            const progress = Math.min((frameNow - startedAt) / animationMs, 1);
            const nextPos = interpolateLatLng(startPos, targetPos, progress);
            displayPosRef.current = nextPos;
            setDisplayPos(nextPos);

            if (progress < 1) {
                animationRef.current = requestAnimationFrame(animate);
                return;
            }

            displayPosRef.current = targetPos;
            setDisplayPos(targetPos);
            animationRef.current = null;
        };

        animationRef.current = requestAnimationFrame(animate);
    }, [droneId, targetKey, drone.status, drone.currentOrderId, drone.currentMissionId]);

    if (!displayPos) return null;

    const active = selected || hovered;
    const markerRadius = active ? Math.max(radius + 4, 11) : radius;
    const altitudeText = typeof drone.altitude === 'number' && Number.isFinite(drone.altitude)
        ? `${drone.altitude.toFixed(0)}m`
        : '--';

    return (
        <>
            {showSensorRange && selected && (
                <Circle
                    center={displayPos}
                    radius={sensorRangeMeters}
                    interactive={false}
                    pane={sensorPane}
                    pathOptions={sensorPathOptions}
                />
            )}
            <CircleMarker
                center={displayPos}
                radius={markerRadius}
                pane={markerPane}
                eventHandlers={{
                    click: () => onSelect(droneId),
                    mouseover: () => setHovered(true),
                    mouseout: () => setHovered(false)
                }}
                pathOptions={{
                    ...pathOptions,
                    weight: active ? 4 : pathOptions.weight,
                    className: 'cursor-pointer'
                }}
            >
                <Tooltip permanent={active} direction="bottom" className="building-label">
                    {droneId} / {drone.status ?? '--'} / {typeof battery === 'number' ? `${battery.toFixed(0)}%` : '--'} / {altitudeText}
                </Tooltip>
            </CircleMarker>
        </>
    );
}
