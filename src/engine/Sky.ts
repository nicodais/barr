import * as THREE from 'three';
import type { SkyState } from './TimeOfDay';

/**
 * Procedural gradient sky (§4) — no photo skybox, because a photographic sky
 * over flat-shaded terrain reads as a mistake rather than a style.
 *
 * It's a single inverted sphere that renders before everything with depth
 * writes off, so it costs one draw call and never fights the depth buffer.
 */
const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // Direction from the camera to this vertex, in world space.
    vDirection = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
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
  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize( vDirection );

    // Vertical gradient. The exponent decides how quickly the zenith blue takes
    // over from the warm horizon: *below* 1.0 pulls the blue down toward the
    // horizon, above 1.0 lets the warm band climb. The chase camera only ever
    // sees the first ~25 degrees of sky, so this needs to be low or the visible
    // strip is warm the whole way across.
    float h = clamp( dir.y, -1.0, 1.0 );
    float t = pow( clamp( h, 0.0, 1.0 ), 0.42 );

    // Blending a warm horizon straight into a blue zenith runs the midtones
    // through purple — orange and blue average to mud. A real sky passes
    // through a pale, desaturated haze band instead, so that band is built
    // explicitly and the gradient goes horizon -> pale -> zenith.
    // Rec.709 weights, not the 0.299/0.587/0.114 display-space ones: these
    // uniforms are linear (THREE.Color converts on construction), and the
    // display weights over-count green against a linear value, which tipped the
    // band khaki under the pale tan midday horizon. The old 1.1 gain on top
    // pushed it into the tone-map knee as well, desaturating it further to milk.
    vec3 pale = mix( uHorizon, uZenith, 0.55 );
    float lum = dot( pale, vec3( 0.2126, 0.7152, 0.0722 ) );
    pale = mix( pale, vec3( lum * 0.94, lum * 1.0, lum * 1.16 ), 0.58 );

    vec3 color = mix( uHorizon, pale, smoothstep( 0.0, 0.55, t ) );
    color = mix( color, uZenith, smoothstep( 0.42, 1.0, t ) );
    // A tight haze band right on the horizon, where the air is thickest.
    color = mix( color, uHorizon, smoothstep( 0.07, 0.0, h ) * 0.5 );

    // Below the horizon, settle toward a slightly darker haze so the ground
    // plane edge never shows a hard line against the sky.
    color = mix( color, uHorizon * 0.82, smoothstep( 0.0, -0.22, h ) );

    // The shamal. Dust blowing off the Rub' al Khali is the defining sky of this
    // coast — the air carries so much of it that the horizon never resolves to
    // blue, it just goes milky and warm and the far dunes disappear into it.
    //
    // Mie scattering off dust is far less wavelength-selective than Rayleigh off
    // air, so the effect is: the whole dome washes toward one pale sand colour,
    // strongly near the horizon (where the air path is longest) and weakly
    // overhead. Pulling the zenith down toward the same colour is what stops a
    // hazy sky from reading as a clean sky with fog stuck to the bottom of it.
    float airMass = mix( 1.0, 0.28, smoothstep( 0.0, 0.75, t ) );
    color = mix( color, uHazeColor, uHaze * airMass * 0.82 );

    // Broad atmospheric glow around the sun, plus a tighter core. No disc:
    // a hard-edged sun would be the only photoreal object in the frame.
    float sunDot = max( dot( dir, normalize( uSunDirection ) ), 0.0 );
    float glow = pow( sunDot, 6.0 ) * 0.30 + pow( sunDot, 128.0 ) * 0.85;
    // Dust spreads the sun into a wide aureole and eats the core — on a hazy
    // afternoon out there you can look straight at it. Trading the tight term
    // for the broad one keeps the total light roughly constant while the shape
    // of it changes, which is what actually reads as "the air is full of sand".
    float aureole = pow( sunDot, 2.2 ) * 0.42;
    glow = mix( glow, aureole + pow( sunDot, 22.0 ) * 0.18, uHaze );
    // Fade the glow out as the sun sinks, so it doesn't burn through the ground.
    float above = smoothstep( -0.12, 0.06, normalize( uSunDirection ).y );
    color += uSunColor * glow * uSunIntensity * above;

    gl_FragColor = vec4( color, 1.0 );

    // Every built-in three material ends with these two chunks; a hand-written
    // ShaderMaterial gets the prefix that defines them but has to include them
    // itself. Omitting them meant the sky alone skipped the pipeline everything
    // else goes through: THREE.Color converts on construction, so these uniforms
    // hold LINEAR values, and writing them straight to an sRGB framebuffer
    // displayed them at roughly a third of their authored brightness. The
    // 0x3f92e2 midday zenith arrived as rgb(13,73,194) — a heavy navy instead of
    // azure — so the ground rendered brighter than the sky and the whole value
    // structure was inverted. Adding tone mapping to the renderer made the
    // mismatch worse, not better: the ground started rolling off while the sky
    // still clipped raw. The sun glow gets to roll off now too.
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
    this.sunDir.copy(sunDirection);
    (u.uSunDirection.value as THREE.Vector3).copy(this.sunDir);

    this.mesh.position.copy(cameraPosition);
    this.mesh.scale.setScalar(SKY_RADIUS);
    this.mesh.updateMatrix();
  }
}
