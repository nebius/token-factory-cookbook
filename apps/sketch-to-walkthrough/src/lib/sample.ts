export const SAMPLE_SOURCE = `export const PARAMS = {
  wall_height: { value: 2700, min: 2400, max: 3400, group: "global", label: "Wall height" },
  exterior_thickness: { value: 200, min: 150, max: 300, group: "global", label: "Exterior wall thickness" },
  interior_thickness: { value: 120, min: 100, max: 200, group: "global", label: "Interior wall thickness" },
  living_width: { value: 5500, min: 4600, max: 6000, group: "room", room: "living", label: "Living zone width" },
  living_depth: { value: 3900, min: 3600, max: 4100, group: "room", room: "living", label: "Living room depth" },
  hall_width: { value: 1100, min: 1050, max: 1600, group: "room", room: "hall", label: "Hall width" },
  bedroom_depth: { value: 3500, min: 3100, max: 3600, group: "room", room: "bedroom1", label: "Bedroom one depth" },
  window_sill: { value: 900, min: 650, max: 1050, group: "global", label: "Window sill height" },
  door_width: { value: 900, min: 820, max: 1000, group: "global", label: "Door width" }
};
export const ASSUMPTIONS = [
  { id: "height", text: "The sketch gave no ceiling height, so a conventional 2700 mm wall height is used.", param: "wall_height" },
  { id: "walls", text: "Wall thicknesses were not written. Exterior walls are 200 mm and partitions are 120 mm.", param: "exterior_thickness" },
  { id: "doors", text: "Unmarked internal doors are 900 mm wide, with a left-hand swing.", param: "door_width" },
  { id: "sill", text: "Windows are placed with a 900 mm sill for typical residential furniture clearance.", param: "window_sill" }
];
export function buildPlan(P) {
  const w = 10400, d = 7200, t = P.exterior_thickness, it = P.interior_thickness;
  const hw = P.hall_width, lw = P.living_width, x1 = lw, x2 = lw + hw;
  const ld = P.living_depth, bd = P.bedroom_depth;
  const door = P.door_width, sill = P.window_sill, h = P.wall_height;
  const wall = (id, a, b, thickness, exterior) => ({ id, a, b, thickness, exterior });
  return {
    wallHeight: h,
    walls: [
      wall("south", [0,0], [w,0], t, true),
      wall("east", [w,0], [w,d], t, true),
      wall("north", [w,d], [0,d], t, true),
      wall("west", [0,d], [0,0], t, true),
      wall("living_hall", [x1,0], [x1,ld], it, false),
      wall("kitchen_hall", [x1,ld], [x1,d], it, false),
      wall("hall_bed1", [x2,0], [x2,bd], it, false),
      wall("hall_bed2", [x2,bd], [x2,d], it, false),
      wall("living_kitchen", [0,ld], [x1,ld], it, false),
      wall("bed_split", [x2,bd], [w,bd], it, false)
    ],
    rooms: [
      { id: "living", name: "Living room", floor: "wood", polygon: [[t/2,t/2],[x1-it/2,t/2],[x1-it/2,ld-it/2],[t/2,ld-it/2]] },
      { id: "kitchen", name: "Kitchen", floor: "tile", polygon: [[t/2,ld+it/2],[x1-it/2,ld+it/2],[x1-it/2,d-t/2],[t/2,d-t/2]] },
      { id: "hall", name: "Hall", floor: "wood", polygon: [[x1+it/2,t/2],[x2-it/2,t/2],[x2-it/2,d-t/2],[x1+it/2,d-t/2]] },
      { id: "bedroom1", name: "Bedroom 01", floor: "carpet", polygon: [[x2+it/2,t/2],[w-t/2,t/2],[w-t/2,bd-it/2],[x2+it/2,bd-it/2]] },
      { id: "bedroom2", name: "Bedroom 02", floor: "carpet", polygon: [[x2+it/2,bd+it/2],[w-t/2,bd+it/2],[w-t/2,d-t/2],[x2+it/2,d-t/2]] }
    ],
    openings: [
      { id: "entry", wallId: "south", type: "door", offset: x1 + 100, width: door, height: 2100, sill: 0, swing: "left" },
      { id: "living_door", wallId: "living_hall", type: "door", offset: 1000, width: door, height: 2100, sill: 0, swing: "left" },
      { id: "kitchen_door", wallId: "kitchen_hall", type: "door", offset: 700, width: door, height: 2100, sill: 0, swing: "right" },
      { id: "bed1_door", wallId: "hall_bed1", type: "door", offset: 1000, width: door, height: 2100, sill: 0, swing: "left" },
      { id: "bed2_door", wallId: "hall_bed2", type: "door", offset: 850, width: door, height: 2100, sill: 0, swing: "right" },
      { id: "living_window", wallId: "south", type: "window", offset: 1800, width: 1900, height: 1250, sill: sill },
      { id: "kitchen_window", wallId: "west", type: "window", offset: 4500, width: 1500, height: 1200, sill: sill },
      { id: "bed1_window", wallId: "east", type: "window", offset: 1100, width: 1500, height: 1400, sill: sill },
      { id: "bed2_window", wallId: "north", type: "window", offset: 1600, width: 1700, height: 1400, sill: sill }
    ],
    entry: { position: [x1 + hw / 2, 700], facing: 0 }
  };
}`;

export const SAMPLE_SKETCH = '/samples/two-bedroom.png';
export const SAMPLES = [
  { id: 'two-bedroom', title: 'The two-bedroom', subtitle: '5 rooms · mixed dimensions', image: '/samples/two-bedroom.png', description: 'Open living, two quiet bedrooms, and a few deliberate gaps for Kimi to infer.' },
  { id: 'studio', title: 'The little studio', subtitle: '3 rooms · metric sketch', image: '/samples/studio.png', description: 'A compact open-plan studio with a separate bathroom and entry.' },
  { id: 'garden-flat', title: 'The garden flat', subtitle: '4 rooms · feet & metres', image: '/samples/garden-flat.png', description: 'A wider plan with mixed written units, glazing, and garden access.' },
];
