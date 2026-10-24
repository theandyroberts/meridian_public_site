export type TagLabel={id:string;label:string;category:string;confidence:number;evidence:string;evidenceIds:string[];editorialStatus?:string};
export type TagEvidence={tag:string;labelIds:string[];evidenceIds:string[]};
export function canonicalTag(value:string):string;
export function hasCompositeTag(clip:{tags?:string[]},query:string):boolean;
export function deriveCompositeTags(labels:TagLabel[]):{tags:string[];tagEvidence:TagEvidence[];tagVersion:string};
