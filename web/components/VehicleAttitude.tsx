'use client';
import {useEffect,useRef,useState} from 'react';
import {buildImuTrack} from '../../viewer/src/imu-motion.js';
import styles from './VehicleAttitude.module.css';

type Vec=[number,number,number];
type Pose={rollDeg:number;pitchDeg:number;yawDeg:number;quaternion:{toArray:()=>number[]}};
type Track={sampleAttitude:(seconds:number)=>Pose|null};
const dot=(a:Vec,b:Vec)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const right:Vec=[.768,0,.64],up:Vec=[.286,.894,-.344],depth:Vec=[-.572,.447,.687];
function rotate(p:Vec,q:number[]):Vec{
  const [x,y,z,w]=q,[a,b,c]=p;
  const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
  return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
function project(p:Vec){return [110+dot(p,right)*39,99-dot(p,up)*39,dot(p,depth)];}
const degrees=(n:number)=>`${Math.abs(n)<.05?'0.0':n.toFixed(1)}°`;

export function VehicleAttitude({motionURL,time,videoId,stageBase:stageOverride}:{motionURL:string;time:number;videoId:string;stageBase?:string}){
  const [track,setTrack]=useState<Track|null>(null),[status,setStatus]=useState('Loading IMU…'),[now,setNow]=useState(time);
  const host=useRef<HTMLElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const miniature=useRef<{setPose:(q:number[])=>void;dispose:()=>void}|null>(null),poseRef=useRef<number[]>([0,0,0,1]);
  const [modelReady,setModelReady]=useState(false);
  useEffect(()=>{
    let cancelled=false;setModelReady(false);
    const stageBase=stageOverride??(motionURL.split('/media/')[0]+'/stage');
    import('../../viewer/src/attitude-ferrari.js').then(({createAttitudeFerrari})=>{
      if(cancelled||!canvas.current)return;
      const model=createAttitudeFerrari(canvas.current,stageBase);miniature.current=model;
      return model.ready.then(()=>{if(!cancelled){model.setPose(poseRef.current);setModelReady(true);}});
    }).catch(()=>{if(!cancelled){miniature.current?.dispose();miniature.current=null;setModelReady(false);}});
    return()=>{cancelled=true;miniature.current?.dispose();miniature.current=null;};
  },[motionURL]);
  useEffect(()=>{setNow(time);},[time]);
  useEffect(()=>{
    const controller=new AbortController();setTrack(null);setStatus('Loading IMU…');
    fetch(motionURL,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Motion unavailable');return r.json();}).then(data=>{if(controller.signal.aborted)return;setTrack(buildImuTrack(data) as unknown as Track);setStatus('');}).catch(()=>{if(!controller.signal.aborted)setStatus('IMU unavailable');});
    return()=>controller.abort();
  },[motionURL]);
  // Sample the very same video used by the panorama, Lab and route. No
  // independent clock: paused frames, scrubbing, looping and seeks agree.
  useEffect(()=>{
    const video=document.getElementById(videoId) as HTMLVideoElement|null;if(!video)return;
    let frame=0,last=0,visible=true;
    const update=(stamp:number)=>{if(visible&&!document.hidden&&stamp-last>=32){setNow(video.currentTime);last=stamp;}if(!video.paused&&!video.ended)frame=requestAnimationFrame(update);};
    const start=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
    const sync=()=>setNow(video.currentTime);
    const stop=()=>{cancelAnimationFrame(frame);sync();};
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)sync();});if(host.current)observer.observe(host.current);
    video.addEventListener('play',start);video.addEventListener('pause',stop);video.addEventListener('seeked',sync);if(!video.paused)start();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();video.removeEventListener('play',start);video.removeEventListener('pause',stop);video.removeEventListener('seeked',sync);};
  },[videoId]);
  const pose=track?.sampleAttitude(now),q=pose?.quaternion.toArray()??[0,0,0,1];
  poseRef.current=q;
  useEffect(()=>{miniature.current?.setPose(q);},[q[0],q[1],q[2],q[3]]);
  const axis=(end:Vec)=>{const p=project(rotate(end,q));return {x:p[0],y:p[1]};};
  const pitch=axis([0,0,2]),roll=axis([2,0,0]),yaw=axis([0,2,0]);
  return <aside ref={host} className={styles.indicator} aria-label="Vehicle IMU attitude" data-time={now.toFixed(3)} data-state={pose?'ready':status?'loading-or-unavailable':'no-sample'} title="Estimated vehicle attitude relative to the initial pose. Phone mounting is assumed; physical camera/sensor sync is unverified. Lab 360 stays level.">
    <div className={styles.heading}><span className={pose?styles.signal:styles.noSignal}/><strong>IMU</strong><span>EST.</span></div>
    <div className={styles.visual}><svg className={styles.instrument} viewBox="0 0 220 190" role="img" aria-label={pose?`Estimated roll ${degrees(pose.rollDeg)}, pitch ${degrees(pose.pitchDeg)}, yaw ${degrees(pose.yawDeg)}`:status||'No IMU sample at this moment'}>
      <circle cx="110" cy="96" r="82" fill="none" stroke="#ad9e7d" strokeWidth="1.4"/>
      <ellipse cx="110" cy="96" rx="82" ry="25" fill="none" stroke="#779486" strokeOpacity=".35"/>
      <ellipse cx="110" cy="96" rx="31" ry="82" fill="none" stroke="#779486" strokeOpacity=".3" transform="rotate(-26 110 96)"/>
      <path d="M110 10v10m0 152v10M24 96h10m152 0h10" stroke="#ddbd85"/>
      
      <g opacity={pose?1:.28}>
        {[{p:roll,c:'#dfb268',label:'R'},{p:pitch,c:'#83becd',label:'P'},{p:yaw,c:'#b9d59a',label:'Y'}].map(({p,c,label})=><g key={label}><path d={`M110 99L${p.x} ${p.y}`} stroke={c} strokeWidth="1.5"/><circle cx={p.x} cy={p.y} r="3" fill={c}/><text x={p.x+6} y={p.y-5} fill={c} fontSize="10">{label}</text></g>)}
      </g>
    </svg><canvas ref={canvas} className={styles.car} aria-hidden="true" style={{opacity:modelReady?(pose?1:.25):0}}/></div>
    <div className={styles.readings}>{(['roll','pitch','yaw'] as const).map(name=><div key={name} className={styles[name]}><span>{name[0].toUpperCase()}</span><strong>{pose?degrees(pose[`${name}Deg`]):'—'}</strong></div>)}</div>
    {!pose&&<p>{status||'No sample'}</p>}
  </aside>;
}
