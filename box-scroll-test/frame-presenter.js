'use strict';
window.FramePresenter={
  paint(ctx,frames,sample,width,height){
    const entry=sample.mix<.5?sample.a:sample.b,frame=frames[entry.index];
    const alpha=ctx.globalAlpha,operation=ctx.globalCompositeOperation;
    ctx.clearRect(0,0,width,height);
    ctx.globalCompositeOperation='source-over';
    // Crop bounds describe occupied pixels, not a rigid object transform. Preserve rendered geometry.
    ctx.globalAlpha=1;
    ctx.drawImage(entry.image,frame.x,frame.y);
    ctx.globalAlpha=alpha;ctx.globalCompositeOperation=operation;
  }
};
