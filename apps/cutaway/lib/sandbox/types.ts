export type Issue = { severity: "error" | "warning"; partId?: string; message: string };

export type BuiltMesh = {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array | null;
  material: { preset: string; color: string; metalness: number; roughness: number; opacity: number };
};

export type BuiltPart = {
  id: string;
  ok: boolean;
  meshes: BuiltMesh[];
  issues: Issue[];
  triangles: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
};

export type WorkerRequest = { type: "build"; parts: { id: string; code: string }[]; sizeMm: [number, number, number] };
export type WorkerMessage = { type: "start"; id: string } | { type: "part"; part: BuiltPart } | { type: "done" };
