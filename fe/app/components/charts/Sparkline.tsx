'use client';

type SparklineProps = {
    values: number[];
    height?: number;
    stroke?: string;
    label?: string;
};

export default function Sparkline({ values, height = 36, stroke = '#2563eb', label }: SparklineProps) {
    const width = 160;
    const cleanValues = values.filter(value => Number.isFinite(value));

    if (cleanValues.length === 0) {
        return (
            <div className="flex h-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-400">
                {label ?? 'No data'}
            </div>
        );
    }

    if (cleanValues.length === 1) {
        return (
            <div className="flex h-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                Hiện tại: {cleanValues[0].toFixed(1)}
            </div>
        );
    }

    const min = Math.min(...cleanValues);
    const max = Math.max(...cleanValues);
    const span = max - min || 1;
    const step = width / (cleanValues.length - 1);
    const points = cleanValues.map((value, idx) => {
        const x = idx * step;
        const y = height - ((value - min) / span) * (height - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-full rounded border border-slate-200 bg-slate-50">
            <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
