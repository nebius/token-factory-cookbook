import type { PlanSpec } from './plan';
import { furnitureToSVG } from './furniture-svg';
import { roomLabelLayout } from './label-layout';

export type PlanStyle = 'light' | 'dark';
export const palette = {
  light: { bg: '#ffffff', wall: '#203f38', interior: '#537368', text: '#203f38', dim: '#728076', grid: '#edf0e8', opening: '#ffffff', wood: '#e6d7b9', tile: '#d8e4df', carpet: '#e4ddd3', concrete: '#dbdfdc', paving: '#dedbcf', grass: '#d9e4d1', water: '#bcdcda' },
  dark: { bg: '#eff0e9', wall: '#203f38', interior: '#63786c', text: '#203f38', dim: '#798274', grid: '#e4e8dd', opening: '#ffffff', wood: '#e9dcc3', tile: '#dce7e1', carpet: '#e6e0d6', concrete: '#e0e3df', paving: '#e2dfd4', grass: '#dce6d5', water: '#c1e0de' },
};

export function planBounds(plan: PlanSpec) {
  const points = [...plan.walls.flatMap((w) => [w.a, w.b]), ...plan.rooms.flatMap((r) => r.polygon)];
  const minX = Math.min(...points.map((p) => p[0])), maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])), maxY = Math.max(...points.map((p) => p[1]));
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function planToSVG(plan: PlanSpec, options: { width?: number; dark?: boolean; dimensions?: boolean } = {}) {
  const width = options.width ?? 1200, bounds = planBounds(plan), margin = Math.max(bounds.width, bounds.height) * 0.12;
  const totalW = bounds.width + margin * 2, totalH = bounds.height + margin * 2, height = Math.round(width * totalH / totalW);
  const colors = options.dark ? palette.dark : palette.light;
  const u = (x: number) => (x - bounds.minX + margin) / totalW * width;
  const v = (y: number) => height - (y - bounds.minY + margin) / totalH * height;
  const scale = width / totalW;
  const floors = plan.rooms.map((room, index) => {
    const points = room.polygon.map(([x, y]) => `${u(x)},${v(y)}`).join(' ');
    return `<polygon points="${points}" fill="${colors[room.floor]}" stroke="none"/><clipPath id="room-label-${index}"><polygon points="${points}"/></clipPath>${room.floor === 'water' ? `<polygon points="${points}" fill="none" stroke="#82aaa1" stroke-width="${Math.max(2, 120 * scale)}"/>` : ''}`;
  }).join('');
  const furniture = plan.furniture.map((item) => furnitureToSVG(item, u, v, scale)).join('');
  const roomLabels = plan.rooms.map((room, index) => {
    const label = roomLabelLayout(room, scale, Math.min(18, width / 72));
    const x = u(label.center[0]), y = v(label.center[1]), lineHeight = label.fontSize * 1.08;
    const blockHeight = (label.nameLines.length + 0.9) * lineHeight, start = y - blockHeight / 2 + label.fontSize;
    const textWidth = Math.max(...label.nameLines.map((line) => line.length * label.fontSize * 0.56), label.area.length * label.fontSize * 0.78 * 0.56);
    const backgroundWidth = textWidth + 14, backgroundHeight = blockHeight + 10;
    const background = `<rect class="room-label-background" x="${x - backgroundWidth / 2}" y="${y - backgroundHeight / 2}" width="${backgroundWidth}" height="${backgroundHeight}" rx="5" fill="#f8f8f2" fill-opacity="0.88" stroke="#ffffff" stroke-opacity="0.6" stroke-width="1"/>`;
    const names = label.nameLines.map((line, i) => `<text x="${x}" y="${start + i * lineHeight}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="600" font-size="${label.fontSize}" fill="${colors.text}">${escapeXml(line)}</text>`).join('');
    return `<g clip-path="url(#room-label-${index})" data-room-label="${escapeXml(room.id)}">${background}${names}<text x="${x}" y="${start + label.nameLines.length * lineHeight}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${label.fontSize * 0.78}" fill="${colors.dim}">${label.area}</text></g>`;
  }).join('');
  const walls = plan.walls.map((wall) => {
    const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1], length = Math.hypot(dx, dy);
    const wallMarkup = `<line x1="${u(wall.a[0])}" y1="${v(wall.a[1])}" x2="${u(wall.b[0])}" y2="${v(wall.b[1])}" stroke="${wall.exterior ? colors.wall : colors.interior}" stroke-width="${wall.thickness * scale}" stroke-linecap="square"/>`;
    const openings = plan.openings.filter((o) => o.wallId === wall.id).map((o) => {
      const at = (n: number) => [wall.a[0] + dx * n / length, wall.a[1] + dy * n / length] as [number, number];
      const a = at(o.offset), b = at(o.offset + o.width);
      if (o.type === 'window') {
        const normal = [-dy / length * wall.thickness * 0.18, dx / length * wall.thickness * 0.18];
        return `<line x1="${u(a[0])}" y1="${v(a[1])}" x2="${u(b[0])}" y2="${v(b[1])}" stroke="${colors.opening}" stroke-width="${wall.thickness * scale + 2}"/><line x1="${u(a[0] + normal[0])}" y1="${v(a[1] + normal[1])}" x2="${u(b[0] + normal[0])}" y2="${v(b[1] + normal[1])}" stroke="${colors.interior}" stroke-width="1.5"/><line x1="${u(a[0] - normal[0])}" y1="${v(a[1] - normal[1])}" x2="${u(b[0] - normal[0])}" y2="${v(b[1] - normal[1])}" stroke="${colors.interior}" stroke-width="1.5"/>`;
      }
      const angle = Math.atan2(v(wall.b[1]) - v(wall.a[1]), u(wall.b[0]) - u(wall.a[0]));
      const end = [u(a[0]) + Math.cos(angle + Math.PI / 2) * o.width * scale, v(a[1]) + Math.sin(angle + Math.PI / 2) * o.width * scale];
      return `<line x1="${u(a[0])}" y1="${v(a[1])}" x2="${u(b[0])}" y2="${v(b[1])}" stroke="${colors.opening}" stroke-width="${wall.thickness * scale + 2}"/><path d="M ${u(b[0])} ${v(b[1])} A ${o.width * scale} ${o.width * scale} 0 0 1 ${end[0]} ${end[1]}" fill="none" stroke="${colors.dim}" stroke-width="1"/><line x1="${u(a[0])}" y1="${v(a[1])}" x2="${end[0]}" y2="${end[1]}" stroke="${colors.dim}" stroke-width="1.3"/>`;
    }).join('');
    return wallMarkup + openings;
  }).join('');
  const dimensions = options.dimensions === false ? '' : [
    { a: [bounds.minX, bounds.minY], b: [bounds.maxX, bounds.minY], offset: -margin * 0.48, text: `${(bounds.width / 1000).toFixed(1)} m` },
    { a: [bounds.minX, bounds.minY], b: [bounds.minX, bounds.maxY], offset: -margin * 0.48, text: `${(bounds.height / 1000).toFixed(1)} m` },
  ].map((d) => {
    const horizontal = d.a[1] === d.b[1], delta = d.offset;
    const a: [number, number] = [d.a[0] + (horizontal ? 0 : delta), d.a[1] + (horizontal ? delta : 0)];
    const b: [number, number] = [d.b[0] + (horizontal ? 0 : delta), d.b[1] + (horizontal ? delta : 0)];
    const middleX = (u(a[0]) + u(b[0])) / 2, middleY = (v(a[1]) + v(b[1])) / 2;
    return `<line x1="${u(a[0])}" y1="${v(a[1])}" x2="${u(b[0])}" y2="${v(b[1])}" stroke="${colors.dim}" stroke-width="1"/><text x="${middleX}" y="${middleY - 6}" text-anchor="middle" transform="${horizontal ? '' : `rotate(-90 ${middleX} ${middleY - 6})`}" font-family="Arial,sans-serif" font-size="${width / 80}" fill="${colors.dim}">${d.text}</text>`;
  }).join('');
  const grid = [];
  for (let x = Math.ceil(bounds.minX / 1000) * 1000; x < bounds.maxX; x += 1000) grid.push(`<line x1="${u(x)}" y1="${v(bounds.minY)}" x2="${u(x)}" y2="${v(bounds.maxY)}" stroke="${colors.grid}" stroke-width="0.7"/>`);
  for (let y = Math.ceil(bounds.minY / 1000) * 1000; y < bounds.maxY; y += 1000) grid.push(`<line x1="${u(bounds.minX)}" y1="${v(y)}" x2="${u(bounds.maxX)}" y2="${v(y)}" stroke="${colors.grid}" stroke-width="0.7"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${colors.bg}"/>${grid.join('')}${floors}${furniture}${walls}${roomLabels}${dimensions}<text x="${width - 22}" y="${height - 18}" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="${colors.dim}" letter-spacing="1.5">SKETCH TO WALKTHROUGH · ALL DIMENSIONS IN MM</text></svg>`;
}
function escapeXml(value: string) { return value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)); }

export async function svgToPng(svg: string): Promise<string> {
  const svgData = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const image = new Image(); image.src = svgData;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the plan image.')); });
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
  return canvas.toDataURL();
}
