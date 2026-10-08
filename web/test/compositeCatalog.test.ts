import assert from 'node:assert/strict';
import test from 'node:test';
import {plateForComposite} from '../../shared/src/compositeCatalog';
const fixture=()=>({id:'test-clip',stockId:'stock-id',sourceFingerprint:'source',enrichment:{status:'complete'},localization:{status:'complete'},publication:{warnings:[]},watermark:{status:'detected'},title:'Bridge drive',description:'A captured environment.',tags:['bridge'],labels:[{label:'Bridge',confidence:.9,category:'scene'}],summary:{captureDate:'2024-01-04'},media:{duration:12,fps:24,width:4096,height:2048,codec:'prores',color:{primaries:'bt709',transfer:'unknown'}},hashes:{rough_stitch:'a'.repeat(64)},videoURL:'/composite-review/media/composite/test-clip/composite.mp4',posterURL:'/composite-review/media/composite/test-clip/poster.jpg',sourceTimecode:'01:00:00:00',publishedAt:'2026-10-08T00:00:00Z',crop:{height:1152},coverage:{earliestBlackRowEstimate:1100}});
test('import preserves source identity, media and incomplete coverage without fabricating camera previews',()=>{
 const p=plateForComposite(fixture(),'PL-7014298','approved-test','2026-10-08T00:00:00Z');
 assert.equal(p.mmm?.stockClipId,'stock-id');assert.equal(p.media.fps,24);assert.equal(p.security.masterSha256,'a'.repeat(64));assert.equal(p.composite?.coverageBottom,1100/2048);assert.deepEqual(p.renditions.cameraPreviews,{});assert.equal(p.timeOfDay,'unverified');assert.equal(p.weather,'unverified');assert.equal(p.status,'live');
});
test('incomplete or blocked imports cannot enter the catalog',()=>{
 for(const mutate of [(c:any)=>c.enrichment.status='running',(c:any)=>c.localization.status='pending',(c:any)=>c.publication.warnings.push({blocking:true}),(c:any)=>c.watermark.status='missing']){const c=fixture();mutate(c);assert.throws(()=>plateForComposite(c,'PL-7014298','approved-test','2026-10-08T00:00:00Z'));}
});
