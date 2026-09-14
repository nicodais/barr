import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import * as THREE from 'three';
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: join(tmpdir(), 'shamal-assets-verify'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const { createVehicleView } = await server.ssrLoadModule('/src/vehicle/vehicleMesh.ts');
  const { BODY_OPTIONS, sanitizeVehicleConfig } = await server.ssrLoadModule('/src/vehicle/vehicleConfig.ts');
  assert.deepEqual(BODY_OPTIONS.map(body=>body.id), ['wagon','pickup','moto','buggy']);
  for(const body of ['gwagon','singlecab','softtop']) {
    assert.deepEqual(sanitizeVehicleConfig({body,paint:'oxide',wheels:'beadlock'}), {body:'wagon',paint:'oxide',wheels:'beadlock'}, 'Retired selection must preserve paint and wheels');
  }
  const { TrafficFleet } = await server.ssrLoadModule('/src/world/TrafficFleet.ts');
  const { createGhafTree } = await server.ssrLoadModule('/src/world/GhafTree.ts');
  const { createLandmarks, buildLandmark } = await server.ssrLoadModule('/src/world/Landmarks.ts');
  const { REGION_ORDER, setActiveRegion, activeRegion } = await server.ssrLoadModule('/src/terrain/regions.ts');
  const { sampleRoute, emptyRoutePoint } = await server.ssrLoadModule('/src/world/routes.ts');
  const validate = root => {
    let meshes = 0;
    root.traverse(obj => {
      if (!obj.isMesh) return;
      meshes++;
      const geometry = obj.geometry;
      for (const key of ['position', 'normal']) {
        const a = geometry.getAttribute(key);
        assert(a && a.count > 0, 'Missing geometry ' + key);
        for (const value of a.array) assert(Number.isFinite(value), 'Non-finite ' + key);
      }
      const index = geometry.index;
      if (index) for (const i of index.array) assert(i < geometry.getAttribute('position').count);
      assert(obj.material.isMeshStandardMaterial || obj.material.isMeshPhysicalMaterial, 'Non-PBR model material');
    });
    assert(meshes > 0);
    return meshes;
  };
  for (const body of BODY_OPTIONS) for (const wheels of ['steel', 'alloy', 'beadlock']) {
    const view = createVehicleView({ body: body.id, paint: 'bone', wheels });
    validate(view.root);
    const bounds = new THREE.Box3().setFromObject(view.root);
    if (!['moto','buggy'].includes(body.id)) assert(bounds.max.y + view.rideHeight < 2.5, 'Oversized vehicle roofline');
    assert.equal(view.wheels.length, body.id === 'moto' ? 2 : 4);
    for (const [i,wheel] of view.wheels.entries()) { const radius=body.id==='moto'?(i===0?.35:.33):body.id==='buggy'?.40:.42;assert(Math.abs(wheel.position.y+view.rideHeight-radius)<.00001,'Wheel misses resting ground'); }
    if(body.id==='moto') assert(Math.abs(view.wheels[0].position.z-view.wheels[1].position.z-1.50)<.0001,'Dirt bike wheelbase');
    const states=[0,1,2,3].map(i=>({x:i%2===0?-.8:.8,y:-.65,z:i<2?1.45:-1.45,steer:i<2?.3:0,spin:4}));
    for(let pose=0;pose<8;pose++){ states.forEach((w,i)=>w.y=-.65+Math.sin(pose+i)*.14);view.update(states,8);view.root.updateMatrixWorld(true);view.root.traverse(o=>{for(const v of o.matrixWorld.elements)assert(Number.isFinite(v),'Invalid animated transform');}); }
    view.dispose();
  }
  const tree = createGhafTree();
  validate(tree);
  const foliage = tree.children.find(o => o.material.vertexColors);
  const leaves = foliage.geometry.getAttribute('position');
  for (let i = 0; i < leaves.count; i += 6) {
    const span = Math.hypot(leaves.getX(i+2)-leaves.getX(i), leaves.getY(i+2)-leaves.getY(i), leaves.getZ(i+2)-leaves.getZ(i));
    assert(span > 0.005 && span < 0.06, 'Oversized or collapsed ghaf leaflet');
  }
  assert(tree.children[0].geometry.hasAttribute('uv'), 'Missing bark UVs');
  tree.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  const fleet = new TrafficFleet(v => createVehicleView({ body: v ? 'pickup' : 'wagon', paint: 'safari', wheels: 'steel' }), 12);
  fleet.begin();
  for (let i = 0; i < 9; i++) fleet.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 8, 0, 0), i * 0.3);
  fleet.end();
  validate(fleet.group);
  for (const mesh of fleet.group.children) {
    assert(mesh.count === 4 || mesh.count === 5, 'Traffic batch count');
    for (const value of mesh.instanceMatrix.array) assert(Number.isFinite(value));
  }
  fleet.dispose();
  for (const region of REGION_ORDER) {
    setActiveRegion(region);
    const landmarks = createLandmarks();
    assert.equal(landmarks.children.length, activeRegion().pois.length);
    validate(landmarks);
    for(const poi of activeRegion().pois) if(poi.kind==='falconry') {
      const raw=buildLandmark({...poi,x:0,z:0});let cones=0;
      raw.traverse(o=>{if(o.geometry?.type==='ConeGeometry'){cones++;assert(o.geometry.parameters.radius<.5,'Falcon hood/beak expanded to default cylinder radius');}o.geometry?.dispose();});
      assert(cones>0,'Falcon cone regression check did not exercise any cones');
    }
    for (let i = 0; i < 30; i++) {
      const p = sampleRoute({ cx: 0, cz: 0, major: 260, minor: 48, bearing: 1, direction: 1 }, i / 30 * Math.PI * 2, emptyRoutePoint());
      for (const value of Object.values(p)) assert(Number.isFinite(value));
      assert(Math.abs(p.pitch) < Math.PI / 2 && Math.abs(p.roll) < Math.PI / 2);
    }
    landmarks.traverse(o => o.geometry?.dispose());
  }
  for (const name of ['camel', 'gazelle']) {
    const data = await readFile('public/models/' + name + '.mesh');
    const length = data.readUInt32LE(0), header = JSON.parse(data.subarray(4, 4 + length).toString());
    for (const [partName,part] of Object.entries(header)) {
      const position = part.position, index = part.index;
      assert(position.length > 300 && index.length > 300);
      for (const info of Object.values(part)) {
        const Type = { Float32Array, Uint8Array, Uint16Array, Uint32Array, Int16Array }[info.type];
        const array = new Type(data.buffer, data.byteOffset + 4 + length + info.offset, info.length);
        for (const value of array) assert(Number.isFinite(value));
        if (info === index) for (const value of array) assert(value < position.length / 3);
      }
      if(partName==='coat') {
        // Weld by position, independent of normal/color splits, then check the skin
        // is one connected component. Separate rigid limbs cannot pass this check.
        const positions=new Float32Array(data.buffer,data.byteOffset+4+length+position.offset,position.length);
        const Index=index.type==='Uint32Array'?Uint32Array:Uint16Array;
        const indices=new Index(data.buffer,data.byteOffset+4+length+index.offset,index.length);
        const ids=new Map(), vertex=[];let next=0;
        for(let i=0;i<positions.length;i+=3){const key=[positions[i],positions[i+1],positions[i+2]].map(v=>Math.round(v*10000)).join(',');if(!ids.has(key))ids.set(key,next++);vertex.push(ids.get(key));}
        const parent=Array.from({length:next},(_,i)=>i);
        const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
        for(let i=0;i<indices.length;i+=3){const a=find(vertex[indices[i]]);for(let j=1;j<3;j++)parent[find(vertex[indices[i+j]])]=a;}
        const groups=new Map();for(let i=0;i<next;i++){const root=find(i);groups.set(root,(groups.get(root)||0)+1);}
        console.log(name+' skin components: '+[...groups.values()].sort((a,b)=>b-a).join(', '));
        assert.equal(groups.size,1,name+' skin has detached components');
      }
    }
  }
  console.log('PASS: 12 vehicle variants; retired selection fallback; shared traffic batches; every POI in all four regions; terrain route transforms; both continuous animal skins.');
} finally { await server.close(); }
