'use client';

import { useMemo } from 'react';

type WindOverlayProps = {
    windDir: number;
    windSpeed: number;
};

export default function WindOverlay({ windDir, windSpeed }: WindOverlayProps) {
    const streaks = useMemo(() => {
        if (windSpeed <= 0) return [];
        return Array.from({ length: 42 }).map((_, idx) => {
            const duration = 18 / (windSpeed + 1) + (idx % 5) * 0.15;
            return {
                id: idx,
                top: `${(idx * 23) % 100}%`,
                left: `${(idx * 37) % 100}%`,
                width: `${70 + (idx % 6) * 18}px`,
                duration: `${duration}s`,
                delay: `${(idx % 7) * 0.08}s`
            };
        });
    }, [windSpeed]);

    if (streaks.length === 0) return null;

    return (
        <div
            className="pointer-events-none absolute inset-0 z-[400] overflow-hidden"
            style={{
                transform: `rotate(${-windDir}deg) scale(2)`,
                transformOrigin: 'center center'
            }}
        >
            {streaks.map(streak => (
                <div
                    key={streak.id}
                    className="absolute h-[1.5px] rounded-full bg-slate-400/70"
                    style={{
                        top: streak.top,
                        left: streak.left,
                        width: streak.width,
                        animationName: 'wind-blow',
                        animationDuration: streak.duration,
                        animationTimingFunction: 'linear',
                        animationIterationCount: 'infinite',
                        animationDelay: streak.delay
                    }}
                />
            ))}
        </div>
    );
}
