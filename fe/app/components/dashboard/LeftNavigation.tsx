'use client';

import type { ActiveDashboardSection } from '../types/simulation';

type LeftNavigationProps = {
    activeSection: ActiveDashboardSection;
    onChange: (section: ActiveDashboardSection) => void;
};

const items: Array<{ key: ActiveDashboardSection; label: string; short: string }> = [
    { key: 'overview', label: 'Tổng quan', short: 'TQ' },
    { key: 'orders', label: 'Đơn hàng', short: 'ĐH' },
    { key: 'drones', label: 'UAV', short: 'UV' },
    { key: 'environment', label: 'Môi trường', short: 'MT' },
    { key: 'map_tools', label: 'Bản đồ', short: 'BĐ' },
    { key: 'events', label: 'Sự kiện', short: 'SK' }
];

export default function LeftNavigation({ activeSection, onChange }: LeftNavigationProps) {
    return (
        <nav className="flex w-20 shrink-0 flex-col items-stretch gap-2 border-r border-slate-200 bg-white p-2">
            {items.map(item => {
                const active = item.key === activeSection;
                return (
                    <button
                        key={item.key}
                        data-testid={item.key === 'environment' ? 'nav-environment' : item.key === 'map_tools' ? 'nav-map-tools' : undefined}
                        onClick={() => onChange(item.key)}
                        className={`rounded border px-1 py-2 text-center transition-colors ${
                            active
                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                : 'border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                        title={item.label}
                    >
                        <span className="block font-mono text-xs font-bold">{item.short}</span>
                        <span className="mt-1 block text-[10px] font-semibold leading-tight">{item.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
