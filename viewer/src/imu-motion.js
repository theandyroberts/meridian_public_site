import {Euler,MathUtils,Quaternion,Vector3} from 'three'

// Adapted from the algorithm inspected in Spheris LAB's Clip 11 experiment
// on 2026-09-23. Generalized frame rate/source validation; no claim of binary parity.
export const MLS_DEFAULTS=Object.freeze({smoothingMs:75,yawLimitDeg:5,offsetFrames:0,keepRollLevel:true,rollAmount:1,peakLimitDeg:0})
const UP=new Vector3(0,1,0),RAD=Math.PI/180
export const phoneToVehicle=v=>new Vector3(-v[2],v[1],v[0])
export function limitPeak(angle,limit){if(!(limit>0)||Math.abs(angle)<=limit*.8)return angle;const knee=limit*.8;return Math.sign(angle)*(knee+(limit-knee)*Math.tanh((Math.abs(angle)-knee)/(limit-knee)))}
export function buildImuTrack(data,{gravityTimeConstant=8,yawReturnSeconds=3}={}){
  if(!Number.isFinite(data.fps)||data.fps<=0||!Number.isInteger(data.frameCount)||data.frameCount<2||data.mounting!=='upright-screen-rear'||!Array.isArray(data.samples)||data.samples.length<2)throw new Error('Unsupported IMU track or mounting profile')
  const frames=new Map()
  for(const s of data.samples){
    if(!Number.isInteger(s.frame)||s.frame<0||s.frame>=data.frameCount||![s.accel,s.gyro].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw new Error('Invalid IMU sample')
    const row=frames.get(s.frame)||{frame:s.frame,accel:[0,0,0],gyro:[0,0,0],count:0}
    for(let a=0;a<3;a++){row.accel[a]+=s.accel[a];row.gyro[a]+=s.gyro[a]}row.count++;frames.set(s.frame,row)
  }
  const samples=[...frames.values()].sort((a,b)=>a.frame-b.frame)
  if(samples.length<2)throw new Error('Too few distinct IMU frames')
  samples.forEach(s=>{s.accel=s.accel.map(v=>v/s.count);s.gyro=s.gyro.map(v=>v/s.count)})
  const integrated=new Quaternion(),references=[]
  function integrate(q,s,prev,dt){const rate=phoneToVehicle(s.gyro).add(phoneToVehicle(prev.gyro)).multiplyScalar(.5),speed=rate.length();if(speed)q.multiply(new Quaternion().setFromAxisAngle(rate.divideScalar(speed),speed*dt)).normalize()}
  for(let i=0;i<samples.length;i++){
    const s=samples[i]
    if(i){const dt=(s.frame-samples[i-1].frame)/data.fps;if(dt>.5)throw new Error('IMU gap exceeds half a second');integrate(integrated,s,samples[i-1],dt)}
    const acceleration=phoneToVehicle(s.accel)
    if(Math.hypot(...s.gyro)<.035&&Math.abs(acceleration.length()-9.80665)<.5)references.push(acceleration.normalize().applyQuaternion(integrated).toArray())
  }
  const gravity=new Vector3()
  if(references.length>=12)gravity.fromArray([0,1,2].map(a=>references.map(v=>v[a]).sort((a,b)=>a-b)[references.length>>1]))
  else samples.filter(s=>s.frame<=samples[0].frame+data.fps/2).forEach(s=>gravity.add(phoneToVehicle(s.accel)))
  if(gravity.length()<.5)throw new Error('No usable gravity reference')
  const attitude=new Quaternion().setFromUnitVectors(gravity.normalize(),UP),neutralInverse=attitude.clone().invert(),identity=new Quaternion(),euler=new Euler(0,0,0,'YXZ')
  let previousYaw=0,heading=0,baseline=0
  const track=samples.map((s,i)=>{
    const dt=i?(s.frame-samples[i-1].frame)/data.fps:0
    if(dt){
      integrate(attitude,s,samples[i-1],dt)
      const acceleration=phoneToVehicle(s.accel),confidence=Math.max(0,1-Math.abs(acceleration.length()-9.80665)/2)
      if(confidence&&gravityTimeConstant<Infinity){const correction=new Quaternion().setFromUnitVectors(acceleration.normalize().applyQuaternion(attitude),UP);correction.slerp(identity,Math.exp(-dt*confidence/gravityTimeConstant));attitude.premultiply(correction).normalize()}
    }
    const relative=attitude.clone().multiply(neutralInverse);euler.setFromQuaternion(relative,'YXZ')
    heading+=Math.atan2(Math.sin(euler.y-previousYaw),Math.cos(euler.y-previousYaw));previousYaw=euler.y
    baseline+=(heading-baseline)*(1-Math.exp(-dt/yawReturnSeconds))
    return{time:s.frame/data.fps,quaternion:relative,yaw:heading-baseline}
  })
  const rolls=track.map(s=>euler.setFromQuaternion(s.quaternion,'YXZ').x/RAD)
  function weightAt(j,t,sigma){const span=((track[j+1]?.time??track[j].time+1/data.fps)-(track[j-1]?.time??track[j].time-1/data.fps))/2;return Math.exp(-.5*((track[j].time-t)/sigma)**2)*span}
  track.forEach(s=>{let sum=0,total=0;track.forEach((o,j)=>{if(Math.abs(o.time-s.time)<=4.5){const w=weightAt(j,s.time,1.5);sum+=rolls[j]*w;total+=w}});s.rollBaseline=sum/total})
  let cached=-1,filtered=track
  function smooth(ms){const amount=MathUtils.clamp(Number.isFinite(ms)?ms:0,0,300);if(amount===cached)return;cached=amount;if(!amount){filtered=track;return}
    const sigma=amount/1000
    filtered=track.map(s=>{let sum=[0,0,0,0],total=0,yaw=0,rollBaseline=0;track.forEach((o,j)=>{if(Math.abs(o.time-s.time)>sigma*3)return;const w=weightAt(j,s.time,sigma),sign=o.quaternion.dot(s.quaternion)<0?-1:1;o.quaternion.toArray().forEach((v,k)=>sum[k]+=v*w*sign);total+=w;yaw+=o.yaw*w;rollBaseline+=o.rollBaseline*w});return{time:s.time,quaternion:new Quaternion(...sum).normalize(),yaw:yaw/total,rollBaseline:rollBaseline/total}})
  }
  function sampleAt(seconds){
    const t=MathUtils.clamp(seconds,track[0].time,track.at(-1).time)
    let lo=0,hi=filtered.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(filtered[mid].time<=t)lo=mid;else hi=mid}
    const a=filtered[lo],b=filtered[hi],mix=MathUtils.clamp((t-a.time)/(b.time-a.time),0,1)
    return {a,b,mix}
  }
  return{sampleCount:samples.length,duration:data.frameCount/data.fps,startTime:track[0].time,endTime:track.at(-1).time,
  // Map instrument: full estimated relative attitude, without the Lab's
  // creative yaw clamp/return, roll leveling, strength or frame offset.
  sampleAttitude(seconds,out={}){
    if(!Number.isFinite(seconds)||seconds<track[0].time||seconds>track.at(-1).time)return null
    smooth(75)
    const {a,b,mix}=sampleAt(seconds)
    out.quaternion??=new Quaternion();out.quaternion.copy(a.quaternion).slerp(b.quaternion,mix)
    euler.setFromQuaternion(out.quaternion,'YXZ')
    out.rollDeg=euler.x/RAD;out.pitchDeg=euler.z/RAD;out.yawDeg=euler.y/RAD
    return out
  },sample(seconds,settings=MLS_DEFAULTS,out={}){
    const opts={...MLS_DEFAULTS,...settings};smooth(opts.smoothingMs)
    const {a,b,mix}=sampleAt((Number.isFinite(seconds)?seconds:0)+(Number.isFinite(opts.offsetFrames)?opts.offsetFrames:0)/data.fps)
    euler.setFromQuaternion(a.quaternion.clone().slerp(b.quaternion,mix),'YXZ')
    const limit=MathUtils.clamp(opts.yawLimitDeg,0,10)*RAD,yaw=limit?MathUtils.clamp(MathUtils.lerp(a.yaw,b.yaw,mix),-limit,limit):0
    const ref=opts.keepRollLevel?MathUtils.lerp(a.rollBaseline,b.rollBaseline,mix):0
    out.rollDeg=limitPeak(euler.x/RAD-ref,opts.peakLimitDeg)*MathUtils.clamp(opts.rollAmount,0,1)
    out.pitchDeg=limitPeak(euler.z/RAD,opts.peakLimitDeg);out.yawDeg=yaw/RAD
    out.quaternion??=new Quaternion();out.quaternion.setFromEuler(euler.set(out.rollDeg*RAD,yaw,out.pitchDeg*RAD,'YXZ'));return out
  }}
}
