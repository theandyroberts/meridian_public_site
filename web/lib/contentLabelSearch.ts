type SearchableLabel = {label:string;detail:string};

// These are search aliases, not new observations. Keep road crossings distinct
// from bridge/river crossings and pedestrian crossings.
const aliases = [
  ['intersection', 'intersections', 'junction', 'junctions', 'crossroad', 'crossroads'],
  ['crosswalk', 'crosswalks', 'pedestrian crossing', 'pedestrian crossings'],
  ['traffic signal', 'traffic signals', 'traffic light', 'traffic lights', 'signal head', 'signal heads'],
];
function words(value:string){
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
const replacements=aliases.map(group=>({
  term:group[0],
  pattern:new RegExp(`\\b(?:${[...group].sort((a,b)=>b.length-a.length).join('|')})\\b`,'g'),
}));
function normalized(value:string){
  return replacements.reduce((text,{term,pattern})=>text.replace(pattern,term),words(value));
}
export function matchesContentLabel(label:SearchableLabel,query:string){
  const terms=normalized(query).split(' ').filter(Boolean);
  if(!terms.length)return true;
  const text=normalized(`${label.label} ${label.detail}`);
  return terms.every(term=>text.includes(term));
}
