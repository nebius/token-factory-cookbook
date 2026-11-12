import * as THREE from 'three';
import { ring } from './geometry';

/**
 * Schematic nine-blade iris. Overlapping annular sectors share the optical
 * axis; their inner radius and skew change together with the f-stop.
 */
export class Iris {
  readonly group = new THREE.Group();
  private blades: THREE.Mesh[] = [];
  private current = 1.8;
  private target = 1.8;

  constructor() {
    this.group.add(ring(1.02, 0.87, 0.045, new THREE.MeshStandardMaterial({ color: '#45484a', metalness: 0.88, roughness: 0.34 })));
    for (let i = 0; i < 9; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: i % 2 ? '#353b3d' : '#484c4b',
        metalness: 0.78,
        roughness: 0.46,
        side: THREE.DoubleSide,
      });
      const blade = new THREE.Mesh(new THREE.BufferGeometry(), material);
      blade.position.z = 0.026 + i * 0.0025;
      this.group.add(blade);
      this.blades.push(blade);
    }
    this.set(1.8, true);
  }

  set(f: number, immediate = false) {
    this.target = THREE.MathUtils.clamp(f, 1.8, 16);
    if (immediate) this.current = this.target;
    if (immediate) this.updateGeometry();
  }

  update(dt: number) {
    const next = THREE.MathUtils.damp(this.current, this.target, 12, dt);
    if (Math.abs(next - this.current) > 0.001) {
      this.current = next;
      this.updateGeometry();
    }
  }

  private updateGeometry() {
    const openingRadius = 0.075 + (16 - this.current) / 14.2 * 0.66;
    const skew = (this.current - 1.8) / 14.2 * 0.19;
    const halfSpan = THREE.MathUtils.degToRad(29);
    for (let i = 0; i < this.blades.length; i++) {
      const blade = this.blades[i];
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 0.94, -halfSpan, halfSpan, false);
      shape.absarc(0, 0, openingRadius, halfSpan, -halfSpan, true);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 8 });
      blade.geometry.dispose();
      blade.geometry = geometry;
      blade.rotation.z = i / this.blades.length * Math.PI * 2 + skew;
    }
  }

  get fNumber() { return this.target; }
  get visualFNumber() { return this.current; }
  get isAnimating() { return Math.abs(this.current - this.target) > 0.02; }
}
