import { pointInPolygon, pointSegmentDistance, polygonArea, type Point } from './furniture';
import { roomCenter, type PlanSpec } from './plan';

export type LabelLayout = { center: Point; nameLines: string[]; area: string; fontSize: number; maxWidthMM: number };

/** Pick an interior anchor and fit text before relying on the polygon clip as a final guard. */
export function roomLabelLayout(room: PlanSpec['rooms'][number], pixelsPerMM: number, preferred = 18): LabelLayout {
  const polygon = room.polygon as Point[], center = interiorAnchor(polygon);
  const clearance = Math.min(...polygon.map((a, i) => pointSegmentDistance(center, a, polygon[(i + 1) % polygon.length])));
  const widthAtAnchor = horizontalSpan(polygon, center[1]);
  const maxWidthMM = Math.max(100, Math.min(widthAtAnchor * 0.88, clearance * 1.8));
  const maxPixels = maxWidthMM * pixelsPerMM;
  const area = `${(polygonArea(polygon) / 1e6).toFixed(1)} m²`;
  for (const abbreviate of [false, true]) {
    const name = abbreviate ? shorten(room.name) : room.name;
    // Fit on one line before adding lines; only abbreviate after wrapping also fails.
    for (let fontSize = preferred; fontSize >= 8; fontSize--) {
      if (textWidth(name, fontSize) <= maxPixels && textWidth(area, fontSize * 0.78) <= maxPixels) return { center, nameLines: [name], area, fontSize, maxWidthMM };
    }
    for (let fontSize = preferred; fontSize >= 7; fontSize--) {
      const lines = wrap(name, maxPixels, fontSize);
      if (lines.length <= 3 && lines.every((line) => textWidth(line, fontSize) <= maxPixels) && textWidth(area, fontSize * 0.78) <= maxPixels) return { center, nameLines: lines, area, fontSize, maxWidthMM };
    }
  }
  const fontSize = Math.max(6, Math.min(8, preferred));
  return { center, nameLines: wrap(shorten(room.name), maxPixels, fontSize).slice(0, 3), area, fontSize, maxWidthMM };
}

export function interiorAnchor(polygon: Point[]): Point {
  const center = roomCenter(polygon), xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const boxCenter: Point = [(minX + maxX) / 2, (minY + maxY) / 2];
  // An exterior bounding-box centre may lie in a concave notch; only use an actual interior fallback.
  let best = pointInPolygon(center, polygon, false) ? center : pointInPolygon(boxCenter, polygon, false) ? boxCenter : polygon[0];
  const score = (p: Point) => Math.min(...polygon.map((a, i) => pointSegmentDistance(p, a, polygon[(i + 1) % polygon.length])));
  for (let x = 1; x < 12; x++) for (let y = 1; y < 12; y++) {
    const point: Point = [minX + (maxX - minX) * x / 12, minY + (maxY - minY) * y / 12];
    if (pointInPolygon(point, polygon, false) && score(point) > score(best)) best = point;
  }
  return best;
}
function horizontalSpan(polygon: Point[], y: number) {
  const intersections: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
  }
  return intersections.length >= 2 ? Math.max(...intersections) - Math.min(...intersections) : 1000;
}
const textWidth = (text: string, size: number) => text.length * size * 0.56;
function wrap(name: string, width: number, size: number) {
  const words = name.replace(/—/g, '— ').split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function shorten(name: string) {
  return name.replace(/Primary/gi, 'Prim.').replace(/Bedroom/gi, 'Bed.').replace(/Guest/gi, 'Gst.').replace(/Ensuite/gi, 'Ens.').replace(/Shared/gi, 'Shd.').replace(/Courtyard/gi, 'Court.').replace(/Open to Sky/gi, 'Open-air').replace(/Covered/gi, 'Cov.').replace(/Library/gi, 'Lib.').replace(/Storage/gi, 'Store').replace(/Laundry/gi, 'Ldry.');
}
