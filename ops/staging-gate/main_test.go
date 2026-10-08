package main

import (
 "io"
 "crypto/sha256"
 "encoding/base64"
 "net/http"
 "net/http/httptest"
 "net/url"
 "strings"
 "sync"
 "testing"
 "time"
 "golang.org/x/crypto/bcrypt"
)

const testPassword="local-test-password-only"
func fixture(t *testing.T) *gate {
 t.Helper();h,e:=bcrypt.GenerateFromPassword([]byte(testPassword),bcrypt.MinCost);if e!=nil{t.Fatal(e)}
 // The existing Traefik verifier is PHP-compatible $2y$ bcrypt.
 h=[]byte(strings.Replace(string(h),"$2a$","$2y$",1))
 return newGate(h,http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){w.Header().Set("X-App-Cookie",r.Header.Get("Cookie"));w.Header().Set("X-App-Authorization",r.Header.Get("Authorization"));w.Header().Set("Set-Cookie","app-session=unchanged; Path=/; HttpOnly");w.WriteHeader(200);_,_=io.WriteString(w,"protected app content")}))
}
func request(g *gate,method,path,body string,cookie *http.Cookie) *httptest.ResponseRecorder {
 r:=httptest.NewRequest(method,origin+path,strings.NewReader(body));r.Header.Set("Origin",origin);r.Header.Set("Content-Type","application/x-www-form-urlencoded");if cookie!=nil{r.AddCookie(cookie)};w:=httptest.NewRecorder();g.ServeHTTP(w,r);return w
}
func login(t *testing.T,g *gate,next string) *http.Cookie {
 t.Helper();w:=request(g,"POST",gatePath,url.Values{"password":{testPassword},"next":{next}}.Encode(),nil)
 if w.Code!=303 {t.Fatalf("login status=%d",w.Code)}
 cs:=w.Result().Cookies();if len(cs)!=1 {t.Fatal("missing session cookie")};return cs[0]
}
func TestAllAppPathsRequireGate(t *testing.T) {
 for _,path:=range []string{"/","/login","/projects","/projects/new?mode=signup","/auth/callback?code=fixture","/_next/static/chunk.js","/media/preview.mp4","/favicon.ico","/api/reserve","/_staging-access/anything"} {
  t.Run(path,func(t *testing.T){w:=request(fixture(t),"GET",path,"",nil);if w.Code!=303||!strings.HasPrefix(w.Header().Get("Location"),gatePath+"?next="){t.Fatalf("ungated path: %d",w.Code)};if strings.Contains(w.Body.String(),"protected app content"){t.Fatal("leaked app body")}})
 }
}
func TestBlankWrongAndDuplicatePasswordsDenied(t *testing.T) {
 for _,body:=range []string{"password=","password=wrong","password="+testPassword+"&password=wrong",url.Values{"password":{strings.Repeat("x",73)}}.Encode()} {
  w:=request(fixture(t),"POST",gatePath,body,nil);if w.Code!=401||len(w.Result().Cookies())!=0{t.Fatalf("invalid password accepted: %d",w.Code)}
 }
}
func TestSuccessCookieAndDownstreamAuth(t *testing.T) {
 g:=fixture(t);c:=login(t,g,"/projects?view=mine")
 if !c.Secure||!c.HttpOnly||c.Path!="/"||c.Domain!=""||c.SameSite!=http.SameSiteLaxMode||c.Name!=cookieName{t.Fatal("cookie policy")}
 r:=httptest.NewRequest("GET",origin+"/projects",nil);r.AddCookie(c);r.AddCookie(&http.Cookie{Name:"app-session",Value:"existing"});r.Header.Set("Authorization","Bearer app-token")
 w:=httptest.NewRecorder();g.ServeHTTP(w,r)
 if w.Code!=200||w.Header().Get("X-App-Cookie")!="app-session=existing"||w.Header().Get("X-App-Authorization")!="Bearer app-token"||!strings.Contains(w.Header().Get("Set-Cookie"),"app-session=unchanged"){t.Fatal("changed downstream app authentication")}
 if w.Header().Get("Cache-Control")!="no-store"{t.Fatal("cacheable protected response")}
}
func TestCorrectHashAndPathQueryPreserved(t *testing.T) {
 g:=fixture(t);w:=request(g,"POST",gatePath,url.Values{"password":{testPassword},"next":{"/projects?view=mine&name=a%20b"}}.Encode(),nil)
 if w.Code!=303||w.Header().Get("Location")!="/projects?view=mine&name=a%20b"{t.Fatal("target changed")}
}
func TestSessionForgeryExpiryAndDuplicateCookie(t *testing.T) {
 g:=fixture(t);c:=login(t,g,"/");forged:=*c;forged.Value="x"+c.Value[1:]
 if request(g,"GET","/projects","",&forged).Code!=303{t.Fatal("forged session accepted")}
 r:=httptest.NewRequest("GET",origin+"/",nil);r.AddCookie(c);r.AddCookie(c);w:=httptest.NewRecorder();g.ServeHTTP(w,r);if w.Code!=303{t.Fatal("duplicate cookie accepted")}
 now:=time.Now().Add(8*time.Hour+time.Second);g.now=func()time.Time{return now};if request(g,"GET","/","",c).Code!=303{t.Fatal("expired session accepted")}
}
func TestLogoutRevokesReplayAndRetainsAppCookie(t *testing.T) {
 g:=fixture(t);c:=login(t,g,"/");w:=request(g,"POST",gatePath+"/logout","",c)
 if w.Code!=303||w.Result().Cookies()[0].MaxAge!=-1||w.Result().Cookies()[0].Name!=cookieName{t.Fatal("logout cookie")}
 if request(g,"GET","/projects","",c).Code!=303{t.Fatal("logged-out token replay accepted")}
}
func TestCrossOriginPostsDenied(t *testing.T) {
 for _,path:=range []string{gatePath,gatePath+"/logout"}{for _,o:=range []string{"","null","https://example.invalid"}{g:=fixture(t);r:=httptest.NewRequest("POST",origin+path,strings.NewReader("password="+testPassword));r.Header.Set("Origin",o);r.Header.Set("Content-Type","application/x-www-form-urlencoded");w:=httptest.NewRecorder();g.ServeHTTP(w,r);if w.Code!=403{t.Fatal("cross-origin POST allowed")}}}
}
func TestSafeNextRejectsOpenRedirects(t *testing.T) {
 for _,s:=range []string{"https://evil.invalid/","//evil.invalid/","/%2fevil.invalid/","/\\evil.invalid/","/%5cevil.invalid/","/\r\nLocation:evil","/_staging-access/logout","bad"}{if safeNext(s)!="/"{t.Fatalf("unsafe next allowed: %q",s)}}
}
func TestRequestsDoNotReflectPassword(t *testing.T) {
 w:=request(fixture(t),"POST",gatePath,"password=unique-wrong-secret",nil);if strings.Contains(w.Body.String(),"unique-wrong-secret"){t.Fatal("password echoed")}
 if w.Header().Get("Cache-Control")!="no-store"||!strings.Contains(w.Header().Get("Content-Security-Policy"),"form-action 'self'"){t.Fatal("gate security headers")}
}
func TestPostToAppCannotBypassGate(t *testing.T) {w:=request(fixture(t),"POST","/api/reserve","",nil);if w.Code!=401{t.Fatal("unauthorized write not denied")}}
func TestRateLimitAndRecovery(t *testing.T) {
 g:=fixture(t);for i:=0;i<10;i++{w:=request(g,"POST",gatePath,"password=wrong",nil);if w.Code!=401{t.Fatal("premature limit")}}
 if request(g,"POST",gatePath,"password="+testPassword,nil).Code!=429{t.Fatal("missing limit")}
 now:=time.Now().Add(time.Minute+time.Second);g.now=func()time.Time{return now};login(t,g,"/")
}
func TestSessionRotationAndRestartFailClosed(t *testing.T) {
 g:=fixture(t);old:=login(t,g,"/");w:=request(g,"POST",gatePath,"password="+testPassword,old);fresh:=w.Result().Cookies()[0]
 if fresh.Value==old.Value||request(g,"GET","/","",old).Code!=303||request(g,"GET","/","",fresh).Code!=200{t.Fatal("rotation failed")}
 if request(fixture(t),"GET","/","",fresh).Code!=303{t.Fatal("restart must invalidate sessions")}
}
func TestConcurrentSessions(t *testing.T) {g:=fixture(t);c:=login(t,g,"/");var wg sync.WaitGroup;for i:=0;i<30;i++{wg.Add(1);go func(){defer wg.Done();if request(g,"GET","/","",c).Code!=200{t.Error("session failed")}}()};wg.Wait()}

func TestJSONLoginFeedbackAndSession(t *testing.T) {
 g:=fixture(t)
 for _,tc:=range []struct{password string;status int;ok bool}{{"wrong",401,false},{testPassword,200,true}} {
  r:=httptest.NewRequest("POST",origin+gatePath,strings.NewReader(url.Values{"password":{tc.password},"next":{"/projects?view=mine"}}.Encode()))
  r.Header.Set("Origin",origin);r.Header.Set("Content-Type","application/x-www-form-urlencoded");r.Header.Set("Accept","application/json")
  w:=httptest.NewRecorder();g.ServeHTTP(w,r)
  if w.Code!=tc.status||w.Header().Get("Content-Type")!="application/json"{t.Fatal("wrong feedback format or status")}
  if tc.ok {if !strings.Contains(w.Body.String(),`"next":"/projects?view=mine"`)||request(g,"GET","/projects","",w.Result().Cookies()[0]).Code!=200{t.Fatal("JSON login did not establish session")}} else if !strings.Contains(w.Body.String(),"didn’t match"){t.Fatal("missing error feedback")}
 }
}
func TestProgressScriptAllowedByCSP(t *testing.T) {
 w:=request(fixture(t),"GET",gatePath,"",nil)
 digest:=sha256.Sum256([]byte(loginScript));expected:="'sha256-"+base64.StdEncoding.EncodeToString(digest[:])+"'"
 if !strings.Contains(w.Header().Get("Content-Security-Policy"),expected)||!strings.Contains(w.Body.String(),"<script>"+loginScript+"</script>")||!strings.Contains(w.Body.String(),`role="status"`){t.Fatal("progress script or CSP mismatch")}
}
