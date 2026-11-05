import type { Object3D } from 'three';

export type Category = 'Body' | 'Optics' | 'Electronics' | 'Hardware';
export type ViewMode = 'materials' | 'technical' | 'xray';
export type PresetName = 'hero' | 'front' | 'rear' | 'exploded' | 'lens' | 'sensor';

export interface Component {
  id: string;
  name: string;
  description: string;
  category: Category;
  parent: string;
  group: Object3D;
  stage: number;
  duration: number;
  selectRoot?: Object3D;
  // Iris blades animate in their assembled local space, independent of assembly.
  iris?: boolean;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export interface DebugState {
  assembly: number;
  aperture: string;
  parts: number;
  selected: string | null;
  mode: ViewMode;
  playing: boolean;
  showcase: boolean;
  sensorExposed: boolean;
  assembledError: number;
  drawCalls: number;
  triangles: number;
  motionReduced: boolean;
}
