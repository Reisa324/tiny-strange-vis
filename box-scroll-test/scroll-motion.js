'use strict';
(() => {
  // Reading pauses belong to the webpage timeline; source frame numbering stays unchanged.
  const frameScale=(window.PREVIEW_MANIFEST?.fps||30)/30;
  const lastFrame=(window.PREVIEW_MANIFEST?.frame_count||450)-1;
  const anchors=[[0,0],[.12,69],[.28,154],[.33,154],[.48,244],[.59,294],[.65,294],[.82,393],[.94,449],[1,449]].map(([p,f])=>[p,f===449?lastFrame:f*frameScale]);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const widths=anchors.slice(1).map(([p],i)=>p-anchors[i][0]);
  const slopes=anchors.slice(1).map(([,f],i)=>(f-anchors[i][1])/widths[i]);
  // Monotone Hermite tangents keep speed continuous and reach each reading hold at rest.
  const tangents=anchors.map((_,i)=>{
    if(i===0)return slopes[0];
    if(i===anchors.length-1)return slopes.at(-1);
    const before=slopes[i-1],after=slopes[i];
    if(!before||!after)return 0;
    const w1=2*widths[i]+widths[i-1],w2=widths[i]+2*widths[i-1];
    return(w1+w2)/(w1/before+w2/after);
  });
  function frameAt(progress){
    progress=clamp(progress,0,1);
    for(let i=1;i<anchors.length;i++){
      const [p1,f1]=anchors[i],[p0,f0]=anchors[i-1];
      if(progress<=p1){
        if(f0===f1)return f0;
        const h=p1-p0,t=(progress-p0)/h,t2=t*t,t3=t2*t;
        return(2*t3-3*t2+1)*f0+(t3-2*t2+t)*h*tangents[i-1]+(-2*t3+3*t2)*f1+(t3-t2)*h*tangents[i];
      }
    }
    return lastFrame;
  }
  function progressAt(frame){
    frame=clamp(frame,0,lastFrame);if(frame===0)return 0;if(frame===lastFrame)return 1;
    for(let i=1;i<anchors.length;i++){
      const [p1,f1]=anchors[i],[p0,f0]=anchors[i-1];
      if(f0===f1&&Math.abs(frame-f0)<1e-8)return(p0+p1)/2;
    }
    let lo=0,hi=1;
    for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(frameAt(mid)<frame)lo=mid;else hi=mid;}
    return(lo+hi)/2;
  }
  class Playhead{
    constructor(position=0){this.reset(position);this.omega=18;}
    reset(position){this.position=position;this.target=position;this.velocity=0;}
    // Stop within sub-frame precision; an invisible exponential tail only delays the next pause.
    get settled(){return Math.abs(this.position-this.target)<.1*frameScale&&Math.abs(this.velocity)<3*frameScale;}
    step(seconds){
      const dt=clamp(seconds,0,.05),error=this.position-this.target,w=this.omega;
      if(!dt)return this.position;
      // Exact critically damped response to a constant target: accelerate, coast, settle.
      const c=this.velocity+w*error,decay=Math.exp(-w*dt);
      let next=this.target+(error+c*dt)*decay;
      let velocity=(this.velocity-w*c*dt)*decay;
      const maxDelta=Math.max(80*frameScale,Math.abs(error)/.65)*dt;
      if(Math.abs(next-this.position)>maxDelta){next=this.position+Math.sign(next-this.position)*maxDelta;velocity=(next-this.position)/dt;}
      if((next-this.target)*error<0){next=this.target;velocity=0;}
      this.position=next;this.velocity=velocity;
      if(this.settled)this.reset(this.target);
      return this.position;
    }
  }
  window.ScrollRhythm={anchors,frameAt,progressAt,Playhead,frameScale,lastFrame};
})();
