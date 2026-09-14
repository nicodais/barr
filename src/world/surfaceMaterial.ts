import * as THREE from 'three';
import { surfaceTexture } from '../rendering/surfaceTextures';

type SurfaceKind = 'stone' | 'wood' | 'cloth' | 'metal' | 'plain';
/** Triplanar scans work on baked masonry and instanced rock without UV seams. */
export function surfaceMaterial(color: number, roughness = 0.92, metalness = 0, detail = 0.16, kind: SurfaceKind = 'stone'): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: kind === 'cloth' ? THREE.DoubleSide : THREE.FrontSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uSurfaceDetail: { value: detail }, uSurfaceKind: { value: ['stone', 'wood', 'cloth', 'metal', 'plain'].indexOf(kind) },
      uRockColor: { value: surfaceTexture('rock_wall_08', 'color') },
      uRockNormal: { value: surfaceTexture('rock_wall_08', 'normal') },
      uRockRough: { value: surfaceTexture('rock_wall_08', 'roughness') },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurface; varying vec3 vSurfaceN;')
      .replace('#include <worldpos_vertex>', [
        '#include <worldpos_vertex>', 'vec4 surfacePosition = vec4(transformed, 1.0);',
        '#ifdef USE_INSTANCING', 'surfacePosition = instanceMatrix * surfacePosition;', '#endif',
        'vSurface = (modelMatrix * surfacePosition).xyz;',
        'vSurfaceN = normalize(mat3(modelMatrix) * normal);',
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>', 'varying vec3 vSurface; varying vec3 vSurfaceN;',
        'uniform sampler2D uRockColor, uRockNormal, uRockRough;', 'uniform float uSurfaceKind, uSurfaceDetail;',
        'float sHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }',
        'float sNoise(vec3 p) { vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(mix(sHash(i),sHash(i+vec3(1,0,0)),f.x),mix(sHash(i+vec3(0,1,0)),sHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(sHash(i+vec3(0,0,1)),sHash(i+vec3(1,0,1)),f.x),mix(sHash(i+vec3(0,1,1)),sHash(i+vec3(1,1,1)),f.x),f.y),f.z); }',
      ].join('\n'))
      .replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'vec3 weights = pow(abs(normalize(vSurfaceN)), vec3(6.0)); weights /= max(dot(weights, vec3(1)), 0.001);',
        'vec3 p = vSurface * 0.52;',
        'float weathering = sNoise(vSurface * 0.65);',
        'float surfaceRelief = 0.0;',
        'if (uSurfaceKind < 0.5) {',
        ' vec3 rock = texture2D(uRockColor,p.zy).rgb*weights.x + texture2D(uRockColor,p.xz).rgb*weights.y + texture2D(uRockColor,p.xy).rgb*weights.z;',
        ' diffuseColor.rgb *= clamp(dot(rock,vec3(0.3333))*3.5,0.48,1.4);',
        '} else if (uSurfaceKind < 1.5) {',
        ' float grain = sNoise(vec3(vSurface.x*35.0,vSurface.y*1.4,vSurface.z*35.0));',
        ' surfaceRelief = grain; diffuseColor.rgb *= 0.65 + grain*0.6;',
        '} else if (uSurfaceKind < 2.5) {',
        ' float resolved = 1.0-smoothstep(0.005,0.03,length(fwidth(vSurface)));',
        ' surfaceRelief = sin(vSurface.x*650.0)*sin((vSurface.z+vSurface.y)*650.0)*resolved;',
        ' diffuseColor.rgb *= 0.86 + surfaceRelief*0.10 + weathering*0.20;',
        '} else if (uSurfaceKind < 3.5) {',
        ' diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.20,0.105,0.055),smoothstep(0.55,0.76,weathering)*0.7);',
        '}',
      ].join('\n'))
      .replace('#include <normal_fragment_maps>', [
        '#include <normal_fragment_maps>',
        'if (uSurfaceKind < 0.5) {',
        ' vec3 nx=texture2D(uRockNormal,p.zy).xyz*2.0-1.0, ny=texture2D(uRockNormal,p.xz).xyz*2.0-1.0, nz=texture2D(uRockNormal,p.xy).xyz*2.0-1.0;',
        ' vec3 bump=vec3(0,nx.y,nx.x)*weights.x + vec3(ny.x,0,ny.y)*weights.y + vec3(nz.x,nz.y,0)*weights.z;',
        ' normal = normalize(normal + mat3(viewMatrix)*bump*0.55);',
        '} else { normal = normalize(normal + vec3(dFdx(surfaceRelief),dFdy(surfaceRelief),0)*0.15); }',
      ].join('\n'))
      .replace('#include <roughnessmap_fragment>', [
        '#include <roughnessmap_fragment>',
        'if(uSurfaceKind < 0.5) roughnessFactor = clamp(0.66 + 0.32 * (texture2D(uRockRough,p.zy).r*weights.x+texture2D(uRockRough,p.xz).r*weights.y+texture2D(uRockRough,p.xy).r*weights.z),0.72,1.0);',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'shamal-surface-scan-v2-' + kind;
  return material;
}
