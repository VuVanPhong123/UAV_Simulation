'use client'
import dynamic from 'next/dynamic';

const MapDashboard = dynamic(() => import('./components/MapDashboard'), { 
  ssr: false,
  loading: () => <div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white">Đang tải bản đồ...</div>
});

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden">
      <MapDashboard />
    </main>
  );
}