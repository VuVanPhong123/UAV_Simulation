'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PathOptions } from 'leaflet';
import type { DroneTelemetry, LatLng } from '../types/simulation';

const CircleMarker = dynamic(() => import('react-leaflet').then(mod => mod.CircleMarker), { ssr: false });
const Tooltip = dynamic(() => import('react-leaflet').then(mod => mod.Tooltip), { ssr: false });

const ANIMATION_MS = 700;
const SNAP_DISTANCE_METERS = 200;
const STILL_DISTANCE_METERS = 0.2;

type SmoothDroneMarkerProps = {
    droneId: string;
    drone: DroneTelemetry;
    selected: boolean;
    radius: number;
    pathOptions: PathOptions;
    battery: number | undefined;
    onSelect: (droneId: string) => void;
};

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

function easeOutCubic(t: number) {
    return 1 - (1 - t) ** 3;
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
    onSelect
}: SmoothDroneMarkerProps) {
    const initialPos = isValidLatLng(drone.pos) ? drone.pos : null;
    const [displayPos, setDisplayPos] = useState<LatLng | null>(initialPos);
    const displayPosRef = useRef<LatLng | null>(initialPos);
    const animationRef = useRef<number | null>(null);
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

        const startedAt = performance.now();
        const animate = (now: number) => {
            const progress = Math.min((now - startedAt) / ANIMATION_MS, 1);
            const nextPos = interpolateLatLng(startPos, targetPos, easeOutCubic(progress));
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

    return (
        <CircleMarker
            center={displayPos}
            radius={radius}
            eventHandlers={{ click: () => onSelect(droneId) }}
            pathOptions={pathOptions}
        >
            <Tooltip permanent={selected} direction="bottom" className="building-label">
                {droneId} / {drone.status ?? '--'} / {typeof battery === 'number' ? `${battery.toFixed(0)}%` : '--'}
            </Tooltip>
        </CircleMarker>
    );
}
