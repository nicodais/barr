import RAPIER from '@dimforge/rapier3d-compat';
import type { ImpactActor } from '../world/ActorImpacts';

export interface ActorSource { name:string; actors:readonly ImpactActor[] }
interface Proxy { body:RAPIER.RigidBody; collider:RAPIER.Collider; actor:ImpactActor; source:string }
/** Kinematic proxies share Game's world and physics clock. */
export class ExtremeCollisions {
  readonly events=new RAPIER.EventQueue(true);
  private proxies=new Map<string,Proxy>();
  private handles=new Map<number,Proxy>();
  constructor(private world:RAPIER.World) {}
  sync(sources:ActorSource[],focus:{x:number;y:number;z:number}) {
    const seen=new Set<string>();
    for(const source of sources)for(const actor of source.actors) {
      if(!actor?.active || Math.hypot(actor.x-focus.x,actor.y-focus.y,actor.z-focus.z)>100)continue;
      const key=source.name+':'+actor.id;seen.add(key);
      let proxy=this.proxies.get(key);
      const position={x:actor.x,y:actor.y,z:actor.z};
      const rotation={x:0,y:Math.sin(actor.yaw/2),z:0,w:Math.cos(actor.yaw/2)};
      if(!proxy) {
        const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x,position.y,position.z).setRotation(rotation));
        const collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(actor.halfX,actor.halfY,actor.halfZ).setFriction(.6).setRestitution(.1),body);
        proxy={body,collider,actor,source:source.name};this.proxies.set(key,proxy);this.handles.set(collider.handle,proxy);
      }
      proxy.actor=actor;
      proxy.body.setNextKinematicTranslation(position);proxy.body.setNextKinematicRotation(rotation);
    }
    for(const [key,proxy]of this.proxies)if(!seen.has(key)){this.handles.delete(proxy.collider.handle);this.world.removeRigidBody(proxy.body);this.proxies.delete(key);}
  }
  drain(player:RAPIER.Collider,mass:number,dt:number,onHit:(source:string,actor:ImpactActor)=>void):number {
    let deltaV=0;
    const hits=new Set<Proxy>();
    this.events.drainContactForceEvents(event=>{
      const a=event.collider1(),b=event.collider2();
      if(a!==player.handle&&b!==player.handle)return;
      const strength=event.totalForceMagnitude()*dt/Math.max(1,mass);
      deltaV=Math.max(deltaV,strength);
      const proxy=this.handles.get(a===player.handle?b:a);
      if(proxy&&!proxy.actor.down&&strength>1.5)hits.add(proxy);
    });
    for(const proxy of hits)onHit(proxy.source,proxy.actor);
    return deltaV;
  }
  clear() {
    for(const p of this.proxies.values())this.world.removeRigidBody(p.body);
    this.proxies.clear();this.handles.clear();this.events.clear();
  }
}
