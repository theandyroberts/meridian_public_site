'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import styles from './CompositeDetail.module.css';

export type CompositePlayerHandle={seek:(time:number)=>void};
type Props={id:string;title:string;videoURL:string;stageBase:string;posterURL:string;start:number;duration:number;fps:number;sourceTimecode:string;coverageBottom:number;onTimeChange:(time:number)=>void};
const AUTO_SWITCH_SECONDS=10;
const clock=(time:number)=>`${Math.floor(time/60).toString().padStart(2,'0')}:${Math.floor(time%60).toString().padStart(2,'0')}`;

// SVG shapes avoid platform emoji substitution for playback symbols.
function PlayIcon(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>;}
function PauseIcon(){return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>;}

export const CompositePlayer=forwardRef<CompositePlayerHandle,Props>(function CompositePlayer(props,ref){
  const video=useRef<HTMLVideoElement>(null),iframe=useRef<HTMLIFrameElement>(null),shell=useRef<HTMLDivElement>(null);
  const [mode,setMode]=useState<'panorama'|'stage'>('panorama'),[playing,setPlaying]=useState(false),[ready,setReady]=useState(false),[stageReady,setStageReady]=useState(false),[auto,setAuto]=useState(true),[error,setError]=useState(''),[stageError,setStageError]=useState(''),[current,setCurrent]=useState(props.start),[expanded,setExpanded]=useState(false);
  const expandButton=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const pendingStage=useRef(false),targetTime=useRef(props.start),playPromise=useRef<Promise<void>|null>(null),playIntent=useRef(false),hoverPaused=useRef(false);
  const videoId=`composite-video-${props.id}`;
  // Stable for this clip: changing views or the playhead never reloads the iframe.
  const [stageURL]=useState(()=>`${props.stageBase}/index.html?${new URLSearchParams({video:props.videoURL,label:props.title,fps:String(props.fps),sourceTimecode:props.sourceTimecode,coverageBottom:String(props.coverageBottom),embed:'1',preview:'1',sharedVideo:videoId})}`);
  const seek=(time:number)=>{targetTime.current=time;setCurrent(time);props.onTimeChange(time);if(video.current&&video.current.readyState>=1)video.current.currentTime=time;};
  useImperativeHandle(ref,()=>({seek}));
  function pause(){playIntent.current=false;hoverPaused.current=true;video.current?.pause();}
  async function startPlayback(){
    const media=video.current;if(!media)return;
    playIntent.current=true;hoverPaused.current=false;setError('');
    // Set the actual properties as well as markup for Safari/autoplay policies.
    media.muted=true;media.defaultMuted=true;media.playsInline=true;
    if(media.error){media.load();}
    if(playPromise.current)return playPromise.current;
    const attempt=async()=>{
      try{await media.play();}
      catch(reason){
        // A seek/load can interrupt play without a media failure. Retry once,
        // but never undo a deliberate pause while a play request was pending.
        if(reason instanceof DOMException&&reason.name==='AbortError'){
          if(!playIntent.current)return;
          try{await media.play();return;}catch{}
        }
        if(playIntent.current){setError('Playback could not start. Click Play to retry.');setPlaying(false);}
      }
    };
    playPromise.current=attempt().finally(()=>{playPromise.current=null;});
    return playPromise.current;
  }
  function chooseMode(next:'panorama'|'stage'){
    setAuto(false);pendingStage.current=next==='stage'&&!stageReady;
    if(next==='panorama'||stageReady)setMode(next);
  }
  function openFullLab(){
    chooseMode('stage');setExpanded(true);
    // Keep the same iframe/video; use a full-window overlay if fullscreen is unavailable.
    shell.current?.requestFullscreen?.().catch(()=>{});
  }
  function closeFullLab(){
    setExpanded(false);
    if(document.fullscreenElement===shell.current)void document.exitFullscreen().catch(()=>{});
    expandButton.current?.focus();
  }
  useEffect(()=>{
    if(!expanded)return;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    closeButton.current?.focus();
    let enteredFullscreen=false;
    const fullscreen=()=>{
      if(document.fullscreenElement===shell.current)enteredFullscreen=true;
      else if(enteredFullscreen){setExpanded(false);expandButton.current?.focus();}
    };
    fullscreen();
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')closeFullLab();};
    document.addEventListener('fullscreenchange',fullscreen);window.addEventListener('keydown',escape);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('fullscreenchange',fullscreen);window.removeEventListener('keydown',escape);};
  },[expanded]);
  useEffect(()=>{
    const media=video.current;if(!media)return;
    const initialize=()=>{media.currentTime=targetTime.current;};
    if(media.readyState>=1)initialize();
    media.addEventListener('loadedmetadata',initialize);
    return()=>media.removeEventListener('loadedmetadata',initialize);
  },[]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==iframe.current?.contentWindow)return;
      if(event.data?.type==='tpl-stage-ready'){
        setStageReady(true);setStageError('');
        if(pendingStage.current){pendingStage.current=false;setMode('stage');}
      }
      if(event.data?.type==='tpl-stage-error'){setStageError('Lab 360 could not load. Panoramic playback is still available.');setStageReady(false);setMode('panorama');}
      if(event.data?.type==='tpl-stage-interaction')setAuto(false);
    };
    window.addEventListener('message',receive);
    return()=>window.removeEventListener('message',receive);
  },[]);
  useEffect(()=>{iframe.current?.contentWindow?.postMessage({type:'tpl-stage-active',active:mode==='stage'},location.origin);},[mode,stageReady]);
  useEffect(()=>{
    if(!auto||!playing||!stageReady)return;
    const timer=window.setInterval(()=>setMode(previous=>previous==='panorama'?'stage':'panorama'),AUTO_SWITCH_SECONDS*1000);
    return()=>window.clearInterval(timer);
  },[auto,playing,stageReady]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden)pause();};
    document.addEventListener('visibilitychange',hidden);
    const observer=new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)pause();else hoverPaused.current=false;});
    if(shell.current)observer.observe(shell.current);
    return()=>{document.removeEventListener('visibilitychange',hidden);observer.disconnect();};
  },[]);
  return <div id="plate-viewer" className={styles.compositeViewer}>
    <div className={styles.viewerBar}>
      <div className={styles.modeSwitch} role="group" aria-label="Preview view">
        <button aria-pressed={mode==='panorama'} className={mode==='panorama'?styles.active:''} onClick={()=>chooseMode('panorama')}><span aria-hidden="true">▭</span> Panoramic view <small>32:9</small></button>
        <button aria-pressed={mode==='stage'} className={mode==='stage'?styles.active:''} onClick={()=>chooseMode('stage')}><span aria-hidden="true">◉</span> Lab 360</button>
      </div>
      <div className={styles.viewerActions}><button className={`${styles.autoSwitch} ${auto?styles.autoSwitchOn:''}`} aria-pressed={auto} onClick={()=>setAuto(value=>!value)}>Auto-switch <span>{AUTO_SWITCH_SECONDS}s</span></button><button ref={expandButton} className={styles.fullLabButton} onClick={openFullLab}><span aria-hidden="true">⛶</span> Full Lab</button></div>
    </div>
    <div className={`${styles.player} ${expanded?styles.expandedPlayer:''}`} ref={shell} data-preview-mode={mode}>
      {expanded&&<div className={styles.expandedBar}><strong>Lab 360</strong><button ref={closeButton} onClick={closeFullLab}>Exit Full Lab <span aria-hidden="true">×</span></button></div>}
      <div className={styles.previewFrame} onPointerEnter={event=>{if(event.pointerType==='mouse'&&!hoverPaused.current)void startPlayback();}} onPointerLeave={()=>{hoverPaused.current=false;}}>
        <div className={`${styles.panoramaLayer} ${mode==='panorama'?styles.layerActive:''}`} aria-hidden={mode!=='panorama'} inert={mode!=='panorama'}>
          <div className={styles.crop}>
            <video id={videoId} ref={video} src={props.videoURL} muted playsInline loop preload="auto" style={{opacity:ready?1:0}} onLoadedData={()=>setReady(true)} onSeeked={()=>setReady(true)} onTimeUpdate={event=>{const time=event.currentTarget.currentTime;setCurrent(time);props.onTimeChange(time);}} onPlaying={()=>{setPlaying(true);setReady(true);setError('');}} onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);playIntent.current=false;}} onError={()=>setError('The composite could not be loaded. Click Play to retry.')} onClick={()=>void startPlayback()}/>
            {!ready&&<img className={styles.playerPoster} src={props.posterURL} alt="Selected panoramic poster"/>}
            {!playing&&<button className={styles.bigPlay} onClick={()=>void startPlayback()} aria-label="Play composite"><PlayIcon/></button>}
          </div>
        </div>
        <iframe ref={iframe} className={`${styles.stageLayer} ${mode==='stage'?styles.layerActive:''}`} aria-hidden={mode!=='stage'} inert={mode!=='stage'} tabIndex={mode==='stage'?0:-1} title="Lab 360 — stabilized composite" src={stageURL} allow="autoplay; fullscreen" loading="eager"/>
      </div>
      <div className={styles.transport}><button onClick={()=>video.current?.paused?void startPlayback():pause()} aria-label={playing?'Pause composite':'Play composite'}>{playing?<PauseIcon/>:<PlayIcon/>}</button><span>{clock(current)}</span><input aria-label="Clip timeline" type="range" min="0" max={props.duration-1/props.fps} step={1/props.fps} value={current} onChange={event=>seek(Number(event.target.value))}/><span className={styles.dim}>{clock(props.duration)}</span><button onClick={()=>expanded?closeFullLab():shell.current?.requestFullscreen?.().catch(()=>{})} aria-label={expanded?'Exit Full Lab':'Full screen'}>⛶</button></div>
      {error&&<p role="alert" className={styles.playbackError}>{error}</p>}
    </div>
    <p className={styles.previewHint} role="status">{stageError||(!stageReady?'Preparing Lab 360 in the background…':auto?`Hover to play · views alternate every ${AUTO_SWITCH_SECONDS} seconds`:'Hover to play · manual view selected')}</p>
  </div>;
});
