import * as THREE from 'three';
const STAINS=96, SIDES=18, PARTICLES=72;
/** Bounded pools: terrain-conforming stains and a short fire/debris burst. */
export class ExtremeEffects {
  readonly group=new THREE.Group();
  private stains:THREE.Mesh;
  private stainPositions=new Float32Array(STAINS*SIDES*9);
  private cursor=0;
  private count=0;
  private burst:THREE.InstancedMesh;
  private alpha=new THREE.InstancedBufferAttribute(new Float32Array(PARTICLES),1);
  private velocities=Array.from({length:PARTICLES},()=>new THREE.Vector3());
  private origin=new THREE.Vector3();
  private age=10;
  private dummy=new THREE.Object3D();
  private tint=new THREE.Color();
  private flash=new THREE.PointLight(0xffad43,0,24,2);
  constructor(private ground:(x:number,z:number)=>number) {
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.stainPositions,3));geo.setDrawRange(0,0);
    this.stains=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x761a12,roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
    this.stains.frustumCulled=false;this.stains.receiveShadow=true;
    const puffGeo=new THREE.IcosahedronGeometry(1,2);puffGeo.setAttribute('aOpacity',this.alpha);
    const mat=new THREE.MeshBasicMaterial({transparent:true,depthWrite:false});
    mat.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aOpacity; varying float vOpacity; varying float vFacing; varying vec3 vSurface;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOpacity=aOpacity; vSurface=position;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFacing=abs(dot(normalize(normalMatrix * mat3(instanceMatrix) * normal),normalize(-mvPosition.xyz)));');
      shader.fragmentShader=shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vOpacity; varying float vFacing; varying vec3 vSurface;
          float fireHash(vec3 p) {
            p=fract(p*.1031);p+=dot(p,p.yzx+33.33);
            return fract((p.x+p.y)*p.z);
          }
          float fireNoise(vec3 p) {
            vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
            return mix(mix(mix(fireHash(i),fireHash(i+vec3(1,0,0)),f.x),
              mix(fireHash(i+vec3(0,1,0)),fireHash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(fireHash(i+vec3(0,0,1)),fireHash(i+vec3(1,0,1)),f.x),
              mix(fireHash(i+vec3(0,1,1)),fireHash(i+vec3(1,1,1)),f.x),f.y),f.z);
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float turbulence = .35 + .45 * fireNoise(vSurface*3.) + .2 * fireNoise(vSurface*7.);
          gl_FragColor.rgb *= .7 + .3 * turbulence;
          gl_FragColor.a *= vOpacity * smoothstep(.02,.75,vFacing) * turbulence;
          if(gl_FragColor.a < .004) discard;`);
    };
    this.burst=new THREE.InstancedMesh(puffGeo,mat,PARTICLES);this.burst.count=0;this.burst.frustumCulled=false;
    this.group.add(this.stains,this.burst,this.flash);
  }
  blood(x:number,z:number,size=1) {
    for(let drop=0;drop<12;drop++) {
      const a=Math.random()*Math.PI*2,d=drop===0?0:Math.random()*1.8*size;
      const cx=x+Math.cos(a)*d,cz=z+Math.sin(a)*d,r=(drop===0?.8:.04+Math.random()*.2)*size;
      const slot=this.cursor++%STAINS;this.count=Math.min(STAINS,this.count+1);
      const radii=Array.from({length:SIDES},()=>r*(.65+Math.random()*.55));
      for(let i=0;i<SIDES;i++) {
        const j=(i+1)%SIDES;
        const points=[[cx,cz],[cx+Math.cos(i/SIDES*Math.PI*2)*radii[i],cz+Math.sin(i/SIDES*Math.PI*2)*radii[i]],
          [cx+Math.cos(j/SIDES*Math.PI*2)*radii[j],cz+Math.sin(j/SIDES*Math.PI*2)*radii[j]]];
        for(let k=0;k<3;k++){const [px,pz]=points[k],o=(slot*SIDES+i)*9+k*3;this.stainPositions.set([px,this.ground(px,pz)+.022,pz],o);}
      }
    }
    this.stains.geometry.attributes.position.needsUpdate=true;
    this.stains.geometry.setDrawRange(0,this.count*SIDES*3);this.stains.geometry.computeVertexNormals();
  }
  explode(position:{x:number;y:number;z:number}) {
    this.origin.set(position.x,position.y,position.z);this.age=0;this.burst.count=PARTICLES;
    this.flash.position.copy(this.origin);
    for(let i=0;i<PARTICLES;i++) {
      const a=Math.random()*Math.PI*2,speed=3+Math.random()*13;
      this.velocities[i].set(Math.cos(a)*speed,3+Math.random()*12,Math.sin(a)*speed);
    }
  }
  update(dt:number) {
    this.age+=dt;const t=this.age;
    this.flash.intensity=t<.4?45*(1-t/.4):0;
    if(t>5){this.burst.count=0;return;}
    for(let i=0;i<PARTICLES;i++) {
      const debris=i<18,v=this.velocities[i],travel=debris?t:(1-Math.exp(-t*1.7))/1.7;
      this.dummy.position.copy(this.origin).addScaledVector(v,travel);
      if(debris)this.dummy.position.y=Math.max(this.ground(this.dummy.position.x,this.dummy.position.z)+.08,this.dummy.position.y-4.9*t*t);
      else this.dummy.position.y+=t*1.5;
      const fire=!debris&&t<.7;
      this.dummy.scale.setScalar(debris?.05+(i%4)*.035:fire?.4+t*.9:.6+t*.45);
      this.dummy.rotation.set(i+t*2,i*.7+t,i*.3);this.dummy.updateMatrix();this.burst.setMatrixAt(i,this.dummy.matrix);
      this.tint.set(debris?0x292320:fire?(i%3?0xff740e:0xffcf63):0x49443e);
      this.burst.setColorAt(i,this.tint);
      this.alpha.setX(i,debris?Math.min(1,(5-t)/1.5):fire?.9:Math.max(0,(1-t/5)*.10));
    }
    this.burst.instanceMatrix.needsUpdate=true;this.burst.instanceColor!.needsUpdate=true;this.alpha.needsUpdate=true;
  }
  clear() {this.count=0;this.cursor=0;this.stains.geometry.setDrawRange(0,0);this.age=10;this.burst.count=0;this.flash.intensity=0;}
}
