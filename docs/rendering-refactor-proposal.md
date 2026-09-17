# Rendering and simulation refactor proposal

The sand regression found in this pass was an implementation problem: near-field track ribbons were suppressed, while the new deformation excluded low-softness surfaces. Aired-down tyres made that threshold exclude even more ground. Changing engines would preserve those mistakes unless the surface logic was rebuilt.

The current stack can render PBR assets, animate connected meshes, and deform a local surface. The corrected sand implementation also feeds its signed surface heights back to the existing raycast wheel solver. A controlled flat-ground check on all four retained vehicles showed a 7cm rut lowering the settled chassis by 7cm without losing ground contact. That establishes the mechanism; it does not establish finished driving feel across every dune or target device.

## Recommended next architecture

Keep TypeScript, Vite and Rapier initially. Separate surface state (height offsets, compaction, age, tread direction) from rendering, expose signed contact height through the composition root, and keep one fixed physics clock. Replace remaining primitive-based hero models through an authored GLB asset pipeline with proportion, material and animation checks. Those asset and simulation improvements remain useful with either renderer.

The current sand solution is bounded: a 48m detailed patch, up to 30,000 stored contact cells, and tracks that gradually fade. It approximates a thin deformable layer through wheel contact offsets; it is not a bulk granular simulation. Large dunes and chassis collision retain the streamed heightfield. Full sand piles, deep excavation and volume-conserving terrain collapse would need a more substantial simulation and collision update design.

## Browser-first engine alternative: Babylon.js

If representative profiling shows renderer maintenance or missing integrated tooling is the limiting factor, prototype Babylon.js while keeping TypeScript/Vite and initially retaining Rapier behind a physics adapter. Babylon provides WebGPU and WebGL rendering, PBR/glTF support, particles and integrated inspection tools. Its optional Havok integration would be a separate physics evaluation, because replacing the tuned raycast vehicle controller also changes the game's handling.

Primary references: [Babylon specifications](https://www.babylonjs.com/specifications/), [WebGPU support](https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md), [PBR materials](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/materials/using/masterPBR.md), [Havok runtime](https://github.com/BabylonJS/havok).

A migration would reuse region/POI data, dialogue, saves, browser UI, input contracts and audio recordings. Scene construction, Three.js geometry/material code, terrain shader hooks, instancing and camera/render integration need conversion. Existing procedural models do not become more realistic through that conversion.

## Decision gate before a full migration

Build one comparable scene in a separate prototype: a wagon, an animated camel, a detailed POI and a driveable dune with visible ruts. Use the same assets, resolution, weather, route and physics inputs. Compare appearance, CPU/GPU frame time, frame-time spikes while terrain streams, memory, loading time and browser compatibility on desktop and mobile. Aim for 60fps on the target desktop and a stable 30fps on the target phone; record the actual devices and quality settings.

Proceed only if the prototype demonstrates a material improvement or substantially reduces ongoing rendering complexity. WebGPU is an additional backend, not a guarantee of faster rendering or realistic art. No engine migration has been started in this pass.
