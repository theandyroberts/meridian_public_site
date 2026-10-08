'use client';
import {useState} from 'react';
import {regionsFor} from '../../shared/composite/regions.mjs';
import styles from './EvidenceImage.module.css';
export type EvidenceRegion={evidenceId:string;x:number;y:number;width:number;height:number;confidence:number};
export type RegionEvidence={id:string;file:string;t:number;yaw?:number;fullSource?:boolean};
export type RegionLabel={regions?:EvidenceRegion[];regionScope?:'localized'|'whole_frame'|'unresolved'};
export function EvidenceImage({baseURL,evidence,label,alt,compact=false,showRegions=true}:{baseURL:string;evidence:RegionEvidence;label:RegionLabel;alt:string;compact?:boolean;showRegions?:boolean}){
  const [dimensions,setDimensions]=useState({id:'',ratio:1});
  const ratio=dimensions.id===evidence.id?dimensions.ratio:evidence.fullSource||evidence.id.startsWith('source-')?2:evidence.yaw!==undefined?1.6:32/9;
  const regions=showRegions?regionsFor(label,evidence.id):[];
  // The image and SVG both use contain/meet inside the same box, including letterboxing.
  return <div className={`${styles.canvas} ${compact?styles.compact:styles.expanded}`} style={compact?undefined:{aspectRatio:String(ratio)}}>
    <img src={`${baseURL}/${evidence.file}`} alt={alt} loading={compact?'lazy':'eager'} onLoad={e=>{const img=e.currentTarget;if(img.naturalWidth&&img.naturalHeight)setDimensions({id:evidence.id,ratio:img.naturalWidth/img.naturalHeight});}}/>
    {!!regions.length&&<svg className={styles.overlay} viewBox={`0 0 ${ratio*1000} 1000`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{regions.map((r:EvidenceRegion,i:number)=><g key={i}><rect x={r.x*ratio*1000} y={r.y*1000} width={r.width*ratio*1000} height={r.height*1000} fill="none" stroke="#050805" strokeOpacity=".85" strokeWidth={compact?4:6} vectorEffect="non-scaling-stroke"/><rect x={r.x*ratio*1000} y={r.y*1000} width={r.width*ratio*1000} height={r.height*1000} fill="none" stroke="var(--category-color, #e7b46b)" strokeWidth={compact?2:3} vectorEffect="non-scaling-stroke"/></g>)}</svg>}
    {compact&&!!regions.length&&<span className={styles.badge}>Area marked</span>}
  </div>;
}
