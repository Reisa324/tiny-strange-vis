'use strict';
// Bounded decoded cache. Loads finish instead of being cancelled by every scroll update.
window.SequenceCache=class SequenceCache {
  constructor({frames,load,maxBytes=160*1048576,maxEntries=Infinity,concurrency=3,stride=15,nearby=5,lookAhead=24,lookBehind=8,onReady=()=>{}}){
    Object.assign(this,{frames,load,maxBytes,maxEntries,concurrency,stride,nearby,lookAhead,lookBehind,onReady});
    this.entries=new Map();this.pending=new Set();this.errors=new Map();
    this.bytes=0;this.peakBytes=0;this.peakPending=0;this.decoded=0;this.totalMs=0;
    this.target=-1;this.direction=1;this.order=[];this.closed=false;
  }
  update(index){
    index=Math.min(this.frames.length-1,Math.max(0,Math.round(index)));
    if(this.target===index)return;
    this.direction=Math.sign(index-this.target)||1;this.target=index;
    const candidates=[index];
    if(this.stride){
      for(let n=1;n<=this.nearby;n++)candidates.push(index+n*this.direction,index-n*this.direction);
      for(let n=this.nearby+1;n<=this.lookAhead;n++)candidates.push(index+n*this.direction);
      for(let n=this.nearby+1;n<=this.lookBehind;n++)candidates.push(index-n*this.direction);
      // Spend the bounded decode budget on upcoming motion before distant overview poses.
      for(let n=0;n<this.frames.length;n+=this.stride)candidates.push(n);
      candidates.push(this.frames.length-1);
    }
    const seen=new Set();this.order=[];let plannedBytes=0;
    for(const n of candidates){
      if(n<0||n>=this.frames.length||seen.has(n))continue;seen.add(n);
      const f=this.frames[n],cost=f.w*f.h*4;
      if(n!==index&&plannedBytes+cost>this.maxBytes*.83)continue;
      this.order.push(n);plannedBytes+=cost;
    }
    this.pump();
  }
  has(index){return this.entries.has(index);}
  sample(position,shown){
    position=Math.min(this.frames.length-1,Math.max(0,position));
    const lo=Math.floor(position),hi=Math.ceil(position);
    if(this.has(lo)&&this.has(hi)){
      return{a:{index:lo,image:this.entries.get(lo).image},b:{index:hi,image:this.entries.get(hi).image},mix:position-lo,position};
    }
    // Interpolate only adjacent real frames. A cache gap must not dissolve distant poses.
    const entry=this.forPlayhead(position,shown);
    return entry?{a:entry,b:entry,mix:0,position:entry.index}:null;
  }
  nearest(index){
    if(this.entries.has(index))return{index,image:this.entries.get(index).image};
    let best=-1,delta=Infinity;
    for(const n of this.entries.keys())if(Math.abs(n-index)<delta){best=n;delta=Math.abs(n-index);}
    return best<0?null:{index:best,image:this.entries.get(best).image};
  }
  forPlayhead(index,shown){
    if(this.entries.has(index))return{index,image:this.entries.get(index).image};
    if(shown<0)return null;
    const lo=Math.min(shown,index),hi=Math.max(shown,index);
    let best=-1,delta=Infinity;
    // A cache miss must never preview a pose beyond the current animation time.
    for(const n of this.entries.keys()){
      if(n<lo||n>hi)continue;
      const distance=Math.abs(n-index);
      if(distance<delta){best=n;delta=distance;}
    }
    return best<0?null:{index:best,image:this.entries.get(best).image};
  }
  makeRoom(bytes){
    const priority=new Map(this.order.map((n,i)=>[n,i]));
    while((this.bytes+bytes>this.maxBytes||this.entries.size>=this.maxEntries)&&this.entries.size){
      let victim=-1,score=-1;
      for(const n of this.entries.keys()){
        const rank=priority.has(n)?priority.get(n):1000+Math.abs(n-this.target);
        if(rank>score){score=rank;victim=n;}
      }
      const entry=this.entries.get(victim);entry.image.close?.();
      this.bytes-=entry.bytes;this.entries.delete(victim);
    }
  }
  pump(){
    if(this.closed)return;
    for(const index of this.order){
      if(this.pending.size>=this.concurrency)break;
      if(this.entries.has(index)||this.pending.has(index)||this.errors.has(index))continue;
      this.pending.add(index);this.peakPending=Math.max(this.peakPending,this.pending.size);
      this.perform(index);
    }
  }
  async perform(index){
    const started=performance.now();
    try{
      const image=await this.load(index);
      if(this.closed){image.close?.();return;}
      const f=this.frames[index],bytes=f.w*f.h*4;
      this.makeRoom(bytes);this.entries.set(index,{image,bytes});this.bytes+=bytes;
      this.peakBytes=Math.max(this.peakBytes,this.bytes);this.decoded++;this.totalMs+=performance.now()-started;
    }catch(error){if(!this.closed)this.errors.set(index,String(error));}
    finally{this.pending.delete(index);if(!this.closed){this.onReady();this.pump();}}
  }
  stats(){return{cache:this.entries.size,bytes:this.bytes,peakBytes:this.peakBytes,pending:this.pending.size,peakPending:this.peakPending,decoded:this.decoded,decodeMs:this.decoded?this.totalMs/this.decoded:0,errors:[...this.errors]};}
  destroy(){this.closed=true;for(const e of this.entries.values())e.image.close?.();this.entries.clear();this.bytes=0;}
};
