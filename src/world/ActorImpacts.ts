import * as THREE from 'three';

export type ActorKind = 'camel' | 'gazelle' | 'bird' | 'vehicle';
/** Read-only collision poses consumed by Game; no world system owns physics. */
export interface ImpactActor {
  id: number; kind: ActorKind; active: boolean; down: boolean;
  x: number; y: number; z: number; yaw: number;
  halfX: number; halfY: number; halfZ: number;
}
interface Fallen { position: THREE.Vector3; rotation: THREE.Quaternion; age: number }

/** Keeps hit instances at the impact location while their intact skin falls. */
export class ActorImpacts {
  readonly actors: ImpactActor[] = [];
  private fallen = new Map<number, Fallen>();
  private latest = new Map<number, Fallen>();
  private turn = new THREE.Quaternion();
  private offset = new THREE.Vector3();
  constructor(private kind: ActorKind, private half: [number,number,number], private centreY: number, private centreZ=0) {}
  begin() { for (const a of this.actors) a.active=false; }
  reset() { this.fallen.clear(); this.latest.clear(); this.actors.length=0; }
  hit(id: number): boolean {
    const pose=this.latest.get(id);
    if (!pose || this.fallen.has(id)) return false;
    this.fallen.set(id,{position:pose.position.clone(),rotation:pose.rotation.clone(),age:0});
    const actor=this.actors[id]; if(actor) { actor.down=true; if(this.kind!=='vehicle') actor.active=false; }
    return true;
  }
  pose(id: number, dummy: THREE.Object3D, dt: number, ground: (x:number,z:number)=>number): boolean {
    const fallen=this.fallen.get(id);
    if(fallen) {
      fallen.age+=dt;
      dummy.position.copy(fallen.position); dummy.quaternion.copy(fallen.rotation);
      if(this.kind!=='vehicle') {
        const t=Math.min(1,fallen.age/.65), eased=t*t*(3-2*t);
        this.turn.setFromAxisAngle(Z_AXIS,Math.PI*.5*eased);
        dummy.quaternion.multiply(this.turn);
        const centreHeight=THREE.MathUtils.lerp(this.centreY,this.kind==='bird'?.04:this.half[0],eased);
        this.offset.set(0,this.centreY,0).applyQuaternion(dummy.quaternion);
        dummy.position.x-=this.offset.x; dummy.position.z-=this.offset.z;
        const floor=ground(fallen.position.x,fallen.position.z);
        dummy.position.y=this.kind==='bird'
          ?Math.max(floor+.04,fallen.position.y-4.9*fallen.age*fallen.age)
          :floor+centreHeight-this.offset.y;
      }
    } else {
      let latest=this.latest.get(id);
      if(!latest) {latest={position:new THREE.Vector3(),rotation:new THREE.Quaternion(),age:0};this.latest.set(id,latest);}
      latest.position.copy(dummy.position); latest.rotation.copy(dummy.quaternion);
    }
    dummy.updateMatrix();
    const forward=this.offset.set(0,0,1).applyQuaternion(dummy.quaternion), yaw=Math.atan2(forward.x,forward.z);
    this.offset.set(0,this.centreY,this.centreZ).applyQuaternion(dummy.quaternion).add(dummy.position);
    this.actors[id]={id,kind:this.kind,active:!fallen||this.kind==='vehicle',down:!!fallen,
      x:this.offset.x,y:this.offset.y,z:this.offset.z,yaw,halfX:this.half[0],halfY:this.half[1],halfZ:this.half[2]};
    return !!fallen;
  }
}
const Z_AXIS=new THREE.Vector3(0,0,1);
