import * as THREE from 'three';
import type { WheelState } from './Vehicle';
import { emptyWheelState, mergeAxle } from './twoWheeled';

/**
 * Sand kicked up at the wheel contact points.
 *
 * This exists for feedback, not decoration: without it the truck has no visible
 * evidence it is touching anything, which reads as floating no matter how
 * correct the physics underneath are. Emission is driven by the *contact point*
 * of each wheel, so dust appears exactly where rubber meets sand and stops dead
 * the instant the truck leaves the ground.
 *
 * Billboarded point sprites rather than a particle sim (§4), one draw call, and
 * the round shape comes from `gl_PointCoord` so there's no texture to download.
 */
const MAX_PARTICLES = 640;
/** Below this there's no meaningful spray, just idling. */
const MIN_SPEED = 2.2;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSeed;
  attribute float aDense;
  varying float vAlpha;
  varying float vSeed;
  varying float vDense;
  void main() {
    vAlpha = aAlpha;
    vSeed = aSeed;
    vDense=aDense;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    // Perspective size attenuation, clamped so near particles can't swallow
    // the screen when the camera dips close to the ground.
    gl_PointSize = min( aSize * ( 320.0 / max( -mv.z, 0.1 ) ), 190.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vSeed;
  varying float vDense;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if(d>.5)discard;
    vec2 p=c*8.0+vSeed;
    float billow=noise(p)*.55+noise(p*2.13)*.30+noise(p*4.7)*.15;
    float edge=1.0-smoothstep(.22,.5,d+(billow-.5)*.13*vDense);
    float density=mix(pow(max(1.0-d*2.0,0.0),1.6),edge*smoothstep(.08,.65,billow),vDense);
    float a=density*vAlpha;
    if(a<=.002)discard;
    // Small clumps shade one another; the wider, dilute wake keeps the sky tint.
    float light=mix(1.0,.58+billow*.52-c.y*.20,vDense);
    gl_FragColor=vec4(uColor*light,a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class DustSystem {
  readonly points: THREE.Points;

  private positions = new Float32Array(MAX_PARTICLES * 3);
  private sizes = new Float32Array(MAX_PARTICLES);
  private alphas = new Float32Array(MAX_PARTICLES);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private ages = new Float32Array(MAX_PARTICLES);
  private lifetimes = new Float32Array(MAX_PARTICLES);
  private grains = new Uint8Array(MAX_PARTICLES);
  private densities=new Float32Array(MAX_PARTICLES);
  private seeds=new Float32Array(MAX_PARTICLES);
  private birthPositions=new Float32Array(MAX_PARTICLES*3);
  private normals=new Float32Array(MAX_PARTICLES*3);
  private previousContacts=new Map<number,{x:number;y:number;z:number}>();
  private groundY = new Float32Array(MAX_PARTICLES);
  private direction = new THREE.Vector2(0,1);
  private wind = new THREE.Vector2(1,0);
  private cursor = 0;
  /**
   * How much of the pool the current quality tier is allowed to use. The buffers
   * are always allocated at full size — resizing them would mean rebuilding the
   * geometry mid-drive — so a lower tier simply wraps the ring sooner and lets
   * the surplus particles finish their lives and stay parked.
   */
  private activeLimit = MAX_PARTICLES;
  /** Fractional emission carried between frames so slow speeds still emit. */
  private budget = 0;

  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.lifetimes.fill(0);
    this.alphas.fill(0);
    // Park unused particles far below the world rather than at the origin,
    // where they'd otherwise sit as a permanent smudge on the spawn pan.
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -10000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setAttribute('aDense',new THREE.BufferAttribute(this.densities,1));
    this.geometry.setAttribute('aSeed',new THREE.BufferAttribute(this.seeds,1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xe8c9a0) } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // Dust must not occlude itself or the truck.
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Tints the dust with the current light so it doesn't glow at dusk. */
  setColor(color: THREE.Color) {
    (this.material.uniforms.uColor.value as THREE.Color).copy(color);
  }

  setDirection(x:number,z:number){this.direction.set(x,z).normalize();}
  setWind(x:number,z:number){this.wind.set(x,z);}

  setMaxParticles(n: number) {
    this.activeLimit = Math.max(16, Math.min(MAX_PARTICLES, Math.floor(n*2)));
    if (this.cursor >= this.activeLimit) this.cursor = 0;
  }

  /**
   * @param speed  vehicle ground speed, m/s
   * @param impact 0..1 landing severity, for a burst on touchdown
   */
  /**
   * @param single the body runs on two wheels, so merge each axle onto the
   *   centre line first. Without it the bike sprays sand from four points a
   *   pickup's track apart, which is as wide as the cloud behind the pickup.
   */
  emitFromWheels(
    wheels: WheelState[],
    speed: number,
    dt: number,
    impact = 0,
    single = false,
    throttle = 0,
    slip = 0,
    brake = 0,
  ) {
    let source = wheels;
    if (single) {
      mergeAxle(wheels[0], wheels[1], this.axleFront);
      mergeAxle(wheels[2], wheels[3], this.axleRear);
      source = this.axlePair;
    }
    const grounded = source.filter((w) => w.contact);
    if (grounded.length === 0) {this.previousContacts.clear();return;}

    const digging = Math.max(0,throttle) * (1-Math.min(speed/6,1));
    if (speed > MIN_SPEED || digging > .2) {
      // Loose sand sprays far more than hardpack, which makes the traction
      // model legible at a glance instead of only through the HUD.
      const meanSoftness =
        grounded.reduce((sum, w) => sum + (w.surfaceSoftness??w.softness), 0) / grounded.length;
      const scrub=Math.min(1,Math.abs(slip)*1.6+brake*Math.min(speed/10,1));
      const rate = (Math.max(0,speed - MIN_SPEED) * (3 + meanSoftness * 12 + scrub*14) + digging * (.15+meanSoftness) * 95) * grounded.length;
      this.budget += Math.min(rate,this.activeLimit*1.25) * dt;

      while (this.budget >= 1) {
        this.budget -= 1;
        const w = grounded[(Math.random() * grounded.length) | 0];
        const loose=w.surfaceSoftness??w.softness;
        const dense=Math.min(1,(loose*Math.min(speed/16,1)*.65+scrub*.85+digging*.7)*(.35+loose*.65));
        this.spawn(w, speed + digging * 9, loose, 1, Math.random() < .88,dense,slip);
        // Fill the swept contact path, not just one cluster at each frame's end.
        const old=this.previousContacts.get(source.indexOf(w));
        if(old && Math.hypot(w.contactX-old.x,w.contactZ-old.z)<8){
          const i=(this.cursor-1+this.activeLimit)%this.activeLimit,t=Math.random();
          this.positions[i*3]-=(w.contactX-old.x)*t;
          this.positions[i*3+1]-=(w.contactY-old.y)*t;
          this.positions[i*3+2]-=(w.contactZ-old.z)*t;
        }
      }
    }

    if (impact > 0.02) {
      const burst = Math.min(26, Math.round(impact * 26));
      for (let i = 0; i < burst; i++) {
        const w = grounded[(Math.random() * grounded.length) | 0];
        this.spawn(w, speed, w.surfaceSoftness??w.softness, 1.2 + impact,false,.7,slip);
      }
    }
    for(let i=0;i<source.length;i++){
      const w=source[i];
      if(w.contact)this.previousContacts.set(i,{x:w.contactX,y:w.contactY,z:w.contactZ});else this.previousContacts.delete(i);
    }
  }

  /** Scratch for the merged two-wheeler axles; reused, never reallocated. */
  private axleFront = emptyWheelState();
  private axleRear = emptyWheelState();
  private axlePair = [this.axleFront, this.axleRear];

  private spawn(w: WheelState, speed: number, softness: number, scale: number, grain=false,dense=0,slip=0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.activeLimit;

    const spread = 0.28;
    this.positions[i * 3] = w.contactX + (Math.random() - 0.5) * spread;
    this.positions[i * 3 + 1] = w.contactY + 0.08;
    this.positions[i * 3 + 2] = w.contactZ + (Math.random() - 0.5) * spread;

    // Fine dust hangs in the air; heavier grains leave the contact patch
    // backwards and settle quickly along a ballistic arc.
    const lift = (0.7 + Math.random() * 1.3) * (0.5 + softness);
    this.velocities[i * 3] = (Math.random() - 0.5) * 1.7 + w.normalX * lift;
    this.velocities[i * 3 + 1] = w.normalY * lift + 0.4;
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.7 + w.normalZ * lift;

    this.densities[i]=0;
    this.seeds[i]=Math.random()*200;
    this.birthPositions.set([w.contactX,w.contactY,w.contactZ],i*3);
    this.normals.set([w.normalX,w.normalY,w.normalZ],i*3);
    // The leading tyres shovel sand in the direction of lateral slip. With
    // little slip, each tyre sheds a smaller shoulder on its own side.
    const side=Math.abs(slip)>.08?-Math.sign(slip):(w.x<0?-1:1);
    const lateral=(.35+Math.min(speed*.22,4.5))*(.25+dense)*side;
    this.velocities[i*3]+=this.direction.y*lateral-this.direction.x*(.6+dense*2);
    this.velocities[i*3+2]-=this.direction.x*lateral+this.direction.y*(.6+dense*2);
    if(!grain)this.velocities[i*3+1]=.65+dense*3.3+Math.random()*.8;
    this.grains[i]=grain?1:0;
    this.groundY[i]=w.contactY;
    if(grain){
      const throwSpeed=(1.4+Math.min(speed*.24,4.5))*(.5+softness);
      this.velocities[i*3]-=this.direction.x*throwSpeed;
      this.velocities[i*3+2]-=this.direction.y*throwSpeed;
      this.velocities[i*3+1]=1.0+Math.random()*1.9;
    }
    this.ages[i] = 0;
    this.lifetimes[i] = (1.0 + Math.random() * .9 + dense*.8) * scale;
    this.sizes[i] = (.8 + Math.random() * .6) * scale;
    this.alphas[i] = .035*scale;
    if(grain){
      const extreme=Math.max(0,(dense-.55)/.45);
      this.sizes[i]=(.012+Math.random()*.026)*(1-extreme*.2);
      this.alphas[i]=.65-extreme*.19;
      this.lifetimes[i]=.45+Math.random()*.25;
    }
  }

  update(dt: number) {
    let alive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] <= 0) continue;

      this.ages[i] += dt;
      const t = this.ages[i] / this.lifetimes[i];
      if (t >= 1 || (this.grains[i] && this.positions[i*3+1]<this.groundY[i]-.015)) {
        this.lifetimes[i] = 0;
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -10000;
        continue;
      }
      alive = true;

      // Settle back down and slow, like sand hanging in still air.
      const grain=this.grains[i]===1;
      this.velocities[i * 3 + 1] -= (grain?9.8:2.5+this.densities[i]*3) * dt;
      const drag = Math.exp(-(grain?.35:.85) * dt);
      if(!grain){this.velocities[i*3]+=this.wind.x*dt;this.velocities[i*3+2]+=this.wind.y*dt;}
      this.velocities[i * 3] *= drag;
      this.velocities[i * 3 + 1] *= drag;
      this.velocities[i * 3 + 2] *= drag;

      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Heavy spray falls onto the local dune plane and spreads into a low
      // rolling veil, instead of vanishing below the ground like smoke sprites.
      if(!grain){
        const nx=this.normals[i*3],ny=Math.max(.3,this.normals[i*3+1]),nz=this.normals[i*3+2];
        const floor=this.birthPositions[i*3+1]-(nx*(this.positions[i*3]-this.birthPositions[i*3])+nz*(this.positions[i*3+2]-this.birthPositions[i*3+2]))/ny;
        if(this.positions[i*3+1]<floor+.09){this.positions[i*3+1]=floor+.09;this.velocities[i*3+1]=0;}
      }
      this.sizes[i] += grain?0:dt*(.6+this.densities[i]*.65);
      this.alphas[i] *= Math.exp(-(grain?1.2:.85) * dt);
    }

    if (alive || this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.aSize.needsUpdate = true;
      this.geometry.attributes.aAlpha.needsUpdate = true;
      this.geometry.attributes.aDense.needsUpdate = true;
      this.geometry.attributes.aSeed.needsUpdate = true;
    }
    this.dirty = alive;
  }

  private dirty = false;
}
