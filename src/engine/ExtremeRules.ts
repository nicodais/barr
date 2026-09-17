/** Session-only rules. The menu is the sole production entry point. */
export class ExtremeRules {
  enabled=false;
  health=100;
  respawnAt: number|null=null;
  protectedUntil=0;
  private lastImpact=-Infinity;
  get destroyed() { return this.respawnAt!==null; }
  setEnabled(on:boolean, now:number) {
    if(this.destroyed || on===this.enabled) return false;
    this.enabled=on; this.health=100; this.protectedUntil=now+1200; this.lastImpact=-Infinity;
    return true;
  }
  damage(amount:number,now:number,impact=true) {
    if(!this.enabled||this.destroyed||now<this.protectedUntil||!Number.isFinite(amount)||amount<=0) return false;
    if(impact&&now-this.lastImpact<300) return false;
    if(impact)this.lastImpact=now;
    this.health=Math.max(0,this.health-amount);
    if(this.health===0) {this.respawnAt=now+5000;return true;}
    return false;
  }
  impact(deltaV:number,now:number) {return this.damage(Math.max(0,deltaV-2.5)*5,now);}
  tick(now:number) {
    if(this.respawnAt===null||now<this.respawnAt)return false;
    this.respawnAt=null;this.health=100;this.protectedUntil=now+2000;this.lastImpact=-Infinity;
    return true;
  }
  clear(now:number) {this.respawnAt=null;this.health=100;this.protectedUntil=now+2000;this.lastImpact=-Infinity;}
}
