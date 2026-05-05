'use client';

import { useMapEvents } from 'react-leaflet';
import type { LatLng } from '../types/simulation';

export default function MapEvents({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
    useMapEvents({
        click(e) {
            onMapClick([e.latlng.lat, e.latlng.lng]);
        }
    });
    return null;
}
