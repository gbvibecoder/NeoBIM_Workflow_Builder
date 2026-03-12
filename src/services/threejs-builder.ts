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

export function buildFloorPlan3D(data: FloorPlanGeometry, sourceImage?: string): string {
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
<script>
"use strict";
var D=${jsonData};
var WH=D.wallHeight||2.8,BW=D.footprint.width,BD=D.footprint.depth;
var isNonRect=D.buildingOutline&&D.buildingOutline.length>=3&&D.buildingShape&&D.buildingShape!=='rectangular';
var IMG_SRC="${sourceImage ?? ''}";
var HAS_IMG=IMG_SRC.length>10;
var HAS_SVG_WALLS=D.walls&&D.walls.length>4;
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

var camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,500);
var SP=new THREE.Vector3(CX+MXD*.8,MXD*.7,CZ+MXD*.9);
// Default to top-down view for floor plans
camera.position.set(CX,MXD*1.4,CZ+.01);
camera.lookAt(CX,0,CZ);
var renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.3;
renderer.outputEncoding=THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);
var controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.target.set(CX,0,CZ);

// ─── Lights (warm key + cool fill + sky hemisphere) ──────────────────────────
scene.add(new THREE.AmbientLight(0xFFF8F0,.6));
var sun=new THREE.DirectionalLight(0xFFF0D8,1.3);
sun.position.set(BW+6,20,-4);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
var sc=sun.shadow.camera;sc.left=-30;sc.right=30;sc.top=30;sc.bottom=-30;sc.near=1;sc.far=60;
sun.shadow.bias=-.0003;sun.shadow.normalBias=.02;scene.add(sun);
var fill=new THREE.DirectionalLight(0xD0E0F8,.5);
fill.position.set(-10,15,BD+6);scene.add(fill);
var rim=new THREE.DirectionalLight(0xE8D0FF,.2);
rim.position.set(CX,-2,CZ-MXD);scene.add(rim);
scene.add(new THREE.HemisphereLight(0xC8DEFF,0x8A7A60,.4));

// ─── Texture Generators (512x512 floor, 256x256 plaster) ────────────────────
function makeFloorTex(type,hex){
  var S=512,c=document.createElement("canvas");c.width=S;c.height=S;
  var g=c.getContext("2d");
  var R=(hex>>16)&0xff,G=(hex>>8)&0xff,B=hex&0xff;
  g.fillStyle="rgb("+R+","+G+","+B+")";g.fillRect(0,0,S,S);
  if(type==="wood"){
    for(var y=0;y<S;y+=40){
      var v=Math.random()*20-10;
      g.fillStyle="rgba("+(v>0?200:60)+","+(v>0?160:40)+","+(v>0?100:20)+","+(Math.abs(v)/200)+")";
      g.fillRect(0,y,S,38);
      g.fillStyle="rgba(60,30,10,0.15)";g.fillRect(0,y,S,1);
      for(var gi=0;gi<8;gi++){g.fillStyle="rgba(80,50,20,0.04)";g.fillRect(0,y+3+Math.random()*34,S,1)}
    }
  }else if(type==="tile"){
    var ts=42;g.strokeStyle="rgba(0,0,0,0.14)";g.lineWidth=1.5;
    for(var tx=0;tx<S;tx+=ts)for(var ty=0;ty<S;ty+=ts){
      var tv=Math.random()*12-6;
      g.fillStyle="rgb("+Math.max(0,Math.min(255,R+tv))+","+Math.max(0,Math.min(255,G+tv))+","+Math.max(0,Math.min(255,B+tv))+")";
      g.fillRect(tx+1,ty+1,ts-2,ts-2);
      g.strokeRect(tx,ty,ts,ts);
    }
  }else if(type==="mosaic"){
    var ms=16;for(var mx=0;mx<S;mx+=ms)for(var my=0;my<S;my+=ms){
      var mv=Math.random()*30-15;
      g.fillStyle="rgb("+Math.max(0,Math.min(255,R+mv))+","+Math.max(0,Math.min(255,G+mv))+","+Math.max(0,Math.min(255,B+mv))+")";
      g.fillRect(mx,my,ms-1,ms-1);
    }
  }else if(type==="stone"){
    for(var si=0;si<20;si++){
      var sx2=Math.random()*(S-60),sy2=Math.random()*(S-50),sw=30+Math.random()*50,sh=25+Math.random()*35;
      var sv=Math.random()*25-12;
      g.fillStyle="rgb("+Math.max(0,Math.min(255,R+sv))+","+Math.max(0,Math.min(255,G+sv))+","+Math.max(0,Math.min(255,B+sv))+")";
      g.fillRect(sx2,sy2,sw,sh);
      g.strokeStyle="rgba(0,0,0,0.1)";g.strokeRect(sx2,sy2,sw,sh);
    }
  }else{
    for(var nx=0;nx<S;nx+=6)for(var ny=0;ny<S;ny+=6){g.fillStyle="rgba(0,0,0,"+(Math.random()*.035)+")";g.fillRect(nx,ny,6,6)}
  }
  var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function makePlasterTex(){
  var c=document.createElement("canvas");c.width=256;c.height=256;
  var g=c.getContext("2d");g.fillStyle="#E8E2D8";g.fillRect(0,0,256,256);
  for(var i=0;i<800;i++){g.fillStyle="rgba(0,0,0,"+(Math.random()*.04)+")";g.fillRect(Math.random()*256,Math.random()*256,2+Math.random()*3,1+Math.random()*2)}
  var t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}

// ─── Color / texture maps ────────────────────────────────────────────────────
var TT={living:"wood",dining:"wood",bedroom:"wood",office:"wood",studio:"wood",kitchen:"tile",bathroom:"mosaic",veranda:"stone",balcony:"stone",patio:"stone",hallway:"concrete",entrance:"concrete",passage:"concrete",staircase:"concrete",utility:"concrete",storage:"concrete",closet:"concrete",other:"concrete"};
var FC={living:0xD4956A,dining:0xC8884E,kitchen:0xA8B8A0,bedroom:0xC09060,bathroom:0x7090A8,veranda:0x708868,balcony:0x708868,patio:0x708868,hallway:0x989088,entrance:0x989088,passage:0x989088,staircase:0x787078,utility:0x686068,storage:0x686068,closet:0x686068,office:0xC09060,studio:0xC8A050,other:0xA89888};
var LC={living:"#4F8AFF",dining:"#4F8AFF",studio:"#4F8AFF",bedroom:"#8B5CF6",office:"#8B5CF6",kitchen:"#10B981",bathroom:"#3B82F6",veranda:"#10B981",balcony:"#10B981",patio:"#10B981",hallway:"#F59E0B",entrance:"#F59E0B",passage:"#F59E0B",staircase:"#F59E0B",utility:"#707080",storage:"#707080",closet:"#707080",other:"#8888A0"};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function box(w,h,d,mat){var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.castShadow=true;m.receiveShadow=true;return m}
function addAt(m,x,y,z){m.position.set(x,y,z);scene.add(m);return m}

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

// ─── Subtle grid helper ──────────────────────────────────────────────────────
var gridSize=Math.ceil(Math.max(BW,BD)/2)*2+8;
var grid=new THREE.GridHelper(gridSize,gridSize,0x1E1E30,0x1E1E30);
grid.position.set(CX,-.14,CZ);grid.material.opacity=0.25;grid.material.transparent=true;scene.add(grid);

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
    fTex.repeat.set(w/3,d/3);
    fl=new THREE.Mesh(new THREE.ShapeGeometry(roomShape),new THREE.MeshStandardMaterial({map:fTex,roughness:.7,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2;fl.position.y=.005;fl.receiveShadow=true;
  }else if(HAS_IMG){
    fl=new THREE.Mesh(new THREE.PlaneGeometry(w-.04,d-.04),new THREE.MeshBasicMaterial({transparent:true,opacity:0,side:THREE.DoubleSide}));
    fl.rotation.x=-Math.PI/2;fl.position.set(cx,.005,cz);fl.receiveShadow=true;
  }else{
    var fTex2=makeFloorTex(TT[r.type]||"concrete",FC[r.type]||0xC0B8A8);
    fTex2.repeat.set(w/3,d/3);
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

  // ─── Furniture ─────────────────────────────────────────────────────────────
  if(Math.min(w,d)<1.6)return;

  if(r.type==="living"||r.type==="studio"){
    var sw2=Math.min(1.8,w*.45);
    var sM=new THREE.MeshStandardMaterial({color:0x5A5A6A,roughness:.85,metalness:.02});
    addAt(box(sw2,.28,.65,sM),cx,.28,cz-d*.22);
    addAt(box(sw2,.35,.1,sM),cx,.46,cz-d*.22-.28);
    addAt(box(.1,.2,.65,sM),cx-sw2/2+.05,.3,cz-d*.22);
    addAt(box(.1,.2,.65,sM),cx+sw2/2-.05,.3,cz-d*.22);
    // Coffee table (warm walnut)
    addAt(box(.65,.04,.4,new THREE.MeshStandardMaterial({color:0x8B6B3E,roughness:.35,metalness:.02})),cx,.4,cz+.2);
    // TV stand (dark charcoal)
    addAt(box(.5,.35,.3,new THREE.MeshStandardMaterial({color:0x2A2830,roughness:.6,metalness:.05})),cx,.175,cz+.2);
    // Rug with richer pattern
    var rugW=Math.min(w*.6,2.2),rugD=Math.min(d*.4,1.6);
    var rugC=document.createElement("canvas");rugC.width=128;rugC.height=128;
    var rugG=rugC.getContext("2d");
    rugG.fillStyle="#5C3D2E";rugG.fillRect(0,0,128,128);
    rugG.strokeStyle="#8B6C4B";rugG.lineWidth=8;rugG.strokeRect(8,8,112,112);
    rugG.strokeStyle="#A08050";rugG.lineWidth=3;rugG.strokeRect(16,16,96,96);
    rugG.strokeStyle="#C09860";rugG.lineWidth=1;rugG.strokeRect(24,24,80,80);
    var rugTex=new THREE.CanvasTexture(rugC);
    var rug=new THREE.Mesh(new THREE.PlaneGeometry(rugW,rugD),new THREE.MeshStandardMaterial({map:rugTex,roughness:.92}));
    rug.rotation.x=-Math.PI/2;rug.position.set(cx,.007,cz);rug.receiveShadow=true;scene.add(rug);
  }
  if(r.type==="bedroom"){
    var bW2=Math.min(1.5,w*.45),bD2=Math.min(1.9,d*.5);
    var fM=new THREE.MeshStandardMaterial({color:0x7A5A38,roughness:.55,metalness:.02});
    var mM=new THREE.MeshStandardMaterial({color:0xF0E8E0,roughness:.92});
    addAt(box(bW2+.1,.12,bD2+.1,fM),cx,.12,cz);
    addAt(box(bW2,.18,bD2,mM),cx,.27,cz);
    addAt(box(bW2+.1,.55,.08,fM),cx,.35,cz-bD2/2);
    var pM=new THREE.MeshStandardMaterial({color:0xF5F0E8,roughness:.9});
    addAt(box(.35,.08,.25,pM),cx-.28,.4,cz-bD2/2+.25);
    addAt(box(.35,.08,.25,pM),cx+.28,.4,cz-bD2/2+.25);
    if(w>2.5)addAt(box(.38,.42,.32,new THREE.MeshStandardMaterial({color:0x6B4A32,roughness:.5,metalness:.02})),cx+bW2/2+.35,.21,cz-bD2/2+.3);
  }
  if(r.type==="dining"){
    var tW2=Math.min(1.1,w*.35),tD2=Math.min(.7,d*.25);
    addAt(box(tW2,.04,tD2,new THREE.MeshStandardMaterial({color:0x7A4E2A,roughness:.35,metalness:.02})),cx,.72,cz);
    var lG=new THREE.CylinderGeometry(.02,.02,.68);var lM2=new THREE.MeshStandardMaterial({color:0x6A4A30,roughness:.5});
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(function(p){addAt(new THREE.Mesh(lG,lM2),cx+p[0]*tW2*.4,.34,cz+p[1]*tD2*.4)});
    var cM2=new THREE.MeshStandardMaterial({color:0x5A3A22,roughness:.55,metalness:.02});
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(function(p){
      var cx3=cx+p[0]*(tW2*.4+.35),cz3=cz+p[1]*(tD2*.4+.35);
      addAt(box(.35,.04,.35,cM2),cx3,.42,cz3);
      addAt(box(.35,.35,.04,cM2),cx3+(p[0]!==0?p[0]*.15:0),.62,cz3+(p[1]!==0?p[1]*.15:0));
    });
  }
  if(r.type==="kitchen"){
    var cW3=Math.min(w*.6,2.0);
    // Cabinets (dark matte navy)
    addAt(box(cW3,.82,.52,new THREE.MeshStandardMaterial({color:0x2A2A3A,roughness:.5,metalness:.03})),cx,.41,cz-d*.3);
    // Countertop (light stone with sheen)
    addAt(box(cW3+.06,.04,.56,new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.15,metalness:.08})),cx,.84,cz-d*.3);
    // Stove burners
    var stG=new THREE.CylinderGeometry(.06,.06,.02);var stM=new THREE.MeshStandardMaterial({color:0x1A1A1A,roughness:.25,metalness:.5});
    addAt(new THREE.Mesh(stG,stM),cx-.2,.86,cz-d*.3);addAt(new THREE.Mesh(stG,stM),cx+.2,.86,cz-d*.3);
    if(w>2.2){
      // Fridge (stainless steel look)
      addAt(box(.5,.78,.48,new THREE.MeshStandardMaterial({color:0xC0C0C8,roughness:.2,metalness:.4})),cx+cW3/2+.4,.39,cz-d*.3);
      addAt(box(.4,.02,.35,new THREE.MeshStandardMaterial({color:0xD0D0D8,roughness:.12,metalness:.35})),cx+cW3/2+.4,.8,cz-d*.3);
    }
  }
  if(r.type==="bathroom"){
    // Porcelain fixtures
    var btM=new THREE.MeshStandardMaterial({color:0xF5F5F5,roughness:.1,metalness:.03});
    addAt(box(.36,.32,.45,btM),cx+w*.15,.16,cz-d*.2);
    addAt(box(.3,.18,.12,btM),cx+w*.15,.35,cz-d*.2-.22);
    // Vanity (dark slate)
    addAt(box(.55,.48,.38,new THREE.MeshStandardMaterial({color:0x3A3A48,roughness:.4,metalness:.05})),cx-w*.15,.24,cz+d*.2);
    // Sink basin (white porcelain)
    addAt(box(.38,.03,.25,btM),cx-w*.15,.5,cz+d*.2);
    // Mirror (reflective)
    if(d>2.0){addAt(box(.5,.5,.02,new THREE.MeshStandardMaterial({color:0xD0D8E0,roughness:.02,metalness:.7})),cx-w*.15,1.4,cz+d*.35)}
  }
  if(r.type==="veranda"||r.type==="balcony"||r.type==="patio"){
    var rlM=new THREE.MeshStandardMaterial({color:0x555555,metalness:.7,roughness:.3});
    var pG=new THREE.CylinderGeometry(.015,.015,.9);
    var nP=Math.min(6,Math.max(2,Math.floor(w/.5)));
    for(var pi=0;pi<nP;pi++){addAt(new THREE.Mesh(pG,rlM),cx-w*.4+pi*(w*.8/Math.max(1,nP-1)),.45,cz+d*.38)}
    addAt(box(w*.8,.03,.03,rlM),cx,.9,cz+d*.38);
  }
  if(r.type==="office"){
    addAt(box(Math.min(1.2,w*.4),.04,Math.min(.6,d*.25),new THREE.MeshStandardMaterial({color:0x6B5030,roughness:.5})),cx,.72,cz-.1);
    addAt(box(.4,.04,.4,new THREE.MeshStandardMaterial({color:0x333344,roughness:.6})),cx,.4,cz+d*.15);
    if(w>2.2){
      addAt(box(.45,.3,.02,new THREE.MeshStandardMaterial({color:0x181820,roughness:.3})),cx,.95,cz-.3);
      addAt(box(.08,.12,.02,new THREE.MeshStandardMaterial({color:0x555555,roughness:.5})),cx,.78,cz-.28);
    }
  }
  if(r.type==="staircase"){
    var nSteps=Math.min(10,Math.floor(d/.25));
    var stepW=Math.min(w*.8,1.2),stepD=d/nSteps;
    var stpM=new THREE.MeshStandardMaterial({color:0x8B7355,roughness:.6});
    for(var si2=0;si2<nSteps;si2++){
      var sh2=(si2+1)*WH/nSteps;
      addAt(box(stepW,sh2,stepD-.02,stpM),cx,sh2/2,cz-d/2+stepD*si2+stepD/2);
    }
  }
});

// ─── WALLS ──────────────────────────────────────────────────────────────────
if(HAS_SVG_WALLS){
// Render wall segments from SVG parsing
var svgWallMat=new THREE.MeshStandardMaterial({map:makePlasterTex(),color:0xF0EBE3,roughness:.8});
var svgIntMat=new THREE.MeshStandardMaterial({map:makePlasterTex(),color:0xF5F0E8,roughness:.85});
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
var wMat=new THREE.MeshStandardMaterial({color:0xF0EBE3,roughness:.8});
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
var extMat=new THREE.MeshStandardMaterial({map:pTex,color:0xF0EBE3,roughness:.8});
var intMat=new THREE.MeshStandardMaterial({map:pTex,color:0xF5F0E8,roughness:.85});
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

// ─── Ceiling (translucent with warm tone) ───────────────────────────────────
var ceil=new THREE.Mesh(new THREE.PlaneGeometry(BW,BD),new THREE.MeshStandardMaterial({color:0xF0E8D8,transparent:true,opacity:.06,side:THREE.DoubleSide,depthWrite:false}));
ceil.rotation.x=Math.PI/2;ceil.position.set(CX,WH,CZ);scene.add(ceil);

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

// ─── Animate ─────────────────────────────────────────────────────────────────
function animate(){
  requestAnimationFrame(animate);
  if(cAnim){
    var t=Math.min(1,(Date.now()-cAnim.t0)/cAnim.d);
    var e2=easeOut(t);
    camera.position.lerpVectors(cAnim.sp,cAnim.ep,e2);
    controls.target.lerpVectors(cAnim.st,cAnim.et,e2);
    camera.lookAt(controls.target);
    if(t>=1){cAnim=null;controls.update()}
  }
  renderer.render(scene,camera);
}
console.log("[IFRAME] Three.js scene initialized. Rooms:",D.rooms.length,"Labels:",labels.length);
animate();
addEventListener("resize",function(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
<\/script>
</body>
</html>`;
}
