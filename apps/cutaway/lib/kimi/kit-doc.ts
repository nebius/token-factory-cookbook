/** The `kit` API as Kimi sees it. Mirrors lib/sandbox/kit.ts. */
export const KIT_DOC = `
Each part builder is the BODY of a function called as builder(THREE, kit). It must \`return\` one THREE.Object3D
(a Mesh or a Group) already placed where the part sits in the ASSEMBLED device.
- Units: millimetres. Axes: Y is up, the device is centred on the origin, the front faces +Z.
- No imports, no async, no DOM, no network, no timers, no Math.random (use kit.rand(seed)). Keep each builder under ~120 lines.
- THREE is three.js r187 (BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, ConeGeometry, CapsuleGeometry,
  LatheGeometry, ExtrudeGeometry, TubeGeometry, Shape, Path, Vector2/3, Euler, CatmullRomCurve3, Mesh, Group, InstancedMesh,
  MeshStandardMaterial...). Use it freely when the helpers don't fit.

kit helpers (all sizes in mm, angles in degrees):
  kit.mat(preset, {color?, metalness?, roughness?, opacity?})  -> MeshStandardMaterial
      presets: steel aluminium metal copper brass gold magnet plastic rubber glass silicon ceramic pcb paint carbon fabric
  kit.mesh(geometry, matOrPreset)                     -> Mesh
  kit.at(object, [x,y,z], [rx,ry,rz])                 -> same object, positioned and rotated (degrees, XYZ order)
  kit.group(...objects)                               -> Group
  kit.box(w, h, d)                                    -> geometry centred on origin
  kit.cyl(rTop, rBottom = rTop, h, segments = 48)     -> cylinder along Y, centred
  kit.tube(rOuter, rInner, h, segments = 64)          -> hollow cylinder along Y (rings, sleeves, bearing races, stator yoke)
  kit.lathe([[r, y], ...], segments = 64)             -> solid of revolution around Y (housings, nose cones, shafts with steps)
  kit.extrude([[x, y], ...], depth, {holes?: [[[x,y],...]], bevel?})  -> 2D outline extruded along +Z from z=0
  kit.circle(r, segments = 48, cx = 0, cy = 0)        -> [[x,y],...] outline for extrude / holes
  kit.gear({teeth, radius, thickness, toothDepth?, bore?})  -> spur gear in the XZ plane (axis Y), centred
  kit.helix({radius, pitch, turns, wire})             -> coil/spring around Y, centred
  kit.sweep([[x,y,z], ...], radius)                   -> tube along a smooth path (wires, hoses, fuel lines)
  kit.blade({span, rootChord, tipChord?, thickness?, twistDeg?, pitchDeg?, sweep?, camber?})
                                                      -> twisted aerofoil blade, root at origin, extends along +X
  kit.radial(count, (i, angleDeg) => object, radius = 0)  -> copies spun around Y (blades, magnets, bolts, stator teeth)
  kit.linear(count, [dx,dy,dz], (i) => object)        -> copies in a row (fins, cells, pins)
  kit.pcb({w, d, t = 1.6, color?, chips: [{x, z, w, d, h?, color?, preset?}]})  -> board lying flat (thickness along Y)
  kit.rand(seed)                                      -> deterministic () => number in [0,1)

Example builder (a 12-slot stator, axis along Y):
  const g = kit.group();
  g.add(kit.mesh(kit.tube(28, 22, 18), kit.mat("steel", { color: "#7d848c" })));
  g.add(kit.radial(12, () => kit.at(kit.mesh(kit.box(10, 18, 4), "steel"), [17, 0, 0])));
  g.add(kit.radial(12, () => kit.at(kit.mesh(kit.cyl(3.2, 3.2, 16, 16), "copper"), [16, 0, 0], [0, 0, 0])));
  return kit.at(g, [0, 4, 0]);
`.trim();
