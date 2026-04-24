import React, { useMemo } from 'react';

interface WindOverlayProps {
    windDir: number;
    windSpeed: number;
}

export default function WindOverlay({ windDir, windSpeed }: WindOverlayProps) {
    if (windSpeed === 0) return null;

    const streaks = useMemo(() => {
        return Array.from({ length: 50 }).map((_, i) => {
            const baseDuration = 20 / (windSpeed + 1);
            const duration = baseDuration + Math.random() * 2;
            const delay = Math.random() * 5;
            
            return {
                id: i,
                top: `${Math.random() * 100}%`,
                left: `${Math.random() * 100}%`,
                width: `${80 + Math.random() * 100}px`,
                duration: `${duration}s`,
                delay: `${delay}s`
            };
        });
    }, [windSpeed]);

    return (
        <div 
            className="absolute inset-0 pointer-events-none z-[400] overflow-hidden"
            style={{ 
                transform: `rotate(${-windDir}deg) scale(2)`, 
                transformOrigin: 'center center' 
            }}
        >
            {streaks.map(s => (
                <div
                    key={s.id}
                    className="absolute bg-gradient-to-r from-transparent via-slate-400/90 to-transparent h-[1.5px] rounded-full"
                    style={{
                        top: s.top,
                        left: s.left,
                        width: s.width,
                        animation: `wind-blow ${s.duration} linear infinite`,
                        animationDelay: s.delay
                    }}
                />
            ))}
        </div>
    );
}
