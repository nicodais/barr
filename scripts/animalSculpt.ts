import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V = [number, number, number];
/** Anatomical surface builder; each limb keeps its hip pivot through batching. */
class Anatomy {
  constructor(private tubeSamples = 12) {}
  coat: THREE.BufferGeometry[] = [];
  dark: THREE.BufferGeometry[] = [];
  surfaces: Array<{ distance: (x: number, y: number, z: number) => number; color: THREE.Color }> = [];
  torso: THREE.BufferGeometry[] = [];
  leg = 0;
  pivot = new THREE.Vector3();
  add(geo: THREE.BufferGeometry, color: number, dark = false) {
    const count = geo.getAttribute('position').count;
    const tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3), pivots = new Float32Array(count * 3), legs = new Float32Array(count);
    for (let i = 0; i < count; i++) { tint.toArray(colors, i * 3); this.pivot.toArray(pivots, i * 3); legs[i] = this.leg; }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aHip', new THREE.BufferAttribute(pivots, 3));
    geo.setAttribute('aLeg', new THREE.BufferAttribute(legs, 1));
    (dark ? this.dark : this.torso).push(geo);
  }
  oval(size: V, at: V, color: number, tilt = 0, dark = false) {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    geo.scale(size[0] / 2, size[1] / 2, size[2] / 2); geo.rotateX(tilt); geo.translate(...at);
    this.add(geo, color, dark);
    if (!dark) {
      const r = size.map(n => n / 2), cs = Math.cos(tilt), sn = Math.sin(tilt);
      this.surfaces.push({ color: new THREE.Color(color), distance: (x, y, z) => {
        x -= at[0]; y -= at[1]; z -= at[2];
        const yy = y * cs + z * sn, zz = z * cs - y * sn;
        const k0 = Math.hypot(x / r[0], yy / r[1], zz / r[2]);
        const k1 = Math.hypot(x / (r[0]*r[0]), yy / (r[1]*r[1]), zz / (r[2]*r[2]));
        return k1 > 0.00001 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
      }});
    }
  }
  tube(points: V[], radii: number[], color: number, dark = false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    if (!dark) {
      const count = this.tubeSamples, samples = curve.getSpacedPoints(count);
      for (let i = 0; i < count; i++) {
        const a = samples[i], delta = samples[i + 1].clone().sub(a), length2 = delta.lengthSq();
        const radiusAt = (t: number) => { const f = t * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(f)); return THREE.MathUtils.lerp(radii[k], radii[k + 1], f - k); };
        const r0 = radiusAt(i / count), r1 = radiusAt((i + 1) / count);
        this.surfaces.push({ color: new THREE.Color(color), distance: (x, y, z) => {
          x -= a.x; y -= a.y; z -= a.z;
          const t = THREE.MathUtils.clamp((x*delta.x + y*delta.y + z*delta.z) / length2, 0, 1);
          return Math.hypot(x - delta.x*t, y - delta.y*t, z - delta.z*t) - THREE.MathUtils.lerp(r0, r1, t);
        }});
      }
    }
    const segments = 32, sides = 12;
    const frames = curve.computeFrenetFrames(segments, false);
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const p = curve.getPointAt(i / segments), f = i / segments * (radii.length - 1), a = Math.min(radii.length - 2, Math.floor(f));
      const r = THREE.MathUtils.lerp(radii[a], radii[a + 1], f - a);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const v = p.clone().addScaledVector(frames.normals[i], Math.cos(angle) * r).addScaledVector(frames.binormals[i], Math.sin(angle) * r);
        positions.push(v.x, v.y, v.z); uv.push(j / sides, i / segments);
        if (i < segments && j < sides) { const k = i * (sides + 1) + j; indices.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1); }
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals(); this.add(geo, color, dark);
  }
  smoothTorso() {
    if (!this.surfaces.length) return;
    const bounds = new THREE.Box3();
    for (const geo of this.torso) { geo.computeBoundingBox(); bounds.union(geo.boundingBox!); }
    bounds.expandByScalar(0.08);
    const extent = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
    const n = 112, material = new THREE.MeshBasicMaterial();
    const marching = new MarchingCubes(n, material, false, true, 240000);
    marching.isolation = 0;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = bounds.min.x + x / n * extent.x, py = bounds.min.y + y / n * extent.y, pz = bounds.min.z + z / n * extent.z;
      let distance = 100; const tint = this.surfaces[0].color.clone();
      for (const surface of this.surfaces) {
        const d = surface.distance(px, py, pz);
        const blend = py < extent.y * 0.40 ? 0.018 : 0.055;
        tint.lerp(surface.color, THREE.MathUtils.clamp(0.5 + 0.5 * (distance - d) / blend, 0, 1));
        const h = Math.max(0, blend - Math.abs(distance - d)) / blend;
        distance = Math.min(distance, d) - h * h * blend * 0.25;
      }
      const index = x + y * n + z * n * n;
      marching.field[index] = -distance;
      tint.toArray(marching.palette, index * 3);
    }
    marching.update();
    const geo = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'color']) {
      const a = marching.geometry.getAttribute(key);
      geo.setAttribute(key, new THREE.BufferAttribute((a.array as Float32Array).slice(0, marching.count * 3), 3));
    }
    geo.scale(extent.x / 2, extent.y / 2, extent.z / 2); geo.translate(centre.x, centre.y, centre.z);
    const count = geo.getAttribute('position').count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    geo.setAttribute('aLeg', new THREE.BufferAttribute(new Float32Array(count), 1));
    geo.setAttribute('aHip', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.coat.push(geo);
    this.torso.forEach(g => g.dispose()); marching.geometry.dispose(); material.dispose();
  }
  finish() {
    this.smoothTorso();
    const merge = (parts: THREE.BufferGeometry[]) => { const flat = parts.map(p => p.index ? p.toNonIndexed() : p); const result = mergeGeometries(flat, false)!; new Set([...parts, ...flat]).forEach(p => p.dispose()); result.computeBoundingSphere(); return result; };
    return { coat: merge(this.coat), dark: merge(this.dark) };
  }
}

export function buildCamel() {
  const b = new Anatomy(32), tan = 0xb89970, pale = 0xc3a77e, shade = 0x9c7e58;
  // Dromedary proportions from the supplied side photograph. The neck reaches
  // forward from a low chest; the small head sits below the single hump's peak.
  b.oval([.94, 1.02, 1.93], [0, 1.73, -.10], tan);
  b.oval([.84, .74, 1.45], [0, 1.48, -.20], tan);
  b.oval([.75, .94, .68], [0, 1.72, .65], tan, -.12);
  b.oval([.78, .81, .65], [0, 1.80, -.88], tan, .12);
  // A broad fat pad blends into the back, with an asymmetric rounded crest.
  b.oval([.85, 1.02, 1.48], [0, 2.00, -.14], tan);
  b.oval([.59, .78, .81], [0, 2.29, -.22], tan, -.18);
  b.tube([[0,1.64,.67],[0,1.56,1.03],[0,1.65,1.38],
    [0,1.97,1.71],[0,2.29,1.87],[0,2.46,1.94]],
    [.265,.245,.205,.165,.125,.105], tan);
  // Compact skull, deep jaw angle, shallow bridge and soft overhanging lip.
  b.oval([.255,.285,.34], [0,2.46,2.015], tan, -.08);
  b.oval([.225,.18,.35], [0,2.455,2.19], tan, -.06);
  b.oval([.215,.175,.28], [0,2.355,2.16], shade, .18);
  b.oval([.235,.16,.20], [0,2.447,2.347], pale, -.12);
  b.oval([.205,.10,.19], [0,2.363,2.336], pale, .04);
  b.tube([[-.096,2.393,2.29],[-.086,2.392,2.39],[0,2.392,2.432],
    [.086,2.392,2.39],[.096,2.393,2.29]], [.0025,.0035,.0035,.0035,.0025], 0x67513a, true);
  for (const side of [-1,1]) {
    // Small narrow oval ears, lying beside the poll instead of round knobs.
    b.oval([.105,.155,.07], [side*.14,2.535,1.914], tan, -.38);
    b.oval([.047,.080,.012], [side*.153,2.553,1.945], shade, -.38, true);
    b.oval([.038,.075,.095], [side*.112,2.49,2.078], shade, .05);
    b.oval([.012,.023,.033], [side*.147,2.49,2.08], 0x2b241c, .05, true);
    // Brow is coat, not the old dark cartoon eyebrow floating above the eye.
    b.oval([.045,.037,.085], [side*.111,2.516,2.08], tan);
    b.oval([.012,.018,.049], [side*.111,2.487,2.356], 0x6c553c, -.28, true);
    for (const front of [true,false]) {
      const x=side*.29, z=front?.66:-.85;
      b.leg=side>0?1:2; b.pivot.set(x,1.67,z);
      // Long, mostly straight foreleg; a distinct rear hock beneath the thigh.
      const points: V[] = front
        ? [[x,1.76,z],[x,1.38,z-.015],[x,.96,z+.01],[x,.47,z+.035],[x,.12,z+.095]]
        : [[x,1.80,z],[x,1.40,z+.13],[x,1.03,z-.17],[x,.51,z-.08],[x,.12,z+.045]];
      b.tube(points, front?[.155,.115,.071,.045,.05]:[.185,.133,.072,.047,.05], tan);
      b.oval([.14,.15,.14], [x,front?.96:1.03,z+(front?.01:-.17)], shade);
      // Pads taper into the pastern. No ring around the ankle or button toes.
      b.oval([.225,.125,.295], [x,.066,z+.14], pale);
      for(const toe of [-1,1]) b.oval([.050,.024,.035],
        [x+toe*.052,.042,z+.264], 0x877153, 0, true);
    }
  }
  b.leg=0;
  b.tube([[0,1.91,-1.08],[.015,1.62,-1.20],[.035,1.23,-1.25],[.035,.91,-1.28]],
    [.037,.03,.019,.013], tan);
  b.tube([[.035,1.12,-1.26],[.035,.94,-1.29],[.015,.81,-1.29]], [.026,.038,.007], 0x66513b);
  const parts=b.finish(), p=parts.coat.getAttribute('position'), colors=parts.coat.getAttribute('color');
  const tint=new THREE.Color(), crest=new THREE.Color(0x80694e), underside=new THREE.Color(0xa58c68);
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    tint.setRGB(colors.getX(i),colors.getY(i),colors.getZ(i));
    // Dark coarse hair along the hump ridge and a dusty shaded underside.
    const ridge=THREE.MathUtils.smoothstep(y,2.42,2.67)*(1-THREE.MathUtils.smoothstep(Math.abs(x),.035,.16));
    tint.lerp(crest,ridge*.8);
    const belly=(1-THREE.MathUtils.smoothstep(y,1.16,1.45))*(1-THREE.MathUtils.smoothstep(Math.abs(z+.1),.65,1.0));
    tint.lerp(underside,belly*.22);
    colors.setXYZ(i,tint.r,tint.g,tint.b);
  }
  return parts;
}

export function buildGazelle() {
  const b = new Anatomy(), tan = 0xb69465, pale = 0xe5d8bc, dark = 0x42362c;
  b.oval([0.40, 0.48, 1.02], [0, 0.88, -0.08], tan);
  b.oval([0.34, 0.28, 0.85], [0, 0.735, -0.07], pale);
  b.oval([0.38, 0.44, 0.42], [0, 0.89, -0.42], tan);
  b.tube([[0, 0.92, 0.3], [0, 1.16, 0.42], [0, 1.37, 0.50]], [0.15, 0.10, 0.074], tan);
  b.oval([0.19, 0.23, 0.34], [0, 1.40, 0.59], tan, 0.35);
  b.oval([0.115, 0.12, 0.23], [0, 1.32, 0.74], tan, 0.3);
  b.oval([0.075, 0.040, 0.040], [0, 1.285, 0.85], dark, 0, true);
  for (const side of [-1, 1]) {
    b.oval([0.018, 0.029, 0.044], [side * 0.093, 1.44, 0.61], 0x151311, 0, true);
    b.oval([0.11, 0.22, 0.085], [side * 0.13, 1.55, 0.48], tan, -0.38);
    b.oval([0.056, 0.14, 0.017], [side * 0.13, 1.57, 0.51], pale, -0.38);
    b.tube([[side * 0.066, 1.49, 0.53], [side * 0.085, 1.69, 0.43], [side * 0.09, 1.85, 0.44], [side * 0.075, 1.91, 0.49]], [0.028, 0.022, 0.012, 0.001], dark, true);
    const horn=new THREE.CatmullRomCurve3([[side*.066,1.49,.53],[side*.085,1.69,.43],[side*.09,1.85,.44],[side*.075,1.91,.49]].map(p=>new THREE.Vector3(...p)));
    for(let i=0;i<9;i++) {
      const t=.06+i*.063, pos=horn.getPointAt(t), tangent=horn.getTangentAt(t);
      const collar=new THREE.TorusGeometry(.027-t*.018,.0028,6,16);
      collar.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),tangent));collar.translate(pos.x,pos.y,pos.z);b.add(collar,dark,true);
    }

    for (const front of [true, false]) {
      const x = side * 0.15, z = front ? 0.3 : -0.4;
      b.leg = (side > 0) === front ? 1 : 2; b.pivot.set(x, 0.86, z);
      b.tube([[x, 0.9, z], [x, 0.58, z + (front ? 0.015 : -0.1)], [x, 0.32, z + 0.04], [x, 0.07, z]], [0.067, 0.036, 0.022, 0.019], tan);
      b.oval([0.075, 0.095, 0.095], [x, 0.048, z + 0.014], dark, 0, true);
    }
  }
  b.leg = 0;
  b.tube([[0, 1.00, -0.53], [0, 0.92, -0.70], [0, 0.75, -0.74]], [0.035, 0.027, 0.008], dark, true);
  const parts=b.finish(), p=parts.coat.getAttribute('position'), color=parts.coat.getAttribute('color');
  const stripe=new THREE.Color(0x715039), tint=new THREE.Color();
  for(let i=0;i<p.count;i++) {
    const x=Math.abs(p.getX(i)),y=p.getY(i),z=p.getZ(i);
    const mask=THREE.MathUtils.smoothstep(x,.145,.185)*(1-THREE.MathUtils.smoothstep(Math.abs(y-.825),.021,.035))*(1-THREE.MathUtils.smoothstep(Math.abs(z+.09),.32,.41));
    tint.setRGB(color.getX(i),color.getY(i),color.getZ(i)).lerp(stripe,mask);color.setXYZ(i,tint.r,tint.g,tint.b);
  }
  return parts;
}

