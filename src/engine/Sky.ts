import * as THREE from 'three';
import type { SkyState } from './TimeOfDay';

/** Atmospheric sky shared by the backdrop and reflection probe. */
const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // Direction from the camera to this vertex, in world space.
    vDirection = mat3(modelMatrix) * position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uSunIntensity;
  uniform float uHaze;
  uniform vec3 uHazeColor;
  uniform float uNight;
  varying vec3 vDirection;

  float hash13( vec3 p ) {
    p = fract( p * 0.1031 );
    p += dot( p, p.zyx + 31.32 );
    return fract( ( p.x + p.y ) * p.z );
  }

  float starField( vec3 dir ) {
    vec3 p = dir * 190.0;
    vec3 cell = floor( p );
    float h = hash13( cell );
    // Density. Most cells are empty; a sky where every cell has a star reads as
    // static, not as stars.
    if ( h < 0.978 ) return 0.0;

    vec3 at = vec3( hash13( cell + 11.3 ), hash13( cell + 27.7 ), hash13( cell + 51.1 ) );
    float d = length( fract( p ) - at );
    // Never smaller than a pixel: below that the star flickers in and out as
    // the camera turns, which is the single most obvious way a procedural sky
    // gives itself away.
    float pixel = max( fwidth( p.x ), 0.02 );
    float radius = max( 0.055, pixel * 0.9 );
    float mag = 0.35 + 0.65 * fract( h * 137.7 );
    return smoothstep( radius, 0.0, d ) * mag * mag;
  }

  float cloudNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash13(vec3(i, 1)), hash13(vec3(i + vec2(1,0), 1)), f.x),
               mix(hash13(vec3(i + vec2(0,1), 1)), hash13(vec3(i + vec2(1,1), 1)), f.x), f.y);
  }
  float clouds(vec2 p) {
    float n = 0.0, weight = 0.5;
    for (int i = 0; i < 5; i++) {
      n += cloudNoise(p) * weight;
      p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
      weight *= 0.5;
    }
    return n;
  }
  void main() {
    vec3 dir = normalize(vDirection);
    float h = max(dir.y, 0.0);
    vec3 color = mix(uHorizon, uZenith, pow(h, 0.42));
    float opticalDepth = exp(-h * 7.0);
    color = mix(color, uHazeColor, opticalDepth * uHaze * 0.55);
    float sunDot = clamp(dot(dir, normalize(uSunDirection)), -1.0, 1.0);
    float above = smoothstep(-0.08, 0.04, uSunDirection.y);
    float day = 1.0 - uNight;
    // Angular solar disc with forward scattering through desert dust.
    float g = 0.86;
    float mie = (1.0 - g*g) / pow(1.0 + g*g - 2.0*g*sunDot, 1.5);
    color += uSunColor * mie * (0.007 + uHaze * 0.009) * above * day;
    float disc = smoothstep(0.999976, 0.999991, sunDot);
    color += uSunColor * disc * 8.0 * above * day * (1.0 - uHaze * 0.6);
    // Project high cirrus into a plane, compressed toward the horizon.
    if (dir.y > 0.015) {
      vec2 p = dir.xz / (dir.y + 0.16);
      float cloud = clouds(p * vec2(1.7, 4.5) + vec2(3.2, 19.0));
      float density = smoothstep(0.55, 0.76, cloud) * smoothstep(0.02, 0.15, h);
      vec3 cloudLight = mix(uHorizon, vec3(0.92, 0.94, 0.96), 0.52) * (1.0 - uNight * 0.95);
      color = mix(color, cloudLight, density * (0.42 - uHaze * 0.18));
    }
    color = mix(color, uHazeColor * (0.48 - uNight * 0.38), smoothstep(0.0, 0.20, -dir.y));
    float stars = uNight * (1.0 - uHaze * 0.85) * smoothstep(0.0, 0.3, dir.y);
    if (stars > 0.004) color += vec3(0.82, 0.88, 1.0) * starField(dir) * stars;
    color += vec3(0.55, 0.63, 0.76) * smoothstep(0.99994, 0.999965, sunDot) * uNight;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The dome rides with the camera, so this is a placement radius, not a world
 * size — it only has to sit between the camera's near and far planes. It does
 * NOT need to enclose the terrain: `depthWrite` is off and `renderOrder` puts
 * it first, so everything draws over it regardless of distance. Push it past
 * ChaseCamera's far plane and the whole dome is frustum-clipped away, leaving
 * a black void where the sky should be.
 */
const SKY_RADIUS = 2000;

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(0x3a5f9c) },
        uHorizon: { value: new THREE.Color(0xeaa367) },
        uSunColor: { value: new THREE.Color(0xffb26b) },
        uSunDirection: { value: new THREE.Vector3(0, 0.2, 1) },
        uSunIntensity: { value: 1 },
        uHaze: { value: 0 },
        uHazeColor: { value: new THREE.Color(0xd8c2a4) },
        uNight: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      // Fog would tint the sky with its own colour, which is circular since the
      // fog colour is derived from the sky in the first place.
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  update(state: SkyState, sunDirection: THREE.Vector3, cameraPosition: THREE.Vector3) {
    const u = this.material.uniforms;
    (u.uZenith.value as THREE.Color).copy(state.zenith);
    (u.uHorizon.value as THREE.Color).copy(state.horizon);
    (u.uSunColor.value as THREE.Color).copy(state.sunColor);
    (u.uSunIntensity.value as number) = state.sunIntensity;
    (u.uHaze.value as number) = state.haze;
    (u.uHazeColor.value as THREE.Color).copy(state.hazeColor);
    (u.uNight.value as number) = state.night;
    this.sunDir.copy(sunDirection);
    (u.uSunDirection.value as THREE.Vector3).copy(this.sunDir);

    this.mesh.position.copy(cameraPosition);
    this.mesh.scale.setScalar(SKY_RADIUS);
    this.mesh.updateMatrix();
  }
}
