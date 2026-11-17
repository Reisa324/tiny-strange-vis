'use strict';
(() => {
  const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d',{alpha:true});
  const detailCanvas=$('detail-canvas'),detailCtx=detailCanvas.getContext('2d',{alpha:true});
  const manifest=window.PREVIEW_MANIFEST,variants=window.PREVIEW_VARIANTS;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),N=manifest.frame_count,FPS=manifest.fps;
  if(!variants){$('notice').textContent='网页素材清单未加载，请确认同级 frames_web_120fps_optimized 文件夹完整。';return;}
  const original=variants.web3840;
  if(!original||variants.web1920.frames.length!==N||original.frames.length!==N){$('notice').textContent='120 fps素材清单不完整，请检查1080p与4K两套文件。';return;}
  const frameScale=FPS/30;
  let cache,profile,profileKey,target=0,shown=-1,scrollFrame=0,visualFrame=-1,blendWeight=0;
  let paintCount=0;
  const motion=new ScrollRhythm.Playhead(0);
  let playing=false,disposed=false,raf=0,lastTime=0,dirty=true,lastMetrics=0;
  let playStart=0,playFrom=0,ignoreScrollY=null;
  let frameTimes=[],actualFPS=0,missingMs=0,profileGeneration=0;
  let highCache=null,highGoal=-1,highIndex=-1,highTimer=0,highShown=false,highTiming=null;
  let awaitExact=true;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('seek').max=N;
  function notice(text){if($('notice').textContent!==text)$('notice').textContent=text;}
  function wake(){if(!disposed&&!document.hidden&&!raf)raf=requestAnimationFrame(tick);}
  function selectedProfile(){
    const setting=$('quality').value;
    if(setting!=='auto')return setting;
    return 'web1920';
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
    const image=new Image();image.decoding='async';image.src=source.base+source.frames[index].file;
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
    if(profileKey!=='adaptive4k'||playing||!highCache)return;
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
    const key=selectedProfile();if(key===profileKey){dirty=true;wake();return;}
    pause(true);clearHigh();cache?.destroy();profileGeneration++;profileKey=key;
    profile=key==='original'?original:variants[key==='adaptive4k'?'web1920':key];
    if(key==='original'){motion.reset(target);scrollFrame=target;}
    canvas.width=profile.width;canvas.height=profile.height;
    shown=-1;visualFrame=-1;dirty=true;frameTimes=[];awaitExact=true;
    const generation=profileGeneration,source=profile;
    const webBudget=navigator.deviceMemory&&navigator.deviceMemory<=4?128:256;
    cache=new SequenceCache({frames:source.frames,maxBytes:(key==='original'?68:webBudget)*1048576,concurrency:key==='original'?1:3,stride:key==='original'?0:Math.round(15*frameScale),nearby:10,lookAhead:Math.round(24*frameScale),lookBehind:Math.round(8*frameScale),
      load:index=>loadImage(source,index),onReady:()=>{if(generation===profileGeneration)wake();}
    });
    if(key==='adaptive4k'){
      highCache=new SequenceCache({frames:original.frames,maxBytes:3*original.width*original.height*4,maxEntries:3,concurrency:1,stride:0,load:index=>loadImage(original,index),onReady:()=>{
        if(generation!==profileGeneration)return;
        if(highTiming&&highCache.has(highGoal))highTiming.readyAt??=performance.now();
        showHighIfReady();wake();
      }});
    }
    document.querySelector('.badge').textContent=`${key==='adaptive4k'?'4K ADAPTIVE':profile.width+' WEB'} · ${FPS} FPS · ${N} FRAMES`;
    $('play').disabled=key==='original';
    $('play').title=key==='original'?'4K用于逐帧检查；连续滚动请使用网页模式':'';
    cache.update(target);primeHigh(true);wake();
  }
  function setTarget(index){target=clamp(Math.round(index),0,N-1);cache.update(target);}
  function composition(index){
    const f=1+index/frameScale,intro=1-clamp((f-12)/53,0,1);
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
    frameTimes=frameTimes.filter(t=>now-t<1500);
    actualFPS=frameTimes.length>1?(frameTimes.length-1)*1000/(frameTimes.at(-1)-frameTimes[0]):0;
    const s=cache.stats();
    const status=playing?`自动播放 · 画面更新 ${actualFPS.toFixed(1)} fps`:(highShown?'4K 已就绪':!motion.settled?'动画追赶中':shown===target?'目标帧已就绪':'目标帧准备中');
    $('metrics').textContent=`显示 ${shown+1} / 目标 ${target+1} · ${status} · 网页缓存 ${(s.bytes/1048576).toFixed(0)}/${(cache.maxBytes/1048576).toFixed(0)} MiB · 已准备 ${s.cache} 帧 · 平均读取/解码 ${s.decodeMs.toFixed(1)} ms${profileKey==='adaptive4k'?` · 4K预备 ${highCache?.entries.size||0}/3帧`:` · 素材 ${(profile.total_bytes/1e6).toFixed(1)} MB`}`;
    if(cache.errors.has(target))notice(`第 ${target+1} 帧读取失败，刷新重试。`);
    else if(shown<0)notice('正在准备首帧…');
    else if(profileKey==='original')notice('4K逐帧检查；连续滚动请切换「网页自动」或「4K自适应」。');
    else notice('');
  }
  function tick(now){
    raf=0;if(disposed||document.hidden)return;
    const dt=lastTime?clamp(now-lastTime,0,50):1000/60;lastTime=now;
    let position=target;
    if(playing){
      let frame=playFrom+(now-playStart)/1000*FPS;
      if(frame>=N){if($('loop').checked){frame%=N;playFrom=frame;playStart=now;awaitExact=true;}else{frame=N-1;setTarget(frame);pause(true);}}
      setTarget(frame);
      position=playing?frame:target;
    }else if(profileKey!=='original'){
      motion.target=scrollFrame;
      if(reduced)motion.reset(scrollFrame);else motion.step(dt/1000);
      setTarget(motion.position);
      position=motion.settled?target:motion.position;
    }
    if(!cache.has(target))missingMs+=dt;
    if(!playing&&motion.settled&&highTiming&&target===highGoal)highTiming.motionEndAt??=performance.now();
    draw(now,position);metrics(now);
    if(playing||!motion.settled)wake();else{lastTime=0;metrics(now,true);if(highGoal!==Math.round(scrollFrame))primeHigh(true);}
  }
  $('play').onclick=()=>{
    if(playing){pause(true);primeHigh(true);wake();return;}
    if(target===N-1)setTarget(0);
    clearTimeout(highTimer);highTimer=0;hideHigh();playing=true;playFrom=target;playStart=performance.now();lastTime=0;missingMs=0;frameTimes=[];
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
  window.addEventListener('pagehide',event=>{if(!event.persisted){disposed=true;clearHigh();cache.destroy();}});
  applyPace();selectProfile();onScroll();composition(0);
  window.preview={seek:frame=>seek(frame-1),getStats:()=>({fps:FPS,frameCount:N,durationSeconds:N/FPS,target:target+1,shown:shown+1,visualFrame:visualFrame+1,blendWeight,paintCount,playing,profile:profileKey,actualFPS,missingMs,motionFrame:motion.position+1,destination:scrollFrame+1,settled:motion.settled,highShown,displayResolution:highShown?[detailCanvas.width,detailCanvas.height]:[canvas.width,canvas.height],highCacheFrames:highCache?.entries.size||0,highPending:highCache?.pending.size||0,highTiming,scrollRange:document.documentElement.scrollHeight-innerHeight,...cache.stats()})};
})();
