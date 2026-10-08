import {Quaternion,Euler} from 'three'
import {buildImuTrack,MLS_DEFAULTS} from './imu-motion.js'

export function createImuControls({video,carGroup,invalidateRender,getYaw}){
  const query=new URLSearchParams(location.search),url=query.get('motion')
  if(!url)return {apply(){},clear(){}}
  const panel=document.createElement('section');panel.className='imu-controls';panel.innerHTML=`<strong>Recorded vehicle motion</strong><p>Estimated orientation · mounting assumed</p><label><input type="checkbox" id="imu-enabled" checked> Apply IMU motion</label><label><input type="checkbox" id="imu-level" checked> Keep roll level</label><label>Smoothing <output>75 ms</output><input id="imu-smooth" type="range" min="0" max="300" step="5" value="75"></label><label>Yaw limit <output>5°</output><input id="imu-yaw" type="range" min="0" max="10" step="0.5" value="5"></label><label>Roll amount <output>100%</output><input id="imu-roll" type="range" min="0" max="100" step="5" value="100"></label><label>Timing offset <output>0 frames</output><input id="imu-offset" type="range" min="-24" max="24" step="1" value="0"></label><label>Pitch / roll limit <output>Off</output><input id="imu-peak" type="range" min="0" max="20" step="0.5" value="0"></label><button type="button" id="imu-reset">Reset MLS defaults</button><p id="imu-status">Loading motion track…</p>`
  document.querySelector('.control-panel').append(panel)
  let track=null,enabled=true,settings={...MLS_DEFAULTS};const base=new Quaternion(),pose={},euler=new Euler()
  const status=panel.querySelector('#imu-status')
  const bindings=[['smooth','smoothingMs',' ms',1],['yaw','yawLimitDeg','°',1],['roll','rollAmount','%',.01],['offset','offsetFrames',' frames',1],['peak','peakLimitDeg','°',1]]
  for(const[id,key,suffix,scale]of bindings)panel.querySelector(`#imu-${id}`).addEventListener('input',e=>{settings[key]=Number(e.target.value)*scale;e.target.parentElement.querySelector('output').textContent=key==='peakLimitDeg'&&!settings[key]?'Off':`${e.target.value}${suffix}`;invalidateRender({reflection:true})})
  panel.querySelector('#imu-enabled').onchange=e=>{enabled=e.target.checked;invalidateRender({reflection:true})}
  panel.querySelector('#imu-level').onchange=e=>{settings.keepRollLevel=e.target.checked;invalidateRender({reflection:true})}
  panel.querySelector('#imu-reset').onclick=()=>{settings={...MLS_DEFAULTS};panel.querySelector('#imu-level').checked=true;for(const[id,key,suffix,scale]of bindings){const input=panel.querySelector(`#imu-${id}`);input.value=settings[key]/scale;input.parentElement.querySelector('output').textContent=key==='peakLimitDeg'?'Off':`${input.value}${suffix}`}invalidateRender({reflection:true})}
  let ready=Promise.resolve();
  try{const resolved=new URL(url,location.href);if(resolved.origin!==location.origin)throw new Error('Motion data must be on this origin');ready=fetch(resolved).then(r=>{if(!r.ok)throw new Error('Motion data unavailable');return r.json()}).then(data=>{track=buildImuTrack(data);invalidateRender({reflection:true})}).catch(e=>{status.textContent=e.message})}catch(e){status.textContent=e.message}
  return{ready,apply(){base.setFromEuler(euler.set(0,getYaw()*Math.PI/180,0));carGroup.quaternion.copy(base);if(!track)return;if(enabled){track.sample(video.currentTime,settings,pose);carGroup.quaternion.multiply(pose.quaternion);status.textContent=`Pitch ${pose.pitchDeg.toFixed(1)}° · Roll ${pose.rollDeg.toFixed(1)}° · Yaw ${pose.yawDeg.toFixed(1)}°`}else status.textContent='Recorded motion off'},clear(){track=null;panel.hidden=true;carGroup.quaternion.setFromEuler(euler.set(0,getYaw()*Math.PI/180,0))}}
}
