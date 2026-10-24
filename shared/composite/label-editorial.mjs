import {deriveCompositeTags} from './tags.mjs';

// Source-bound editorial labels remain separate from AI localization receipts.
// This lets reviewed wording evolve while the highlight worker finishes its pass.
export function applyLabelEditorial(record, editorial) {
  if(!editorial)return record;
  if(editorial.schema!=='tpl.label-editorial.v1'||editorial.sourceFingerprint!==record.sourceFingerprint)throw new Error('Editorial labels do not match this source');
  const categories=new Set(['scene','mood','geography','entities','production','location_comp','brands','motion']);
  const evidence=new Map([...(record.frames??[]),...(record.views??[]),...(record.evidence??[])].map(e=>[e.id,e]));
  const patches=new Map(editorial.patches.map(p=>[p.id,p]));
  if(patches.size!==editorial.patches.length)throw new Error('Duplicate editorial label patch');
  const allowed=new Set(['label','detail','category','start','end','evidenceIds']);
  function checked(label) {
    if(!categories.has(label.category)||!label.label?.trim()||!label.detail?.trim()||!Number.isFinite(label.start)||!Number.isFinite(label.end)||label.start<0||label.end<label.start||label.end>record.media.duration||!label.evidenceIds?.length||label.evidenceIds.some(id=>!evidence.has(id))||!label.evidenceIds.some(id=>evidence.get(id).t>=label.start&&evidence.get(id).t<=label.end))throw new Error(`Invalid editorial evidence: ${label.id}`);
    if(label.category==='mood')return {...label,evidence:'inference',editorialStatus:'creative-suggestion',clearanceAlert:false,regions:[],regionScope:'whole_frame',regionNote:'Subjective emotional reading of this section; no single object to outline.'};
    return label;
  }
  const labels=record.labels.map(label=>{
    const p=patches.get(label.id);if(!p)return label;
    if(label.label!==p.expected.label||label.category!==p.expected.category)throw new Error(`Editorial source label changed: ${label.id}`);
    if(Object.keys(p.changes).some(k=>!allowed.has(k)))throw new Error('Unsupported editorial field');
    patches.delete(label.id);
    return checked({...label,...p.changes});
  });
  if(patches.size)throw new Error('Missing editorial source labels');
  const ids=new Set(labels.map(l=>l.id));
  for(const addition of editorial.moods??[]) {
    if(ids.has(addition.id)||addition.category!=='mood'||!record.labels.some(l=>l.id===addition.sourceLabelId))throw new Error('Invalid additional mood');
    ids.add(addition.id);labels.push(checked({...addition,confidence:0.85}));
  }
  const derived=deriveCompositeTags(labels);
  return {...record,labels,tags:[...new Set([...(record.tags??[]),...derived.tags])],tagEvidence:derived.tagEvidence,labelTaxonomy:'scene-mood-v2',editorialLabels:editorial.schema};
}
