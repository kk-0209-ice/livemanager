(() => {
  "use strict";

  const OPENCV_URL = "https://docs.opencv.org/4.x/opencv.js";
  const CHEKI_RATIO = 54 / 86;
  let cvPromise = null;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const dist = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

  function orderCorners(points){
    const p = points.map(x=>({x:Number(x.x),y:Number(x.y)}));
    if(p.length!==4) return p;
    const sum=p.map(q=>q.x+q.y), diff=p.map(q=>q.y-q.x);
    const tl=p[sum.indexOf(Math.min(...sum))];
    const br=p[sum.indexOf(Math.max(...sum))];
    const tr=p[diff.indexOf(Math.min(...diff))];
    const bl=p[diff.indexOf(Math.max(...diff))];
    const out=[tl,tr,br,bl];
    // 重複した場合は角度順でフォールバック
    if(new Set(out.map(q=>`${q.x.toFixed(2)},${q.y.toFixed(2)}`)).size<4){
      const cx=p.reduce((s,q)=>s+q.x,0)/4, cy=p.reduce((s,q)=>s+q.y,0)/4;
      const s=[...p].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
      let idx=s.reduce((best,q,i)=>q.x+q.y<s[best].x+s[best].y?i:best,0);
      return [s[idx],s[(idx+1)%4],s[(idx+2)%4],s[(idx+3)%4]];
    }
    return out;
  }

  function defaultCorners(c){
    const mx=c.width*.07,my=c.height*.07;
    return [{x:mx,y:my},{x:c.width-mx,y:my},{x:c.width-mx,y:c.height-my},{x:mx,y:c.height-my}];
  }

  async function loadOpenCV(timeout=16000){
    if(window.cv && window.cv.Mat) return window.cv;
    if(cvPromise) return cvPromise;
    cvPromise = new Promise((resolve,reject)=>{
      const finish = async ()=>{
        try{
          let cvObj=window.cv;
          if(cvObj && typeof cvObj.then==="function") cvObj=await cvObj;
          if(!cvObj?.Mat) throw new Error("OpenCV runtime not ready");
          window.cv=cvObj;
          resolve(cvObj);
        }catch(e){ reject(e); }
      };
      const existing=document.querySelector('script[data-cheki-opencv]');
      if(existing){
        if(window.cv) finish();
        else existing.addEventListener("load",finish,{once:true});
        existing.addEventListener("error",()=>reject(new Error("OpenCV load failed")),{once:true});
        return;
      }
      const s=document.createElement("script");
      s.src=OPENCV_URL;
      s.async=true;
      s.dataset.chekiOpencv="1";
      s.onload=finish;
      s.onerror=()=>reject(new Error("OpenCV load failed"));
      document.head.appendChild(s);
    });
    const timer=new Promise((_,rej)=>setTimeout(()=>rej(new Error("OpenCV timeout")),timeout));
    try{return await Promise.race([cvPromise,timer])}
    catch(e){cvPromise=null;throw e}
  }

  function quadScore(pts,w,h,area){
    const p=orderCorners(pts);
    const top=dist(p[0],p[1]), bottom=dist(p[3],p[2]), left=dist(p[0],p[3]), right=dist(p[1],p[2]);
    const qw=(top+bottom)/2, qh=(left+right)/2;
    if(qw<10||qh<10)return -1;
    const major=Math.max(qw,qh),minor=Math.min(qw,qh);
    const ratio=major/minor;
    const target=86/54;
    const ratioScore=Math.exp(-Math.abs(Math.log(ratio/target))*2.0);
    const areaRatio=area/(w*h);
    const areaScore=Math.min(1,areaRatio/.45) * (areaRatio>.08?1:.4);
    const edgeBalance=Math.min(top,bottom)/Math.max(top,bottom) * Math.min(left,right)/Math.max(left,right);
    const borderMargin=Math.min(...p.map(q=>Math.min(q.x,q.y,w-q.x,h-q.y)));
    const borderScore=borderMargin<2?.78:1;
    return ratioScore*.48+areaScore*.30+edgeBalance*.17+borderScore*.05;
  }

  async function detectCornersOpenCV(canvas){
    const cv=await loadOpenCV();
    let src=null,small=null,gray=null,blur=null,edges=null,closed=null,kernel=null,contours=null,hierarchy=null;
    try{
      src=cv.imread(canvas);
      const max=1000,scale=Math.min(1,max/Math.max(src.cols,src.rows));
      small=new cv.Mat();
      cv.resize(src,small,new cv.Size(Math.max(1,Math.round(src.cols*scale)),Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
      gray=new cv.Mat(); blur=new cv.Mat();
      cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);

      const passes=[[35,110],[55,165],[80,220]];
      let best=null;
      for(const [lo,hi] of passes){
        edges?.delete();closed?.delete();kernel?.delete();contours?.delete();hierarchy?.delete();
        edges=new cv.Mat();closed=new cv.Mat();
        cv.Canny(blur,edges,lo,hi,3,false);
        kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));
        cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
        contours=new cv.MatVector(); hierarchy=new cv.Mat();
        cv.findContours(closed,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);

        for(let i=0;i<contours.size();i++){
          const cnt=contours.get(i);
          let approx=null;
          try{
            const area=Math.abs(cv.contourArea(cnt,false));
            const areaRatio=area/(small.cols*small.rows);
            if(areaRatio<.07||areaRatio>.97) continue;
            const peri=cv.arcLength(cnt,true);
            approx=new cv.Mat();
            cv.approxPolyDP(cnt,approx,.025*peri,true);
            if(approx.rows!==4 || !cv.isContourConvex(approx)) continue;
            const pts=[];
            for(let r=0;r<4;r++) pts.push({x:approx.intPtr(r,0)[0],y:approx.intPtr(r,0)[1]});
            const score=quadScore(pts,small.cols,small.rows,area);
            if(!best||score>best.score)best={pts:orderCorners(pts),score,areaRatio};
          }finally{approx?.delete();cnt.delete();}
        }
      }
      if(!best||best.score<.38)throw new Error("no confident contour");
      const inv=1/scale;
      return {
        corners:best.pts.map(q=>({x:q.x*inv,y:q.y*inv})),
        confidence:clamp(best.score,0,1),
        engine:"OpenCV 高精度検出"
      };
    }finally{
      [src,small,gray,blur,edges,closed,kernel,hierarchy].forEach(x=>x?.delete?.());
      contours?.delete?.();
    }
  }

  function detectCornersFallback(canvas){
    const max=420,sc=Math.min(1,max/Math.max(canvas.width,canvas.height));
    const w=Math.max(1,Math.round(canvas.width*sc)),h=Math.max(1,Math.round(canvas.height*sc));
    const t=document.createElement("canvas");t.width=w;t.height=h;
    const ctx=t.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
    const data=ctx.getImageData(0,0,w,h).data;
    const lum=new Float32Array(w*h);
    let sum=0;
    for(let i=0,p=0;i<data.length;i+=4,p++){
      const v=.299*data[i]+.587*data[i+1]+.114*data[i+2];lum[p]=v;sum+=v;
    }
    const mean=sum/lum.length;
    const mask=new Uint8Array(w*h);
    let count=0;
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const i=y*w+x;
      const gx=Math.abs(lum[i+1]-lum[i-1]),gy=Math.abs(lum[i+w]-lum[i-w]);
      const edge=gx+gy;
      const white=lum[i]>Math.max(178,mean+18);
      if(edge>52||white){mask[i]=1;count++;}
    }
    if(count<120)return {corners:defaultCorners(canvas),confidence:.12,engine:"内蔵基本検出"};
    // 外側から各対角方向に強い画素を拾う
    const pts=[];
    const candidates=[];
    for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2)if(mask[y*w+x])candidates.push({x,y});
    if(candidates.length<20)return {corners:defaultCorners(canvas),confidence:.12,engine:"内蔵基本検出"};
    const tl=candidates.reduce((a,b)=>a.x+a.y<b.x+b.y?a:b);
    const br=candidates.reduce((a,b)=>a.x+a.y>b.x+b.y?a:b);
    const tr=candidates.reduce((a,b)=>a.y-a.x<b.y-b.x?a:b);
    const bl=candidates.reduce((a,b)=>a.y-a.x>b.y-b.x?a:b);
    const inv=1/sc;
    const out=orderCorners([tl,tr,br,bl].map(q=>({x:q.x*inv,y:q.y*inv})));
    const area=Math.abs(out.reduce((s,q,i)=>s+q.x*out[(i+1)%4].y-q.y*out[(i+1)%4].x,0))/2;
    const areaRatio=area/(canvas.width*canvas.height);
    if(areaRatio<.08||areaRatio>.97)return {corners:defaultCorners(canvas),confidence:.15,engine:"内蔵基本検出"};
    return {corners:out,confidence:.38,engine:"内蔵基本検出"};
  }

  async function detectCorners(canvas){
    try{return await detectCornersOpenCV(canvas)}
    catch(e){
      console.warn("[ChekiScanner] OpenCV detection fallback:",e);
      return detectCornersFallback(canvas);
    }
  }

  async function detectRegions(canvas){
    try{
      const cv=await loadOpenCV();
      let src=null,small=null,gray=null,blur=null,edges=null,kernel=null,closed=null,contours=null,hierarchy=null;
      try{
        src=cv.imread(canvas);
        const max=1200,scale=Math.min(1,max/Math.max(src.cols,src.rows));
        small=new cv.Mat();
        cv.resize(src,small,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)),0,0,cv.INTER_AREA);
        gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();closed=new cv.Mat();
        cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);
        cv.Canny(blur,edges,45,155,3,false);
        kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));
        cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
        contours=new cv.MatVector();hierarchy=new cv.Mat();
        cv.findContours(closed,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
        const candidates=[];
        for(let i=0;i<contours.size();i++){
          const cnt=contours.get(i);let approx=null;
          try{
            const area=Math.abs(cv.contourArea(cnt,false)),ar=area/(small.cols*small.rows);
            if(ar<.012||ar>.62)continue;
            const peri=cv.arcLength(cnt,true);approx=new cv.Mat();
            cv.approxPolyDP(cnt,approx,.025*peri,true);
            if(approx.rows!==4||!cv.isContourConvex(approx))continue;
            const pts=[];for(let r=0;r<4;r++)pts.push({x:approx.intPtr(r,0)[0],y:approx.intPtr(r,0)[1]});
            const ordered=orderCorners(pts),score=quadScore(ordered,small.cols,small.rows,area);
            if(score<.38)continue;
            const inv=1/scale,corners=ordered.map(q=>({x:q.x*inv,y:q.y*inv}));
            const xs=corners.map(q=>q.x),ys=corners.map(q=>q.y);
            candidates.push({
              corners,
              x:Math.min(...xs),y:Math.min(...ys),
              w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),
              confidence:score
            });
          }finally{approx?.delete();cnt.delete();}
        }
        // ほぼ同じ候補をNMSで除外
        candidates.sort((a,b)=>b.confidence-a.confidence);
        const kept=[];
        const iou=(a,b)=>{
          const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
          const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
          return inter/(a.w*a.h+b.w*b.h-inter||1);
        };
        for(const c of candidates){if(kept.every(k=>iou(c,k)<.45))kept.push(c);if(kept.length>=30)break;}
        kept.sort((a,b)=>a.y-b.y||a.x-b.x);
        if(kept.length)return kept;
      }finally{
        [src,small,gray,blur,edges,kernel,closed,hierarchy].forEach(x=>x?.delete?.());contours?.delete?.();
      }
    }catch(e){console.warn("[ChekiScanner] batch fallback:",e)}
    return [];
  }

  function computeOutputSize(corners,ratioMode="cheki",maxLongEdge=1800){
    const p=orderCorners(corners);
    let w=(dist(p[0],p[1])+dist(p[3],p[2]))/2;
    let h=(dist(p[0],p[3])+dist(p[1],p[2]))/2;
    if(ratioMode==="cheki"){
      if(h>=w) w=h*CHEKI_RATIO;
      else h=w*CHEKI_RATIO;
    }
    const scale=Math.min(1,maxLongEdge/Math.max(w,h));
    return {w:Math.max(240,Math.round(w*scale)),h:Math.max(240,Math.round(h*scale))};
  }

  function rotateCanvas(canvas,deg){
    deg=((deg%360)+360)%360;if(!deg)return canvas;
    const out=document.createElement("canvas");
    const swap=deg===90||deg===270;
    out.width=swap?canvas.height:canvas.width;out.height=swap?canvas.width:canvas.height;
    const ctx=out.getContext("2d");ctx.translate(out.width/2,out.height/2);ctx.rotate(deg*Math.PI/180);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);
    return out;
  }

  function applyTone(canvas,mode="natural"){
    if(mode==="original")return canvas;
    const ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.getImageData(0,0,canvas.width,canvas.height),d=img.data;
    const hist=new Uint32Array(256);let n=0;
    for(let i=0;i<d.length;i+=16){
      const y=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);hist[y]++;n++;
    }
    const percentile=(p)=>{let s=0;for(let i=0;i<256;i++){s+=hist[i];if(s>=n*p)return i}return 255};
    let lo=percentile(.015),hi=percentile(.985);
    if(hi-lo<75){lo=Math.max(0,lo-18);hi=Math.min(255,hi+18)}
    const gamma=mode==="bright"?.86:.96;
    const gain=255/Math.max(50,hi-lo);
    for(let i=0;i<d.length;i+=4){
      for(let c=0;c<3;c++){
        let v=(d[i+c]-lo)*gain;
        v=clamp(v,0,255)/255;
        v=Math.pow(v,gamma)*255;
        if(mode==="natural")v=128+(v-128)*1.03;
        d[i+c]=clamp(Math.round(v),0,255);
      }
    }
    ctx.putImageData(img,0,0);
    return canvas;
  }

  async function cropOpenCV(canvas,corners,opts){
    const cv=await loadOpenCV(6000);
    const p=orderCorners(corners),size=computeOutputSize(p,opts.ratioMode,opts.maxLongEdge);
    let src=null,dst=null,srcPts=null,dstPts=null,M=null;
    const temp=document.createElement("canvas");
    try{
      src=cv.imread(canvas);dst=new cv.Mat();
      srcPts=cv.matFromArray(4,1,cv.CV_32FC2,[p[0].x,p[0].y,p[1].x,p[1].y,p[2].x,p[2].y,p[3].x,p[3].y]);
      dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,size.w-1,0,size.w-1,size.h-1,0,size.h-1]);
      M=cv.getPerspectiveTransform(srcPts,dstPts);
      cv.warpPerspective(src,dst,M,new cv.Size(size.w,size.h),cv.INTER_CUBIC,cv.BORDER_REPLICATE,new cv.Scalar());
      temp.width=size.w;temp.height=size.h;cv.imshow(temp,dst);
    }finally{[src,dst,srcPts,dstPts,M].forEach(x=>x?.delete?.())}
    return applyTone(rotateCanvas(temp,opts.rotation||0),opts.tone||"natural");
  }

  function solveLinear(A,b){
    const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
    for(let i=0;i<n;i++){
      let pivot=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[pivot][i]))pivot=r;
      [M[i],M[pivot]]=[M[pivot],M[i]];
      const d=M[i][i]||1e-12;for(let c=i;c<=n;c++)M[i][c]/=d;
      for(let r=0;r<n;r++){if(r===i)continue;const f=M[r][i];for(let c=i;c<=n;c++)M[r][c]-=f*M[i][c]}
    }
    return M.map(r=>r[n]);
  }

  function homographyDestToSrc(w,h,p){
    const dst=[[0,0],[w-1,0],[w-1,h-1],[0,h-1]],A=[],b=[];
    for(let i=0;i<4;i++){
      const [x,y]=dst[i],X=p[i].x,Y=p[i].y;
      A.push([x,y,1,0,0,0,-x*X,-y*X]);b.push(X);
      A.push([0,0,0,x,y,1,-x*Y,-y*Y]);b.push(Y);
    }
    const h8=solveLinear(A,b);return [...h8,1];
  }

  function cropFallback(canvas,corners,opts){
    const p=orderCorners(corners),size=computeOutputSize(p,opts.ratioMode,Math.min(opts.maxLongEdge||1200,1100));
    const out=document.createElement("canvas");out.width=size.w;out.height=size.h;
    const sctx=canvas.getContext("2d",{willReadFrequently:true}),src=sctx.getImageData(0,0,canvas.width,canvas.height);
    const dctx=out.getContext("2d"),img=dctx.createImageData(size.w,size.h),dp=img.data,sp=src.data,sw=canvas.width,sh=canvas.height;
    const H=homographyDestToSrc(size.w,size.h,p);
    for(let y=0;y<size.h;y++)for(let x=0;x<size.w;x++){
      const z=H[6]*x+H[7]*y+1;
      const sx=clamp((H[0]*x+H[1]*y+H[2])/z,0,sw-1),sy=clamp((H[3]*x+H[4]*y+H[5])/z,0,sh-1);
      const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=sx-x0,fy=sy-y0;
      const ids=[(y0*sw+x0)*4,(y0*sw+x1)*4,(y1*sw+x0)*4,(y1*sw+x1)*4],di=(y*size.w+x)*4;
      for(let c=0;c<3;c++){
        const a=sp[ids[0]+c]*(1-fx)+sp[ids[1]+c]*fx,b=sp[ids[2]+c]*(1-fx)+sp[ids[3]+c]*fx;
        dp[di+c]=Math.round(a*(1-fy)+b*fy);
      }dp[di+3]=255;
    }
    dctx.putImageData(img,0,0);
    return applyTone(rotateCanvas(out,opts.rotation||0),opts.tone||"natural");
  }

  async function crop(canvas,corners,opts={}){
    const o={ratioMode:"cheki",tone:"natural",rotation:0,maxLongEdge:1800,...opts};
    try{return await cropOpenCV(canvas,corners,o)}
    catch(e){console.warn("[ChekiScanner] warp fallback:",e);return cropFallback(canvas,corners,o)}
  }

  function quality(canvas,detectionConfidence=0){
    const max=260,sc=Math.min(1,max/Math.max(canvas.width,canvas.height)),w=Math.max(16,Math.round(canvas.width*sc)),h=Math.max(16,Math.round(canvas.height*sc));
    const t=document.createElement("canvas");t.width=w;t.height=h;const ctx=t.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
    const data=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);
    let mean=0,dark=0,bright=0;
    for(let i=0,p=0;i<data.length;i+=4,p++){const v=.299*data[i]+.587*data[i+1]+.114*data[i+2];g[p]=v;mean+=v;if(v<22)dark++;if(v>244)bright++}
    mean/=g.length;dark/=g.length;bright/=g.length;
    let lsum=0,l2=0,n=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x,v=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];lsum+=v;l2+=v*v;n++;
    }
    const blurVar=Math.max(0,l2/n-(lsum/n)**2);
    let score=100;const warnings=[];
    if(Math.min(canvas.width,canvas.height)<700){score-=18;warnings.push("解像度が低めです")}
    if(blurVar<150){score-=25;warnings.push("手ブレ・ピンぼけの可能性があります")}
    else if(blurVar<300){score-=10;warnings.push("少しぼけています")}
    if(mean<65){score-=18;warnings.push("画像が暗めです")}
    if(mean>215){score-=12;warnings.push("画像が明るすぎます")}
    if(dark>.20){score-=10;warnings.push("黒つぶれがあります")}
    if(bright>.20){score-=10;warnings.push("白飛びがあります")}
    if(detectionConfidence && detectionConfidence<.45){score-=12;warnings.push("四隅を手動確認してください")}
    score=clamp(Math.round(score),0,100);
    return {
      score,
      label:score>=85?"高品質":score>=65?"良好":score>=45?"要確認":"撮り直し推奨",
      warnings,
      blurVar:Math.round(blurVar),
      meanBrightness:Math.round(mean)
    };
  }

  window.ChekiScanner={loadOpenCV,detectCorners,detectRegions,crop,quality,defaultCorners,orderCorners,OPENCV_URL};
})();