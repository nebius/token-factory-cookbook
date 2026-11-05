import { z } from 'zod';

export const pointSchema = z.tuple([z.number(), z.number()]);

export const FURNITURE_TYPES = [
  'bed_double', 'bed_single', 'nightstand', 'wardrobe', 'sofa', 'armchair',
  'coffee_table', 'tv_unit', 'dining_table', 'kitchen_run', 'kitchen_island',
  'fridge', 'toilet', 'basin_vanity', 'bathtub', 'shower', 'desk', 'bookshelf',
  'washer', 'car', 'plant', 'tree', 'gym_bike', 'yoga_mat', 'lounger',
] as const;
export type FurnitureType = typeof FURNITURE_TYPES[number];

export const scheduleSchema = z.object({
  roomId: z.string().min(1).max(80),
  writtenWidth: z.number().positive().finite(),
  writtenDepth: z.number().positive().finite(),
  source: z.enum(['label', 'schedule']),
});
export const adjacencySchema = z.object({
  a: z.string().min(1).max(80),
  b: z.string().min(1).max(80),
  side: z.enum(['N', 'S', 'E', 'W']),
});
export type Adjacency = z.infer<typeof adjacencySchema>;

export const furnitureSchema = z.object({
  id: z.string().min(1).max(100),
  roomId: z.string().min(1).max(80),
  type: z.enum(FURNITURE_TYPES),
  position: pointSchema,
  rotation: z.number().finite().min(-360).max(360).default(0),
  size: z.tuple([z.number().positive().max(30000), z.number().positive().max(30000)]).optional(),
  seats: z.number().int().min(2).max(20).optional(),
  source: z.enum(['sketch', 'auto']).default('sketch'),
}).superRefine((item, context) => {
  if (item.seats !== undefined && item.type !== 'dining_table') context.addIssue({ code: 'custom', message: 'seats is only valid for dining_table.' });
});
export type FurnitureItem = z.infer<typeof furnitureSchema>;

export const planSchema = z.object({
  wallHeight: z.number().min(1800).max(6000),
  walls: z.array(z.object({
    id: z.string().min(1).max(80),
    a: pointSchema,
    b: pointSchema,
    thickness: z.number().min(50).max(600),
    exterior: z.boolean(),
  })).min(4).max(200),
  rooms: z.array(z.object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    polygon: z.array(pointSchema).min(3).max(64),
    floor: z.enum(['wood', 'tile', 'carpet', 'concrete', 'paving', 'grass', 'water']),
    kind: z.enum(['indoor', 'open', 'outdoor']).default('indoor'),
  })).min(1).max(60),
  schedule: z.array(scheduleSchema).max(60).optional(),
  adjacency: z.array(adjacencySchema).max(400).optional(),
  openings: z.array(z.object({
    id: z.string().min(1).max(80),
    wallId: z.string().min(1).max(80),
    type: z.enum(['door', 'window', 'opening']),
    offset: z.number().min(0),
    width: z.number().min(300).max(5000),
    height: z.number().min(300).max(3500),
    sill: z.number().min(0).optional(),
    swing: z.enum(['left', 'right']).optional(),
  })).max(400),
  furniture: z.array(furnitureSchema).max(1000).default([]),
  entry: z.object({ position: pointSchema, facing: z.number().min(0).max(360) }),
});
export type PlanSpec = z.infer<typeof planSchema>;
export type Opening = PlanSpec['openings'][number];

export const paramSchema = z.object({
  value: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
  group: z.enum(['global', 'room']).default('global'),
  room: z.string().max(80).optional(),
  label: z.string().max(100).optional(),
}).refine((p) => p.min > 0 && p.min < p.max && p.value >= p.min && p.value <= p.max, {
  message: 'Each parameter needs min <= value <= max and min < max.',
});
export type ParamDef = z.infer<typeof paramSchema>;
export const paramsSchema = z.record(z.string(), paramSchema)
  .refine((p) => Object.keys(p).length > 0 && Object.keys(p).length <= 100, 'Provide between 1 and 100 parameters.');

export const assumptionSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().min(1).max(500),
  param: z.string().min(1).max(80).optional(),
});
export type Assumption = z.infer<typeof assumptionSchema>;
export const assumptionsSchema = z.array(assumptionSchema).max(100);

export type ParamValues = Record<string, number>;
export const paramValues = (params: Record<string, ParamDef>): ParamValues =>
  Object.fromEntries(Object.entries(params).map(([key, p]) => [key, p.value]));

export const formatMM = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 2)} m` : `${Math.round(n)} mm`;
export const displayParam = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const roomCenter = (polygon: [number, number][]): [number, number] => {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross;
  }
  if (Math.abs(area) < 0.001) return [polygon[0][0], polygon[0][1]];
  return [x / (3 * area), y / (3 * area)];
};
