/* ==========================================================================
   THE COMMONS — an archive that accepts
   --------------------------------------------------------------------------
   A fork of ../cloud/cloud.js. The field is identical and deliberately so:
   one Gray–Scott lattice carrying three reagents —

       R = perception of self
       G = perception of others
       B = the collective fiction

   — sharing a grid, each bending the others' feed rate, the fiction reflexive
   so the more of it there is the harder it pulls. Every plate is pinned to a
   cell of that lattice; where its layer is active it is drawn in and enlarged,
   where the layer has died back it is thrown out to the periphery and shrinks.

   What is new is that the archive is no longer closed. Someone with an
   invitation can hand it a picture, and the picture stays — for them, and for
   whoever opens the page next. The chambers were fixed and are now fed.

   Two things follow, and they are the piece.

   First, a stranger's picture arrives with no stated allegiance, so the room
   assigns one: ../commons/sift.js measures it, finds the seven plates it most
   resembles, and gives it their average belonging. You are sorted by what you
   look like to people who were already here. CLIP gets a second opinion in
   afterwards when the network allows, and can move it.

   Second, nothing about the placement is permanent. Capture is on, as it is in
   the cloud, so a plate sitting where another layer's reagent has grown loud is
   dragged into *that* chamber regardless of what it was classified as. The
   chambers keep re-sorting the room as the room grows.

   The control panel is gone. Every parameter below is the value ../cloud/
   opens on; to dial new ones, open that piece, tune it there, and paste the
   numbers here. Nothing else about the render differs, so a fresh load of this
   page and a fresh load of that one are the same object.

   Pipeline per frame is unchanged:
     1. STEP     n Gray–Scott iterations, MRT ping-pong on RGBA32F
     2. REDUCE   (every 10 frames) global mean of each reagent -> fiction gain
     3. GROUND   background, screen-space field underlay, paper grain
     4. CLOUD    one instanced draw, all plates, two atlases
     5. PICK     (on hover only) id pass into a quarter-res buffer

   No dependencies. Raw WebGL2.
   ========================================================================== */

'use strict';

/* ==========================================================================
   1.  PARAMETERS — ../cloud/cloud.js SPEC defaults, flattened.
   The ranges and the sliders live in that piece. These are its opening state.
   ========================================================================== */

const P = {
  // reaction & diffusion
  steps: 12, dt: 1.0, Du: 0.19, Dv: 0.09,
  fSelf: 0.0370, kSelf: 0.0600,
  fOther: 0.0290, kOther: 0.0570,
  fColl: 0.0260, kColl: 0.0510,
  gridN: 192, seedBlobs: 7, seedRadius: 0.030, seedNoise: 0.06,
  seedSpread: 0.16, seedIdx: 7, warmup: 1400,
  // entanglement
  entangle: 0.85, pivot: 0.180,
  c2s: 0.0210, c2o: 0.0180, o2s: 0.0095, s2o: 0.0060, s2c: 0.0015, o2c: 0.0035,
  selfLoop: 0.0, fiction: 1.60, fictionFloor: 0.060,
  // echo chambers
  chamberSpread: 0.78, chamberLift: 0.28, chamberTwist: 0,
  sharp: 2.20, capture: 1.10,
  lobeSpread: 0.235, lobeRadius: 0.175, kindPull: 0.45,
  echoes: 18, echoSpread: 1.25, echoCell: 0.210, echoShrink: 0.26, echoFade: 0.80,
  // cloud & dispersion
  radius: 1.95, falloff: 1.85, outIdle: 2.25, inAct: 0.30, actGain: 7.20,
  relief: 1.05, shear: 0.42, swirl: 0.40, flatten: 0.20, scatter: 0.30, layoutSeed: 41,
  // plates
  scaleMin: 0.026, scaleMax: 0.430, scaleGamma: 2.40, sizeVary: 0.95, spin: 0.075,
  border: 0.030, alphaBase: 0.88, alphaAct: 0.30, drift: 0.13, jitter: 0.036,
  // look
  bg: '#f2f1ee', plateCol: '#fbfaf7',
  colSelf: '#c8483a', colOther: '#2f6f8f', colColl: '#8a7a2e',
  tint: 0.0, desat: 0.0, contrast: 1.06, bright: 1.03,
  fogNear: 4.40, fogFar: 13.00, fogAmt: 0.40, fogCut: 0.44, crisp: 0.72,
  underlay: 0.085, underScale: 1.00, grain: 0.028, vignette: 0.10,
  // camera
  fov: 36, dist: 6.60, orbit: 0.035, bob: 0.10, quality: 1.0,
};

// keep the total sprite count roughly where the cloud has it, however large
// the archive grows: 69 plates want 18 copies each, 600 want 2.
const TARGET_SPRITES = 1250;
const echoesFor = n => Math.max(1, Math.min(24, Math.round(TARGET_SPRITES / Math.max(1, n))));

/* ==========================================================================
   2.  small math — just what a camera needs
   ========================================================================== */

function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  return out;
}
function mat4LookAt(out, eye, ctr, up) {
  let z0 = eye[0] - ctr[0], z1 = eye[1] - ctr[1], z2 = eye[2] - ctr[2];
  let l = 1 / Math.hypot(z0, z1, z2); z0 *= l; z1 *= l; z2 *= l;
  let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
  l = Math.hypot(x0, x1, x2); l = l ? 1 / l : 0; x0 *= l; x1 *= l; x2 *= l;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  out.set([x0, y0, z0, 0, x1, y1, z1, 0, x2, y2, z2, 0,
    -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
    -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
    -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]), 1]);
  return out;
}
function mat4Mul(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}
function hexRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function hash(i, s) {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ==========================================================================
   3.  SHADERS
   The only change from ../cloud/ is that a plate now carries which atlas it
   came out of. The founding archive is one texture, baked at build time; the
   contributions are a second, assembled in the browser as they arrive. A
   single instanced draw covers both.
   ========================================================================== */

const VS_QUAD = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p*2.0 - 1.0, 0.0, 1.0);
}`;

/* --- Gray–Scott step, three reagents at once, two float targets --------- */
const FS_STEP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uU, uV;
uniform vec2 uTexel;
uniform vec3 uF, uK;
uniform float uDu, uDv, uDt;
uniform mat3 uCoup;          // column j, row i  =  influence of layer j on i
uniform float uPivot;
layout(location=0) out vec4 oU;
layout(location=1) out vec4 oV;

vec3 lap(sampler2D t, vec2 p){
  vec2 e = uTexel;
  vec3 s = texture(t,p).rgb * -1.0;
  s += (texture(t,p+vec2(e.x,0.0)).rgb + texture(t,p-vec2(e.x,0.0)).rgb +
        texture(t,p+vec2(0.0,e.y)).rgb + texture(t,p-vec2(0.0,e.y)).rgb) * 0.2;
  s += (texture(t,p+e).rgb + texture(t,p-e).rgb +
        texture(t,p+vec2(e.x,-e.y)).rgb + texture(t,p+vec2(-e.x,e.y)).rgb) * 0.05;
  return s;
}
void main(){
  vec3 u = texture(uU,vUv).rgb;
  vec3 v = texture(uV,vUv).rgb;

  // every layer's feed rate is bent by where the other layers currently are.
  vec3 Fe = clamp(uF + uCoup * (v - vec3(uPivot)), 0.0, 0.14);

  vec3 r  = u*v*v;
  vec3 nu = u + (uDu*lap(uU,vUv) - r + Fe*(1.0-u))*uDt;
  vec3 nv = v + (uDv*lap(uV,vUv) + r - (Fe+uK)*v)*uDt;
  oU = vec4(clamp(nu,0.0,1.0),1.0);
  oV = vec4(clamp(nv,0.0,1.0),1.0);
}`;

/* --- seed: three lobes of reagent V on one shared lattice --------------- */
const FS_SEED = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uLobe[3];
uniform float uSpread, uBlobs, uRad, uNoise, uSeed;
layout(location=0) out vec4 oU;
layout(location=1) out vec4 oV;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec3 v = vec3(0.0);
  for(int L=0;L<3;L++){
    for(int b=0;b<24;b++){
      if(float(b) >= uBlobs) break;
      vec2 j = vec2(h21(vec2(float(b)*1.7, float(L)*7.3 + uSeed)),
                    h21(vec2(float(b)*3.1 + uSeed, float(L)*11.9)));
      vec2 c = uLobe[L] + (j-0.5)*uSpread*2.0;
      vec2 d = vUv - c; d -= round(d);            // toroidal domain
      float f = smoothstep(uRad, uRad*0.3, length(d));
      v[L] = max(v[L], f);
    }
  }
  v += uNoise * (vec3(h21(vUv*911.0+uSeed), h21(vUv*677.0+uSeed*3.0),
                      h21(vUv*431.0+uSeed*7.0)) - 0.5);
  v = clamp(v,0.0,1.0);
  oU = vec4(clamp(1.0 - v*0.55, 0.0, 1.0), 1.0);
  oV = vec4(v, 1.0);
}`;

/* --- reduce the whole V field to one pixel: the reflexive read-back ----- */
const FS_REDUCE = `#version 300 es
precision highp float;
uniform sampler2D uV; uniform int uN;
out vec4 o;
void main(){
  vec3 s = vec3(0.0); const int S = 32;
  for(int y=0;y<S;y++) for(int x=0;x<S;x++){
    ivec2 p = ivec2(int(float(x)/float(S)*float(uN)), int(float(y)/float(S)*float(uN)));
    s += texelFetch(uV,p,0).rgb;
  }
  o = vec4(s/float(S*S),1.0);
}`;

/* --- ground: flat colour + screen-space field underlay + grain ---------- */
const FS_GROUND = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uV;
uniform vec3 uBG, uCol0, uCol1, uCol2;
uniform float uUnder, uUnderScale, uGrain, uVig, uTime, uAspect;
out vec4 o;
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 p = (vUv - 0.5);
  vec2 q = p * vec2(uAspect,1.0) / uUnderScale + 0.5;
  vec3 v = texture(uV, fract(q)).rgb;
  vec3 c = uBG;
  c -= (uCol0*v.r + uCol1*v.g + uCol2*v.b) * uUnder;
  c += (h21(vUv*vec2(1913.0,2287.0) + fract(uTime))-0.5) * uGrain;
  float r = length(p*vec2(uAspect,1.0)) * 1.25;
  c *= 1.0 - uVig*smoothstep(0.45,1.15,r);
  o = vec4(clamp(c,0.0,1.0),1.0);
}`;

/* --- the cloud: one instanced draw for the whole archive ---------------- */
const VS_CLOUD = `#version 300 es
precision highp float;
in vec2 aCorner;      // -0.5 .. 0.5
in vec4 aRect;        // atlas u0,v0,du,dv
in vec3 aLocal;       // within-chamber offset, precomputed on the CPU
in vec3 aAff;         // affinity to self / other / fiction
in vec2 aCell;        // home cell on the shared lattice, 0..1
in vec4 aRnd;         // per-plate randoms
in float aAR;         // aspect ratio
in float aEcho;       // 0 = the plate itself; >0 = a repetition of it
in float aAtlas;      // 0 = founding archive, 1 = given since

uniform sampler2D uV;
uniform mat4 uVP;
uniform vec3 uRight, uUp;
uniform vec3 uC0, uC1, uC2;
uniform float uGrid, uSharp, uCapture;
uniform float uRadius, uFalloff, uOutIdle, uInAct, uActGain;
uniform float uRelief, uShear, uSwirl, uFlatten;
uniform float uScaleMin, uScaleMax, uScaleGamma, uSizeVary, uSpin;
uniform float uAlphaBase, uAlphaAct, uTime, uDrift, uJitter;
uniform float uEchoShrink, uEchoFade;
uniform float uHighlight;

out vec2 vT; out vec2 vC; out float vA; out vec3 vAff; out float vDepth;
flat out float vId; flat out float vAtlas;

vec3 sampV(vec2 p){
  int N = int(uGrid);
  ivec2 i = ivec2(floor(p*uGrid));
  i = ((i % N) + N) % N;
  return texelFetch(uV, i, 0).rgb;
}

void main(){
  vec3 v = sampV(aCell);

  // ---- belonging -------------------------------------------------------
  // start from the plate's own affinity, sharpened; then let whichever
  // reagent is loudest at this cell pull it toward that chamber.
  vec3 w = pow(max(aAff, 1e-4), vec3(uSharp));
  w += uCapture * v * v;
  w /= max(w.x + w.y + w.z, 1e-5);
  vAff = w;

  vec3 centre = uC0*w.x + uC1*w.y + uC2*w.z;

  // ---- activation ------------------------------------------------------
  float act = clamp(dot(w, v) * uActGain, 0.0, 1.0);

  // ---- radial placement: power law -> dense core, long sparse tail -----
  float rl  = length(aLocal) + 1e-4;
  vec3  dir = aLocal / rl;
  float r   = pow(rl, uFalloff) * uRadius * mix(uOutIdle, uInAct, act);
  vec3  pos = centre + dir * r;

  // ---- shear and swirl give the cloud its comma silhouette -------------
  float sw = uSwirl * rl;
  float cs = cos(sw), sn = sin(sw);
  vec3 rel = pos - centre;
  rel = vec3(rel.x*cs - rel.z*sn, rel.y, rel.x*sn + rel.z*cs);
  rel.x += uShear * rel.y * (0.4 + rl);
  rel.y *= (1.0 - uFlatten);
  pos = centre + rel;

  // ---- relief from the field gradient ----------------------------------
  float e = 1.0/uGrid;
  vec3 gx = sampV(aCell+vec2(e,0.0)) - sampV(aCell-vec2(e,0.0));
  vec3 gy = sampV(aCell+vec2(0.0,e)) - sampV(aCell-vec2(0.0,e));
  pos += vec3(dot(gx,w), dot(v,w)-0.22, dot(gy,w)) * uRelief;

  // ---- idle drift -------------------------------------------------------
  float t = uTime*uDrift*6.2831853;
  pos += vec3(sin(t+aRnd.x*6.2831853), sin(t*0.83+aRnd.y*6.2831853),
              sin(t*1.17+aRnd.z*6.2831853)) * uJitter;

  // ---- size, opacity ----------------------------------------------------
  float s = mix(uScaleMin, uScaleMax, pow(act, uScaleGamma));
  s *= 1.0 + uSizeVary*(aRnd.w-0.5);
  s *= mix(1.0, uEchoShrink, aEcho);
  s *= 1.0 + uHighlight*0.25;

  float sp = uSpin*(aRnd.x-0.5)*6.2831853;
  float rc = cos(sp), rs = sin(sp);
  vec2  cr = vec2(aCorner.x*rc - aCorner.y*rs, aCorner.x*rs + aCorner.y*rc);

  vec3 world = pos + uRight*(cr.x*s*aAR) + uUp*(cr.y*s);

  vT = aRect.xy + vec2(aCorner.x+0.5, 0.5-aCorner.y) * aRect.zw;
  vC = aCorner;
  vA = clamp(uAlphaBase + uAlphaAct*act, 0.0, 1.0) * mix(1.0, 1.0-uEchoFade*0.6, aEcho);
  vId = float(gl_InstanceID);
  vAtlas = aAtlas;

  gl_Position = uVP * vec4(world,1.0);
  vDepth = gl_Position.w;
}`;

const FS_CLOUD = `#version 300 es
precision highp float;
in vec2 vT; in vec2 vC; in float vA; in vec3 vAff; in float vDepth;
flat in float vId; flat in float vAtlas;
uniform sampler2D uTex;    // the founding archive
uniform sampler2D uTex2;   // everything given since
uniform vec3 uBG, uPlate, uCol0, uCol1, uCol2;
uniform float uTint, uDesat, uContrast, uBright, uBorder;
uniform float uFogNear, uFogFar, uFogAmt, uFogCut, uCrisp;
uniform float uIdPass, uHoverId;
out vec4 o;

// nested 2x2 -> 4x4 ordered dither, so plates can fade without sorting
float b2(vec2 a){ a = floor(a); return fract(a.x*0.5 + a.y*a.y*0.75); }
float b4(vec2 a){ return b2(a*0.5)*0.25 + b2(a); }

void main(){
  if(uIdPass > 0.5){
    float id = vId + 1.0;
    o = vec4(mod(id,256.0)/255.0, floor(id/256.0)/255.0, 0.0, 1.0);
    return;
  }
  vec3 c = vAtlas < 0.5 ? texture(uTex, vT).rgb : texture(uTex2, vT).rgb;
  c = (c - 0.5)*uContrast + 0.5;
  c *= uBright;
  float g = dot(c, vec3(0.2126,0.7152,0.0722));
  c = mix(c, vec3(g), uDesat);
  vec3 lay = uCol0*vAff.x + uCol1*vAff.y + uCol2*vAff.z;
  c = mix(c, c*lay*1.7, uTint);

  // scanned plates sit on paper
  float edge = max(abs(vC.x), abs(vC.y))*2.0;
  if(edge > 1.0 - uBorder) c = uPlate;
  if(abs(vId - uHoverId) < 0.5 && edge > 1.0 - uBorder) c = vec3(0.1);

  float fog = clamp((vDepth-uFogNear)/max(uFogFar-uFogNear,1e-3), 0.0, 1.0);
  c = mix(c, uBG, fog*uFogAmt);

  float a = vA * (1.0 - fog*uFogCut);
  // sharpen the alpha ramp so plates read as solid paper and only the far
  // fringe breaks up into dither, instead of everything looking half-toned
  a = clamp((a - 0.5) * (1.0 + uCrisp*14.0) + 0.5, 0.0, 1.0);
  if(a < b4(gl_FragCoord.xy)*0.99 + 0.005) discard;
  o = vec4(clamp(c,0.0,1.0), 1.0);
}`;

/* ==========================================================================
   4.  GL setup
   ========================================================================== */

const canvas = document.getElementById('gl');
const boot = document.getElementById('boot');
const stage = document.getElementById('stage');
const gl = canvas.getContext('webgl2', {
  antialias: true, preserveDrawingBuffer: true, alpha: false,
});

function fail(msg) {
  boot.className = 'boot err';
  boot.innerHTML = msg;
  throw new Error(msg.replace(/<[^>]*>/g, ''));
}
if (!gl) fail('This piece needs <b>WebGL2</b>. Chrome, Edge, Firefox and Safari 15+ all have it — check that hardware acceleration is on.');
const EXT = gl.getExtension('EXT_color_buffer_float');
if (!EXT) fail('This piece needs the <b>EXT_color_buffer_float</b> extension for the reaction–diffusion lattice. Your browser has WebGL2 but not float render targets.');

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s), src);
    fail('Shader failed to compile — see the console.');
  }
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    fail('Shader program failed to link — see the console.');
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
    u[nm] = gl.getUniformLocation(p, nm);
  }
  return { p, u };
}

const progStep = program(VS_QUAD, FS_STEP);
const progSeed = program(VS_QUAD, FS_SEED);
const progReduce = program(VS_QUAD, FS_REDUCE);
const progGround = program(VS_QUAD, FS_GROUND);
const progCloud = program(VS_CLOUD, FS_CLOUD);

const quadVAO = gl.createVertexArray();
function drawQuad() { gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }

function makeTex(n, internal, fmt, type, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, n, n, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
}
let N = 192, sim = null;
function buildSim(n) {
  if (sim) { sim.fb.forEach(f => gl.deleteFramebuffer(f)); sim.tex.flat().forEach(t => gl.deleteTexture(t)); }
  N = n;
  const tex = [[makeTex(n, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST),
                makeTex(n, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST)],
               [makeTex(n, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST),
                makeTex(n, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST)]];
  const fb = [0, 1].map(i => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i][0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex[i][1], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      fail('Could not allocate a float framebuffer for the lattice.');
    }
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  sim = { tex, fb, cur: 0 };
  seedField();
}

const redFB = gl.createFramebuffer();
const redTex = makeTex(1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
gl.bindFramebuffer(gl.FRAMEBUFFER, redFB);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, redTex, 0);
gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const redPix = new Float32Array(4);
let meanV = [0.1, 0.1, 0.1];

let idFB = null, idTex = null, idW = 0, idH = 0;
function buildPick(w, h) {
  if (idFB) { gl.deleteFramebuffer(idFB); gl.deleteTexture(idTex); }
  idW = Math.max(1, w | 0); idH = Math.max(1, h | 0);
  idTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, idTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, idW, idH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const db = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, db);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, idW, idH);
  idFB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, idFB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, idTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ==========================================================================
   5.  THE CONTRIBUTION ATLAS
   --------------------------------------------------------------------------
   The founding archive is one baked JPEG. Everything given since is packed
   into a second texture here in the browser, 256 px to a cell, and re-uploaded
   whenever it grows. It doubles when it fills — 16 slots, then 64, then 256 —
   and 4096 px is the ceiling because that is what the weakest GPU worth
   supporting will hold. Past that the archive wants baking into the founding
   atlas with build/absorb.py, which is the point at which a contribution stops
   being a guest.
   ========================================================================== */

const CELL = 256, ATLAS_MAX = 4096;

const givenAtlas = {
  imgs: [], rects: [], side: 0, cols: 0, drawn: 0,
  cv: document.createElement('canvas'), ctx: null, tex: null, dirty: false,

  capacity() { const c = ATLAS_MAX / CELL; return c * c; },

  // take a picture; -1 means the sheet is full and the archive wants baking
  add(img) {
    if (this.imgs.length >= this.capacity()) return -1;
    this.imgs.push(img);
    return this.imgs.length - 1;
  },

  // Doubling the sheet changes how many cells fit on a row, which moves every
  // slot that was already placed. So the layout is recomputed from the list
  // rather than patched, and the rects are re-read by whoever holds them.
  layout() {
    const n = this.imgs.length;
    if (!n) return;
    let side = 1024;
    while ((side / CELL) * (side / CELL) < n && side < ATLAS_MAX) side *= 2;
    if (side !== this.side) {
      this.cv.width = this.cv.height = side;
      this.ctx = this.cv.getContext('2d');
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, side, side);
      this.side = side; this.cols = side / CELL;
      this.drawn = 0; this.rects = [];
    }
    for (let i = this.drawn; i < n; i++) this.rects[i] = this.draw(i);
    if (n > this.drawn) { this.drawn = n; this.dirty = true; }
  },

  draw(slot) {
    const img = this.imgs[slot];
    const cx = (slot % this.cols) * CELL, cy = Math.floor(slot / this.cols) * CELL;
    const s = Math.min(CELL / img.width, CELL / img.height);
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    const ox = (CELL - w) >> 1, oy = (CELL - h) >> 1;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(cx, cy, CELL, CELL);
    this.ctx.drawImage(img, cx + ox, cy + oy, w, h);
    return {
      uv: [(cx + ox) / this.side, (cy + oy) / this.side, w / this.side, h / this.side],
      ar: w / h,
    };
  },

  upload() {
    if (!this.dirty || !this.side) return;
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 3);
    this.dirty = false;
  },
};

/* ==========================================================================
   6.  DATA + LAYOUT
   ========================================================================== */

let FOUNDING = null;           // assets/founding.json — criteria, not pictures
let ITEMS = [];                // everything the archive has been given, in order
let COUNT = 0, blankTex = null;
let cloudVAO = null, instBuf = null, instArr = null;
const STRIDE = 19;   // aRect4 aLocal3 aAff3 aCell2 aRnd4 aAR aEcho aAtlas
let CHAMBER = [];
const seenIds = new Set();
let newestAt = null;

const LOBES = () => {
  const s = P.lobeSpread, t = P.chamberTwist * Math.PI / 180;
  return [0, 1, 2].map(i => {
    const a = t + Math.PI / 2 + i * 2 * Math.PI / 3;
    return [0.5 + Math.cos(a) * s, 0.5 + Math.sin(a) * s];
  });
};
const CENTRES = () => {
  const s = P.chamberSpread, t = P.chamberTwist * Math.PI / 180;
  return [0, 1, 2].map(i => {
    const a = t + Math.PI / 2 + i * 2 * Math.PI / 3;
    return [Math.cos(a) * s, (i - 1) * P.chamberLift, Math.sin(a) * s];
  });
};

function buildInstances() {
  if (!ITEMS.length) { COUNT = 0; CHAMBER = []; updateTally(); return; }
  const items = ITEMS;

  // per-kind centroid in perceptual space, for "cluster by object type".
  // A contribution inherits the kind of the plate it most resembles, so it
  // joins an existing type rather than forming a colony of newcomers.
  const kindSum = {}, kindN = {};
  for (const it of items) {
    const k = it.kind;
    if (!kindSum[k]) { kindSum[k] = [0, 0, 0]; kindN[k] = 0; }
    for (let d = 0; d < 3; d++) kindSum[k][d] += it.p3[d];
    kindN[k]++;
  }
  const kindC = {};
  for (const k in kindSum) kindC[k] = kindSum[k].map(v => v / kindN[k]);
  const kinds = Object.keys(kindC).sort();
  kinds.forEach((k, i) => {
    const a = i / kinds.length * Math.PI * 2;
    const el = (i % 3 - 1) * 0.5;
    kindC[k] = [kindC[k][0] * 0.4 + Math.cos(a) * 0.9,
                kindC[k][1] * 0.4 + el,
                kindC[k][2] * 0.4 + Math.sin(a) * 0.9];
  });

  // an echo chamber is the same image said again. Each plate is instanced E
  // times: copy 0 is the plate, copies 1..E-1 are its echoes — scattered a
  // little further out, pinned to slightly different lattice cells, smaller
  // and fainter. This is what gives the cloud its density and its long tail.
  const E = Math.max(1, P.echoes | 0);
  COUNT = items.length * E;

  instArr = new Float32Array(COUNT * STRIDE);
  const S = P.layoutSeed;
  const lobes = LOBES();
  CHAMBER = items.map(it => it.aff.indexOf(Math.max(...it.aff)));

  for (let i = 0; i < items.length; i++) {
    const it = items[i], aff = it.aff, li = CHAMBER[i];

    const kc = kindC[it.kind];
    const t = P.kindPull;
    const bx = it.p3[0] * (1 - t) + kc[0] * t;
    const by = it.p3[1] * (1 - t) + kc[1] * t;
    const bz = it.p3[2] * (1 - t) + kc[2] * t;

    for (let e = 0; e < E; e++) {
      const k = i * E + e, o = k * STRIDE;
      const ech = E > 1 ? e / (E - 1) : 0;
      const sc = P.scatter + ech * P.echoSpread;

      let lx = bx + (hash(k, S + 1) - 0.5) * sc;
      let ly = by + (hash(k, S + 2) - 0.5) * sc;
      let lz = bz + (hash(k, S + 3) - 0.5) * sc;
      const m = Math.hypot(lx, ly, lz) || 1;
      const rr = Math.min(1.25, (0.18 + 0.82 * Math.min(1, m / 1.5)) * (1 + ech * 0.55));
      lx = lx / m * rr; ly = ly / m * rr; lz = lz / m * rr;

      const du = (hash(k, S + 5) - 0.5) * 2 * P.echoCell * ech;
      const dv = (hash(k, S + 7) - 0.5) * 2 * P.echoCell * ech;
      const cu = lobes[li][0] + (it.p2[0] - 0.5) * 2 * P.lobeRadius + du;
      const cv = lobes[li][1] + (it.p2[1] - 0.5) * 2 * P.lobeRadius + dv;

      instArr[o + 0] = it.uv[0]; instArr[o + 1] = it.uv[1];
      instArr[o + 2] = it.uv[2]; instArr[o + 3] = it.uv[3];
      instArr[o + 4] = lx; instArr[o + 5] = ly; instArr[o + 6] = lz;
      instArr[o + 7] = aff[0]; instArr[o + 8] = aff[1]; instArr[o + 9] = aff[2];
      instArr[o + 10] = (cu % 1 + 1) % 1; instArr[o + 11] = (cv % 1 + 1) % 1;
      instArr[o + 12] = hash(k, S + 11); instArr[o + 13] = hash(k, S + 23);
      instArr[o + 14] = hash(k, S + 37); instArr[o + 15] = hash(k, S + 53);
      instArr[o + 16] = it.ar;
      instArr[o + 17] = ech;
      instArr[o + 18] = it.given ? 1 : 0;
    }
  }

  if (!cloudVAO) {
    cloudVAO = gl.createVertexArray();
    gl.bindVertexArray(cloudVAO);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    const lc = gl.getAttribLocation(progCloud.p, 'aCorner');
    gl.enableVertexAttribArray(lc);
    gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 0, 0);

    instBuf = gl.createBuffer();
    const defs = [['aRect', 4, 0], ['aLocal', 3, 4], ['aAff', 3, 7], ['aCell', 2, 10],
                  ['aRnd', 4, 12], ['aAR', 1, 16], ['aEcho', 1, 17], ['aAtlas', 1, 18]];
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    for (const [nm, size, off] of defs) {
      const l = gl.getAttribLocation(progCloud.p, nm);
      if (l < 0) continue;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(l, 1);
    }
    gl.bindVertexArray(null);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instArr, gl.DYNAMIC_DRAW);

  updateTally();
}

/* the only reading the piece offers unasked: three numbers under the title */
function updateTally() {
  const c = [0, 0, 0];
  CHAMBER.forEach(x => c[x]++);
  const cols = [P.colSelf, P.colOther, P.colColl];
  document.getElementById('count').innerHTML = c.map((n, i) =>
    `<i><s style="background:${cols[i]}"></s><b>${n}</b></i>`).join('');
}

/* ==========================================================================
   7.  SIMULATION
   ========================================================================== */

function seedField() {
  const lob = LOBES();
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(progSeed.p);
  gl.uniform2fv(progSeed.u.uLobe, new Float32Array(lob.flat()));
  gl.uniform1f(progSeed.u.uSpread, P.seedSpread);
  gl.uniform1f(progSeed.u.uBlobs, P.seedBlobs);
  gl.uniform1f(progSeed.u.uRad, P.seedRadius);
  gl.uniform1f(progSeed.u.uNoise, P.seedNoise);
  gl.uniform1f(progSeed.u.uSeed, P.seedIdx);
  for (const i of [0, 1]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.fb[i]);
    gl.viewport(0, 0, N, N);
    drawQuad();
  }
  sim.cur = 0;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // run the reaction forward before anyone looks at it, so the piece opens on
  // a developed field instead of three bare blobs
  const w = P.warmup | 0;
  for (let done = 0; done < w; done += 200) stepSim(Math.min(200, w - done));
  reduceMean();
}

function couplingMatrix() {
  const g = P.entangle;
  // reflexive: the fiction's outward push scales with how much of it exists
  const boost = 1 + P.fiction * Math.max(0, meanV[2] - P.fictionFloor);
  const d = P.selfLoop;
  const M = [
    [d, P.s2o, P.s2c],
    [P.o2s, d, P.o2c],
    [P.c2s * boost, P.c2o * boost, d],
  ];
  const out = new Float32Array(9);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out[j * 3 + i] = M[j][i] * g;
  return out;
}

function stepSim(n) {
  if (!n) return;
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(progStep.p);
  gl.uniform2f(progStep.u.uTexel, 1 / N, 1 / N);
  gl.uniform3f(progStep.u.uF, P.fSelf, P.fOther, P.fColl);
  gl.uniform3f(progStep.u.uK, P.kSelf, P.kOther, P.kColl);
  gl.uniform1f(progStep.u.uDu, P.Du);
  gl.uniform1f(progStep.u.uDv, P.Dv);
  gl.uniform1f(progStep.u.uDt, P.dt);
  gl.uniform1f(progStep.u.uPivot, P.pivot);
  gl.uniformMatrix3fv(progStep.u.uCoup, false, couplingMatrix());
  gl.uniform1i(progStep.u.uU, 0);
  gl.uniform1i(progStep.u.uV, 1);
  gl.viewport(0, 0, N, N);
  for (let s = 0; s < n; s++) {
    const src = sim.cur, dst = 1 - src;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.tex[src][0]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.tex[src][1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.fb[dst]);
    drawQuad();
    sim.cur = dst;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

let reduceOK = true;
function reduceMean() {
  if (!reduceOK) return;
  gl.useProgram(progReduce.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sim.tex[sim.cur][1]);
  gl.uniform1i(progReduce.u.uV, 0);
  gl.uniform1i(progReduce.u.uN, N);
  gl.bindFramebuffer(gl.FRAMEBUFFER, redFB);
  gl.viewport(0, 0, 1, 1);
  drawQuad();
  try {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, redPix);
    meanV = [redPix[0], redPix[1], redPix[2]];
  } catch (e) { reduceOK = false; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* a contribution arriving stamps reagent into the chamber that took it —
   the field notices the gift rather than the gift merely appearing in it */
function stir(layer) {
  const lob = LOBES();
  const keep = sim.cur;
  gl.useProgram(progSeed.p);
  // seed all three lobes but push the arriving layer's blob furthest out by
  // reusing the seed index, then blend additively so nothing is wiped
  gl.uniform2fv(progSeed.u.uLobe, new Float32Array(lob.flat()));
  gl.uniform1f(progSeed.u.uSpread, P.seedSpread * 1.3);
  gl.uniform1f(progSeed.u.uBlobs, 2);
  gl.uniform1f(progSeed.u.uRad, P.seedRadius * 0.5);
  gl.uniform1f(progSeed.u.uNoise, 0);
  gl.uniform1f(progSeed.u.uSeed, (P.seedIdx + 13 + layer * 7) % 1000);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.fb[keep]);
  gl.viewport(0, 0, N, N);
  drawQuad();
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/* ==========================================================================
   8.  CAMERA
   ========================================================================== */

const cam = { theta: -0.55, phi: 0.30, panX: 0, panY: 0 };
let drag = null;
let mouse = { x: -1, y: -1, over: false };

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.over = true;
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.shift || e.shiftKey) {
    cam.panX -= dx * 0.004 * P.dist * 0.3;
    cam.panY += dy * 0.004 * P.dist * 0.3;
  } else {
    cam.theta -= dx * 0.006;
    cam.phi = clamp(cam.phi + dy * 0.006, -1.45, 1.45);
  }
});
canvas.addEventListener('pointerleave', () => { mouse.over = false; hoverId = -1; tipEl.className = 'tip'; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  P.dist = clamp(P.dist * Math.exp(e.deltaY * 0.0011), 1.2, 24);
}, { passive: false });

const tipEl = document.getElementById('tip');
let hoverId = -1;

/* ==========================================================================
   9.  RENDER
   ========================================================================== */

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2) * P.quality;
  const r = stage.getBoundingClientRect();
  const w = Math.max(2, Math.round(r.width * DPR)), h = Math.max(2, Math.round(r.height * DPR));
  if (w === W && h === H) return;
  W = w; H = h; canvas.width = w; canvas.height = h;
  buildPick(Math.max(2, w >> 1), Math.max(2, h >> 1));
}
window.addEventListener('resize', resize);

const mProj = new Float32Array(16), mView = new Float32Array(16), mVP = new Float32Array(16);
let camRight = [1, 0, 0], camUp = [0, 1, 0];

function setCamera(aspect) {
  const d = P.dist, th = cam.theta, ph = cam.phi;
  const eye = [Math.cos(ph) * Math.sin(th) * d, Math.sin(ph) * d, Math.cos(ph) * Math.cos(th) * d];
  const ctr = [cam.panX, cam.panY, 0];
  eye[0] += cam.panX; eye[1] += cam.panY;
  mat4Perspective(mProj, P.fov * Math.PI / 180, aspect, 0.05, 200);
  mat4LookAt(mView, eye, ctr, [0, 1, 0]);
  mat4Mul(mVP, mProj, mView);
  camRight = [mView[0], mView[4], mView[8]];
  camUp = [mView[1], mView[5], mView[9]];
}

function setCloudUniforms(idPass) {
  const u = progCloud.u, C = CENTRES();
  gl.uniformMatrix4fv(u.uVP, false, mVP);
  gl.uniform3fv(u.uRight, camRight);
  gl.uniform3fv(u.uUp, camUp);
  gl.uniform3fv(u.uC0, C[0]); gl.uniform3fv(u.uC1, C[1]); gl.uniform3fv(u.uC2, C[2]);
  gl.uniform1f(u.uGrid, N);
  gl.uniform1f(u.uSharp, P.sharp);
  gl.uniform1f(u.uCapture, P.capture);
  gl.uniform1f(u.uRadius, P.radius);
  gl.uniform1f(u.uFalloff, P.falloff);
  gl.uniform1f(u.uOutIdle, P.outIdle);
  gl.uniform1f(u.uInAct, P.inAct);
  gl.uniform1f(u.uActGain, P.actGain);
  gl.uniform1f(u.uRelief, P.relief);
  gl.uniform1f(u.uShear, P.shear);
  gl.uniform1f(u.uSwirl, P.swirl);
  gl.uniform1f(u.uFlatten, P.flatten);
  gl.uniform1f(u.uScaleMin, P.scaleMin);
  gl.uniform1f(u.uScaleMax, P.scaleMax);
  gl.uniform1f(u.uScaleGamma, P.scaleGamma);
  gl.uniform1f(u.uSizeVary, P.sizeVary);
  gl.uniform1f(u.uSpin, P.spin);
  gl.uniform1f(u.uAlphaBase, idPass ? 1.0 : P.alphaBase);
  gl.uniform1f(u.uAlphaAct, idPass ? 0.0 : P.alphaAct);
  gl.uniform1f(u.uTime, clock);
  gl.uniform1f(u.uDrift, P.drift);
  gl.uniform1f(u.uJitter, P.jitter);
  gl.uniform1f(u.uEchoShrink, P.echoShrink);
  gl.uniform1f(u.uEchoFade, P.echoFade);
  gl.uniform1f(u.uHighlight, 0);
  gl.uniform3fv(u.uBG, hexRGB(P.bg));
  gl.uniform3fv(u.uPlate, hexRGB(P.plateCol));
  gl.uniform3fv(u.uCol0, hexRGB(P.colSelf));
  gl.uniform3fv(u.uCol1, hexRGB(P.colOther));
  gl.uniform3fv(u.uCol2, hexRGB(P.colColl));
  gl.uniform1f(u.uTint, P.tint);
  gl.uniform1f(u.uDesat, P.desat);
  gl.uniform1f(u.uContrast, P.contrast);
  gl.uniform1f(u.uBright, P.bright);
  gl.uniform1f(u.uBorder, P.border);
  gl.uniform1f(u.uFogNear, P.fogNear);
  gl.uniform1f(u.uFogFar, P.fogFar);
  gl.uniform1f(u.uFogAmt, idPass ? 0 : P.fogAmt);
  gl.uniform1f(u.uFogCut, idPass ? 0 : P.fogCut);
  gl.uniform1f(u.uCrisp, idPass ? 1 : P.crisp);
  gl.uniform1f(u.uIdPass, idPass ? 1 : 0);
  gl.uniform1f(u.uHoverId, hoverId);
  gl.uniform1i(u.uTex, 2);
  gl.uniform1i(u.uTex2, 3);
  gl.uniform1i(u.uV, 1);
}

function drawCloud(idPass) {
  if (!COUNT) return;   // an empty room is a legitimate state of this piece
  gl.useProgram(progCloud.p);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.tex[sim.cur][1]);
  // uTex is the wall that ships with the page, if there is one; uTex2 is
  // everything given since. Either can be absent.
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, baseTex || blankTex);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, givenAtlas.tex || blankTex);
  setCloudUniforms(idPass);
  gl.bindVertexArray(cloudVAO);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, COUNT);
  gl.bindVertexArray(null);
}

const pickPix = new Uint8Array(4);
const LAYER_NAMES = ['self', 'other', 'fiction'];
function pick() {
  if (!mouse.over || drag) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, idFB);
  gl.viewport(0, 0, idW, idH);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.clearColor(0, 0, 0, 1); gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawCloud(true);
  const px = clamp(Math.round(mouse.x * DPR / 2), 0, idW - 1);
  const py = clamp(idH - 1 - Math.round(mouse.y * DPR / 2), 0, idH - 1);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickPix);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const id = pickPix[0] + pickPix[1] * 256 - 1;
  hoverId = id;
  if (id >= 0 && id < COUNT) {
    const src = Math.floor(id / Math.max(1, P.echoes | 0));
    const it = ITEMS[src];
    if (!it) { tipEl.className = 'tip'; return; }
    tipEl.textContent = (it.given ? 'given · ' : '') + LAYER_NAMES[CHAMBER[src]];
    tipEl.style.left = mouse.x + 'px';
    tipEl.style.top = mouse.y + 'px';
    tipEl.className = 'tip on';
  } else {
    tipEl.className = 'tip';
  }
}

let clock = 0, last = performance.now() / 1000, playing = true;
let frame = 0;

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now() / 1000;
  const dt = Math.min(now - last, 0.1); last = now;

  resize();
  givenAtlas.upload();
  if (playing) {
    clock += dt;
    stepSim(P.steps);
    cam.theta += P.orbit * dt;
    cam.phi = clamp(cam.phi + Math.sin(clock * 0.21) * P.bob * dt * 0.6, -1.45, 1.45);
  }
  if (frame % 10 === 0) reduceMean();

  setCamera(W / H);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.useProgram(progGround.p);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim.tex[sim.cur][1]);
  gl.uniform1i(progGround.u.uV, 1);
  gl.uniform3fv(progGround.u.uBG, hexRGB(P.bg));
  gl.uniform3fv(progGround.u.uCol0, hexRGB(P.colSelf));
  gl.uniform3fv(progGround.u.uCol1, hexRGB(P.colOther));
  gl.uniform3fv(progGround.u.uCol2, hexRGB(P.colColl));
  // ../cloud/ sets the underlay at 0.085, which is right when a thousand
  // plates are carrying the eye and the field only has to be felt underneath
  // them. An empty commons has no plates, and at 0.085 it is a blank page. So
  // the field is brought up in proportion to how empty the room is and hands
  // the composition back as it fills: by two dozen plates it is at the cloud's
  // value exactly, and from there on this piece and that one match.
  const bare = 1 - Math.min(1, ITEMS.length / 24);
  gl.uniform1f(progGround.u.uUnder, P.underlay * (1 + 2.6 * bare));
  gl.uniform1f(progGround.u.uUnderScale, P.underScale);
  gl.uniform1f(progGround.u.uGrain, P.grain);
  gl.uniform1f(progGround.u.uVig, P.vignette);
  gl.uniform1f(progGround.u.uTime, clock);
  gl.uniform1f(progGround.u.uAspect, W / H);
  drawQuad();

  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
  drawCloud(false);

  if (frame % 2 === 0) pick();
  frame++;
}

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { playing = !playing; e.preventDefault(); }
});

/* ==========================================================================
   10.  THE WAY IN
   ========================================================================== */

const ui = {
  btn: document.getElementById('wayBtn'),
  sheet: document.getElementById('sheet'),
  code: document.getElementById('code'),
  file: document.getElementById('file'),
  drop: document.getElementById('drop'),
  say: document.getElementById('say'),
  send: document.getElementById('sendBtn'),
  close: document.getElementById('closeBtn'),
};
let pending = null;   // {img, name}

function say(html, bad) {
  ui.say.innerHTML = html;
  ui.say.className = bad ? 'say bad' : 'say';
}
function openSheet(open) {
  ui.sheet.hidden = !open;
  ui.btn.classList.toggle('open', open);
  ui.btn.setAttribute('aria-expanded', String(open));
  if (open && !Store.on) {
    say('This copy has no archive behind it — <b>config.js</b> is empty, so ' +
      'nothing can be kept. The field still runs.', true);
  }
}
ui.btn.addEventListener('click', () => openSheet(ui.sheet.hidden));
ui.close.addEventListener('click', () => openSheet(false));

// remember the invitation, not the picture
try {
  const c = localStorage.getItem('commons.code');
  if (c) ui.code.value = c;
} catch (e) { /* storage off */ }

function takeFile(f) {
  if (!f) return;
  if (!/^image\//.test(f.type)) { say('That is not an image.', true); return; }
  if (f.size > 24 * 1024 * 1024) { say('That file is very large — under 24 MB, please.', true); return; }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    pending = { img, name: f.name };
    ui.drop.className = 'drop has';
    ui.drop.innerHTML = '';
    const p = new Image(); p.src = url;
    ui.drop.appendChild(p);
    ui.drop.appendChild(document.createTextNode(f.name));
    ui.send.disabled = false;
    say('The archive reads it, decides where it belongs, and keeps it.');
  };
  img.onerror = () => say('That image would not decode.', true);
  img.src = url;
}

ui.file.addEventListener('change', e => takeFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(k => stage.addEventListener(k, e => {
  e.preventDefault(); stage.classList.add('dropping');
}));
['dragleave', 'drop'].forEach(k => stage.addEventListener(k, e => {
  e.preventDefault(); stage.classList.remove('dropping');
}));
stage.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  openSheet(true);
  takeFile(f);
});

/* the picture as the archive will hold it: 256 px, the same as a cell */
function thumbOf(img) {
  const s = Math.min(CELL / img.width, CELL / img.height, 1);
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
  cx.drawImage(img, 0, 0, w, h);
  return { cv, dataURL: cv.toDataURL('image/jpeg', 0.72) };
}

const chamberSpan = aff => {
  const l = aff.indexOf(Math.max(...aff));
  const cls = ['self', 'other', 'coll'][l];
  return `<b class="${cls}">${LAYER_NAMES[l]}</b>`;
};

ui.send.addEventListener('click', async () => {
  if (!pending) return;
  const code = ui.code.value.trim();
  if (!code) { say('The archive is invitation-only. A code, please.', true); return; }
  if (!Store.on) { say('No archive is configured behind this page.', true); return; }

  ui.send.disabled = true;
  say('measuring…');

  try {
    const { cv, dataURL } = thumbOf(pending.img);
    const { feat, rgb } = Sift.read(cv, 0, 0, cv.width, cv.height);
    const z = Sift.zscore(feat);
    const { aff, neighbours } = Sift.knn(z);
    const kind = FOUNDING.kind[neighbours[0]] || 'unsorted';

    say('offering it…');
    const id = await Store.submit(code, {
      thumb: dataURL,
      ar: cv.width / cv.height,
      feat: Array.from(feat, x => +x.toFixed(5)),
      aff: aff.map(x => +x.toFixed(4)),
      rgb: rgb.map(x => +x.toFixed(4)),
      method: 'resemblance',
      title: kind,
    });

    try { localStorage.setItem('commons.code', code); } catch (e) { /* fine */ }

    const row = {
      id, ar: cv.width / cv.height, aff, feat, rgb, method: 'resemblance',
      title: kind, created_at: new Date().toISOString(),
    };
    await absorb([row], { stir: true });

    say(`Seven plates it resembles voted. It went to ${chamberSpan(aff)}. ` +
      `Reading it properly now — that can move it.`);

    // second opinion, after the fact. It is allowed to fail.
    refine(code, id, cv).catch(() => { });
  } catch (err) {
    say(String(err.message || err), true);
    ui.send.disabled = false;
  }
});

async function refine(code, id, cv) {
  let read;
  try {
    read = await Sift.clipAffinity(cv, m => say('reading — ' + m));
  } catch (e) {
    say('It is in, placed by resemblance. The reader could not be fetched, ' +
      'which is a network away, not a fault of the picture.');
    return;
  }
  const aff = read.aff;
  await Store.refine(code, id, aff.map(x => +x.toFixed(4)), 'read',
    read.raw.map(x => +x.toFixed(6)));
  const it = ITEMS.find(x => x.id === id);
  if (it) { it.aff = aff; it.method = 'read'; buildInstances(); }
  say(`Read, not only recognised. It belongs to ${chamberSpan(aff)}.`);
}

/* ==========================================================================
   11.  ABSORBING WHAT THE ARCHIVE IS GIVEN
   ========================================================================== */

function decode(dataURL) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('thumb would not decode'));
    i.src = dataURL;
  });
}

/* rows -> plates. Everything a contribution needs beyond what is stored is
   derived here: where it sits inside its chamber, which cell of the lattice
   is its home, and which atlas slot holds its pixels. */
async function absorb(rows, opts) {
  opts = opts || {};
  let added = 0;
  for (const r of rows) {
    if (!r || seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    let img;
    try { img = await decode(r.thumb); } catch (e) { continue; }
    const slot = givenAtlas.add(img);
    if (slot < 0) {
      // the sheet is full. The archive has outgrown the browser and wants
      // baking; say nothing on the stage, but leave it in the console.
      console.warn('contribution atlas full at', givenAtlas.capacity(),
        '— time to bake the given plates into the founding atlas');
      break;
    }
    const feat = Float64Array.from(r.feat || []);
    const pl = feat.length === Sift.FEAT_N
      ? Sift.place(Sift.zscore(feat))
      : { p3: [0.2, 0, 0.2], p2: [0.5, 0.5] };
    ITEMS.push({
      id: r.id, given: true, slot, uv: [0, 0, 0, 0], ar: r.ar || 1,
      aff: (r.aff && r.aff.length === 3) ? r.aff.slice() : [0.33, 0.33, 0.34],
      kind: r.title || 'unsorted', p3: pl.p3, p2: pl.p2,
      method: r.method, created_at: r.created_at,
    });
    if (r.created_at && (!newestAt || r.created_at > newestAt)) newestAt = r.created_at;
    added++;
  }
  if (!added) return 0;

  // the sheet may have doubled, which moves everyone; re-read every rect
  givenAtlas.layout();
  for (const it of ITEMS) {
    if (!it.given) continue;
    const rect = givenAtlas.rects[it.slot];
    if (rect) { it.uv = rect.uv; it.ar = rect.ar; }
  }

  P.echoes = echoesFor(ITEMS.length);
  buildInstances();
  if (opts.stir) {
    const last = ITEMS[ITEMS.length - 1];
    stir(last.aff.indexOf(Math.max(...last.aff)));
  }
  return added;
}

/* ==========================================================================
   12.  BOOT
   ========================================================================== */

/* ==========================================================================
   THE FOUNDING ARCHIVE, WHICH IS NOT HERE
   --------------------------------------------------------------------------
   ../cloud/ opens on sixty-nine photographs, each read by a person for whether
   it shows a single body, a social scene, or a shared myth. Those photographs
   are not published with this piece. What is published is what was concluded
   about them: twenty-three measurements each, and the belonging somebody
   assigned. assets/founding.json is fourteen kilobytes of that and no pixels.

   Which leaves the room empty and its criteria intact. There is nothing on the
   stage when this page opens, and the first picture given to it is still sorted
   by an archive of sixty-nine judgements it will never be shown — the ruler
   that decides where you belong, held by a population that has left. That is a
   better statement of the thing than a wall of somebody else's photographs was.

   Put an atlas back and the plates return; nothing else has to change. That
   door is the optional pair below. */
function readFoundingCriteria() {
  Sift.calibrate(FOUNDING.feat.map(f => Float64Array.from(f)), FOUNDING.aff);
  ITEMS = [];
}

/* --------------------------------------------------------- an optional wall
   assets/atlas.jpg + assets/atlas.json, if they are there, are plates that
   ship with the page — the archive you decided to publish, whether that is a
   founding set you chose or contributions baked down by build/absorb.py. Both
   files absent is the normal state of this piece and not an error.

   Note what does *not* move when they appear: founding.json stays the ruler.
   These plates are re-measured here so they can be laid out in the same space,
   but the calibration and the seven voters are the criteria file, so where a
   contribution lands does not quietly shift every time the wall is rebuilt. */
let baseTex = null;

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('could not load ' + src));
    i.src = src;
  });
}

async function loadWall() {
  let man;
  try {
    const r = await fetch('assets/atlas.json');
    if (!r.ok) return false;                 // no wall; the usual case
    man = await r.json();
  } catch (e) { return false; }
  if (!man || !man.items || !man.items.length) return false;

  let img;
  try { img = await loadImage('assets/atlas.jpg'); }
  catch (e) { console.warn('atlas.json without atlas.jpg'); return false; }

  const MAXTEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (Math.max(img.width, img.height) > MAXTEX) {
    console.warn('atlas exceeds MAX_TEXTURE_SIZE', MAXTEX);
    return false;
  }

  baseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  // cap the mip chain: deeper levels would bleed one plate into its neighbour
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 3);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) {
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }

  const wall = [];
  man.items.forEach((it, i) => {
    const [u, v, du, dv] = it.uv;
    const { feat } = Sift.read(img, u * img.width, v * img.height,
      du * img.width, dv * img.height);
    const pl = Sift.place(Sift.zscore(feat));
    const aff = (it.aff && it.aff.length === 3) ? it.aff.slice() : Sift.knn(Sift.zscore(feat)).aff;
    wall.push({
      id: 'wall:' + i, given: false, uv: it.uv, ar: it.ar,
      aff, kind: it.kind || 'unsorted', p3: pl.p3, p2: pl.p2,
    });
  });
  ITEMS = wall.concat(ITEMS);
  return true;
}

async function fillFromArchive() {
  if (!Store.on) return;
  const page = Math.max(1, (window.COMMONS_CONFIG.page | 0) || 24);
  for (let off = 0; ; off += page) {
    let rows;
    try { rows = await Store.page(off, page); }
    catch (e) { console.warn(e); return; }
    if (!rows.length) return;
    await absorb(rows);
    if (rows.length < page) return;
    if (givenAtlas.imgs.length >= givenAtlas.capacity()) return;
    await new Promise(r => setTimeout(r, 0));   // let a frame through
  }
}

function watchArchive() {
  const secs = (window.COMMONS_CONFIG.poll | 0);
  if (!Store.on || secs <= 0) return;
  setInterval(async () => {
    if (document.hidden || !newestAt) return;
    try {
      const rows = await Store.since(newestAt);
      if (rows.length) await absorb(rows, { stir: true });
    } catch (e) { /* the archive can be unreachable without the field stopping */ }
  }, secs * 1000);
}

(async function start() {
  try {
    const r = await fetch('assets/founding.json');
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    FOUNDING = await r.json();
  } catch (e) {
    fail('Could not read <b>assets/founding.json</b>.<br><br>Opening this file straight ' +
      'from disk blocks the fetch. Serve the folder instead — VS Code Live Server, or ' +
      '<code>python3 -m http.server 8000</code> in this directory, then open ' +
      '<code>http://localhost:8000</code>.');
    return;
  }

  // a single white texel, so the samplers are always bound to something even
  // before the first picture has been given
  blankTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blankTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  readFoundingCriteria();
  buildSim(P.gridN | 0);
  await loadWall();
  P.echoes = echoesFor(Math.max(1, ITEMS.length));
  buildInstances();
  resize();
  boot.classList.add('gone');
  loop();

  // the archive proper arrives after the field is already turning
  await fillFromArchive();
  watchArchive();
})();
