export type TimelineAction =
  | { type: 'pose'; preset: string; at: number }
  | { type: 'assembly'; from: number; to: number; at: number; duration: number }
  | { type: 'aperture'; at: number; value: number }
  | { type: 'shutter'; at: number }
  | { type: 'rays'; at: number; value: boolean }
  | { type: 'select'; at: number; id: string | null };

/** The showcase is a repeatable score, not a separate camera model. */
export const SHOWCASE_SCORE: TimelineAction[] = [
  { type: 'pose', preset: 'hero', at: 0 },
  { type: 'assembly', from: 0, to: 100, at: 3, duration: 6.4 },
  { type: 'pose', preset: 'exploded', at: 3.2 },
  { type: 'pose', preset: 'lens', at: 9.6 },
  { type: 'select', id: 'aperture', at: 10 },
  { type: 'aperture', at: 10.1, value: 8 },
  { type: 'aperture', at: 11.4, value: 1.8 },
  { type: 'aperture', at: 12.8, value: 8 },
  { type: 'select', id: 'shutter', at: 14 },
  { type: 'pose', preset: 'sensor', at: 14 },
  { type: 'shutter', at: 14.7 },
  { type: 'select', id: 'sensor', at: 15.7 },
  { type: 'select', id: null, at: 17 },
  { type: 'pose', preset: 'hero', at: 17 },
  { type: 'assembly', from: 100, to: 0, at: 17, duration: 2.6 },
  { type: 'aperture', at: 17.2, value: 1.8 },
];
