import type { ParamDef } from '../lib/plan';

export function DetailSlider({ name, def, value, onChange, id }: { name: string; def: ParamDef; value: number; onChange: (value: number) => void; id?: string }) {
  const step = def.max > 3000 ? 50 : def.max > 1000 ? 10 : 1;
  const display = value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 1 : 2).replace(/\.00$/, '')} m` : `${Math.round(value)} mm`;
  return <div className="param" data-param={name}>
    <div className="param-label"><label htmlFor={id ?? `param-${name}`}>{def.label ?? name.replace(/_/g, ' ')}</label><span>{display}</span></div>
    <input id={id ?? `param-${name}`} aria-label={def.label ?? name} type="range" min={def.min} max={def.max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ '--progress': `${(value - def.min) / (def.max - def.min) * 100}%` } as React.CSSProperties} />
    <div className="range-captions"><span>{def.min >= 1000 ? `${def.min / 1000} m` : `${def.min} mm`}</span><span>{def.max >= 1000 ? `${def.max / 1000} m` : `${def.max} mm`}</span></div>
  </div>;
}
