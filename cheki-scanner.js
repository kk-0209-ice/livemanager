(() => {
"use strict";

const OPENCV_URL="https://docs.opencv.org/4.x/opencv.js";
const FORMATS={
  mini:{key:"mini",label:"mini",w:54,h:86},
  square:{key:"square",label:"SQUARE",w:72,h:86},
  wide:{key:"wide",label:"WIDE",w:108,h:86}
};
let cvPromise=null;
let jscanifyPromise=null;
const JSCANIFY_URL="https://cdn.jsdelivr.net/gh/ColonelParrot/jscanify@1.4.0/src/jscanify.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const lerp=(a,b,t)=>a+(b-a)*t;

function formatInfo(key){return FORMATS[key]||FORMATS.mini}
function formatLongRatio(key){const f=formatInfo(key);return Math.max(f.w,f.h)/Math.min(f.w,f.h)}

function orderCorners(points){
  const p=(points||[]).map(x=>({x:+x.x,y:+x.y}));
  if(p.length!==4)return p;
  const cx=p.reduce((s,q)=>s+q.x,0)/4,cy=p.reduce((s,q)=>s+q.y,0)/4;
  const s=[...p].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  let idx=0,min=Infinity;
  s.forEach((q,i)=>{const v=q.x+q.y;if(v<min){min=v;idx=i}});
  let out=[s[idx],s[(idx+1)%4],s[(idx+2)%4],s[(idx+3)%4]];
  // Ensure TL,TR,BR,BL.
  if(out[1].x<out[3].x) out=[out[0],out[3],out[2],out[1]];
  return out;
}

function defaultCorners(c,format="mini"){
  const f=formatInfo(format),portrait=c.height>=c.width;
  const ratio=portrait?f.w/f.h:f.h/f.w;
  const maxW=c.width*.80,maxH=c.height*.80;
  let w=maxW,h=w/ratio;
  if(h>maxH){h=maxH;w=h*ratio}
  const x=(c.width-w)/2,y=(c.height-h)/2;
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}

async function loadOpenCV(timeout=18000){
  if(window.cv?.Mat)return window.cv;
  if(cvPromise)return cvPromise;
  cvPromise=new Promise((resolve,reject)=>{
    const ready=async()=>{
      try{
        let c=window.cv;
        if(c&&typeof c.then==="function")c=await c;
        if(!c?.Mat)throw new Error("OpenCV runtime not ready");
        window.cv=c;resolve(c);
      }catch(e){reject(e)}
    };
    const existing=document.querySelector("script[data-cheki-opencv]");
    if(existing){
      if(window.cv)ready();
      else existing.addEventListener("load",ready,{once:true});
      existing.addEventListener("error",()=>reject(new Error("OpenCV load failed")),{once:true});
      return;
    }
    const s=document.createElement("script");
    s.src=OPENCV_URL;s.async=true;s.dataset.chekiOpencv="1";
    s.onload=ready;s.onerror=()=>reject(new Error("OpenCV load failed"));
    document.head.appendChild(s);
  });
  try{
    return await Promise.race([
      cvPromise,
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("OpenCV timeout")),timeout))
    ]);
  }catch(e){cvPromise=null;throw e}
}


async function loadJscanify(timeout=12000){
  await loadOpenCV(timeout);
  if(window.jscanify)return window.jscanify;
  if(jscanifyPromise)return jscanifyPromise;
  jscanifyPromise=new Promise((resolve,reject)=>{
    const done=()=>{
      if(window.jscanify)resolve(window.jscanify);
      else reject(new Error("jscanify runtime not ready"));
    };
    const existing=document.querySelector("script[data-jscanify]");
    if(existing){
      existing.addEventListener("load",done,{once:true});
      existing.addEventListener("error",()=>reject(new Error("jscanify load failed")),{once:true});
      if(window.jscanify)done();
      return;
    }
    const script=document.createElement("script");
    script.src=JSCANIFY_URL;script.async=true;script.dataset.jscanify="1";
    script.onload=done;script.onerror=()=>reject(new Error("jscanify load failed"));
    document.head.appendChild(script);
  });
  try{
    return await Promise.race([
      jscanifyPromise,
      new Promise((_,rej)=>setTimeout(()=>rej(new Error("jscanify timeout")),timeout))
    ]);
  }catch(e){jscanifyPromise=null;throw e}
}

async function prepare(){
  const results=await Promise.allSettled([loadOpenCV(),loadJscanify()]);
  return results.some(x=>x.status==="fulfilled");
}

async function detectCornersJscanify(canvas,{format="mini"}={}){
  const cv=await loadOpenCV(),J=await loadJscanify();
  const scanner=new J();
  let mat=null,contour=null;
  try{
    mat=cv.imread(canvas);
    contour=scanner.findPaperContour(mat);
    if(!contour||contour.empty?.())throw new Error("paper contour not found");
    const cp=scanner.getCornerPoints(contour);
    if(!cp)throw new Error("corner points not found");
    const pts=orderCorners([
      cp.topLeftCorner,cp.topRightCorner,cp.bottomRightCorner,cp.bottomLeftCorner
    ]);
    if(pts.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error("invalid corner points");
    const m=quadMetrics(pts,canvas.width,canvas.height,format);
    if(m.score<.28)throw new Error("weak paper candidate");
    return {
      corners:pts,
      confidence:clamp((m.score-.28)/.58,0,1),
      rawScore:m.score,
      engine:"Document AI Scan",
      format:m.format||format,
      method:"jscanify",
      metrics:m
    };
  }finally{
    contour?.delete?.();mat?.delete?.();
  }
}

function polygonArea(p){
  return Math.abs(p.reduce((s,q,i)=>s+q.x*p[(i+1)%p.length].y-q.y*p[(i+1)%p.length].x,0))/2;
}
function vec(a,b){return{x:b.x-a.x,y:b.y-a.y}}
function dot(a,b){return a.x*b.x+a.y*b.y}
function len(a){return Math.hypot(a.x,a.y)}
function angleRectScore(p){
  let score=0;
  for(let i=0;i<4;i++){
    const a=vec(p[i],p[(i+1)%4]),b=vec(p[(i+1)%4],p[(i+2)%4]);
    const d=Math.abs(dot(a,b)/(Math.max(1,len(a)*len(b))));
    score+=1-clamp(d,0,1);
  }
  return score/4;
}
function parallelScore(p){
  const a1=vec(p[0],p[1]),a2=vec(p[3],p[2]),b1=vec(p[0],p[3]),b2=vec(p[1],p[2]);
  const cos=(a,b)=>Math.abs(dot(a,b)/(Math.max(1,len(a)*len(b))));
  return (cos(a1,a2)+cos(b1,b2))/2;
}
function quadMetrics(p,w,h,format){
  if(format==="auto"){
    let best=null;
    for(const key of Object.keys(FORMATS)){
      const m=quadMetrics(p,w,h,key);
      if(!best||m.score>best.score)best={...m,format:key};
    }
    return best||{score:-1,format:"mini"};
  }
  p=orderCorners(p);
  const top=dist(p[0],p[1]),bottom=dist(p[3],p[2]),left=dist(p[0],p[3]),right=dist(p[1],p[2]);
  const qw=(top+bottom)/2,qh=(left+right)/2;
  const major=Math.max(qw,qh),minor=Math.min(qw,qh);
  if(minor<12)return {score:-1,format};
  const observed=major/minor,target=formatLongRatio(format);
  const ratioScore=Math.exp(-Math.abs(Math.log(observed/target))*3.35);
  const ar=polygonArea(p)/(w*h);
  const areaScore=ar<.04?0:ar<.10?ar/.10:ar>.96?Math.max(0,(1-ar)/.04):Math.min(1,.58+ar);
  const centerX=p.reduce((sum,q)=>sum+q.x,0)/4,centerY=p.reduce((sum,q)=>sum+q.y,0)/4;
  const centerDist=Math.hypot((centerX-w/2)/(w/2),(centerY-h/2)/(h/2));
  const centerScore=1-clamp(centerDist*.48,0,.78);
  const rect=angleRectScore(p),parallel=parallelScore(p);
  const edgeBalance=Math.min(top,bottom)/Math.max(top,bottom)*Math.min(left,right)/Math.max(left,right);
  const score=ratioScore*.36+rect*.21+parallel*.14+edgeBalance*.12+areaScore*.11+centerScore*.06;
  return {score,ratioScore,rect,parallel,edgeBalance,areaRatio:ar,centerScore,format};
}

function sampleBorderWhiteness(canvas,p){
  try{
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const im=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const points=[];
    for(let e=0;e<4;e++){
      const a=p[e],b=p[(e+1)%4];
      for(let k=2;k<=8;k++){
        const t=k/10;
        points.push({x:Math.round(lerp(a.x,b.x,t)),y:Math.round(lerp(a.y,b.y,t))});
      }
    }
    let good=0,n=0;
    for(const q of points){
      const x=clamp(q.x,0,canvas.width-1),y=clamp(q.y,0,canvas.height-1),i=(y*canvas.width+x)*4;
      const r=im[i],g=im[i+1],b=im[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
      const sat=mx?((mx-mn)/mx):0,lum=.299*r+.587*g+.114*b;
      if(lum>145&&sat<.35)good++;
      n++;
    }
    return n?good/n:0;
  }catch(e){return 0}
}

function contourCandidates(cv,mat,w,h,format,sourceCanvas,tag,out){
  const contours=new cv.MatVector(),hierarchy=new cv.Mat();
  try{
    cv.findContours(mat,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);let hull=null,approx=null;
      try{
        const area=Math.abs(cv.contourArea(cnt,false)),ar=area/(w*h);
        if(ar<.035||ar>.98)continue;
        hull=new cv.Mat();cv.convexHull(cnt,hull,false,true);
        const peri=cv.arcLength(hull,true);
        for(const eps of [.012,.018,.024,.032,.042]){
          approx?.delete();approx=new cv.Mat();
          cv.approxPolyDP(hull,approx,eps*peri,true);
          if(approx.rows!==4||!cv.isContourConvex(approx))continue;
          const pts=[];
          for(let r=0;r<4;r++){
            const v=approx.intPtr(r,0);pts.push({x:v[0],y:v[1]});
          }
          const p=orderCorners(pts),m=quadMetrics(p,w,h,format);
          if(m.score<.30)continue;
          const white=sampleBorderWhiteness(sourceCanvas,p);
          // Border whiteness is a bonus only; decorated prints must still work.
          const score=m.score+Math.min(.07,white*.07);
          out.push({pts:p,score,metrics:{...m,white},tag});
        }
      }finally{cnt.delete();hull?.delete();approx?.delete()}
    }
  }finally{contours.delete();hierarchy.delete()}
}

async function detectCornersOpenCV(canvas,{format="mini"}={}){
  const cv=await loadOpenCV();
  let src=null,small=null,rgb=null,gray=null,blur=null,hsv=null,mask=null,kernel=null;
  const mats=[];
  try{
    src=cv.imread(canvas);
    const max=880,scale=Math.min(1,max/Math.max(src.cols,src.rows));
    small=new cv.Mat();
    cv.resize(src,small,new cv.Size(Math.max(1,Math.round(src.cols*scale)),Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
    rgb=new cv.Mat();gray=new cv.Mat();blur=new cv.Mat();
    cv.cvtColor(small,rgb,cv.COLOR_RGBA2RGB);
    cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);
    kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));
    const candidates=[];

    // 1) Multi-threshold edge passes
    for(const [lo,hi] of [[24,80],[38,120],[55,165],[80,230]]){
      const edges=new cv.Mat(),closed=new cv.Mat();
      cv.Canny(blur,edges,lo,hi,3,false);
      cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
      cv.dilate(closed,closed,kernel,new cv.Point(-1,-1),1);
      mats.push(edges,closed);
      contourCandidates(cv,closed,small.cols,small.rows,format,small,`edge-${lo}`,candidates);
    }

    // 2) Adaptive threshold: strong when background and border have similar brightness.
    const adaptive=new cv.Mat(),adaptiveInv=new cv.Mat();
    cv.adaptiveThreshold(blur,adaptive,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,7);
    cv.bitwise_not(adaptive,adaptiveInv);
    cv.morphologyEx(adaptiveInv,adaptiveInv,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
    mats.push(adaptive,adaptiveInv);
    contourCandidates(cv,adaptiveInv,small.cols,small.rows,format,small,"adaptive",candidates);

    // 3) Bright / low-saturation border mask.
    hsv=new cv.Mat();cv.cvtColor(rgb,hsv,cv.COLOR_RGB2HSV);
    mask=new cv.Mat();
    const low=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[0,0,135,0]);
    const high=new cv.Mat(hsv.rows,hsv.cols,hsv.type(),[180,105,255,255]);
    cv.inRange(hsv,low,high,mask);low.delete();high.delete();
    cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),3);
    cv.morphologyEx(mask,mask,cv.MORPH_OPEN,kernel,new cv.Point(-1,-1),1);
    contourCandidates(cv,mask,small.cols,small.rows,format,small,"border",candidates);

    if(!candidates.length)throw new Error("no quadrilateral candidate");
    candidates.sort((a,b)=>b.score-a.score);
    const best=candidates[0],inv=1/scale;
    const conf=clamp((best.score-.30)/.58,0,1);
    return {
      corners:best.pts.map(q=>({x:q.x*inv,y:q.y*inv})),
      confidence:conf,
      rawScore:best.score,
      engine:"Instax輪郭検出",
      format:best.metrics?.format||format,
      method:best.tag,
      metrics:best.metrics
    };
  }finally{
    [...mats,src,small,rgb,gray,blur,hsv,mask,kernel].forEach(x=>x?.delete?.());
  }
}

function detectCornersFallback(canvas,{format="mini"}={}){
  // Safe fallback: known film aspect ratio centered guide.
  return {corners:defaultCorners(canvas,format),confidence:.10,engine:"手動ガイド",format,method:"fallback"};
}

async function detectCorners(canvas,opts={}){
  const candidates=[];
  try{candidates.push(await detectCornersJscanify(canvas,opts))}catch(e){console.warn("[ChekiScanner] jscanify:",e?.message||e)}
  // Strong document contour: return immediately to keep live scan fast.
  if(candidates[0]?.confidence>=.62)return candidates[0];
  try{candidates.push(await detectCornersOpenCV(canvas,opts))}catch(e){console.warn("[ChekiScanner] OpenCV ensemble:",e?.message||e)}
  const valid=candidates.filter(x=>x?.corners?.length===4);
  if(valid.length){
    valid.sort((a,b)=>(b.confidence||0)-(a.confidence||0));
    return valid[0];
  }
  return detectCornersFallback(canvas,opts);
}

function computeOutputSize(corners,format="mini",maxLongEdge=1800){
  if(format==="auto")format="mini";
  const p=orderCorners(corners),f=formatInfo(format);
  const observedW=(dist(p[0],p[1])+dist(p[3],p[2]))/2;
  const observedH=(dist(p[0],p[3])+dist(p[1],p[2]))/2;
  const landscape=observedW>=observedH;
  let rw=landscape?Math.max(f.w,f.h):Math.min(f.w,f.h);
  let rh=landscape?Math.min(f.w,f.h):Math.max(f.w,f.h);
  const long=Math.max(rw,rh),scale=maxLongEdge/long;
  return {w:Math.max(300,Math.round(rw*scale)),h:Math.max(300,Math.round(rh*scale))};
}

async function cropOpenCV(canvas,corners,{format="mini",maxLongEdge=1800}={}){
  const cv=await loadOpenCV(7000),p=orderCorners(corners),size=computeOutputSize(p,format,maxLongEdge);
  let src=null,dst=null,sp=null,dp=null,M=null;
  const out=document.createElement("canvas");
  try{
    src=cv.imread(canvas);dst=new cv.Mat();
    sp=cv.matFromArray(4,1,cv.CV_32FC2,[p[0].x,p[0].y,p[1].x,p[1].y,p[2].x,p[2].y,p[3].x,p[3].y]);
    dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,size.w-1,0,size.w-1,size.h-1,0,size.h-1]);
    M=cv.getPerspectiveTransform(sp,dp);
    cv.warpPerspective(src,dst,M,new cv.Size(size.w,size.h),cv.INTER_CUBIC,cv.BORDER_REPLICATE,new cv.Scalar());
    out.width=size.w;out.height=size.h;cv.imshow(out,dst);
    return out;
  }finally{[src,dst,sp,dp,M].forEach(x=>x?.delete?.())}
}

// Perspective fallback when OpenCV fails after a photo has already been captured.
function solveLinear(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let pivot=i;for(let r=i+1;r<n;r++)if(Math.abs(M[r][i])>Math.abs(M[pivot][i]))pivot=r;
    [M[i],M[pivot]]=[M[pivot],M[i]];
    let d=M[i][i];if(Math.abs(d)<1e-12)d=1e-12;
    for(let c=i;c<=n;c++)M[i][c]/=d;
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
  return [...solveLinear(A,b),1];
}
function cropFallback(canvas,corners,{format="mini",maxLongEdge=1100}={}){
  const p=orderCorners(corners),size=computeOutputSize(p,format,Math.min(maxLongEdge,1100));
  const out=document.createElement("canvas");out.width=size.w;out.height=size.h;
  const sctx=canvas.getContext("2d",{willReadFrequently:true}),src=sctx.getImageData(0,0,canvas.width,canvas.height),sp=src.data;
  const ctx=out.getContext("2d"),img=ctx.createImageData(size.w,size.h),dp=img.data,H=homographyDestToSrc(size.w,size.h,p);
  const sw=canvas.width,sh=canvas.height;
  for(let y=0;y<size.h;y++)for(let x=0;x<size.w;x++){
    const z=H[6]*x+H[7]*y+1,sx=clamp((H[0]*x+H[1]*y+H[2])/z,0,sw-1),sy=clamp((H[3]*x+H[4]*y+H[5])/z,0,sh-1);
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=sx-x0,fy=sy-y0;
    const ids=[(y0*sw+x0)*4,(y0*sw+x1)*4,(y1*sw+x0)*4,(y1*sw+x1)*4],di=(y*size.w+x)*4;
    for(let c=0;c<3;c++){const a=sp[ids[0]+c]*(1-fx)+sp[ids[1]+c]*fx,b=sp[ids[2]+c]*(1-fx)+sp[ids[3]+c]*fx;dp[di+c]=Math.round(a*(1-fy)+b*fy)}
    dp[di+3]=255;
  }
  ctx.putImageData(img,0,0);return out;
}
async function crop(canvas,corners,opts={}){
  try{return await cropOpenCV(canvas,corners,opts)}
  catch(e){console.warn("[ChekiScanner] warp fallback",e);return cropFallback(canvas,corners,opts)}
}


async function detectRegions(canvas,{format="auto"}={}){
  const cv=await loadOpenCV();
  let src=null,small=null,gray=null,blur=null,edges=null,closed=null,kernel=null,contours=null,hierarchy=null;
  try{
    src=cv.imread(canvas);
    const scale=Math.min(1,1100/Math.max(src.cols,src.rows));
    small=new cv.Mat();
    cv.resize(src,small,new cv.Size(Math.round(src.cols*scale),Math.round(src.rows*scale)),0,0,cv.INTER_AREA);
    gray=new cv.Mat();blur=new cv.Mat();edges=new cv.Mat();closed=new cv.Mat();
    cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0,0,cv.BORDER_DEFAULT);
    cv.Canny(blur,edges,30,120,3,false);
    kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(5,5));
    cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel,new cv.Point(-1,-1),2);
    contours=new cv.MatVector();hierarchy=new cv.Mat();
    cv.findContours(closed,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    const found=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);let hull=null,approx=null;
      try{
        const area=Math.abs(cv.contourArea(cnt,false)),ar=area/(small.cols*small.rows);
        if(ar<.012||ar>.70)continue;
        hull=new cv.Mat();cv.convexHull(cnt,hull,false,true);
        const peri=cv.arcLength(hull,true);
        for(const eps of [.015,.022,.03,.04]){
          approx?.delete();approx=new cv.Mat();cv.approxPolyDP(hull,approx,eps*peri,true);
          if(approx.rows!==4||!cv.isContourConvex(approx))continue;
          const pts=[];for(let r=0;r<4;r++){const v=approx.intPtr(r,0);pts.push({x:v[0],y:v[1]})}
          const p=orderCorners(pts),m=quadMetrics(p,small.cols,small.rows,format);
          if(m.score<.43)continue;
          const inv=1/scale,corners=p.map(q=>({x:q.x*inv,y:q.y*inv}));
          const xs=corners.map(q=>q.x),ys=corners.map(q=>q.y);
          found.push({corners,x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys),confidence:clamp((m.score-.3)/.6,0,1),format:m.format});
          break;
        }
      }finally{cnt.delete();hull?.delete();approx?.delete()}
    }
    found.sort((a,b)=>b.confidence-a.confidence);
    const iou=(a,b)=>{
      const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
      const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);return inter/(a.w*a.h+b.w*b.h-inter||1);
    };
    const kept=[];
    for(const r of found){if(kept.every(k=>iou(r,k)<.42))kept.push(r);if(kept.length>=30)break}
    return kept.sort((a,b)=>a.y-b.y||a.x-b.x);
  }finally{
    [src,small,gray,blur,edges,closed,kernel,hierarchy].forEach(x=>x?.delete?.());contours?.delete?.();
  }
}

function imageStats(canvas){
  const max=280,sc=Math.min(1,max/Math.max(canvas.width,canvas.height)),w=Math.max(20,Math.round(canvas.width*sc)),h=Math.max(20,Math.round(canvas.height*sc));
  const t=document.createElement("canvas");t.width=w;t.height=h;const ctx=t.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data;let lum=0,sat=0,bright=0,dark=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=.299*r+.587*g+.114*b;
    lum+=l;sat+=mx?((mx-mn)/mx):0;if(l>245)bright++;if(l<20)dark++;
  }
  const n=d.length/4;return{lum:lum/n,sat:sat/n,bright:bright/n,dark:dark/n};
}

function autoEdit(canvas){
  const s=imageStats(canvas);
  return {
    brightness:clamp(Math.round((128-s.lum)*.16),-18,18),
    contrast:s.lum<90?8:s.lum>190?-4:6,
    saturation:s.sat<.20?9:s.sat>.55?-3:4,
    warmth:0
  };
}

function applyAdjustments(canvas,edit={}){
  const {brightness=0,contrast=0,saturation=0,warmth=0}=edit;
  const out=document.createElement("canvas");out.width=canvas.width;out.height=canvas.height;
  const ctx=out.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0);
  const im=ctx.getImageData(0,0,out.width,out.height),d=im.data;
  const cf=(259*(contrast+255))/(255*(259-contrast||1));
  const sf=1+saturation/100;
  for(let i=0;i<d.length;i+=4){
    let r=cf*(d[i]-128)+128+brightness,g=cf*(d[i+1]-128)+128+brightness,b=cf*(d[i+2]-128)+128+brightness;
    const y=.299*r+.587*g+.114*b;
    r=y+(r-y)*sf+warmth*.42;g=y+(g-y)*sf;b=y+(b-y)*sf-warmth*.42;
    d[i]=clamp(Math.round(r),0,255);d[i+1]=clamp(Math.round(g),0,255);d[i+2]=clamp(Math.round(b),0,255);
  }
  ctx.putImageData(im,0,0);return out;
}

function quality(canvas,confidence=0){
  const max=300,sc=Math.min(1,max/Math.max(canvas.width,canvas.height)),w=Math.max(24,Math.round(canvas.width*sc)),h=Math.max(24,Math.round(canvas.height*sc));
  const t=document.createElement("canvas");t.width=w;t.height=h;const ctx=t.getContext("2d",{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
  const d=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);let mean=0,white=0,dark=0;
  for(let i=0,p=0;i<d.length;i+=4,p++){const v=.299*d[i]+.587*d[i+1]+.114*d[i+2];g[p]=v;mean+=v;if(v>247)white++;if(v<18)dark++}
  mean/=g.length;white/=g.length;dark/=g.length;
  let s=0,s2=0,n=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,v=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w];s+=v;s2+=v*v;n++}
  const blur=Math.max(0,s2/n-(s/n)**2);let score=100;const warnings=[];
  if(Math.min(canvas.width,canvas.height)<700){score-=15;warnings.push("解像度が低め")}
  if(blur<125){score-=28;warnings.push("ピンぼけ・手ブレ")}
  else if(blur<260){score-=12;warnings.push("少しぼけています")}
  if(mean<58){score-=18;warnings.push("暗すぎます")}
  else if(mean>220){score-=12;warnings.push("明るすぎます")}
  if(white>.18){score-=12;warnings.push("反射・白飛びが多め")}
  if(dark>.18){score-=8;warnings.push("黒つぶれが多め")}
  if(confidence&&confidence<.45){score-=14;warnings.push("四隅を確認してください")}
  score=clamp(Math.round(score),0,100);
  return{score,label:score>=88?"高品質":score>=70?"良好":score>=50?"要確認":"撮り直し推奨",warnings,blur:Math.round(blur),brightness:Math.round(mean),glareRatio:white};
}

function resizeTo(canvas,w,h){
  if(canvas.width===w&&canvas.height===h)return canvas;
  const o=document.createElement("canvas");o.width=w;o.height=h;o.getContext("2d").drawImage(canvas,0,0,w,h);return o;
}

function combineGlareFrames(frames){
  if(!frames?.length)throw new Error("no frames");
  if(frames.length===1)return frames[0];
  const w=frames[0].width,h=frames[0].height;
  const normalized=frames.map(f=>resizeTo(f,w,h));
  const stats=normalized.map(imageStats),target=[...stats.map(s=>s.lum)].sort((a,b)=>a-b)[Math.floor(stats.length/2)]||128;
  const arrays=normalized.map((c,i)=>{
    const ctx=c.getContext("2d",{willReadFrequently:true}),im=ctx.getImageData(0,0,w,h),gain=clamp(target/Math.max(30,stats[i].lum),.82,1.18);
    return {data:im.data,gain};
  });
  const out=document.createElement("canvas");out.width=w;out.height=h;const ctx=out.getContext("2d"),im=ctx.createImageData(w,h),d=im.data;
  for(let i=0;i<d.length;i+=4){
    const samples=arrays.map(a=>{
      const r=clamp(a.data[i]*a.gain,0,255),g=clamp(a.data[i+1]*a.gain,0,255),b=clamp(a.data[i+2]*a.gain,0,255);
      return {r,g,b,l:.299*r+.587*g+.114*b};
    }).sort((a,b)=>a.l-b.l);
    // Middle values reject both strong glare and strong moving shadows.
    const a=samples[Math.floor((samples.length-1)/2)],b=samples[Math.ceil((samples.length-1)/2)];
    d[i]=(a.r+b.r)/2;d[i+1]=(a.g+b.g)/2;d[i+2]=(a.b+b.b)/2;d[i+3]=255;
  }
  ctx.putImageData(im,0,0);return out;
}

window.ChekiScanner={
  FORMATS,formatInfo,formatLongRatio,loadOpenCV,loadJscanify,prepare,detectCorners,detectRegions,crop,defaultCorners,orderCorners,
  autoEdit,applyAdjustments,quality,imageStats,combineGlareFrames,OPENCV_URL,JSCANIFY_URL
};
})();