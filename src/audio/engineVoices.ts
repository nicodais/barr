import type { BodyId } from '../vehicle/vehicleConfig';

/** Per-body mix of actual engine recordings. Ratios preserve audible shifts. */
export interface EngineVoice {
  recording: 'car' | 'twin';
  pitch: number;
  gears: number;
  gearTop: number;
  cutoffHz: number;
  cutoffSpan: number;
  level: number;
}
export const ENGINE_VOICES: Record<BodyId,EngineVoice> = {
  wagon: {recording:'car',pitch:1,gears:5,gearTop:33,cutoffHz:1300,cutoffSpan:3200,level:.95},
  pickup: {recording:'car',pitch:.78,gears:4,gearTop:30,cutoffHz:1050,cutoffSpan:2900,level:1.05},
  moto: {recording:'twin',pitch:1.16,gears:6,gearTop:43,cutoffHz:2500,cutoffSpan:4300,level:.70},
  buggy: {recording:'twin',pitch:.92,gears:4,gearTop:39,cutoffHz:2100,cutoffSpan:3900,level:.80},
};
