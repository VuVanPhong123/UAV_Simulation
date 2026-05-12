'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

const MIN_ZOOM = 13;
const MAX_ZOOM = 19;
const ZOOM_STEP = 0.25;

export default function MapZoomSlider() {
    const map = useMap();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const draggingRef = useRef(false);
    const pendingZoomRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);
    const [zoom, setZoom] = useState(map.getZoom());

    useEffect(() => {
        if (containerRef.current) {
            L.DomEvent.disableClickPropagation(containerRef.current);
            L.DomEvent.disableScrollPropagation(containerRef.current);
        }
        const syncZoom = () => {
            if (!draggingRef.current) {
                setZoom(map.getZoom());
            }
        };
        map.on('zoom', syncZoom);
        map.on('zoomend', syncZoom);
        syncZoom();
        return () => {
            map.off('zoom', syncZoom);
            map.off('zoomend', syncZoom);
            if (rafRef.current !== null) {
                window.cancelAnimationFrame(rafRef.current);
            }
        };
    }, [map]);

    const stopMapEvent = (event: SyntheticEvent) => {
        event.stopPropagation();
    };

    const applyZoom = (nextZoom: number) => {
        const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
        setZoom(clamped);
        pendingZoomRef.current = clamped;
        if (rafRef.current !== null) {
            window.cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = window.requestAnimationFrame(() => {
            rafRef.current = null;
            map.setZoom(clamped, { animate: false });
        });
    };

    const beginInteraction = (event: SyntheticEvent) => {
        draggingRef.current = true;
        stopMapEvent(event);
    };

    const endInteraction = (event: SyntheticEvent) => {
        stopMapEvent(event);
        if (!draggingRef.current && pendingZoomRef.current === null) return;
        draggingRef.current = false;
        const finalZoom = pendingZoomRef.current ?? zoom;
        pendingZoomRef.current = null;
        if (rafRef.current !== null) {
            window.cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        map.setZoom(finalZoom, { animate: false });
        window.setTimeout(() => setZoom(map.getZoom()), 0);
    };

    return (
        <div
            ref={containerRef}
            className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm"
            style={{ touchAction: 'none' }}
            onPointerDown={beginInteraction}
            onPointerMove={stopMapEvent}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            onMouseDown={beginInteraction}
            onMouseMove={stopMapEvent}
            onMouseUp={endInteraction}
            onMouseLeave={endInteraction}
            onClick={stopMapEvent}
            onDoubleClick={stopMapEvent}
            onTouchStart={beginInteraction}
            onTouchMove={stopMapEvent}
            onTouchEnd={endInteraction}
            onTouchCancel={endInteraction}
            onWheel={stopMapEvent}
        >
            <div className="mb-1 flex items-center justify-between gap-3">
                <span>Zoom</span>
                <span className="font-mono">{zoom.toFixed(2)}</span>
            </div>
            <input
                aria-label="Zoom"
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={zoom}
                onPointerDown={beginInteraction}
                onPointerMove={stopMapEvent}
                onPointerUp={endInteraction}
                onPointerCancel={endInteraction}
                onMouseDown={beginInteraction}
                onMouseMove={stopMapEvent}
                onMouseUp={endInteraction}
                onTouchStart={beginInteraction}
                onTouchMove={stopMapEvent}
                onTouchEnd={endInteraction}
                onTouchCancel={endInteraction}
                onBlur={endInteraction}
                style={{ touchAction: 'none' }}
                onInput={event => {
                    applyZoom(Number(event.currentTarget.value));
                }}
                onChange={event => {
                    applyZoom(Number(event.currentTarget.value));
                }}
                className="w-32 cursor-pointer accent-blue-600"
            />
        </div>
    );
}
