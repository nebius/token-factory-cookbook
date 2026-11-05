import { diningChairPlacements, itemDimensions } from './furniture';
import type { FurnitureItem } from './plan';

export function furnitureToSVG(item: FurnitureItem, u: (x: number) => number, v: (y: number) => number, scale: number) {
  const [width, depth] = itemDimensions(item), w = width * scale, d = depth * scale;
  const stroke = item.source === 'auto' ? '#91836a' : '#516b60', fill = item.source === 'auto' ? '#eee8da' : '#e2e7dd';
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="1.1" vector-effect="non-scaling-stroke"`;
  const rect = (x: number, y: number, rw: number, rd: number, extra = '') => {
    const customFill = extra.match(/fill="([^"]+)"/)?.[1];
    const merged = customFill ? attrs.replace(`fill="${fill}"`, `fill="${customFill}"`) : attrs;
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rd}" rx="${Math.min(3, rw / 8, rd / 8)}" ${merged} ${extra.replace(/fill="[^"]*"/g, '')}/>`;
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"/>`;
  let symbol = rect(-w / 2, -d / 2, w, d);
  switch (item.type) {
    case 'bed_double': case 'bed_single':
      symbol += rect(-w * 0.43, -d * 0.43, w * 0.86, d * 0.18, `fill="#f6f4ec"`) + line(-w / 2, -d * 0.12, w / 2, -d * 0.12);
      if (item.type === 'bed_double') symbol += line(0, -d * 0.43, 0, -d * 0.25);
      break;
    case 'wardrobe': case 'bookshelf': case 'kitchen_run': case 'tv_unit':
      symbol += line(0, -d / 2, 0, d / 2) + line(-w / 2, 0, w / 2, 0);
      if (item.type === 'bookshelf') for (let y = -d * 0.3; y < d / 2; y += Math.max(3, d / 4)) symbol += line(-w / 2, y, w / 2, y);
      break;
    case 'sofa': case 'armchair': case 'lounger':
      symbol += rect(-w * 0.42, -d * 0.28, w * 0.84, d * 0.52, `fill="#f4f1e8"`) + rect(-w / 2, -d / 2, w, d * 0.15) + line(-w * 0.35, -d * 0.25, -w * 0.35, d * 0.35) + line(w * 0.35, -d * 0.25, w * 0.35, d * 0.35);
      break;
    case 'dining_table': {
      symbol = rect(-w * 0.32, -d * 0.25, w * 0.64, d * 0.5);
      const count = item.seats ?? 6, sideSeats = count >= 4 ? Math.ceil((count - 2) / 2) : Math.ceil(count / 2);
      const chairWidth = Math.min(w * 0.16, w * 0.7 / Math.max(1, sideSeats));
      for (const chair of diningChairPlacements(w * 0.64, d, item.seats)) {
        const end = Math.abs(chair.rotation) === 90, cw = end ? w * 0.09 : chairWidth, cd = end ? d * 0.24 : d * 0.09;
        symbol += `<g class="dining-chair" transform="translate(${chair.x} ${chair.y}) rotate(${-chair.rotation})">${rect(-cw / 2, -cd / 2, cw, cd)}</g>`;
      }
      break;
    }
    case 'toilet':
      symbol = `<ellipse cx="0" cy="${d * 0.08}" rx="${w * 0.4}" ry="${d * 0.37}" ${attrs}/>` + rect(-w * 0.4, -d * 0.48, w * 0.8, d * 0.24) + `<ellipse cx="0" cy="${d * 0.08}" rx="${w * 0.21}" ry="${d * 0.2}" ${attrs}/>`;
      break;
    case 'basin_vanity':
      symbol += `<ellipse cx="0" cy="0" rx="${w * 0.3}" ry="${d * 0.28}" ${attrs.replace(`fill="${fill}"`, 'fill="#f5f5ee"')}/>`;
      break;
    case 'bathtub': case 'shower':
      symbol += rect(-w * 0.4, -d * 0.39, w * 0.8, d * 0.78, `fill="#d9e9e4"`) + `<circle cx="${w * 0.27}" cy="${-d * 0.27}" r="${Math.max(1.2, Math.min(w, d) * 0.045)}" fill="${stroke}"/>`;
      break;
    case 'car':
      symbol += rect(-w * 0.36, -d * 0.22, w * 0.72, d * 0.43, `fill="#c5d3ce"`) + line(-w * 0.36, -d * 0.08, w * 0.36, -d * 0.08) + line(-w * 0.36, d * 0.08, w * 0.36, d * 0.08);
      for (const x of [-w * 0.53, w * 0.46]) for (const y of [-d * 0.3, d * 0.2]) symbol += rect(x, y, w * 0.07, d * 0.12, `fill="${stroke}"`);
      break;
    case 'plant': case 'tree':
      symbol = `<circle cx="0" cy="0" r="${w * 0.42}" fill="#dce7d7" stroke="${stroke}"/>`;
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; symbol += `<ellipse cx="${Math.cos(a) * w * 0.2}" cy="${Math.sin(a) * d * 0.2}" rx="${w * 0.17}" ry="${d * 0.12}" transform="rotate(${i * 60} ${Math.cos(a) * w * 0.2} ${Math.sin(a) * d * 0.2})" fill="#91a88b" stroke="${stroke}" stroke-width=".7"/>`; }
      break;
    case 'gym_bike':
      symbol = `<circle cx="0" cy="${d * 0.24}" r="${w * 0.3}" ${attrs}/>` + line(0, d * 0.24, 0, -d * 0.32) + line(-w * 0.4, -d * 0.32, w * 0.4, -d * 0.32) + rect(-w * 0.3, -d * 0.12, w * 0.6, d * 0.12);
      break;
    case 'yoga_mat':
      symbol += line(0, -d * 0.4, 0, d * 0.4) + `<circle cx="0" cy="${-d * 0.32}" r="${w * 0.12}" fill="none" stroke="${stroke}"/>`;
      break;
    case 'kitchen_island':
      symbol += rect(-w * 0.22, -d * 0.24, w * 0.44, d * 0.48, `fill="#d9e9e4"`);
      break;
    case 'fridge': case 'washer':
      symbol += `<circle cx="0" cy="0" r="${Math.min(w, d) * 0.28}" fill="none" stroke="${stroke}"/>`;
      break;
    case 'desk':
      symbol += rect(-w * 0.2, -d * 0.3, w * 0.4, d * 0.25, `fill="#c5d3ce"`);
      break;
  }
  return `<g class="furniture-symbol" data-furniture-id="${escape(item.id)}" data-source="${item.source}" data-type="${item.type}" transform="translate(${u(item.position[0])} ${v(item.position[1])}) rotate(${-item.rotation})" opacity="${item.source === 'auto' ? 0.78 : 0.95}">${symbol}</g>`;
}
function escape(value: string) { return value.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!)); }
