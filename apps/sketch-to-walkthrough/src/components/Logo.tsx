import type { ReactNode } from 'react';

export function Logo({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}>
    <svg width="37" height="37" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="11" fill="currentColor"/><path d="M9 29V13l6-3v16l6-3V10l10 5v15l-6 3V17l-4-2v15L9 29Z" fill="#D5EFA4" stroke="#D5EFA4" strokeWidth=".7" strokeLinejoin="round"/></svg>
    <span><b>sketch</b><i>to walkthrough</i></span>
  </div>;
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  const paths: Record<string, ReactNode> = {
    upload: <><path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    cube: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v9M7 5.8l9 5"/></>,
    plan: <><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h9v8M13 4v5h7"/></>,
    walk: <><circle cx="13.5" cy="4.5" r="2"/><path d="m7 21 3-7 2-4 4 4h4M10 10l3-3 3 7-3 7"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    minus: <path d="M5 12h14"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    down: <path d="m5 9 7 7 7-7"/>,
    external: <><path d="M14 5h5v5M19 5l-9 9"/><path d="M15 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h5"/></>,
    reset: <><path d="M3 10a9 9 0 1 1 2.4 8M3 4v6h6"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    spark: <path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z"/>,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/></>,
    expand: <><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></>,
    house: <><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/></>,
    file: <><path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export function FinePrint({ children }: { children: ReactNode }) {
  return <span className="fine-print">{children}</span>;
}
