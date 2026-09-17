/** Development-only turntable using the production assets and lighting. */
import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { DrivingSound } from '../audio/DrivingSound';
import type { VehicleTelemetry, WheelState } from '../vehicle/Vehicle';
import { SceneRig } from './Scene';
import { TimeOfDay } from './TimeOfDay';
import { createVehicleView } from '../vehicle/vehicleMesh';
import { BODY_OPTIONS, type BodyId } from '../vehicle/vehicleConfig';
import { buildCamel, buildGazelle, patchAnimal, preloadAnimalGeometry } from '../world/animalGeometry';
import { buildLandmark } from '../world/Landmarks';
import { REGIONS } from '../terrain/regions';
import { createSandMaterial } from '../terrain/sandMaterial';

export async function startAssetReview(canvas: HTMLCanvasElement, ui: HTMLElement) {
  await preloadAnimalGeometry();
  document.getElementById('loader')?.remove();
  const rig = new SceneRig(canvas), time = new TimeOfDay();
  time.time = 0.64; time.autoAdvance = false; time.evaluate();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2400);
  const sand = createSandMaterial();
  const groundGeo = new THREE.PlaneGeometry(2200, 2200, 1, 1); groundGeo.rotateX(-Math.PI / 2);
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(0).map((_, i) => [0.57, 0.41, 0.25][i % 3]), 3));
  const ground = new THREE.Mesh(groundGeo, sand.material); ground.receiveShadow = true; rig.scene.add(ground);
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:18px;top:18px;z-index:100;max-width:420px;padding:16px;background:#101c1ee8;color:#eee;font:13px system-ui;border:1px solid #ffffff30;border-radius:12px;pointer-events:auto';
  panel.innerHTML = '<strong>Asset review · production geometry</strong><div style="display:flex;flex-wrap:wrap;gap:5px;margin:12px 0" data-assets></div><div style="display:flex;gap:7px"><button data-view="front">Front</button><button data-view="rear">Rear</button><button data-view="side">Side</button><button data-view="detail">Detail</button><button data-light>Change light</button><button data-night>Night</button></div><div style="display:flex;gap:7px;margin-top:8px"><button data-play>Pause motion</button><button data-step>Step pose</button><button data-suspension>Articulate</button><button data-audio>Play engine</button><button data-throttle>Rev engine</button></div><p data-audio-status></p><p data-stats></p><a href="/" style="color:#d6bd8e">Return to game</a>';
  ui.append(panel);
  const toggle=document.createElement('button');toggle.textContent='Hide controls';
  toggle.style.cssText='position:fixed;right:18px;top:18px;z-index:101;pointer-events:auto';
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.textContent=panel.hidden?'Show controls':'Hide controls';};ui.append(toggle);
  let root = new THREE.Group(), dispose: (() => void) | undefined;
  let centre = new THREE.Vector3(), size = 4, heading = 0.78, detail = false, label = '', modelHeight=3;
  const clock = { value: 0 };
  let articulation=false;
  let playing=true, vehicleUpdate: ((w: WheelState[], speed?: number)=>void)|undefined;
  let currentBody: BodyId='wagon', audio: AudioEngine|undefined, driving: DrivingSound|undefined, revving=false;
  const wheels: WheelState[]=[0,1,2,3].map(i=>({x:i%2===0?-.8:.8,y:-.65,z:i<2?1.45:-1.45,steer:0,spin:0,contact:true,compression:.5,softness:.6,contactX:0,contactY:0,contactZ:0,normalX:0,normalY:1,normalZ:0}));
  const telemetry: VehicleTelemetry={speed:0,speedKph:0,forwardSpeed:0,verticalSpeed:0,landingImpact:0,wheelsOnGround:4,airborne:false,airtime:0,rollAngle:0,pitchAngle:0,surfaceSoftness:.6,slipAngle:0,climbing:false,rolledOver:false,gearRatio:1};
  const choices: Array<{ id: string; title: string }> = BODY_OPTIONS.map(b => ({ id: b.id, title: b.label }));
  choices.push({ id: 'camel', title: 'Camel' }, { id: 'gazelle', title: 'Gazelle' });
  const pois = [...new Map(Object.values(REGIONS).flatMap(r => r.pois).map(p => [p.id, p])).values()];
  choices.push(...pois.map(p => ({ id: p.id, title: p.name })));
  const show = (id: string) => {
    if (!choices.some(choice => choice.id === id)) id = 'wagon';
    rig.scene.remove(root); dispose?.(); dispose = undefined;
    root = new THREE.Group(); vehicleUpdate=undefined;
    const poi = pois.find(p => p.id === id);
    if (id === 'camel' || id === 'gazelle') {
      const parts = id === 'camel' ? buildCamel() : buildGazelle();
      for (const [part, geo] of Object.entries(parts)) {
        geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(geo.getAttribute('position').count).fill(0), 1));
        geo.setAttribute('aGait', new THREE.Float32BufferAttribute(new Array(geo.getAttribute('position').count).fill(0.7), 1));
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: id === 'camel' ? 0.98 : 0.88 });
        mat.onBeforeCompile = shader => patchAnimal(shader, clock, id === 'camel', part === 'coat');
        mat.customProgramCacheKey = () => `${id}-${part}-v1`;
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
        const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        depth.onBeforeCompile = shader => patchAnimal(shader, clock, id === 'camel', part === 'coat'); mesh.customDepthMaterial = depth;
        depth.customProgramCacheKey = () => `${id}-depth-v1`;
        root.add(mesh);
      }
    } else if (poi) root = buildLandmark({ ...poi, x: 0, z: 0 });
    else {
      const vehicle = createVehicleView({ body: id as BodyId, paint: 'bone', wheels: 'alloy' });
      currentBody=id as BodyId;driving?.setBody(currentBody);
      vehicleUpdate=(w,s)=>vehicle.update(w,s);
      root = vehicle.root; root.position.y = vehicle.rideHeight; dispose = () => vehicle.dispose();
    }
    rig.scene.add(root); root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root), extent = bounds.getSize(new THREE.Vector3());
    modelHeight=extent.y;centre = bounds.getCenter(new THREE.Vector3()); size = Math.max(extent.x, extent.y, extent.z);
    label = choices.find(c => c.id === id)?.title ?? id;
    if (!dispose) { const old = root; dispose = () => old.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); o.customDepthMaterial?.dispose(); } }); }
    frame();
  };
  const frame = () => {
    const radius = detail ? Math.min(size*.95,Math.max(6,modelHeight*2.2)) : size*1.65;
    const target=detail?new THREE.Vector3(0,modelHeight*.4,0):centre;
    camera.position.set(target.x + Math.sin(heading) * radius, target.y + (detail?radius*.18:size*.4), target.z + Math.cos(heading) * radius);
    camera.lookAt(target);
  };
  for (const choice of choices) {
    const button = document.createElement('button'); button.textContent = choice.title; button.onclick = () => show(choice.id);
    panel.querySelector('[data-assets]')!.append(button);
  }
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => {
    const view = button.dataset.view;
    detail = view === 'detail'; heading = view === 'rear' ? 2.45 : view === 'side' ? Math.PI / 2 : 0.78; frame();
  };
  panel.querySelector<HTMLButtonElement>('[data-light]')!.onclick = () => { time.time = time.time > 0.7 ? 0.5 : time.time + 0.14; time.evaluate(); };
  panel.querySelector<HTMLButtonElement>('[data-night]')!.onclick = () => { time.time = time.state.night > 0.5 ? 0.64 : 0; time.evaluate(); };
  panel.querySelector<HTMLButtonElement>('[data-suspension]')!.onclick=()=>{articulation=!articulation;panel.querySelector('[data-suspension]')!.textContent=articulation?'Level wheels':'Articulate';};
  panel.querySelector<HTMLButtonElement>('[data-play]')!.onclick=()=>{playing=!playing;panel.querySelector('[data-play]')!.textContent=playing?'Pause motion':'Play motion';};
  panel.querySelector<HTMLButtonElement>('[data-step]')!.onclick=()=>{playing=false;clock.value+=.16;panel.querySelector('[data-play]')!.textContent='Play motion';};
  panel.querySelector<HTMLButtonElement>('[data-throttle]')!.onclick=()=>{revving=!revving;panel.querySelector('[data-throttle]')!.textContent=revving?'Idle engine':'Rev engine';};
  panel.querySelector<HTMLButtonElement>('[data-audio]')!.onclick=async()=>{
    if(driving) {driving.dispose();driving=undefined;await audio?.ctx.close();audio=undefined;panel.querySelector('[data-audio]')!.textContent='Play engine';panel.querySelector('[data-audio-status]')!.textContent='Audio stopped';return;}
    audio=new AudioEngine();await audio.resume();driving=new DrivingSound(audio);driving.setBody(currentBody);
    panel.querySelector('[data-audio-status]')!.textContent='Loading recordings…';
    await driving.ready;
    panel.querySelector('[data-audio]')!.textContent='Stop engine';
    panel.querySelector('[data-audio-status]')!.textContent=driving.recordingsLoaded===3?'3 recordings decoded · '+audio.ctx.state:'Engine recordings failed to load';
  };
  const resize = () => { const { clientWidth: w, clientHeight: h } = canvas; if (!w || !h) return; rig.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  window.addEventListener('resize', resize); resize();
  new ResizeObserver(resize).observe(canvas);
  show(new URLSearchParams(location.search).get('assets') || 'wagon');
  let previous = performance.now(), lastStats = 0;
  const direction = new THREE.Vector3();
  function animate(now: number) {
    const dt=Math.min(.05,(now-previous)/1000);previous=now;
    if(playing) clock.value+=dt;
    for(let i=0;i<4;i++) { wheels[i].spin=clock.value*2;wheels[i].steer=i<2?Math.sin(clock.value*.7)*.22:0;wheels[i].y=-.65+(articulation?Math.sin(clock.value*1.4+i)*.14:0); }
    vehicleUpdate?.(wheels,2);
    telemetry.forwardSpeed=revving?18:0;
    driving?.update(telemetry,revving?.85:0,dt);
    rig.update(time.state, time.sunDirection(direction), centre, camera.position);
    rig.renderer.render(rig.scene, camera);
    if (now - lastStats > 500) { panel.querySelector('[data-stats]')!.textContent = label + ' · ' + rig.renderer.info.render.triangles.toLocaleString() + ' triangles · ' + rig.renderer.info.render.calls + ' draws'; lastStats = now; }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
