'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

type MapResizeControllerProps = {
    resizeKey?: string | number | boolean;
};

export default function MapResizeController({ resizeKey }: MapResizeControllerProps) {
    const map = useMap();

    useEffect(() => {
        map.invalidateSize();

        const frame = window.requestAnimationFrame(() => {
            map.invalidateSize();
        });
        const timer = window.setTimeout(() => {
            map.invalidateSize();
        }, 250);

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
    }, [map, resizeKey]);

    return null;
}
