import * as THREE from 'three';
import { surfaceTexture } from '../rendering/surfaceTextures';

export interface SandUniforms {
  uSandTime: { value: number };
  uContactMap: { value: THREE.Texture };
  uContactSize: { value: number };
  uPatchArea: { value: THREE.Vector4 };
  uWind: { value: THREE.Vector2 };
  uRippleStrength: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSheenColor: { value: THREE.Color };
  uSheen: { value: number };
}

/** Metre-scale detail stays continuous across streamed LODs. Standard material
 * retains shadow, environment, fog and colour management. */
export function createSandMaterial(localPatch=false, shared?:SandUniforms): {
  material: THREE.MeshStandardMaterial;
  uniforms: SandUniforms;
} {
  const empty=shared?null:new THREE.DataTexture(new Uint8Array([128,0,128,128]),1,1);if(empty)empty.needsUpdate=true;
  const uniforms: SandUniforms = shared ?? {
    uSandTime: {value:0},uContactMap:{value:empty!},uContactSize:{value:1},uPatchArea:{value:new THREE.Vector4(0,0,24,0)},
    uWind: { value: new THREE.Vector2(1, 0) },
    uRippleStrength: { value: 1 },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSheenColor: { value: new THREE.Color(0xffe2bb) },
    uSheen: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.32,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uLocalPatch: {value:localPatch?1:0},
      uSandColor: { value: surfaceTexture('aerial_beach_01', 'color') },
      uSandNormal: { value: surfaceTexture('aerial_beach_01', 'normal') },
      uSandRough: { value: surfaceTexture('aerial_beach_01', 'roughness') },
      uGrainColor: { value: surfaceTexture('dense_sand', 'color') },
      uGrainNormal: { value: surfaceTexture('dense_sand', 'normal') },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSandWorld;
        varying vec3 vSandSmooth;
        uniform sampler2D uContactMap;
        uniform vec4 uPatchArea;
        uniform float uLocalPatch, uContactSize;
        vec2 contactUV(vec2 p) { return ((p-uPatchArea.xy)/(uPatchArea.z*2.0)+.5)*(uContactSize-1.0)/uContactSize+.5/uContactSize; }
        float contactHeight(vec2 p) { float edge=uPatchArea.z-max(abs(p.x-uPatchArea.x),abs(p.y-uPatchArea.y));return (texture2D(uContactMap,contactUV(p)).r*255.0-128.0)/127.0*.12*smoothstep(0.0,2.0,edge); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if(uLocalPatch>.5) transformed.y+=contactHeight((modelMatrix*vec4(position,1.0)).xz);`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSandWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSandSmooth = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSandWorld;
        varying vec3 vSandSmooth;
        uniform sampler2D uSandColor, uSandNormal, uSandRough, uGrainColor, uGrainNormal;
        uniform vec2 uWind;
        uniform sampler2D uContactMap;
        uniform vec4 uPatchArea;
        uniform float uLocalPatch,uContactSize,uSandTime;
        vec2 contactUV(vec2 p) { return ((p-uPatchArea.xy)/(uPatchArea.z*2.0)+.5)*(uContactSize-1.0)/uContactSize+.5/uContactSize; }
        float contactHeight(vec2 p) { float edge=uPatchArea.z-max(abs(p.x-uPatchArea.x),abs(p.y-uPatchArea.y));return (texture2D(uContactMap,contactUV(p)).r*255.0-128.0)/127.0*.12*smoothstep(0.0,2.0,edge); }
        uniform float uRippleStrength;
        uniform vec3 uSunDirection;
        uniform vec3 uSheenColor;
        uniform float uSheen;
        float sandHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float sandNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sandHash(i), sandHash(i + vec2(1,0)), f.x),
                     mix(sandHash(i + vec2(0,1)), sandHash(i + vec2(1,1)), f.x), f.y);
        }
        float rippleField(vec2 p) {
          float along = dot(p, uWind);
          float across = dot(p, vec2(-uWind.y, uWind.x));
          float warp = sin(across * 0.43) * 0.20 + sin(across * 0.13) * 0.38;
          float wave = sin((along + warp) * 19.0 + sin(across * 1.3) * 0.32);
          float coverage = smoothstep(0.15, 0.75, sandNoise(p * 0.035));
          return (wave * 0.75 + sin((along + warp) * 9.1) * 0.25) * coverage;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 patchOffset=abs(vSandWorld.xz-uPatchArea.xy);
        if(uPatchArea.w>.5 && uLocalPatch<.5 && max(patchOffset.x,patchOffset.y)<uPatchArea.z-.001) discard;
        vec4 contactSample=texture2D(uContactMap,contactUV(vSandWorld.xz));
        float packed=uLocalPatch>.5?contactSample.g:0.0;
        vec2 tyreDirection=normalize((contactSample.ba*255.0-128.0)/127.0+vec2(.00001));
        vec2 tyreAcross=vec2(tyreDirection.y,-tyreDirection.x);
        float tyreAlong=dot(vSandWorld.xz,tyreDirection);
        float tyreCross=dot(vSandWorld.xz,tyreAcross);
        float treadPhase=tyreAlong*52.0+sin(tyreCross*18.0)*1.1;
        float treadFade=1.0-smoothstep(.65,2.3,fwidth(treadPhase));
        float treadRelief=sin(treadPhase)*packed*treadFade;
        vec2 sandUV = vec2(dot(vSandWorld.xz, uWind), dot(vSandWorld.xz, vec2(-uWind.y, uWind.x))) / 3.2;
        vec2 grainUV = vSandWorld.xz / 1.7;
        float sandPatch = sandNoise(vSandWorld.xz * 0.023);
        vec3 scan = mix(texture2D(uSandColor, sandUV).rgb,
                        texture2D(uSandColor, sandUV * 0.713 + vec2(0.37, 0.61)).rgb, 0.34);
        float luminance = dot(scan, vec3(0.2126, 0.7152, 0.0722));
        float grit = dot(texture2D(uGrainColor, grainUV).rgb, vec3(0.3333));
        // Keep each region's mineral colour, while retaining the scanned relief.
        diffuseColor.rgb *= clamp(mix(luminance * 2.7, grit * 3.4, smoothstep(0.42, 0.78, sandPatch) * 0.45), 0.56, 1.32);
        float mineral = sandNoise(vSandWorld.xz * 0.19) * 0.6
                      + sandNoise(vSandWorld.xz * 0.73) * 0.4;
        float grainFootprint = max(length(fwidth(vSandWorld.xz)), 0.0001);
        float grainFade = 1.0 - smoothstep(0.008, 0.055, grainFootprint);
        float grain = sandNoise(vSandWorld.xz * 95.0);
        diffuseColor.rgb *= (0.95 + mineral * 0.09 + (grain - 0.5) * 0.10 * grainFade)*(1.0-packed*.18-treadRelief*.10);
        // Saltating grains drift over the surface; the underlying dunes stay still.
        vec2 moving=vSandWorld.xz-uWind*uSandTime*.55;
        float drift=sandNoise(vec2(dot(moving,uWind)*1.8,dot(moving,vec2(-uWind.y,uWind.x))*14.0));
        float gust=smoothstep(.60,.90,sandNoise(vSandWorld.xz*.045-uWind*uSandTime*.045));
        diffuseColor.rgb *= 1.0+(drift-.5)*gust*.12*(1.0-packed);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 sandN = normalize(vSandSmooth);
        float dist = length(vSandWorld - cameraPosition);
        float footprint = max(fwidth(dot(vSandWorld.xz, uWind)), 0.0001);
        float rippleFade = (1.0 - smoothstep(18.0, 65.0, dist))
                         * (1.0 - smoothstep(0.035, 0.15, footprint))
                         * smoothstep(0.72, 0.94, sandN.y) * uRippleStrength * (1.0-packed);
        vec2 p = vSandWorld.xz;
        const float e = 0.025;
        vec2 gradient = vec2(
          rippleField(p + vec2(e,0)) - rippleField(p - vec2(e,0)),
          rippleField(p + vec2(0,e)) - rippleField(p - vec2(0,e))) / (2.0 * e);
        sandN = normalize(sandN + vec3(-gradient.x, 0, -gradient.y) * rippleFade * 0.0065);
        vec3 scanN = texture2D(uSandNormal, sandUV).xyz * 2.0 - 1.0;
        vec3 fineN = texture2D(uGrainNormal, grainUV).xyz * 2.0 - 1.0;
        vec2 relief = (scanN.xy * 0.23 * uRippleStrength + fineN.xy * 0.10)*(1.0-packed*.8);
        vec2 worldRelief = uWind * relief.x + vec2(-uWind.y, uWind.x) * relief.y;
        sandN = normalize(sandN + vec3(worldRelief.x, 0.0, worldRelief.y));
        if(uLocalPatch>.5) {
          vec2 rutSlope=vec2(contactHeight(p+vec2(.125,0))-contactHeight(p-vec2(.125,0)),contactHeight(p+vec2(0,.125))-contactHeight(p-vec2(0,.125)))/.25;
          // Broad sunlit berms plus millimetre-scale tread blocks in the rut floor.
          vec2 treadSlope=cos(treadPhase)*(tyreDirection*52.0+tyreAcross*cos(tyreCross*18.0)*19.8)*.004*packed*treadFade;
          sandN=normalize(sandN+vec3(-rutSlope.x-treadSlope.x,0,-rutSlope.y-treadSlope.y));
        }
        normal = normalize((viewMatrix * vec4(sandN, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(0.72 + texture2D(uSandRough, sandUV).r * 0.26, 0.78, 1.0);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        vec3 viewDir = normalize(cameraPosition - vSandWorld);
        float forwardScatter = pow(max(dot(-viewDir, uSunDirection), 0.0), 8.0);
        float grazing = pow(1.0 - abs(dot(viewDir, sandN)), 5.0);
        reflectedLight.directDiffuse += uSheenColor * diffuseColor.rgb
          * forwardScatter * grazing * uSheen * 0.28;`);
  };
  material.customProgramCacheKey = () => 'shamal-loose-sand-v3-'+localPatch;
  return { material, uniforms };
}
