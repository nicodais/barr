import * as THREE from 'three';
import type { WheelState } from './Vehicle';
import { emptyWheelState, mergeAxle } from './twoWheeled';
import { surfaceTexture } from '../rendering/surfaceTextures';

const ROWS=48, BANDS=10, LIFE=.85;
interface Slice {
  x:number;y:number;z:number; nx:number;ny:number;nz:number;
  dx:number;dz:number; side:number; force:number; speed:number;
  age:number; seed:number; distance:number; head:boolean;
}
/** A connected, lit granular curtain ejected by each tyre. Each cross-section
 * follows ballistic trajectories; the base settles back onto the dune plane. */
export class SandSpray {
  readonly mesh:THREE.Mesh;
  private rows:Slice[][]=[[],[],[],[]];
  private last:Array<{x:number;z:number}|null>=[null,null,null,null];
  private distances=[0,0,0,0];
  private positions=new Float32Array(4*ROWS*BANDS*3);
  private opacity=new Float32Array(4*ROWS*BANDS);
  private uv=new Float32Array(4*ROWS*BANDS*2);
  private indices=new Uint16Array(4*(ROWS-1)*(BANDS-1)*6);
  private geometry=new THREE.BufferGeometry();
  private material:THREE.MeshStandardMaterial;
  private axle=[emptyWheelState(),emptyWheelState()];
  constructor(){
    this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aOpacity',new THREE.BufferAttribute(this.opacity,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv',new THREE.BufferAttribute(this.uv,2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices,1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0,0);
    this.material=new THREE.MeshStandardMaterial({color:0xb87948,roughness:1,metalness:0,side:THREE.DoubleSide,alphaHash:true,
      normalMap:surfaceTexture('dense_sand','normal'),normalScale:new THREE.Vector2(.45,.45)});
    this.material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aOpacity; varying float vSandOpacity;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvSandOpacity=aOpacity;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vSandOpacity;')
        .replace('#include <color_fragment>',`#include <color_fragment>
          // Fragment-scale gaps break the curtain into dense granular clusters.
          float grain=sin(vNormalMapUv.x*37.0+sin(vNormalMapUv.y*29.0))*sin(vNormalMapUv.y*47.0);
          float clump=smoothstep(-.95,-.65,grain);
          diffuseColor.a*=vSandOpacity*clump;`);
    };
    this.material.customProgramCacheKey=()=> 'shamal-granular-spray-v1';
    this.mesh=new THREE.Mesh(this.geometry,this.material);
    this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;
  }
  setColor(color:THREE.Color){this.material.color.copy(color).multiplyScalar(.38);}
  clear(){this.rows=[[],[],[],[]];this.last=[null,null,null,null];this.geometry.setDrawRange(0,0);}
  update(dt:number,wheels:WheelState[],speed:number,throttle:number,slip:number,brake:number,forward:THREE.Vector3,single=false){
    let source=wheels;
    if(single){mergeAxle(wheels[0],wheels[1],this.axle[0]);mergeAxle(wheels[2],wheels[3],this.axle[1]);source=this.axle;}
    let indexCount=0;
    for(let r=0;r<4;r++){
      const rows=this.rows[r];
      for(const row of rows)row.age+=dt;
      while(rows.length&&rows[0].age>LIFE)rows.shift();
      const w=source[r],old=this.last[r];
      const travel=w&&old?Math.hypot(w.contactX-old.x,w.contactZ-old.z):0;
      const loose=w?(w.surfaceSoftness??w.softness):0;
      const digging=throttle*(1-Math.min(speed/6,1));
      const churn=Math.min(1,Math.abs(slip)*1.6+brake*Math.min(speed/8,1));
      const demand=Math.min(1,loose*(.20+Math.min(speed/14,1)*.65+churn*.95+digging*.9));
      // Keep ordinary spray unchanged; compress the upper range so a hard
      // slide throws a low sand wave instead of a tall, wide shower.
      const force=demand<=.55?demand:.55+(demand-.55)*.5;
      if(w?.contact&&force>.075&&(speed>.7||digging>.25)){
        if(travel>8)rows.length=0;
        this.distances[r]+=travel<8?travel:0;
        const side=Math.abs(slip)>.08?-Math.sign(slip):(w.x<0?-1:1);
        rows.push({x:w.contactX,y:w.contactY,z:w.contactZ,nx:w.normalX,ny:w.normalY,nz:w.normalZ,
          dx:forward.x,dz:forward.z,side,force,speed,age:0,seed:this.distances[r]*1.7,
          distance:this.distances[r],head:!old||travel>8||(rows.length>0&&rows[rows.length-1].side!==side)});
        if(rows.length>ROWS)rows.shift();
        this.last[r]={x:w.contactX,z:w.contactZ};
      }else this.last[r]=null;
      const base=r*ROWS*BANDS;
      for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
        const row=rows[rowIndex],age=row.age;
        for(let band=0;band<BANDS;band++){
          const f=band/(BANDS-1),v=base+rowIndex*BANDS+band;
          const irregular=Math.sin(row.seed*4.1+f*7.0)*.04*row.force;
          // Broaden the fan independently of the restrained vertical launch.
          const lateral=(.45+row.force*5.5)*1.25*age*(.15+f*.85)*row.side;
          const trailing=(.25+row.force*1.4)*age;
          const x=row.x+row.dz*lateral-row.dx*trailing;
          const z=row.z-row.dx*lateral-row.dz*trailing;
          const floor=row.y-(row.nx*(x-row.x)+row.nz*(z-row.z))/Math.max(.35,row.ny);
          const lift=(1.2+row.force*4.5)*(.15+f*.85)*age-4.9*age*age;
          const y=Math.max(floor+.025,row.y+lift+irregular*Math.min(1,age*12));
          this.positions.set([x,y,z],v*3);
          // Dense at the tyre, broken at the lip, then falling apart as it lands.
          const edge=1-THREE.MathUtils.smoothstep(f,.72,1);
          this.opacity[v]=(.90+row.force*.10)*edge*(1-THREE.MathUtils.smoothstep(age,.42,LIFE));
          this.uv.set([row.distance*1.3,f*1.8+age*.3],v*2);
        }
        if(rowIndex>0&&!row.head)for(let band=0;band<BANDS-1;band++){
          const a=base+(rowIndex-1)*BANDS+band,b=a+BANDS;
          this.indices.set([a,b,a+1,a+1,b,b+1],indexCount);indexCount+=6;
        }
      }
    }
    this.geometry.setDrawRange(0,indexCount);
    this.geometry.attributes.position.needsUpdate=true;this.geometry.attributes.aOpacity.needsUpdate=true;this.geometry.attributes.uv.needsUpdate=true;
    this.geometry.index!.needsUpdate=true;
    if(indexCount)this.geometry.computeVertexNormals();
  }
}
