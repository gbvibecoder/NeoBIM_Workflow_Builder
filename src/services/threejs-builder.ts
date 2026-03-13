/**
 * Three.js Floor Plan 3D Builder — High-Quality Edition
 *
 * Self-contained HTML with embedded Three.js scene.
 * Rooms use absolute x,y positions (meters from building top-left).
 * Walls are computed from shared edges — not per-room boxes.
 * Features: 512x512 procedural floor textures, plaster walls, door openings,
 * frosted-glass labels with color-coded borders (toggle-able), area watermarks,
 * smooth 800ms camera transitions, click-to-focus, grid helper,
 * furniture with rugs, BuildFlow-themed UI.
 */

import type { FloorPlanGeometry } from "@/types/floor-plan";

export function buildFloorPlan3D(data: FloorPlanGeometry, sourceImage?: string, modelBase?: string): string {
  const jsonData = JSON.stringify(data);
  const totalArea = data.rooms
    .reduce((s, r) => s + (r.area ?? r.width * r.depth), 0)
    .toFixed(1);
  const roomCount = data.rooms.length;
  const dimStr = `${data.footprint.width.toFixed(1)}m \u00d7 ${data.footprint.depth.toFixed(1)}m`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' blob: data:; connect-src * blob: data:; img-src * blob: data:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline'; worker-src * blob:;">
<title>BuildFlow \u2014 3D Floor Plan</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#060610;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E0E0E0}
canvas{display:block}
#tip{position:fixed;background:rgba(8,10,18,.92);border:1px solid rgba(79,138,255,.25);padding:10px 16px;border-radius:10px;font-size:12px;pointer-events:none;display:none;backdrop-filter:blur(12px);z-index:30;max-width:240px;box-shadow:0 4px 20px rgba(0,0,0,.5)}
#tip .tn{color:#6EA0FF;font-weight:600;font-size:13px}#tip .td{color:#A0A0B8;margin-top:3px;line-height:1.4}
</style>
</head>
<body>
<div id="bf-dbg" style="position:fixed;top:4px;left:4px;z-index:9999;background:rgba(79,138,255,0.85);color:#fff;padding:3px 8px;font-size:9px;border-radius:4px;pointer-events:none;font-family:monospace;letter-spacing:.5px">BUILDER v3.1</div>
<div id="tip"><div class="tn" id="tN"></div><div class="td" id="tD"></div></div>
<script>
// Early message queue — captures commands while Three.js CDN loads
var __cmdQueue=[];
var __sceneReady=false;
window.addEventListener("message",function(ev){
  if(!ev.data||!ev.data.type)return;
  if(!__sceneReady){__cmdQueue.push(ev.data);return;}
});
<\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js" onerror="document.title='CDN_FAIL';console.error('[IFRAME] Three.js CDN failed to load')"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/FXAAShader.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/PointerLockControls.js"><\/script>
<script>
"use strict";
var D=${jsonData};
var WH=D.wallHeight||2.8,BW=D.footprint.width,BD=D.footprint.depth;
var isNonRect=D.buildingOutline&&D.buildingOutline.length>=3&&D.buildingShape&&D.buildingShape!=='rectangular';
var IMG_SRC="${sourceImage ?? ''}";
var HAS_IMG=IMG_SRC.length>10;
var HAS_SVG_WALLS=D.walls&&D.walls.length>4;
// Resolve parent origin for same-origin proxy (blob: iframes can't use relative URLs)
var __parentOrigin='';
try{__parentOrigin=window.parent.location.origin}catch(e){}
if(!__parentOrigin||__parentOrigin==='null'){try{__parentOrigin=document.referrer?new URL(document.referrer).origin:''}catch(e){}}
if(!__parentOrigin||__parentOrigin==='null'){__parentOrigin="${modelBase ?? ''}"}
// Use same-origin proxy /r2-models/* → R2 CDN (avoids CORS since R2 GET lacks Access-Control-Allow-Origin)
var MODEL_CDN=__parentOrigin?__parentOrigin+'/r2-models':'https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/models';
var HAS_MODELS=MODEL_CDN.length>10;
console.log('[GLTF] Model CDN: '+MODEL_CDN);
var CX=BW/2,CZ=BD/2,MXD=Math.max(BW,BD);

// ─── Inline OrbitControls ─────────────────────────────────────────────────────
(function(){
var OC=function(cam,el){
this.camera=cam;this.domElement=el;this.target=new THREE.Vector3();
this.enabled=true;this.minDist=1;this.maxDist=200;
var self=this,sph={r:20,phi:Math.PI/3.5,theta:Math.PI/4},state=0,sx=0,sy=0;
function getS(){var o=cam.position.clone().sub(self.target);sph.r=o.length();sph.theta=Math.atan2(o.x,o.z);sph.phi=Math.acos(Math.max(-1,Math.min(1,o.y/sph.r)))}
function apply(){cam.position.set(self.target.x+sph.r*Math.sin(sph.phi)*Math.sin(sph.theta),self.target.y+sph.r*Math.cos(sph.phi),self.target.z+sph.r*Math.sin(sph.phi)*Math.cos(sph.theta));cam.lookAt(self.target)}
el.addEventListener("mousedown",function(e){if(!self.enabled)return;getS();state=e.button===2?2:1;sx=e.clientX;sy=e.clientY;e.preventDefault()});
el.addEventListener("mousemove",function(e){if(!self.enabled||!state)return;var dx=e.clientX-sx,dy=e.clientY-sy;sx=e.clientX;sy=e.clientY;if(state===1){sph.theta-=dx*.005;sph.phi=Math.max(.1,Math.min(Math.PI-.1,sph.phi+dy*.005));apply()}else if(state===2){var r=new THREE.Vector3(),u=new THREE.Vector3();r.setFromMatrixColumn(cam.matrix,0);u.setFromMatrixColumn(cam.matrix,1);var f=sph.r*.002;self.target.add(r.multiplyScalar(-dx*f));self.target.add(u.multiplyScalar(dy*f));apply()}});
window.addEventListener("mouseup",function(){state=0});
el.addEventListener("wheel",function(e){if(!self.enabled)return;getS();sph.r*=e.deltaY>0?1.1:.9;sph.r=Math.max(self.minDist,Math.min(self.maxDist,sph.r));apply();e.preventDefault()},{passive:false});
el.addEventListener("contextmenu",function(e){e.preventDefault()});
var tDist=0,tState=0;
el.addEventListener("touchstart",function(e){if(!self.enabled)return;getS();if(e.touches.length===1){tState=1;sx=e.touches[0].clientX;sy=e.touches[0].clientY}else if(e.touches.length===2){tState=3;tDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}},{passive:true});
el.addEventListener("touchmove",function(e){if(!self.enabled||!tState)return;if(tState===1&&e.touches.length===1){var dx=e.touches[0].clientX-sx,dy=e.touches[0].clientY-sy;sx=e.touches[0].clientX;sy=e.touches[0].clientY;sph.theta-=dx*.005;sph.phi=Math.max(.1,Math.min(Math.PI-.1,sph.phi+dy*.005));apply()}else if(tState===3&&e.touches.length===2){var d2=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);sph.r*=tDist/d2;sph.r=Math.max(self.minDist,Math.min(self.maxDist,sph.r));tDist=d2;apply()}},{passive:true});
el.addEventListener("touchend",function(){tState=0},{passive:true});
this.update=function(){};this.dispose=function(){};getS();
};
THREE.OrbitControls=OC;
})();

// ─── Scene ────────────────────────────────────────────────────────────────────
var scene=new THREE.Scene();

// Gradient sky background (dark navy → deep blue → horizon glow)
(function(){
  var skyC=document.createElement("canvas");skyC.width=2;skyC.height=256;
  var skyG=skyC.getContext("2d");
  var grad=skyG.createLinearGradient(0,0,0,256);
  grad.addColorStop(0,"#060610");
  grad.addColorStop(0.3,"#0A0E1E");
  grad.addColorStop(0.6,"#101828");
  grad.addColorStop(0.85,"#1A2540");
  grad.addColorStop(1.0,"#2A3555");
  skyG.fillStyle=grad;skyG.fillRect(0,0,2,256);
  var skyTex=new THREE.CanvasTexture(skyC);
  skyTex.magFilter=THREE.LinearFilter;
  scene.background=skyTex;
})();
scene.fog=new THREE.FogExp2(0x0A0A18,0.012);

var camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,500);
var SP=new THREE.Vector3(CX+MXD*.8,MXD*.7,CZ+MXD*.9);
// Default to top-down view for floor plans
camera.position.set(CX,MXD*1.4,CZ+.01);
camera.lookAt(CX,0,CZ);
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.physicallyCorrectLights=true;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.1;
renderer.outputEncoding=THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(CX,0,CZ);

// ─── HDR-Quality Environment Map (procedural sky dome) ───────────────────────
(function(){
  var pmremGen=new THREE.PMREMGenerator(renderer);
  var envScene=new THREE.Scene();
  // Sky dome with gradient — simulates real sky + ground for reflections
  var skyGeo=new THREE.SphereGeometry(50,32,32);
  var skyC=document.createElement('canvas');skyC.width=512;skyC.height=256;
  var skyCtx=skyC.getContext('2d');
  var skyGrad=skyCtx.createLinearGradient(0,0,0,256);
  skyGrad.addColorStop(0,'#87CEEB');
  skyGrad.addColorStop(0.35,'#B0D4E8');
  skyGrad.addColorStop(0.48,'#E8DCC8');
  skyGrad.addColorStop(0.52,'#D8C8A8');
  skyGrad.addColorStop(0.65,'#C0B090');
  skyGrad.addColorStop(1,'#8A7A68');
  skyCtx.fillStyle=skyGrad;skyCtx.fillRect(0,0,512,256);
  // Add a bright sun spot
  var sunGrad=skyCtx.createRadialGradient(350,80,0,350,80,60);
  sunGrad.addColorStop(0,'rgba(255,250,230,0.6)');
  sunGrad.addColorStop(0.3,'rgba(255,240,200,0.2)');
  sunGrad.addColorStop(1,'rgba(255,240,200,0)');
  skyCtx.fillStyle=sunGrad;skyCtx.fillRect(290,20,120,120);
  var skyTx=new THREE.CanvasTexture(skyC);
  skyTx.mapping=THREE.EquirectangularReflectionMapping;
  var skyMt=new THREE.MeshBasicMaterial({map:skyTx,side:THREE.BackSide});
  envScene.add(new THREE.Mesh(skyGeo,skyMt));
  // Add directional light into env scene for specular highlights
  var envSun=new THREE.DirectionalLight(0xFFE8C0,3);
  envSun.position.set(5,10,-3);envScene.add(envSun);
  envScene.add(new THREE.AmbientLight(0xD0E0F0,0.6));
  var envMap=pmremGen.fromScene(envScene,0).texture;
  scene.environment=envMap;
  pmremGen.dispose();
  console.log('[BUILDER] Procedural HDR environment map applied');
})();

// ─── Lights (warm key + cool fill + sky hemisphere) ──────────────────────────
scene.add(new THREE.AmbientLight(0xFFF5E8,.6));
var sun=new THREE.DirectionalLight(0xFFECCC,2.5);
sun.position.set(BW+6,22,-4);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);
var sc=sun.shadow.camera;sc.left=-35;sc.right=35;sc.top=35;sc.bottom=-35;sc.near=1;sc.far=70;
sun.shadow.bias=-.0002;sun.shadow.normalBias=.02;scene.add(sun);
var fill=new THREE.DirectionalLight(0xC0D8F0,.8);
fill.position.set(-10,15,BD+6);scene.add(fill);
var rim=new THREE.DirectionalLight(0xE0C8F0,.25);
rim.position.set(CX,-2,CZ-MXD);scene.add(rim);
scene.add(new THREE.HemisphereLight(0xC0D8F0,0x8A7A60,.7));

// ─── Anisotropic Filtering ───────────────────────────────────────────────────
var maxAniso=renderer.capabilities.getMaxAnisotropy();
console.log('[BUILDER] Max anisotropy:',maxAniso);

// ─── High-Quality Procedural Textures (1024x1024) ───────────────────────────
function shiftHex(hex,amt){
  var r=Math.max(0,Math.min(255,((hex>>16)&0xff)+amt));
  var g=Math.max(0,Math.min(255,((hex>>8)&0xff)+amt));
  var b=Math.max(0,Math.min(255,(hex&0xff)+amt));
  return 'rgb('+r+','+g+','+b+')';
}

function makeFloorTex(type,hex){
  var S=1024,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  var R=(hex>>16)&0xff,G=(hex>>8)&0xff,B=hex&0xff;
  g.fillStyle="rgb("+R+","+G+","+B+")";g.fillRect(0,0,S,S);

  if(type==="wood"){
    var plankH=Math.floor(S/6);
    var baseColors=[[R,G,B],[R+12,G+8,B+4],[R-10,G-8,B-6],[R+5,G-2,B-4],[R-5,G+5,B+2]];
    for(var row=0;row<6;row++){
      var stagger=(row%2)*(S*0.35);
      var pw=S*0.5+Math.random()*S*0.3;
      for(var px=-pw;px<S+pw;px+=pw){
        var bc=baseColors[Math.floor(Math.random()*baseColors.length)];
        var pGrad=g.createLinearGradient(px+stagger,0,px+stagger+pw,0);
        pGrad.addColorStop(0,'rgb('+bc[0]+','+bc[1]+','+bc[2]+')');
        pGrad.addColorStop(0.3,'rgb('+(bc[0]+8)+','+(bc[1]+5)+','+(bc[2]+2)+')');
        pGrad.addColorStop(0.7,'rgb('+(bc[0]-5)+','+(bc[1]-3)+','+(bc[2]-2)+')');
        pGrad.addColorStop(1,'rgb('+bc[0]+','+bc[1]+','+bc[2]+')');
        g.fillStyle=pGrad;
        g.fillRect(px+stagger+1,row*plankH+1.5,pw-2,plankH-3);
        // Vertical plank-end gap (subtle)
        g.fillStyle='rgba(25,12,4,0.12)';
        g.fillRect(px+stagger,row*plankH,1,plankH);
      }
      // Horizontal plank gap (subtle)
      g.fillStyle='rgba(20,8,2,0.18)';
      g.fillRect(0,row*plankH,S,1);
      // Wavy grain lines (very subtle)
      for(var gi=0;gi<20;gi++){
        var gy=row*plankH+3+Math.random()*(plankH-6);
        var gAlpha=0.01+Math.random()*0.03;
        g.strokeStyle='rgba(50,28,10,'+gAlpha+')';
        g.lineWidth=0.3+Math.random()*0.5;
        g.beginPath();
        g.moveTo(0,gy);
        for(var gx=0;gx<S;gx+=25){
          g.lineTo(gx,gy+Math.sin(gx*0.04+row)*1.5+(Math.random()-0.5)*1.2);
        }
        g.stroke();
      }
      // Knots with radial gradient
      if(Math.random()<0.2){
        var kx=80+Math.random()*(S-160),ky=row*plankH+plankH*0.35+Math.random()*plankH*0.3;
        var kr=6+Math.random()*10;
        var kGrad=g.createRadialGradient(kx,ky,0,kx,ky,kr);
        kGrad.addColorStop(0,'rgba(50,30,12,0.4)');
        kGrad.addColorStop(0.6,'rgba(70,45,22,0.2)');
        kGrad.addColorStop(1,'rgba(0,0,0,0)');
        g.fillStyle=kGrad;
        g.beginPath();g.arc(kx,ky,kr,0,Math.PI*2);g.fill();
        // Ring around knot
        g.strokeStyle='rgba(50,30,12,0.12)';g.lineWidth=1.5;
        g.beginPath();g.arc(kx,ky,kr+3,0,Math.PI*2);g.stroke();
      }
    }
  }else if(type==="tile"){
    var ts=Math.floor(S/8);
    for(var tx=0;tx<S;tx+=ts)for(var ty=0;ty<S;ty+=ts){
      var tv=Math.random()*14-7;
      var tR=Math.max(0,Math.min(255,R+tv)),tG=Math.max(0,Math.min(255,G+tv)),tB=Math.max(0,Math.min(255,B+tv));
      g.fillStyle='rgb('+tR+','+tG+','+tB+')';
      g.fillRect(tx+2,ty+2,ts-4,ts-4);
      // Surface micro-texture
      for(var tn=0;tn<12;tn++){
        g.fillStyle='rgba(0,0,0,'+(Math.random()*0.025)+')';
        g.fillRect(tx+Math.random()*ts,ty+Math.random()*ts,2+Math.random()*2,1+Math.random()*2);
      }
    }
    // Grout lines (subtle)
    g.strokeStyle='rgba(0,0,0,0.08)';g.lineWidth=1;
    for(var tlx=0;tlx<=S;tlx+=ts){g.beginPath();g.moveTo(tlx,0);g.lineTo(tlx,S);g.stroke()}
    for(var tly=0;tly<=S;tly+=ts){g.beginPath();g.moveTo(0,tly);g.lineTo(S,tly);g.stroke()}
  }else if(type==="mosaic"){
    var ms=Math.floor(S/32);
    for(var mx=0;mx<S;mx+=ms)for(var my=0;my<S;my+=ms){
      var mv=Math.random()*35-17;
      g.fillStyle='rgb('+Math.max(0,Math.min(255,R+mv))+','+Math.max(0,Math.min(255,G+mv))+','+Math.max(0,Math.min(255,B+mv))+')';
      g.fillRect(mx+0.5,my+0.5,ms-1,ms-1);
    }
    g.strokeStyle='rgba(0,0,0,0.06)';g.lineWidth=0.5;
    for(var mlx=0;mlx<=S;mlx+=ms){g.beginPath();g.moveTo(mlx,0);g.lineTo(mlx,S);g.stroke()}
    for(var mly=0;mly<=S;mly+=ms){g.beginPath();g.moveTo(0,mly);g.lineTo(S,mly);g.stroke()}
  }else if(type==="stone"){
    for(var si=0;si<40;si++){
      var sx2=Math.random()*(S-80),sy2=Math.random()*(S-60),sw2=40+Math.random()*70,sh2=30+Math.random()*50;
      var sv=Math.random()*28-14;
      g.fillStyle='rgb('+Math.max(0,Math.min(255,R+sv))+','+Math.max(0,Math.min(255,G+sv))+','+Math.max(0,Math.min(255,B+sv))+')';
      g.fillRect(sx2,sy2,sw2,sh2);
      g.strokeStyle='rgba(0,0,0,0.06)';g.lineWidth=0.8;g.strokeRect(sx2,sy2,sw2,sh2);
      // Surface noise per stone
      for(var sn=0;sn<8;sn++){g.fillStyle='rgba(0,0,0,'+(Math.random()*0.03)+')';g.fillRect(sx2+Math.random()*sw2,sy2+Math.random()*sh2,3,2)}
    }
  }else{
    // Concrete with noise
    for(var nx=0;nx<S;nx+=4)for(var ny=0;ny<S;ny+=4){g.fillStyle='rgba(0,0,0,'+(Math.random()*.04)+')';g.fillRect(nx,ny,4,4)}
    for(var cn=0;cn<400;cn++){g.fillStyle='rgba(0,0,0,'+(Math.random()*0.025)+')';g.fillRect(Math.random()*S,Math.random()*S,3+Math.random()*4,2+Math.random()*3)}
  }
  var t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;
  t.anisotropy=maxAniso;
  return t;
}

function makePlasterTex(){
  var S=512,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  g.fillStyle="#F0E8DC";g.fillRect(0,0,S,S);
  // Plaster micro-texture — varied warm tones
  for(var i=0;i<3000;i++){
    var v=230+Math.floor(Math.random()*20-10);
    g.fillStyle='rgb('+v+','+(v-3)+','+(v-8)+')';
    g.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*2.5,1+Math.random()*2);
  }
  // Subtle trowel marks
  for(var tm=0;tm<8;tm++){
    g.strokeStyle='rgba(0,0,0,'+(0.01+Math.random()*0.02)+')';
    g.lineWidth=0.8+Math.random()*1.5;
    g.beginPath();
    var tmx=Math.random()*S,tmy=Math.random()*S;
    g.moveTo(tmx,tmy);
    for(var ts=0;ts<6;ts++){tmx+=Math.random()*80-40;tmy+=Math.random()*60-20;g.lineTo(tmx,tmy)}
    g.stroke();
  }
  var t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.repeat.set(3,6);
  t.encoding=THREE.sRGBEncoding;
  return t;
}

function makeMarbleTex(){
  var S=1024,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  g.fillStyle="#EDE5D8";g.fillRect(0,0,S,S);
  // Marble veins
  for(var v=0;v<18;v++){
    g.strokeStyle='rgba(180,170,155,'+(0.08+Math.random()*0.14)+')';
    g.lineWidth=0.8+Math.random()*3;
    g.beginPath();
    var vx=Math.random()*S,vy=Math.random()*S;
    g.moveTo(vx,vy);
    for(var vs=0;vs<60;vs++){vx+=(Math.random()-0.5)*35;vy+=(Math.random()-0.3)*25;g.lineTo(vx,vy)}
    g.stroke();
    // Fine secondary veins
    if(Math.random()<0.4){
      g.strokeStyle='rgba(190,180,165,'+(0.04+Math.random()*0.06)+')';
      g.lineWidth=0.3+Math.random();
      g.beginPath();g.moveTo(vx,vy);
      for(var vs2=0;vs2<20;vs2++){vx+=(Math.random()-0.5)*25;vy+=(Math.random()-0.5)*20;g.lineTo(vx,vy)}
      g.stroke();
    }
  }
  // Subtle warm noise
  for(var mn=0;mn<2000;mn++){g.fillStyle='rgba(200,190,180,'+(Math.random()*0.04)+')';g.fillRect(Math.random()*S,Math.random()*S,2,2)}
  var t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.encoding=THREE.sRGBEncoding;
  t.anisotropy=maxAniso;
  return t;
}

// ─── Color / texture maps ────────────────────────────────────────────────────
var TT={living:"wood",dining:"wood",bedroom:"wood",office:"wood",studio:"wood",kitchen:"tile",bathroom:"mosaic",veranda:"stone",balcony:"stone",patio:"stone",hallway:"concrete",entrance:"concrete",passage:"concrete",staircase:"concrete",utility:"concrete",storage:"concrete",closet:"concrete",other:"concrete"};
var FC={living:0x8B6F4E,dining:0x7A5C3A,kitchen:0xBCB5A8,bedroom:0x9B7E5E,bathroom:0x5A7080,veranda:0x5A6E50,balcony:0x5A6E50,patio:0x5A6E50,hallway:0x7A7068,entrance:0x7A7068,passage:0x7A7068,staircase:0x605850,utility:0x585050,storage:0x585050,closet:0x585050,office:0x9B7E5E,studio:0x8A7A58,other:0x8A7A68};
var LC={living:"#4F8AFF",dining:"#4F8AFF",studio:"#4F8AFF",bedroom:"#8B5CF6",office:"#8B5CF6",kitchen:"#10B981",bathroom:"#3B82F6",veranda:"#10B981",balcony:"#10B981",patio:"#10B981",hallway:"#F59E0B",entrance:"#F59E0B",passage:"#F59E0B",staircase:"#F59E0B",utility:"#707080",storage:"#707080",closet:"#707080",other:"#8888A0"};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function box(w,h,d,mat){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.castShadow=true;m.receiveShadow=true;return m}
function addAt(m,x,y,z){m.position.set(x,y,z);scene.add(m);return m}
function addGrp(g,x,y,z){g.position.set(x,y,z);scene.add(g);return g}
function cyl(rt,rb,h,seg,mat){var m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||12),mat);m.castShadow=true;return m}

// ─── GLTF Model Loader (real 3D furniture from R2 CDN) ──────────────────────
var gltfLoader=typeof THREE.GLTFLoader!=='undefined'?new THREE.GLTFLoader():null;
var modelCache={};
var modelAvailable={};
var gltfTotal=0,gltfLoaded=0,gltfFailed=0;

// Loading progress UI
var loadingBar=document.createElement('div');
loadingBar.style.cssText='position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#E0E0E0;padding:8px 20px;border-radius:10px;font-family:Inter,system-ui,sans-serif;font-size:12px;z-index:100;display:none;border:1px solid rgba(79,138,255,0.2);';
document.body.appendChild(loadingBar);
function updateLoadBar(){
  if(gltfTotal===0){loadingBar.style.display='none';return}
  var done=gltfLoaded+gltfFailed;
  if(done>=gltfTotal){loadingBar.textContent='Furniture loaded ('+gltfLoaded+'/'+gltfTotal+')';setTimeout(function(){loadingBar.style.display='none'},2500);return}
  loadingBar.style.display='block';
  loadingBar.textContent='Loading furniture: '+done+'/'+gltfTotal+' ('+Math.round(done/gltfTotal*100)+'%)';
}

// Target heights (meters) for auto-scaling AI-generated models
var MODEL_TARGET_H={
  'sofa':0.85,'coffee-table':0.45,'potted-plant':0.7,'floor-lamp':1.7,
  'tv-unit':0.5,'bed':0.6,'nightstand':0.55,'dining-table':0.75,
  'dining-chair':0.85,'fridge':1.8,'toilet':0.42,'bathroom-vanity':0.85,
  'office-desk':0.75,'office-chair':1.1
};

function loadGLTF(filename,targetX,targetZ,targetW,targetD,rotY){
  var id=filename.replace('.glb','');
  if(!gltfLoader){console.warn('[GLTF] GLTFLoader not available');return}
  var url=MODEL_CDN+'/'+filename;
  console.log('[GLTF] === LOAD: '+filename+' from '+url+' ===');
  console.log('[GLTF]   pos=('+targetX.toFixed(1)+','+targetZ.toFixed(1)+') area='+targetW.toFixed(1)+'x'+targetD.toFixed(1));
  gltfTotal++;
  updateLoadBar();

  // Helper to place a model scene node
  function placeModel(m,s,yOff){
    m.scale.set(s,s,s);
    m.position.set(targetX,yOff,targetZ);
    if(rotY)m.rotation.y=rotY;
    m.traverse(function(ch){
      if(ch.isMesh){
        ch.castShadow=true;ch.receiveShadow=true;
        if(ch.material){ch.material.envMapIntensity=0.4;ch.material.needsUpdate=true}
      }
    });
    scene.add(m);
  }

  // Clone from cache if available
  if(modelCache[id]){
    var cd=modelCache[id];
    var clone=cd.model.clone();
    var fitS=Math.min(targetW/Math.max(cd.rawW,0.01),targetD/Math.max(cd.rawD,0.01))*0.85;
    var thS=(MODEL_TARGET_H[id]||1.0)/Math.max(cd.rawH,0.01);
    var s=Math.min(fitS,thS);
    var yOff=-cd.bboxMinY*s;
    placeModel(clone,s,yOff);
    gltfLoaded++;
    updateLoadBar();
    console.log('[GLTF] Cloned '+filename+' from cache (scale:'+s.toFixed(4)+')');
    return;
  }

  gltfLoader.load(url,function(gltf){
    var m=gltf.scene;
    var bbox=new THREE.Box3().setFromObject(m);
    var sz=bbox.getSize(new THREE.Vector3());

    // Cache raw dimensions
    modelCache[id]={model:m.clone(),rawW:sz.x,rawH:sz.y,rawD:sz.z,bboxMinY:bbox.min.y};

    // Auto-scale: fit within target area AND target height
    var fitS=Math.min(targetW/Math.max(sz.x,0.01),targetD/Math.max(sz.z,0.01))*0.85;
    var thS=(MODEL_TARGET_H[id]||1.0)/Math.max(sz.y,0.01);
    var s=Math.min(fitS,thS);
    s=Math.max(0.0001,s);
    var yOff=-bbox.min.y*s;

    placeModel(m,s,yOff);
    gltfLoaded++;
    updateLoadBar();
    console.log('[GLTF] OK '+filename+' (raw:'+sz.x.toFixed(1)+'x'+sz.y.toFixed(1)+'x'+sz.z.toFixed(1)+' scale:'+s.toFixed(4)+') ['+gltfLoaded+'/'+gltfTotal+']');
  },function(p){
    if(p.total>0){var pct=Math.round(p.loaded/p.total*100);if(pct%20===0)console.log('[GLTF] '+id+' '+pct+'% ('+Math.round(p.loaded/1024/1024)+'MB)')}
  },function(err){
    console.error('[GLTF] FAIL '+filename+': '+(err&&err.message?err.message:String(err)));
    console.error('[GLTF] URL was: '+url);
    gltfFailed++;
    updateLoadBar();
  });
}

// Room-type → GLTF model definitions
// rx,rz = position as fraction of room; wF,dF = size as fraction of room
var ROOM_MODELS={
  living:[
    {file:'sofa.glb',rx:0.5,rz:0.25,wF:0.6,dF:0.3,rot:0},
    {file:'coffee-table.glb',rx:0.5,rz:0.5,wF:0.25,dF:0.2,rot:0},
    {file:'tv-unit.glb',rx:0.5,rz:0.85,wF:0.4,dF:0.15,rot:Math.PI},
    {file:'potted-plant.glb',rx:0.88,rz:0.12,wF:0.1,dF:0.1,rot:0},
    {file:'floor-lamp.glb',rx:0.12,rz:0.12,wF:0.08,dF:0.08,rot:0},
  ],
  studio:[
    {file:'sofa.glb',rx:0.5,rz:0.25,wF:0.55,dF:0.3,rot:0},
    {file:'coffee-table.glb',rx:0.5,rz:0.5,wF:0.22,dF:0.18,rot:0},
    {file:'potted-plant.glb',rx:0.85,rz:0.85,wF:0.1,dF:0.1,rot:0},
  ],
  bedroom:[
    {file:'bed.glb',rx:0.5,rz:0.4,wF:0.55,dF:0.6,rot:0},
    {file:'nightstand.glb',rx:0.88,rz:0.25,wF:0.12,dF:0.12,rot:0},
    {file:'potted-plant.glb',rx:0.12,rz:0.85,wF:0.08,dF:0.08,rot:0},
  ],
  dining:[
    {file:'dining-table.glb',rx:0.5,rz:0.5,wF:0.5,dF:0.4,rot:0},
    {file:'dining-chair.glb',rx:0.25,rz:0.5,wF:0.15,dF:0.15,rot:Math.PI/2},
    {file:'dining-chair.glb',rx:0.75,rz:0.5,wF:0.15,dF:0.15,rot:-Math.PI/2},
    {file:'dining-chair.glb',rx:0.5,rz:0.25,wF:0.15,dF:0.15,rot:0},
    {file:'dining-chair.glb',rx:0.5,rz:0.75,wF:0.15,dF:0.15,rot:Math.PI},
  ],
  kitchen:[
    {file:'fridge.glb',rx:0.85,rz:0.15,wF:0.2,dF:0.2,rot:0},
  ],
  bathroom:[
    {file:'toilet.glb',rx:0.7,rz:0.3,wF:0.15,dF:0.2,rot:-Math.PI/2},
    {file:'bathroom-vanity.glb',rx:0.3,rz:0.12,wF:0.35,dF:0.15,rot:0},
  ],
  office:[
    {file:'office-desk.glb',rx:0.5,rz:0.35,wF:0.45,dF:0.25,rot:0},
    {file:'office-chair.glb',rx:0.5,rz:0.6,wF:0.15,dF:0.15,rot:Math.PI},
    {file:'potted-plant.glb',rx:0.88,rz:0.85,wF:0.08,dF:0.08,rot:0},
  ],
  hallway:[
    {file:'potted-plant.glb',rx:0.85,rz:0.5,wF:0.08,dF:0.08,rot:0},
  ],
  veranda:[
    {file:'potted-plant.glb',rx:0.2,rz:0.3,wF:0.1,dF:0.1,rot:0},
    {file:'potted-plant.glb',rx:0.8,rz:0.7,wF:0.1,dF:0.1,rot:0},
  ],
};

// ─── Shared Materials ────────────────────────────────────────────────────────
var MAT={
  oak:new THREE.MeshStandardMaterial({color:0x5D4037,roughness:.5,metalness:.02,envMapIntensity:.2}),
  walnut:new THREE.MeshStandardMaterial({color:0x4A2C0A,roughness:.55,metalness:.02,envMapIntensity:.2}),
  darkWood:new THREE.MeshStandardMaterial({color:0x2A1A0E,roughness:.5,metalness:.03,envMapIntensity:.15}),
  fabric:new THREE.MeshStandardMaterial({color:0x2C3E50,roughness:.92,metalness:0,envMapIntensity:.05}),
  linen:new THREE.MeshStandardMaterial({color:0xECF0F1,roughness:.95,metalness:0,envMapIntensity:.05}),
  pillow:new THREE.MeshStandardMaterial({color:0xF5F5F0,roughness:.9,metalness:0,envMapIntensity:.05}),
  ceramic:new THREE.MeshStandardMaterial({color:0xFAFAFA,roughness:.1,metalness:.02,envMapIntensity:.6}),
  chrome:new THREE.MeshStandardMaterial({color:0xD0D0D0,roughness:.06,metalness:.9,envMapIntensity:1.0}),
  marble:new THREE.MeshStandardMaterial({map:makeMarbleTex(),color:0xE8E0D0,roughness:.12,metalness:.05,envMapIntensity:.5}),
  cabinet:new THREE.MeshStandardMaterial({color:0x1A2332,roughness:.6,metalness:.02,envMapIntensity:.1}),
  leather:new THREE.MeshStandardMaterial({color:0x3E2723,roughness:.75,metalness:.02,envMapIntensity:.1}),
  steel:new THREE.MeshStandardMaterial({color:0xB8B8C0,roughness:.18,metalness:.6,envMapIntensity:.8}),
  mirror:new THREE.MeshStandardMaterial({color:0xB0C4DE,roughness:.02,metalness:.85,envMapIntensity:1.0}),
  glass:new THREE.MeshStandardMaterial({color:0xD8E8F0,roughness:.05,metalness:.1,transparent:true,opacity:.3,envMapIntensity:.8}),
  accentRed:new THREE.MeshStandardMaterial({color:0xC0392B,roughness:.88,metalness:0,envMapIntensity:.05}),
  accentBlue:new THREE.MeshStandardMaterial({color:0x2980B9,roughness:.88,metalness:0,envMapIntensity:.05}),
  plantGreen:new THREE.MeshStandardMaterial({color:0x27AE60,roughness:.8,metalness:0,envMapIntensity:.05}),
  potBrown:new THREE.MeshStandardMaterial({color:0x6B4226,roughness:.7,metalness:.02,envMapIntensity:.08}),
};

// ─── Furniture Creators ──────────────────────────────────────────────────────
function createSofa(sw,sd){
  var g=new THREE.Group();
  var seatH=.2,seatY=.32,armW=.12,backH=.38;
  // Seat cushion
  var seat=box(sw,seatH,sd*.55,MAT.fabric);seat.position.set(0,seatY,sd*.05);g.add(seat);
  // Back cushion
  var back=box(sw-.06,backH,.12,MAT.fabric);back.position.set(0,seatY+seatH/2+backH/2-0.02,-sd*.2);g.add(back);
  // Left arm
  var arm=box(armW,.22,sd*.55,MAT.fabric);arm.position.set(-sw/2+armW/2,seatY+.02,sd*.05);g.add(arm);
  // Right arm
  var arm2=arm.clone();arm2.position.x=sw/2-armW/2;g.add(arm2);
  // Throw pillows (bold accent colors)
  var tp=box(.28,.14,.08,MAT.accentRed);tp.position.set(-sw*.3,seatY+seatH/2+.08,-sd*.12);tp.rotation.x=-.15;g.add(tp);
  var tp2=box(.28,.14,.08,MAT.accentBlue);tp2.position.set(sw*.3,seatY+seatH/2+.08,-sd*.12);tp2.rotation.x=-.15;g.add(tp2);
  // Wooden legs (tapered)
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.025,.018,.14,8,MAT.walnut);
    leg.position.set(p[0]*(sw/2-.08),.07,p[1]*(sd*.2)+sd*.05);g.add(leg);
  });
  return g;
}

function createCoffeeTable(tw,td){
  var g=new THREE.Group();
  // Table top (rounded edges effect via slightly smaller bottom)
  var top=box(tw,.035,td,MAT.oak);top.position.set(0,.42,0);g.add(top);
  // Shelf below
  var shelf=box(tw-.08,.02,td-.08,MAT.oak);shelf.position.set(0,.15,0);shelf.receiveShadow=true;g.add(shelf);
  // Hairpin legs (4 metal legs)
  var legM=MAT.steel;
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.012,.012,.4,6,legM);
    leg.position.set(p[0]*(tw/2-.06),.21,p[1]*(td/2-.06));g.add(leg);
  });
  return g;
}

function createBed(bw,bd){
  var g=new THREE.Group();
  // Frame base
  var frame=box(bw+.06,.08,bd+.06,MAT.oak);frame.position.set(0,.22,0);g.add(frame);
  // Mattress
  var matt=box(bw,.2,bd,MAT.linen);matt.position.set(0,.36,0);g.add(matt);
  // Headboard (paneled)
  var hb=box(bw+.08,.7,.05,MAT.oak);hb.position.set(0,.6,-bd/2+.025);g.add(hb);
  // Headboard panel inset
  var panel=box(bw-.12,.5,.02,new THREE.MeshStandardMaterial({color:0x9A7E58,roughness:.45}));
  panel.position.set(0,.58,-bd/2+.06);g.add(panel);
  // Pillows (2 fluffy)
  var pw=bw*.33,ph=.1,pd=.28;
  var p1=box(pw,ph,pd,MAT.pillow);p1.position.set(-bw*.2,.5,-bd/2+pd/2+.08);p1.rotation.x=-.08;g.add(p1);
  var p2=p1.clone();p2.position.x=bw*.2;g.add(p2);
  // Duvet fold line (thin strip across the bed)
  var duvet=box(bw-.04,.03,bd*.55,new THREE.MeshStandardMaterial({color:0xE8E4DC,roughness:.9}));
  duvet.position.set(0,.47,bd*.1);g.add(duvet);
  // Legs
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.03,.03,.18,8,MAT.oak);
    leg.position.set(p[0]*(bw/2),.09,p[1]*(bd/2));g.add(leg);
  });
  return g;
}

function createNightstand(){
  var g=new THREE.Group();
  var body=box(.38,.35,.32,MAT.oak);body.position.set(0,.295,0);g.add(body);
  // Drawer face
  var drawer=box(.32,.12,.01,new THREE.MeshStandardMaterial({color:0x7A6040,roughness:.45}));
  drawer.position.set(0,.3,.165);g.add(drawer);
  // Handle
  var handle=cyl(.008,.008,.08,6,MAT.chrome);handle.rotation.z=Math.PI/2;
  handle.position.set(0,.3,.18);g.add(handle);
  // Legs
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.015,.015,.12,6,MAT.oak);
    leg.position.set(p[0]*.15,.06,p[1]*.12);g.add(leg);
  });
  return g;
}

function createDiningTable(tw,td){
  var g=new THREE.Group();
  var top=box(tw,.04,td,MAT.walnut);top.position.set(0,.74,0);g.add(top);
  // Tapered legs
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.025,.02,.7,8,MAT.walnut);
    leg.position.set(p[0]*(tw/2-.08),.35,p[1]*(td/2-.08));g.add(leg);
  });
  return g;
}

function createChair(rot){
  var g=new THREE.Group();
  var seat=box(.38,.03,.38,MAT.walnut);seat.position.set(0,.44,0);g.add(seat);
  var back=box(.38,.38,.03,MAT.walnut);back.position.set(0,.66,-.17);g.add(back);
  // Spindles in the back (3 vertical rods)
  [-1,0,1].forEach(function(i){
    var rod=cyl(.01,.01,.3,6,MAT.walnut);rod.position.set(i*.1,.6,-.17);g.add(rod);
  });
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.015,.012,.44,6,MAT.walnut);
    leg.position.set(p[0]*.14,.22,p[1]*.14);g.add(leg);
  });
  if(rot)g.rotation.y=rot;
  return g;
}

function createToilet(){
  var g=new THREE.Group();
  // Bowl (rounded cylinder)
  var bowl=cyl(.17,.15,.32,16,MAT.ceramic);bowl.position.set(0,.16,.08);g.add(bowl);
  // Seat rim
  var rim=new THREE.Mesh(new THREE.TorusGeometry(.15,.025,8,16),MAT.ceramic);
  rim.rotation.x=-Math.PI/2;rim.position.set(0,.33,.08);g.add(rim);
  // Tank
  var tank=box(.34,.32,.14,MAT.ceramic);tank.position.set(0,.38,-.14);g.add(tank);
  // Tank lid
  var lid=box(.36,.03,.16,MAT.ceramic);lid.position.set(0,.555,-.14);g.add(lid);
  // Flush handle
  var handle=cyl(.008,.008,.06,6,MAT.chrome);handle.rotation.z=Math.PI/2;
  handle.position.set(.16,.52,-.14);g.add(handle);
  return g;
}

function createVanity(vw){
  var g=new THREE.Group();
  // Cabinet body
  var cab=box(vw,.48,.38,MAT.cabinet);cab.position.set(0,.24,0);g.add(cab);
  // Countertop
  var top=box(vw+.02,.03,.4,MAT.marble);top.position.set(0,.495,0);g.add(top);
  // Sink basin (recessed)
  var basin=cyl(.12,.14,.04,16,MAT.ceramic);basin.position.set(0,.48,.02);g.add(basin);
  // Faucet stem
  var stem=cyl(.01,.01,.18,6,MAT.chrome);stem.position.set(0,.58,-.12);g.add(stem);
  // Faucet spout
  var spout=cyl(.008,.008,.1,6,MAT.chrome);spout.rotation.z=Math.PI/2.5;
  spout.position.set(0,.66,-.06);g.add(spout);
  // Handles
  var hL=cyl(.006,.006,.04,6,MAT.chrome);hL.rotation.z=Math.PI/2;hL.position.set(-.06,.6,-.12);g.add(hL);
  var hR=hL.clone();hR.position.x=.06;g.add(hR);
  return g;
}

function createKitchenCounter(kw,kd){
  var g=new THREE.Group();
  // Base cabinet (with door lines)
  var base=box(kw,.82,kd,MAT.cabinet);base.position.set(0,.41,0);g.add(base);
  // Door line accents (vertical grooves)
  var doorW=kw/Math.max(2,Math.floor(kw/.5));
  for(var di=0;di<Math.floor(kw/doorW);di++){
    var line=box(.01,.72,.01,new THREE.MeshStandardMaterial({color:0x1A1A28,roughness:.5}));
    line.position.set(-kw/2+doorW*(di+1),.41,kd/2+.005);g.add(line);
  }
  // Marble countertop
  var top=box(kw+.04,.04,kd+.02,MAT.marble);top.position.set(0,.86,0);g.add(top);
  // Backsplash
  var splash=box(kw,.2,.02,new THREE.MeshStandardMaterial({color:0xD8D0C4,roughness:.2}));
  splash.position.set(0,.94,-kd/2+.01);g.add(splash);
  // Sink
  var sinkBowl=box(.4,.02,.3,new THREE.MeshStandardMaterial({color:0xB0B0B8,roughness:.1,metalness:.4}));
  sinkBowl.position.set(kw*.15,.85,0);g.add(sinkBowl);
  // Stove burners (2)
  var brnM=new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:.25,metalness:.5});
  var brn1=cyl(.06,.06,.015,12,brnM);brn1.position.set(-kw*.2,.875,0);g.add(brn1);
  var brn2=cyl(.06,.06,.015,12,brnM);brn2.position.set(-kw*.2+.2,.875,0);g.add(brn2);
  // Handles on cabinet doors
  for(var hi=0;hi<Math.min(3,Math.floor(kw/.6));hi++){
    var hdl=cyl(.006,.006,.06,6,MAT.chrome);hdl.rotation.z=Math.PI/2;
    hdl.position.set(-kw/2+.3+hi*(kw/3),.55,kd/2+.01);g.add(hdl);
  }
  return g;
}

function createFridge(){
  var g=new THREE.Group();
  // Body
  var body=box(.6,1.7,.55,MAT.steel);body.position.set(0,.85,0);g.add(body);
  // Door split line
  var split=box(.58,.01,.01,new THREE.MeshStandardMaterial({color:0x888890,roughness:.3}));
  split.position.set(0,.58,.28);g.add(split);
  // Handles
  var hdl=cyl(.01,.01,.25,6,MAT.chrome);hdl.position.set(.22,1.2,.3);g.add(hdl);
  var hdl2=cyl(.01,.01,.18,6,MAT.chrome);hdl2.position.set(.22,.38,.3);g.add(hdl2);
  return g;
}

function createOfficeDesk(dw,dd){
  var g=new THREE.Group();
  var top=box(dw,.035,dd,MAT.oak);top.position.set(0,.73,0);g.add(top);
  // Metal frame legs (L-shape sides)
  var legM=MAT.steel;
  var legV=box(.04,.7,.04,legM);
  addLeg(-dw/2+.04);addLeg(dw/2-.04);
  function addLeg(x){
    var v=legV.clone();v.position.set(x,.35,dd/2-.04);g.add(v);
    var v2=legV.clone();v2.position.set(x,.35,-dd/2+.04);g.add(v2);
    var h=box(.04,.04,dd-.04,legM);h.position.set(x,.04,0);g.add(h);
  }
  return g;
}

function createOfficeChair(){
  var g=new THREE.Group();
  // Seat
  var seat=box(.42,.06,.4,MAT.leather);seat.position.set(0,.46,0);g.add(seat);
  // Back (curved via angled box)
  var back=box(.4,.4,.04,MAT.leather);back.position.set(0,.72,-.18);back.rotation.x=.08;g.add(back);
  // Center pole
  var pole=cyl(.025,.025,.22,8,MAT.chrome);pole.position.set(0,.32,0);g.add(pole);
  // Star base (5 arms)
  for(var ai=0;ai<5;ai++){
    var ang=ai*(Math.PI*2/5);
    var arm=box(.22,.02,.03,MAT.chrome);
    arm.position.set(Math.sin(ang)*.12,.04,Math.cos(ang)*.12);
    arm.rotation.y=ang;g.add(arm);
    // Caster wheel
    var wh=cyl(.015,.015,.02,8,new THREE.MeshStandardMaterial({color:0x333333,roughness:.7}));
    wh.position.set(Math.sin(ang)*.22,.015,Math.cos(ang)*.22);g.add(wh);
  }
  return g;
}

function createRug(rw,rd,pattern){
  var rc=document.createElement("canvas");rc.width=128;rc.height=128;
  var rg=rc.getContext("2d");
  if(pattern==="persian"){
    rg.fillStyle="#5C3D2E";rg.fillRect(0,0,128,128);
    rg.strokeStyle="#8B6C4B";rg.lineWidth=8;rg.strokeRect(8,8,112,112);
    rg.strokeStyle="#A08050";rg.lineWidth=3;rg.strokeRect(16,16,96,96);
    rg.strokeStyle="#C09860";rg.lineWidth=1.5;rg.strokeRect(24,24,80,80);
    // Diamond center
    rg.strokeStyle="#B89060";rg.lineWidth=2;
    rg.beginPath();rg.moveTo(64,32);rg.lineTo(96,64);rg.lineTo(64,96);rg.lineTo(32,64);rg.closePath();rg.stroke();
  }else{
    rg.fillStyle="#D8D0C0";rg.fillRect(0,0,128,128);
    for(var ri=0;ri<128;ri+=8){rg.fillStyle="rgba(0,0,0,"+(Math.random()*.04)+")";rg.fillRect(0,ri,128,4)}
  }
  var rTex=new THREE.CanvasTexture(rc);
  var rug=new THREE.Mesh(new THREE.PlaneGeometry(rw,rd),new THREE.MeshStandardMaterial({map:rTex,roughness:.92}));
  rug.rotation.x=-Math.PI/2;rug.receiveShadow=true;
  return rug;
}

// ─── Derive x,y for each room (backward compat) ─────────────────────────────
D.rooms.forEach(function(r){
  if(r.x===undefined)r.x=r.center[0]-r.width/2;
  if(r.y===undefined)r.y=r.center[1]-r.depth/2;
});

// ─── Ground plane (dark with subtle sheen) ──────────────────────────────────
var gndC=document.createElement("canvas");gndC.width=512;gndC.height=512;
var gndG=gndC.getContext("2d");
var gndGrad=gndG.createRadialGradient(256,256,0,256,256,360);
gndGrad.addColorStop(0,"#1A1A28");gndGrad.addColorStop(1,"#0E0E18");
gndG.fillStyle=gndGrad;gndG.fillRect(0,0,512,512);
for(var gi2=0;gi2<600;gi2++){gndG.fillStyle="rgba(255,255,255,"+(Math.random()*.012)+")";gndG.fillRect(Math.random()*512,Math.random()*512,2+Math.random()*3,1+Math.random()*2)}
var gndTex=new THREE.CanvasTexture(gndC);gndTex.wrapS=gndTex.wrapT=THREE.RepeatWrapping;gndTex.repeat.set(3,3);
var gnd=new THREE.Mesh(new THREE.PlaneGeometry(BW+20,BD+20),new THREE.MeshStandardMaterial({map:gndTex,color:0x14141E,roughness:.92,metalness:.02}));
gnd.rotation.x=-Math.PI/2;gnd.position.set(CX,-.16,CZ);gnd.receiveShadow=true;scene.add(gnd);

// Grid removed — clean ground plane only (professional arch-viz look)

// ─── Contact Shadow (soft radial shadow under building) ──────────────────────
(function(){
  var shC=document.createElement('canvas');shC.width=512;shC.height=512;
  var shCtx=shC.getContext('2d');
  var shGrad=shCtx.createRadialGradient(256,256,0,256,256,256);
  shGrad.addColorStop(0,'rgba(0,0,0,0.3)');
  shGrad.addColorStop(0.4,'rgba(0,0,0,0.18)');
  shGrad.addColorStop(0.7,'rgba(0,0,0,0.06)');
  shGrad.addColorStop(1,'rgba(0,0,0,0)');
  shCtx.fillStyle=shGrad;shCtx.fillRect(0,0,512,512);
  var shTex=new THREE.CanvasTexture(shC);
  var shPlane=new THREE.Mesh(
    new THREE.PlaneGeometry(BW+4,BD+4),
    new THREE.MeshBasicMaterial({map:shTex,transparent:true,depthWrite:false})
  );
  shPlane.rotation.x=-Math.PI/2;shPlane.position.set(CX,-.145,CZ);
  scene.add(shPlane);
})();

// ─── Building floor / image texture ─────────────────────────────────────────
if(HAS_IMG){
var imgLoader=new THREE.TextureLoader();imgLoader.load(IMG_SRC,function(tex){tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;
var imgFloor=new THREE.Mesh(new THREE.PlaneGeometry(BW,BD),new THREE.MeshStandardMaterial({map:tex,roughness:.5}));
imgFloor.rotation.x=-Math.PI/2;imgFloor.position.set(CX,.01,CZ);imgFloor.receiveShadow=true;scene.add(imgFloor);});
var slab=box(BW+.2,.12,BD+.2,new THREE.MeshStandardMaterial({color:0x303040,roughness:.7,metalness:.05}));
slab.position.set(CX,-.06,CZ);slab.receiveShadow=true;scene.add(slab);
// Slab edge bevel strip
var slabEdge=box(BW+.3,.02,BD+.3,new THREE.MeshStandardMaterial({color:0x404050,roughness:.4,metalness:.1}));
slabEdge.position.set(CX,.005,CZ);scene.add(slabEdge);
} else if(isNonRect){
var slabShape=new THREE.Shape();
var ol=D.buildingOutline;
slabShape.moveTo(ol[0][0],-ol[0][1]);
for(var si=1;si<ol.length;si++) slabShape.lineTo(ol[si][0],-ol[si][1]);
slabShape.closePath();
var slabGeo=new THREE.ShapeGeometry(slabShape);
var slabM=new THREE.Mesh(slabGeo,new THREE.MeshStandardMaterial({color:0x2A2A35,roughness:.9}));
slabM.rotation.x=-Math.PI/2;slabM.position.y=-.075;slabM.receiveShadow=true;scene.add(slabM);
} else {
var slab=box(BW+.2,.15,BD+.2,new THREE.MeshStandardMaterial({color:0x303040,roughness:.7,metalness:.05}));
slab.position.set(CX,-.075,CZ);slab.receiveShadow=true;scene.add(slab);
var slabEdge2=box(BW+.3,.02,BD+.3,new THREE.MeshStandardMaterial({color:0x404050,roughness:.4,metalness:.1}));
slabEdge2.position.set(CX,.005,CZ);scene.add(slabEdge2);
}

// ─── Floor plan image overlay (subtle ghost of original plan) ────────────────
if(HAS_IMG){
  var tl=new THREE.TextureLoader();
  tl.load(IMG_SRC,function(tex){
    tex.minFilter=THREE.LinearFilter;
    var og=new THREE.PlaneGeometry(BW,BD);
    var om=new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:0.08,depthWrite:false,side:THREE.DoubleSide});
    var ov=new THREE.Mesh(og,om);
    ov.rotation.x=-Math.PI/2;ov.position.set(CX,0.02,CZ);
    scene.add(ov);
  });
}

// ─── Room floors, labels, furniture ──────────────────────────────────────────
var rmM=[]; // room floor meshes for raycasting
var labels=[]; // label sprites for toggle
var pTex=makePlasterTex();

D.rooms.forEach(function(r){
  var rx=r.x,ry=r.y,w=r.width,d=r.depth;
  var cx=rx+w/2,cz=ry+d/2;
  var area=r.area||(w*d);
  var floorHex=FC[r.type]||0xA89888;
  console.log("[IFRAME] Floor:",r.name,"type:",r.type,"color:#"+floorHex.toString(16));

  // Room floor: polygon (SVG) → THREE.Shape, image → invisible target, else → textured rect
  var fl;
  if(r.polygon&&r.polygon.length>=3){
    var roomShape=new THREE.Shape();
    roomShape.moveTo(r.polygon[0][0],-r.polygon[0][1]);
    for(var pi=1;pi<r.polygon.length;pi++) roomShape.lineTo(r.polygon[pi][0],-r.polygon[pi][1]);
    roomShape.closePath();
    var fTex=makeFloorTex(TT[r.type]||"concrete",FC[r.type]||0xC0B8A8);
    fTex.repeat.set(w/2,d/2);
    fl=new THREE.Mesh(new THREE.ShapeGeometry(roomShape),new THREE.MeshStandardMaterial({map:fTex,roughness:.7,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2;fl.position.y=.005;fl.receiveShadow=true;
  }else if(HAS_IMG){
    fl=new THREE.Mesh(new THREE.PlaneGeometry(w-.04,d-.04),new THREE.MeshBasicMaterial({transparent:true,opacity:0,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2;fl.position.set(cx,.005,cz);fl.receiveShadow=true;
  }else{
    var fTex2=makeFloorTex(TT[r.type]||"concrete",FC[r.type]||0xC0B8A8);
    fTex2.repeat.set(w/2,d/2);
    fl=new THREE.Mesh(new THREE.PlaneGeometry(w-.04,d-.04),new THREE.MeshStandardMaterial({map:fTex2,roughness:.7}));
    fl.rotation.x=-Math.PI/2;fl.position.set(cx,.005,cz);fl.receiveShadow=true;
  }
  fl.userData={room:r,area:area,cx:cx,cz:cz};rmM.push(fl);scene.add(fl);

  if(!HAS_IMG){
  // Area watermark on floor
  var ac=document.createElement("canvas");ac.width=256;ac.height=128;
  var ag=ac.getContext("2d");
  ag.font="bold 48px -apple-system,sans-serif";ag.textAlign="center";
  ag.fillStyle="rgba(255,255,255,0.06)";
  ag.fillText(area.toFixed(1)+" m\\u00b2",128,75);
  var aS=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(ac),transparent:true,depthTest:false}));
  aS.position.set(cx,.02,cz);aS.scale.set(w*.7,d*.35,1);scene.add(aS);
  }

  // Frosted-glass label — scaled to room size, rounded corners, accent glow
  var labelScale=Math.min(1,Math.min(w,d)/2.5);
  var lc=document.createElement("canvas");lc.width=360;lc.height=110;
  var lg=lc.getContext("2d");
  var bc=LC[r.type]||"#8888A0";
  // Rounded rect background with frosted glass
  var lRad=14;
  lg.beginPath();
  lg.moveTo(lRad,0);lg.lineTo(360-lRad,0);lg.quadraticCurveTo(360,0,360,lRad);
  lg.lineTo(360,110-lRad);lg.quadraticCurveTo(360,110,360-lRad,110);
  lg.lineTo(lRad,110);lg.quadraticCurveTo(0,110,0,110-lRad);
  lg.lineTo(0,lRad);lg.quadraticCurveTo(0,0,lRad,0);
  lg.closePath();
  lg.fillStyle="rgba(10,12,20,0.82)";lg.fill();
  // Subtle border
  lg.strokeStyle="rgba(255,255,255,0.1)";lg.lineWidth=1.5;lg.stroke();
  // Accent bar (left side, rounded)
  lg.fillStyle=bc;
  lg.beginPath();lg.moveTo(0,lRad);lg.lineTo(0,110-lRad);lg.quadraticCurveTo(0,110,lRad,110);
  lg.lineTo(5,110);lg.lineTo(5,0);lg.lineTo(lRad,0);lg.quadraticCurveTo(0,0,0,lRad);
  lg.closePath();lg.fill();
  // Top glow accent
  var glowGrad=lg.createLinearGradient(0,0,360,0);
  glowGrad.addColorStop(0,bc+"30");glowGrad.addColorStop(.5,bc+"08");glowGrad.addColorStop(1,"transparent");
  lg.fillStyle=glowGrad;lg.fillRect(0,0,360,2);
  // Truncate long names
  var dispName=r.name.length>18?r.name.substring(0,16)+"..":r.name;
  lg.font="bold 21px -apple-system,BlinkMacSystemFont,sans-serif";lg.fillStyle="#F0F0F5";lg.fillText(dispName,16,32);
  lg.font="13px -apple-system,sans-serif";lg.fillStyle="#9898B0";
  lg.fillText(w.toFixed(1)+"m \\u00d7 "+d.toFixed(1)+"m \\u00b7 "+area.toFixed(1)+" m\\u00b2",16,56);
  lg.font="600 12px -apple-system,sans-serif";lg.fillStyle=bc;
  var typeIcon={living:"\\u25CB",bedroom:"\\u263E",kitchen:"\\u25A3",bathroom:"\\u25C9",dining:"\\u25CB",hallway:"\\u25B7",entrance:"\\u25B7",staircase:"\\u25B2",office:"\\u25A1",veranda:"\\u2606",balcony:"\\u2606",patio:"\\u2606"};
  var tIc=typeIcon[r.type]||"\\u25CB";
  lg.fillText(tIc+" "+r.type.charAt(0).toUpperCase()+r.type.slice(1),16,80);
  var lS=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(lc),transparent:true,depthTest:false}));
  lS.position.set(cx,WH+.35+labelScale*.3,cz);
  lS.scale.set(3.4*labelScale,1.04*labelScale,1);
  scene.add(lS);labels.push(lS);

  // ─── Furniture (GLTF models with procedural fallback) ─────────────────────
  if(Math.min(w,d)<1.6)return;

  // Try GLTF models for this room type (loads async from R2 CDN)
  var rModels=ROOM_MODELS[r.type];
  console.log('[FURNITURE] Room "'+r.name+'" type='+r.type+' models='+(rModels?rModels.length:0)+' gltfLoader='+(!!gltfLoader));
  if(rModels&&gltfLoader){
    rModels.forEach(function(md){
      loadGLTF(md.file,rx+w*md.rx,ry+d*md.rz,w*md.wF,d*md.dF,md.rot);
    });
  }

  // Always add procedural furniture as well — GLTF loading is async,
  // and if models aren't available the scene still looks furnished.
  // When GLTF models DO load, they overlay (slight duplication is OK
  // since real models obscure the simpler procedural ones underneath).

  if(r.type==="living"||r.type==="studio"){
    var sofaW=Math.min(1.8,w*.45);
    var sofa=createSofa(sofaW,.7);
    addGrp(sofa,cx,0,cz-d*.22);
    var ct=createCoffeeTable(Math.min(.7,w*.25),Math.min(.45,d*.15));
    addGrp(ct,cx,0,cz+.15);
    addAt(box(Math.min(w*.4,1.2),.3,.28,MAT.darkWood),cx,.15,cz+d*.3);
    var rugW=Math.min(w*.55,2.0),rugD=Math.min(d*.35,1.4);
    var rug=createRug(rugW,rugD,"persian");
    rug.position.set(cx,.007,cz);scene.add(rug);
    if(w>2.2){
      var pot=cyl(.1,.08,.18,8,MAT.potBrown);pot.position.set(cx+w*.35,.09,cz-d*.35);scene.add(pot);
      var leaves=new THREE.Mesh(new THREE.SphereGeometry(.18,8,8),MAT.plantGreen);
      leaves.position.set(cx+w*.35,.32,cz-d*.35);leaves.castShadow=true;scene.add(leaves);
    }
  }
  if(r.type==="bedroom"){
    var bedW=Math.min(1.5,w*.45),bedD=Math.min(1.9,d*.5);
    var bed=createBed(bedW,bedD);
    addGrp(bed,cx,0,cz);
    if(w>2.5){
      var ns=createNightstand();addGrp(ns,cx+bedW/2+.3,0,cz-bedD/2+.25);
    }
    if(w>3.2){
      var ns2=createNightstand();addGrp(ns2,cx-bedW/2-.3,0,cz-bedD/2+.25);
    }
    var bRug=createRug(Math.min(w*.5,1.8),Math.min(d*.3,1.0),"minimal");
    bRug.position.set(cx,.007,cz+bedD/2+.2);scene.add(bRug);
    var artFrame=box(.5,.4,.02,new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:.3}));
    artFrame.position.set(cx,1.6,cz-bedD/2+.02);scene.add(artFrame);
    var artCanvas=box(.44,.34,.01,new THREE.MeshStandardMaterial({color:0x3498DB,roughness:.85}));
    artCanvas.position.set(cx,1.6,cz-bedD/2+.035);scene.add(artCanvas);
  }
  if(r.type==="dining"){
    var tW2=Math.min(1.2,w*.4),tD2=Math.min(.8,d*.3);
    var table=createDiningTable(tW2,tD2);
    addGrp(table,cx,0,cz);
    var chairOff=.45;
    var c1=createChair(0);addGrp(c1,cx-tW2*.35,0,cz-tD2/2-chairOff);
    var c2=createChair(0);addGrp(c2,cx+tW2*.35,0,cz-tD2/2-chairOff);
    var c3=createChair(Math.PI);addGrp(c3,cx-tW2*.35,0,cz+tD2/2+chairOff);
    var c4=createChair(Math.PI);addGrp(c4,cx+tW2*.35,0,cz+tD2/2+chairOff);
  }
  if(r.type==="kitchen"){
    var kW=Math.min(w*.6,2.2),kD=.52;
    var counter=createKitchenCounter(kW,kD);
    addGrp(counter,cx,0,cz-d*.3);
    if(w>2.2){
      var fridge=createFridge();
      addGrp(fridge,cx+kW/2+.5,0,cz-d*.3);
    }
  }
  if(r.type==="bathroom"){
    var toilet=createToilet();
    addGrp(toilet,cx+w*.2,0,cz-d*.25);
    var vanity=createVanity(Math.min(.55,w*.3));
    addGrp(vanity,cx-w*.15,0,cz+d*.2);
    if(d>1.8){
      addAt(box(Math.min(.55,w*.3),.45,.02,MAT.mirror),cx-w*.15,1.35,cz+d*.35);
    }
  }
  if(r.type==="veranda"||r.type==="balcony"||r.type==="patio"){
    // Railing with posts and top rail
    var rlM=MAT.steel;
    var nP=Math.min(8,Math.max(2,Math.floor(w/.4)));
    for(var pi=0;pi<nP;pi++){
      var post=cyl(.015,.015,.9,6,rlM);
      post.position.set(cx-w*.4+pi*(w*.8/Math.max(1,nP-1)),.45,cz+d*.38);scene.add(post);
    }
    addAt(box(w*.82,.025,.025,rlM),cx,.9,cz+d*.38);
    // Second rail at mid-height
    addAt(box(w*.82,.02,.02,rlM),cx,.45,cz+d*.38);
  }
  if(r.type==="office"){
    // Desk with metal frame
    var desk=createOfficeDesk(Math.min(1.2,w*.45),Math.min(.6,d*.25));
    addGrp(desk,cx,0,cz-.1);
    // Office chair
    var oChair=createOfficeChair();
    addGrp(oChair,cx,0,cz+d*.15);
    // Monitor
    if(w>2.2){
      addAt(box(.5,.3,.02,new THREE.MeshStandardMaterial({color:0x0A0A12,roughness:.3})),cx,.95,cz-.28);
      // Monitor stand
      addAt(box(.08,.12,.08,MAT.steel),cx,.78,cz-.26);
    }
  }
  if(r.type==="staircase"){
    var nSteps=Math.min(10,Math.floor(d/.25));
    var stepW=Math.min(w*.8,1.2),stepD=d/nSteps;
    var stpM=MAT.oak;
    for(var si2=0;si2<nSteps;si2++){
      var sh2=(si2+1)*WH/nSteps;
      addAt(box(stepW,sh2,stepD-.02,stpM),cx,sh2/2,cz-d/2+stepD*si2+stepD/2);
    }
    // Stair railing
    addAt(box(.03,WH,.03,MAT.steel),cx-stepW/2-.05,WH/2,cz-d/2);
    addAt(box(.03,WH,.03,MAT.steel),cx-stepW/2-.05,WH/2,cz+d/2);
    addAt(box(.03,.03,d,MAT.oak),cx-stepW/2-.05,WH-.03,cz);
  }
  // ─── Plants in every room > 6m² ─────────────────────────────────────────────
  if(area>6&&r.type!=="staircase"&&r.type!=="bathroom"){
    var ptPot=cyl(.09,.07,.16,8,MAT.potBrown);
    ptPot.position.set(cx+w*.38,.08,cz+d*.38);scene.add(ptPot);
    var ptLeaves=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),MAT.plantGreen);
    ptLeaves.position.set(cx+w*.38,.28,cz+d*.38);ptLeaves.castShadow=true;scene.add(ptLeaves);
    if(area>12){
      var ptPot2=cyl(.07,.055,.13,8,MAT.potBrown);
      ptPot2.position.set(cx-w*.36,.065,cz-d*.36);scene.add(ptPot2);
      var ptLeaves2=new THREE.Mesh(new THREE.SphereGeometry(.12,6,6),MAT.plantGreen);
      ptLeaves2.position.set(cx-w*.36,.22,cz-d*.36);ptLeaves2.castShadow=true;scene.add(ptLeaves2);
    }
  }
});

// ─── WALLS ──────────────────────────────────────────────────────────────────
if(HAS_SVG_WALLS){
// Render wall segments from SVG parsing
var svgWallMat=new THREE.MeshStandardMaterial({map:makePlasterTex(),color:0xE8E0D4,roughness:.85,metalness:.01});
var svgIntMat=new THREE.MeshStandardMaterial({map:makePlasterTex(),color:0xEDE6DA,roughness:.88,metalness:.01});
for(var wi=0;wi<D.walls.length;wi++){
  var ww=D.walls[wi];
  if(!ww.start||!ww.end) continue;
  if(isNaN(ww.start[0])||isNaN(ww.start[1])||isNaN(ww.end[0])||isNaN(ww.end[1])) continue;
  var wdx=ww.end[0]-ww.start[0],wdz=ww.end[1]-ww.start[1];
  var wLen=Math.sqrt(wdx*wdx+wdz*wdz);
  if(wLen<0.3||isNaN(wLen)) continue; // skip fragments shorter than 0.3m
  var wAng=Math.atan2(wdx,wdz);
  var wThk=Math.max(0.08,ww.thickness||0.15);
  var wMat2=ww.type==='exterior'?svgWallMat:svgIntMat;
  var wm4=box(wThk,WH,wLen,wMat2);
  wm4.position.set((ww.start[0]+ww.end[0])/2,WH/2,(ww.start[1]+ww.end[1])/2);
  wm4.rotation.y=wAng;
  scene.add(wm4);
}
} else if(HAS_IMG){
var wallImg2=new Image();wallImg2.onload=function(){
var cv=document.createElement("canvas");var sc2=200/Math.max(wallImg2.width,wallImg2.height);
cv.width=Math.floor(wallImg2.width*sc2);cv.height=Math.floor(wallImg2.height*sc2);
var ctx=cv.getContext("2d");ctx.drawImage(wallImg2,0,0,cv.width,cv.height);
var imgD=ctx.getImageData(0,0,cv.width,cv.height);var px=imgD.data;
var cW=BW/cv.width,cD=BD/cv.height;
var wMat=new THREE.MeshStandardMaterial({color:0xE8E0D4,roughness:.85,metalness:.01});
for(var wy=0;wy<cv.height;wy++){var rs=-1;
for(var wx=0;wx<=cv.width;wx++){var iw=false;
if(wx<cv.width){var idx=(wy*cv.width+wx)*4;iw=(px[idx]+px[idx+1]+px[idx+2])/3<80;}
if(iw&&rs===-1){rs=wx;}else if(!iw&&rs!==-1){var rl=wx-rs;
if(rl>=2){var wm2=box(rl*cW,WH,cD*1.5,wMat);wm2.position.set((rs+rl/2)*cW,WH/2,wy*cD);scene.add(wm2);}
rs=-1;}}}
for(var wx2=0;wx2<cv.width;wx2++){var rs2=-1;
for(var wy2=0;wy2<=cv.height;wy2++){var iw2=false;
if(wy2<cv.height){var idx2=(wy2*cv.width+wx2)*4;iw2=(px[idx2]+px[idx2+1]+px[idx2+2])/3<80;}
if(iw2&&rs2===-1){rs2=wy2;}else if(!iw2&&rs2!==-1){var rl2=wy2-rs2;
if(rl2>=2){var wm3=box(cW*1.5,WH,rl2*cD,wMat);wm3.position.set(wx2*cW,WH/2,(rs2+rl2/2)*cD);scene.add(wm3);}
rs2=-1;}}}
};wallImg2.src=IMG_SRC;
} else {
var extMat=new THREE.MeshStandardMaterial({map:pTex,color:0xE8E0D4,roughness:.85,metalness:.01});
var intMat=new THREE.MeshStandardMaterial({map:pTex,color:0xEDE6DA,roughness:.88,metalness:.01});
var EWT=0.18,IWT=0.1,DGap=0.85,DHt=2.1;

function addWall(x,y2,z,w,h,d,mat){var m=box(w,h,d,mat);m.position.set(x,y2,z);scene.add(m)}

// Exterior: perimeter walls (polygon outline or 4 rectangular walls)
if(isNonRect){
var ol=D.buildingOutline;
for(var ei=0;ei<ol.length;ei++){
  var p1=ol[ei],p2=ol[(ei+1)%ol.length];
  var dx=p2[0]-p1[0],dz=p2[1]-p1[1];
  var segLen=Math.sqrt(dx*dx+dz*dz);
  if(segLen<0.01) continue;
  var ang=Math.atan2(dx,dz);
  var mx=(p1[0]+p2[0])/2,mz=(p1[1]+p2[1])/2;
  var wm=box(EWT,WH,segLen,extMat);
  wm.position.set(mx,WH/2,mz);
  wm.rotation.y=ang;
  scene.add(wm);
}
} else {
addWall(CX,WH/2,0,BW+EWT,WH,EWT,extMat);
addWall(CX,WH/2,BD,BW+EWT,WH,EWT,extMat);
addWall(0,WH/2,CZ,EWT,WH,BD,extMat);
addWall(BW,WH/2,CZ,EWT,WH,BD,extMat);
}

// Interior: walls between rooms that share an edge
var processed={};
for(var i=0;i<D.rooms.length;i++){
  for(var j=i+1;j<D.rooms.length;j++){
    var a=D.rooms[i],b=D.rooms[j];
    var ax=a.x,ay=a.y,aw=a.width,ad=a.depth;
    var bx=b.x,by=b.y,bw=b.width,bd=b.depth;
    var hasDoor=(a.adjacentRooms&&a.adjacentRooms.indexOf(b.name)>=0)||(b.adjacentRooms&&b.adjacentRooms.indexOf(a.name)>=0);

    var edges=[
      {wallX:ax+aw, check:Math.abs(ax+aw-bx)},
      {wallX:bx+bw, check:Math.abs(bx+bw-ax)}
    ];
    for(var ei=0;ei<edges.length;ei++){
      if(edges[ei].check<0.4){
        var wallX=edges[ei].wallX;
        var oTop=Math.max(ay,by),oBot=Math.min(ay+ad,by+bd);
        if(oBot>oTop+0.1){
          var key="v"+wallX.toFixed(1)+"_"+oTop.toFixed(1)+"_"+oBot.toFixed(1);
          if(!processed[key]){
            processed[key]=true;
            var wLen=oBot-oTop,wMid=(oTop+oBot)/2;
            if(hasDoor&&wLen>1.2){
              var halfLen=(wLen-DGap)/2;
              if(halfLen>0.1){
                addWall(wallX,WH/2,oTop+halfLen/2,IWT,WH,halfLen,intMat);
                addWall(wallX,WH/2,oBot-halfLen/2,IWT,WH,halfLen,intMat);
                var linH=WH-DHt;
                if(linH>0.05)addWall(wallX,DHt+linH/2,wMid,IWT,linH,DGap,intMat);
              }
            }else{
              addWall(wallX,WH/2,wMid,IWT,WH,wLen,intMat);
            }
          }
        }
      }
    }

    var hedges=[
      {wallZ:ay+ad, check:Math.abs(ay+ad-by)},
      {wallZ:by+bd, check:Math.abs(by+bd-ay)}
    ];
    for(var hi=0;hi<hedges.length;hi++){
      if(hedges[hi].check<0.4){
        var wallZ=hedges[hi].wallZ;
        var oLeft=Math.max(ax,bx),oRight=Math.min(ax+aw,bx+bw);
        if(oRight>oLeft+0.1){
          var key2="h"+wallZ.toFixed(1)+"_"+oLeft.toFixed(1)+"_"+oRight.toFixed(1);
          if(!processed[key2]){
            processed[key2]=true;
            var wLen2=oRight-oLeft,wMid2=(oLeft+oRight)/2;
            if(hasDoor&&wLen2>1.2){
              var halfLen2=(wLen2-DGap)/2;
              if(halfLen2>0.1){
                addWall(oLeft+halfLen2/2,WH/2,wallZ,halfLen2,WH,IWT,intMat);
                addWall(oRight-halfLen2/2,WH/2,wallZ,halfLen2,WH,IWT,intMat);
                var linH2=WH-DHt;
                if(linH2>0.05)addWall(wMid2,DHt+linH2/2,wallZ,DGap,linH2,IWT,intMat);
              }
            }else{
              addWall(wMid2,WH/2,wallZ,wLen2,WH,IWT,intMat);
            }
          }
        }
      }
    }
  }
}
}

// ─── Baseboards (subtle dark strip at wall base) ─────────────────────────────
var bbMat=new THREE.MeshStandardMaterial({color:0x4A4038,roughness:.6,metalness:.03});
var bbH=0.06,bbD=0.02;
if(HAS_SVG_WALLS){
for(var bi=0;bi<D.walls.length;bi++){
  var bw2=D.walls[bi];
  if(!bw2.start||!bw2.end)continue;
  var bdx=bw2.end[0]-bw2.start[0],bdz=bw2.end[1]-bw2.start[1];
  var bLen=Math.sqrt(bdx*bdx+bdz*bdz);
  if(bLen<0.3||isNaN(bLen))continue;
  var bAng=Math.atan2(bdx,bdz);
  var bb=box(bbD,bbH,bLen,bbMat);
  bb.position.set((bw2.start[0]+bw2.end[0])/2,bbH/2,(bw2.start[1]+bw2.end[1])/2);
  bb.rotation.y=bAng;scene.add(bb);
}
}else if(!HAS_IMG){
  // Baseboards on exterior perimeter
  if(!isNonRect){
    addAt(box(BW,bbH,bbD,bbMat),CX,bbH/2,0);
    addAt(box(BW,bbH,bbD,bbMat),CX,bbH/2,BD);
    addAt(box(bbD,bbH,BD,bbMat),0,bbH/2,CZ);
    addAt(box(bbD,bbH,BD,bbMat),BW,bbH/2,CZ);
  }
}

// ─── Crown Molding (thin dark strip at wall tops) ────────────────────────────
var cmMat=new THREE.MeshStandardMaterial({color:0x3A3430,roughness:.4,metalness:.06});
var cmH=0.04,cmD=0.03;
if(HAS_SVG_WALLS){
for(var ci=0;ci<D.walls.length;ci++){
  var cw=D.walls[ci];
  if(!cw.start||!cw.end)continue;
  var cdx=cw.end[0]-cw.start[0],cdz2=cw.end[1]-cw.start[1];
  var cLen=Math.sqrt(cdx*cdx+cdz2*cdz2);
  if(cLen<0.3||isNaN(cLen))continue;
  var cAng=Math.atan2(cdx,cdz2);
  var cm=box(cmD,cmH,cLen,cmMat);
  cm.position.set((cw.start[0]+cw.end[0])/2,WH-cmH/2,(cw.start[1]+cw.end[1])/2);
  cm.rotation.y=cAng;scene.add(cm);
}
}else if(!HAS_IMG){
  if(isNonRect){
    var ol2=D.buildingOutline;
    for(var ci2=0;ci2<ol2.length;ci2++){
      var cp1=ol2[ci2],cp2=ol2[(ci2+1)%ol2.length];
      var cdx2=cp2[0]-cp1[0],cdz3=cp2[1]-cp1[1];
      var csLen=Math.sqrt(cdx2*cdx2+cdz3*cdz3);
      if(csLen<0.01)continue;
      var csAng=Math.atan2(cdx2,cdz3);
      var csm=box(cmD+.01,cmH,csLen,cmMat);
      csm.position.set((cp1[0]+cp2[0])/2,WH-cmH/2,(cp1[1]+cp2[1])/2);
      csm.rotation.y=csAng;scene.add(csm);
    }
  }else{
    addAt(box(BW+EWT,cmH,cmD,cmMat),CX,WH-cmH/2,0);
    addAt(box(BW+EWT,cmH,cmD,cmMat),CX,WH-cmH/2,BD);
    addAt(box(cmD,cmH,BD,cmMat),0,WH-cmH/2,CZ);
    addAt(box(cmD,cmH,BD,cmMat),BW,WH-cmH/2,CZ);
  }
}

// ─── Window Glass Panes (on exterior walls) ──────────────────────────────────
var winMat=new THREE.MeshStandardMaterial({color:0xA0C8E8,roughness:.02,metalness:.1,transparent:true,opacity:.25,side:THREE.DoubleSide,envMapIntensity:.8});
var winFrameMat=new THREE.MeshStandardMaterial({color:0x2A2A2A,roughness:.4,metalness:.3,envMapIntensity:.4});
var winH=0.9,winBottom=1.0,winW=0.7;

function addWindow(wx,wz,rot){
  // Glass pane
  var glass=new THREE.Mesh(new THREE.PlaneGeometry(winW,winH),winMat);
  glass.position.set(wx,winBottom+winH/2,wz);
  glass.rotation.y=rot;scene.add(glass);
  // Frame (4 thin bars)
  var fT=0.02;
  var fTop=box(winW+fT*2,fT,fT,winFrameMat);fTop.position.set(wx,winBottom+winH,wz);fTop.rotation.y=rot;scene.add(fTop);
  var fBot=box(winW+fT*2,fT,fT,winFrameMat);fBot.position.set(wx,winBottom,wz);fBot.rotation.y=rot;scene.add(fBot);
  // Sill (slightly protruding ledge)
  var sill=box(winW+.08,.025,.06,winFrameMat);sill.position.set(wx,winBottom-.01,wz);sill.rotation.y=rot;scene.add(sill);
}

if(!HAS_SVG_WALLS&&!HAS_IMG&&!isNonRect){
  // Place windows on exterior walls — skip near corners
  var winSpacing=Math.max(winW+.8,2.0);
  // Front wall (z=0)
  for(var wx1=winSpacing/2;wx1<BW-winSpacing/2;wx1+=winSpacing){
    addWindow(wx1,-.09,0);
  }
  // Back wall (z=BD)
  for(var wx2=winSpacing/2;wx2<BW-winSpacing/2;wx2+=winSpacing){
    addWindow(wx2,BD+.09,0);
  }
  // Left wall (x=0)
  for(var wz1=winSpacing/2;wz1<BD-winSpacing/2;wz1+=winSpacing){
    addWindow(-.09,wz1,Math.PI/2);
  }
  // Right wall (x=BW)
  for(var wz2=winSpacing/2;wz2<BD-winSpacing/2;wz2+=winSpacing){
    addWindow(BW+.09,wz2,Math.PI/2);
  }
}

// ─── Camera Animation (800ms smooth transitions) ────────────────────────────
var cAnim=null;
function animTo(pos,tgt,dur){
  cAnim={sp:camera.position.clone(),ep:pos.clone(),st:controls.target.clone(),et:tgt.clone(),d:dur||800,t0:Date.now()};
}
function easeOut(t){return 1-Math.pow(1-t,3)}

// ─── Modes ───────────────────────────────────────────────────────────────────
var mode="top";
controls.enabled=false;
function setMode(m){
  mode=m;
  if(m==="top"){
    controls.enabled=false;
    animTo(new THREE.Vector3(CX,MXD*1.4,CZ+.01),new THREE.Vector3(CX,0,CZ),800);
  }else{
    controls.enabled=true;
    animTo(SP.clone(),new THREE.Vector3(CX,0,CZ),800);
  }
}
function resetCam(){
  mode="orbit";controls.enabled=true;
  animTo(SP.clone(),new THREE.Vector3(CX,0,CZ),800);
}

// ─── Label Toggle ────────────────────────────────────────────────────────────
var labelsOn=true;
function toggleLabels(){
  labelsOn=!labelsOn;
  for(var li=0;li<labels.length;li++){labels[li].visible=labelsOn}
}

// ─── First-Person Walkthrough (WASD + Mouse) ────────────────────────────────
var isWalking=false;
var fpCamera=camera.clone();
fpCamera.position.set(CX,1.6,CZ);
var fpControls=null;
try{fpControls=new THREE.PointerLockControls(fpCamera,renderer.domElement)}catch(e){console.log('[WALK] PointerLockControls not available')}
var moveF=false,moveB=false,moveL=false,moveR=false;
var walkVel=new THREE.Vector3();
var walkDir=new THREE.Vector3();
var walkClock=new THREE.Clock();

// Walk overlay
var walkOvl=document.createElement('div');
walkOvl.style.cssText='display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:white;padding:24px 36px;border-radius:14px;font-family:Inter,system-ui,sans-serif;text-align:center;z-index:9999;pointer-events:none;border:1px solid rgba(79,138,255,0.3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);';
walkOvl.innerHTML='<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#6EA0FF">First-Person Walkthrough</div><div style="font-size:13px;color:#8A8AA8;line-height:1.5">WASD to move &middot; Mouse to look &middot; ESC to exit</div>';
document.body.appendChild(walkOvl);

// Crosshair
var crosshair=document.createElement('div');
crosshair.style.cssText='display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px;z-index:50;pointer-events:none;';
crosshair.innerHTML='<svg width="20" height="20"><circle cx="10" cy="10" r="3" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1"/><line x1="10" y1="2" x2="10" y2="7" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><line x1="10" y1="13" x2="10" y2="18" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><line x1="2" y1="10" x2="7" y2="10" stroke="rgba(255,255,255,0.3)" stroke-width="1"/><line x1="13" y1="10" x2="18" y2="10" stroke="rgba(255,255,255,0.3)" stroke-width="1"/></svg>';
document.body.appendChild(crosshair);

function enterWalkMode(){
  if(!fpControls)return;
  // PointerLock requires a direct user gesture inside the iframe
  var clickOverlay=document.createElement('div');
  clickOverlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
  clickOverlay.innerHTML='<div style="text-align:center;font-family:Inter,system-ui,sans-serif;"><div style="font-size:48px;margin-bottom:16px;">\\u{1F6B6}</div><div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;">Click to Enter Walkthrough</div><div style="font-size:13px;color:#8A8AA8;line-height:1.6;">WASD to move &middot; Mouse to look &middot; ESC to exit</div></div>';
  clickOverlay.addEventListener('click',function(){
    document.body.removeChild(clickOverlay);
    isWalking=true;
    fpCamera.position.set(CX,1.6,CZ);
    fpCamera.rotation.set(0,0,0);
    controls.enabled=false;
    fpControls.lock();
    crosshair.style.display='block';
    console.log('[WALK] Entered first-person mode');
    try{parent.postMessage({type:'walkModeChanged',walking:true},'*')}catch(e){}
  });
  document.body.appendChild(clickOverlay);
}
function exitWalkMode(){
  isWalking=false;
  moveF=moveB=moveL=moveR=false;
  walkVel.set(0,0,0);
  if(fpControls&&fpControls.isLocked)fpControls.unlock();
  controls.enabled=true;
  crosshair.style.display='none';
  walkOvl.style.display='none';
  console.log('[WALK] Exited first-person mode');
  try{parent.postMessage({type:'walkModeChanged',walking:false},'*')}catch(e){}
}
if(fpControls){
  fpControls.addEventListener('lock',function(){isWalking=true});
  fpControls.addEventListener('unlock',function(){
    isWalking=false;moveF=moveB=moveL=moveR=false;walkVel.set(0,0,0);
    controls.enabled=true;crosshair.style.display='none';
    try{parent.postMessage({type:'walkModeChanged',walking:false},'*')}catch(e){}
  });
}
document.addEventListener('keydown',function(e){
  if(!isWalking)return;
  switch(e.code){
    case 'KeyW':case 'ArrowUp':moveF=true;break;
    case 'KeyS':case 'ArrowDown':moveB=true;break;
    case 'KeyA':case 'ArrowLeft':moveL=true;break;
    case 'KeyD':case 'ArrowRight':moveR=true;break;
    case 'Escape':exitWalkMode();break;
  }
});
document.addEventListener('keyup',function(e){
  switch(e.code){
    case 'KeyW':case 'ArrowUp':moveF=false;break;
    case 'KeyS':case 'ArrowDown':moveB=false;break;
    case 'KeyA':case 'ArrowLeft':moveL=false;break;
    case 'KeyD':case 'ArrowRight':moveR=false;break;
  }
});
function updateWalk(){
  if(!isWalking||!fpControls||!fpControls.isLocked)return;
  var dt=Math.min(walkClock.getDelta(),0.1);
  var speed=3.5;
  walkVel.x-=walkVel.x*10.0*dt;
  walkVel.z-=walkVel.z*10.0*dt;
  walkDir.z=Number(moveF)-Number(moveB);
  walkDir.x=Number(moveR)-Number(moveL);
  walkDir.normalize();
  if(moveF||moveB)walkVel.z-=walkDir.z*speed*dt;
  if(moveL||moveR)walkVel.x-=walkDir.x*speed*dt;
  fpControls.moveRight(-walkVel.x*dt*50);
  fpControls.moveForward(-walkVel.z*dt*50);
  fpCamera.position.y=1.6;
  fpCamera.position.x=Math.max(0.3,Math.min(BW-0.3,fpCamera.position.x));
  fpCamera.position.z=Math.max(0.3,Math.min(BD-0.3,fpCamera.position.z));
}

// ─── PostMessage API (parent controls this iframe) ──────────────────────────
function handleCmd(d){
  switch(d.type){
    case "setTopView": setMode("top"); break;
    case "setPerspective": setMode("orbit"); break;
    case "setFrontView":
      controls.enabled=false;
      animTo(new THREE.Vector3(CX,WH*.5,BD+MXD*.7),new THREE.Vector3(CX,WH*.4,CZ),800);
      break;
    case "toggleLabels": toggleLabels(); break;
    case "reset": resetCam(); break;
    case "walk": enterWalkMode(); break;
    case "exitWalk": exitWalkMode(); break;
    case "screenshot":
      renderer.render(scene,camera);
      var a=document.createElement("a");a.download="buildflow-3d.png";
      a.href=renderer.domElement.toDataURL("image/png");a.click();
      break;
    case "focusRoom":
      var fx=d.x!=null?d.x:CX,fz=d.z!=null?d.z:CZ,fs=d.distance||d.size||5;
      var fd=Math.max(fs,3)*1.2+2;
      controls.enabled=true;mode="orbit";
      animTo(new THREE.Vector3(fx+fd*.6,fd*.8,fz+fd*.6),new THREE.Vector3(fx,.5,fz),800);
      break;
  }
}
// Replace early queue listener with the real handler
window.addEventListener("message",function(ev){
  if(!ev.data||!ev.data.type)return;
  handleCmd(ev.data);
});
// Replay any commands queued while Three.js was loading
__sceneReady=true;
for(var qi=0;qi<__cmdQueue.length;qi++){handleCmd(__cmdQueue[qi])}
__cmdQueue=[];
try{parent.postMessage({type:'buildflow-ready'},'*')}catch(e){}

// ─── Global Controls API (fallback for cross-origin iframe issues) ───────────
window.buildflowControls={
  topView:function(){setMode("top")},
  perspective:function(){setMode("orbit")},
  frontView:function(){
    controls.enabled=false;
    animTo(new THREE.Vector3(CX,WH*.5,BD+MXD*.7),new THREE.Vector3(CX,WH*.4,CZ),800);
  },
  toggleLabels:function(){toggleLabels()},
  reset:function(){resetCam()},
  walk:function(){enterWalkMode()},
  exitWalk:function(){exitWalkMode()},
  screenshot:function(){
    renderer.render(scene,camera);
    var a2=document.createElement("a");a2.download="buildflow-3d.png";
    a2.href=renderer.domElement.toDataURL("image/png");a2.click();
  },
  focusRoom:function(x,z,size){
    var fd=Math.max(size||5,3)*1.2+2;
    controls.enabled=true;mode="orbit";
    animTo(new THREE.Vector3(x+fd*.6,fd*.8,z+fd*.6),new THREE.Vector3(x,.5,z),800);
  }
};
console.log("[IFRAME] buildflowControls registered on window");

// ─── Raycaster / Interaction ─────────────────────────────────────────────────
var rc=new THREE.Raycaster(),mv=new THREE.Vector2();
var tip=document.getElementById("tip"),tN=document.getElementById("tN"),tD=document.getElementById("tD");
var hov=null,isDrag=false,dS={x:0,y:0},dDist=0;

renderer.domElement.addEventListener("mousedown",function(e){isDrag=true;dS.x=e.clientX;dS.y=e.clientY;dDist=0});
renderer.domElement.addEventListener("mousemove",function(e){
  if(isDrag)dDist=Math.hypot(e.clientX-dS.x,e.clientY-dS.y);
  mv.x=(e.clientX/innerWidth)*2-1;mv.y=-(e.clientY/innerHeight)*2+1;
  rc.setFromCamera(mv,camera);
  var hits=rc.intersectObjects(rmM);
  if(hits.length){
    var rm=hits[0].object;
    if(hov&&hov!==rm){hov.material.emissive.setHex(0);hov.material.emissiveIntensity=0}
    hov=rm;rm.material.emissive.setHex(0x1a2a4a);rm.material.emissiveIntensity=.25;
    var r=rm.userData.room,a2=rm.userData.area;
    tN.textContent=r.name;
    tD.innerHTML=r.type+" \\u2014 "+(r.dimensions||(r.width.toFixed(1)+"m \\u00d7 "+r.depth.toFixed(1)+"m"))+"<br>"+a2.toFixed(1)+" m\\u00b2";
    tip.style.display="block";tip.style.left=(e.clientX+14)+"px";tip.style.top=(e.clientY+14)+"px";
  }else{
    if(hov){hov.material.emissive.setHex(0);hov.material.emissiveIntensity=0;hov=null}
    tip.style.display="none";
  }
});
window.addEventListener("mouseup",function(){isDrag=false});

// Click to focus on room
renderer.domElement.addEventListener("click",function(){
  if(dDist>4)return;
  rc.setFromCamera(mv,camera);
  var hits=rc.intersectObjects(rmM);
  if(hits.length){
    var ud=hits[0].object.userData;
    var ccx=ud.cx,ccz=ud.cz;
    var r2=ud.room;
    var vd=Math.max(r2.width,r2.depth)*1.2+2;
    controls.enabled=true;mode="orbit";
    animTo(new THREE.Vector3(ccx+vd*.6,vd*.8,ccz+vd*.6),new THREE.Vector3(ccx,.5,ccz),800);
  }
});

// ─── Post-Processing Pipeline ─────────────────────────────────────────────────
var composer=new THREE.EffectComposer(renderer);
var renderPass=new THREE.RenderPass(scene,camera);
composer.addPass(renderPass);

// Bloom (soft glow on bright surfaces)
var bloomPass=new THREE.UnrealBloomPass(
  new THREE.Vector2(innerWidth,innerHeight),
  0.15,0.4,0.85
);
composer.addPass(bloomPass);

// Color grading (warm tint + contrast + vignette)
var colorGradeShader={
  uniforms:{
    tDiffuse:{value:null},
    brightness:{value:0.02},
    contrast:{value:0.08},
    warmth:{value:0.06},
    vignette:{value:0.3}
  },
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:[
    'uniform sampler2D tDiffuse;',
    'uniform float brightness;uniform float contrast;uniform float warmth;uniform float vignette;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 color=texture2D(tDiffuse,vUv);',
    '  color.rgb+=brightness;',
    '  color.rgb=(color.rgb-0.5)*(1.0+contrast)+0.5;',
    '  color.r+=warmth*0.8;color.g+=warmth*0.4;color.b-=warmth*0.2;',
    '  vec2 center=vUv-0.5;float dist=length(center);',
    '  color.rgb*=1.0-vignette*dist*dist*2.0;',
    '  gl_FragColor=color;',
    '}'
  ].join('\\n')
};
var colorPass=new THREE.ShaderPass(colorGradeShader);
composer.addPass(colorPass);

// FXAA (anti-aliasing — smoother edges)
var fxaaPass=null;
try{
  fxaaPass=new THREE.ShaderPass(THREE.FXAAShader);
  fxaaPass.uniforms['resolution'].value.set(1/innerWidth,1/innerHeight);
  composer.addPass(fxaaPass);
}catch(e){console.log('[POST] FXAA not available:',e.message)}

// ─── Animate ─────────────────────────────────────────────────────────────────
function animate(){
  requestAnimationFrame(animate);
  if(isWalking){
    updateWalk();
    renderPass.camera=fpCamera;
    composer.render();
    renderPass.camera=camera;
  }else{
    if(cAnim){
      var t=Math.min(1,(Date.now()-cAnim.t0)/cAnim.d);
      var e2=easeOut(t);
      camera.position.lerpVectors(cAnim.sp,cAnim.ep,e2);
      controls.target.lerpVectors(cAnim.st,cAnim.et,e2);
      camera.lookAt(controls.target);
      if(t>=1){cAnim=null;controls.update()}
    }
    composer.render();
  }
}
console.log("[IFRAME] Three.js scene initialized. Rooms:",D.rooms.length,"Labels:",labels.length);
animate();
addEventListener("resize",function(){
  var w2=innerWidth,h2=innerHeight;
  camera.aspect=w2/h2;camera.updateProjectionMatrix();
  fpCamera.aspect=w2/h2;fpCamera.updateProjectionMatrix();
  renderer.setSize(w2,h2);composer.setSize(w2,h2);
  if(fxaaPass)fxaaPass.uniforms['resolution'].value.set(1/w2,1/h2);
});

// ─── DIRECT GLTF DIAGNOSTIC TEST ─────────────────────────────────────────────
// Bypasses all room mapping. Loads ONE sofa model directly into the scene center.
setTimeout(function(){
  console.log('[GLTF-TEST] ====== DIRECT GLTF DIAGNOSTIC ======');
  console.log('[GLTF-TEST] THREE version: '+(typeof THREE!=='undefined'?THREE.REVISION:'NOT LOADED'));
  console.log('[GLTF-TEST] GLTFLoader exists: '+(typeof THREE!=='undefined'&&typeof THREE.GLTFLoader!=='undefined'));
  console.log('[GLTF-TEST] gltfLoader instance: '+(gltfLoader?'YES':'NULL'));
  console.log('[GLTF-TEST] MODEL_CDN: '+MODEL_CDN);
  console.log('[GLTF-TEST] __parentOrigin: '+__parentOrigin);
  console.log('[GLTF-TEST] window.location.origin: '+window.location.origin);
  console.log('[GLTF-TEST] window.location.href: '+window.location.href.substring(0,80));

  if(!gltfLoader){
    console.error('[GLTF-TEST] ABORT: No GLTFLoader. Trying to create one...');
    if(typeof THREE!=='undefined'&&typeof THREE.GLTFLoader!=='undefined'){
      gltfLoader=new THREE.GLTFLoader();
      console.log('[GLTF-TEST] Created new GLTFLoader instance');
    }else{
      console.error('[GLTF-TEST] ABORT: THREE.GLTFLoader class not available');
      return;
    }
  }

  var proxyUrl=MODEL_CDN+'/sofa.glb';
  var directUrl='https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/models/sofa.glb';
  console.log('[GLTF-TEST] Proxy URL: '+proxyUrl);
  console.log('[GLTF-TEST] Direct URL: '+directUrl);

  // First try: fetch() to test if URL is reachable before GLTFLoader
  console.log('[GLTF-TEST] Step 1: Testing fetch() to proxy URL...');
  fetch(proxyUrl,{method:'GET'}).then(function(resp){
    console.log('[GLTF-TEST] fetch proxy: status='+resp.status+' ok='+resp.ok+' type='+resp.type+' contentType='+resp.headers.get('content-type'));
    return resp.arrayBuffer();
  }).then(function(buf){
    console.log('[GLTF-TEST] fetch proxy: received '+buf.byteLength+' bytes ('+Math.round(buf.byteLength/1024)+'KB)');
  }).catch(function(err){
    console.error('[GLTF-TEST] fetch proxy FAILED: '+err.message);
    console.log('[GLTF-TEST] Trying fetch() to direct R2 URL...');
    return fetch(directUrl,{method:'GET'}).then(function(resp){
      console.log('[GLTF-TEST] fetch direct: status='+resp.status+' ok='+resp.ok);
      return resp.arrayBuffer();
    }).then(function(buf){
      console.log('[GLTF-TEST] fetch direct: received '+buf.byteLength+' bytes');
    }).catch(function(err2){
      console.error('[GLTF-TEST] fetch direct also FAILED: '+err2.message);
    });
  });

  // Second try: actual GLTFLoader from proxy URL
  console.log('[GLTF-TEST] Step 2: Loading via GLTFLoader from proxy...');
  gltfLoader.load(proxyUrl,function(gltf){
    console.log('[GLTF-TEST] GLTFLoader SUCCESS from proxy!');
    var m=gltf.scene;
    var bbox=new THREE.Box3().setFromObject(m);
    var sz=bbox.getSize(new THREE.Vector3());
    console.log('[GLTF-TEST] Model size: '+sz.x.toFixed(2)+'x'+sz.y.toFixed(2)+'x'+sz.z.toFixed(2));
    // Place at scene center, scaled to 1m tall
    var s=1.0/Math.max(sz.y,0.01);
    m.scale.set(s,s,s);
    m.position.set(CX,0,CZ);
    m.traverse(function(ch){if(ch.isMesh){ch.castShadow=true;ch.receiveShadow=true}});
    scene.add(m);
    console.log('[GLTF-TEST] Model added to scene at center ('+CX+',0,'+CZ+') scale='+s.toFixed(4));
    console.log('[GLTF-TEST] Scene children count: '+scene.children.length);
  },function(p){
    if(p.total>0)console.log('[GLTF-TEST] proxy progress: '+Math.round(p.loaded/p.total*100)+'%');
    else console.log('[GLTF-TEST] proxy progress: '+p.loaded+' bytes loaded (total unknown)');
  },function(err){
    console.error('[GLTF-TEST] GLTFLoader PROXY FAILED: '+(err&&err.message?err.message:String(err)));
    // Fallback: try direct R2 URL
    console.log('[GLTF-TEST] Step 3: Trying GLTFLoader from direct R2 URL...');
    gltfLoader.load(directUrl,function(gltf){
      console.log('[GLTF-TEST] GLTFLoader SUCCESS from direct R2!');
      var m=gltf.scene;
      var bbox=new THREE.Box3().setFromObject(m);
      var sz=bbox.getSize(new THREE.Vector3());
      console.log('[GLTF-TEST] Model size: '+sz.x.toFixed(2)+'x'+sz.y.toFixed(2)+'x'+sz.z.toFixed(2));
      var s=1.0/Math.max(sz.y,0.01);
      m.scale.set(s,s,s);
      m.position.set(CX,0,CZ);
      m.traverse(function(ch){if(ch.isMesh){ch.castShadow=true;ch.receiveShadow=true}});
      scene.add(m);
      console.log('[GLTF-TEST] Model added from direct URL. Scene children: '+scene.children.length);
    },function(p){
      if(p.total>0)console.log('[GLTF-TEST] direct progress: '+Math.round(p.loaded/p.total*100)+'%');
    },function(err2){
      console.error('[GLTF-TEST] GLTFLoader DIRECT ALSO FAILED: '+(err2&&err2.message?err2.message:String(err2)));
      console.error('[GLTF-TEST] ====== ALL METHODS FAILED ======');
    });
  });
  console.log('[GLTF-TEST] ====== TEST DISPATCHED ======');
},3000);
<\/script>
</body>
</html>`;
}
