import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},cacheDir:join(tmpdir(),'shamal-sand-verify'),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try {
  const {SandSurface}=await server.ssrLoadModule('/src/terrain/SandSurface.ts');
  const {createSandMaterial}=await server.ssrLoadModule('/src/terrain/sandMaterial.ts');
  const {REGION_ORDER,setActiveRegion}=await server.ssrLoadModule('/src/terrain/regions.ts');
  const {heightAt,refreshRegion}=await server.ssrLoadModule('/src/terrain/height.ts');
  const {emptyWheelState}=await server.ssrLoadModule('/src/vehicle/twoWheeled.ts');
  const {SandSpray}=await server.ssrLoadModule('/src/vehicle/SandSpray.ts');
  const {TrackSystem}=await server.ssrLoadModule('/src/vehicle/TrackSystem.ts');
  const {DustSystem}=await server.ssrLoadModule('/src/vehicle/DustSystem.ts');
  const {uniforms}=createSandMaterial();
  const surface=new SandSurface(uniforms);
  const wheels=Array.from({length:4},(_,i)=>({...emptyWheelState(),contact:true,softness:.9,contactX:i%2?1:-1,contactZ:0,normalY:1}));
  const drive=(z,throttle=0,single=false,dt=.06)=>{for(const w of wheels)w.contactZ=z;surface.update(dt,0,z,wheels,4,throttle,single);};
  const pixel=(x,z)=>{const a=uniforms.uPatchArea.value,ix=Math.round((x-a.x+24)*4),iz=Math.round((z-a.y+24)*4);return surface.texture.image.data[(iz*193+ix)*4];};
  for(const region of REGION_ORDER){
    setActiveRegion(region);refreshRegion();surface.clear();drive(0);
    const p=surface.mesh.geometry.getAttribute('position');
    for(let i=0;i<p.count;i++)assert(Number.isFinite(p.getY(i)));
    // Every 2m boundary vertex must meet the unchanged coarse terrain exactly.
    for(let i=0;i<193;i+=8)for(const j of [0,192])for(const k of [i*193+j,j*193+i]){
      assert(Math.abs(p.getY(k)-heightAt(p.getX(k),p.getZ(k)))<.0001,'Patch seam differs from terrain');
    }
  }
  setActiveRegion('liwa');refreshRegion();
  surface.clear();for(let i=0;i<10;i++)surface.update(1/60,0,0,wheels,0,0);
  assert.equal(pixel(-1,0),128,'Idle tyres must not dig');
  for(let z=.1;z<=6;z+=.1)drive(z);
  assert(pixel(-1,3)<100,'No depressed tyre rut');
  assert(surface.heightOffsetAt(-1,3)<-.04,'Wheel solver misses rendered depression');
  assert(pixel(-.75,3)>128,'No displaced sand shoulder');
  assert(surface.heightOffsetAt(-.75,3)>0,'Wheel solver misses raised edge');
  assert.equal(pixel(0,3),128,'Vehicle centre should remain undisturbed');
  const before=pixel(-1,3);surface.update(.01,16,6,[],0,0);surface.update(.01,0,6,[],0,0);
  assert.equal(pixel(-1,3),before,'Ruts lost when patch recentres');
  wheels.forEach(w=>w.contact=false);drive(7);wheels.forEach(w=>w.contact=true);drive(10);
  assert.equal(pixel(-1,8),128,'Track bridged airborne gap');
  drive(50);assert.equal(pixel(-1,40),128,'Track bridged teleport');
  surface.clear();wheels.forEach(w=>w.softness=.02);drive(0);for(let z=.1;z<4;z+=.1)drive(z);
  assert(pixel(-1,2)<128,'Firm sand near spawn must retain shallow impressions');
  wheels.forEach(w=>w.softness=.9);
  surface.clear();drive(0,0,true);for(let z=.1;z<4;z+=.1)drive(z,0,true);
  assert(pixel(0,2)<128,'Bike must leave one central rut');assert.equal(pixel(-1,2),128,'Bike left car-width tracks');
  surface.clear();for(let i=0;i<80;i++)surface.update(.06,0,0,wheels,0,1);
  assert(pixel(-1,wheels[2].contactZ)<128,'Stationary wheelspin did not dig');
  assert.equal(pixel(-1,wheels[2].contactZ+1),128,'Stationary wheelspin made a square crater');
  surface.update(241,0,0,[],0,0);
  assert.equal(surface.heightOffsetAt(-1,0),0,'Old ruts never fill');
  surface.clear();assert.equal(uniforms.uPatchArea.value.w,0);assert.equal(surface.mesh.visible,false);
  // A rolling tyre must publish visible pixels on the next render, even below
  // the old 80cm ribbon spacing and 50ms texture timer.
  surface.clear();wheels.forEach(w=>{w.contactZ=0;w.softness=.35;});
  surface.update(1/60,0,0,wheels,0,0);
  const version=surface.texture.version;
  wheels.forEach(w=>w.contactZ=.02);
  surface.update(1/60,0,.02,wheels,1.2,.1);
  assert(surface.texture.version>version,'Contact upload delayed beyond current frame');
  assert(pixel(-1,0)<128,'Missing immediate 2cm movement impression');
  const tracks=new TrackSystem();wheels.forEach(w=>w.contactZ=0);
  tracks.update(wheels,[2,3],1/60);wheels.forEach(w=>w.contactZ=.02);
  tracks.update(wheels,[2,3],1/60);
  assert(tracks.mesh.geometry.drawRange.count>=12,'Ribbon waits for a full history interval');
  const positions=tracks.mesh.geometry.getAttribute('position');
  for(let step=2;step<=20;step++){
    wheels.forEach(w=>w.contactZ=step*.02);tracks.update(wheels,[2,3],1/60);
    assert(Math.abs(positions.getZ(3)-step*.02)<.001,'Live ribbon endpoint lags tyre');
  }
  const checkWidth=scrub=>{
    surface.clear();wheels.forEach(w=>{w.contactZ=0;w.softness=.6;});
    surface.update(1/60,0,0,wheels,8,.5,false,0,scrub);
    for(let z=.1;z<3;z+=.1){wheels.forEach(w=>w.contactZ=z);surface.update(1/60,0,z,wheels,8,.5,false,0,scrub);}
    return surface.heightOffsetAt(-.75,1.5);
  };
  assert(checkWidth(.65)<checkWidth(0),'Lateral slide must widen disturbed groove');
  surface.clear();wheels.forEach(w=>{w.contactZ=0;w.softness=.3;});
  surface.update(1/60,0,0,wheels,0,1);
  const firstDig=surface.heightOffsetAt(-1,0);
  for(let i=0;i<60;i++)surface.update(1/60,0,0,wheels,0,1);
  assert(surface.heightOffsetAt(-1,0)<firstDig-.002,'Wheelspin does not progressively excavate');
  const dust=new DustSystem();dust.setDirection(0,1);
  wheels.forEach(w=>{w.contactZ=0;w.contactY=0;});
  dust.emitFromWheels(wheels,0,.1,0,false,0);dust.update(.01);
  assert.equal(dust.points.geometry.getAttribute('aAlpha').array.some(v=>v>0),false,'Idle smoke');
  dust.emitFromWheels(wheels,0,.1,0,false,1);dust.update(.05);
  assert(dust.points.geometry.getAttribute('aAlpha').array.some(v=>v>0),'Missing wheelspin spray');
  for(let i=0;i<200;i++)dust.update(.02);
  assert.equal(dust.points.geometry.getAttribute('aAlpha').array.some(v=>v>0),false,'Particles never settle');
  const meanSpray=slip=>{
    const spray=new DustSystem();spray.setDirection(0,1);
    const contacts=wheels.map(w=>({...w,contactX:0,contactZ:0,softness:.15,surfaceSoftness:.8}));
    spray.emitFromWheels(contacts,16,.06,0,false,.7,slip,0);spray.update(.15);
    const g=spray.points.geometry,p=g.getAttribute('position'),alpha=g.getAttribute('aAlpha'),density=g.getAttribute('aDense');
    let count=0,x=0,dense=0;
    for(let i=0;i<p.count;i++)if(alpha.getX(i)>0){x+=p.getX(i);count++;dense=Math.max(dense,density.getX(i));}
    assert(dense===0,'Heavy sand must not use dense smoke billboards');
    assert(count>12,'Spray is too sparse to form a connected wake');
    return x/count;
  };
  const curtain=new SandSpray();
  const materialContacts=wheels.map(w=>({...w,contactX:0,contactZ:0,softness:.15,surfaceSoftness:.8}));
  const forward={x:0,y:0,z:1};
  for(let i=0;i<16;i++){
    materialContacts.forEach(w=>w.contactZ=i*.12);
    curtain.update(1/60,materialContacts,12,.8,.65,0,forward);
  }
  const cg=curtain.mesh.geometry;
  assert(curtain.mesh.material.isMeshStandardMaterial,'Sand sheet must receive scene lighting');
  assert(cg.drawRange.count>100,'Missing connected sand curtain');
  assert(cg.getAttribute('aOpacity').array.some(v=>v>.5),'Loose sand lacks a dense leading edge');
  assert(cg.getAttribute('position').array.some((v,i)=>i%3===1&&v>.3),'Sand never lifts into an arc');
  for(const value of cg.getAttribute('normal').array)assert(Number.isFinite(value),'Invalid spray normals');
  materialContacts.forEach(w=>w.contact=false);
  for(let i=0;i<70;i++)curtain.update(1/60,materialContacts,0,0,0,0,forward);
  assert.equal(cg.drawRange.count,0,'Sand sheets persist in air after emission stops');
  assert(meanSpray(.7)<-.12,'Sand must throw toward leftward slip');
  assert(meanSpray(-.7)>.12,'Sand must throw toward rightward slip');
  console.log('Sand checks passed: immediate contact pixels and ribbon endpoints, slide width, progressive digging, four-region boundaries, ruts/berms, idle/wheelspin, recentering, airborne/teleport breaks, bike tracks and settling spray.');
}finally{await server.close();}
