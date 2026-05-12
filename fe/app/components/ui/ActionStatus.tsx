'use client';

import type { ReactNode } from 'react';

export type ActionStatusTone = 'info' | 'success' | 'warning' | 'error' | 'loading';

const toneClasses: Record<ActionStatusTone, string> = {
    info: 'border-slate-200 bg-slate-50 text-slate-600',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    loading: 'border-blue-200 bg-blue-50 text-blue-700'
};

export function MiniSpinner({ className = '' }: { className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={`inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
        />
    );
}

export function ActionStatusMessage({
    tone,
    children
}: {
    tone: ActionStatusTone;
    children: ReactNode;
}) {
    return (
        <div className={`flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold ${toneClasses[tone]}`}>
            {tone === 'loading' && <MiniSpinner />}
            <span>{children}</span>
        </div>
    );
}
