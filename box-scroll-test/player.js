'use strict';
(() => {
  const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:true});
  const detailCanvas=$('detail-canvas'),detailCtx=detailCanvas.getContext('2d',{alpha:true});
  const manifest=window.PREVIEW_MANIFEST,variants=window.PREVIEW_VARIANTS;
  const packManifest=window.PREVIEW_PACKS;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),N=manifest.frame_count,FPS=manifest.fps;
  if(!variants){$('notice').textContent='网页素材清单未加载，请确认同级 frames_web_120fps_optimized 文件夹完整。';return;}
  const original=variants.web3840;
  if(!original||variants.web1920.frames.length!==N||original.frames.length!==N){$('notice').textContent='120 fps素材清单不完整，请检查1080p与4K两套文件。';return;}
  const frameScale=FPS/30;
  let cache,profile,profileKey,target=0,shown=-1,scrollFrame=0,visualFrame=-1,blendWeight=0;
  let paintCount=0;
  const motion=new ScrollRhythm.Playhead(0);
  let playing=false,disposed=false,raf=0,lastTime=0,dirty=true,lastMetrics=0;
  let ignoreScrollY=null;
  let frameTimes=[],actualFPS=0,missingMs=0,profileGeneration=0;
  let highCache=null,highGoal=-1,highIndex=-1,highTimer=0,highShown=false,highTiming=null;
  let awaitExact=true;
  let assetsReady=false,buffering=false,playPosition=0,posterGeneration=0,highPreparation=null;
  let stagedQuality=null,highFailed=false,reportedFrameState;
  const packedSource=new PackedFrameSource({manifest:packManifest,concurrency:1,onProgress:()=>{}});
  const lightSource=new PackedFrameSource({manifest:window.PREVIEW_LIGHT_PACKS,concurrency:3,onProgress:preloadProgress});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const chapterAttempt=new URLSearchParams(location.search).get('chapter-attempt');
  function notifyChapter(state,percent){
    if(chapterAttempt!==null&&parent!==window)parent.postMessage({chapter:'sequence',state,percent,attempt:chapterAttempt},location.origin);
  }
  function reportFrameState(state){
    if(reportedFrameState===state)return;
    reportedFrameState=state;
    notifyChapter(state);
  }
  $('seek').max=N;
  function notice(text){if($('notice').textContent!==text)$('notice').textContent=text;}
  function preloadProgress(s){
    if(assetsReady||disposed)return;
    const percent=Math.floor(100*s.loadedBytes/s.totalBytes);
    $('load-progress').value=percent;$('load-text').textContent=`正在准备动画 · ${percent}%`;
    notifyChapter('loading',percent);
    metrics(performance.now(),true);
  }
  function enableTransport(){
    $('play').disabled=!assetsReady||profileKey==='original';
    for(const id of ['seek','prev','next','restart','quality'])$(id).disabled=!assetsReady;
    document.querySelectorAll('[data-frame]').forEach(b=>b.disabled=!assetsReady);
  }
  function prepareHighDefinition(){
    if(highPreparation)return highPreparation;
    highPreparation=packedSource.prepare().then(scheduleUpgrade).catch(error=>{
      highPreparation=null;if(!disposed)console.warn('High definition preload:',error.message);
    });
    return highPreparation;
  }
  async function prepareAssets(){
    $('retry-load').hidden=true;$('load-status').hidden=false;
    notifyChapter('loading');
    try{
      await lightSource.prepare();if(disposed)return;
      assetsReady=true;$('load-status').hidden=true;notice('');enableTransport();
      motion.reset(scrollFrame);awaitExact=true;setTarget(scrollFrame);primeHigh(true);wake();
      prepareHighDefinition();
    }catch(error){if(disposed)return;$('load-text').textContent='加载中断，请重试';$('retry-load').hidden=false;notice('素材准备未完成，已下载的部分会保留。');notifyChapter('failed');console.warn('Animation preload:',error.message);}
  }
  async function poster(){
    const generation=++posterGeneration;
    try{const image=await loadImage(variants.web1920,0);if(generation===posterGeneration&&!disposed&&shown<0&&profileKey!=='original'){
      const f=variants.web1920.frames[0];ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,f.x,f.y);composition(0);
    }image.close?.();}catch{ /* The packed source can still recover the first frame. */ }
  }
  function wake(){if(!disposed&&!document.hidden&&!raf)raf=requestAnimationFrame(tick);}
  function selectedProfile(){
    const setting=$('quality').value;
    if(setting!=='auto')return setting;
    return profileKey==='adaptive4k'?'adaptive4k':'light';
  }
  function hideHigh(){
    detailCanvas.style.visibility='hidden';canvas.style.visibility='visible';
    highShown=false;highIndex=-1;
  }
  function clearHigh(){
    clearTimeout(highTimer);highTimer=0;highCache?.destroy();highCache=null;
    highGoal=-1;highTiming=null;hideHigh();
    detailCanvas.width=1;detailCanvas.height=1;
  }
  function loadImage(source,index){
    const image=new Image();image.decoding='async';image.src=source.base+source.frames[index].file+'?v='+packManifest.version;
    return image.decode().then(()=>{image.close=()=>{image.src='';};return image;},error=>{image.src='';throw error;});
  }
  function showHighIfReady(){
    if(profileKey!=='adaptive4k'||playing||!motion.settled||!highCache||target!==highGoal||shown!==highGoal||!highCache.has(highGoal))return;
    const now=performance.now();
    if(highTiming){highTiming.readyAt??=now;highTiming.finalPoseAt??=now;highTiming.motionEndAt??=now;}
    if(highShown&&highIndex===highGoal)return;
    const image=highCache.entries.get(highGoal).image;
    if(detailCanvas.width!==original.width||detailCanvas.height!==original.height){detailCanvas.width=original.width;detailCanvas.height=original.height;}
    const frame=original.frames[highGoal];
    detailCtx.clearRect(0,0,detailCanvas.width,detailCanvas.height);detailCtx.drawImage(image,frame.x,frame.y);
    detailCanvas.style.visibility='visible';canvas.style.visibility='hidden';
    highShown=true;highIndex=highGoal;dirty=false;
    if(highTiming){highTiming.shownAt=now;highTiming.delayAfterFinalMs=Math.max(0,now-highTiming.finalPoseAt);highTiming.delayAfterMotionMs=Math.max(0,now-highTiming.motionEndAt);}
    metrics(now,true);
  }
  function primeHigh(immediate=false){
    if(!assetsReady||profileKey!=='adaptive4k'||playing||!highCache)return;
    const goal=clamp(Math.round(scrollFrame),0,N-1);
    if(goal!==highGoal){
      highGoal=goal;highTiming={frame:goal+1,goalAt:performance.now(),readyAt:highCache.has(goal)?performance.now():null,finalPoseAt:null,motionEndAt:null,shownAt:null,delayAfterFinalMs:null,delayAfterMotionMs:null};
      if(highShown&&highIndex!==goal)hideHigh();
    }
    if(highCache.has(goal)){showHighIfReady();return;}
    clearTimeout(highTimer);
    const generation=profileGeneration;
    const prepare=()=>{highTimer=0;if(generation===profileGeneration&&!playing&&highCache)highCache.update(highGoal);};
    // Decode the destination during the animation tail, not after it has stopped.
    if(immediate)prepare();else highTimer=setTimeout(prepare,60);
  }
  function applyPace(preserve=false){
    const previousRange=Math.max(1,document.documentElement.scrollHeight-innerHeight),progress=preserve?window.scrollY/previousRange:0;
    const settings={balanced:[11000,11],calm:[16000,16],detail:[21000,21]},setting=settings[$('pace').value]||settings.calm;
    const travel=Math.max(setting[0],innerHeight*setting[1]);
    $('sequence').style.height=`${Math.round(innerHeight+travel)}px`;
    if(preserve){ignoreScrollY=progress*travel;window.scrollTo(0,ignoreScrollY);}
  }
  function selectProfile(){
    if($('quality').value!=='auto'){stagedQuality?.cache.destroy();stagedQuality=null;}
    const key=selectedProfile();if(key===profileKey){dirty=true;scheduleUpgrade();wake();return;}
    pause(true);clearHigh();cache?.destroy();profileGeneration++;profileKey=key;
    profile=key==='original'?original:key==='light'?window.PREVIEW_LIGHT:variants[key==='adaptive4k'?'web1920':key];
    if(key==='original'){motion.reset(target);scrollFrame=target;}
    canvas.width=profile.width;canvas.height=profile.height;
    shown=-1;visualFrame=-1;dirty=true;frameTimes=[];awaitExact=true;buffering=false;
    const generation=profileGeneration;
    cache=createCache(key,profile,()=>{if(generation===profileGeneration)wake();});
    configureQuality();
    if(assetsReady)cache.update(target);primeHigh(true);scheduleUpgrade();wake();
  }
  function cacheBudget(key){
    if(key==='original')return 68;
    return key==='light'||navigator.deviceMemory&&navigator.deviceMemory<=4?128:256;
  }
  function createCache(key,source,onReady,upgrading=false){
    return new SequenceCache({frames:source.frames,maxBytes:(upgrading?24:cacheBudget(key))*1048576,concurrency:upgrading||key==='original'?1:3,stride:key==='original'?0:1,overview:false,nearby:3,lookAhead:Math.round(30*frameScale),lookBehind:Math.round(8*frameScale),
      load:index=>key==='original'?loadImage(source,index):key==='light'?lightSource.load(index):packedSource.load(index),onReady
    });
  }
  function configureQuality(){
    const generation=profileGeneration;
    if(profileKey==='adaptive4k'){
      highCache=new SequenceCache({frames:original.frames,maxBytes:3*original.width*original.height*4,maxEntries:3,concurrency:1,stride:0,load:index=>loadImage(original,index),onReady:()=>{
        if(generation!==profileGeneration)return;
        if(highTiming&&highCache.has(highGoal))highTiming.readyAt??=performance.now();
        showHighIfReady();wake();
      }});
    }
    document.querySelector('.badge').textContent=`${profileKey==='adaptive4k'?'4K ADAPTIVE':profile.width+' WEB'} · ${FPS} FPS · ${N} FRAMES`;
    enableTransport();
    $('play').title=profileKey==='original'?'4K用于逐帧检查；连续滚动请使用网页模式':'';
  }
  function scheduleUpgrade(){
    if(disposed||!assetsReady||!packedSource.ready||highFailed||profileKey!=='light'||$('quality').value!=='auto')return;
    stageQuality('adaptive4k',variants.web1920);
  }
  function stageQuality(key,source){
    if(stagedQuality?.key===key)return;
    stagedQuality?.cache.destroy();
    stagedQuality={key,source,cache:createCache(key,source,wake,true)};
    wake();
  }
  function switchQualityIfReady(){
    if(!stagedQuality||shown<0)return;
    const {key,source,cache:next}=stagedQuality;
    const frame=shown;
    if(!next.has(frame)){
      next.update(frame);
      if(next.failures.get(frame)?.attempts>=next.maxRetries){
        if(key==='light')reportFrameState('failed');
        else {highFailed=true;next.destroy();stagedQuality=null;}
      }
      return;
    }
    const previous=cache;
    clearHigh();
    cache=next;stagedQuality=null;
    cache.maxBytes=cacheBudget(key)*1048576;
    cache.concurrency=3;
    profileKey=key;profile=source;profileGeneration++;
    canvas.width=profile.width;canvas.height=profile.height;
    FramePresenter.paint(ctx,profile.frames,cache.sample(frame,frame),canvas.width,canvas.height);
    reportFrameState('ready');
    previous.destroy();
    configureQuality();cache.update(target);primeHigh(true);
  }
  function setTarget(index){const next=clamp(Math.round(index),0,N-1),step=clamp(Math.abs(next-target),1,8);target=next;if(assetsReady)cache.update(target,step);}
  function composition(index){
    const f=1+index/frameScale,intro=1-clamp((f-12)/53,0,1);
    $('box-title').style.opacity=String(1-clamp(f/70,0,1));
    $('wall').style.opacity=String(intro*.9);
    $('wall').style.transform=`rotate(${-7+5*(1-intro)}deg) scale(${1.12+.08*(1-intro)})`;
    $('hint').style.opacity=String(1-clamp((f-4)/25,0,1));
    for(const[id,start,end]of[['front',70,184],['back',235,326],['reveal',385,480]]){
      const opacity=Math.min(clamp((f-start)/18,0,1),clamp((end-f)/18,0,1));
      $(id).style.opacity=String(opacity);$(id).style.transform=`translateY(${(1-opacity)*14}px)`;
    }
  }
  function draw(now,position=target){
    $('seek').value=target+1;
    const sample=awaitExact?(cache.has(target)?cache.sample(target,target):null):cache.sample(Math.round(position),visualFrame);
    if(!sample)return;
    if(highShown&&sample.position!==highIndex)hideHigh();
    if(Math.abs(visualFrame-sample.position)>.0001||dirty){
      const first=shown<0;
      FramePresenter.paint(ctx,profile.frames,sample,canvas.width,canvas.height);
      paintCount++;frameTimes.push(now);
      visualFrame=sample.position;blendWeight=sample.mix;
      shown=Math.round(visualFrame);dirty=false;composition(visualFrame);
      reportFrameState('ready');
      if(shown===target)awaitExact=false;
      $('frame').textContent=`${String(shown+1).padStart(String(N).length,'0')} / ${N}`;
      if(first)metrics(now,true);
    }
    if(profileKey==='adaptive4k'&&shown===highGoal&&target===highGoal&&highTiming){
      highTiming.finalPoseAt??=performance.now();
      if(motion.settled)highTiming.motionEndAt??=performance.now();
    }
    showHighIfReady();
  }
  function syncScroll(){
    scrollFrame=target;motion.reset(target);
    const y=ScrollRhythm.progressAt(target)*Math.max(1,document.documentElement.scrollHeight-innerHeight);
    ignoreScrollY=y;window.scrollTo(0,y);
  }
  function pause(sync=false){
    const wasPlaying=playing;playing=false;$('play').textContent='▶ 自动播放';$('mode').textContent='滚动模式';
    if(wasPlaying)motion.reset(target);
    if(sync&&wasPlaying)syncScroll();
  }
  function seek(index){pause();hideHigh();awaitExact=true;setTarget(index);syncScroll();primeHigh(true);wake();}
  function metrics(now,force=false){
    if(!force&&now-lastMetrics<250)return;lastMetrics=now;
    if(!assetsReady){const s=packedSource.stats();$('metrics').textContent=`素材准备 ${(s.loadedBytes/1e6).toFixed(1)} / ${(s.totalBytes/1e6).toFixed(1)} MB · 已解码 ${cache?.entries.size||0} 帧`;return;}
    frameTimes=frameTimes.filter(t=>now-t<1500);
    actualFPS=frameTimes.length>1?(frameTimes.length-1)*1000/(frameTimes.at(-1)-frameTimes[0]):0;
    const s=cache.stats();
    const status=buffering?'正在准备附近画面':playing?`自动播放 · 画面更新 ${actualFPS.toFixed(1)} fps`:(highShown?'4K 已就绪':!motion.settled?'动画追赶中':shown===target?'目标帧已就绪':'目标帧准备中');
    $('metrics').textContent=`显示 ${shown+1} / 目标 ${target+1} · ${status} · 网页缓存 ${(s.bytes/1048576).toFixed(0)}/${(cache.maxBytes/1048576).toFixed(0)} MiB · 已准备 ${s.cache} 帧 · 平均读取/解码 ${s.decodeMs.toFixed(1)} ms${profileKey==='adaptive4k'?` · 4K预备 ${highCache?.entries.size||0}/3帧`:` · 素材 ${(profile.total_bytes/1e6).toFixed(1)} MB`}`;
    if(cache.errors.has(target)){
      notice(`第 ${target+1} 帧暂未就绪，请重试。`);$('retry-load').hidden=false;$('load-status').hidden=false;$('load-text').textContent='画面准备中断';
      if(cache.failures.get(target)?.attempts>=cache.maxRetries){
        if(profileKey==='adaptive4k'&&$('quality').value==='auto'){
          highFailed=true;stageQuality('light',window.PREVIEW_LIGHT);
        }else reportFrameState('failed');
      }
    }
    else if(shown<0)notice('正在准备首帧…');
    else if(profileKey==='original')notice('4K逐帧检查；连续滚动请切换「网页自动」或「4K自适应」。');
    else {notice('');if(shown===target){$('load-status').hidden=true;$('retry-load').hidden=true;}}
  }
  function tick(now){
    raf=0;if(disposed||document.hidden)return;
    if(!assetsReady){lastTime=0;metrics(now,true);return;}
    const dt=lastTime?clamp(now-lastTime,0,50):1000/60;lastTime=now;
    let position=target;
    if(playing){
      let frame=playPosition+dt/1000*FPS;
      if(frame>=N){if($('loop').checked){frame%=N;awaitExact=true;}else{frame=N-1;setTarget(frame);pause(true);}}
      setTarget(frame);
      buffering=!cache.has(target);if(!buffering)playPosition=frame;
      position=playing?(buffering?visualFrame:frame):target;
    }else if(profileKey!=='original'){
      motion.target=scrollFrame;
      const before=motion.position,velocity=motion.velocity;
      if(reduced)motion.reset(scrollFrame);else motion.step(dt/1000);
      setTarget(motion.position);
      buffering=!cache.has(target);
      if(buffering&&!reduced){motion.position=before;motion.velocity=velocity;}
      position=buffering?visualFrame:motion.settled?target:motion.position;
    }
    buffering=!cache.has(target);
    if(buffering)missingMs+=dt;
    if(!playing&&motion.settled&&highTiming&&target===highGoal)highTiming.motionEndAt??=performance.now();
    draw(now,position);switchQualityIfReady();metrics(now);
    if(playing||!motion.settled)wake();else{lastTime=0;metrics(now,true);if(highGoal!==Math.round(scrollFrame))primeHigh(true);}
  }
  $('play').onclick=()=>{
    if(!assetsReady)return;
    if(playing){pause(true);primeHigh(true);wake();return;}
    if(target===N-1)setTarget(0);
    clearTimeout(highTimer);highTimer=0;hideHigh();playing=true;playPosition=target;lastTime=0;missingMs=0;frameTimes=[];
    $('play').textContent='Ⅱ 暂停播放';$('mode').textContent=`${FPS} fps 播放`;wake();
  };
  $('seek').oninput=e=>seek(Number(e.target.value)-1);
  $('prev').onclick=()=>seek(target-1);$('next').onclick=()=>seek(target+1);$('restart').onclick=()=>seek(0);
  document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>seek(Number(b.dataset.frame)-1));
  $('quality').onchange=selectProfile;
  $('pace').onchange=()=>{applyPace(true);onScroll();};
  $('background').onchange=e=>{document.body.classList.remove('checker','dark');if(e.target.value!=='white')document.body.classList.add(e.target.value);};
  $('copy').onchange=e=>document.body.classList.toggle('no-copy',!e.target.checked);
  $('collapse').onclick=()=>{const folded=document.querySelector('.controls').classList.toggle('collapsed');$('collapse').textContent=folded?'展开':'收起';};
  document.querySelector('.brand').onclick=e=>{e.preventDefault();seek(0);};
  document.addEventListener('keydown',event=>{
    if(/INPUT|SELECT|BUTTON/.test(event.target.tagName))return;
    if(event.code==='Space'){event.preventDefault();if(!$('play').disabled)$('play').click();}
    if(event.code==='ArrowLeft'){event.preventDefault();seek(target-1);}
    if(event.code==='ArrowRight'){event.preventDefault();seek(target+1);}
  });
  function onScroll(){
    if(ignoreScrollY!==null&&Math.abs(window.scrollY-ignoreScrollY)<2){ignoreScrollY=null;return;}
    ignoreScrollY=null;pause();
    scrollFrame=ScrollRhythm.frameAt(window.scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));
    if(!assetsReady){metrics(performance.now(),true);return;}
    awaitExact=false;
    motion.target=scrollFrame;
    if(!motion.settled)hideHigh();
    primeHigh(motion.settled);
    if(profileKey==='original'){motion.reset(scrollFrame);setTarget(scrollFrame);}
    wake();
  }
  window.addEventListener('wheel',()=>{if(playing)pause(true);},{passive:true});
  window.addEventListener('touchstart',()=>{if(playing)pause(true);},{passive:true});
  window.addEventListener('scroll',onScroll,{passive:true});
  let resizeTimer;
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{applyPace(true);selectProfile();onScroll();},180);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(playing)pause(true);}else{lastTime=0;wake();}});
  $('retry-load').onclick=()=>{if(assetsReady){cache.retry();$('load-status').hidden=true;wake();}else prepareAssets();};
  window.addEventListener('pagehide',event=>{if(!event.persisted){disposed=true;clearHigh();stagedQuality?.cache.destroy();cache.destroy();packedSource.destroy();lightSource.destroy();}});
  applyPace();selectProfile();onScroll();composition(0);if(parent===window)poster();prepareAssets();
  window.preview={seek:frame=>seek(frame-1),getStats:()=>({assetsReady,buffering,transport:packedSource.stats(),lightTransport:lightSource.stats(),highDefinitionReady:packedSource.ready,fps:FPS,frameCount:N,durationSeconds:N/FPS,target:target+1,shown:shown+1,visualFrame:visualFrame+1,blendWeight,paintCount,playing,profile:profileKey,actualFPS,missingMs,motionFrame:motion.position+1,destination:scrollFrame+1,settled:motion.settled,highShown,displayResolution:highShown?[detailCanvas.width,detailCanvas.height]:[canvas.width,canvas.height],highCacheFrames:highCache?.entries.size||0,highPending:highCache?.pending.size||0,highTiming,scrollRange:document.documentElement.scrollHeight-innerHeight,...cache.stats()})};
})();
