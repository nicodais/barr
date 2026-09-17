import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function springBetween(from: THREE.Vector3, to: THREE.Vector3, radius = 0.07): THREE.BufferGeometry {
  const axis = to.clone().sub(from), length = axis.length();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 144; i++) {
    const t = i / 144, a = t * Math.PI * 2 * 9;
    points.push(new THREE.Vector3(Math.cos(a)*radius, t*length, Math.sin(a)*radius));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 144, 0.009, 6, false);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), axis.normalize()));
  geo.translate(from.x,from.y,from.z);
  return geo;
}

/** A moulded seat shell: curved shoulders, side bolsters and open belt slots. */
export function bucketSeat(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-.17,0); shape.bezierCurveTo(-.25,.12,-.23,.34,-.20,.40);
  shape.bezierCurveTo(-.28,.46,-.22,.53,-.13,.52);
  shape.lineTo(-.11,.64); shape.quadraticCurveTo(0,.68,.11,.64);
  shape.lineTo(.13,.52); shape.bezierCurveTo(.22,.53,.28,.46,.20,.40);
  shape.bezierCurveTo(.23,.34,.25,.12,.17,0); shape.closePath();
  for (const x of [-.075,.075]) {
    const slot = new THREE.Path(); slot.absellipse(x,.455,.038,.023,0,Math.PI*2,true); shape.holes.push(slot);
  }
  const geo = new THREE.ExtrudeGeometry(shape,{depth:.023,bevelEnabled:true,bevelSize:.012,bevelThickness:.009,bevelSegments:3,curveSegments:10,steps:1});
  const p=geo.getAttribute('position');
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i), y=p.getY(i);
    p.setZ(i,p.getZ(i)+Math.pow(Math.abs(x)/.22,3)*.095-y*.14);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Finned air-cooled engine casing, with intersecting rounded castings. */
export function engineCasting(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[]=[];
  const core=new THREE.SphereGeometry(1,20,14); core.scale(.29,.19,.34); parts.push(core);
  for(const side of [-1,1]) {
    for(let cylinder=0;cylinder<2;cylinder++) {
      const z=(cylinder-.5)*.25;
      for(let fin=0;fin<8;fin++) {
        const g=new THREE.CylinderGeometry(.115,.115,.012,24); g.rotateZ(Math.PI/2); g.translate(side*(.19+fin*.016),.015,z); parts.push(g);
      }
      const head=new THREE.SphereGeometry(1,12,8); head.scale(.055,.11,.10); head.translate(side*.33,.02,z); parts.push(head);
    }
  }
  const geo=mergeGeometries(parts)!; parts.forEach(p=>p.dispose()); return geo;
}

export function steeringWheel(radius=.16): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[]=[new THREE.TorusGeometry(radius,.018,8,32)];
  for(let i=0;i<3;i++) {
    const a=i/3*Math.PI*2;
    const spoke=new THREE.BoxGeometry(.026,radius,.015); spoke.translate(0,radius/2,0);spoke.rotateZ(a);parts.push(spoke);
  }
  const hub=new THREE.CylinderGeometry(.04,.04,.035,24); hub.rotateX(Math.PI/2); parts.push(hub);
  const geo=mergeGeometries(parts)!; parts.forEach(p=>p.dispose()); return geo;
}

/** One continuous bent tube, with a real bend radius at the hoop shoulders. */
export function rollHoop(halfWidth: number, bottom: number, top: number, z: number, tubeRadius=.045): THREE.BufferGeometry {
  const r=.14, path=new THREE.CurvePath<THREE.Vector3>();
  const p=(x:number,y:number)=>new THREE.Vector3(x,y,z);
  path.add(new THREE.LineCurve3(p(-halfWidth,bottom),p(-halfWidth,top-r)));
  path.add(new THREE.QuadraticBezierCurve3(p(-halfWidth,top-r),p(-halfWidth,top),p(-halfWidth+r,top)));
  path.add(new THREE.LineCurve3(p(-halfWidth+r,top),p(halfWidth-r,top)));
  path.add(new THREE.QuadraticBezierCurve3(p(halfWidth-r,top),p(halfWidth,top),p(halfWidth,top-r)));
  path.add(new THREE.LineCurve3(p(halfWidth,top-r),p(halfWidth,bottom)));
  return new THREE.TubeGeometry(path,72,tubeRadius,12,false);
}
