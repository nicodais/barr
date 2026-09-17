import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleView } from '../vehicle/vehicleMesh';

/** Supplied by Game: traffic and the garage share one vehicle asset pipeline. */
export type TrafficModelFactory = (variant: number) => VehicleView;
interface Batch { mesh: THREE.InstancedMesh; wheel: number; base: THREE.Matrix4 }
export class TrafficFleet {
  readonly group = new THREE.Group();
  private variants: Array<{ view: VehicleView; batches: Batch[]; count: number }> = [];
  private matrix = new THREE.Matrix4();
  private spin = new THREE.Matrix4();
  constructor(factory: TrafficModelFactory, capacity: number) {
    for (let variant = 0; variant < 2; variant++) {
      const view = factory(variant);
      view.root.updateMatrixWorld(true);
      const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const batches: Batch[] = [];
      const add = (geometry: THREE.BufferGeometry, material: THREE.Material, wheel: number, base: THREE.Matrix4) => {
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = true;
        this.group.add(mesh);
        batches.push({ mesh, wheel, base });
      };
      view.root.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        const material = obj.material as THREE.Material;
        const wheel = view.wheels.findIndex(w => { let parent: THREE.Object3D | null = obj; while (parent) { if (parent === w) return true; parent = parent.parent; } return false; });
        const geo = obj.geometry.clone();
        // Normalize attributes before merging rounded bodywork and axle meshes.
        for (const key of Object.keys(geo.attributes)) if (key !== 'position' && key !== 'normal') geo.deleteAttribute(key);
        if (wheel >= 0) {
          const base = view.wheels[wheel].matrixWorld.clone();
          geo.applyMatrix4(base.clone().invert().multiply(obj.matrixWorld));
          add(geo, material, wheel, base);
        } else {
          geo.applyMatrix4(obj.matrixWorld);
          let bucket = buckets.get(material);
          if (!bucket) buckets.set(material, bucket = []);
          bucket.push(geo.index ? geo.toNonIndexed() : geo);
          if (geo.index) geo.dispose();
        }
      });
      for (const [material, geos] of buckets) {
        const merged = mergeGeometries(geos, false);
        geos.forEach(g => g.dispose());
        if (merged) add(merged, material, -1, new THREE.Matrix4());
      }
      this.variants.push({ view, batches, count: 0 });
    }
  }
  begin() { for (const variant of this.variants) variant.count = 0; }
  setMatrixAt(index: number, ground: THREE.Matrix4, spin: number) {
    const variant = this.variants[index % this.variants.length];
    const slot = variant.count++;
    const origin = ground.clone().multiply(new THREE.Matrix4().makeTranslation(0, variant.view.rideHeight, 0));
    this.spin.makeRotationX(spin);
    for (const batch of variant.batches) {
      this.matrix.copy(origin);
      if (batch.wheel >= 0) this.matrix.multiply(batch.base).multiply(this.spin);
      batch.mesh.setMatrixAt(slot, this.matrix);
    }
  }
  end() {
    for (const variant of this.variants) for (const batch of variant.batches) {
      batch.mesh.count = variant.count;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() {
    for (const variant of this.variants) {
      for (const batch of variant.batches) { batch.mesh.geometry.dispose(); batch.mesh.dispose(); }
      variant.view.dispose();
    }
    this.group.clear();
  }
}
