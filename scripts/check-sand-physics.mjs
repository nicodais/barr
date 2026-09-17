import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import RAPIER from '@dimforge/rapier3d-compat';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},cacheDir:join(tmpdir(),'shamal-sand-physics'),server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try{
  await RAPIER.init();
  const {Vehicle}=await server.ssrLoadModule('/src/vehicle/Vehicle.ts');
  const {BODY_TUNING}=await server.ssrLoadModule('/src/vehicle/vehicleConfig.ts');
  for(const body of ['wagon','pickup','moto','buggy']){
    const world=new RAPIER.World({x:0,y:-9.81,z:0});
    world.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
    world.queryPipeline.update(world.colliders);
    const vehicle=new Vehicle(RAPIER,world,{x:0,y:1.8,z:0});
    Object.assign(vehicle.tuning,BODY_TUNING[body]);vehicle.applyTuning();
    const idle={throttle:0,steer:0,brake:0,handbrake:0};
    const step=(input,frames)=>{for(let i=0;i<frames;i++){vehicle.update(input,1/60);world.step();for(const value of Object.values(vehicle.body.translation()))assert(Number.isFinite(value));}};
    step(idle,240);assert.equal(vehicle.telemetry.wheelsOnGround,4,body+' not grounded');
    const base=vehicle.body.translation().y;
    for(let i=0;i<4;i++)vehicle.setContactSurfaceHeight(i,-.07);
    step(idle,180);const rut=vehicle.body.translation().y;
    assert(base-rut>.045&&base-rut<.095,body+' did not settle into 7cm rut');
    for(let i=0;i<4;i++)vehicle.setContactSurfaceHeight(i,.035);
    step(idle,180);assert(vehicle.body.translation().y-rut>.075,body+' did not climb raised sand');
    for(let i=0;i<4;i++)vehicle.setContactSurfaceHeight(i,0);
    step({...idle,throttle:.7},180);
    assert(vehicle.telemetry.forwardSpeed>1,body+' throttle fails to move forward');
    assert(Math.abs(vehicle.telemetry.rollAngle)<.3,body+' unstable on level ground');
    console.log(body+': stable ground contact; 7cm rut lowered body '+((base-rut)*100).toFixed(1)+'cm; forward acceleration '+vehicle.telemetry.speedKph.toFixed(1)+'km/h');
    world.free();
  }
}finally{await server.close();}
