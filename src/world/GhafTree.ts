import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfaceTexture } from '../rendering/surfaceTextures';

type Point = [number, number, number];
/** Connected woody hierarchy with life-size compound leaves. No canopy scaling. */
export function createGhafTree(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Mature ghaf';
  const wood: THREE.BufferGeometry[] = [];
  const leafPositions: number[] = [], leafNormals: number[] = [], leafColors: number[] = [];
  let seed = 19371;
  const random = () => { seed = Math.imul(seed ^ seed >>> 15, 1 | seed); seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed); return ((seed ^ seed >>> 14) >>> 0) / 4294967296; };
  const branch = (points: THREE.Vector3[], radius: number, tip: number) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = radius > 0.08 ? 24 : 10, sides = radius > 0.08 ? 14 : 6;
    const frames = curve.computeFrenetFrames(segments, false), length = curve.getLength();
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, p = curve.getPointAt(t);
      const r = tip + (radius - tip) * Math.pow(1 - t, 1.2);
      for (let j = 0; j <= sides; j++) {
        const a = j / sides * Math.PI * 2;
        const flute = 1 + Math.sin(a * 5 + t * 4) * 0.085 + Math.sin(a * 9 - t * 2) * 0.045;
        const v = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r * flute).addScaledVector(frames.binormals[i], Math.sin(a) * r * flute);
        positions.push(v.x, v.y, v.z); uv.push(j / sides * Math.max(0.15, radius * Math.PI * 2 / 0.55), t * length / 1.15);
        if (i < segments && j < sides) { const k = i * (sides + 1) + j; indices.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1); }
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals(); wood.push(geo);
    return curve;
  };
  const v = (p: Point) => new THREE.Vector3(...p);
  branch([v([0,-0.12,0]), v([0.1,0.65,-0.05]), v([-0.07,1.35,0.12]), v([0.14,2.15,0.05]), v([0.25,2.85,-0.16])], 0.53, 0.002);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996;
    branch([v([Math.cos(a)*1.0,-0.12,Math.sin(a)*1.0]),v([Math.cos(a)*0.58,0.05,Math.sin(a)*0.58]),v([Math.cos(a)*0.10,0.48,Math.sin(a)*0.10])], 0.025, 0.15);
  }
  const leaflet = (centre: THREE.Vector3, direction: THREE.Vector3, cross: THREE.Vector3, length: number, width: number) => {
    const base = centre.clone(), tip = centre.clone().addScaledVector(direction, length);
    const mid = centre.clone().addScaledVector(direction, length * 0.46).addScaledVector(new THREE.Vector3(0,1,0), width * 0.17);
    const left = mid.clone().addScaledVector(cross, width * 0.5), right = mid.clone().addScaledVector(cross, -width * 0.5);
    const normal = direction.clone().cross(cross).normalize();
    const tint = new THREE.Color().setRGB(0.135 + random()*0.035, 0.185 + random()*0.045, 0.075 + random()*0.025);
    for (const p of [base,left,tip,base,tip,right]) { leafPositions.push(p.x,p.y,p.z); leafNormals.push(normal.x,normal.y,normal.z); leafColors.push(tint.r,tint.g,tint.b); }
  };
  const spray = (origin: THREE.Vector3, outward: THREE.Vector3) => {
    for (let s = 0; s < 5; s++) {
      const direction = outward.clone().add(v([(random()-.5)*0.8,(random()-.5)*0.7,(random()-.5)*0.8])).normalize();
      const base = origin.clone().addScaledVector(outward, (s / 5 - 0.5) * 0.22);
      const axis = new THREE.Vector3(0,1,0).cross(direction).normalize();
      const length = 0.12 + random()*0.085;
      for (let j = 0; j < 11; j++) {
        const t = (j + 0.5) / 11, at = base.clone().addScaledVector(direction, length*t);
        for (const sign of [-1,1]) {
          const lateral = axis.clone().multiplyScalar(sign).addScaledVector(direction, 0.24).normalize();
          leaflet(at, lateral, direction, (0.022 + Math.sin(t*Math.PI)*0.023) * (0.8+random()*0.4), 0.010 + random()*0.005);
        }
      }
    }
  };
  for (let primary = 0; primary < 8; primary++) {
    const a = primary * 2.39996, reach = 1.45 + random()*0.75, level = 1.55 + random()*0.8;
    const end = v([Math.cos(a)*reach, 3.0+random()*0.9, Math.sin(a)*reach]);
    const main = branch([v([0.04,level,0]), v([Math.cos(a)*reach*.35,level+.55,Math.sin(a)*reach*.35]), end], 0.18, 0.001);
    for (let secondary = 0; secondary < 6; secondary++) {
      const t = .35 + secondary*.105, origin = main.getPoint(t), bearing = a + (secondary%2 ? 1 : -1)*(.4+random()*.5);
      const extent = .6 + random()*.9;
      const tip = origin.clone().add(v([Math.cos(bearing)*extent, .15+random()*.3, Math.sin(bearing)*extent]));
      const middle = origin.clone().lerp(tip,.55); middle.y += .18;
      const limb = branch([origin,middle,tip], .035*(1-t*.55), .0007);
      for (let twig = 0; twig < 7; twig++) {
        const start = limb.getPoint(.2+twig*.115), yaw = bearing + (twig%2 ? 1 : -1)*(.45+random()*.7);
        const outward = v([Math.cos(yaw), -.25+random()*.75, Math.sin(yaw)]).normalize();
        const twigEnd = start.clone().addScaledVector(outward, .3+random()*.32);
        const twigMid = start.clone().lerp(twigEnd,.5); twigMid.y += .06;
        branch([start,twigMid,twigEnd], .005, .0005);
        for (let k = 0; k < 4; k++) spray(start.clone().lerp(twigEnd,.22+k*.24), outward);
      }
    }
  }
  const bark = new THREE.MeshStandardMaterial({ color: 0xb7afa1, roughness: .94 });
  // Maps are assigned at first render so Node geometry checks need no DOM.
  if (typeof document !== 'undefined') {
    bark.map = surfaceTexture('bark_brown_02','color'); bark.normalMap = surfaceTexture('bark_brown_02','normal');
    bark.roughnessMap = surfaceTexture('bark_brown_02','roughness'); bark.normalScale.set(.7,.7);
  }
  const woodGeo = mergeGeometries(wood, false)!; wood.forEach(g => g.dispose());
  const trunk = new THREE.Mesh(woodGeo,bark); trunk.castShadow = trunk.receiveShadow = true; group.add(trunk);
  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute(leafPositions,3)); leafGeo.setAttribute('normal',new THREE.Float32BufferAttribute(leafNormals,3)); leafGeo.setAttribute('color',new THREE.Float32BufferAttribute(leafColors,3));
  const foliage = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.92, side:THREE.DoubleSide, envMapIntensity:.3 });
  const crown = new THREE.Mesh(leafGeo,foliage); crown.castShadow = crown.receiveShadow = true; group.add(crown);
  return group;
}
