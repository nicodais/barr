export class DamageHud {
  readonly element=document.createElement('div');
  readonly respawn=document.createElement('div');
  private meter=document.createElement('meter');
  private value=document.createElement('span');
  constructor() {
    this.element.className='damage-hud';this.element.hidden=true;
    const label=document.createElement('span');label.textContent='EXTREME · DAMAGE';
    this.meter.min=0;this.meter.max=100;this.meter.value=100;
    this.meter.setAttribute('aria-label','Vehicle integrity');
    this.element.append(label,this.value,this.meter);
    this.respawn.className='extreme-respawn';this.respawn.hidden=true;
    this.respawn.setAttribute('role','status');
  }
  update(enabled:boolean,health:number,respawnAt:number|null,now:number) {
    this.element.hidden=!enabled;
    this.meter.value=health;this.value.textContent=Math.ceil(health)+'%';
    this.element.classList.toggle('damage-critical',health<30);
    this.respawn.hidden=respawnAt===null;
    if(respawnAt!==null)this.respawn.textContent=`VEHICLE DESTROYED\nRespawning in ${Math.max(1,Math.ceil((respawnAt-now)/1000))}…`;
  }
}
