import type { WorkerResult } from './plan.worker';
import type { Assumption, ParamDef, PlanSpec } from './plan';

export type BuildResult = { plan: PlanSpec; params: Record<string, ParamDef>; assumptions: Assumption[]; repairs: string[]; elapsed: number };
let counter = 0;

export function runGenerator(source: string, values?: Record<string, number>, timeout = 500): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./plan.worker.ts', import.meta.url), { type: 'module', name: 'plan-sandbox' });
    const id = ++counter;
    let settled = false;
    const finish = () => { settled = true; clearTimeout(timer); worker.terminate(); };
    const timer = setTimeout(() => { finish(); reject(new Error('Generator stopped: buildPlan exceeded the 500 ms sandbox timeout.')); }, timeout);
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.id !== id || settled) return;
      finish();
      if (event.data.ok) resolve({ ...event.data.result, elapsed: event.data.elapsed });
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => { finish(); reject(new Error(`Generator worker failed: ${event.message}`)); };
    worker.postMessage({ id, source, values });
  });
}
