'use client';

import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

const MIN_ZOOM = 13;
const MAX_ZOOM = 19;

export default function MapZoomSlider() {
    const map = useMap();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [zoom, setZoom] = useState(map.getZoom());

    useEffect(() => {
        if (containerRef.current) {
            L.DomEvent.disableClickPropagation(containerRef.current);
            L.DomEvent.disableScrollPropagation(containerRef.current);
        }
        const syncZoom = () => setZoom(map.getZoom());
        map.on('zoomend', syncZoom);
        syncZoom();
        return () => {
            map.off('zoomend', syncZoom);
        };
    }, [map]);

    const stopMapEvent = (event: SyntheticEvent) => {
        event.stopPropagation();
    };

    return (
        <div
            ref={containerRef}
            className="rounded border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm"
            style={{ touchAction: 'none' }}
            onPointerDown={stopMapEvent}
            onPointerMove={stopMapEvent}
            onPointerUp={stopMapEvent}
            onMouseDown={stopMapEvent}
            onMouseMove={stopMapEvent}
            onMouseUp={stopMapEvent}
            onClick={stopMapEvent}
            onDoubleClick={stopMapEvent}
            onTouchStart={stopMapEvent}
            onTouchMove={stopMapEvent}
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
                step={0.25}
                value={zoom}
                onPointerDown={stopMapEvent}
                onPointerMove={stopMapEvent}
                onPointerUp={stopMapEvent}
                onMouseDown={stopMapEvent}
                onMouseMove={stopMapEvent}
                onMouseUp={stopMapEvent}
                onTouchStart={stopMapEvent}
                onTouchMove={stopMapEvent}
                style={{ touchAction: 'none' }}
                onChange={event => {
                    const nextZoom = Number(event.target.value);
                    setZoom(nextZoom);
                    map.setZoom(nextZoom);
                }}
                className="w-32 accent-blue-600"
            />
        </div>
    );
}
