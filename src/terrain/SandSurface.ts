import * as THREE from 'three';
import type { WheelState } from '../vehicle/Vehicle';
import { heightAt, rockAt } from './height';
import { writeTerrainColor } from './chunkGeometry';
import { createSandMaterial, type SandUniforms } from './sandMaterial';

// A 48m contact patch with 25cm vertices: 74k triangles, independent of route length.
const STEP=.25, HALF=24, N=192, SIZE=N+1;
// Region coordinates are bounded well inside ±8192m. Numeric grid keys avoid
// allocating tens of thousands of coordinate strings during every texture upload.
const gridKey=(x:number,z:number)=>(x+32768)*65536+z+32768;
interface Mark { depth:number; packed:number; time:number; dx:number; dz:number }
/** A bounded, high-resolution contact surface. Large dunes/colliders retain their
 * original shape; only centimetre-scale loose sand is displaced here. */
export class SandSurface {
  readonly stats={rutDepth:0,raisedEdge:0,cells:0};
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.DataTexture;
  private pixels=new Uint8Array(SIZE*SIZE*4);
  private marks=new Map<number,Mark>();
  private previous: Array<{x:number;z:number}|null>=[null,null];
  private directions=[{x:0,z:1},{x:0,z:1}];
  private cx=Infinity;
  private cz=Infinity;
  private time=0;
  private uploadTime=0;
  private changed=new Set<number>();
  constructor(private uniforms:SandUniforms) {
    this.texture=new THREE.DataTexture(this.pixels,SIZE,SIZE,THREE.RGBAFormat);
    this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;
    this.texture.generateMipmaps=false;
    uniforms.uContactMap.value=this.texture;
    uniforms.uContactSize.value=SIZE;
    const geometry=new THREE.BufferGeometry();
    const positions=new Float32Array(SIZE*SIZE*3),colors=new Float32Array(positions.length);
    const indices=new Uint16Array(N*N*6);let k=0;
    for(let x=0;x<N;x++)for(let z=0;z<N;z++){
      const a=x*SIZE+z,b=a+1,c=a+SIZE+1,d=a+SIZE;
      indices.set([a,b,c,a,c,d],k);k+=6;
    }
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(positions.length),3));
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));
    this.mesh=new THREE.Mesh(geometry,createSandMaterial(true,uniforms).material);
    this.mesh.receiveShadow=true;this.mesh.castShadow=false;this.mesh.frustumCulled=false;
    this.mesh.visible=false;
    this.clear();
  }
  clear(){
    this.marks.clear();this.changed.clear();this.previous=[null,null];this.cx=this.cz=Infinity;
    this.stats.rutDepth=this.stats.raisedEdge=this.stats.cells=0;
    this.uniforms.uPatchArea.value.w=0;this.mesh.visible=false;
    for(let i=0;i<SIZE*SIZE;i++)this.pixels.set([128,0,128,128],i*4);
    this.texture.needsUpdate=true;
  }
  private recenter(x:number,z:number){
    this.cx=x;this.cz=z;
    const h=new Float32Array(25*25),c=new Float32Array(25*25*3);
    for(let ix=0;ix<25;ix++)for(let iz=0;iz<25;iz++){
      const i=ix*25+iz,wx=x-HALF+ix*2,wz=z-HALF+iz*2;
      h[i]=heightAt(wx,wz);writeTerrainColor(c,i,wx,wz);
    }
    const normals=new Float32Array(c.length);
    for(let ix=0;ix<25;ix++)for(let iz=0;iz<25;iz++){
      const i=ix*25+iz,wx=x-HALF+ix*2,wz=z-HALF+iz*2;
      const nx=((ix>0?h[i-25]:heightAt(wx-2,wz))-(ix<24?h[i+25]:heightAt(wx+2,wz)))/4;
      const nz=((iz>0?h[i-1]:heightAt(wx,wz-2))-(iz<24?h[i+1]:heightAt(wx,wz+2)))/4;
      const length=Math.hypot(nx,1,nz);normals.set([nx/length,1/length,nz/length],i*3);
    }
    const normal=this.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const p=this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color=this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    // Interpolate the same two triangles as the 2m collision/terrain grid. The
    // boundary is identical to the streamed mesh, even on steep dune faces.
    for(let ix=0;ix<SIZE;ix++)for(let iz=0;iz<SIZE;iz++){
      const gx=ix/8,gz=iz/8,a=Math.min(23,Math.floor(gx)),b=Math.min(23,Math.floor(gz)),fx=gx-a,fz=gz-b;
      const i=a*25+b,j=fx>fz?i+25:i+1,k=i+26;
      const wa=1-Math.max(fx,fz),wb=Math.abs(fx-fz),wc=Math.min(fx,fz);
      const v=ix*SIZE+iz;
      p.setXYZ(v,x-HALF+ix*STEP,h[i]*wa+h[j]*wb+h[k]*wc,z-HALF+iz*STEP);
      for(let channel=0;channel<3;channel++){
        color.array[v*3+channel]=c[i*3+channel]*wa+c[j*3+channel]*wb+c[k*3+channel]*wc;
        normal.array[v*3+channel]=normals[i*3+channel]*wa+normals[j*3+channel]*wb+normals[k*3+channel]*wc;
      }
    }
    p.needsUpdate=color.needsUpdate=normal.needsUpdate=true;
    this.mesh.geometry.computeBoundingSphere();
    this.uniforms.uPatchArea.value.set(x,z,HALF,1);this.mesh.visible=true;
  }
  update(dt:number,x:number,z:number,wheels:WheelState[],speed:number,throttle:number,single=false,brake=0,slip=0){
    this.time+=dt;this.uniforms.uSandTime.value+=dt;
    const cx=Math.round(x/8)*8,cz=Math.round(z/8)*8;
    const moved=cx!==this.cx||cz!==this.cz;
    if(moved)this.recenter(cx,cz);
    for(let r=0;r<(single?1:2);r++){
      const a=wheels[2+r],b=single?wheels[3]:a;
      if(!a?.contact||!b?.contact){this.previous[r]=null;continue;}
      const wx=(a.contactX+b.contactX)/2,wz=(a.contactZ+b.contactZ)/2;
      if(rockAt(wx,wz)>.45){this.previous[r]=null;continue;}
      const old=this.previous[r],distance=old?Math.hypot(wx-old.x,wz-old.z):0;
      if(distance>8){this.previous[r]={x:wx,z:wz};continue;}
      const soft=(a.softness+b.softness)/2;
      const scrub=Math.min(1,Math.abs(slip)*1.4+brake*Math.min(speed/8,1));
      const digging=Math.max(0,throttle)*(1-Math.min(1,speed/6));
      if(distance>.002||digging>.2||(!old&&speed>.25)){
        const count=Math.max(1,Math.ceil(distance/.12));
        const dx=old?wx-old.x:0,dz=old?wz-old.z:0;
        if(distance>.001)this.directions[r]={x:dx/distance,z:dz/distance};
        const direction=this.directions[r];
        for(let i=1;i<=count;i++)this.stamp(old?old.x+dx*i/count:wx,old?old.z+dz*i/count:wz,direction.x,direction.z,soft,digging,single,scrub,dt/count);
        this.previous[r]={x:wx,z:wz};
      }else if(!old)this.previous[r]={x:wx,z:wz};
    }
    if(single)this.previous[1]=null;
    this.uploadTime+=dt;
    // Publish fresh contact pixels before this frame renders. Only ageing and
    // recentering scan the full patch; contact updates touch a small dirty set.
    if(moved||this.uploadTime>.5){this.uploadTime=0;this.upload();}
    else if(this.changed.size){
      const baseX=Math.round((this.cx-HALF)/STEP),baseZ=Math.round((this.cz-HALF)/STEP);
      for(const index of this.changed){
        const ix=index%SIZE,iz=Math.floor(index/SIZE);
        this.writePixel(index,this.marks.get(gridKey(baseX+ix,baseZ+iz)));
      }
      this.texture.needsUpdate=true;
    }
    this.changed.clear();
  }
  private stamp(x:number,z:number,dx:number,dz:number,soft:number,digging:number,single:boolean,scrub:number,dt:number){
    const ix=Math.round(x/STEP),iz=Math.round(z/STEP),width=(single?.115:.21)+scrub*soft*.18;
    for(let xx=ix-3;xx<=ix+3;xx++)for(let zz=iz-3;zz<=iz+3;zz++){
      const ox=xx*STEP-x,oz=zz*STEP-z,across=Math.abs(ox*dz-oz*dx),along=Math.abs(ox*dx+oz*dz);
      if(along>.36||across>width+.25)continue;
      const end=1-THREE.MathUtils.smoothstep(along,.15,.36);
      const rut=(1-THREE.MathUtils.smoothstep(across,width*.3,width))*Math.min(.115,.015+soft*.15+(digging*.035+scrub*.025)*soft)*end;
      const ridge=Math.exp(-(((across-width-.10)/.095)**2))*(.004+soft*(.07+scrub*.035))*end;
      const key=gridKey(xx,zz),old=this.marks.get(key),depth=rut>.002?-rut:ridge;
      let displaced=depth<0?Math.min(old?.depth??0,depth):(old && old.depth<0?old.depth:Math.max(old?.depth??0,depth));
      // Repeated spinning excavates progressively; rolling contact leaves a
      // shallow impression immediately. The loose layer has a bounded depth.
      if(depth<0&&digging>.2)displaced=Math.max(-.115,displaced-soft*digging*.025*dt*end);
      this.marks.delete(key);
      this.marks.set(key,{depth:displaced,packed:Math.min(1,Math.max(old?.packed??0,(rut>.002?.34+rut/.12:0))),time:this.time,dx,dz});
      const px=xx-Math.round((this.cx-HALF)/STEP),pz=zz-Math.round((this.cz-HALF)/STEP);
      if(px>=0&&px<SIZE&&pz>=0&&pz<SIZE)this.changed.add(pz*SIZE+px);
    }
    // Bound memory even after a long session; keep the most recent route.
    while(this.marks.size>30000)this.marks.delete(this.marks.keys().next().value!);
  }
  /** Signed height of the disturbed surface, also supplied to the wheel solver. */
  heightOffsetAt(x:number,z:number):number {
    const gx=x/STEP,gz=z/STEP,ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
    let height=0;
    for(let a=0;a<2;a++)for(let b=0;b<2;b++){
      const mark=this.marks.get(gridKey(ix+a,iz+b));
      if(mark)height+=mark.depth*(1-THREE.MathUtils.smoothstep(this.time-mark.time,100,240))*(a?fx:1-fx)*(b?fz:1-fz);
    }
    return height;
  }
  private upload(){
    this.stats.rutDepth=0;this.stats.raisedEdge=0;this.stats.cells=0;
    for(const [key,mark]of this.marks)if(this.time-mark.time>240)this.marks.delete(key);
    for(let ix=0;ix<SIZE;ix++)for(let iz=0;iz<SIZE;iz++){
      const key=gridKey(Math.round((this.cx-HALF)/STEP)+ix,Math.round((this.cz-HALF)/STEP)+iz),mark=this.marks.get(key);
      const fade=mark?1-THREE.MathUtils.smoothstep(this.time-mark.time,100,240):0;
      // Texture rows follow world Z; geometry vertices are ordered X-major.
      if(fade>0)this.stats.cells++;
      this.writePixel(iz*SIZE+ix,mark,fade);
    }
    this.texture.needsUpdate=true;
  }
  private writePixel(index:number,mark:Mark|undefined,fade=mark?1-THREE.MathUtils.smoothstep(this.time-mark.time,100,240):0){
    const depth=(mark?.depth??0)*fade,i=index*4;
    this.stats.rutDepth=Math.max(this.stats.rutDepth,-depth);
    this.stats.raisedEdge=Math.max(this.stats.raisedEdge,depth);

    this.pixels[i]=128+Math.round(depth/.12*127);
    this.pixels[i+1]=Math.round((mark?.packed??0)*fade*255);
    this.pixels[i+2]=128+Math.round((mark?.dx??0)*127);
    this.pixels[i+3]=128+Math.round((mark?.dz??0)*127);
  }

}
