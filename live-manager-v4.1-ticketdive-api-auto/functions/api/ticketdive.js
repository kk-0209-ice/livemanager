import { parseTicketDiveHtml } from "../../server/ticketdive-api-worker.js";

const ALLOWED_HOSTS=new Set(["ticketdive.com","www.ticketdive.com"]);

function cors(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type"
  };
}
function response(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{...cors(),"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=300"}
  });
}
function uniq(arr=[]){
  const seen=new Set(),out=[];
  for(const n of arr){
    const s=String(n||"").trim();
    if(!s)continue;
    const k=s.toLocaleLowerCase("ja");
    if(seen.has(k))continue;
    seen.add(k);out.push(s);
  }
  return out;
}
function merge(events,url){
  const list=events.filter(Boolean);
  const pick=k=>list.map(x=>x[k]).find(Boolean)||"";
  const performerNames=uniq(list.flatMap(x=>x.performerNames||[]));
  const title=pick("title"),date=pick("date"),venue=pick("venue"),openTime=pick("openTime"),startTime=pick("startTime");
  const text=[
    title,
    date?`公演日時 ${date}`:"",
    (openTime||startTime)?`開場時刻 ${openTime||"-"} / 開演時刻 ${startTime||"-"}`:"",
    venue?`会場 ${venue}`:"",
    performerNames.length?`出演 ${performerNames.join(" / ")}`:""
  ].filter(Boolean).join("\n");
  return {title,date,venue,openTime,startTime,performerNames,performers:performerNames.join(" / "),artist:performerNames.join(" / "),url,text};
}
async function fetchHtml(url,ua){
  const r=await fetch(url,{
    headers:{
      "User-Agent":ua,
      "Accept":"text/html,application/xhtml+xml",
      "Accept-Language":"ja,en-US;q=0.8,en;q=0.6",
      "Cache-Control":"no-cache"
    },
    redirect:"follow"
  });
  if(!r.ok)throw new Error(`TicketDive HTTP ${r.status}`);
  return r.text();
}

export async function onRequestOptions(){
  return new Response(null,{headers:cors()});
}

export async function onRequestGet(context){
  const requestUrl=new URL(context.request.url);
  const raw=requestUrl.searchParams.get("url");
  if(!raw)return response({ok:false,error:"url parameter is required"},400);

  let target;
  try{target=new URL(raw)}catch{return response({ok:false,error:"invalid url"},400)}
  if(target.protocol!=="https:"||!ALLOWED_HOSTS.has(target.hostname)||!/^\/event\//i.test(target.pathname)){
    return response({ok:false,error:"only public TicketDive event URLs are allowed"},403);
  }

  try{
    const results=await Promise.allSettled([
      fetchHtml(target.toString(),"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"),
      fetchHtml(target.toString(),"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
    ]);
    const bodies=results.filter(x=>x.status==="fulfilled").map(x=>x.value);
    if(!bodies.length)throw new Error("TicketDive HTMLを取得できませんでした");
    const event=merge(bodies.map(x=>parseTicketDiveHtml(x,target.toString())),target.toString());
    if(!event.title&&!event.date&&!event.venue)throw new Error("公演情報を検出できませんでした");
    return response({
      ok:true,
      source:"Cloudflare Pages内蔵TicketDive API",
      performerCount:event.performerNames.length,
      event,
      text:event.text
    });
  }catch(e){
    return response({ok:false,error:e?.message||"TicketDive fetch failed"},502);
  }
}
