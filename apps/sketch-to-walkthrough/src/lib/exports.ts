import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildWorld, disposeWorld } from './world';
import { parse } from 'acorn';
import type { ParamDef, PlanSpec } from './plan';
import { planToSVG } from './plan-svg';
import { stripFences } from './module';

export function download(data: Blob | string, name: string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function moduleWithParams(response: string, params: Record<string, ParamDef>) {
  // Versions keep the raw model response, which may be fenced; parse and slice the bare module.
  const source = stripFences(response);
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  const declaration = ast.body.find((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration' && node.declaration.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === 'PARAMS'));
  if (declaration?.type !== 'ExportNamedDeclaration' || declaration.declaration?.type !== 'VariableDeclaration') return source;
  const init = declaration.declaration.declarations[0].init;
  if (!init) return source;
  return source.slice(0, init.start) + JSON.stringify(params, null, 2) + source.slice(init.end);
}

export function exportPlan(plan: PlanSpec) { download(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }), 'plan.json'); }
export function exportSource(source: string, params: Record<string, ParamDef>) { download(new Blob([moduleWithParams(source, params)], { type: 'text/javascript' }), 'plan.js'); }
export function exportSVG(plan: PlanSpec) { download(new Blob([planToSVG(plan, { width: 1800 })], { type: 'image/svg+xml' }), 'plan.svg'); }

export async function exportGLB(plan: PlanSpec) {
  const world = buildWorld(plan, { labels: false, ceiling: true });
  try {
    const result = await new GLTFExporter().parseAsync(world, { binary: true, onlyVisible: true });
    download(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), 'walkthrough.glb');
  } finally { disposeWorld(world); }
}
