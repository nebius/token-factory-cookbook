import type { WorkerResult } from './plan.worker';
import { z } from 'zod';
import { assumptionsSchema, paramsSchema, planSchema, type Assumption, type ParamDef, type PlanSpec } from './plan';

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
      if (event.data.ok) {
        // Re-check on the page: the worker ran model-written code.
        try {
          const { plan, params, assumptions, repairs } = event.data.result;
          resolve({ plan: planSchema.parse(plan), params: paramsSchema.parse(params) as Record<string, ParamDef>, assumptions: assumptionsSchema.parse(assumptions) as Assumption[], repairs: z.array(z.string()).parse(repairs), elapsed: Number(event.data.elapsed) || 0 });
        } catch (error) { reject(new Error(`The generated plan did not match the PlanSpec schema. ${(error as Error).message}`)); }
      }
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => { finish(); reject(new Error(`Generator worker failed: ${event.message}`)); };
    worker.postMessage({ id, source, values });
  });
}
