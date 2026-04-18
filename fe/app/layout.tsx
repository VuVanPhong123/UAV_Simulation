import './globals.css';
import 'leaflet/dist/leaflet.css';

export const metadata = {
  title: 'UAV Delivery GCS',
  description: 'Hệ thống điều khiển drone thời gian thực',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}