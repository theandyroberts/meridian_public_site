package main

import (
 "crypto/rand"
 "crypto/sha256"
 "encoding/base64"
 "html/template"
 "log"
 "net"
 "net/http"
 "net/http/httputil"
 "net/url"
 "os"
 "strings"
 "sync"
 "time"

 "golang.org/x/crypto/bcrypt"
)

const origin = "https://staging.platelabstudio.com"
const gatePath = "/_staging-access"
const cookieName = "__Host-platelab-staging"
const sessionTTL = 8*time.Hour

type bucket struct { count int; until time.Time }
type gate struct {
 hash []byte
 upstream http.Handler
 now func() time.Time
 mu sync.Mutex
 sessions map[[32]byte]time.Time
 attempts map[string]bucket
 global bucket
}

func newGate(hash []byte, upstream http.Handler) *gate {
 return &gate{hash:hash,upstream:upstream,now:time.Now,sessions:make(map[[32]byte]time.Time),attempts:make(map[string]bucket)}
}

func safeNext(raw string) string {
 u,err:=url.Parse(raw)
 if err!=nil || !strings.HasPrefix(raw,"/") || strings.HasPrefix(raw,"//") || strings.ContainsAny(raw,"\\\r\n") || u.IsAbs() || u.Host!="" || strings.HasPrefix(u.Path,gatePath) {return "/"}
 // Disallow encoded network-path redirects and encoded control characters too.
 if strings.HasPrefix(u.Path,"//") || strings.ContainsAny(u.Path,"\\\r\n") {return "/"}
 return u.RequestURI()
}

func (g *gate) valid(r *http.Request) bool {
 cookies:=r.CookiesNamed(cookieName)
 if len(cookies)!=1 || len(cookies[0].Value)!=43{return false}
 key:=sha256.Sum256([]byte(cookies[0].Value))
 g.mu.Lock();defer g.mu.Unlock()
 expires,ok:=g.sessions[key]
 if !ok || !g.now().Before(expires){delete(g.sessions,key);return false}
 return true
}

func (g *gate) allowAttempt(r *http.Request) bool {
 ip,_,_:=net.SplitHostPort(r.RemoteAddr)
 // Only the private Traefik network can reach this service. Traefik appends
 // the real client address; never trust an attacker-supplied leftmost entry.
 if forwarded:=strings.Split(r.Header.Get("X-Forwarded-For"),",");len(forwarded)>0 {
  candidate:=strings.TrimSpace(forwarded[len(forwarded)-1]);if net.ParseIP(candidate)!=nil{ip=candidate}
 }
 now:=g.now();g.mu.Lock();defer g.mu.Unlock()
 for key,b:=range g.attempts {if !now.Before(b.until){delete(g.attempts,key)}}
 if !now.Before(g.global.until){g.global=bucket{until:now.Add(time.Minute)}}
 b:=g.attempts[ip];if !now.Before(b.until){b=bucket{until:now.Add(time.Minute)}}
 if b.count>=10 || g.global.count>=120{return false}
 b.count++;g.global.count++;g.attempts[ip]=b;return true
}

func security(w http.ResponseWriter) {
 w.Header().Set("Cache-Control","no-store")
 w.Header().Set("X-Robots-Tag","noindex, nofollow, noarchive")
 w.Header().Set("Referrer-Policy","no-referrer")
 w.Header().Set("X-Content-Type-Options","nosniff")
 w.Header().Set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
}

var loginPage=template.Must(template.New("gate").Parse(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plate Lab — Staging access</title><style>body{margin:0;background:#111;color:#eee;font:17px system-ui;min-height:100vh;display:grid;place-items:center}main{width:min(390px,calc(100% - 48px));padding:48px 0}small{color:#c56b3e;letter-spacing:.14em}h1{font-size:32px;margin:18px 0}p{color:#bbb;line-height:1.5}label{display:block;margin:24px 0 9px}input,button{box-sizing:border-box;width:100%;border-radius:3px;font:inherit;padding:13px}input{background:#1c1c1c;color:#fff;border:1px solid #777}button{background:#c56b3e;color:#111;border:0;font-weight:700;cursor:pointer;margin-top:16px}a{color:#ecab86}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #eee;outline-offset:3px}.error{color:#ffc4ae}footer{font-size:13px;color:#999;margin-top:26px}</style><main><small>THE PLATE LAB · STAGING</small>{{if .Active}}<h1>Staging access is open</h1><p><a href="{{.Next}}">Continue to staging</a></p><form method="post" action="/_staging-access/logout"><button>Sign out of staging access</button></form>{{else}}<h1>Enter staging</h1><p>Use the existing staging password.</p>{{if .Error}}<p class="error" role="alert">{{.Error}}</p>{{end}}<form method="post" action="/_staging-access"><input type="hidden" name="next" value="{{.Next}}"><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required autofocus><button>Enter staging</button></form><footer>Access lasts up to 8 hours. Your app account login is separate.</footer>{{end}}</main></html>`))

func (g *gate) page(w http.ResponseWriter,r *http.Request,status int,message,next string) {
 security(w);w.Header().Set("Content-Type","text/html; charset=utf-8");w.WriteHeader(status)
 _=loginPage.Execute(w,struct{Active bool;Error,Next string}{g.valid(r),message,safeNext(next)})
}

func (g *gate) ServeHTTP(w http.ResponseWriter,r *http.Request) {
 if r.Host!="staging.platelabstudio.com" {http.Error(w,"Unknown host",http.StatusMisdirectedRequest);return}
 if r.URL.Path==gatePath || r.URL.Path==gatePath+"/logout" {
  if r.Method==http.MethodGet || r.Method==http.MethodHead {g.page(w,r,200,"",r.URL.Query().Get("next"));return}
  if r.Method!=http.MethodPost {security(w);w.Header().Set("Allow","GET, HEAD, POST");http.Error(w,"Method not allowed",405);return}
  security(w)
  if r.Header.Get("Origin")!=origin {http.Error(w,"Request origin not allowed",403);return}
  if r.URL.Path==gatePath+"/logout" {
   g.mu.Lock();for _,c:=range r.CookiesNamed(cookieName){delete(g.sessions,sha256.Sum256([]byte(c.Value)))};g.mu.Unlock()
   http.SetCookie(w,&http.Cookie{Name:cookieName,Value:"",Path:"/",Secure:true,HttpOnly:true,SameSite:http.SameSiteLaxMode,MaxAge:-1})
   http.Redirect(w,r,gatePath,http.StatusSeeOther);return
  }
  if !g.allowAttempt(r) {w.Header().Set("Retry-After","60");g.page(w,r,429,"Too many attempts. Please wait a minute and try again.","/");return}
  r.Body=http.MaxBytesReader(w,r.Body,4096)
  if err:=r.ParseForm();err!=nil {g.page(w,r,400,"Please enter a valid password.","/");return}
  password:=r.PostForm.Get("password");next:=safeNext(r.PostForm.Get("next"))
  if password=="" || len(password)>72 || len(r.PostForm["password"])!=1 || bcrypt.CompareHashAndPassword(g.hash,[]byte(password))!=nil {g.page(w,r,401,"That password didn’t match. Please try again.",next);return}
  raw:=make([]byte,32);if _,err:=rand.Read(raw);err!=nil{http.Error(w,"Please try again",503);return}
  token:=base64.RawURLEncoding.EncodeToString(raw);now:=g.now()
  g.mu.Lock()
  for key,expires:=range g.sessions{if !now.Before(expires){delete(g.sessions,key)}}
  if len(g.sessions)>=4096 {g.mu.Unlock();http.Error(w,"Please try again later",503);return}
  // Rotate any existing session rather than accepting caller-selected tokens.
  for _,c:=range r.CookiesNamed(cookieName){delete(g.sessions,sha256.Sum256([]byte(c.Value)))}
  g.sessions[sha256.Sum256([]byte(token))]=now.Add(sessionTTL);g.mu.Unlock()
  http.SetCookie(w,&http.Cookie{Name:cookieName,Value:token,Path:"/",Secure:true,HttpOnly:true,SameSite:http.SameSiteLaxMode})
  http.Redirect(w,r,next,http.StatusSeeOther);return
 }
 if !g.valid(r) {
  security(w)
  if r.Method!=http.MethodGet && r.Method!=http.MethodHead {http.Error(w,"Staging access required",401);return}
  http.Redirect(w,r,gatePath+"?next="+url.QueryEscape(safeNext(r.URL.RequestURI())),http.StatusSeeOther);return
 }
 // Only the opaque gate cookie is removed; downstream app sessions and bearer
 // authentication remain untouched. Responses never become shared-cacheable.
 cookies:=r.Cookies();r.Header.Del("Cookie")
 for _,c:=range cookies {if c.Name!=cookieName{r.AddCookie(c)}}
 w.Header().Set("Cache-Control","no-store")
 g.upstream.ServeHTTP(w,r)
}

func main() {
 hash,err:=os.ReadFile("/run/secrets/staging-password-hash");if err!=nil{log.Fatal("Cannot read staging password verifier")};hash=[]byte(strings.TrimSpace(string(hash)))
 if _,err=bcrypt.Cost(hash);err!=nil{log.Fatal("Invalid staging password verifier")}
 target,err:=url.Parse("http://host.docker.internal:3106");if err!=nil{log.Fatal("Invalid upstream")}
 proxy:=httputil.NewSingleHostReverseProxy(target)
 original:=proxy.Director
 proxy.Director=func(r *http.Request){original(r);r.Host="staging.platelabstudio.com";r.Header.Set("X-Forwarded-Host","staging.platelabstudio.com");r.Header.Set("X-Forwarded-Proto","https")}
 proxy.ModifyResponse=func(r *http.Response)error{r.Header.Set("Cache-Control","no-store");r.Header.Set("X-Robots-Tag","noindex, nofollow, noarchive");return nil}
 proxy.ErrorHandler=func(w http.ResponseWriter,r *http.Request,e error){http.Error(w,"Staging is temporarily unavailable",502)}
 server:=&http.Server{Addr:":8080",Handler:newGate(hash,proxy),ReadHeaderTimeout:5*time.Second,ReadTimeout:30*time.Second,IdleTimeout:60*time.Second,MaxHeaderBytes:32768}
 log.Print("Staging password gate listening")
 log.Fatal(server.ListenAndServe())
}
