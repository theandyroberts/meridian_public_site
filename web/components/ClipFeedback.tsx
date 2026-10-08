'use client';
import {useRef, useState, type FormEvent} from 'react';
import styles from './ClipFeedback.module.css';

export function ClipFeedback({clipId, endpoint, posterTime, labelDecisions, initialMessage = '', onSent}:{clipId:string;endpoint:string;posterTime:number;labelDecisions:Record<string,string>;initialMessage?:string;onSent?:()=>void}) {
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[message,setMessage]=useState(initialMessage),[website,setWebsite]=useState('');
  const [sending,setSending]=useState(false),[status,setStatus]=useState(''),[failed,setFailed]=useState(false);
  const attempt=useRef<{payload:string;id:string}|null>(null);
  const busy=useRef(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy.current)return;
    busy.current=true;setSending(true);setStatus('Sending feedback…');setFailed(false);
    const fields={clipId,name,email,message,website,posterTime,labelDecisions};
    const payload=JSON.stringify(fields);
    if(attempt.current?.payload!==payload)attempt.current={payload,id:crypto.randomUUID()};
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,submissionId:attempt.current.id}),signal:AbortSignal.timeout(25000)});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result?.ok)throw new Error(result?.error??(response.status===429?'Too many submissions right now. Please wait a minute and try again.':'Email sending could not be confirmed. Please retry or email andy@note15.com directly.'));
      setStatus('Feedback sent to Andy at andy@note15.com. Thank you!');setMessage('');attempt.current=null;onSent?.();
    }catch(error){setFailed(true);setStatus(error instanceof Error&&error.name!=='TimeoutError'?error.message:'Email sending could not be confirmed. Your text is still here; please retry.');}
    finally{busy.current=false;setSending(false);}
  }
  return <section id="feedback" className={styles.section} aria-labelledby="feedback-heading">
    <p className={styles.eyebrow}>TEAM FEEDBACK</p><h2 id="feedback-heading">What should we refine?</h2>
    <p className={styles.intro}>Send your comments directly to <a href="mailto:andy@note15.com">andy@note15.com</a>. Your selected poster and label decisions are included.</p>
    <form onSubmit={submit}>
      <fieldset disabled={sending} className={styles.fields}>
        <label>Your name<input required name="name" autoComplete="name" maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>Your email (optional, for replies)<input type="email" name="email" autoComplete="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label>
        <label className={styles.message}>Comments<textarea required name="message" maxLength={8000} rows={5} value={message} onChange={event=>setMessage(event.target.value)} placeholder="What’s working? What needs another pass?"/></label>
        <div className={styles.honeypot} aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event=>setWebsite(event.target.value)}/></label></div>
        <button type="submit">{sending?'Sending…':'Send feedback to Andy'} <span aria-hidden="true">↗</span></button>
      </fieldset>
      <p role={failed?'alert':'status'} className={failed?styles.error:styles.status}>{status}</p>
    </form>
  </section>;
}
