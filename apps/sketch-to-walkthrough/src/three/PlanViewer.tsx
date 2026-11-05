import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { buildWorld, disposeWorld } from '../lib/world';
import { planBounds } from '../lib/plan-svg';
import { runChecks } from '../lib/checks';
import { collides, getWalkSpawn, minimumWallDistance } from '../lib/walkthrough';
import type { PlanSpec } from '../lib/plan';
import { pointInPolygon } from '../lib/furniture';

export type ViewMode = 'plan' | 'dollhouse' | 'walk';
export type ViewerHandle = {
  reset: () => void;
  startWalk: () => void;
  setJoystick: (x: number, y: number) => void;
};
type Props = { plan: PlanSpec; mode: ViewMode; labels: boolean; onLocked?: (locked: boolean) => void; className?: string };

export const PlanViewer = forwardRef<ViewerHandle, Props>(function PlanViewer({ plan, mode, labels, onLocked, className = '' }, forwardedRef) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ViewerHandle | null>(null);
  const callbacks = useRef({ onLocked }); callbacks.current.onLocked = onLocked;
  const stateRef = useRef({ plan, mode, labels }); stateRef.current = { plan, mode, labels };
  const runtime = useRef<{
    scene: THREE.Scene; renderer: THREE.WebGLRenderer; orbit: OrbitControls; pointer: PointerLockControls;
    top: THREE.OrthographicCamera; doll: THREE.PerspectiveCamera; walk: THREE.PerspectiveCamera;
    world: THREE.Group; keys: Set<string>; joystick: { x: number; y: number }; applyMode: () => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.97;
    renderer.setClearColor('#e9ece4'); renderer.domElement.setAttribute('aria-label', 'Interactive 3D floor plan viewer');
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9ece4');
    const hemisphere = new THREE.HemisphereLight('#f6f9ff', '#b1a487', 1.4); scene.add(hemisphere);
    const sun = new THREE.DirectionalLight('#fff5df', 2.4); sun.position.set(9, 17, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -14; sun.shadow.camera.right = 14; sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
    sun.shadow.normalBias = 0.03; sun.shadow.bias = -0.00015; sun.shadow.radius = 3; scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ color: '#e4e8df', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.24; ground.receiveShadow = true; scene.add(ground);
    const world = buildWorld(stateRef.current.plan, { labels: stateRef.current.labels, ceiling: stateRef.current.mode === 'walk', walkthrough: stateRef.current.mode === 'walk' });
    world.userData = { plan: stateRef.current.plan, labels: stateRef.current.labels, ceiling: stateRef.current.mode === 'walk' }; scene.add(world);
    const top = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.01, 250); top.up.set(0, 0, -1);
    const doll = new THREE.PerspectiveCamera(36, 1, 0.05, 250);
    const walk = new THREE.PerspectiveCamera(70, 1, 0.035, 130);
    const orbit = new OrbitControls(doll, renderer.domElement); orbit.enableDamping = true; orbit.dampingFactor = 0.065;
    orbit.maxPolarAngle = Math.PI / 2.04; orbit.minDistance = 3; orbit.maxDistance = 65;
    const pointer = new PointerLockControls(walk, renderer.domElement);
    pointer.addEventListener('lock', () => callbacks.current.onLocked?.(true));
    pointer.addEventListener('unlock', () => callbacks.current.onLocked?.(false));
    const keys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return; keys.add(event.code); if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code) && stateRef.current.mode === 'walk') event.preventDefault(); };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const clearKeys = () => keys.clear();
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clearKeys);
    let touch: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if (stateRef.current.mode === 'walk' && e.pointerType !== 'mouse') { touch = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); } };
    const move = (e: PointerEvent) => {
      if (!touch || stateRef.current.mode !== 'walk') return;
      walk.rotation.y -= (e.clientX - touch.x) * 0.006; walk.rotation.x = Math.max(-1.25, Math.min(1.25, walk.rotation.x - (e.clientY - touch.y) * 0.006));
      walk.rotation.order = 'YXZ'; touch = { x: e.clientX, y: e.clientY };
    };
    const up = () => touch = null;
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up);
    const r = { scene, renderer, orbit, pointer, top, doll, walk, world, keys, joystick: { x: 0, y: 0 }, applyMode: () => {} };
    runtime.current = r;
    const placeWalk = () => {
      const plan = stateRef.current.plan;
      const spawn = getWalkSpawn(plan);
      walk.position.set(spawn.position[0] / 1000, 1.6, -spawn.position[1] / 1000);
      walk.rotation.set(0, -THREE.MathUtils.degToRad(spawn.facing), 0, 'YXZ');
      host.dataset.spawn = spawn.position.map(Math.round).join(',');
      host.dataset.spawnRoom = spawn.roomId;
      host.dataset.spawnClearance = String(Math.round(spawn.clearance));
      host.dataset.spawnWallDistance = String(Math.round(minimumWallDistance(spawn.position, plan)));
    };
    const reset = () => {
      const b = planBounds(stateRef.current.plan), cx = (b.minX + b.maxX) / 2000, cz = -(b.minY + b.maxY) / 2000, span = Math.max(b.width, b.height) / 1000;
      top.position.set(cx, span * 2, cz); top.lookAt(cx, 0, cz);
      doll.position.set(cx + span * 1.02, span * 1.18, cz + span * 1.25); orbit.target.set(cx, 0.4, cz); orbit.update();
      placeWalk();
      if (resize) resize();
    };
    const resize = () => {
      const { width, height } = host.getBoundingClientRect(); if (!width || !height) return;
      renderer.setSize(width, height);
      const b = planBounds(stateRef.current.plan), aspect = width / height;
      const half = Math.max(b.height / 2000, b.width / 2000 / aspect) + 0.7;
      top.left = -half * aspect; top.right = half * aspect; top.top = half; top.bottom = -half; top.updateProjectionMatrix();
      doll.aspect = aspect; doll.updateProjectionMatrix(); walk.aspect = aspect; walk.updateProjectionMatrix();
      const camera = stateRef.current.mode === 'walk' ? walk : stateRef.current.mode === 'dollhouse' ? doll : top;
      r.world.traverse((object) => {
        if (!(object instanceof THREE.Sprite) || !object.userData.roomLabel) return;
        if (camera instanceof THREE.PerspectiveCamera) {
          const factor = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / height;
          const screenWidth = stateRef.current.mode === 'walk' ? 110 : 3200;
          const labelWidth = stateRef.current.mode === 'walk'
            ? Math.min(screenWidth * factor, (object.userData.maxWidthMM ?? 4000) / 1000)
            : Math.min(screenWidth / 1000, (object.userData.maxWidthMM ?? 4000) / 1000);
          object.scale.set(labelWidth, labelWidth * 240 / 512, 1);
        } else {
          const labelWidth = Math.min(210 * (camera.right - camera.left) / width, (object.userData.maxWidthMM ?? 4000) / 1000);
          object.scale.set(labelWidth, labelWidth * 240 / 512, 1);
        }
      });
      host.dataset.labelsOccluded = String(stateRef.current.mode === 'walk');
    };
    const observer = new ResizeObserver(resize); observer.observe(host); resize(); reset();
    r.applyMode = () => {
      const currentMode = stateRef.current.mode;
      r.world.traverse((object) => { if (object.userData.roomLabel) object.visible = true; });
      orbit.enabled = currentMode !== 'walk'; orbit.enableRotate = currentMode === 'dollhouse'; orbit.object = currentMode === 'plan' ? top : doll;
      if (currentMode !== 'walk' && pointer.isLocked) pointer.unlock();
      if (currentMode === 'walk') { placeWalk(); resize(); }
      else reset();
    };
    r.applyMode();
    handleRef.current = {
      reset,
      startWalk: () => { if (window.matchMedia('(pointer: fine)').matches) pointer.lock(); else callbacks.current.onLocked?.(true); },
      setJoystick: (x, y) => { r.joystick = { x, y }; },
    };
    let frame = 0, previous = performance.now(), first = true, lastTelemetry = 0;
    const animate = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
      if (stateRef.current.mode === 'walk') {
        const current: [number, number] = [walk.position.x * 1000, -walk.position.z * 1000];
        const currentRoom = stateRef.current.plan.rooms.find((room) => pointInPolygon(current, room.polygon))?.id;
        let visibleLabels = 0;
        r.world.traverse((object) => {
          if (!object.userData.roomLabel) return;
          object.visible = object.userData.roomId === currentRoom;
          if (object.visible) visibleLabels++;
        });
        host.dataset.visibleLabel = currentRoom ?? '';
        host.dataset.visibleLabels = String(visibleLabels);
        let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + r.joystick.y;
        let side = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + r.joystick.x;
        const norm = Math.max(1, Math.hypot(forward, side)); forward /= norm; side /= norm;
        const direction = walk.getWorldDirection(new THREE.Vector3()); direction.y = 0; direction.normalize();
        const right = new THREE.Vector3(-direction.z, 0, direction.x);
        const speed = (keys.has('ShiftLeft') ? 3900 : 2350) * dt;
        const delta = direction.multiplyScalar(forward * speed).add(right.multiplyScalar(side * speed));
        const next: [number, number] = [current[0] + delta.x, current[1] - delta.z];
        if (!collides(next, stateRef.current.plan)) { walk.position.x += delta.x / 1000; walk.position.z += delta.z / 1000; }
        else {
          if (!collides([next[0], current[1]], stateRef.current.plan)) walk.position.x += delta.x / 1000;
          if (!collides([walk.position.x * 1000, next[1]], stateRef.current.plan)) walk.position.z += delta.z / 1000;
        }
      } else orbit.update();
      renderer.render(scene, stateRef.current.mode === 'plan' ? top : stateRef.current.mode === 'dollhouse' ? doll : walk);
      if (first) { host.dataset.ready = 'true'; first = false; }
      if (stateRef.current.mode === 'walk' && now - lastTelemetry > 150) {
        host.dataset.position = `${Math.round(walk.position.x * 1000)},${Math.round(-walk.position.z * 1000)}`; lastTelemetry = now;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', clearKeys);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up);
      pointer.dispose(); orbit.dispose(); disposeWorld(r.world);
      ground.geometry.dispose(); (ground.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const r = runtime.current; if (!r) return;
    const ceiling = mode === 'walk';
    if (r.world.userData.plan === plan && r.world.userData.labels === labels && r.world.userData.ceiling === ceiling) return;
    disposeWorld(r.world); r.scene.remove(r.world);
    const world = buildWorld(plan, { labels, ceiling, walkthrough: mode === 'walk' }); world.userData = { plan, labels, ceiling }; r.world = world; r.scene.add(world);
    r.applyMode();
  }, [plan, labels, mode]);

  useEffect(() => { runtime.current?.applyMode(); }, [mode]);
  useImperativeHandle(forwardedRef, () => ({ reset: () => handleRef.current?.reset(), startWalk: () => handleRef.current?.startWalk(), setJoystick: (x, y) => handleRef.current?.setJoystick(x, y) }), []);
  return <div className={`viewer-host ${className}`} ref={hostRef} data-mode={mode} data-checks={runChecks(plan).ok ? 'pass' : 'fail'} data-furniture={plan.furniture.length} data-open-rooms={plan.rooms.filter((room) => room.kind !== 'indoor').map((room) => room.id).join(',')} />;
});
