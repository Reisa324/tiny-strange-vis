'use strict';
// Download compressed bytes separately from the bounded decoded-image cache.
window.PackedFrameSource=class PackedFrameSource {
  constructor({manifest,fetcher=(...args)=>fetch(...args),cacheStorage=globalThis.caches,decode=blob=>createImageBitmap(blob),concurrency=4,maxRetries=3,retryDelay=350,onProgress=()=>{}}){
    Object.assign(this,{manifest,fetcher,cacheStorage,decode,concurrency,maxRetries,retryDelay,onProgress});
    this.queue=[];this.jobs=new Map();this.prepared=new Set();this.activeBlobs=new Map();this.fallback=new Map();this.controllers=new Set();
    this.active=0;this.loadedBytes=0;this.cacheHits=0;this.downloads=0;this.closed=false;this.ready=false;this.promise=null;this.cacheBroken=false;
    this.cachePromise=Promise.resolve().then(()=>this.cacheStorage?.open('tiny-strange-'+manifest.version)).catch(()=>null);
  }
  url(index){return this.manifest.base+this.manifest.packs[index].file;}
  async prepare(){
    if(!this.promise)this.promise=Promise.all(this.manifest.packs.map((_,i)=>this.ensure(i))).then(()=>{if(!this.closed){this.ready=true;this.onProgress(this.stats());}}).catch(error=>{this.promise=null;throw error;});
    return this.promise;
  }
  ensure(index){
    if(this.closed)return Promise.reject(new Error('Source disposed'));
    if(this.prepared.has(index))return Promise.resolve();
    if(this.jobs.has(index))return this.jobs.get(index);
    const promise=new Promise((resolve,reject)=>this.queue.push({index,resolve,reject}));
    this.jobs.set(index,promise);this.pump();return promise;
  }
  pump(){
    while(!this.closed&&this.active<this.concurrency&&this.queue.length){
      const job=this.queue.shift();this.active++;
      this.store(job.index).then(job.resolve,job.reject).finally(()=>{this.active--;this.jobs.delete(job.index);this.pump();});
    }
  }
  async store(index){
    const cache=this.cacheBroken?null:await this.cachePromise,url=this.url(index),part=this.manifest.packs[index];
    if(cache){try{const saved=await cache.match(url);if(saved&&Number(saved.headers.get('content-length'))===part.bytes){this.cacheHits++;this.mark(index);return;}}catch{this.cacheBroken=true;}}
    let lastError;
    for(let attempt=0;attempt<this.maxRetries&&!this.closed;attempt++){
      const controller=new AbortController();this.controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),120000);
      try{
        const response=await this.fetcher(url,{cache:attempt?'reload':'force-cache',signal:controller.signal});
        if(!response.ok)throw new Error('资源下载失败 HTTP '+response.status);
        const blob=await response.blob();
        if(blob.size!==part.bytes)throw new Error('Pack length mismatch: '+blob.size+' / '+part.bytes);
        if(part.sha256&&globalThis.crypto?.subtle){
          const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
          const hex=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
          if(hex!==part.sha256)throw new Error('资源完整性校验失败');
        }
        if(this.closed)throw new Error('Source disposed');
        let stored=false;
        if(cache&&!this.cacheBroken){try{await cache.put(url,new Response(blob,{headers:{'content-type':'application/octet-stream','content-length':String(blob.size)}}));stored=true;}catch{this.cacheBroken=true;}}
        // Private browsing / storage quota fallback retains compressed bytes only.
        if(!stored)this.fallback.set(index,blob);
        this.downloads++;this.mark(index);return;
      }catch(error){lastError=error;if(attempt+1<this.maxRetries&&!this.closed)await new Promise(r=>setTimeout(r,this.retryDelay*2**attempt));}
      finally{clearTimeout(timer);this.controllers.delete(controller);}
    }
    throw lastError||new Error('Source disposed');
  }
  mark(index){if(this.prepared.has(index))return;this.prepared.add(index);this.loadedBytes+=this.manifest.packs[index].bytes;this.onProgress(this.stats());}
  async blob(index){
    if(this.activeBlobs.has(index)){const blob=this.activeBlobs.get(index);this.activeBlobs.delete(index);this.activeBlobs.set(index,blob);return blob;}
    await this.ensure(index);
    let blob=this.fallback.get(index);
    if(!blob&&!this.cacheBroken){try{const cache=await this.cachePromise;const saved=await cache?.match(this.url(index));if(saved)blob=await saved.blob();}catch{this.cacheBroken=true;}}
    if(!blob){this.prepared.delete(index);this.loadedBytes-=this.manifest.packs[index].bytes;await this.ensure(index);return this.blob(index);}
    this.activeBlobs.set(index,blob);while(this.activeBlobs.size>3)this.activeBlobs.delete(this.activeBlobs.keys().next().value);
    return blob;
  }
  async load(index){const [part,offset,length]=this.manifest.frames[index];const blob=await this.blob(part);if(this.closed)throw new Error('Source disposed');return this.decode(blob.slice(offset,offset+length,'image/webp'));}
  stats(){return{ready:this.ready,loadedBytes:this.loadedBytes,totalBytes:this.manifest.total_bytes,loadedPacks:this.prepared.size,totalPacks:this.manifest.packs.length,downloads:this.downloads,cacheHits:this.cacheHits,activeDownloads:this.active,activeCompressedBytes:[...this.activeBlobs.values()].reduce((n,b)=>n+b.size,0),fallbackCompressedBytes:[...this.fallback.values()].reduce((n,b)=>n+b.size,0)};}
  destroy(){this.closed=true;for(const c of this.controllers)c.abort();for(const job of this.queue)job.reject(new Error('Source disposed'));this.queue=[];this.activeBlobs.clear();this.fallback.clear();}
};
