'use client';
import {canonicalTag,hasCompositeTag} from '../../shared/composite/tags.mjs';
import styles from './CompositeTags.module.css';
export type TaggedClip={id:string;title:string;posterURL:string;tags?:string[];media:{duration:number;fps:number}};
export function CompositeTags({tags,base='',catalogPath}:{tags:string[];base?:string;catalogPath?:string}){
  if(!tags.length)return null;
  const links=(values:string[])=>values.map(tag=><a key={tag} href={`${catalogPath??`${base}/review`}?tag=${encodeURIComponent(tag)}`} className={styles.tag}>{tag}<span aria-hidden="true">↗</span></a>);
  return <section id="content-tags" className={styles.tagSection} aria-label="Content tags"><div className={styles.tagHeading}><h2>Content tags <span className={styles.tagCount}>{tags.length}</span></h2><p>Click a tag to find matching clips.</p></div><div className={styles.tags}>{links(tags)}</div></section>;
}
export function CompositeTagCatalog({clips,query='',base='',publicReview=false}:{clips:TaggedClip[];query?:string;base?:string;publicReview?:boolean}){
  const tag=canonicalTag(query),matches=clips.filter(clip=>hasCompositeTag(clip,query));
  const counts=new Map<string,number>();for(const clip of clips)for(const value of new Set(clip.tags??[]))counts.set(value,(counts.get(value)??0)+1);
  const tagLinks=([...counts]).map(([value,count])=><a className={`${styles.tag} ${value===tag?styles.selected:''}`} aria-current={value===tag?'page':undefined} key={value} href={`${base}/review?tag=${encodeURIComponent(value)}`}>{value}<small>{count}</small></a>);
  return <main className={styles.catalog}>
    <p className={styles.eyebrow}>{publicReview?'TEAM REVIEW':'COMPOSITE COLLECTION'}</p>
    <h1>{tag?`Clips tagged “${tag}”`:'Find clips by content'}</h1>
    <p className={styles.description}>{publicReview?'Search the clips included in this review collection.':'Explore finished composites by their observed content.'}</p>
    <form className={styles.search} action={`${base}/review`} method="get"><label htmlFor="clip-tag-search">Search clip tags</label><div><input id="clip-tag-search" name="tag" defaultValue={query} placeholder="Try bridge, intersection, or billboard"/><button type="submit">Find clips</button></div></form>
    <div className={styles.tags} aria-label="Browse clip tags">{tagLinks}</div>
    <div className={styles.resultsHeading}><p role="status">{matches.length} matching {matches.length===1?'clip':'clips'}{publicReview?` · ${clips.length} in this review collection`:''}</p>{tag&&<a href={`${base}/review`}>Clear tag</a>}</div>
    <div className={styles.results}>{matches.map(clip=><article className={styles.card} key={clip.id}><a href={`${base}/review/${clip.id}`}><img src={clip.posterURL} alt={clip.title}/><div className={styles.cardCopy}><span>4K COMPOSITE · {clip.media.fps} FPS · {Math.round(clip.media.duration)} SEC</span><h2>{clip.title}</h2><p>View clip, route &amp; content labels ↗</p></div></a></article>)}</div>
    {!matches.length&&<p className={styles.empty}>No clips in this collection have that tag yet. Choose a tag above or clear the search.</p>}
  </main>;
}
