#!/usr/bin/env python3
"""Empirical test of the as-written warp math from tools/calibrate.py."""
import json, math, sys
import numpy as np
import cv2

S = "/private/tmp/claude-501/-Users-andrewroberts-Projects-the-plate-lab/99d9eefc-b8c1-4980-bea8-97a60ce8370d/scratchpad"
PTS = "/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/03:21:24_Mercy_Ptgui/mercy01.pts"

# ---------- as-written constants from calibrate.py ----------
SENSOR_WIDTH_MM = 22.56
CAMERAS = [
    {"id": "A", "type": "horizontal", "yaw": -81.7,  "pitch": 10.1,  "roll": -0.7},
    {"id": "B", "type": "horizontal", "yaw": -27.1,  "pitch":  7.9,  "roll":  0.2},
    {"id": "C", "type": "horizontal", "yaw":  26.2,  "pitch": 10.5,  "roll": -1.1},
    {"id": "D", "type": "horizontal", "yaw":  80.7,  "pitch":  7.5,  "roll": -1.5},
    {"id": "E", "type": "horizontal", "yaw": 134.8,  "pitch":  9.9,  "roll":  0.1},
    {"id": "F", "type": "horizontal", "yaw": -136.1, "pitch":  8.5,  "roll": -1.7},
    {"id": "G", "type": "upward",     "yaw": -83.5,  "pitch": 54.8,  "roll":  0.0},
    {"id": "H", "type": "upward",     "yaw":  26.6,  "pitch": 54.8,  "roll":  0.0},
    {"id": "J", "type": "upward",     "yaw": 145.0,  "pitch": 54.8,  "roll":  0.0},
]
HORIZ_F_MM, SKY_F_MM = 12.0, 9.0   # Laowa 12mm Cine (86.5x52.7), Laowa 9mm Cine

def focal_mm_to_px(focal_mm, image_width):
    return focal_mm * image_width / SENSOR_WIDTH_MM

def ypr_to_rotation_matrix(yaw_deg, pitch_deg, roll_deg):
    y, p, r = math.radians(yaw_deg), math.radians(pitch_deg), math.radians(roll_deg)
    Ry = np.array([[math.cos(y),0,math.sin(y)],[0,1,0],[-math.sin(y),0,math.cos(y)]])
    Rx = np.array([[1,0,0],[0,math.cos(p),-math.sin(p)],[0,math.sin(p),math.cos(p)]])
    Rz = np.array([[math.cos(r),-math.sin(r),0],[math.sin(r),math.cos(r),0],[0,0,1]])
    return Ry @ Rx @ Rz

# ---------- EXACT replica of warp_to_equirect (calibrate.py ~line 394) ----------
def warp_to_equirect(image, K, R, eq_w, eq_h):
    K = K.astype(np.float64); R = R.astype(np.float64)
    R_inv = R.T
    u = np.arange(eq_w, dtype=np.float64)
    v = np.arange(eq_h, dtype=np.float64)
    uu, vv = np.meshgrid(u, v)
    lon = (uu / eq_w - 0.5) * 2 * np.pi
    lat = (0.5 - vv / eq_h) * np.pi
    cos_lat = np.cos(lat)
    dx = cos_lat * np.sin(lon)
    dy = -np.sin(lat)
    dz = cos_lat * np.cos(lon)
    rx = R_inv[0,0]*dx + R_inv[0,1]*dy + R_inv[0,2]*dz
    ry = R_inv[1,0]*dx + R_inv[1,1]*dy + R_inv[1,2]*dz
    rz = R_inv[2,0]*dx + R_inv[2,1]*dy + R_inv[2,2]*dz
    valid = rz > 0.01
    with np.errstate(divide='ignore', invalid='ignore'):
        px = (K[0,0]*rx/rz + K[0,2])
        py = (K[1,1]*ry/rz + K[1,2])
    h, w = image.shape[:2]
    in_bounds = valid & (px >= 0) & (px < w-1) & (py >= 0) & (py < h-1)
    map_x = np.where(in_bounds, px, 0).astype(np.float32)
    map_y = np.where(in_bounds, py, 0).astype(np.float32)
    warped = cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR)
    mask = in_bounds.astype(np.uint8) * 255
    return warped, mask

def make_K(f, w, h):
    return np.array([[f,0,w/2.0],[0,f,h/2.0],[0,0,1.0]])

# ---------- 1. Parse the PTGui .pts ----------
d = json.load(open(PTS))
proj = d["project"]
lenses = proj["globallenses"]
groups = proj["imagegroups"]
cps = proj["controlpoints"]

print("="*100)
print("PTGui mercy01.pts (project_v33 JSON, PTGui Pro 12.24) — extracted calibration")
print("="*100)
pt_cams = []
for gi, g in enumerate(groups):
    fn = g["images"][0]["filename"]
    letter = fn[0]
    p = g["position"]["params"]
    li = g["globallens"]
    L = lenses[li]["lens"]["params"]
    sh = lenses[li]["shift"]["params"]
    W, H = g["size"]
    diag_mm = L["sensordiagonal"]
    sw_mm = diag_mm * W / math.hypot(W, H)
    f_px = L["focallength"] / sw_mm * W
    hfov = 2*math.degrees(math.atan(W/(2*f_px)))
    vfov = 2*math.degrees(math.atan(H/(2*f_px)))
    pt_cams.append(dict(letter=letter, gi=gi, yaw=p["yaw"], pitch=p["pitch"], roll=p["roll"],
                        lens=li, f_mm=L["focallength"], f_px=f_px, W=W, H=H,
                        a=L["a"], b=L["b"], c=L["c"],
                        d_long=sh["longside"], e_short=sh["shortside"], hfov=hfov, vfov=vfov))
    print(f"cam {letter} (group{gi}) lens{li}: yaw={p['yaw']:8.3f} pitch={p['pitch']:7.3f} roll={p['roll']:7.3f}  "
          f"f={L['f' 'ocallength']:.3f}mm f_px={f_px:.1f} (on {W}x{H})  hfov={hfov:.2f} vfov={vfov:.2f}")
for li, LL in enumerate(lenses):
    L = LL["lens"]["params"]; sh = LL["shift"]["params"]
    print(f"lens{li}: proj={L['projection']} f={L['focallength']:.4f}mm sensordiag={L['sensordiagonal']}mm "
          f"a={L['a']:.6f} b={L['b']:.6f} c={L['c']:.6f} shift_long={sh['longside']:.6f} shift_short={sh['shortside']:.6f}")
print(f"pano: {proj['panoramaparams']['projection']} hfov={proj['panoramaparams']['hfov']} n_controlpoints={len(cps)}")

# schema interpretation note printed for the digest
print("""
SCHEMA INTERPRETATION: file is PTGui v12 JSON (not classic PTO 'o'-lines). Rotation in
project.imagegroups[i].position.params (deg). Lens in project.globallenses[k].lens.params:
'focallength' in mm with 'sensordiagonal'=30.56mm -> sensor 27.03x14.26mm for 6144x3240
(true RED Komodo 6K sensor), NOT the 22.56mm hardcoded in calibrate.py. Shift stored
normalized in 'shift.params.longside/shortside' (fraction of long side). Control points:
{"t":0,"0":[imgIdx,subIdx,x_px,y_px],"1":[...]} in 6144x3240 pixel coords.""")

# ---------- 2. load frames ----------
imgA = cv2.imread(f"{S}/camA_5s.png")
imgB = cv2.imread(f"{S}/camB_5s.png")
h, w = imgA.shape[:2]
print(f"frame size: {w}x{h}")

EQ_W, EQ_H = 3840, 1920

# ---------- as-written camera params (build_initial_cameras path) ----------
f_asw = focal_mm_to_px(HORIZ_F_MM, w)   # 12mm * 2048 / 22.56
hfov_asw = 2*math.degrees(math.atan(w/(2*f_asw)))
print(f"\nAS-WRITTEN focal handling: f = 12mm*{w}/22.56mm = {f_asw:.2f}px  -> hfov = {hfov_asw:.2f} deg")
RA = ypr_to_rotation_matrix(-81.7, 10.1, -0.7)
RB = ypr_to_rotation_matrix(-27.1, 7.9, 0.2)
K = make_K(f_asw, w, h)

# (a) cam A alone
warpA, maskA = warp_to_equirect(imgA, K, RA, EQ_W, EQ_H)
outA = warpA.copy(); outA[maskA==0] //= 4  # dim invalid area? no—keep pure: black outside already
cv2.imwrite(f"{S}/01_camA_equirect_aswritten.png", warpA)

# (b) A+B composite 50% overlap
warpB, maskB = warp_to_equirect(imgB, K, RB, EQ_W, EQ_H)
comp = np.zeros_like(warpA)
onlyA = (maskA>0)&(maskB==0); onlyB = (maskB>0)&(maskA==0); both=(maskA>0)&(maskB>0)
comp[onlyA]=warpA[onlyA]; comp[onlyB]=warpB[onlyB]
comp[both] = (warpA[both].astype(np.uint16)+warpB[both].astype(np.uint16))//2
cv2.imwrite(f"{S}/02_camA_camB_50pct_overlap.png", comp)

# (c) checkerboard 100px burned into source then warped
chk = imgA.copy().astype(np.float32)
yy, xx = np.mgrid[0:h, 0:w]
checker = (((xx//100)+(yy//100))%2).astype(np.float32)
chk = chk*0.55 + checker[...,None]*115  # visible checker
# hard grid lines every 100 px
chk[(yy%100<2)|(xx%100<2)] = (0,255,0)
chk = chk.clip(0,255).astype(np.uint8)
warpC, maskC = warp_to_equirect(chk, K, RA, EQ_W, EQ_H)
cv2.imwrite(f"{S}/03_camA_checker100_warped.png", warpC)
cv2.imwrite(f"{S}/03b_camA_checker100_source.png", chk)

# ---------- 4. measurements ----------
def measure(mask, name):
    eq = mask[EQ_H//2]   # equator row... but tile is pitched ~10deg; also measure widest row
    wid_eq = int((eq>0).sum())
    widths = (mask>0).sum(axis=1)
    row_max = int(widths.argmax()); wid_max = int(widths.max())
    cols = np.where((mask>0).any(axis=0))[0]
    heights = (mask>0).sum(axis=0)
    c0, c1 = cols.min(), cols.max()
    ccen = (c0+c1)//2
    print(f"{name}: width@equator(v=960)={wid_eq}px  max_width={wid_max}px@row{row_max}  "
          f"col_range=[{c0},{c1}] ({c1-c0+1}px)  vheight@centercol={int(heights[ccen])}px "
          f"vheight@left+40={int(heights[c0+40])}px vheight@right-40={int(heights[c1-40])}px")
    return wid_eq, wid_max

print("\nAS-WRITTEN warp measurements (3840x1920 canvas; 1deg = 10.667px):")
wa_eq, wa_max = measure(maskA, "camA as-written")
print(f"  expected if hfov=86.5: {86.5/360*3840:.0f}px at lat of optical axis; "
      f"tile widens away from equator (pitch 10.1)")
# top/bottom edge bowing of tile: v of top edge of mask vs column
rows_top = np.full(EQ_W, -1); rows_bot = np.full(EQ_W, -1)
for c in range(EQ_W):
    nz = np.nonzero(maskA[:,c])[0]
    if nz.size: rows_top[c]=nz[0]; rows_bot[c]=nz[-1]
cc = np.where(rows_top>=0)[0]
mid = cc[len(cc)//2]
print(f"  top-edge v: at left edge {rows_top[cc[5]]}, at center {rows_top[mid]}, at right {rows_top[cc[-5]]}"
      f"  (bow = {rows_top[mid]-min(rows_top[cc[5]],rows_top[cc[-5]])}px)")
print(f"  bottom-edge v: left {rows_bot[cc[5]]}, center {rows_bot[mid]}, right {rows_bot[cc[-5]]}"
      f"  (bow = {rows_bot[mid]-max(rows_bot[cc[5]],rows_bot[cc[-5]])}px)")

# ---------- 6. deliberately wrong focal 1.5x ----------
K15 = make_K(f_asw*1.5, w, h)
warp15, mask15 = warp_to_equirect(chk, K15, RA, EQ_W, EQ_H)
cv2.imwrite(f"{S}/04_camA_checker_focal1p5x.png", warp15)
wid15 = int((mask15[EQ_H//2]>0).sum())
hf15 = 2*math.degrees(math.atan(w/(2*f_asw*1.5)))
print(f"\n1.5x-focal control: f={f_asw*1.5:.1f}px hfov={hf15:.2f}deg", end=" ")
measure(mask15, "camA focal*1.5")

# also PTGui-correct focal render for comparison
ptA = [c for c in pt_cams if c["letter"]=="A"][0]
f_pt = ptA["f_px"] * w / ptA["W"]
Kpt = make_K(f_pt, w, h)
warpPT, maskPT = warp_to_equirect(chk, Kpt, RA, EQ_W, EQ_H)
cv2.imwrite(f"{S}/05_camA_checker_ptgui_focal.png", warpPT)
print(f"\nPTGui-derived focal: f={f_pt:.1f}px hfov={ptA['hfov']:.2f}deg", end=" ")
measure(maskPT, "camA ptgui-focal")

# ---------- 5. control point RMS ----------
# reproject each CP endpoint pixel -> ray -> pano lon/lat -> equirect px; distance between pair
def px_to_lonlat(x, y, Kc, Rc, undist=None):
    if undist is not None: x, y = undist(x, y)
    r = np.linalg.inv(Kc) @ np.array([x, y, 1.0])
    v = Rc @ r  # camera->world (calibrate.py rotates world->cam with R_inv=R.T, so cam->world is R)
    v /= np.linalg.norm(v)
    lon = math.atan2(v[0], v[2]); lat = math.asin(np.clip(-v[1],-1,1))
    return lon, lat

def lonlat_to_eq(lon, lat):
    return (lon/(2*math.pi)+0.5)*EQ_W, (0.5-lat/math.pi)*EQ_H

def cp_rms(get_KR, undist_for=None, label=""):
    errs=[]
    for cp in cps:
        i0,_,x0,y0 = cp["0"]; i1,_,x1,y1 = cp["1"]
        if cp.get("t",0)!=0: continue
        K0,R0 = get_KR(i0); K1,R1 = get_KR(i1)
        u0 = undist_for(i0) if undist_for else None
        u1 = undist_for(i1) if undist_for else None
        l0 = px_to_lonlat(x0,y0,K0,R0,u0); l1 = px_to_lonlat(x1,y1,K1,R1,u1)
        p0 = lonlat_to_eq(*l0); p1 = lonlat_to_eq(*l1)
        dxp = p0[0]-p1[0]
        if dxp > EQ_W/2: dxp -= EQ_W
        if dxp < -EQ_W/2: dxp += EQ_W
        errs.append(math.hypot(dxp, p0[1]-p1[1]))
    e = np.array(errs)
    print(f"CP RMS [{label}]: n={len(e)} rms={math.sqrt((e**2).mean()):.1f}px "
          f"mean={e.mean():.1f} median={np.median(e):.1f} max={e.max():.1f} "
          f"(equirect px; 1deg=10.67px -> rms={math.sqrt((e**2).mean())/10.667:.2f}deg)")
    return e

W6, H6 = 6144, 3240
# (1) as-written: hardcoded CAMERAS ypr + lens-library focal via 22.56mm sensor
letter_of = [c["letter"] for c in pt_cams]
def KR_asw(i):
    let = letter_of[i]
    cam = [c for c in CAMERAS if c["id"]==let][0]
    fmm = SKY_F_MM if cam["type"]=="upward" else HORIZ_F_MM
    f = focal_mm_to_px(fmm, W6)
    return make_K(f, W6, H6), ypr_to_rotation_matrix(cam["yaw"], cam["pitch"], cam["roll"])
print("\nControl-point reprojection (all 103 CPs, 6144x3240 coords -> 3840x1920 equirect):")
cp_rms(KR_asw, label="as-written calibrate.py params (hardcoded ypr, f via 22.56mm, no dist)")

# (2) PTGui ypr + PTGui focal, no distortion, centered principal
def KR_pt(i):
    c = pt_cams[i]
    return make_K(c["f_px"], W6, H6), ypr_to_rotation_matrix(c["yaw"], c["pitch"], c["roll"])
cp_rms(KR_pt, label="PTGui ypr+focal, distortion IGNORED, centered pp")

# (3) PTGui ypr+focal + a/b/c undistortion (PanoTools poly, r normalized to min(w,h)/2) + shift
def make_undist(i, norm="minhalf", use_shift=True):
    c = pt_cams[i]
    a,b,cc_ = c["a"], c["b"], c["c"]; dd = 1.0-a-b-cc_
    Rn = min(W6,H6)/2.0 if norm=="minhalf" else math.hypot(W6,H6)/2.0
    dx = c["d_long"]*W6 if use_shift else 0.0
    dy = c["e_short"]*H6 if use_shift else 0.0
    cx, cy = W6/2.0+dx, H6/2.0+dy
    def undist(x, y):
        # measured (distorted-source) px -> ideal px: invert r_src = r_id*(a r^3+b r^2+c r+d)
        rx_, ry_ = x-cx, y-cy
        rs = math.hypot(rx_, ry_)/Rn
        r = rs
        for _ in range(30):
            f_ = r*(a*r**3+b*r**2+cc_*r+dd) - rs
            fp = 4*a*r**3+3*b*r**2+2*cc_*r+dd
            r -= f_/fp
        s = (r/rs) if rs>1e-9 else 1.0
        return W6/2.0+rx_*s, H6/2.0+ry_*s   # ideal px relative to center for K with centered pp
    return undist
cp_rms(KR_pt, undist_for=lambda i: make_undist(i,"minhalf",True),
       label="PTGui ypr+focal + a/b/c (r_norm=min/2) + shift")
cp_rms(KR_pt, undist_for=lambda i: make_undist(i,"minhalf",False),
       label="PTGui ypr+focal + a/b/c (r_norm=min/2) no shift")
print("\nDONE")
