/**
 * Three.js Floor Plan 3D Builder — Ultra-Realistic Edition
 *
 * Self-contained HTML with embedded Three.js scene.
 * Rooms use absolute x,y positions (meters from building top-left).
 * Walls are computed from shared edges — not per-room boxes.
 * Features: 1024x1024 procedural floor textures (12-plank wood, ceramic tile, mosaic),
 * warm plaster walls with stucco texture, door frames with ajar panels + handles,
 * mullioned windows with glass + sill, per-room ceilings with recessed lights,
 * warm point lighting per room, abstract wall paintings, framed bathroom mirrors,
 * frosted-glass labels (toggle-able), smooth 800ms camera transitions,
 * click-to-focus, first-person walkthrough, GLTF furniture from R2 CDN,
 * post-processing (bloom, color grading, FXAA, vignette).
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
<title>BuildFlow \u2014 3D Floor Plan</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#F0EBE0;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E0E0E0}
canvas{display:block}
#tip{position:fixed;background:rgba(8,10,18,.92);border:1px solid rgba(79,138,255,.25);padding:10px 16px;border-radius:10px;font-size:12px;pointer-events:none;display:none;backdrop-filter:blur(12px);z-index:30;max-width:240px;box-shadow:0 4px 20px rgba(0,0,0,.5)}
#tip .tn{color:#6EA0FF;font-weight:600;font-size:13px}#tip .td{color:#A0A0B8;margin-top:3px;line-height:1.4}
</style>
</head>
<body>
<div id="bf-dbg" style="position:fixed;top:4px;left:4px;z-index:9999;background:rgba(79,138,255,0.85);color:#fff;padding:3px 8px;font-size:9px;border-radius:4px;pointer-events:none;font-family:monospace;letter-spacing:.5px">BUILDER v11.0 HYPER</div>
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
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/SSAOPass.js"><\/script>
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
var TEXTURE_CDN=__parentOrigin?__parentOrigin+'/r2-textures':'https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/textures';
var HAS_MODELS=MODEL_CDN.length>10;
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
  grad.addColorStop(0,"#C8D8E8");
  grad.addColorStop(0.3,"#D8E0E8");
  grad.addColorStop(0.6,"#E8E0D0");
  grad.addColorStop(0.85,"#F0E8D8");
  grad.addColorStop(1.0,"#F5EDE0");
  skyG.fillStyle=grad;skyG.fillRect(0,0,2,256);
  var skyTex=new THREE.CanvasTexture(skyC);
  skyTex.magFilter=THREE.LinearFilter;
  scene.background=skyTex;
})();
scene.fog=new THREE.FogExp2(0xF0EBE0,0.005);

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
renderer.toneMappingExposure=1.15;
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
  envScene.add(new THREE.AmbientLight(0xF0E8D0,0.8));
  var envMap=pmremGen.fromScene(envScene,0).texture;
  scene.environment=envMap;
  pmremGen.dispose();
})();

// ─── Lights (warm golden-hour key + warm fill + sky hemisphere) ──────────────
scene.add(new THREE.AmbientLight(0xFFF0D8,.4));
var sun=new THREE.DirectionalLight(0xFFE8B0,3.2);
sun.position.set(BW*0.7,18,-BD*0.3);sun.castShadow=true;
sun.shadow.mapSize.set(4096,4096);
var sc=sun.shadow.camera;sc.left=-BW-4;sc.right=BW+4;sc.top=BD+4;sc.bottom=-BD-4;sc.near=1;sc.far=60;
sun.shadow.bias=-.00008;sun.shadow.normalBias=.012;sun.shadow.radius=2.5;scene.add(sun);
var fill=new THREE.DirectionalLight(0xF0E0D0,.7);
fill.position.set(-BW*0.5,12,BD*0.5);scene.add(fill);
var rim=new THREE.DirectionalLight(0xF0E0C8,.2);
rim.position.set(CX,-2,CZ-MXD);scene.add(rim);
scene.add(new THREE.HemisphereLight(0xFFF5E8,0xA89070,.9));

// ─── Anisotropic Filtering ───────────────────────────────────────────────────
var maxAniso=renderer.capabilities.getMaxAnisotropy();

// ─── Real PBR Texture Loader (R2 CDN with solid-color fallback) ──────────────
var texLoader=new THREE.TextureLoader();
function loadPBRTex(mat,name,rx,ry,normalStr){
  texLoader.load(TEXTURE_CDN+'/'+name+'-color.jpg',function(tex){
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(rx,ry);
    tex.anisotropy=maxAniso;
    tex.encoding=THREE.sRGBEncoding;
    // Disable mipmaps — prevents texture fading to white at steep angles
    tex.generateMipmaps=false;
    tex.minFilter=THREE.LinearFilter;
    tex.magFilter=THREE.LinearFilter;
    mat.map=tex;
    mat.color.set(0xFFFFFF); // Reset to white so texture shows true colors (no tinting)
    mat.needsUpdate=true;
  },null,function(){console.warn('[TEX] Failed: '+name+'-color.jpg — using solid color fallback')});
  texLoader.load(TEXTURE_CDN+'/'+name+'-normal.jpg',function(tex){
    tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
    tex.repeat.set(rx,ry);
    tex.generateMipmaps=false;
    tex.minFilter=THREE.LinearFilter;
    tex.magFilter=THREE.LinearFilter;
    mat.normalMap=tex;mat.normalScale=new THREE.Vector2(normalStr,normalStr);
    mat.needsUpdate=true;
  },null,function(){});
}

// ─── Texture helpers ────────────────────────────────────────────────────────
function shiftHex(hex,amt){
  var r=Math.max(0,Math.min(255,((hex>>16)&0xff)+amt));
  var g=Math.max(0,Math.min(255,((hex>>8)&0xff)+amt));
  var b=Math.max(0,Math.min(255,(hex&0xff)+amt));
  return 'rgb('+r+','+g+','+b+')';
}
// Legacy stub — returns flat solid color canvas (no planks, no stripes, nothing)
function makeFloorTex(type,hex){
  var S=4,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  var R=(hex>>16)&0xff,G=(hex>>8)&0xff,B=hex&0xff;
  g.fillStyle="rgb("+R+","+G+","+B+")";g.fillRect(0,0,S,S);
  var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}

function makePlasterTex(){
  var S=512,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  g.fillStyle="#F2EDE4";g.fillRect(0,0,S,S);
  // Plaster micro-texture — warm stucco feel with varied stippling
  for(var i=0;i<5000;i++){
    var v=228+Math.floor(Math.random()*22-11);
    var warm=Math.random()>0.5?3:0;
    g.fillStyle='rgb('+(v+warm)+','+(v-2)+','+(v-7)+')';
    g.fillRect(Math.random()*S,Math.random()*S,1+Math.random()*2,1+Math.random()*1.5);
  }
  // Subtle trowel/brush marks (more of them, lighter)
  for(var tm=0;tm<14;tm++){
    g.strokeStyle='rgba(0,0,0,'+(0.008+Math.random()*0.015)+')';
    g.lineWidth=0.6+Math.random()*1.2;
    g.beginPath();
    var tmx=Math.random()*S,tmy=Math.random()*S;
    g.moveTo(tmx,tmy);
    for(var ts=0;ts<8;ts++){tmx+=Math.random()*60-30;tmy+=Math.random()*50-15;g.lineTo(tmx,tmy)}
    g.stroke();
  }
  // Very subtle warm patches (simulates paint unevenness)
  for(var wp=0;wp<4;wp++){
    var wpx=Math.random()*S,wpy=Math.random()*S;
    var wpGrad=g.createRadialGradient(wpx,wpy,0,wpx,wpy,40+Math.random()*60);
    wpGrad.addColorStop(0,'rgba(245,235,215,0.08)');wpGrad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=wpGrad;g.fillRect(wpx-80,wpy-80,160,160);
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

// ─── Normal Map Generator (canvas height → tangent-space normal) ─────────────
function heightToNormal(hC,str){
  var w2=hC.width,h2=hC.height,hx=hC.getContext('2d');
  var hD=hx.getImageData(0,0,w2,h2).data;
  var nC=document.createElement('canvas');nC.width=w2;nC.height=h2;
  var nx=nC.getContext('2d'),nD=nx.createImageData(w2,h2),np=nD.data;
  str=str||2.0;
  for(var ny=0;ny<h2;ny++){for(var nx2=0;nx2<w2;nx2++){
    var i=(ny*w2+nx2)*4;
    var l=nx2>0?hD[((ny*w2+nx2-1)*4)]:hD[i];
    var r2=nx2<w2-1?hD[((ny*w2+nx2+1)*4)]:hD[i];
    var t2=ny>0?hD[(((ny-1)*w2+nx2)*4)]:hD[i];
    var b2=ny<h2-1?hD[(((ny+1)*w2+nx2)*4)]:hD[i];
    var ddx=(l-r2)/255*str,ddy=(t2-b2)/255*str;
    var len=Math.sqrt(ddx*ddx+ddy*ddy+1);
    np[i]=((ddx/len*0.5+0.5)*255)|0;
    np[i+1]=((ddy/len*0.5+0.5)*255)|0;
    np[i+2]=((1/len*0.5+0.5)*255)|0;
    np[i+3]=255;
  }}
  nx.putImageData(nD,0,0);return nC;
}
// Derive normal map from an albedo canvas (luminance → height → normal)
function albedoToNormal(albedoCanvas,str){
  var w2=albedoCanvas.width,h2=albedoCanvas.height;
  var ctx=albedoCanvas.getContext('2d');
  var sd=ctx.getImageData(0,0,w2,h2).data;
  var hC=document.createElement('canvas');hC.width=w2;hC.height=h2;
  var hx=hC.getContext('2d'),hD=hx.createImageData(w2,h2),hp=hD.data;
  for(var i=0;i<sd.length;i+=4){
    var g2=(sd[i]*0.3+sd[i+1]*0.59+sd[i+2]*0.11)|0;
    hp[i]=hp[i+1]=hp[i+2]=g2;hp[i+3]=255;
  }
  hx.putImageData(hD,0,0);
  return heightToNormal(hC,str);
}
// ─── Floor Material Factory (wood PBR texture for ALL rooms) ────────────────
function makePBRFloor(type,hex,rw,rd){
  var rx=Math.max(1,rw/2),ry=Math.max(1,rd/2);
  // All rooms get wood texture — consistent, professional look
  var rough=type==='tile'?0.4:type==='stone'?0.6:0.55;
  var mat=new THREE.MeshStandardMaterial({color:hex,roughness:rough,metalness:0.0,envMapIntensity:0.3,side:THREE.DoubleSide});
  loadPBRTex(mat,'wood',rx,ry,0.8);
  return mat;
}

// ─── PBR Wall Material (real plaster textures from R2 CDN) ───────────────
function makePBRWall(isExt){
  // Start with procedural plaster as instant fallback
  var diff=makePlasterTex();
  var nCanvas=albedoToNormal(diff.image,1.2);
  var nTex=new THREE.CanvasTexture(nCanvas);
  nTex.wrapS=nTex.wrapT=THREE.RepeatWrapping;
  nTex.repeat.copy(diff.repeat);
  var mat=new THREE.MeshStandardMaterial({map:diff,normalMap:nTex,normalScale:new THREE.Vector2(0.3,0.3),color:isExt?0xEDE5D8:0xF2EDE4,roughness:isExt?0.78:0.82,metalness:0.01,envMapIntensity:0.15});
  // Upgrade to real PBR plaster texture when loaded
  loadPBRTex(mat,'plaster',3,1.5,0.3);
  return mat;
}

// ─── Color / texture maps ────────────────────────────────────────────────────
var TT={living:"wood",dining:"wood",bedroom:"wood",office:"wood",studio:"wood",kitchen:"wood",bathroom:"wood",veranda:"wood",balcony:"wood",patio:"wood",hallway:"wood",entrance:"wood",passage:"wood",staircase:"wood",utility:"wood",storage:"wood",closet:"wood",other:"wood"};
var FC={living:0xB89B6A,dining:0xB89B6A,kitchen:0xD4C4A8,bedroom:0xB89B6A,bathroom:0xE8E0D4,veranda:0xC0B098,balcony:0xC0B098,patio:0xC0B098,hallway:0xB89B6A,entrance:0xB89B6A,passage:0xB89B6A,staircase:0xB89B6A,utility:0xB89B6A,storage:0xB89B6A,closet:0xB89B6A,office:0xB89B6A,studio:0xB89B6A,other:0xB89B6A};
var LC={living:"#4F8AFF",dining:"#4F8AFF",studio:"#4F8AFF",bedroom:"#8B5CF6",office:"#8B5CF6",kitchen:"#10B981",bathroom:"#3B82F6",veranda:"#10B981",balcony:"#10B981",patio:"#10B981",hallway:"#F59E0B",entrance:"#F59E0B",passage:"#F59E0B",staircase:"#F59E0B",utility:"#707080",storage:"#707080",closet:"#707080",other:"#8888A0"};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function box(w,h,d,mat){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.castShadow=true;m.receiveShadow=true;return m}
function addAt(m,x,y,z){m.position.set(x,y,z);scene.add(m);return m}
function addGrp(g,x,y,z){g.position.set(x,y,z);scene.add(g);return g}
function cyl(rt,rb,h,seg,mat){var m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||12),mat);m.castShadow=true;return m}

// ─── GLTF Model Loader (real 3D furniture from R2 CDN) ──────────────────────
// Performance architecture:
//   1. Procedural geometry renders INSTANTLY — user never sees empty rooms
//   2. GLTF models load async from R2 CDN (edge-cached globally, <50ms latency)
//   3. Priority queue: essential furniture (bed, sofa, table) loads FIRST
//   4. Concurrency limiter: max 4 simultaneous downloads (no browser choking)
//   5. Model cache: same model reused across rooms (clone, don't re-download)
//   6. Deduplication: if sofa.glb is already downloading, queue waits for it
var gltfLoader=typeof THREE.GLTFLoader!=='undefined'?new THREE.GLTFLoader():null;
var modelCache={};
var modelAvailable={};
var gltfTotal=0,gltfLoaded=0,gltfFailed=0;

// ─── Loading Queue (max 4 concurrent, priority-sorted) ─────────────────────
var MAX_CONCURRENT=4;
var loadQueue=[];
var activeLoads=0;
var loadingPromises={}; // dedup: filename → promise for in-flight downloads

// Priority tiers: essential furniture first, decorative last
var PRIORITY_TIER={
  'bed':1,'sofa':1,'dining-table':1,'office-desk':1,'toilet':1,'fridge':1,
  'kitchen-counter':1,'washing-machine':1,'bathroom-vanity':1,
  'nightstand':2,'coffee-table':2,'tv-unit':2,'dining-chair':2,'office-chair':2,
  'wardrobe':2,'stove-range':2,'bathtub':2,'rain-shower':2,'shoe-cabinet':2,
  'bookshelf':3,'dresser':3,'armchair':3,'kitchen-island':3,'bar-stool':3,
  'dining-sideboard':3,'console-table':3,'outdoor-chair':3,'outdoor-table':3,
  'monitor':3,'filing-cabinet':3,'utility-shelf':3,'dryer':3,
  'floor-lamp':4,'potted-plant':4,'table-lamp':4,'curtain-set':4,
  'side-table':4,'full-mirror':4,'bedroom-bench':4,'coat-rack':4,
  'wall-clock':5,'throw-pillow-set':5,'wall-art-frame':5,'desk-organizer':5,
  'bath-mat':5,'welcome-mat':5,'outdoor-rug':5,'potted-herb':5,
  'key-holder':5,'toilet-paper-holder':5,'bathroom-shelf':5,'coat-hooks':5,
  'railing-planter':5,'outdoor-lantern':5,'mop-bucket':5,'laundry-basket':5,
  'desk-lamp':4,'microwave':4,'dish-rack':5,'range-hood':3,'upper-cabinet':3,
  'kitchen-pendant':5,'hall-pendant':5,'dining-pendant':4,'table-centerpiece':5,
  'wine-rack':5,'towel-warmer':5,'iron-board':5,'wall-mirror-hall':4,
  'bathroom-mirror':3,'umbrella-stand':5
};

function queueLoadGLTF(filename,targetX,targetZ,targetW,targetD,rotY,roomName){
  var id=filename.replace('.glb','');
  var priority=PRIORITY_TIER[id]||5;
  gltfTotal++;
  updateLoadBar();
  loadQueue.push({filename:filename,targetX:targetX,targetZ:targetZ,targetW:targetW,targetD:targetD,rotY:rotY,roomName:roomName,priority:priority,id:id});
}

function flushQueue(){
  // Sort: lower priority number = loads first
  loadQueue.sort(function(a,b){return a.priority-b.priority});
  processQueue();
}

function processQueue(){
  while(activeLoads<MAX_CONCURRENT&&loadQueue.length>0){
    var job=loadQueue.shift();
    startLoad(job);
  }
}

function startLoad(job){
  var id=job.id;
  var filename=job.filename;

  // Clone from cache if available (instant, no network)
  if(modelCache[id]){
    var cd=modelCache[id];
    var clone=cd.model.clone();
    var fitS=Math.min(job.targetW/Math.max(cd.rawW,0.01),job.targetD/Math.max(cd.rawD,0.01))*0.95;
    var thS=(MODEL_TARGET_H[id]||1.0)/Math.max(cd.rawH,0.01);
    var s=Math.min(fitS,thS);
    var yOff=-cd.bboxMinY*s;
    placeModel(clone,s,yOff,job.targetX,job.targetZ,job.rotY,job.roomName,filename);
    gltfLoaded++;
    updateLoadBar();
    setTimeout(processQueue,0); // defer to avoid stack overflow with many cached items
    return;
  }

  activeLoads++;

  // Dedup: if same file is already downloading, wait for it then clone
  if(loadingPromises[id]){
    loadingPromises[id].then(function(){
      activeLoads--;
      if(modelCache[id]){
        var cd2=modelCache[id];
        var clone2=cd2.model.clone();
        var fitS2=Math.min(job.targetW/Math.max(cd2.rawW,0.01),job.targetD/Math.max(cd2.rawD,0.01))*0.95;
        var thS2=(MODEL_TARGET_H[id]||1.0)/Math.max(cd2.rawH,0.01);
        var s2=Math.min(fitS2,thS2);
        placeModel(clone2,s2,-cd2.bboxMinY*s2,job.targetX,job.targetZ,job.rotY,job.roomName,filename);
        gltfLoaded++;
      }else{gltfFailed++}
      updateLoadBar();
      processQueue();
    });
    return;
  }

  var url=MODEL_CDN+'/'+filename;
  loadingPromises[id]=new Promise(function(resolve){
    gltfLoader.load(url,function(gltf){
      var m=gltf.scene;
      var bbox=new THREE.Box3().setFromObject(m);
      var sz=bbox.getSize(new THREE.Vector3());
      modelCache[id]={model:m.clone(),rawW:sz.x,rawH:sz.y,rawD:sz.z,bboxMinY:bbox.min.y};
      var fitS=Math.min(job.targetW/Math.max(sz.x,0.01),job.targetD/Math.max(sz.z,0.01))*0.95;
      var thS=(MODEL_TARGET_H[id]||1.0)/Math.max(sz.y,0.01);
      var s=Math.min(fitS,thS);
      s=Math.max(0.0001,s);
      placeModel(m,s,-bbox.min.y*s,job.targetX,job.targetZ,job.rotY,job.roomName,filename);
      gltfLoaded++;
      updateLoadBar();
      activeLoads--;
      resolve();
      processQueue();
    },function(p){
      if(p.total>0){Math.round(p.loaded/p.total*100)}
    },function(err){
      console.warn('[GLTF] FAIL '+filename+': '+(err&&err.message||err));
      gltfFailed++;
      updateLoadBar();
      activeLoads--;
      resolve();
      processQueue();
    });
  });
}

// Loading progress UI
var loadingBar=document.createElement('div');
loadingBar.style.cssText='position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#E0E0E0;padding:8px 20px;border-radius:10px;font-family:Inter,system-ui,sans-serif;font-size:12px;z-index:100;display:none;border:1px solid rgba(79,138,255,0.2);';
document.body.appendChild(loadingBar);
function updateLoadBar(){
  if(gltfTotal===0){loadingBar.style.display='none';return}
  var done=gltfLoaded+gltfFailed;
  if(done>=gltfTotal){loadingBar.textContent='\\u2714 Furniture loaded ('+gltfLoaded+'/'+gltfTotal+')';setTimeout(function(){loadingBar.style.display='none'},2500);return}
  loadingBar.style.display='block';
  loadingBar.textContent='Loading furniture: '+done+'/'+gltfTotal+' ('+Math.round(done/gltfTotal*100)+'%)';
}

// Target heights (meters) for auto-scaling GLTF models — realistic proportions
// Includes ALL furniture items from the expanded catalog
var MODEL_TARGET_H={
  // ── On R2 CDN (existing) ──
  'sofa':0.88,'coffee-table':0.45,'potted-plant':0.8,'floor-lamp':1.75,
  'tv-unit':0.55,'bed':0.75,'nightstand':0.58,'dining-table':0.78,
  'dining-chair':0.88,'fridge':1.85,'toilet':0.45,'bathroom-vanity':0.88,
  'office-desk':0.78,'office-chair':1.15,
  // ── Living room ──
  'armchair':0.85,'side-table':0.55,'bookshelf':1.6,'wall-clock':0.35,
  'curtain-set':2.4,'throw-pillow-set':0.2,
  // ── Bedroom ──
  'wardrobe':2.1,'table-lamp':0.42,'dresser':0.82,'full-mirror':1.6,
  'bedroom-bench':0.45,
  // ── Kitchen ──
  'kitchen-counter':0.9,'stove-range':0.9,'range-hood':0.5,'upper-cabinet':0.7,
  'kitchen-island':0.9,'bar-stool':0.75,'microwave':0.3,'dish-rack':0.25,
  'kitchen-pendant':0.25,'potted-herb':0.25,
  // ── Dining ──
  'dining-pendant':0.35,'dining-sideboard':0.8,'wine-rack':0.9,
  'table-centerpiece':0.25,'wall-art-frame':0.6,
  // ── Bathroom ──
  'bathroom-mirror':0.7,'rain-shower':2.1,'towel-warmer':0.9,'bathtub':0.55,
  'toilet-paper-holder':0.15,'bathroom-shelf':0.3,'bath-mat':0.02,
  // ── Office ──
  'desk-lamp':0.5,'monitor':0.45,'filing-cabinet':0.68,'desk-organizer':0.15,
  // ── Hallway ──
  'console-table':0.78,'wall-mirror-hall':0.8,'coat-hooks':0.15,'hall-pendant':0.2,
  // ── Entrance ──
  'shoe-cabinet':0.85,'coat-rack':1.75,'welcome-mat':0.02,'key-holder':0.12,
  'umbrella-stand':0.55,
  // ── Veranda/Balcony/Patio ──
  'outdoor-chair':0.82,'outdoor-table':0.45,'railing-planter':0.2,
  'outdoor-lantern':0.35,'outdoor-rug':0.01,
  // ── Utility/Storage ──
  'washing-machine':0.85,'dryer':0.85,'utility-shelf':1.8,'iron-board':0.9,
  'laundry-basket':0.55,'mop-bucket':0.35
};

// Helper to place a model scene node (shared by queue + cache)
function placeModel(m,s,yOff,targetX,targetZ,rotY,roomName,filename){
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
  removeProcItem(roomName,filename);
}

var __procGroups={};
function removeProcItem(roomName,fname){
  if(!roomName)return;
  var pg=__procGroups[roomName];
  if(!pg)return;
  var gid=fname.replace('.glb','');
  var toRemove=[];
  pg.children.forEach(function(ch){if(ch.userData&&ch.userData.gltfId===gid)toRemove.push(ch)});
  toRemove.forEach(function(obj){pg.remove(obj)});
}

// Legacy wrapper — now queues instead of firing immediately
function loadGLTF(filename,targetX,targetZ,targetW,targetD,rotY,roomName){
  if(!gltfLoader){return}
  queueLoadGLTF(filename,targetX,targetZ,targetW,targetD,rotY,roomName);
}

// Room-type → GLTF model definitions (Phase 1: enlarged + more items)
// rx,rz = position as fraction of room; wF,dF = size as fraction of room
var ROOM_MODELS={
  living:[
    {file:'sofa.glb',rx:0.5,rz:0.22,wF:0.7,dF:0.35,rot:0},
    {file:'coffee-table.glb',rx:0.5,rz:0.48,wF:0.3,dF:0.22,rot:0},
    {file:'tv-unit.glb',rx:0.5,rz:0.88,wF:0.5,dF:0.18,rot:Math.PI},
    {file:'potted-plant.glb',rx:0.9,rz:0.1,wF:0.12,dF:0.12,rot:0},
    {file:'floor-lamp.glb',rx:0.1,rz:0.1,wF:0.1,dF:0.1,rot:0},
    {file:'potted-plant.glb',rx:0.1,rz:0.88,wF:0.1,dF:0.1,rot:0},
    {file:'armchair.glb',rx:0.15,rz:0.55,wF:0.2,dF:0.2,rot:Math.PI/6},
    {file:'side-table.glb',rx:0.88,rz:0.22,wF:0.1,dF:0.1,rot:0},
    {file:'bookshelf.glb',rx:0.95,rz:0.5,wF:0.1,dF:0.3,rot:-Math.PI/2},
    {file:'wall-clock.glb',rx:0.5,rz:0.96,wF:0.08,dF:0.02,rot:Math.PI},
    {file:'curtain-set.glb',rx:0.5,rz:0.04,wF:0.6,dF:0.05,rot:0},
    {file:'throw-pillow-set.glb',rx:0.42,rz:0.2,wF:0.15,dF:0.1,rot:0.15},
  ],
  studio:[
    {file:'sofa.glb',rx:0.5,rz:0.22,wF:0.6,dF:0.3,rot:0},
    {file:'coffee-table.glb',rx:0.5,rz:0.45,wF:0.25,dF:0.18,rot:0},
    {file:'tv-unit.glb',rx:0.5,rz:0.88,wF:0.4,dF:0.14,rot:Math.PI},
    {file:'floor-lamp.glb',rx:0.1,rz:0.1,wF:0.08,dF:0.08,rot:0},
    {file:'potted-plant.glb',rx:0.9,rz:0.1,wF:0.1,dF:0.1,rot:0},
    {file:'bookshelf.glb',rx:0.95,rz:0.5,wF:0.1,dF:0.25,rot:-Math.PI/2},
  ],
  bedroom:[
    {file:'bed.glb',rx:0.5,rz:0.35,wF:0.75,dF:0.7,rot:0},
    {file:'nightstand.glb',rx:0.88,rz:0.2,wF:0.13,dF:0.13,rot:0},
    {file:'nightstand.glb',rx:0.12,rz:0.2,wF:0.13,dF:0.13,rot:0},
    {file:'potted-plant.glb',rx:0.08,rz:0.88,wF:0.08,dF:0.08,rot:0},
    {file:'wardrobe.glb',rx:0.82,rz:0.85,wF:0.3,dF:0.2,rot:Math.PI},
    {file:'table-lamp.glb',rx:0.88,rz:0.2,wF:0.06,dF:0.06,rot:0},
    {file:'table-lamp.glb',rx:0.12,rz:0.2,wF:0.06,dF:0.06,rot:0},
    {file:'dresser.glb',rx:0.18,rz:0.88,wF:0.25,dF:0.14,rot:Math.PI},
    {file:'full-mirror.glb',rx:0.18,rz:0.92,wF:0.12,dF:0.03,rot:Math.PI},
    {file:'bedroom-bench.glb',rx:0.5,rz:0.72,wF:0.4,dF:0.1,rot:0},
    {file:'curtain-set.glb',rx:0.5,rz:0.04,wF:0.6,dF:0.05,rot:0},
  ],
  dining:[
    {file:'dining-table.glb',rx:0.5,rz:0.5,wF:0.55,dF:0.45,rot:0},
    {file:'dining-chair.glb',rx:0.22,rz:0.5,wF:0.16,dF:0.16,rot:Math.PI/2},
    {file:'dining-chair.glb',rx:0.78,rz:0.5,wF:0.16,dF:0.16,rot:-Math.PI/2},
    {file:'dining-chair.glb',rx:0.5,rz:0.22,wF:0.16,dF:0.16,rot:0},
    {file:'dining-chair.glb',rx:0.5,rz:0.78,wF:0.16,dF:0.16,rot:Math.PI},
    {file:'potted-plant.glb',rx:0.9,rz:0.1,wF:0.1,dF:0.1,rot:0},
    {file:'dining-pendant.glb',rx:0.5,rz:0.5,wF:0.1,dF:0.1,rot:0},
    {file:'dining-sideboard.glb',rx:0.5,rz:0.94,wF:0.4,dF:0.1,rot:Math.PI},
    {file:'wine-rack.glb',rx:0.9,rz:0.92,wF:0.1,dF:0.08,rot:-Math.PI/2},
    {file:'table-centerpiece.glb',rx:0.5,rz:0.5,wF:0.08,dF:0.08,rot:0},
    {file:'wall-art-frame.glb',rx:0.5,rz:0.04,wF:0.2,dF:0.02,rot:0},
  ],
  kitchen:[
    {file:'fridge.glb',rx:0.9,rz:0.12,wF:0.18,dF:0.2,rot:0},
    {file:'kitchen-counter.glb',rx:0.5,rz:0.08,wF:0.65,dF:0.18,rot:0},
    {file:'stove-range.glb',rx:0.35,rz:0.08,wF:0.18,dF:0.18,rot:0},
    {file:'range-hood.glb',rx:0.35,rz:0.04,wF:0.18,dF:0.12,rot:0},
    {file:'upper-cabinet.glb',rx:0.6,rz:0.04,wF:0.4,dF:0.1,rot:0},
    {file:'kitchen-island.glb',rx:0.5,rz:0.55,wF:0.35,dF:0.2,rot:0},
    {file:'bar-stool.glb',rx:0.35,rz:0.62,wF:0.08,dF:0.08,rot:0},
    {file:'bar-stool.glb',rx:0.65,rz:0.62,wF:0.08,dF:0.08,rot:0},
    {file:'microwave.glb',rx:0.65,rz:0.08,wF:0.1,dF:0.1,rot:0},
    {file:'dish-rack.glb',rx:0.2,rz:0.08,wF:0.1,dF:0.08,rot:0},
    {file:'kitchen-pendant.glb',rx:0.5,rz:0.5,wF:0.08,dF:0.08,rot:0},
    {file:'potted-herb.glb',rx:0.75,rz:0.08,wF:0.06,dF:0.06,rot:0},
  ],
  bathroom:[
    {file:'toilet.glb',rx:0.75,rz:0.25,wF:0.18,dF:0.22,rot:-Math.PI/2},
    {file:'bathroom-vanity.glb',rx:0.35,rz:0.08,wF:0.4,dF:0.18,rot:0},
    {file:'bathroom-mirror.glb',rx:0.35,rz:0.04,wF:0.25,dF:0.03,rot:0},
    {file:'rain-shower.glb',rx:0.15,rz:0.8,wF:0.25,dF:0.25,rot:0},
    {file:'towel-warmer.glb',rx:0.92,rz:0.6,wF:0.06,dF:0.03,rot:-Math.PI/2},
    {file:'bathtub.glb',rx:0.35,rz:0.78,wF:0.45,dF:0.22,rot:0},
    {file:'toilet-paper-holder.glb',rx:0.85,rz:0.22,wF:0.04,dF:0.04,rot:-Math.PI/2},
    {file:'bathroom-shelf.glb',rx:0.92,rz:0.4,wF:0.06,dF:0.1,rot:-Math.PI/2},
    {file:'bath-mat.glb',rx:0.35,rz:0.2,wF:0.18,dF:0.12,rot:0},
  ],
  office:[
    {file:'office-desk.glb',rx:0.5,rz:0.25,wF:0.55,dF:0.25,rot:0},
    {file:'office-chair.glb',rx:0.5,rz:0.55,wF:0.18,dF:0.18,rot:Math.PI},
    {file:'potted-plant.glb',rx:0.92,rz:0.88,wF:0.08,dF:0.08,rot:0},
    {file:'bookshelf.glb',rx:0.95,rz:0.5,wF:0.1,dF:0.28,rot:-Math.PI/2},
    {file:'desk-lamp.glb',rx:0.35,rz:0.2,wF:0.06,dF:0.06,rot:0},
    {file:'monitor.glb',rx:0.5,rz:0.2,wF:0.14,dF:0.06,rot:0},
    {file:'filing-cabinet.glb',rx:0.12,rz:0.2,wF:0.1,dF:0.12,rot:Math.PI/2},
    {file:'desk-organizer.glb',rx:0.62,rz:0.2,wF:0.06,dF:0.04,rot:0},
    {file:'wall-clock.glb',rx:0.5,rz:0.04,wF:0.08,dF:0.02,rot:0},
  ],
  hallway:[
    {file:'console-table.glb',rx:0.5,rz:0.08,wF:0.35,dF:0.1,rot:0},
    {file:'wall-mirror-hall.glb',rx:0.5,rz:0.04,wF:0.2,dF:0.03,rot:0},
    {file:'coat-hooks.glb',rx:0.88,rz:0.04,wF:0.08,dF:0.03,rot:0},
    {file:'hall-pendant.glb',rx:0.5,rz:0.5,wF:0.06,dF:0.06,rot:0},
    {file:'potted-plant.glb',rx:0.85,rz:0.5,wF:0.1,dF:0.1,rot:0},
    {file:'wall-art-frame.glb',rx:0.92,rz:0.5,wF:0.12,dF:0.02,rot:-Math.PI/2},
  ],
  entrance:[
    {file:'shoe-cabinet.glb',rx:0.75,rz:0.08,wF:0.25,dF:0.1,rot:0},
    {file:'console-table.glb',rx:0.35,rz:0.08,wF:0.25,dF:0.08,rot:0},
    {file:'coat-rack.glb',rx:0.92,rz:0.3,wF:0.08,dF:0.08,rot:0},
    {file:'wall-mirror-hall.glb',rx:0.35,rz:0.04,wF:0.15,dF:0.03,rot:0},
    {file:'welcome-mat.glb',rx:0.5,rz:0.85,wF:0.2,dF:0.12,rot:0},
    {file:'key-holder.glb',rx:0.22,rz:0.04,wF:0.06,dF:0.03,rot:0},
    {file:'umbrella-stand.glb',rx:0.92,rz:0.7,wF:0.06,dF:0.06,rot:0},
  ],
  passage:[
    {file:'hall-pendant.glb',rx:0.5,rz:0.5,wF:0.06,dF:0.06,rot:0},
    {file:'potted-plant.glb',rx:0.85,rz:0.5,wF:0.1,dF:0.1,rot:0},
  ],
  veranda:[
    {file:'outdoor-chair.glb',rx:0.3,rz:0.4,wF:0.18,dF:0.18,rot:Math.PI/4},
    {file:'outdoor-chair.glb',rx:0.7,rz:0.4,wF:0.18,dF:0.18,rot:-Math.PI/4},
    {file:'outdoor-table.glb',rx:0.5,rz:0.45,wF:0.12,dF:0.12,rot:0},
    {file:'railing-planter.glb',rx:0.5,rz:0.92,wF:0.25,dF:0.06,rot:0},
    {file:'potted-plant.glb',rx:0.15,rz:0.25,wF:0.12,dF:0.12,rot:0},
    {file:'potted-plant.glb',rx:0.85,rz:0.75,wF:0.12,dF:0.12,rot:0},
    {file:'outdoor-lantern.glb',rx:0.15,rz:0.1,wF:0.06,dF:0.06,rot:0},
    {file:'outdoor-rug.glb',rx:0.5,rz:0.4,wF:0.4,dF:0.35,rot:0},
  ],
  balcony:[
    {file:'outdoor-chair.glb',rx:0.3,rz:0.4,wF:0.18,dF:0.18,rot:Math.PI/4},
    {file:'outdoor-table.glb',rx:0.5,rz:0.45,wF:0.12,dF:0.12,rot:0},
    {file:'railing-planter.glb',rx:0.5,rz:0.92,wF:0.25,dF:0.06,rot:0},
    {file:'potted-plant.glb',rx:0.15,rz:0.25,wF:0.12,dF:0.12,rot:0},
    {file:'outdoor-lantern.glb',rx:0.85,rz:0.1,wF:0.06,dF:0.06,rot:0},
  ],
  patio:[
    {file:'outdoor-chair.glb',rx:0.3,rz:0.4,wF:0.18,dF:0.18,rot:Math.PI/4},
    {file:'outdoor-chair.glb',rx:0.7,rz:0.4,wF:0.18,dF:0.18,rot:-Math.PI/4},
    {file:'outdoor-table.glb',rx:0.5,rz:0.45,wF:0.12,dF:0.12,rot:0},
    {file:'potted-plant.glb',rx:0.15,rz:0.25,wF:0.12,dF:0.12,rot:0},
    {file:'potted-plant.glb',rx:0.85,rz:0.75,wF:0.12,dF:0.12,rot:0},
    {file:'outdoor-rug.glb',rx:0.5,rz:0.4,wF:0.4,dF:0.35,rot:0},
  ],
  utility:[
    {file:'washing-machine.glb',rx:0.25,rz:0.12,wF:0.18,dF:0.18,rot:0},
    {file:'dryer.glb',rx:0.55,rz:0.12,wF:0.18,dF:0.18,rot:0},
    {file:'utility-shelf.glb',rx:0.85,rz:0.5,wF:0.1,dF:0.3,rot:-Math.PI/2},
    {file:'iron-board.glb',rx:0.5,rz:0.7,wF:0.1,dF:0.3,rot:0},
    {file:'laundry-basket.glb',rx:0.75,rz:0.12,wF:0.1,dF:0.1,rot:0},
    {file:'mop-bucket.glb',rx:0.12,rz:0.8,wF:0.06,dF:0.06,rot:0},
  ],
  storage:[
    {file:'utility-shelf.glb',rx:0.85,rz:0.5,wF:0.1,dF:0.3,rot:-Math.PI/2},
    {file:'laundry-basket.glb',rx:0.3,rz:0.12,wF:0.1,dF:0.1,rot:0},
  ],
  closet:[
    {file:'utility-shelf.glb',rx:0.85,rz:0.5,wF:0.1,dF:0.25,rot:-Math.PI/2},
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
  chrome:new THREE.MeshPhysicalMaterial({color:0xD0D0D0,roughness:.04,metalness:.95,envMapIntensity:1.2,clearcoat:0.8,clearcoatRoughness:0.05}),
  marble:new THREE.MeshStandardMaterial({map:makeMarbleTex(),color:0xE8E0D0,roughness:.12,metalness:.05,envMapIntensity:.5}),
  cabinet:new THREE.MeshStandardMaterial({color:0x1A2332,roughness:.6,metalness:.02,envMapIntensity:.1}),
  leather:new THREE.MeshStandardMaterial({color:0x3E2723,roughness:.75,metalness:.02,envMapIntensity:.1}),
  steel:new THREE.MeshPhysicalMaterial({color:0xB8B8C0,roughness:.15,metalness:.7,envMapIntensity:.9,clearcoat:0.3,clearcoatRoughness:0.15}),
  mirror:new THREE.MeshPhysicalMaterial({color:0xB0C4DE,roughness:.01,metalness:.9,envMapIntensity:1.2,clearcoat:1.0,clearcoatRoughness:0.02}),
  glass:new THREE.MeshPhysicalMaterial({color:0xD8E8F0,roughness:.02,metalness:.05,transparent:true,opacity:.22,envMapIntensity:1.0,clearcoat:0.5,clearcoatRoughness:0.05}),
  accentRed:new THREE.MeshStandardMaterial({color:0xC0392B,roughness:.88,metalness:0,envMapIntensity:.05}),
  accentBlue:new THREE.MeshStandardMaterial({color:0x2980B9,roughness:.88,metalness:0,envMapIntensity:.05}),
  plantGreen:new THREE.MeshStandardMaterial({color:0x27AE60,roughness:.8,metalness:0,envMapIntensity:.05}),
  potBrown:new THREE.MeshStandardMaterial({color:0x6B4226,roughness:.7,metalness:.02,envMapIntensity:.08}),
};

// ─── Realistic plant foliage (multi-sphere cluster instead of single sphere) ──
var leafColors=[0x27AE60,0x2ECC71,0x1E8449,0x229954,0x196F3D];
function createFoliage(radius,y0){
  var g=new THREE.Group();
  // Central mass
  var cMat=new THREE.MeshStandardMaterial({color:leafColors[0],roughness:.82,metalness:0,envMapIntensity:.08});
  g.add(new THREE.Mesh(new THREE.SphereGeometry(radius*.7,8,6),cMat));
  g.children[0].position.set(0,y0,0);g.children[0].castShadow=true;
  // Surrounding leaf clusters (5-7 smaller spheres)
  var n=5+Math.floor(Math.random()*3);
  for(var li=0;li<n;li++){
    var lR=radius*(.3+Math.random()*.35);
    var angle=(li/n)*Math.PI*2+Math.random()*.5;
    var lMat=new THREE.MeshStandardMaterial({color:leafColors[Math.floor(Math.random()*leafColors.length)],roughness:.85,metalness:0,envMapIntensity:.06});
    var leaf=new THREE.Mesh(new THREE.SphereGeometry(lR,6,5),lMat);
    leaf.position.set(Math.cos(angle)*radius*.55,y0+(.1-.2*Math.random())*radius,Math.sin(angle)*radius*.55);
    leaf.scale.set(1,0.7+Math.random()*.4,1);leaf.castShadow=true;
    g.add(leaf);
  }
  // Thin stem/trunk
  var stemH=y0-radius*.3;
  if(stemH>0.05){
    var stem=cyl(radius*.08,radius*.06,stemH,6,new THREE.MeshStandardMaterial({color:0x4A3728,roughness:.7}));
    stem.position.set(0,stemH/2,0);g.add(stem);
  }
  return g;
}

// ─── Furniture Creators ──────────────────────────────────────────────────────
function createSofa(sw,sd){
  var g=new THREE.Group();
  var seatH=.22,seatY=.34,armW=.14,backH=.42;
  // Seat cushions (2-3 segments for realism)
  var nCush=sw>1.5?3:2;
  var cushW=(sw-armW*2-0.02)/nCush;
  for(var ci=0;ci<nCush;ci++){
    var cush=box(cushW-.02,seatH,sd*.55,MAT.fabric);
    cush.position.set(-sw/2+armW+cushW/2+ci*cushW+0.01,seatY,sd*.05);
    g.add(cush);
  }
  // Back cushions (matching seat segments)
  for(var bi=0;bi<nCush;bi++){
    var bCush=box(cushW-.02,backH,.13,MAT.fabric);
    bCush.position.set(-sw/2+armW+cushW/2+bi*cushW+0.01,seatY+seatH/2+backH/2-0.02,-sd*.2);
    g.add(bCush);
  }
  // Left arm (rounded top)
  var armMat=new THREE.MeshStandardMaterial({color:0x263545,roughness:.88,metalness:0,envMapIntensity:.05});
  var arm=box(armW,.26,sd*.6,armMat);arm.position.set(-sw/2+armW/2,seatY+.02,sd*.02);g.add(arm);
  var armTop=cyl(armW/2,armW/2,sd*.6,8,armMat);armTop.rotation.x=Math.PI/2;
  armTop.position.set(-sw/2+armW/2,seatY+.15,sd*.02);g.add(armTop);
  // Right arm
  var arm2=arm.clone();arm2.position.x=sw/2-armW/2;g.add(arm2);
  var armTop2=armTop.clone();armTop2.position.x=sw/2-armW/2;g.add(armTop2);
  // Sofa base frame
  var baseFr=box(sw,.08,sd*.6,new THREE.MeshStandardMaterial({color:0x1E2E3E,roughness:.9}));
  baseFr.position.set(0,.18,sd*.02);g.add(baseFr);
  // Throw pillows (varied colors + sizes)
  var tpColors=[MAT.accentRed,MAT.accentBlue,new THREE.MeshStandardMaterial({color:0xD4A76A,roughness:.88}),MAT.pillow];
  var tp1=box(.26,.16,.08,tpColors[0]);tp1.position.set(-sw*.32,seatY+seatH/2+.1,-sd*.1);tp1.rotation.set(-.15,0.1,0);g.add(tp1);
  var tp2=box(.22,.14,.07,tpColors[1]);tp2.position.set(sw*.32,seatY+seatH/2+.1,-sd*.1);tp2.rotation.set(-.12,-0.08,0);g.add(tp2);
  if(sw>1.5){
    var tp3=box(.2,.12,.06,tpColors[2]);tp3.position.set(0,seatY+seatH/2+.08,-sd*.12);tp3.rotation.x=-.1;g.add(tp3);
  }
  // Wooden legs (tapered, mid-century style)
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.022,.016,.14,8,MAT.walnut);
    leg.position.set(p[0]*(sw/2-.06),.07,p[1]*(sd*.22)+sd*.02);
    leg.rotation.x=p[1]*0.05;leg.rotation.z=p[0]*0.05;
    g.add(leg);
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
  // Platform base (solid with slight overhang)
  var frame=box(bw+.08,.1,bd+.08,MAT.oak);frame.position.set(0,.2,0);g.add(frame);
  // Mattress (thicker, with slight pillow-top look)
  var mattMat=new THREE.MeshStandardMaterial({color:0xF0ECE6,roughness:.88,metalness:0,envMapIntensity:.05});
  var matt=box(bw,.22,bd,mattMat);matt.position.set(0,.36,0);g.add(matt);
  // Mattress piping edge (decorative border)
  var pipeMat=new THREE.MeshStandardMaterial({color:0xE0DCD4,roughness:.8});
  var pipeT=box(bw+.01,.02,bd+.01,pipeMat);pipeT.position.set(0,.475,0);g.add(pipeT);
  // Headboard (tall, upholstered look with fabric texture)
  var hbMat=new THREE.MeshStandardMaterial({color:0x4A3C2E,roughness:.65,metalness:.02,envMapIntensity:.1});
  var hb=box(bw+.1,.85,.06,hbMat);hb.position.set(0,.68,-bd/2+.03);g.add(hb);
  // Headboard fabric panel (softer inset)
  var panelMat=new THREE.MeshStandardMaterial({color:0x5C4E3E,roughness:.82,metalness:0,envMapIntensity:.05});
  var panel=box(bw-.08,.65,.02,panelMat);panel.position.set(0,.66,-bd/2+.065);g.add(panel);
  // Headboard accent line
  var hLine=box(bw+.1,.015,.01,new THREE.MeshStandardMaterial({color:0x3A2E22,roughness:.5}));
  hLine.position.set(0,1.12,-bd/2+.035);g.add(hLine);
  // Pillows (4 — 2 large back + 2 accent front)
  var pw=bw*.3,ph=.12,pd=.3;
  // Back pillows (larger, upright-ish)
  var p1=box(pw,ph,pd,MAT.pillow);p1.position.set(-bw*.22,.52,-bd/2+pd/2+.08);p1.rotation.x=-.12;g.add(p1);
  var p2=p1.clone();p2.position.x=bw*.22;g.add(p2);
  // Front accent pillows (smaller, different color)
  var accentMat=new THREE.MeshStandardMaterial({color:0xB8A88C,roughness:.88,metalness:0});
  var p3=box(pw*.65,ph*.8,pd*.6,accentMat);p3.position.set(-bw*.15,.52,-bd/2+pd+.12);p3.rotation.x=-.15;g.add(p3);
  var p4=p3.clone();p4.position.x=bw*.15;g.add(p4);
  // Duvet/comforter (draped, thicker, with fold)
  var duvetMat=new THREE.MeshStandardMaterial({color:0xE8E2D8,roughness:.92,envMapIntensity:.03});
  var duvet=box(bw-.02,.06,bd*.52,duvetMat);duvet.position.set(0,.5,bd*.12);g.add(duvet);
  // Duvet fold at top
  var fold=box(bw-.04,.04,0.15,new THREE.MeshStandardMaterial({color:0xF0ECE4,roughness:.9}));
  fold.position.set(0,.54,-bd*.05);g.add(fold);
  // Bed legs (tapered wood)
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){
    var leg=cyl(.028,.022,.15,8,MAT.oak);
    leg.position.set(p[0]*(bw/2+.02),.075,p[1]*(bd/2+.02));g.add(leg);
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

// ─── NEW FURNITURE CREATORS (Phase 1: Ultra-Realistic Upgrade) ──────────────

function createWardrobe(ww,wd){
  var g=new THREE.Group();
  // Main body
  var body=box(ww,1.95,wd,MAT.oak);body.position.set(0,0.975,0);g.add(body);
  // Door panels with grain detail
  var doorW=ww/2-0.015;
  var doorMat=new THREE.MeshStandardMaterial({color:0x6B5438,roughness:0.4,metalness:0.02,envMapIntensity:0.15});
  var d1=box(doorW,1.85,0.018,doorMat);d1.position.set(-ww/4,0.975,wd/2+0.01);g.add(d1);
  var d2=d1.clone();d2.position.x=ww/4;g.add(d2);
  // Door center gap
  var gap=box(0.008,1.85,0.02,new THREE.MeshStandardMaterial({color:0x3A2A18,roughness:0.5}));
  gap.position.set(0,0.975,wd/2+0.012);g.add(gap);
  // Handles
  var h1=cyl(0.008,0.008,0.12,6,MAT.chrome);h1.position.set(-0.06,0.95,wd/2+0.025);g.add(h1);
  var h2=h1.clone();h2.position.x=0.06;g.add(h2);
  // Base plinth
  var plinth=box(ww+0.01,0.06,wd+0.01,MAT.walnut);plinth.position.set(0,0.03,0);g.add(plinth);
  // Crown top
  var crown=box(ww+0.03,0.035,wd+0.02,MAT.walnut);crown.position.set(0,1.97,0);g.add(crown);
  return g;
}

function createBookshelf(bw,bh){
  var g=new THREE.Group();
  bh=bh||1.6;
  // Frame panels
  var side1=box(0.025,bh,0.25,MAT.oak);side1.position.set(-bw/2,bh/2,0);g.add(side1);
  var side2=side1.clone();side2.position.x=bw/2;g.add(side2);
  var back=box(bw,bh,0.012,MAT.oak);back.position.set(0,bh/2,-0.12);g.add(back);
  // Shelves (4 levels)
  var nShelves=4;
  for(var si=0;si<=nShelves;si++){
    var sh=box(bw,0.02,0.25,MAT.oak);
    sh.position.set(0,si*(bh/nShelves),0);g.add(sh);
  }
  // Books on shelves (colored block clusters)
  var bookColors=[0xC0392B,0x2980B9,0x27AE60,0x8E44AD,0xD35400,0x1ABC9C,0x2C3E50,0xF39C12];
  for(var li=1;li<=nShelves;li++){
    var shelfY=li*(bh/nShelves)-bh/(nShelves*2);
    var bx=-bw/2+0.06;
    var nBooks=3+Math.floor(Math.random()*5);
    for(var bi=0;bi<nBooks&&bx<bw/2-0.06;bi++){
      var bkW=0.02+Math.random()*0.025;
      var bkH=(bh/nShelves)*0.5+Math.random()*(bh/nShelves)*0.35;
      var bkCol=bookColors[Math.floor(Math.random()*bookColors.length)];
      var bk=box(bkW,bkH,0.16,new THREE.MeshStandardMaterial({color:bkCol,roughness:0.85}));
      bk.position.set(bx+bkW/2,shelfY-((bh/nShelves)/2)+bkH/2+0.015,0.02);g.add(bk);
      bx+=bkW+0.003;
    }
    // Decorative object on some shelves
    if(Math.random()>0.5&&li<nShelves){
      var vase=cyl(0.03,0.025,0.1,8,new THREE.MeshStandardMaterial({color:0xB8860B,roughness:0.3,metalness:0.1}));
      vase.position.set(bw/2-0.08,shelfY-((bh/nShelves)/2)+0.065,0);g.add(vase);
    }
  }
  return g;
}

function createPendantLight(){
  var g=new THREE.Group();
  // Ceiling canopy
  var canopy=cyl(0.06,0.06,0.015,12,MAT.steel);canopy.position.set(0,WH-0.008,0);g.add(canopy);
  // Cable
  var cable=cyl(0.004,0.004,0.35,6,new THREE.MeshStandardMaterial({color:0x222222,roughness:0.7}));
  cable.position.set(0,WH-0.19,0);g.add(cable);
  // Shade (tapered cylinder open at bottom)
  var shadeMat=new THREE.MeshStandardMaterial({color:0xF5EFE0,roughness:0.82,side:THREE.DoubleSide,envMapIntensity:0.1});
  var shade=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.16,0.18,16,1,true),shadeMat);
  shade.position.set(0,WH-0.47,0);g.add(shade);
  // Warm bulb glow
  var bulb=new THREE.Mesh(new THREE.SphereGeometry(0.025,8,8),
    new THREE.MeshStandardMaterial({color:0xFFF5E0,emissive:0xFFE0A0,emissiveIntensity:0.6,roughness:1}));
  bulb.position.set(0,WH-0.42,0);g.add(bulb);
  return g;
}

function createCeilingLight(){
  var g=new THREE.Group();
  // Recessed light (flush-mount disc)
  var rim=cyl(0.1,0.1,0.01,16,MAT.steel);rim.position.set(0,WH-0.005,0);g.add(rim);
  var lens=new THREE.Mesh(new THREE.CircleGeometry(0.08,16),
    new THREE.MeshStandardMaterial({color:0xFFFAF0,emissive:0xFFF0D0,emissiveIntensity:0.4,roughness:1,side:THREE.DoubleSide}));
  lens.rotation.x=Math.PI/2;lens.position.set(0,WH-0.012,0);g.add(lens);
  return g;
}

function createCurtainPair(ch,cw){
  var g=new THREE.Group();
  var curtMat=new THREE.MeshStandardMaterial({color:0xE8DDD0,roughness:0.92,side:THREE.DoubleSide,envMapIntensity:0.05});
  // Left panel (gathered, with folds)
  var leftW=cw*0.18;
  for(var fi=0;fi<3;fi++){
    var fold=box(leftW/3,ch*0.85,0.015,curtMat);
    fold.position.set(-cw/2-leftW/2+fi*(leftW/3),ch*0.48,0.01*fi);g.add(fold);
  }
  // Right panel (gathered, with folds)
  for(var fi2=0;fi2<3;fi2++){
    var fold2=box(leftW/3,ch*0.85,0.015,curtMat);
    fold2.position.set(cw/2+leftW/2-fi2*(leftW/3),ch*0.48,0.01*fi2);g.add(fold2);
  }
  // Curtain rod
  var rodLen=cw+cw*0.4;
  var rod=cyl(0.01,0.01,rodLen,6,MAT.chrome);
  rod.rotation.z=Math.PI/2;rod.position.set(0,ch+0.03,0);g.add(rod);
  // Rod finials (decorative end caps)
  var fin1=new THREE.Mesh(new THREE.SphereGeometry(0.018,8,8),MAT.chrome);
  fin1.position.set(-rodLen/2,ch+0.03,0);g.add(fin1);
  var fin2=fin1.clone();fin2.position.x=rodLen/2;g.add(fin2);
  // Rod brackets
  var brk1=box(0.02,0.04,0.03,MAT.chrome);brk1.position.set(-cw/2-0.05,ch+0.01,-0.02);g.add(brk1);
  var brk2=brk1.clone();brk2.position.x=cw/2+0.05;g.add(brk2);
  return g;
}

function createShowerEnclosure(sw,sd){
  var g=new THREE.Group();
  // Glass panels (frosted)
  var glassMat=new THREE.MeshStandardMaterial({color:0xD0E4F0,roughness:0.08,metalness:0.05,transparent:true,opacity:0.18,side:THREE.DoubleSide,envMapIntensity:0.5});
  // Side panel
  var sideP=box(0.008,2.0,sd,glassMat);sideP.position.set(sw/2,1.0,0);g.add(sideP);
  // Front panel (door)
  var frontP=box(sw*0.6,2.0,0.008,glassMat);frontP.position.set(sw*0.15,1.0,sd/2);g.add(frontP);
  // Chrome frame strips
  var frameMat=MAT.chrome;
  var vStrip1=cyl(0.008,0.008,2.0,6,frameMat);vStrip1.position.set(sw/2,1.0,sd/2);g.add(vStrip1);
  var vStrip2=cyl(0.008,0.008,2.0,6,frameMat);vStrip2.position.set(sw/2,1.0,-sd/2);g.add(vStrip2);
  var vStrip3=cyl(0.008,0.008,2.0,6,frameMat);vStrip3.position.set(-sw*0.15,1.0,sd/2);g.add(vStrip3);
  // Shower head + arm
  var arm=cyl(0.012,0.012,0.35,6,frameMat);arm.rotation.x=Math.PI/6;
  arm.position.set(0,1.85,-sd/2+0.08);g.add(arm);
  var head=cyl(0.07,0.04,0.02,12,frameMat);head.position.set(0,2.0,-sd/2+0.2);g.add(head);
  // Valve handle
  var valve=cyl(0.025,0.025,0.02,8,frameMat);valve.rotation.x=Math.PI/2;
  valve.position.set(0,1.2,-sd/2+0.06);g.add(valve);
  // Floor tray
  var tray=box(sw,0.04,sd,new THREE.MeshStandardMaterial({color:0xE8E4DC,roughness:0.15,metalness:0.02}));
  tray.position.set(0,0.02,0);g.add(tray);
  return g;
}

function createTowelRack(){
  var g=new THREE.Group();
  // Double bar rack
  var bar1=cyl(0.008,0.008,0.5,6,MAT.chrome);bar1.rotation.z=Math.PI/2;
  bar1.position.set(0,1.15,0);g.add(bar1);
  var bar2=cyl(0.008,0.008,0.5,6,MAT.chrome);bar2.rotation.z=Math.PI/2;
  bar2.position.set(0,0.95,0.03);g.add(bar2);
  // Wall brackets
  var bk1=box(0.025,0.025,0.06,MAT.chrome);bk1.position.set(-0.22,1.15,-0.02);g.add(bk1);
  var bk2=bk1.clone();bk2.position.x=0.22;g.add(bk2);
  // Draped towel on lower bar
  var towelMat=new THREE.MeshStandardMaterial({color:0xF5F0EA,roughness:0.92,envMapIntensity:0.03});
  var towel=box(0.42,0.5,0.015,towelMat);towel.position.set(0,0.68,0.035);g.add(towel);
  return g;
}

function createBedsideLamp(){
  var g=new THREE.Group();
  // Weighted base
  var base=cyl(0.055,0.065,0.018,12,MAT.ceramic);base.position.set(0,0.009,0);g.add(base);
  // Body (vase shape — wider middle)
  var stem=cyl(0.03,0.02,0.22,10,MAT.ceramic);stem.position.set(0,0.13,0);g.add(stem);
  // Shade
  var shadeMat=new THREE.MeshStandardMaterial({color:0xF5EFE0,roughness:0.85,side:THREE.DoubleSide});
  var shade=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.09,0.13,12,1,true),shadeMat);
  shade.position.set(0,0.31,0);g.add(shade);
  // Warm glow sphere
  var bulb=new THREE.Mesh(new THREE.SphereGeometry(0.018,8,8),
    new THREE.MeshStandardMaterial({emissive:0xFFE0A0,emissiveIntensity:0.5,roughness:1}));
  bulb.position.set(0,0.28,0);g.add(bulb);
  return g;
}

function createTV(tw){
  var g=new THREE.Group();
  var th=tw*0.56;
  // Screen bezel (slightly larger than screen)
  var bezel=box(tw+0.015,th+0.015,0.022,new THREE.MeshStandardMaterial({color:0x111111,roughness:0.3,metalness:0.3}));
  bezel.position.set(0,th/2+0.5,0);g.add(bezel);
  // Screen (dark reflective)
  var screen=box(tw,th,0.018,new THREE.MeshStandardMaterial({color:0x080810,roughness:0.15,metalness:0.5,envMapIntensity:0.6}));
  screen.position.set(0,th/2+0.5,0.003);g.add(screen);
  return g;
}

function createUpperCabinets(kw){
  var g=new THREE.Group();
  var body=box(kw,0.55,0.3,MAT.cabinet);body.position.set(0,1.95,0);g.add(body);
  // Bottom trim
  var trim=box(kw+0.01,0.02,0.31,new THREE.MeshStandardMaterial({color:0x0F1520,roughness:0.5}));
  trim.position.set(0,1.67,0);g.add(trim);
  // Door panels with handles
  var nDoors=Math.max(2,Math.floor(kw/0.45));
  var doorW=kw/nDoors;
  for(var i=0;i<nDoors;i++){
    // Door face
    var df=box(doorW-0.01,0.5,0.015,new THREE.MeshStandardMaterial({color:0x1E2C3E,roughness:0.55}));
    df.position.set(-kw/2+doorW/2+i*doorW,1.95,0.16);g.add(df);
    // Handle
    var h=cyl(0.005,0.005,0.06,6,MAT.chrome);h.rotation.z=Math.PI/2;
    h.position.set(-kw/2+doorW/2+i*doorW,1.82,0.175);g.add(h);
  }
  return g;
}

function createSideTable(){
  var g=new THREE.Group();
  // Round marble top
  var top=cyl(0.2,0.2,0.02,16,MAT.marble);top.position.set(0,0.52,0);g.add(top);
  // Tapered metal base
  var base=cyl(0.015,0.12,0.5,8,MAT.steel);base.position.set(0,0.26,0);g.add(base);
  return g;
}

function createFloorLamp(){
  var g=new THREE.Group();
  // Heavy base
  var base=cyl(0.12,0.12,0.02,16,MAT.steel);base.position.set(0,0.01,0);g.add(base);
  // Slim pole
  var pole=cyl(0.012,0.012,1.5,8,MAT.steel);pole.position.set(0,0.77,0);g.add(pole);
  // Arc arm
  var arm=cyl(0.008,0.008,0.3,6,MAT.steel);arm.rotation.z=Math.PI/4;
  arm.position.set(0.1,1.55,0);g.add(arm);
  // Shade
  var shadeMat=new THREE.MeshStandardMaterial({color:0xF0EAD6,roughness:0.85,side:THREE.DoubleSide});
  var shade=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.18,0.22,12,1,true),shadeMat);
  shade.position.set(0.2,1.58,0);g.add(shade);
  // Bulb glow
  var bulb=new THREE.Mesh(new THREE.SphereGeometry(0.02,8,8),
    new THREE.MeshStandardMaterial({emissive:0xFFDFA0,emissiveIntensity:0.5,roughness:1}));
  bulb.position.set(0.2,1.52,0);g.add(bulb);
  return g;
}

function createBathMat(mw,md){
  var c=document.createElement("canvas");c.width=64;c.height=64;
  var g2=c.getContext("2d");
  g2.fillStyle="#E8E4DC";g2.fillRect(0,0,64,64);
  // Fluffy texture dots
  for(var i=0;i<200;i++){
    var v=220+Math.floor(Math.random()*30);
    g2.fillStyle='rgb('+v+','+(v-2)+','+(v-6)+')';
    g2.beginPath();g2.arc(Math.random()*64,Math.random()*64,1+Math.random()*1.5,0,Math.PI*2);g2.fill();
  }
  var tex=new THREE.CanvasTexture(c);
  var mat=new THREE.Mesh(new THREE.PlaneGeometry(mw,md),
    new THREE.MeshStandardMaterial({map:tex,roughness:0.95,envMapIntensity:0.02}));
  mat.rotation.x=-Math.PI/2;mat.receiveShadow=true;
  return mat;
}

function createLightSwitch(){
  var g=new THREE.Group();
  var plate=box(0.07,0.11,0.005,new THREE.MeshStandardMaterial({color:0xF0EDE8,roughness:0.4}));
  plate.position.set(0,1.15,0);g.add(plate);
  var toggle=box(0.025,0.035,0.008,new THREE.MeshStandardMaterial({color:0xE8E4DC,roughness:0.35}));
  toggle.position.set(0,1.16,0.005);g.add(toggle);
  return g;
}

function createPowerOutlet(){
  var g=new THREE.Group();
  var plate=box(0.07,0.07,0.005,new THREE.MeshStandardMaterial({color:0xF0EDE8,roughness:0.4}));
  plate.position.set(0,0.3,0);g.add(plate);
  // Socket holes
  var hole1=cyl(0.004,0.004,0.008,6,new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:0.5}));
  hole1.rotation.x=Math.PI/2;hole1.position.set(-0.01,0.31,0.004);g.add(hole1);
  var hole2=hole1.clone();hole2.position.x=0.01;g.add(hole2);
  return g;
}

// ─── NEW Furniture Functions (Ultra-Realistic v7) ────────────────────────────

function createRangeHood(hw){
  var g=new THREE.Group();
  // Chimney + tapered hood
  var chimney=box(0.35,0.5,0.25,MAT.steel);chimney.position.set(0,2.2,0);g.add(chimney);
  var hood=box(hw,0.12,0.45,MAT.steel);hood.position.set(0,1.72,0.05);g.add(hood);
  // LED strip under hood
  var led=box(hw-0.06,0.008,0.35,new THREE.MeshStandardMaterial({emissive:0xFFF5E0,emissiveIntensity:0.4,color:0xFFF5E0}));
  led.position.set(0,1.66,0.05);g.add(led);
  return g;
}

function createArmchair(){
  var g=new THREE.Group();
  var seat=box(0.7,0.08,0.65,MAT.fabric);seat.position.set(0,0.38,0);g.add(seat);
  var back=box(0.7,0.45,0.08,MAT.fabric);back.position.set(0,0.63,-0.28);g.add(back);
  var armL=box(0.08,0.22,0.55,MAT.fabric);armL.position.set(-0.35,0.48,0);g.add(armL);
  var armR=box(0.08,0.22,0.55,MAT.fabric);armR.position.set(0.35,0.48,0);g.add(armR);
  // Legs
  var lMat=MAT.oak;
  var legs=[[-.28,-.25],[.28,-.25],[-.28,.25],[.28,.25]];
  for(var li=0;li<4;li++){
    var lg=cyl(0.02,0.02,0.34,6,lMat);lg.position.set(legs[li][0],0.17,legs[li][1]);g.add(lg);
  }
  // Cushion
  var cush=box(0.55,0.12,0.5,new THREE.MeshStandardMaterial({color:0x8B6B4A,roughness:0.9}));
  cush.position.set(0,0.48,0.02);g.add(cush);
  return g;
}

function createDresser(dw){
  var g=new THREE.Group();
  var body=box(dw,0.78,0.42,MAT.oak);body.position.set(0,0.39,0);g.add(body);
  // 3 drawers
  var drawMat=new THREE.MeshStandardMaterial({color:0x6B5235,roughness:0.5});
  for(var di=0;di<3;di++){
    var drawer=box(dw-0.04,0.2,0.01,drawMat);drawer.position.set(0,0.15+di*0.24,0.215);g.add(drawer);
    var handle=cyl(0.008,0.008,0.12,6,MAT.steel);handle.rotation.z=Math.PI/2;
    handle.position.set(0,0.15+di*0.24,0.225);g.add(handle);
  }
  return g;
}

function createMicrowave(){
  var g=new THREE.Group();
  var body=box(0.45,0.28,0.35,MAT.steel);body.position.set(0,0.14,0);g.add(body);
  // Door glass
  var glass=box(0.3,0.2,0.005,new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:0.1,metalness:0.3}));
  glass.position.set(-0.04,0.15,0.176);g.add(glass);
  // Control panel
  var panel=box(0.08,0.2,0.005,new THREE.MeshStandardMaterial({color:0x2A2A2A,roughness:0.3}));
  panel.position.set(0.16,0.15,0.176);g.add(panel);
  return g;
}

function createWallSconce(){
  var g=new THREE.Group();
  var plate=box(0.08,0.08,0.02,MAT.steel);plate.position.set(0,1.8,0);g.add(plate);
  var arm=cyl(0.01,0.01,0.08,6,MAT.steel);arm.rotation.x=Math.PI/2;arm.position.set(0,1.8,0.05);g.add(arm);
  var shade=cyl(0.06,0.04,0.1,8,new THREE.MeshStandardMaterial({color:0xF5F0E5,roughness:0.8,transparent:true,opacity:0.85}));
  shade.position.set(0,1.8,0.1);g.add(shade);
  // Warm glow
  var glow=new THREE.Mesh(new THREE.SphereGeometry(0.02,6,6),new THREE.MeshStandardMaterial({emissive:0xFFE0A0,emissiveIntensity:0.6}));
  glow.position.set(0,1.8,0.1);g.add(glow);
  return g;
}

function createToiletPaperHolder(){
  var g=new THREE.Group();
  var bracket=box(0.06,0.08,0.04,MAT.steel);bracket.position.set(0,0.7,0);g.add(bracket);
  var rod=cyl(0.006,0.006,0.12,6,MAT.steel);rod.rotation.z=Math.PI/2;rod.position.set(0,0.68,0.025);g.add(rod);
  // Roll
  var roll=cyl(0.025,0.025,0.1,8,new THREE.MeshStandardMaterial({color:0xF8F5F0,roughness:0.9}));
  roll.rotation.z=Math.PI/2;roll.position.set(0,0.68,0.025);g.add(roll);
  return g;
}

function createFloatingShelf(sw){
  var g=new THREE.Group();
  var shelf=box(sw,0.02,0.2,MAT.walnut);shelf.position.set(0,0,0);g.add(shelf);
  // Decorative items
  var v1=cyl(0.03,0.02,0.12,8,new THREE.MeshStandardMaterial({color:0xB8860B,roughness:0.2,metalness:0.1}));
  v1.position.set(-sw*0.3,0.07,0);g.add(v1);
  var book=box(0.04,0.15,0.1,new THREE.MeshStandardMaterial({color:0x4A6741,roughness:0.8}));
  book.position.set(sw*0.2,0.085,0);g.add(book);
  return g;
}

function createDiningCenterpiece(){
  // Candles + small vase with flowers
  var g=new THREE.Group();
  // Tray base
  var tray=box(0.3,0.015,0.15,new THREE.MeshStandardMaterial({color:0x8B6914,roughness:0.3,metalness:0.1}));
  tray.position.set(0,0,0);g.add(tray);
  // Two candles
  var candleMat=new THREE.MeshStandardMaterial({color:0xFAF0E6,roughness:0.6});
  var c1=cyl(0.015,0.015,0.18,8,candleMat);c1.position.set(-0.06,0.098,0);g.add(c1);
  var c2=cyl(0.015,0.015,0.12,8,candleMat);c2.position.set(0.06,0.068,0);g.add(c2);
  // Candle flames (emissive glow)
  var flameMat=new THREE.MeshStandardMaterial({emissive:0xFFAA30,emissiveIntensity:0.8,color:0xFFCC00});
  var f1=new THREE.Mesh(new THREE.SphereGeometry(0.008,6,6),flameMat);f1.position.set(-0.06,0.195,0);g.add(f1);
  var f2=new THREE.Mesh(new THREE.SphereGeometry(0.006,6,6),flameMat);f2.position.set(0.06,0.135,0);g.add(f2);
  // Small vase
  var vaseMat=new THREE.MeshStandardMaterial({color:0x6B8E8E,roughness:0.2,metalness:0.05});
  var vase=cyl(0.025,0.018,0.1,8,vaseMat);vase.position.set(0,0.058,0);g.add(vase);
  // Flower stems
  var stemMat=new THREE.MeshStandardMaterial({color:0x2D5A27});
  for(var fi=0;fi<3;fi++){
    var stem=cyl(0.003,0.003,0.08,4,stemMat);
    stem.position.set(Math.sin(fi*2.1)*0.01,0.145,Math.cos(fi*2.1)*0.01);
    stem.rotation.x=(Math.random()-0.5)*0.3;stem.rotation.z=(Math.random()-0.5)*0.3;g.add(stem);
    var petal=new THREE.Mesh(new THREE.SphereGeometry(0.015,6,6),new THREE.MeshStandardMaterial({color:[0xE8556D,0xF0A0B0,0xFFD700][fi],roughness:0.7}));
    petal.position.set(Math.sin(fi*2.1)*0.01,0.19,Math.cos(fi*2.1)*0.01);g.add(petal);
  }
  return g;
}

function createCoatRack(){
  var g=new THREE.Group();
  // Pole
  var pole=cyl(0.02,0.02,1.7,8,MAT.oak);pole.position.set(0,0.85,0);g.add(pole);
  // Base
  var base=cyl(0.2,0.2,0.02,12,MAT.oak);base.position.set(0,0.01,0);g.add(base);
  // Hooks (4 around top)
  for(var hi=0;hi<4;hi++){
    var hook=cyl(0.008,0.008,0.08,4,MAT.steel);
    hook.rotation.z=Math.PI/4;
    hook.position.set(Math.sin(hi*Math.PI/2)*0.06,1.65,Math.cos(hi*Math.PI/2)*0.06);
    g.add(hook);
  }
  return g;
}

function createShoeRack(){
  var g=new THREE.Group();
  var body=box(0.65,0.45,0.25,MAT.oak);body.position.set(0,0.225,0);g.add(body);
  // 2 shelves
  for(var si=0;si<2;si++){
    var shelf=box(0.6,0.01,0.22,MAT.oak);shelf.position.set(0,0.15+si*0.15,0);g.add(shelf);
  }
  // A pair of shoes on bottom shelf
  var shoeMat=new THREE.MeshStandardMaterial({color:0x2A1A0A,roughness:0.6});
  var sh1=box(0.08,0.06,0.2,shoeMat);sh1.position.set(-0.12,0.06,0);g.add(sh1);
  var sh2=box(0.08,0.06,0.2,shoeMat);sh2.position.set(-0.02,0.06,0);g.add(sh2);
  return g;
}

function createCoffeeTableBooks(){
  // Stack of 2-3 books + small decorative item
  var g=new THREE.Group();
  var colors=[0x4A6741,0x8B4A4A,0x4A6B8C];
  for(var bi=0;bi<3;bi++){
    var bk=box(0.16,0.025,0.22,new THREE.MeshStandardMaterial({color:colors[bi],roughness:0.8}));
    bk.position.set((bi-1)*0.01,0.0125+bi*0.028,0);
    bk.rotation.y=bi*0.08;g.add(bk);
  }
  // Small decorative sphere on top
  var deco=new THREE.Mesh(new THREE.SphereGeometry(0.025,8,8),new THREE.MeshStandardMaterial({color:0xB8860B,roughness:0.15,metalness:0.3}));
  deco.position.set(0.05,0.1,0.06);g.add(deco);
  return g;
}

function createWashingMachine(){
  var g=new THREE.Group();
  var body=box(0.6,0.85,0.6,new THREE.MeshStandardMaterial({color:0xF0F0F0,roughness:0.3,metalness:0.05}));
  body.position.set(0,0.425,0);g.add(body);
  // Front door (circle)
  var doorRing=cyl(0.2,0.2,0.02,16,new THREE.MeshStandardMaterial({color:0xCCCCCC,roughness:0.2,metalness:0.3}));
  doorRing.rotation.x=Math.PI/2;doorRing.position.set(0,0.4,0.31);g.add(doorRing);
  // Glass center
  var glass=cyl(0.15,0.15,0.01,16,new THREE.MeshStandardMaterial({color:0x4A6B8C,roughness:0.05,metalness:0.1,transparent:true,opacity:0.4}));
  glass.rotation.x=Math.PI/2;glass.position.set(0,0.4,0.31);g.add(glass);
  // Control panel
  var panel=box(0.5,0.08,0.01,new THREE.MeshStandardMaterial({color:0xE0E0E0,roughness:0.3}));
  panel.position.set(0,0.82,0.3);g.add(panel);
  return g;
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
gndGrad.addColorStop(0,"#E8E0D4");gndGrad.addColorStop(1,"#D8D0C4");
gndG.fillStyle=gndGrad;gndG.fillRect(0,0,512,512);
for(var gi2=0;gi2<600;gi2++){gndG.fillStyle="rgba(0,0,0,"+(Math.random()*.012)+")";gndG.fillRect(Math.random()*512,Math.random()*512,2+Math.random()*3,1+Math.random()*2)}
var gndTex=new THREE.CanvasTexture(gndC);gndTex.wrapS=gndTex.wrapT=THREE.RepeatWrapping;gndTex.repeat.set(3,3);
var gnd=new THREE.Mesh(new THREE.PlaneGeometry(BW+20,BD+20),new THREE.MeshStandardMaterial({map:gndTex,color:0xE0D8CC,roughness:.92,metalness:.02}));
gnd.rotation.x=-Math.PI/2;gnd.position.set(CX,-.16,CZ);gnd.receiveShadow=true;scene.add(gnd);

// Grid removed — clean ground plane only (professional arch-viz look)

// ─── Contact Shadow (soft radial shadow under building) ──────────────────────
(function(){
  var shC=document.createElement('canvas');shC.width=512;shC.height=512;
  var shCtx=shC.getContext('2d');
  var shGrad=shCtx.createRadialGradient(256,256,0,256,256,256);
  shGrad.addColorStop(0,'rgba(0,0,0,0.15)');
  shGrad.addColorStop(0.4,'rgba(0,0,0,0.08)');
  shGrad.addColorStop(0.7,'rgba(0,0,0,0.02)');
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

// ─── Building slab + wood floor base ─────────────────────────────────────────
// Slab edge boxes REMOVED — they z-fought with floor planes causing white at angles
if(HAS_IMG){
var imgLoader=new THREE.TextureLoader();imgLoader.load(IMG_SRC,function(tex){tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;
var imgFloor=new THREE.Mesh(new THREE.PlaneGeometry(BW,BD),new THREE.MeshStandardMaterial({map:tex,roughness:.5}));
imgFloor.rotation.x=-Math.PI/2;imgFloor.position.set(CX,.01,CZ);imgFloor.receiveShadow=true;scene.add(imgFloor);});
var slab=box(BW+.2,.12,BD+.2,new THREE.MeshStandardMaterial({color:0xD0C8B8,roughness:.7,metalness:.02}));
slab.position.set(CX,-.06,CZ);slab.receiveShadow=true;scene.add(slab);
} else if(isNonRect){
var slabShape=new THREE.Shape();
var ol=D.buildingOutline;
slabShape.moveTo(ol[0][0],-ol[0][1]);
for(var si=1;si<ol.length;si++) slabShape.lineTo(ol[si][0],-ol[si][1]);
slabShape.closePath();
var slabGeo=new THREE.ShapeGeometry(slabShape);
var slabM=new THREE.Mesh(slabGeo,new THREE.MeshStandardMaterial({color:0xD0C8B8,roughness:.8}));
slabM.rotation.x=-Math.PI/2;slabM.position.y=-.075;slabM.receiveShadow=true;scene.add(slabM);
// Full-building wood floor for non-rect buildings
var nrFillMat=new THREE.MeshStandardMaterial({color:0xB89B6A,roughness:0.55,metalness:0.0,envMapIntensity:0.3,side:THREE.DoubleSide});
loadPBRTex(nrFillMat,'wood',Math.max(1,BW/2),Math.max(1,BD/2),0.8);
var nrFillGeo=new THREE.ShapeGeometry(slabShape);
var nrFill=new THREE.Mesh(nrFillGeo,nrFillMat);
nrFill.rotation.x=-Math.PI/2;nrFill.position.y=.002;nrFill.receiveShadow=true;scene.add(nrFill);
} else {
var slab=box(BW+.2,.10,BD+.2,new THREE.MeshStandardMaterial({color:0xB89B6A,roughness:.7,metalness:.02}));
slab.position.set(CX,-.05,CZ);slab.receiveShadow=true;scene.add(slab);
// Full-building wood floor plane to cover gaps between rooms
var gapFillMat=new THREE.MeshStandardMaterial({color:0xB89B6A,roughness:0.55,metalness:0.0,envMapIntensity:0.3,side:THREE.DoubleSide});
loadPBRTex(gapFillMat,'wood',Math.max(1,BW/2),Math.max(1,BD/2),0.8);
var gapFill=new THREE.Mesh(new THREE.PlaneGeometry(BW,BD),gapFillMat);
gapFill.rotation.x=-Math.PI/2;gapFill.position.set(CX,.002,CZ);gapFill.receiveShadow=true;scene.add(gapFill);
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
  var floorHex=FC[r.type]||0xB89B6A;

  // Room floor: polygon (SVG) → THREE.Shape, image → invisible target, else → textured rect
  var fl;
  if(r.polygon&&r.polygon.length>=3){
    var roomShape=new THREE.Shape();
    roomShape.moveTo(r.polygon[0][0],-r.polygon[0][1]);
    for(var pi=1;pi<r.polygon.length;pi++) roomShape.lineTo(r.polygon[pi][0],-r.polygon[pi][1]);
    roomShape.closePath();
    var polyMat=makePBRFloor(TT[r.type]||"concrete",FC[r.type]||0xB89B6A,w,d);
    polyMat.side=THREE.DoubleSide;
    fl=new THREE.Mesh(new THREE.ShapeGeometry(roomShape),polyMat);
    fl.rotation.x=-Math.PI/2;fl.position.y=.005;fl.receiveShadow=true;
  }else if(HAS_IMG){
    fl=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({transparent:true,opacity:0,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2;fl.position.set(cx,.005,cz);fl.receiveShadow=true;
  }else{
    var rectMat=makePBRFloor(TT[r.type]||"wood",FC[r.type]||0xB89B6A,w,d);
    fl=new THREE.Mesh(new THREE.PlaneGeometry(w,d),rectMat);
    fl.rotation.x=-Math.PI/2;fl.position.set(cx,.005,cz);fl.receiveShadow=true;
  }
  fl.userData={room:r,area:area,cx:cx,cz:cz};rmM.push(fl);scene.add(fl);

  // Soft per-room fill light (very subtle — avoids washing out textures)
  if(!HAS_IMG&&area>5){
    var roomFill=new THREE.PointLight(0xFFF0D0,0.35,Math.max(w,d)*2.0);
    roomFill.position.set(cx,WH*0.8,cz);scene.add(roomFill);
  }

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
  if(Math.min(w,d)<1.0)return; // Only skip truly tiny rooms (<1m dimension)

  // Try GLTF models for this room type (loads async from R2 CDN)
  var rModels=ROOM_MODELS[r.type];
  var roomKey=r.name||('room'+i);
  if(rModels&&gltfLoader){
    rModels.forEach(function(md){
      loadGLTF(md.file,rx+w*md.rx,ry+d*md.rz,w*md.wF,d*md.dF,md.rot,roomKey);
    });
  }

  // Procedural furniture as instant placeholders — removed when GLTF models load
  var procGrp=new THREE.Group();
  procGrp.name='proc_'+roomKey;
  function procAdd(m){procGrp.add(m);return m}
  function procAddAt(m,x,y,z){m.position.set(x,y,z);procGrp.add(m);return m}
  function procAddGrp(g,x,y,z){g.position.set(x,y,z);procGrp.add(g);return g}

  if(r.type==="living"||r.type==="studio"){
    var sofaW=Math.min(2.2,w*.55);
    var sofa=createSofa(sofaW,.8);
    sofa.userData.gltfId='sofa';
    procAddGrp(sofa,cx,0,cz-d*.22);
    var ct=createCoffeeTable(Math.min(.85,w*.3),Math.min(.5,d*.18));
    ct.userData.gltfId='coffee-table';
    procAddGrp(ct,cx,0,cz+.12);
    // TV unit / media stand (wrapped in group for GLTF swap)
    var tvUnitW=Math.min(w*.5,1.5);
    var tvGrp=new THREE.Group();tvGrp.userData.gltfId='tv-unit';
    var tvBase=box(tvUnitW,.38,.32,MAT.darkWood);tvBase.position.set(0,.19,0);tvGrp.add(tvBase);
    var tv=createTV(Math.min(0.9,tvUnitW*0.7));tv.position.set(0,0.38,-0.05);tvGrp.add(tv);
    procAddGrp(tvGrp,cx,0,cz+d/2-0.22); // flush against far wall
    // Large rug under seating area
    var rugW=Math.min(w*.65,2.5),rugD=Math.min(d*.45,1.8);
    var rug=createRug(rugW,rugD,"persian");
    rug.position.set(cx,.007,cz);procAdd(rug);
    // Side table next to sofa
    if(w>2.5){
      var st=createSideTable();procAddGrp(st,cx+sofaW/2+.25,0,cz-d*.22);
    }
    // Floor lamp in corner
    if(w>2.0){
      var flLamp=createFloorLamp();flLamp.userData.gltfId='floor-lamp';
      procAddGrp(flLamp,cx-w*.38,0,cz-d*.35);
    }
    // Bookshelf flush against side wall (rotated to face room)
    if(w>3.0&&d>2.5){
      var bsh=createBookshelf(Math.min(0.7,w*.2),1.5);
      bsh.rotation.y=-Math.PI/2; // face into room from right wall
      procAddGrp(bsh,cx+w/2-0.15,0,cz-d*.1);
    }
    // Potted plant in corner (wrapped for GLTF swap)
    var plantGrp=new THREE.Group();plantGrp.userData.gltfId='potted-plant';
    var pot=cyl(.1,.08,.18,8,MAT.potBrown);pot.position.set(0,.09,0);plantGrp.add(pot);
    var foliage=createFoliage(.22,.36);plantGrp.add(foliage);
    procAddGrp(plantGrp,cx+w*.38,0,cz-d*.38);
    // Armchair at angle (larger living rooms)
    if(w>3.0&&d>2.5){
      var armCh=createArmchair();
      armCh.rotation.y=Math.PI*0.15;
      procAddGrp(armCh,cx-w*.3,0,cz+d*.15);
    }
    // Pendant light
    var pLt=createPendantLight();procAddGrp(pLt,cx,0,cz);
    // Wall paintings
    if(d>2.0)addPainting(cx,1.75,ry+0.06,0.75,0.55,0);
    if(w>2.5)addPainting(rx+w-0.06,1.6,cz-d*.15,0.5,0.4,Math.PI/2);
    // Wall sconces flanking TV (flush on far wall)
    if(w>2.5){
      var sc1=createWallSconce();procAddGrp(sc1,cx-w*.2,0,cz+d/2-0.04);
      var sc2=createWallSconce();procAddGrp(sc2,cx+w*.2,0,cz+d/2-0.04);
    }
    // Floating shelves near TV wall (flush)
    if(d>2.5){
      var fsh1=createFloatingShelf(Math.min(0.6,w*.18));
      procAddGrp(fsh1,cx+w*.28,1.4,cz+d/2-0.04);
      var fsh2=createFloatingShelf(Math.min(0.5,w*.15));
      procAddGrp(fsh2,cx+w*.28,1.8,cz+d/2-0.04);
    }
    // Coffee table books + decorative sphere on coffee table
    if(w>2.0){
      var ctBooks=createCoffeeTableBooks();
      procAddGrp(ctBooks,cx+0.15,0.42,cz+0.12);
    }
    // Curtains on window wall
    if(w>2.2){
      var lvCurt=createCurtainPair(winH+0.2,winW);
      lvCurt.position.set(cx,winBottom-0.1,ry+0.06);procAdd(lvCurt);
    }
    // Light switch near door
    var ls=createLightSwitch();procAddGrp(ls,rx+0.12,0,cz+d*.35);
    // Power outlet
    var lvPO=createPowerOutlet();procAddGrp(lvPO,cx+w*.38,0,cz+d*.1);
  }
  if(r.type==="bedroom"){
    var bedW=Math.min(1.8,w*.55),bedD=Math.min(2.1,d*.55);
    var bed=createBed(bedW,bedD);
    bed.userData.gltfId='bed';
    procAddGrp(bed,cx,0,cz-d*.08);
    // Nightstands on both sides (always)
    if(w>2.2){
      var ns=createNightstand();ns.userData.gltfId='nightstand';
      procAddGrp(ns,cx+bedW/2+.28,0,cz-bedD/2+.15);
      // Bedside lamp on right nightstand
      var lamp1=createBedsideLamp();procAddGrp(lamp1,cx+bedW/2+.28,0.47,cz-bedD/2+.15);
    }
    if(w>2.8){
      var ns2=createNightstand();ns2.userData.gltfId='nightstand';
      procAddGrp(ns2,cx-bedW/2-.28,0,cz-bedD/2+.15);
      // Bedside lamp on left nightstand
      var lamp2=createBedsideLamp();procAddGrp(lamp2,cx-bedW/2-.28,0.47,cz-bedD/2+.15);
    }
    // Wardrobe flush against far wall — doors face into room (rotated 180°)
    if(d>2.5){
      var wardW=Math.min(1.2,w*.35),wardD=0.55;
      var ward=createWardrobe(wardW,wardD);
      ward.rotation.y=Math.PI; // flip so doors face inward
      procAddGrp(ward,cx+w*.3,0,cz+d/2-wardD/2-0.02);
    }
    // Dresser flush against side wall — drawers face into room (rotated 180°)
    if(w>2.5&&d>2.8){
      var dresser=createDresser(Math.min(1.0,w*.3));
      dresser.rotation.y=Math.PI; // flip so drawers face inward
      procAddGrp(dresser,cx-w*.28,0,cz+d/2-0.25);
      // Mirror above dresser (flush on wall)
      addPainting(cx-w*.28,1.35,cz+d/2-0.04,0.5,0.6,0);
    }
    // Rug at foot of bed
    var bRug=createRug(Math.min(w*.55,2.0),Math.min(d*.25,1.0),"minimal");
    bRug.position.set(cx,.007,cz+bedD/2+.15);procAdd(bRug);
    // Painting above headboard
    addPainting(cx,1.68,ry+0.06,0.6,0.45,0);
    // Second painting on side wall
    if(w>3.0)addPainting(rx+w-0.06,1.6,cz,0.4,0.35,Math.PI/2);
    // Pendant light
    var bPL=createPendantLight();procAddGrp(bPL,cx,0,cz);
    // Curtains (on far wall for bedroom ambiance)
    if(w>2.2){
      var curt=createCurtainPair(winH+0.2,winW);
      curt.position.set(cx,winBottom-0.1,ry+0.06);procAdd(curt);
    }
    // Wall sconces flanking headboard (flush against near wall)
    if(w>2.5){
      var bSc1=createWallSconce();procAddGrp(bSc1,cx+bedW/2+0.15,0,ry+0.06);
      var bSc2=createWallSconce();procAddGrp(bSc2,cx-bedW/2-0.15,0,ry+0.06);
    }
    // Light switch
    var bLS=createLightSwitch();procAddGrp(bLS,rx+0.12,0,cz+d*.35);
    // Power outlet
    var bPO=createPowerOutlet();procAddGrp(bPO,cx+w*.38,0,cz);
    // Plant in corner (wrapped for GLTF swap)
    if(area>8){
      var bPlantGrp=new THREE.Group();bPlantGrp.userData.gltfId='potted-plant';
      var bPot=cyl(.08,.06,.14,8,MAT.potBrown);bPot.position.set(0,.07,0);bPlantGrp.add(bPot);
      var bFol=createFoliage(.16,.27);bPlantGrp.add(bFol);
      procAddGrp(bPlantGrp,cx-w*.38,0,cz+d*.38);
    }
  }
  if(r.type==="dining"){
    var tW2=Math.min(1.4,w*.45),tD2=Math.min(.9,d*.35);
    var table=createDiningTable(tW2,tD2);
    table.userData.gltfId='dining-table';
    procAddGrp(table,cx,0,cz);
    var chairOff=.45;
    var c1=createChair(0);c1.userData.gltfId='dining-chair';procAddGrp(c1,cx-tW2*.35,0,cz-tD2/2-chairOff);
    var c2=createChair(0);c2.userData.gltfId='dining-chair';procAddGrp(c2,cx+tW2*.35,0,cz-tD2/2-chairOff);
    var c3=createChair(Math.PI);c3.userData.gltfId='dining-chair';procAddGrp(c3,cx-tW2*.35,0,cz+tD2/2+chairOff);
    var c4=createChair(Math.PI);c4.userData.gltfId='dining-chair';procAddGrp(c4,cx+tW2*.35,0,cz+tD2/2+chairOff);
    // Rug under dining table
    var dRug=createRug(Math.min(w*.6,2.2),Math.min(d*.5,1.8),"persian");
    dRug.position.set(cx,.007,cz);procAdd(dRug);
    // Pendant light over table
    var dPL=createPendantLight();procAddGrp(dPL,cx,0,cz);
    // Wall painting
    if(w>2.0)addPainting(rx+w-0.06,1.7,cz,0.65,0.5,Math.PI/2);
    // Sideboard/buffet flush against near wall
    if(d>2.5){
      var buffet=box(Math.min(1.0,w*.35),0.75,0.35,MAT.walnut);
      procAddAt(buffet,cx,0.375,ry+0.24);
      // Items on buffet
      var vase=cyl(0.04,0.03,0.15,8,new THREE.MeshStandardMaterial({color:0xB8860B,roughness:0.2,metalness:0.1}));
      vase.position.set(cx-0.15,0.825,ry+0.24);procAdd(vase);
    }
    // Dining centerpiece on table (candles, vase with flowers)
    var dCenter=createDiningCenterpiece();
    procAddGrp(dCenter,cx,0.78,cz);
    // Light switch
    var dLS=createLightSwitch();procAddGrp(dLS,rx+0.12,0,cz+d*.35);
  }
  if(r.type==="kitchen"){
    var kW=Math.min(w*.65,2.5),kD=.55;
    var counter=createKitchenCounter(kW,kD);
    procAddGrp(counter,cx,0,cz-d*.32);
    // Upper cabinets above counter
    var upCab=createUpperCabinets(kW);
    procAddGrp(upCab,cx,0,cz-d*.32-kD/2+0.15);
    // Under-cabinet LED strip
    var ledStrip=box(kW-0.1,0.008,0.04,new THREE.MeshStandardMaterial({emissive:0xFFF5E0,emissiveIntensity:0.25,color:0xFFF5E0}));
    ledStrip.position.set(cx,1.68,cz-d*.32-kD/2+0.3);procAdd(ledStrip);
    // Range hood above stove area
    if(kW>1.2){
      var rHood=createRangeHood(Math.min(0.6,kW*0.3));
      procAddGrp(rHood,cx-kW*0.15,0,cz-d*.32-kD/2+0.15);
    }
    // Fridge
    if(w>2.0){
      var fridge=createFridge();fridge.userData.gltfId='fridge';
      procAddGrp(fridge,cx+kW/2+.45,0,cz-d*.32);
    }
    // Microwave on counter
    if(kW>1.5){
      var micro=createMicrowave();
      procAddGrp(micro,cx+kW*0.25,0.88,cz-d*.32+0.05);
    }
    // Kitchen island (larger kitchens)
    if(w>3.0&&d>2.5){
      var island=box(Math.min(1.2,w*.3),0.88,0.6,MAT.oak);
      procAddAt(island,cx,0.44,cz+d*.1);
      // Island top (marble)
      var iTop=box(Math.min(1.3,w*.32),0.03,0.65,new THREE.MeshStandardMaterial({color:0xF0EAE0,roughness:0.15,metalness:0.02}));
      iTop.position.set(cx,0.895,cz+d*.1);procAdd(iTop);
    }
    // Kitchen rug/mat
    var kRug=createRug(Math.min(kW*0.6,1.2),0.5,"minimal");
    kRug.position.set(cx,.007,cz+d*.05);procAdd(kRug);
    // Recessed ceiling lights (2-3 spots)
    var nSpots=Math.max(2,Math.floor(w/1.5));
    for(var ki=0;ki<nSpots;ki++){
      var spot=createCeilingLight();
      procAddGrp(spot,rx+w/(nSpots+1)*(ki+1),0,cz);
    }
    // Light switch
    var kLS=createLightSwitch();procAddGrp(kLS,rx+w-0.12,0,cz+d*.35);
    // Power outlet near counter
    var kPO=createPowerOutlet();procAddGrp(kPO,cx-kW*0.3,0,cz-d*.32-kD/2+0.07);
  }
  if(r.type==="bathroom"){
    // Scale toilet/vanity placement for small bathrooms (T&B rooms can be 1.2m×2.3m)
    var btSmall=Math.min(w,d)<1.6;
    var toilet=createToilet();toilet.userData.gltfId='toilet';
    procAddGrp(toilet,btSmall?cx+w*.25:cx+w*.22,0,btSmall?cz-d*.22:cz-d*.28);
    var vanW=Math.min(.65,w*.35);
    var vanity=createVanity(vanW);vanity.userData.gltfId='bathroom-vanity';
    procAddGrp(vanity,btSmall?cx-w*.2:cx-w*.18,0,btSmall?cz+d*.25:cz+d*.2);
    // Mirror above vanity (larger, with backlight)
    if(d>1.5){
      var mirW=Math.min(.6,w*.35),mirH=0.65;
      var mirZ=cz+d/2-0.04; // flush against far wall
      procAddAt(box(mirW+0.06,mirH+0.06,0.02,new THREE.MeshStandardMaterial({color:0x2A2A2A,roughness:0.25,metalness:0.4})),cx-w*.18,1.4,mirZ);
      procAddAt(box(mirW,mirH,0.015,MAT.mirror),cx-w*.18,1.4,mirZ+0.012);
      // Backlight glow strip
      var glow=box(mirW-0.04,0.015,0.01,new THREE.MeshStandardMaterial({emissive:0xFFF0D0,emissiveIntensity:0.3}));
      glow.position.set(cx-w*.18,1.75,mirZ);procAdd(glow);
    }
    // Shower enclosure (if room is big enough)
    if(w>2.0&&d>2.0){
      var shower=createShowerEnclosure(Math.min(0.9,w*.28),Math.min(0.9,d*.28));
      procAddGrp(shower,cx-w*.32,0,cz-d*.28);
    }
    // Towel rack on wall (skip in tiny bathrooms to avoid clipping)
    if(w>1.3){
      var rack=createTowelRack();
      procAddGrp(rack,cx+w*.35,0,cz);
    }
    // Toilet paper holder
    var tph=createToiletPaperHolder();
    procAddGrp(tph,cx+w*.35,0,btSmall?cz-d*.18:cz-d*.28);
    // Soap dispenser on vanity
    var soap=cyl(0.02,0.015,0.12,6,new THREE.MeshStandardMaterial({color:0xD4C4A8,roughness:0.3,metalness:0.1}));
    soap.position.set(cx-w*.18+vanW*0.3,0.94,cz+d*.2);procAdd(soap);
    // Small shelf in shower for bottles
    if(w>2.0&&d>2.0){
      var shShelf=box(0.25,0.02,0.1,MAT.steel);
      shShelf.position.set(cx-w*.32,1.2,cz-d*.28-Math.min(0.9,d*.28)*0.35);procAdd(shShelf);
      // Shampoo bottle
      var bottle=cyl(0.02,0.02,0.14,6,new THREE.MeshStandardMaterial({color:0x4A7A8C,roughness:0.3}));
      bottle.position.set(cx-w*.32+0.05,1.28,cz-d*.28-Math.min(0.9,d*.28)*0.35);procAdd(bottle);
    }
    // Bath mat
    var bMat=createBathMat(0.5,0.35);
    bMat.position.set(cx,.008,cz+d*.08);procAdd(bMat);
    // Recessed ceiling light
    var bCL=createCeilingLight();procAddGrp(bCL,cx,0,cz);
    // Second ceiling light for larger bathrooms
    if(area>5){
      var bCL2=createCeilingLight();procAddGrp(bCL2,cx-w*.25,0,cz-d*.2);
    }
    // Washing machine in larger bathrooms
    if(area>6&&w>2.2){
      var wMach=createWashingMachine();
      procAddGrp(wMach,cx+w*.32,0,cz+d*.28);
    }
    // Light switch
    var btLS=createLightSwitch();procAddGrp(btLS,rx+0.12,0,cz+d*.35);
  }
  if(r.type==="veranda"||r.type==="balcony"||r.type==="patio"){
    var rlM=MAT.steel;
    var nP=Math.min(8,Math.max(2,Math.floor(w/.4)));
    for(var pi=0;pi<nP;pi++){
      var post=cyl(.015,.015,.9,6,rlM);
      post.position.set(cx-w*.4+pi*(w*.8/Math.max(1,nP-1)),.45,cz+d*.38);procAdd(post);
    }
    procAddAt(box(w*.82,.025,.025,rlM),cx,.9,cz+d*.38);
    procAddAt(box(w*.82,.02,.02,rlM),cx,.45,cz+d*.38);
    // Outdoor seating (2 chairs + small table)
    if(area>4){
      var oChair1=box(0.45,0.05,0.45,new THREE.MeshStandardMaterial({color:0x5A4A3A,roughness:0.6}));
      oChair1.position.set(cx-w*.15,0.38,cz);procAdd(oChair1);
      var oBack1=box(0.45,0.35,0.04,new THREE.MeshStandardMaterial({color:0x5A4A3A,roughness:0.6}));
      oBack1.position.set(cx-w*.15,0.58,cz-0.2);procAdd(oBack1);
      var oTable=cyl(0.2,0.2,0.02,12,MAT.oak);oTable.position.set(cx,0.45,cz);procAdd(oTable);
      var oTLeg=cyl(0.02,0.02,0.43,6,MAT.steel);oTLeg.position.set(cx,0.22,cz);procAdd(oTLeg);
    }
    // Potted plants (larger, outdoor style — wrapped for GLTF swap)
    var vPlantGrp=new THREE.Group();vPlantGrp.userData.gltfId='potted-plant';
    var vPot1=cyl(.14,.12,.22,8,MAT.potBrown);vPot1.position.set(0,.11,0);vPlantGrp.add(vPot1);
    var vFol=createFoliage(.25,.42);vPlantGrp.add(vFol);
    procAddGrp(vPlantGrp,cx-w*.35,0,cz-d*.25);
  }
  if(r.type==="office"){
    var deskW=Math.min(1.4,w*.5),deskD=Math.min(.65,d*.28);
    var desk=createOfficeDesk(deskW,deskD);desk.userData.gltfId='office-desk';
    procAddGrp(desk,cx,0,cz-d*.1);
    var oChair=createOfficeChair();oChair.userData.gltfId='office-chair';
    procAddGrp(oChair,cx,0,cz+d*.15);
    // Monitor on desk
    if(w>2.0){
      var monitor=createTV(Math.min(0.55,deskW*0.4));
      procAddGrp(monitor,cx,0.73,cz-d*.1-deskD*.2);
    }
    // Bookshelf flush against side wall
    if(w>2.5&&d>2.0){
      var oBsh=createBookshelf(Math.min(0.6,w*.18),1.4);
      oBsh.rotation.y=-Math.PI/2; // face into room from right wall
      procAddGrp(oBsh,cx+w/2-0.15,0,cz-d*.15);
    }
    // Office rug
    var oRug=createRug(Math.min(w*.5,1.5),Math.min(d*.35,1.2),"minimal");
    oRug.position.set(cx,.007,cz);procAdd(oRug);
    // Pendant light
    var oPL=createPendantLight();procAddGrp(oPL,cx,0,cz);
    // Light switch
    var oLS=createLightSwitch();procAddGrp(oLS,rx+0.12,0,cz+d*.35);
    // Plant (wrapped for GLTF swap)
    var oPlantGrp=new THREE.Group();oPlantGrp.userData.gltfId='potted-plant';
    var oPot=cyl(.08,.06,.14,8,MAT.potBrown);oPot.position.set(0,.07,0);oPlantGrp.add(oPot);
    var oFol=createFoliage(.15,.26);oPlantGrp.add(oFol);
    procAddGrp(oPlantGrp,cx-w*.35,0,cz+d*.35);
  }
  if(r.type==="staircase"){
    var nSteps=Math.min(10,Math.floor(d/.25));
    var stepW=Math.min(w*.8,1.2),stepD=d/nSteps;
    var stpM=MAT.oak;
    for(var si2=0;si2<nSteps;si2++){
      var sh2=(si2+1)*WH/nSteps;
      procAddAt(box(stepW,sh2,stepD-.02,stpM),cx,sh2/2,cz-d/2+stepD*si2+stepD/2);
    }
    // Railing posts
    procAddAt(box(.03,WH,.03,MAT.steel),cx-stepW/2-.05,WH/2,cz-d/2);
    procAddAt(box(.03,WH,.03,MAT.steel),cx-stepW/2-.05,WH/2,cz+d/2);
    // Handrail
    procAddAt(box(.03,.03,d,MAT.oak),cx-stepW/2-.05,WH-.03,cz);
    // Right railing
    procAddAt(box(.03,WH,.03,MAT.steel),cx+stepW/2+.05,WH/2,cz-d/2);
    procAddAt(box(.03,WH,.03,MAT.steel),cx+stepW/2+.05,WH/2,cz+d/2);
    procAddAt(box(.03,.03,d,MAT.oak),cx+stepW/2+.05,WH-.03,cz);
  }
  if(r.type==="hallway"||r.type==="entrance"||r.type==="passage"){
    // Hallway runner rug
    if(d>w){
      var hRug=createRug(Math.min(w*.5,0.8),Math.min(d*.6,2.0),"minimal");
      hRug.position.set(cx,.007,cz);procAdd(hRug);
    }else{
      var hRug2=createRug(Math.min(w*.6,2.0),Math.min(d*.5,0.8),"minimal");
      hRug2.position.set(cx,.007,cz);procAdd(hRug2);
    }
    // Recessed ceiling lights along hallway
    var hSpots=Math.max(1,Math.floor(Math.max(w,d)/2));
    for(var hi2=0;hi2<hSpots;hi2++){
      var hcl=createCeilingLight();
      if(d>w){procAddGrp(hcl,cx,0,ry+d/(hSpots+1)*(hi2+1))}
      else{procAddGrp(hcl,rx+w/(hSpots+1)*(hi2+1),0,cz)}
    }
    // Console table (if entrance)
    if(r.type==="entrance"&&w>1.5){
      procAddAt(box(Math.min(0.8,w*.4),0.75,0.28,MAT.walnut),cx,0.375,cz-d*.3);
    }
    // Coat rack in entrance/hallway (if wide enough)
    if(w>1.3&&d>1.5){
      var cRack=createCoatRack();
      procAddGrp(cRack,cx+w*.32,0,cz-d*.32);
    }
    // Shoe rack near entrance
    if(r.type==="entrance"&&w>1.5){
      var sRack=createShoeRack();
      procAddGrp(sRack,cx-w*.28,0,cz-d*.28);
    }
    // Light switch
    var hLS=createLightSwitch();procAddGrp(hLS,rx+0.12,0,cz);
  }
  if(r.type==="utility"||r.type==="storage"||r.type==="closet"){
    // Washing machine in utility rooms
    if(w>1.0&&d>1.0){
      var uWM=createWashingMachine();
      procAddGrp(uWM,cx-w*.25,0,cz-d*.28);
    }
    // Floating shelf for storage
    if(w>1.2){
      var uShelf=createFloatingShelf(Math.min(0.7,w*.4));
      procAddGrp(uShelf,cx,1.3,cz+d*.35);
    }
    // Ceiling light
    var uCL=createCeilingLight();procAddGrp(uCL,cx,0,cz);
    // Light switch
    var uLS=createLightSwitch();procAddGrp(uLS,rx+0.12,0,cz+d*.35);
  }
  // ─── Smart fallback furniture for unrecognized room types ──────────────────
  // Rooms typed "other" (wine cellar, gym, spa, movie room, etc.) get generic furniture
  // based on room size so they're never empty
  var _handledTypes=['living','studio','bedroom','dining','kitchen','bathroom','veranda','balcony','patio','office','staircase','hallway','entrance','passage','utility','storage','closet'];
  if(_handledTypes.indexOf(r.type)===-1&&Math.min(w,d)>=1.0){
    // Rug in center
    if(area>3){
      var otRug=createRug(Math.min(w*.5,1.5),Math.min(d*.4,1.0),"minimal");
      otRug.position.set(cx,.007,cz);procAdd(otRug);
    }
    // Ceiling light
    var otCL=createCeilingLight();procAddGrp(otCL,cx,0,cz);
    // Light switch
    var otLS=createLightSwitch();procAddGrp(otLS,rx+0.12,0,cz+d*.35);
    // Medium rooms: add seating + table (like a generic multi-purpose room)
    if(area>6&&w>2.0){
      var otSofa=createSofa(Math.min(1.6,w*.45),.7);
      procAddGrp(otSofa,cx,0,cz-d*.2);
      var otCT=createCoffeeTable(Math.min(.7,w*.25),Math.min(.4,d*.15));
      procAddGrp(otCT,cx,0,cz+.1);
    }
    // Large rooms: add more items (bookshelf, side table)
    if(area>10&&w>2.5){
      var otBsh=createBookshelf(Math.min(0.6,w*.15),1.3);
      procAddGrp(otBsh,cx+w*.35,0,cz);
      var otST=createSideTable();procAddGrp(otST,cx-w*.3,0,cz-d*.2);
    }
    // Wall painting
    if(d>2.0)addPainting(cx,1.65,ry+0.06,0.55,0.4,0);
  }
  // ─── Plants in every room > 6m² ─────────────────────────────────────────────
  if(area>6&&r.type!=="staircase"&&r.type!=="bathroom"&&r.type!=="living"&&r.type!=="studio"&&r.type!=="bedroom"&&r.type!=="office"&&r.type!=="veranda"&&r.type!=="balcony"&&r.type!=="patio"){
    var gpGrp=new THREE.Group();gpGrp.userData.gltfId='potted-plant';
    var ptPot=cyl(.09,.07,.16,8,MAT.potBrown);ptPot.position.set(0,.08,0);gpGrp.add(ptPot);
    var ptFol=createFoliage(.18,.30);gpGrp.add(ptFol);
    procAddGrp(gpGrp,cx+w*.38,0,cz+d*.38);
    if(area>12){
      var gpGrp2=new THREE.Group();gpGrp2.userData.gltfId='potted-plant';
      var ptPot2=cyl(.07,.055,.13,8,MAT.potBrown);ptPot2.position.set(0,.065,0);gpGrp2.add(ptPot2);
      var ptFol2=createFoliage(.13,.23);gpGrp2.add(ptFol2);
      procAddGrp(gpGrp2,cx-w*.36,0,cz-d*.36);
    }
  }
  // Ceilings removed — open top for architectural cutaway view
  __procGroups[roomKey]=procGrp;
  scene.add(procGrp);
});

// ─── Flush GLTF loading queue (priority-sorted, max 4 concurrent) ───────────
if(gltfLoader&&loadQueue.length>0){
  flushQueue();
}

// ─── Wall Painting (abstract art on canvas with frame) ──────────────────────
function addPainting(px,py,pz,pw,ph,rotY){
  // Frosted glass frame — modern look, semi-transparent so user can see through slightly
  var g=new THREE.Group();
  g.position.set(px,py,pz);
  g.rotation.y=rotY||0;
  // Thin metallic frame border
  var frameMat=new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:0.25,metalness:0.7});
  var ft=0.018; // frame thickness
  g.add(box(pw+ft*2,ft,0.02,frameMat)); // top
  g.children[g.children.length-1].position.set(0,ph/2+ft/2,0);
  g.add(box(pw+ft*2,ft,0.02,frameMat)); // bottom
  g.children[g.children.length-1].position.set(0,-ph/2-ft/2,0);
  g.add(box(ft,ph,0.02,frameMat)); // left
  g.children[g.children.length-1].position.set(-pw/2-ft/2,0,0);
  g.add(box(ft,ph,0.02,frameMat)); // right
  g.children[g.children.length-1].position.set(pw/2+ft/2,0,0);
  // Frosted glass panel — semi-transparent with abstract color tint
  var ac2=document.createElement('canvas');ac2.width=160;ac2.height=120;
  var actx=ac2.getContext('2d');
  var pals=[['#4A6741','#8B6B4A','#5B7A8C','#C49A6C'],['#2C4A6B','#8B4A4A','#4A7B5B','#9B7A4A'],['#6B5030','#4A6B5A','#7B5A4A','#3A5A7B']];
  var pal=pals[Math.floor(Math.random()*pals.length)];
  actx.fillStyle=pal[0];actx.fillRect(0,0,160,120);
  for(var ai2=0;ai2<7;ai2++){actx.fillStyle=pal[Math.floor(Math.random()*pal.length)];actx.globalAlpha=0.3+Math.random()*0.4;actx.fillRect(Math.random()*100,Math.random()*70,25+Math.random()*70,20+Math.random()*50)}
  actx.globalAlpha=1;
  var glassMat=new THREE.MeshPhysicalMaterial({
    map:new THREE.CanvasTexture(ac2),
    transparent:true,opacity:0.6,
    roughness:0.15,metalness:0.0,
    envMapIntensity:0.4,
    side:THREE.DoubleSide
  });
  var glassP=new THREE.Mesh(new THREE.PlaneGeometry(pw,ph),glassMat);
  glassP.translateZ(0.005);
  g.add(glassP);
  // Subtle white backing (so art colors show through the glass)
  var backP=new THREE.Mesh(new THREE.PlaneGeometry(pw,ph),new THREE.MeshStandardMaterial({color:0xF8F4F0,roughness:0.9}));
  backP.translateZ(-0.005);
  g.add(backP);
  scene.add(g);
}

// ─── Door Frame + Panel ─────────────────────────────────────────────────────
var dfMat=new THREE.MeshStandardMaterial({color:0x8B6B4A,roughness:0.45,metalness:0.03});
var dpMat=new THREE.MeshStandardMaterial({color:0xA88860,roughness:0.35,metalness:0.02});
var dhMat=new THREE.MeshStandardMaterial({color:0xC0C0C0,roughness:0.15,metalness:0.85});
function addDoorFrame(dx,dz,isVert){
  var dw=0.85,dh=2.1,ft=0.055,fd=0.13;
  if(isVert){
    addAt(box(fd,dh,ft,dfMat),dx,dh/2,dz-dw/2);
    addAt(box(fd,dh,ft,dfMat),dx,dh/2,dz+dw/2);
    addAt(box(fd,ft,dw+ft*2,dfMat),dx,dh+ft/2,dz);
    var dp=box(0.035,dh-0.05,dw-0.06,dpMat);
    dp.geometry.translate(0,0,dw/2-0.03);
    dp.position.set(dx,dh/2,dz-dw/2+0.03);dp.rotation.y=0.3;dp.castShadow=true;scene.add(dp);
    var dhl=cyl(0.012,0.012,0.1,8,dhMat);dhl.rotation.z=Math.PI/2;dhl.position.set(dx+0.04,1.0,dz+dw*0.15);scene.add(dhl);
  }else{
    addAt(box(ft,dh,fd,dfMat),dx-dw/2,dh/2,dz);
    addAt(box(ft,dh,fd,dfMat),dx+dw/2,dh/2,dz);
    addAt(box(dw+ft*2,ft,fd,dfMat),dx,dh+ft/2,dz);
    var dp2=box(dw-0.06,dh-0.05,0.035,dpMat);
    dp2.geometry.translate(dw/2-0.03,0,0);
    dp2.position.set(dx-dw/2+0.03,dh/2,dz);dp2.rotation.y=0.3;dp2.castShadow=true;scene.add(dp2);
    var dhl2=cyl(0.012,0.012,0.1,8,dhMat);dhl2.rotation.x=Math.PI/2;dhl2.position.set(dx+dw*0.15,1.0,dz+0.04);scene.add(dhl2);
  }
}

// ─── WALLS ──────────────────────────────────────────────────────────────────
if(HAS_SVG_WALLS){
// Render wall segments from SVG parsing
var svgWallMat=makePBRWall(true);
var svgIntMat=makePBRWall(false);
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
var extMat=makePBRWall(true);
var intMat=makePBRWall(false);
var EWT=0.18,IWT=0.12,DGap=0.85,DHt=2.1;
var EDGE_TOL=0.35; // tolerance for shared-edge detection (meters) — conservative to avoid walls across corridors

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
      if(edges[ei].check<EDGE_TOL){
        var wallX=edges[ei].wallX;
        var oTop=Math.max(ay,by),oBot=Math.min(ay+ad,by+bd);
        if(oBot>oTop+0.1){
          var key="v"+wallX.toFixed(2)+"_"+oTop.toFixed(2)+"_"+oBot.toFixed(2);
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
                addDoorFrame(wallX,wMid,true);
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
      if(hedges[hi].check<EDGE_TOL){
        var wallZ=hedges[hi].wallZ;
        var oLeft=Math.max(ax,bx),oRight=Math.min(ax+aw,bx+bw);
        if(oRight>oLeft+0.1){
          var key2="h"+wallZ.toFixed(2)+"_"+oLeft.toFixed(2)+"_"+oRight.toFixed(2);
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
                addDoorFrame(wMid2,wallZ,false);
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

// Gap-filling pass REMOVED — it created phantom walls in corridors and passages.
// The pairwise detection above only places walls where rooms actually share edges,
// which correctly matches the 2D floor plan layout.
}

// ─── Baseboards (subtle dark strip at wall base) ─────────────────────────────
var bbMat=new THREE.MeshStandardMaterial({color:0xF0ECE6,roughness:.35,metalness:.03,envMapIntensity:.15});
var bbH=0.10,bbD=0.03; // taller + thicker for realistic skirting board
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
var cmMat=new THREE.MeshStandardMaterial({color:0xEDE9E3,roughness:.3,metalness:.04,envMapIntensity:.15});
var cmH=0.05,cmD=0.035; // slightly larger crown profile
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
var winMat=new THREE.MeshPhysicalMaterial({color:0xC8DEF0,roughness:.02,metalness:.02,transparent:true,opacity:.18,side:THREE.DoubleSide,envMapIntensity:1.0,clearcoat:0.6,clearcoatRoughness:0.03});
var winFrameMat=new THREE.MeshPhysicalMaterial({color:0x1A1A1A,roughness:.3,metalness:.5,envMapIntensity:.5,clearcoat:0.4,clearcoatRoughness:0.1});
var winH=0.9,winBottom=1.0,winW=0.7;

// Light shaft material (subtle volumetric sunbeam through windows)
var shaftMat=new THREE.MeshBasicMaterial({color:0xFFF8E0,transparent:true,opacity:0.04,side:THREE.DoubleSide,depthWrite:false});

function addWindow(wx,wz,rot){
  // Glass pane
  var glass=new THREE.Mesh(new THREE.PlaneGeometry(winW,winH),winMat);
  glass.position.set(wx,winBottom+winH/2,wz);
  glass.rotation.y=rot;scene.add(glass);
  // Frame (4 outer bars)
  var fT=0.025;
  var fTop=box(winW+fT*2,fT,fT,winFrameMat);fTop.position.set(wx,winBottom+winH,wz);fTop.rotation.y=rot;scene.add(fTop);
  var fBot=box(winW+fT*2,fT,fT,winFrameMat);fBot.position.set(wx,winBottom,wz);fBot.rotation.y=rot;scene.add(fBot);
  var fLeft=box(fT,winH,fT,winFrameMat);fLeft.position.set(wx,winBottom+winH/2,wz);fLeft.rotation.y=rot;fLeft.translateX(-winW/2);scene.add(fLeft);
  var fRight=box(fT,winH,fT,winFrameMat);fRight.position.set(wx,winBottom+winH/2,wz);fRight.rotation.y=rot;fRight.translateX(winW/2);scene.add(fRight);
  // Center mullion (vertical divider)
  var mulV=box(fT,winH-.02,fT,winFrameMat);mulV.position.set(wx,winBottom+winH/2,wz);mulV.rotation.y=rot;scene.add(mulV);
  // Horizontal transom bar
  var mulH=box(winW,fT,fT,winFrameMat);mulH.position.set(wx,winBottom+winH*0.55,wz);mulH.rotation.y=rot;scene.add(mulH);
  // Sill (slightly protruding ledge)
  var sill=box(winW+.08,.025,.06,winFrameMat);sill.position.set(wx,winBottom-.01,wz);sill.rotation.y=rot;scene.add(sill);
  // Light shaft — subtle sun beam through window (tapered box, very transparent)
  var shaftLen=2.5+Math.random()*1.5;
  var shaftGeo=new THREE.PlaneGeometry(winW*.8,shaftLen);
  var shaft=new THREE.Mesh(shaftGeo,shaftMat);
  shaft.position.set(wx,winBottom+winH*0.4,wz);
  shaft.rotation.y=rot;
  shaft.rotation.x=-Math.PI*0.35; // angled downward like sun rays
  shaft.translateZ(shaftLen*0.4);
  scene.add(shaft);
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
try{fpControls=new THREE.PointerLockControls(fpCamera,renderer.domElement)}catch(e){/* PointerLockControls not available */}
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

// Detect entrance position for cinematic walk-in
var __entryRoom=null,__entryX=CX,__entryZ=BD;
for(var eri=0;eri<D.rooms.length;eri++){
  var er=D.rooms[eri];
  if(er.type==='entrance'||er.type==='hallway'){__entryRoom=er;break}
}
if(!__entryRoom){
  // Pick room closest to front wall (max z edge)
  var bestFront=-1;
  for(var eri2=0;eri2<D.rooms.length;eri2++){
    var er2=D.rooms[eri2];
    var erEdge=(er2.y||0)+er2.depth;
    if(erEdge>bestFront){bestFront=erEdge;__entryRoom=er2}
  }
}
if(__entryRoom){
  __entryX=(__entryRoom.x||0)+__entryRoom.width/2;
  __entryZ=(__entryRoom.y||0)+__entryRoom.depth;
}

var walkEntryAnimating=false;

function enterWalkMode(){
  if(!fpControls)return;
  var clickOverlay=document.createElement('div');
  clickOverlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
  clickOverlay.innerHTML='<div style="text-align:center;font-family:Inter,system-ui,sans-serif;"><div style="font-size:48px;margin-bottom:16px;">\\u{1F6B6}</div><div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:8px;">Click to Enter Home</div><div style="font-size:13px;color:#8A8AA8;line-height:1.6;">Cinematic entrance &rarr; then WASD to explore</div></div>';
  clickOverlay.addEventListener('click',function(){
    document.body.removeChild(clickOverlay);
    controls.enabled=false;
    walkEntryAnimating=true;
    isWalking=true;

    // Start outside the front door
    var startPos=new THREE.Vector3(__entryX,1.6,__entryZ+3.0);
    // End inside the first room
    var endPos=new THREE.Vector3(__entryX,1.6,__entryZ-1.5);
    var startTime=Date.now();
    var totalDur=3000; // 3 seconds cinematic entry

    // Show HUD overlay during animation
    walkOvl.style.display='block';
    walkOvl.innerHTML='<div style="font-size:16px;font-weight:600;color:#6EA0FF;letter-spacing:1px">ENTERING HOME...</div>';

    function animateEntry(){
      var elapsed=Date.now()-startTime;
      var t=Math.min(1,elapsed/totalDur);
      // Smooth ease-in-out
      var e=t<0.5?2*t*t:(1-Math.pow(-2*t+2,2)/2);

      // Interpolate position with subtle head bob
      fpCamera.position.lerpVectors(startPos,endPos,e);
      fpCamera.position.y=1.6+Math.sin(elapsed*0.005)*0.025*(1-t);

      // Slow look-around in the last 30% of the animation
      if(t>0.7){
        var lookT=(t-0.7)/0.3;
        fpCamera.rotation.y=Math.sin(lookT*Math.PI*1.5)*0.35*(1-lookT);
        fpCamera.rotation.x=-0.05*(1-lookT);
      }else{
        // Look straight ahead (toward interior)
        fpCamera.rotation.set(-0.04,0,0);
      }

      // Render with fpCamera
      renderPass.camera=fpCamera;
      composer.render();
      renderPass.camera=camera;

      if(t<1){
        requestAnimationFrame(animateEntry);
      }else{
        // Animation done — hand over to user
        walkEntryAnimating=false;
        walkOvl.innerHTML='<div style="font-size:18px;font-weight:700;margin-bottom:8px;color:#6EA0FF">First-Person Walkthrough</div><div style="font-size:13px;color:#8A8AA8;line-height:1.5">WASD to move &middot; Mouse to look &middot; ESC to exit</div>';
        setTimeout(function(){walkOvl.style.display='none'},2000);
        fpControls.lock();
        crosshair.style.display='block';
        try{parent.postMessage({type:'walkModeChanged',walking:true},'*')}catch(e2){}
      }
    }

    animateEntry();
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
  if(walkEntryAnimating)return; // cinematic entry handles its own rendering
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

// SSAO — ambient occlusion darkens corners where walls meet floors/ceilings
// This is THE #1 realism upgrade — makes every surface feel grounded
try{
  var ssaoPass=new THREE.SSAOPass(scene,camera,innerWidth,innerHeight);
  ssaoPass.kernelRadius=0.6;
  ssaoPass.minDistance=0.003;
  ssaoPass.maxDistance=0.12;
  ssaoPass.output=THREE.SSAOPass.OUTPUT.Default;
  composer.addPass(ssaoPass);
}catch(e){/* SSAO not available */}

// Bloom (very subtle — preserves texture detail)
var bloomPass=new THREE.UnrealBloomPass(
  new THREE.Vector2(innerWidth,innerHeight),
  0.10,0.4,0.88
);
composer.addPass(bloomPass);

// Color grading (warm tint + contrast + vignette + film grain + subtle sharpen)
var colorGradeShader={
  uniforms:{
    tDiffuse:{value:null},
    brightness:{value:0.035},
    contrast:{value:0.10},
    warmth:{value:0.06},
    vignette:{value:0.12},
    saturation:{value:1.08},
    time:{value:0.0}
  },
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:[
    'uniform sampler2D tDiffuse;',
    'uniform float brightness;uniform float contrast;uniform float warmth;uniform float vignette;uniform float saturation;uniform float time;',
    'varying vec2 vUv;',
    'float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}',
    'void main(){',
    '  vec4 color=texture2D(tDiffuse,vUv);',
    '  // Brightness + contrast',
    '  color.rgb+=brightness;',
    '  color.rgb=(color.rgb-0.5)*(1.0+contrast)+0.5;',
    '  // Warm tone mapping',
    '  color.r+=warmth*0.7;color.g+=warmth*0.35;color.b-=warmth*0.15;',
    '  // Saturation boost',
    '  float lum=dot(color.rgb,vec3(0.299,0.587,0.114));',
    '  color.rgb=mix(vec3(lum),color.rgb,saturation);',
    '  // Subtle film grain (architectural rendering look)',
    '  float grain=rand(vUv+fract(time))*0.02-0.01;',
    '  color.rgb+=grain;',
    '  // Vignette (elliptical, softer falloff)',
    '  vec2 center=vUv-0.5;float dist=length(center*vec2(1.0,0.8));',
    '  color.rgb*=smoothstep(0.8,0.35,dist*vignette*8.0);',
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
}catch(e){/* FXAA not available */}

// ─── Animate ─────────────────────────────────────────────────────────────────
function animate(){
  requestAnimationFrame(animate);
  colorPass.uniforms.time.value=performance.now()*0.001;
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
animate();
addEventListener("resize",function(){
  var w2=innerWidth,h2=innerHeight;
  camera.aspect=w2/h2;camera.updateProjectionMatrix();
  fpCamera.aspect=w2/h2;fpCamera.updateProjectionMatrix();
  renderer.setSize(w2,h2);composer.setSize(w2,h2);
  if(fxaaPass)fxaaPass.uniforms['resolution'].value.set(1/w2,1/h2);
});

<\/script>
</body>
</html>`;
}
