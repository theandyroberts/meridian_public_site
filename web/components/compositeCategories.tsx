import type {CSSProperties} from 'react';

export const compositeCategories = [
  {id:'scene', name:'Scene', color:'#e7b46b', description:'The setting you can stage a scene in'},
  {id:'mood', name:'Mood', color:'#a6b0ff', description:'The feeling this moment evokes'},
  {id:'geography', name:'Streets & location', color:'#80c3ef', description:'Roads, landmarks & route'},
  {id:'entities', name:'People & objects', color:'#9fd3a3', description:'Life, vehicles & surroundings'},
  {id:'production', name:'Production value', color:'#bca5ee', description:'Framing, continuity & VFX'},
  {id:'location_comp', name:'Location doubles', color:'#e3a5d0', description:'Creative possibilities elsewhere'},
  {id:'brands', name:'Brands & clearance', color:'#f09289', description:'Signs, logos & review flags'},
  {id:'motion', name:'Motion', color:'#75d4c5', description:'Movement, rhythm & terrain'},
];
const all = {id:'all',name:'All categories',color:'#eae8df',description:'Explore the complete picture'};
export function categoryFor(id:string){return compositeCategories.find(c=>c.id===id)??all;}
export function categoryStyle(id:string):CSSProperties{
  const {color}=categoryFor(id);
  return {'--category-color':color,'--category-soft':`${color}12`,'--category-border':`${color}65`} as CSSProperties;
}
export function CategoryIcon({category}:{category:string}){
  const paths:Record<string,React.ReactNode>={
    all:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    scene:<><path d="M3 21V8h7v13m0-17h9v17M1 21h22M6 11v1m0 3v1m7-9h3m-3 4h3m-3 4h3"/></>,
    mood:<><path d="M19 15a8 8 0 0 1-10-10 8 8 0 1 0 10 10ZM17 3v4m-2-2h4m1 4v3m-1.5-1.5h3"/></>,
    geography:<><path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2.5"/></>,
    entities:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/></>,
    production:<><path d="m3 8 17-5 1 5-17 5Zm2 4v9h16V10M7 7l3 3m3-5 3 3"/><path d="m11 15 4 2-4 2Z"/></>,
    location_comp:<><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 18v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1M6 11l3-3 3 3M9 8v5"/></>,
    brands:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="M12 8v5m0 3v.1"/></>,
    motion:<><path d="M2 12h4l3-8 6 16 3-8h4"/></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[category]??paths.all}</svg>;
}
