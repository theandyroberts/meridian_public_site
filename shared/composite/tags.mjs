// Search vocabulary for observed scene content. Location doubles and suggested
// production uses stay in detailed labeling; they do not become factual tags.
const vocabulary = [
  ['bridge', 'bridges?|viaducts?'], ['viaduct', 'viaducts?'],
  ['intersection', 'intersections?|junctions?|crossroads?'], ['billboard', 'billboards?'],
  ['arch', 'arch|arches'], ['crosswalk', 'crosswalks?|pedestrian crossings?'],
  ['traffic lights', 'traffic (?:lights?|signals?)|junction signals?|signal heads?'],
  ['warehouse', 'warehouses?'], ['industrial', 'industrial'], ['skyline', 'skyline'],
  ['river', 'rivers?'], ['construction', 'construction'], ['crane', 'cranes?'],
  ['high-rise', 'high rise'], ['trees', 'trees?|broadleaf'], ['palm trees', 'palms?|palm trees?'],
  ['pedestrians', 'pedestrians?'], ['traffic', 'traffic'], ['bus', 'bus|buses'],
  ['pickup truck', 'pickups?|pickup trucks?'], ['truck', 'trucks?|pickups?'],
  ['SUV', 'suvs?'], ['sedan', 'sedans?'], ['guardrail', 'guardrails?'],
  ['fence', 'fences?|fencing'], ['streetlights', 'streetlights?'],
  ['power lines', 'conductors|utility (?:poles|gantries)|transmission pylons|wiring'],
  ['road signs', 'guide and warning signs|regulatory panel|road signs'],
  ['advertising', 'advertising|billboards?|bus wrap'], ['graffiti', 'graffiti'],
  ['homeless encampment', '(?:homeless |unhoused |sidewalk )?encampments?'],
  ['tent', 'tents?'], ['tarp', 'tarps?|tarp covered'],
  ['license plates', 'registration plates|license plates'], ['daylight', 'daylight'],
  ['haze', 'hazy|haze'], ['overtaking', 'overtakes?|overtaking'],
  ['Los Angeles', 'los angeles'], ['Sixth Street Viaduct', 'sixth street viaduct'],
  ['Mateo Street', 'mateo street'],
];
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const rules=vocabulary.map(([tag,pattern])=>({tag,pattern:new RegExp(`\\b(?:${pattern})\\b`),exact:new RegExp(`^(?:${pattern})$`)}));
export function canonicalTag(value){
  const text=normalize(value);
  return rules.find(rule=>normalize(rule.tag)===text)?.tag
    ?? rules.find(rule=>rule.exact.test(text))?.tag
    ?? text;
}
export function hasCompositeTag(clip,query){
  const tag=normalize(canonicalTag(query));
  return !tag||(clip.tags??[]).some(value=>normalize(value)===tag);
}
export function deriveCompositeTags(labels){
  const supported=labels.filter(label=>label.id&&label.evidenceIds?.length&&label.confidence>=0.85
    &&['visual','combined'].includes(label.evidence)
    &&['scene','geography','entities','brands','motion'].includes(label.category)
    &&label.editorialStatus!=='dismissed'
    &&! /\b(possible|probable|ambiguous|uncertain|no|without|absent|not visible)\b/i.test(label.label));
  const tagEvidence=rules.flatMap(({tag,pattern})=>{
    // Only affirmative observation headings, never incidental/negated mentions
    // in descriptions or hypothetical production suggestions.
    const matches=supported.filter(label=>pattern.test(normalize(label.label)));
    return matches.length?[{tag,labelIds:matches.map(label=>label.id),evidenceIds:[...new Set(matches.flatMap(label=>label.evidenceIds))]}]:[];
  });
  return {tags:tagEvidence.map(entry=>entry.tag),tagEvidence,tagVersion:'observed-content-v1'};
}
