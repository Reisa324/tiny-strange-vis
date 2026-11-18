import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';

const $=id=>document.getElementById(id),host=$('model'),status=$('status'),slider=$('fold'),playButton=$('play');
const buttons=[playButton,$('expand'),$('collapse'),$('reset')];
function notifyChapter(state){
  if(parent!==window)parent.postMessage({chapter:'fold',state,attempt:new URLSearchParams(location.search).get('chapter-attempt')},location.origin);
}
notifyChapter('loading');
const scene=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setClearColor(0xffffff,0);
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.AgXToneMapping;
renderer.toneMappingExposure=1.08;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFShadowMap;
host.appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(35,1,10,5000);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.08;controls.rotateSpeed=.65;controls.zoomSpeed=.8;
controls.minDistance=120;controls.maxDistance=2400;
// The model viewport owns wheel zoom; one-finger vertical pan still scrolls.
renderer.domElement.style.touchAction='pan-y';
// The iframe fills the chapter, so explicitly pass wheel input in its blank
// margins and controls to the containing page. OrbitControls owns the frame.
document.addEventListener('wheel',event=>{
  if(host.contains(event.target)||event.ctrlKey||event.metaKey||window.parent===window||!event.deltaY)return;
  try{
    const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
    window.parent.scrollBy(0,pixels);event.preventDefault();
  }catch{/* Allow native scroll chaining when embedded across origins. */}
},{passive:false});

// Broad environment illumination plus a modest key/fill ratio keeps the printed faces readable.
scene.add(new THREE.HemisphereLight(0xffffff,0xe1d9cc,.55));
const key=new THREE.DirectionalLight(0xffffff,1.45);key.position.set(-260,430,-340);
key.castShadow=true;key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-360,right:360,top:360,bottom:-360,near:10,far:1500});
key.shadow.bias=-.00004;key.shadow.normalBias=.06;
scene.add(key,key.target);
const fill=new THREE.DirectionalLight(0xffffff,.95);fill.position.set(300,180,-220);scene.add(fill,fill.target);
const rim=new THREE.DirectionalLight(0xfffaf1,.5);rim.position.set(50,330,320);scene.add(rim,rim.target);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),new THREE.ShadowMaterial({color:0x5b5045,opacity:.12,depthWrite:false}));
ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);

let model=null,mixer=null,duration=0,progress=1,playing=false,dirty=true,raf=0,lastTime=0;
let chapterPainted=false;
let autoFrame=true;
const viewDirection=new THREE.Vector3(-.65,.45,-1).normalize();
let profile='desktop';const actions=[];
function wake(){dirty=true;if(!raf)raf=requestAnimationFrame(render);}
function setProgress(next){
  progress=THREE.MathUtils.clamp(next,0,1);
  for(const {action,clip} of actions){action.enabled=true;action.paused=false;action.time=Math.min(progress*duration,clip.duration-.00001);}
  mixer?.update(0);model?.updateMatrixWorld(true);
  if(model){const box=new THREE.Box3().setFromObject(model);ground.position.y=box.min.y-.12;ground.visible=progress>.03;if(autoFrame)fitView();}
  slider.value=String(progress*100);slider.style.setProperty('--progress',progress*100+'%');$('value').textContent=Math.round(progress*100)+'%';wake();
}
function pause(){playing=false;playButton.classList.remove('is-playing');playButton.setAttribute('aria-label','Play');playButton.setAttribute('aria-pressed','false');}
function togglePlay(){
  if(!mixer)return;
  if(playing){pause();wake();return;}
  autoFrame=true;
  if(progress>=.999)setProgress(0);
  playing=true;lastTime=0;playButton.classList.add('is-playing');playButton.setAttribute('aria-label','Pause');playButton.setAttribute('aria-pressed','true');wake();
}
function poseEnvelope(){
  const points=[];
  model.traverse(object=>{
      if(!object.isMesh)return;
      object.geometry.computeBoundingBox();const box=object.geometry.boundingBox;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(object.matrixWorld));
  });
  return points;
}
function fitView(flat=null){
  if(!model)return;
  if(flat!==null){autoFrame=true;viewDirection.copy(flat?new THREE.Vector3(0,0,1):new THREE.Vector3(-.65,.45,-1)).normalize();}
  const direction=viewDirection;
  const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
  const points=poseEnvelope(),axes=[right,up,direction],middle=axes.map(axis=>{let lo=Infinity,hi=-Infinity;for(const p of points){const v=p.dot(axis);lo=Math.min(lo,v);hi=Math.max(hi,v);}return(lo+hi)/2});
  const center=new THREE.Vector3();axes.forEach((axis,i)=>center.addScaledVector(axis,middle[i]));
  const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  let distance=120;const delta=new THREE.Vector3();
  for(const p of points){delta.copy(p).sub(center);const depth=delta.dot(direction);distance=Math.max(distance,depth+Math.abs(delta.dot(right))/(tangent*camera.aspect*.90),depth+Math.abs(delta.dot(up))/(tangent*.90));}
  controls.maxDistance=Math.max(2400,distance*2);controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);controls.update();
  wake();
}
function resize(){
  const firstControl=Math.min(playButton.getBoundingClientRect().top,slider.getBoundingClientRect().top);
  host.style.height=Math.max(100,firstControl-18-host.getBoundingClientRect().top)+'px';
  const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
  camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);if(model)fitView(progress<.001);wake();
}
function render(now){
  raf=0;const delta=lastTime?Math.min((now-lastTime)/1000,.05):1/60;lastTime=now;
  if(playing){const next=progress+delta/7;setProgress(Math.min(1,next));if(next>=1)pause();}
  const changed=controls.update();
  if(dirty||changed||playing){
    renderer.render(scene,camera);dirty=false;
    if(window.__foldReady&&!chapterPainted){chapterPainted=true;notifyChapter('ready');}
  }
  if(playing||changed){if(!raf)raf=requestAnimationFrame(render);}else lastTime=0;
}
controls.addEventListener('change',wake);
controls.addEventListener('start',()=>{autoFrame=false;});
playButton.addEventListener('click',togglePlay);
slider.addEventListener('input',()=>{pause();autoFrame=true;setProgress(Number(slider.value)/100);});
$('expand').addEventListener('click',()=>{pause();setProgress(0);fitView(true);});
$('collapse').addEventListener('click',()=>{pause();setProgress(1);fitView(false);});
$('reset').addEventListener('click',()=>fitView(progress<.001));
addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.matches('input,button')){e.preventDefault();togglePlay();}});
addEventListener('resize',resize);resize();

const textureLoader=new THREE.TextureLoader(),anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
const base='./assets/fold-quality/';
function setupTexture(texture,color=false){texture.flipY=false;texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;texture.anisotropy=anisotropy;return texture;}
function paperTile(source,size,tile){
  const texture=source.clone();texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(size[0]/tile[0],size[1]/tile[1]);texture.needsUpdate=true;return texture;
}
async function loadQuality(){
  const response=await fetch(base+'materials.json?v=paper1');
  if(!response.ok)throw new Error('Paper material manifest not found');
  const materials=await response.json();
  profile=innerWidth<768||renderer.capabilities.maxTextureSize<4096||navigator.deviceMemory<=4?'mobile':'desktop';
  const [normal,roughness,gltf,hdr]=await Promise.all([
    textureLoader.loadAsync(base+materials.normal+'?v=paper3').then(t=>setupTexture(t)),
    textureLoader.loadAsync(base+materials.roughness+'?v=paper3').then(t=>setupTexture(t)),
    new GLTFLoader().loadAsync('../TinyStrange_Foldable_animated.glb?v=clearance6'),
    new HDRLoader().loadAsync('./assets/studio_small_09_2k.hdr')
  ]);
  const pmrem=new THREE.PMREMGenerator(renderer);hdr.mapping=THREE.EquirectangularReflectionMapping;
  scene.environment=pmrem.fromEquirectangular(hdr).texture;scene.environmentIntensity=.85;hdr.dispose();pmrem.dispose();
  status.textContent='正在载入高清印刷与纸张纹理…';
  notifyChapter('loading');
  const colors=new Map();
  await Promise.all(Object.entries(materials.materials).filter(([,m])=>!m.edge).map(async([name,m])=>{
    colors.set(name,setupTexture(await textureLoader.loadAsync(base+m[profile].file),true));
  }));
  const cache=new Map();model=gltf.scene;model.rotation.x=Math.PI/2;
  model.traverse(object=>{
    if(!object.isMesh)return;
    object.castShadow=true;object.receiveShadow=true;
    const originals=Array.isArray(object.material)?object.material:[object.material];
    const upgraded=originals.map(original=>{
      if(cache.has(original.name))return cache.get(original.name);
      const entry=materials.materials[original.name];if(!entry)throw new Error('Unknown paper material: '+original.name);
      const mat=new THREE.MeshPhysicalMaterial({name:original.name,metalness:0,roughness:entry.edge ? .88 : .96,side:THREE.DoubleSide});
      mat.dithering=true;
      mat.specularIntensity=.3;mat.ior=1.45;mat.envMapIntensity=.8;
      if(entry.edge){mat.color.set(entry.color);}else{
        mat.map=colors.get(original.name);
        mat.normalMap=paperTile(normal,entry.size_mm,materials.tile_mm);mat.normalScale.set(.18,.18);
        mat.roughnessMap=paperTile(roughness,entry.size_mm,materials.tile_mm);
        mat.sheen=.035;mat.sheenRoughness=.9;mat.sheenColor.set('#f0e8dc');
        mat.alphaTest=.08;mat.alphaToCoverage=true;
      }
      cache.set(original.name,mat);return mat;
    });
    object.material=Array.isArray(object.material)?upgraded:upgraded[0];
  });
  scene.add(model);mixer=new THREE.AnimationMixer(model);
  for(const clip of gltf.animations){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();actions.push({action,clip});duration=Math.max(duration,clip.duration);}
  if(!duration)throw new Error('Fold animation was not exported');
  setProgress(1);fitView(false);
  const center=new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  for(const light of [key,fill,rim]){light.position.add(center);light.target.position.copy(center);}
  status.hidden=true;for(const b of buttons)b.disabled=false;slider.disabled=false;
  window.__foldReady=true;wake();
}
loadQuality().catch(error=>{console.error(error);status.textContent='纸盒加载失败：'+error.message;notifyChapter('failed');});
window.__foldDemo={setProgress,pause,fitView,get progress(){return progress},get playing(){return playing},get model(){return model},get duration(){return duration},get mixer(){return mixer},get renderer(){return renderer},get scene(){return scene},get camera(){return camera},get controls(){return controls},get profile(){return profile},quality:'paper-20261117'};
