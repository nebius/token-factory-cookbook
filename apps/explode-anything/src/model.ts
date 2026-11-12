import * as THREE from 'three';
import {
  box,
  shell,
  rectFrame,
  cylinder,
  ring,
  opticalElement,
  textPlane,
  gripTexture,
  brushedTexture,
  screw,
  pcbTexture,
} from './geometry';
import type { Component } from './types';
import { Iris } from './iris';

type ComponentDefinition = Omit<Component, 'group'>;
type AxisRotation = [number, number, number];

const MOUNT_X = -0.45;
const OPTICAL_Y = 0.05;

export class CameraModel {
  readonly root = new THREE.Group();
  readonly components: Component[] = [];
  readonly iris = new Iris();
  readonly rayGroup = new THREE.Group();
  readonly glassElements: THREE.Mesh[] = [];
  private shutters: { mesh: THREE.Mesh; baseY: number; direction: number }[] = [];
  private materials = new Map<string, THREE.Material>();
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private highlightedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private technicalEdges: THREE.LineSegments[] = [];
  private highlightedId: string | null = null;
  private shutterStart: number | null = null;
  private exposed = false;

  constructor() {
    this.root.name = 'Concept mirrorless camera';
    this.buildMaterials();
    this.buildBody();
    this.buildInternals();
    this.buildLens();
    this.buildRayPaths();
    this.setHighlight(null);
    this.interpolateExplosion(0);
    this.applyViewMode('materials');
  }

  private material(key: string) {
    const material = this.materials.get(key);
    if (!material) throw new Error(`Unknown material: ${key}`);
    return material;
  }

  private buildMaterials() {
    const add = (key: string, material: THREE.Material) => this.materials.set(key, material);
    add('graphite', new THREE.MeshStandardMaterial({ color: '#252729', metalness: 0.42, roughness: 0.48 }));
    add('grip', new THREE.MeshStandardMaterial({ color: '#242526', metalness: 0.03, roughness: 0.82, map: gripTexture(), bumpMap: gripTexture(), bumpScale: 0.028 }));
    add('brushed', new THREE.MeshStandardMaterial({ color: '#aaa7a1', metalness: 0.87, roughness: 0.33, map: brushedTexture() }));
    add('darkMetal', new THREE.MeshStandardMaterial({ color: '#4c5154', metalness: 0.86, roughness: 0.34 }));
    add('silver', new THREE.MeshStandardMaterial({ color: '#c9c6bf', metalness: 0.92, roughness: 0.23 }));
    add('plastic', new THREE.MeshStandardMaterial({ color: '#17191b', metalness: 0.04, roughness: 0.7 }));
    add('glass', new THREE.MeshPhysicalMaterial({
      color: '#f7fafb', metalness: 0, roughness: 0.018, transmission: 0.985,
      thickness: 0.08, ior: 1.46, clearcoat: 1, clearcoatRoughness: 0.025,
      envMapIntensity: 1.2, specularIntensity: 1, attenuationColor: '#e4ebef', attenuationDistance: 6,
      iridescence: 0.58, iridescenceIOR: 1.36, iridescenceThicknessRange: [160, 400],
    }));
    add('sensorFace', new THREE.MeshPhysicalMaterial({ color: '#819fb2', metalness: 0.82, roughness: 0.13, iridescence: 0.65, iridescenceIOR: 1.6, iridescenceThicknessRange: [100, 340], clearcoat: 0.4 }));
    add('pcb', new THREE.MeshStandardMaterial({ color: '#d0d8ca', metalness: 0.26, roughness: 0.55, map: pcbTexture() }));
    add('shutter', new THREE.MeshStandardMaterial({ color: '#444642', metalness: 0.75, roughness: 0.4, side: THREE.DoubleSide }));
    add('amber', new THREE.MeshStandardMaterial({ color: '#b2844d', metalness: 0.55, roughness: 0.38 }));
    add('lensBody', new THREE.MeshStandardMaterial({ color: '#202326', metalness: 0.68, roughness: 0.37, map: brushedTexture() }));
    add('gold', new THREE.MeshStandardMaterial({ color: '#c6a36b', metalness: 0.9, roughness: 0.24 }));
    add('blackMatte', new THREE.MeshStandardMaterial({ color: '#101214', metalness: 0.06, roughness: 0.84 }));
    add('lcdOff', new THREE.MeshPhysicalMaterial({ color: '#12191d', metalness: 0.22, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 }));
    add('tech', new THREE.MeshStandardMaterial({ color: '#ddd9ce', metalness: 0.05, roughness: 0.65 }));
    add('techDark', new THREE.MeshStandardMaterial({ color: '#8d8a82', metalness: 0.05, roughness: 0.7 }));
    add('techWire', new THREE.LineBasicMaterial({ color: '#3d3c39', transparent: true, opacity: 0.65 }));
    add('ray', new THREE.MeshBasicMaterial({ color: '#dca46c', transparent: true, opacity: 0.45, depthWrite: false }));
    add('xrayShell', new THREE.MeshPhysicalMaterial({ color: '#7d858a', metalness: 0.15, roughness: 0.4, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
  }

  private addComp(definition: ComponentDefinition) {
    const component: Component = { ...definition, group: new THREE.Group() };
    component.group.name = definition.name;
    this.components.push(component);
    return component;
  }

  private register(component: Component, explodedOffset: [number, number, number], explodedRotation: AxisRotation = [0, 0, 0]) {
    this.root.add(component.group);
    component.group.updateMatrix();
    component.group.userData.assembledPosition = component.group.position.toArray();
    component.group.userData.assembledQuaternion = component.group.quaternion.toArray();
    component.group.userData.explodedOffset = explodedOffset;
    component.group.userData.explodedRotation = explodedRotation;
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...explodedRotation));
    component.group.userData.explodedQuaternion = component.group.quaternion.clone().multiply(delta).toArray();
    component.group.userData.stage = 0;
    component.group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      this.originalMaterials.set(object, object.material);
      const mat = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!(mat instanceof THREE.MeshBasicMaterial) && !(mat instanceof THREE.MeshPhysicalMaterial && mat.transmission > 0.4)) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
      if (!(object instanceof THREE.InstancedMesh) && object.geometry.attributes.position?.count > 24) {
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 38), this.material('techWire'));
        edge.visible = false;
        edge.raycast = () => undefined;
        object.add(edge);
        this.technicalEdges.push(edge);
      }
    });
  }

  private addBodyPart(
    definition: ComponentDefinition,
    children: THREE.Object3D[],
    explodedOffset: [number, number, number],
    explodedRotation: AxisRotation = [0, 0, 0],
  ) {
    const component = this.addComp(definition);
    children.forEach(child => component.group.add(child));
    this.register(component, explodedOffset, explodedRotation);
    return component;
  }

  private buildBody() {
    const m = (key: string) => this.material(key);
    this.addBodyPart({
      id: 'frontShell', name: 'Front body shell', category: 'Body', parent: 'Exterior', stage: 16, duration: 36,
      description: 'Rounded graphite face with an open lens throat. It locates the mount and protects the internal frame.',
    }, [
      shell(4.65, 3.05, 0.2, { x: MOUNT_X, y: OPTICAL_Y, r: 1.12 }, m('graphite')).translateZ(0.43),
      ring(1.18, 1.105, 0.065, m('darkMetal'), [MOUNT_X, OPTICAL_Y, 0.55]),
    ], [-3.1, 0.1, 0.45], [0, -0.12, -0.03]);

    this.addBodyPart({
      id: 'rearShell', name: 'Rear body shell', category: 'Body', parent: 'Exterior', stage: 20, duration: 38,
      description: 'Rear magnesium cover with a rectangular display recess and wraparound grip surface.',
    }, [
      rectFrame(4.65, 3.05, 3.06, 2.08, 0.2, m('graphite'), [0, 0, -0.54], 0.24),
      box(1.0, 2.72, 0.15, m('grip'), 0.1, [2.0, -0.05, -0.63]),
    ], [3.25, 0.15, -0.8], [0.04, 0.14, 0.03]);

    this.addBodyPart({
      id: 'topPlate', name: 'Top plate', category: 'Body', parent: 'Exterior', stage: 28, duration: 35,
      description: 'Brushed metal cap tying the body covers together and carrying the primary camera controls.',
    }, [box(4.64, 0.2, 1.17, m('brushed'), 0.075, [0, 1.515, -0.03])], [0, 2.25, -0.1], [0.05, 0, -0.035]);

    this.addBodyPart({
      id: 'bottomPlate', name: 'Bottom plate', category: 'Body', parent: 'Exterior', stage: 32, duration: 35,
      description: 'Reinforced base with a tripod thread and access to the battery compartment.',
    }, [
      box(4.64, 0.2, 1.17, m('graphite'), 0.065, [0, -1.515, -0.03]),
      cylinder(0.15, 0.15, 0.025, m('silver'), [MOUNT_X, -1.624, -0.08], 32, 'y'),
      cylinder(0.08, 0.08, 0.028, m('blackMatte'), [MOUNT_X, -1.64, -0.08], 24, 'y'),
    ], [0, -1.9, -0.1]);

    this.addBodyPart({
      id: 'grip', name: 'Textured grip', category: 'Body', parent: 'Exterior', stage: 18, duration: 34,
      description: 'Deep right-hand grip with a stippled rubber surface for secure one-handed holding.',
    }, [
      box(1.06, 2.98, 1.34, m('grip'), 0.25, [2.0, -0.02, 0.16]),
      box(1.13, 2.72, 0.36, m('grip'), 0.16, [1.96, -0.08, 0.62]),
      textPlane('CONCEPT', 0.64, 0.12, { color: '#aaa59c', fontSize: 82 }),
    ], [2.0, 0.0, 0.8], [0, 0.1, 0]);
    const gripMark = this.components.at(-1)?.group.children.at(-1);
    if (gripMark) gripMark.position.set(1.97, -1.02, 0.815);

    this.addBodyPart({
      id: 'rearLCD', name: 'Rear LCD and frame', category: 'Electronics', parent: 'Exterior', stage: 42, duration: 40,
      description: 'Rear display assembly used for composition, playback, and menus. Its simplified frame nests in the rear shell.',
    }, [
      rectFrame(3.04, 2.06, 2.76, 1.78, 0.16, m('plastic'), [0, -0.08, -0.68], 0.11),
      box(2.75, 1.77, 0.055, m('lcdOff'), 0.055, [0, -0.08, -0.70]),
    ], [2.75, -0.15, -2.15], [0.05, -0.18, 0.04]);

    this.addBodyPart({
      id: 'evf', name: 'EVF and eyecup', category: 'Body', parent: 'Exterior', stage: 46, duration: 38,
      description: 'Electronic viewfinder housing centered over the optical axis, with a soft rear eyecup.',
    }, [
      box(1.34, 0.64, 1.13, m('graphite'), 0.18, [MOUNT_X, 1.8, -0.03]),
      rectFrame(1.22, 0.68, 0.88, 0.42, 0.18, m('blackMatte'), [MOUNT_X, 1.77, -0.69], 0.15),
      box(0.87, 0.41, 0.04, m('lcdOff'), 0.06, [MOUNT_X, 1.77, -0.64]),
    ], [0, 2.3, -0.65], [-0.08, 0, 0]);

    this.addBodyPart({
      id: 'shutterButton', name: 'Shutter button', category: 'Body', parent: 'Exterior', stage: 36, duration: 32,
      description: 'Two-step release above the grip: a half press typically meters and focuses, a full press exposes.',
    }, [
      cylinder(0.22, 0.24, 0.10, m('darkMetal'), [1.94, 1.64, 0.40], 48, 'y'),
      cylinder(0.155, 0.17, 0.075, m('brushed'), [1.94, 1.725, 0.40], 48, 'y'),
    ], [1.4, 1.8, 0.8]);

    this.addBodyPart({
      id: 'modeDial', name: 'Mode dial', category: 'Body', parent: 'Exterior', stage: 36, duration: 32,
      description: 'Knurled top dial for selecting exposure and operating modes.',
    }, this.makeDial(-1.72, 1.67, -0.09, 0.34), [-1.0, 1.8, -0.4]);

    this.addBodyPart({
      id: 'controlDial', name: 'Control dial', category: 'Body', parent: 'Exterior', stage: 36, duration: 32,
      description: 'Rear command wheel for adjusting exposure settings and navigating menus.',
    }, [
      cylinder(0.32, 0.32, 0.10, m('darkMetal'), [1.69, 0.72, -0.69], 48),
      cylinder(0.265, 0.265, 0.105, m('brushed'), [1.69, 0.72, -0.72], 48),
      cylinder(0.08, 0.08, 0.11, m('darkMetal'), [1.69, 0.72, -0.73], 32),
    ], [2.0, 0.7, -1.25]);

    this.addBodyPart({
      id: 'hotShoe', name: 'Hot shoe', category: 'Body', parent: 'Exterior', stage: 48, duration: 35,
      description: 'Standard accessory rails and representative electrical contacts atop the viewfinder housing.',
    }, [
      box(0.68, 0.055, 0.64, m('darkMetal'), 0.018, [MOUNT_X, 2.125, -0.07]),
      box(0.055, 0.07, 0.62, m('silver'), 0.01, [MOUNT_X - 0.28, 2.16, -0.07]),
      box(0.055, 0.07, 0.62, m('silver'), 0.01, [MOUNT_X + 0.28, 2.16, -0.07]),
      ...Array.from({ length: 5 }, (_, i) => cylinder(0.025, 0.025, 0.018, m('gold'), [MOUNT_X + (i - 2) * 0.09, 2.165, 0.05], 12, 'y')),
    ], [0, 2.65, -0.55]);

    this.addBodyPart({
      id: 'battery', name: 'Battery', category: 'Electronics', parent: 'Exterior', stage: 50, duration: 36,
      description: 'Representative rechargeable cell that slides into the grip-side battery compartment.',
    }, [
      box(0.83, 1.86, 0.83, m('darkMetal'), 0.08, [1.82, -0.31, -0.03]),
      box(0.68, 0.26, 0.69, m('plastic'), 0.035, [1.82, 0.71, -0.03]),
    ], [1.15, -2.4, -0.25], [0, 0, -0.12]);

    this.addBodyPart({
      id: 'batteryDoor', name: 'Battery door', category: 'Body', parent: 'Exterior', stage: 48, duration: 34,
      description: 'Removable bottom cover with a simple sliding latch for the battery compartment.',
    }, [
      box(1.05, 0.07, 0.98, m('graphite'), 0.035, [1.77, -1.635, -0.03]),
      box(0.25, 0.025, 0.16, m('darkMetal'), 0.012, [1.77, -1.68, 0.26]),
    ], [1.1, -2.2, 0.6], [0.12, 0.1, 0]);

    const fasteners = [
      // Two small flange fasteners, one cover screw, and one bottom-plate screw.
      { position: [MOUNT_X - 1.04, OPTICAL_Y + 0.85, 0.579], axis: 'z' as const, offset: [-0.65, 0.45, 1.05], rotation: [0, 0, 0] as AxisRotation },
      { position: [MOUNT_X + 1.04, OPTICAL_Y - 0.85, 0.579], axis: 'z' as const, offset: [0.65, -0.45, 1.25], rotation: [0, 0, 0] as AxisRotation },
      { position: [-2.09, 0, 0.579], axis: 'z' as const, offset: [-0.85, 0.15, 1.45], rotation: [0, 0, 0] as AxisRotation },
      { position: [MOUNT_X + 0.48, -1.622, -0.13], axis: 'y' as const, offset: [0.45, -0.75, 0.35], rotation: [-Math.PI / 2, 0, 0.2] as AxisRotation },
    ];
    fasteners.forEach(({ position, axis, offset, rotation }, i) => {
      const fastener = screw(m('silver'), m('blackMatte'));
      fastener.position.set(...position as [number, number, number]);
      if (axis === 'y') fastener.rotation.x = Math.PI / 2;
      this.addBodyPart({
        id: `screw${i + 1}`, name: `Mounting screw ${i + 1}`, category: 'Hardware', parent: 'Exterior', stage: 62, duration: 28,
        description: 'Small cross-recessed fastener at a lens-mount flange, cover seam, or bottom-plate attachment point.',
      }, [fastener], offset as [number, number, number], rotation);
    });
  }

  private makeDial(x: number, y: number, z: number, radius: number) {
    const group = new THREE.Group();
    const body = cylinder(radius, radius, 0.19, this.material('darkMetal'), [x, y, z], 64, 'y');
    group.add(body, cylinder(radius * 0.88, radius * 0.88, 0.012, this.material('brushed'), [x, y + 0.101, z], 64, 'y'));
    const ridgeGeometry = new THREE.BoxGeometry(0.035, 0.13, 0.055);
    const ridges = new THREE.InstancedMesh(ridgeGeometry, this.material('blackMatte'), 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2;
      dummy.position.set(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius);
      dummy.rotation.set(0, -a, 0);
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
    }
    group.add(ridges);
    const mark = textPlane('M  A  S  P', radius * 1.2, 0.10, { color: '#e0d9cb', fontSize: 70 });
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(x, y + 0.111, z);
    group.add(mark);
    return group.children;
  }

  private buildInternals() {
    const m = (key: string) => this.material(key);
    const chassisChildren: THREE.Object3D[] = [rectFrame(4.04, 2.58, 3.36, 1.92, 0.14, m('darkMetal'), [0, -0.02, -0.02], 0.14)];
    for (const x of [-1.82, 1.82]) for (const y of [-1.03, 1.03]) {
      chassisChildren.push(cylinder(0.13, 0.13, 0.18, m('silver'), [x, y, -0.02], 24));
    }
    this.addBodyPart({
      id: 'chassis', name: 'Metal chassis', category: 'Body', parent: 'Internal body', stage: 26, duration: 48,
      description: 'Rigid inner frame with a central opening and mounting bosses for the sensor, electronics, and covers.',
    }, chassisChildren, [-0.5, 0, -0.35], [0, 0.04, 0]);

    this.addBodyPart({
      id: 'mainPCB', name: 'Main PCB', category: 'Electronics', parent: 'Internal body', stage: 44, duration: 42,
      description: 'Representative processor board with silicon packages, edge connectors, and procedural circuit traces.',
    }, [
      box(2.85, 1.84, 0.055, m('pcb'), 0.035, [0, -0.03, -0.31]),
      box(0.72, 0.72, 0.09, m('blackMatte'), 0.025, [-0.35, 0.05, -0.245]),
      box(0.42, 0.5, 0.07, m('darkMetal'), 0.02, [0.7, 0.35, -0.25]),
      box(1.25, 0.13, 0.10, m('plastic'), 0.018, [0.45, -0.85, -0.22]),
      ...Array.from({ length: 6 }, (_, i) => box(0.13, 0.22, 0.045, m('darkMetal'), 0.01, [-1.14 + i * 0.40, 0.63, -0.25]))
    ], [-2.6, 0.1, -1.55], [0, -0.12, -0.04]);

    this.addBodyPart({
      id: 'sensorPCB', name: 'Sensor PCB', category: 'Electronics', parent: 'Internal body', stage: 48, duration: 40,
      description: 'Small circuit carrier behind the sensor, connecting its readout electronics to the main board.',
    }, [
      box(2.10, 1.56, 0.065, m('pcb'), 0.035, [MOUNT_X, OPTICAL_Y, -0.14]),
      ...Array.from({ length: 8 }, (_, i) => box(0.07, 0.13, 0.035, m('gold'), 0.006, [MOUNT_X - 0.7 + i * 0.2, -0.56, -0.09])),
    ], [-1.15, 0, -1.05]);

    this.addBodyPart({
      id: 'sensor', name: 'Image sensor', category: 'Electronics', parent: 'Internal body', stage: 54, duration: 40,
      description: 'Rectangular 3:2 imaging surface with a reflective, simplified microcoated finish. The shutter sits directly in front.',
    }, [
      box(1.76, 1.21, 0.075, m('darkMetal'), 0.04, [MOUNT_X, OPTICAL_Y, 0.005]),
      box(1.62, 1.08, 0.015, m('sensorFace'), 0.008, [MOUNT_X, OPTICAL_Y, 0.054]),
    ], [0, 0, -0.78]);

    const shutterChildren: THREE.Object3D[] = [rectFrame(2.12, 1.52, 1.76, 1.16, 0.10, m('darkMetal'), [MOUNT_X, OPTICAL_Y, 0.27], 0.07)];
    for (let i = 0; i < 6; i++) {
      const blade = box(1.72, 0.195, 0.008, m('shutter'), 0.002, [MOUNT_X, OPTICAL_Y + (i - 2.5) * 0.19, 0.283 + (i % 2) * 0.005]);
      this.shutters.push({ mesh: blade, baseY: blade.position.y, direction: i < 3 ? -1 : 1 });
      shutterChildren.push(blade);
    }
    this.addBodyPart({
      id: 'shutter', name: 'Focal-plane shutter', category: 'Electronics', parent: 'Internal body', stage: 50, duration: 38,
      description: 'Two simplified blade curtains directly ahead of the sensor. Release separates them briefly to expose the imaging surface.',
    }, shutterChildren, [0, 0, 0.78]);

    const contacts = Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI * 1.17 + i * 0.055;
      return box(0.052, 0.09, 0.028, m('gold'), 0.006, [MOUNT_X + Math.cos(a) * 1.035, OPTICAL_Y + Math.sin(a) * 1.035, 0.67]);
    });
    this.addBodyPart({
      id: 'lensMount', name: 'Lens mount and contacts', category: 'Hardware', parent: 'Internal body', stage: 10, duration: 34,
      description: 'Machined bayonet ring with three locking tabs and a representative row of electrical contacts.',
    }, [
      ring(1.24, 1.045, 0.12, m('silver'), [MOUNT_X, OPTICAL_Y, 0.61]),
      ...[0, 1, 2].map(i => {
        const a = i / 3 * Math.PI * 2 + 0.3;
        const tab = box(0.28, 0.11, 0.052, m('silver'), 0.012, [MOUNT_X + Math.cos(a) * 1.14, OPTICAL_Y + Math.sin(a) * 1.14, 0.70]);
        tab.rotation.z = a + Math.PI / 2;
        return tab;
      }),
      ...contacts,
    ], [0, 0, 0.95]);
  }

  private buildLens() {
    const m = (key: string) => this.material(key);
    this.addBodyPart({
      id: 'lensRearMount', name: 'Lens rear mounting ring', category: 'Optics', parent: 'Lens', stage: 0, duration: 30,
      description: 'Rear metal bayonet that locks the detachable prime lens to the camera mount.',
    }, [
      ring(1.10, 0.88, 0.19, m('darkMetal'), [MOUNT_X, OPTICAL_Y, 0.77]),
      ring(1.14, 1.055, 0.055, m('silver'), [MOUNT_X, OPTICAL_Y, 0.875]),
    ], [0, 0, 0.75]);

    this.addBodyPart({
      id: 'lensBarrel', name: 'Outer lens barrel', category: 'Optics', parent: 'Lens', stage: 20, duration: 45,
      description: 'Hollow machined barrel supporting the optical cells and focusing mechanism without obscuring the glass.',
    }, [
      ring(1.17, 0.96, 0.68, m('lensBody'), [MOUNT_X, OPTICAL_Y, 1.13]),
      ring(1.18, 1.0, 0.44, m('lensBody'), [MOUNT_X, OPTICAL_Y, 2.45]),
      ring(1.20, 1.105, 0.07, m('brushed'), [MOUNT_X, OPTICAL_Y, 1.27]),
      ring(1.20, 1.10, 0.055, m('brushed'), [MOUNT_X, OPTICAL_Y, 2.25]),
    ], [0, 0, 1.75]);

    const focusParts: THREE.Object3D[] = [ring(1.205, 1.08, 0.72, m('lensBody'), [MOUNT_X, OPTICAL_Y, 1.78])];
    const ridgeGeometry = new THREE.BoxGeometry(0.032, 0.055, 0.64);
    const ridges = new THREE.InstancedMesh(ridgeGeometry, m('lensBody'), 104);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 104; i++) {
      const a = i / 104 * Math.PI * 2;
      dummy.position.set(MOUNT_X + Math.cos(a) * 1.212, OPTICAL_Y + Math.sin(a) * 1.212, 1.78);
      dummy.rotation.set(0, 0, a - Math.PI / 2);
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
    }
    focusParts.push(ridges);
    this.addBodyPart({
      id: 'focusRing', name: 'Focus ring', category: 'Optics', parent: 'Lens', stage: 28, duration: 46,
      description: 'Wide manual-focus collar with fine axial ribs represented by a single instanced mesh.',
    }, focusParts, [0, 0, 2.3]);

    this.addBodyPart({
      id: 'aperture', name: 'Aperture assembly', category: 'Optics', parent: 'Lens', stage: 38, duration: 48,
      description: 'Nine overlapping blades form a variable opening. This control is a schematic iris, not an optical exposure simulation.',
      iris: true,
    }, [this.iris.group], [0, 0, 3.05]);
    this.iris.group.position.set(MOUNT_X, OPTICAL_Y, 1.42);

    this.addBodyPart({
      id: 'lensFrontRing', name: 'Front retaining ring', category: 'Optics', parent: 'Lens', stage: 42, duration: 46,
      description: 'Machined front cell with a filter-seat lip that retains the front optical element.',
    }, [
      ring(1.185, 1.015, 0.14, m('lensBody'), [MOUNT_X, OPTICAL_Y, 2.88]),
      ring(1.17, 1.055, 0.035, m('brushed'), [MOUNT_X, OPTICAL_Y, 2.965]),
    ], [0, 0, 4.45]);

    const opticalGroups: [number, number, number][] = [
      // z, radius, thickness; front to rear along the shared Z optical axis.
      [2.71, 1.015, 0.15], [2.33, 0.91, 0.13], [1.97, 0.78, 0.12],
      [1.67, 0.72, 0.105], [1.18, 0.91, 0.12], [0.94, 0.78, 0.10],
    ];
    // Keep the glass almost clear; subtle thin-film variation supplies the coating color.
    const glassTints = ['#deedf7', '#deeee2', '#e9e0f3', '#deebf3', '#e2ecdd', '#e1e6f4'];
    opticalGroups.forEach(([z, radius, thickness], i) => {
      const glassMaterial = (m('glass') as THREE.MeshPhysicalMaterial).clone();
      glassMaterial.color.set(glassTints[i]);
      glassMaterial.name = `multicoated-glass-${i + 1}`;
      const lens = opticalElement(radius, thickness, glassMaterial);
      lens.position.set(MOUNT_X, OPTICAL_Y, z);
      this.glassElements.push(lens);
      this.addBodyPart({
        id: `element${i + 1}`, name: `Optical element ${i + 1}`, category: 'Optics', parent: 'Lens', stage: Math.min(56, 42 + i * 3), duration: 44,
        description: `Curved glass element ${i + 1} in the conceptual six-element prime. Geometry and coating are illustrative.`,
      }, [lens], [0, 0, 0.75 + (opticalGroups.length - 1 - i) * 0.58]);
    });

    [[2.08, 0.96], [1.34, 0.98]].forEach(([z, radius], i) => {
      this.addBodyPart({
        id: `spacer${i + 1}`, name: `Internal spacer ring ${i + 1}`, category: 'Optics', parent: 'Lens', stage: 54 + i * 5, duration: 38,
        description: 'Blackened internal annulus maintaining separation between optical groups and limiting stray light.',
      }, [
        ring(radius + 0.05, radius - 0.07, 0.055, m('blackMatte'), [MOUNT_X, OPTICAL_Y, z]),
      ], [0, 0, 2.4 + i * 0.45]);
    });
  }

  private buildRayPaths() {
    this.rayGroup.name = 'Schematic light paths';
    this.rayGroup.visible = false;
    const geometry = new THREE.CylinderGeometry(0.006, 0.006, 1, 6);
    for (let i = 0; i < 5; i++) {
      const ray = new THREE.Mesh(geometry, this.material('ray'));
      ray.userData.angle = i / 5 * Math.PI * 2;
      ray.raycast = () => undefined;
      this.rayGroup.add(ray);
    }
    this.root.add(this.rayGroup);
  }

  updateRays(_dt: number, time: number) {
    if (!this.rayGroup.visible) return;
    const front = this.components.find(component => component.id === 'lensFrontRing');
    const sensor = this.components.find(component => component.id === 'sensor');
    const startZ = 2.96 + (front?.group.position.z ?? 0);
    const endZ = 0.07 + (sensor?.group.position.z ?? 0);
    const up = new THREE.Vector3(0, 1, 0);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3(MOUNT_X, OPTICAL_Y, endZ);
    const direction = new THREE.Vector3();
    (this.material('ray') as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(time * 2.5) * 0.1;
    for (const object of this.rayGroup.children) {
      const ray = object as THREE.Mesh;
      const angle = ray.userData.angle as number;
      start.set(MOUNT_X + Math.cos(angle) * 0.7, OPTICAL_Y + Math.sin(angle) * 0.7, startZ);
      direction.subVectors(end, start);
      const length = direction.length();
      ray.position.copy(start).addScaledVector(direction, 0.5);
      ray.quaternion.setFromUnitVectors(up, direction.normalize());
      ray.scale.set(1, length, 1);
    }
  }

  getAllInteractables() {
    return this.components.filter(component => component.group.visible).map(component => component.selectRoot ?? component.group);
  }

  setIsolation(ids: string[] | null) {
    for (const component of this.components) component.group.visible = !ids || ids.includes(component.id);
  }

  isSoleSelection(id: string) {
    const visible = this.components.filter(component => component.group.visible);
    return visible.length === 1 && visible[0]?.id === id;
  }

  hasIsolation() {
    return this.components.some(component => !component.group.visible);
  }

  setExplosion(id: string, value: number) {
    const component = this.components.find(item => item.id === id);
    if (!component) return;
    const local = THREE.MathUtils.clamp((value - component.stage) / component.duration, 0, 1);
    const eased = local * local * (3 - 2 * local);
    component.group.userData.stage = local;
    component.group.position.fromArray(component.group.userData.assembledPosition as number[]);
    const offset = new THREE.Vector3().fromArray(component.group.userData.explodedOffset as number[]);
    component.group.position.addScaledVector(offset, eased);
    component.group.quaternion.fromArray(component.group.userData.assembledQuaternion as number[]);
    const explodedQuaternion = new THREE.Quaternion().fromArray(component.group.userData.explodedQuaternion as number[]);
    component.group.quaternion.slerp(explodedQuaternion, eased);
  }

  interpolateExplosion(factor: number) {
    for (const component of this.components) this.setExplosion(component.id, factor);
    this.root.updateMatrixWorld(true);
  }

  getBounds(ids?: string[]) {
    const bounds = new THREE.Box3();
    const selected = ids ? this.components.filter(component => ids.includes(component.id)) : this.components;
    for (const component of selected) {
      component.group.updateWorldMatrix(true, true);
      bounds.union(new THREE.Box3().setFromObject(component.group, true));
    }
    return bounds;
  }

  getBoundsAt(value: number, ids?: string[]) {
    return this.getFitGeometryAt(value, ids).bounds;
  }

  /** Per-mesh corners avoid projecting the empty corners of the whole exploded Box3. */
  getFitGeometryAt(value: number, ids?: string[]) {
    const snapshot = this.components.map(component => ({
      component,
      position: component.group.position.clone(),
      quaternion: component.group.quaternion.clone(),
      stage: component.group.userData.stage,
    }));
    this.interpolateExplosion(value);
    const bounds = this.getBounds(ids);
    const points: THREE.Vector3[] = [];
    const selected = ids ? this.components.filter(component => ids.includes(component.id)) : this.components;
    for (const component of selected) {
      component.group.updateWorldMatrix(true, true);
      component.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object instanceof THREE.InstancedMesh) object.computeBoundingBox();
        else {
          if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        }
        const localBounds = object instanceof THREE.InstancedMesh ? object.boundingBox : object.geometry.boundingBox;
        if (!localBounds) return;
        for (const x of [localBounds.min.x, localBounds.max.x]) {
          for (const y of [localBounds.min.y, localBounds.max.y]) {
            for (const z of [localBounds.min.z, localBounds.max.z]) {
              points.push(new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld));
            }
          }
        }
      });
    }
    for (const item of snapshot) {
      item.component.group.position.copy(item.position);
      item.component.group.quaternion.copy(item.quaternion);
      item.component.group.userData.stage = item.stage;
    }
    this.root.updateMatrixWorld(true);
    return { bounds, points };
  }

  get sensorExposed() { return this.exposed; }

  releaseShutter() {
    this.shutterStart = performance.now();
  }

  animateShutter() {
    if (this.shutterStart === null) return;
    const elapsed = (performance.now() - this.shutterStart) / 1000;
    let amount = 0;
    if (elapsed < 0.22) amount = elapsed / 0.22;
    else if (elapsed < 1.05) amount = 1;
    else if (elapsed < 1.35) amount = 1 - (elapsed - 1.05) / 0.3;
    else {
      this.shutterStart = null;
      this.exposed = false;
    }
    const eased = THREE.MathUtils.clamp(amount, 0, 1);
    for (const blade of this.shutters) blade.mesh.position.y = blade.baseY + blade.direction * eased * 0.55;
    this.exposed = eased > 0.85;
  }

  setHighlight(id: string | null) {
    if (this.highlightedId === id) return;
    for (const [mesh, material] of this.highlightedMaterials) {
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
      mesh.material = material;
    }
    this.highlightedMaterials.clear();
    this.highlightedId = id;
    if (!id) return;
    const component = this.components.find(item => item.id === id);
    component?.group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const source = object.material;
      if (!(source instanceof THREE.MeshStandardMaterial)) return;
      this.highlightedMaterials.set(object, source);
      const material = source.clone();
      material.emissive.set('#5a3d20');
      material.emissiveIntensity = 0.25;
      object.material = material;
    });
  }

  applyViewMode(mode: 'materials' | 'technical' | 'xray') {
    this.setHighlight(null);
    const translucent = new Set(['frontShell', 'rearShell', 'topPlate', 'bottomPlate', 'grip', 'evf', 'lensBarrel', 'focusRing', 'lensFrontRing']);
    for (const component of this.components) {
      component.group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const original = this.originalMaterials.get(object);
        if (!original) return;
        object.material = original;
        if (mode === 'technical') {
          const source = Array.isArray(original) ? original[0] : original;
          const dark = source instanceof THREE.MeshStandardMaterial && source.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.2;
          object.material = this.material(dark ? 'techDark' : 'tech');
        } else if (mode === 'xray' && translucent.has(component.id)) {
          object.material = this.material('xrayShell');
        }
      });
    }
    for (const edge of this.technicalEdges) edge.visible = mode === 'technical';
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>(this.materials.values());
    const textures = new Set<THREE.Texture>();
    const collectOriginal = (original: THREE.Material | THREE.Material[]) => {
      (Array.isArray(original) ? original : [original]).forEach(material => materials.add(material));
    };
    this.originalMaterials.forEach(collectOriginal);
    this.highlightedMaterials.forEach(collectOriginal);
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) geometries.add(object.geometry);
      if (object instanceof THREE.Mesh) {
        const values = Array.isArray(object.material) ? object.material : [object.material];
        values.forEach(material => materials.add(material));
      }
    });
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    geometries.forEach(geometry => geometry.dispose());
    this.technicalEdges.forEach(edge => edge.geometry.dispose());
    textures.forEach(texture => texture.dispose());
  }
}
