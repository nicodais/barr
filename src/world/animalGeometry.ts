import * as THREE from 'three';

type AnimalParts = { coat: THREE.BufferGeometry; dark: THREE.BufferGeometry };
const assets = new Map<string, AnimalParts>();
let pending: Promise<void> | undefined;
/** Bake with `node scripts/bake-animals.mjs`; no runtime surface generation. */
export function preloadAnimalGeometry(): Promise<void> {
  if (!pending) pending = Promise.all(['camel', 'gazelle'].map(async name => {
    const response = await fetch(import.meta.env.BASE_URL + 'models/' + name + '.mesh');
    if (!response.ok) throw new Error('Could not load ' + name + ' model: ' + response.status);
    const data = await response.arrayBuffer();
    const length = new DataView(data).getUint32(0, true);
    const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, length))) as Record<string, Record<string, { offset: number; length: number; size: number; type: string; normalized: boolean }>>;
    const parts = {} as AnimalParts;
    for (const name of ['coat', 'dark'] as const) {
      const geo = new THREE.BufferGeometry();
      for (const [attribute, info] of Object.entries(metadata[name])) {
        const ArrayType = ({ Float32Array, Int16Array, Uint8Array, Uint16Array, Uint32Array } as const)[info.type as 'Float32Array'];
        if (!ArrayType) throw new Error('Unsupported model attribute: ' + info.type);
        const values = new ArrayType(data, 4 + length + info.offset, info.length);
        const buffer = new THREE.BufferAttribute(values, info.size, info.normalized);
        if (attribute === 'index') geo.setIndex(buffer); else geo.setAttribute(attribute, buffer);
      }
      geo.computeBoundingSphere(); parts[name] = geo;
    }
    assets.set(name, parts);
  })).then(() => undefined).catch(error => { pending = undefined; throw error; });
  return pending;
}
function copyAnimal(name: string): AnimalParts {
  const source = assets.get(name);
  if (!source) throw new Error('Animal geometry must be loaded before constructing the world');
  return { coat: source.coat.clone(), dark: source.dark.clone() };
}
export function buildCamel() { return copyAnimal('camel'); }
export function buildGazelle() { return copyAnimal('gazelle'); }

/** One continuous deformation field for skin, markings, hooves and shadow.
 * No material/triangle/leg-ID boundaries can separate during animation. */
export function patchAnimal(shader: THREE.WebGLProgramParametersWithUniforms, time: { value: number }, camel: boolean, texturedCoat = true) {
  shader.uniforms.uTime = time;
  const hip = camel ? 1.67 : 0.86;
  const common = `
    varying vec3 vCoatPosition;
    uniform float uTime;
    attribute float aPhase, aGait;
    vec3 animalSkin(vec3 p) {
      float cycle = uTime * ${camel ? '3.1' : '9.0'} + aPhase;
      vec3 result = p;
      // Smooth partitions form a continuous skin even across the chest/hips.
      float left = smoothstep(-0.09, 0.09, p.x);
      float front = smoothstep(${camel ? '-0.28, 0.25' : '-0.18, 0.15'}, p.z);
      float influence = 1.0 - smoothstep(${hip * 0.64}, ${hip + (camel ? .22 : .10)}, p.y);
      for (int i = 0; i < 4; i++) {
        bool isLeft = i < 2;
        bool isFront = (i == 0 || i == 2);
        float weight = (isLeft ? left : 1.0-left) * (isFront ? front : 1.0-front) * influence;
        float phase = cycle + (${camel ? 'isLeft' : '(isLeft == isFront)'} ? 0.0 : 3.14159265);
        vec3 hip = vec3(isLeft ? ${camel ? '0.29' : '0.15'} : ${camel ? '-0.29' : '-0.15'}, ${hip}, isFront ? ${camel ? '0.66' : '0.30'} : ${camel ? '-0.85' : '-0.40'});
        float angle = sin(phase) * ${camel ? '0.26' : '0.40'} * aGait;
        vec3 limb = p - hip;
        limb.yz = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * limb.yz;
        vec3 moved = hip + limb;
        moved.y -= hip.y*(1.0-cos(angle))*(1.0-smoothstep(0.08, hip.y*.6, p.y));
        // Swing foot lifts; grounded half of stride stays low.
        moved.y += max(0.0, cos(phase)) * (1.0-smoothstep(0.1, ${hip * .55}, p.y)) * ${camel ? '0.10' : '0.13'} * aGait;
        result += (moved-p) * weight;
      }
      result.y += sin(cycle*2.0) * 0.012 * aGait * smoothstep(.12, .6, p.y);
      result.z += sin(uTime*.6+aPhase) * .012 * (1.0-aGait) * smoothstep(${hip + .3}, ${camel ? '3.0' : '1.6'}, p.y);
      return result;
    }
  `;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCoatPosition;')
    .replace('#include <color_fragment>', `
      #include <color_fragment>
      float furFade = 1.0-smoothstep(.008,.035,length(fwidth(vCoatPosition)));
      float fibre = sin(vCoatPosition.x*960.0+sin(vCoatPosition.z*190.0))*sin(vCoatPosition.y*165.0+vCoatPosition.z*130.0);
      diffuseColor.rgb *= .97+fibre*.025*furFade;
    `);
  if (camel && texturedCoat) {
    // Object-space wool stays attached during the walk, without UV seams or
    // transparent shells. Derivative filtering removes distant grain shimmer.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      float coatHash(vec3 p) { p=fract(p*.3183099+vec3(.17,.31,.53)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float coatNoise(vec3 p) {
        vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(coatHash(i),coatHash(i+vec3(1,0,0)),f.x),
          mix(coatHash(i+vec3(0,1,0)),coatHash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(coatHash(i+vec3(0,0,1)),coatHash(i+vec3(1,0,1)),f.x),
          mix(coatHash(i+vec3(0,1,1)),coatHash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      float woolLod=1.0-smoothstep(.006,.025,length(fwidth(vCoatPosition)));
      float wool=coatNoise(vCoatPosition*vec3(165.0,85.0,165.0));
      float clump=coatNoise(vCoatPosition*vec3(42.0,28.0,42.0));
      diffuseColor.rgb *= mix(1.0,.78+.35*wool,woolLod) * (.94+.10*clump);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      float coatHeight=(wool*.0013+clump*.001)*woolLod;
      vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
      vec3 r1=cross(sy,normal), r2=cross(normal,sx);
      float det=dot(sx,r1);
      normal=normalize(abs(det)*normal-sign(det)*(dFdx(coatHeight)*r1+dFdy(coatHeight)*r2));
    `);
  }
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n'+common)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoatPosition=position; transformed=animalSkin(position);')
    .replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      vec3 reference = abs(normal.y)<.9 ? vec3(0,1,0) : vec3(1,0,0);
      vec3 tangent = normalize(cross(reference,normal));
      vec3 bitangent = cross(normal,tangent);
      vec3 skinCentre = animalSkin(position);
      objectNormal = normalize(cross(animalSkin(position+tangent*.002)-skinCentre, animalSkin(position+bitangent*.002)-skinCentre));
    `);
}
