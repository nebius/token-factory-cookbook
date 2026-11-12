import { useRef, useState } from 'react';

export function WalkControls({ onMove }: { onMove: (x: number, y: number) => void }) {
  const thumb = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(x, y), scale = length > 32 ? 32 / length : 1;
    x *= scale; y *= scale;
    if (thumb.current) thumb.current.style.transform = `translate(${x}px,${y}px)`;
    onMove(x / 32, -y / 32);
  };
  return <div className={`joystick ${active ? 'active' : ''}`} aria-label="Virtual movement joystick"
    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setActive(true); update(e); }}
    onPointerMove={(e) => { if (active) { e.stopPropagation(); update(e); } }}
    onPointerUp={(e) => { e.stopPropagation(); setActive(false); onMove(0, 0); if (thumb.current) thumb.current.style.transform = ''; }}
    onPointerCancel={() => { setActive(false); onMove(0, 0); }}>
    <span className="joy-up">↑</span><span className="joy-down">↓</span><span className="joy-left">←</span><span className="joy-right">→</span>
    <div ref={thumb} className="joystick-thumb" />
  </div>;
}
