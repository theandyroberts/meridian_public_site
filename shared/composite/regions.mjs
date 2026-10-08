export const REGION_VERSION='evidence-regions-v1';
export const MIN_REGION_CONFIDENCE=.8;
export function validRegion(region){
  return !!region && typeof region.evidenceId==='string' && [region.x,region.y,region.width,region.height,region.confidence].every(Number.isFinite) && region.x>=0 && region.y>=0 && region.width>0 && region.height>0 && region.x+region.width<=1.000001 && region.y+region.height<=1.000001 && region.confidence>=MIN_REGION_CONFIDENCE && region.confidence<=1;
}
export function regionsFor(label,evidenceId){return (label.regions??[]).filter(r=>r.evidenceId===evidenceId && validRegion(r));}
export function preferredEvidence(label,index){
  const region=(label.regions??[]).filter(validRegion).filter(r=>label.evidenceIds.includes(r.evidenceId)&&index.has(r.evidenceId)).sort((a,b)=>b.confidence-a.confidence)[0];
  if(region)return index.get(region.evidenceId);
  const frames=label.evidenceIds.map(id=>index.get(id)).filter(Boolean);
  return frames.find(e=>e.id.startsWith('detail-'))??frames.find(e=>e.yaw!==undefined)??frames[0];
}
export function validateRegionReport(report,items){
  if(!Array.isArray(report?.labels)||report.labels.length!==items.length)throw new Error('Incomplete evidence region report');
  const expected=new Map(items.map(i=>[i.label.id,i]));const seen=new Set();
  for(const result of report.labels){
    const item=expected.get(result.id);
    if(!item||seen.has(result.id)||!['localized','whole_frame','unresolved'].includes(result.scope)||!Array.isArray(result.regions)||typeof result.note!=='string')throw new Error('Invalid evidence region label');
    seen.add(result.id);
    if(result.regions.length>3||((result.scope==='localized')!==!!result.regions.length))throw new Error('Region scope does not match rectangles');
    for(const r of result.regions)if(!validRegion(r)||r.evidenceId!==item.frame.id||!item.label.evidenceIds.includes(r.evidenceId))throw new Error('Rectangle is outside its evidence image or unsupported');
  }
  return report;
}
export function applyRegionOverrides(record,overrides){
  if(!overrides)return record;
  if(!record.sourceFingerprint||overrides.sourceFingerprint!==record.sourceFingerprint||!Array.isArray(overrides.labels))throw new Error('Region overrides belong to a different source');
  const labels=new Map(record.labels.map(l=>[l.id,l]));
  const evidence=new Set([...record.frames??[],...record.views??[],...record.evidence??[]].map(e=>e.id));
  const patches=new Map();
  for(const patch of overrides.labels){
    const label=labels.get(patch.id);
    if(!label||patches.has(patch.id)||!Array.isArray(patch.regions)||!patch.regions.length||patch.regions.length>3||patch.regionScope!=='localized'||typeof patch.regionNote!=='string')throw new Error('Invalid region override');
    for(const r of patch.regions)if(!validRegion(r)||!label.evidenceIds.includes(r.evidenceId)||!evidence.has(r.evidenceId))throw new Error('Unsupported region override evidence');
    patches.set(patch.id,{regions:patch.regions,regionScope:patch.regionScope,regionNote:patch.regionNote,regionMethod:'assistant-visual-review'});
  }
  return {...record,labels:record.labels.map(l=>({...l,...patches.get(l.id)}))};
}
