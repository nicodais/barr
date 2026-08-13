import * as THREE from 'three';

/**
 * The terrain's material: flat-shaded vertex-coloured Lambert, with three
 * things bolted into its shader that the geometry can't express.
 *
 * All three are patched in via `onBeforeCompile` rather than written as a
 * standalone ShaderMaterial. That keeps three's lighting, fog, tone mapping and
 * colour-space handling — the sky is a hand-written ShaderMaterial and it
 * skipped two of those chunks for months, which inverted the whole scene's
 * value structure. Not repeating that.
 */
export interface SandUniforms {
  /**
   * The wind axis, xz. A uniform rather than a constant baked into the source:
   * the crest bearing is per-region now, and baking it would mean recompiling
   * the terrain shader on every map change — which recompiles every material in
   * the scene along with it.
   */
  uWind: { value: THREE.Vector2 };
  uRippleStrength: { value: number };
  uSunDirection: { value: THREE.Vector3 };
  uSheenColor: { value: THREE.Color };
  uSheen: { value: number };
}

export function createSandMaterial(): {
  material: THREE.MeshLambertMaterial;
  uniforms: SandUniforms;
} {
  const uniforms: SandUniforms = {
    uWind: { value: new THREE.Vector2(1, 0) },
    // Ripples fade out with distance and with wind — see the fragment code.
    uRippleStrength: { value: 1 },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSheenColor: { value: new THREE.Color(0xffd9a4) },
    uSheen: { value: 1 },
  };

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Derives per-face normals in the fragment shader, which is what lets the
    // geometry stay indexed and still read as faceted (§4).
    flatShading: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vSandWorld;
         varying vec3 vSandSmooth;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         // Positions are already world-space (see buildChunkGeometry), but go
         // through the model matrix anyway so this can't silently break if that
         // ever stops being true.
         vSandWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
         // The height field's analytic normal, in world space. three throws the
         // attribute away under FLAT_SHADED and derives a per-face normal
         // instead, but the smooth one is still needed — see the pan blend in
         // the fragment shader.
         vSandSmooth = normalize( mat3( modelMatrix ) * normal );`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vSandWorld;
         varying vec3 vSandSmooth;
         uniform float uRippleStrength;
         uniform vec3 uSunDirection;
         uniform vec3 uSheenColor;
         uniform float uSheen;
         uniform vec2 uWind;
         #define WIND uWind

         // Wind ripples.
         //
         // These exist here rather than in the height field because they can't
         // exist there: real ripples sit 10-20cm apart and the physics grid
         // samples every 2m, so as geometry they sit an order of magnitude
         // below usable resolution and the height field's ripple term was
         // invisible by construction. As a normal perturbation they cost
         // nothing and they are the most recognisable thing sand does.
         //
         // Crests run *across* the wind, so the wave advances along the wind
         // axis. Scale matters more than anything else here: real ripples sit
         // 50-80cm apart in coarse dune sand, and the first pass ran them at
         // 1.2m with a 4m warp, which rendered as ploughed furrows. Two
         // frequencies beat together so the fine train groups into ~2m sets
         // the way it does out there, and the warp is now a gentle sinuosity
         // (tens of centimetres over tens of metres) rather than an S-bend.
         //
         // Returns metres of relief, so the gradient below is a real slope and
         // the amplitude constant can be read as one.
         float rippleField( vec2 p ) {
           float along = dot( p, WIND );
           float across = dot( p, vec2( -WIND.y, WIND.x ) );
           float warp = sin( across * 0.34 ) * 0.22 + sin( across * 0.11 ) * 0.55;
           float a = sin( ( along + warp ) * 9.2 );
           float b = sin( ( along + warp * 0.6 ) * 3.1 );
           // Ripples don't cover open sand uniformly — the wind lays them in
           // patches with scoured, smooth ground between. Without this the
           // whole floor is one continuous corduroy sheet.
           float coverage = 0.4 + 0.6 * sin( along * 0.043 + across * 0.031 );
           return ( a * 0.7 + b * 0.3 ) * clamp( coverage, 0.0, 1.0 );
         }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         // Everything from here on works in WORLD space and is converted back
         // at the end. three's \`normal\` is view-space, which is right for
         // lighting and useless for the two questions asked below — "is this
         // ground flat?" and "which way is the wind?" — because in view space
         // the answers change when the player turns the camera.
         vec3 sandN = normalize( cross( dFdx( vSandWorld ), dFdy( vSandWorld ) ) );
         if ( sandN.y < 0.0 ) sandN = -sandN;
         {
           // On near-level ground the two triangles of every quad get slightly
           // different face normals, and the pan prints as a diagonal
           // checkerboard. That faceting is exactly what's wanted on a dune
           // face (§4) and is pure quad noise on flat ground, so fade to the
           // height field's analytic normal precisely where it stops helping.
           //
           // The gate reads the *analytic* normal, not the face normal. Face
           // tilt cannot tell the two cases apart — a facet leaning 12 degrees
           // looks identical whether it is quad noise on a pan or a genuine
           // slope — whereas the height field knows the real local gradient,
           // and on a true dune face the facets agree with it. Keying on the
           // face normal meant the blend could only be trusted very close to
           // level; keying on the ground itself lets it reach the gentle
           // swells where the checkerboard actually survived, while leaving
           // everything steeper than about 12 degrees fully faceted. No dune
           // face in either region is shallower than that.
           float trueLevel = normalize( vSandSmooth ).y;
           float pan = smoothstep( 0.978, 0.9955, trueLevel );
           sandN = normalize( mix( sandN, normalize( vSandSmooth ), pan ) );

           // Fade with distance: past ~35m the ripple period is down to a pixel
           // or two and sampling it just produces shimmer. This is a texture on
           // the ground the player is driving over, not a feature of the
           // landscape — carrying it to the horizon is what made the first pass
           // read as corrugated iron. Also fade on steep faces: a slip face at
           // repose is avalanching sand, which is smooth, and ripples only form
           // where the surface is stable.
           float dist = length( vSandWorld - cameraPosition );
           float near = 1.0 - smoothstep( 9.0, 38.0, dist );
           float flat_ = smoothstep( 0.62, 0.88, sandN.y );

           // Nyquist fade, and it is not optional. Distance alone can't decide
           // whether the ripples are resolvable, because a flat pan seen at a
           // grazing angle packs metres of ground into one pixel row ten metres
           // from the camera. fwidth measures the actual ground distance one
           // pixel covers along the ripple axis, so this fades out exactly when
           // the field stops being representable, whatever the geometry.
           float footprint = max( fwidth( dot( vSandWorld.xz, WIND ) ), 1e-4 );
           float resolved = 1.0 - smoothstep( 0.09, 0.26, footprint );

           float amt = uRippleStrength * near * flat_ * resolved;
           if ( amt > 0.001 ) {
             vec2 p = vSandWorld.xz;
             // Small enough to resolve the 68cm primary — at the 35cm the first
             // pass used, the difference straddled a whole period and returned
             // an aliased gradient rather than the real one.
             const float E = 0.05;
             // Central differences give the field's true slope (metres of rise
             // per metre), so RIPPLE_SLOPE below is readable as a tangent:
             // 0.012 x the ~7/m peak gradient is about 5 degrees of tilt, which
             // is roughly what a real ripple face stands at.
             const float RIPPLE_SLOPE = 0.012;
             float gx = ( rippleField( p + vec2( E, 0.0 ) ) - rippleField( p - vec2( E, 0.0 ) ) ) / ( 2.0 * E );
             float gz = ( rippleField( p + vec2( 0.0, E ) ) - rippleField( p - vec2( 0.0, E ) ) ) / ( 2.0 * E );
             sandN = normalize( sandN + vec3( -gx, 0.0, -gz ) * amt * RIPPLE_SLOPE );
           }

           normal = normalize( ( viewMatrix * vec4( sandN, 0.0 ) ).xyz );
         }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           // Forward-scatter sheen.
           //
           // Sand is not matte. Looking toward a low sun, the grains scatter
           // hard forward and a crest lights up — which is most of why a dune
           // field at golden hour looks the way it does, and Lambert alone has
           // no term for it at all. Keyed to view-vs-sun rather than to a
           // specular lobe, so it brightens the whole grazing-lit side rather
           // than putting a highlight dot on it.
           vec3 viewDir = normalize( cameraPosition - vSandWorld );
           float facing = max( dot( -viewDir, uSunDirection ), 0.0 );
           // Strongest where the surface is edge-on to the eye: crests and the
           // far side of every ridge. Against the world-space normal computed
           // above, since viewDir is world-space too — pairing it with three's
           // view-space \`normal\` silently measures nothing in particular.
           float grazing = 1.0 - abs( dot( viewDir, sandN ) );
           // A tight exponent on purpose. At 2.2 the term still had real weight
           // at 45 degrees off edge-on, which meant it was amplifying the
           // difference between neighbouring facets across the whole
           // foreground — the terrain is flat-shaded on a 2m grid, so that
           // reads as quilting. At 3.4 it concentrates on surfaces genuinely
           // side-on to the eye, which is where the crest glow lives anyway.
           float sheen = pow( facing, 3.0 ) * pow( grazing, 3.4 ) * uSheen;
           reflectedLight.directDiffuse += uSheenColor * diffuseColor.rgb * sheen * 1.6;
         }`,
      );
  };

  return { material, uniforms };
}
