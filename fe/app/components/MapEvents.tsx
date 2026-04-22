import { useMapEvents } from 'react-leaflet';

export default function MapEvents({ onMapClick }: { onMapClick: (latlng: [number, number]) => void }) {
    useMapEvents({
        click(e) {
            onMapClick([e.latlng.lat, e.latlng.lng]);
        },
    });
    return null;
}
