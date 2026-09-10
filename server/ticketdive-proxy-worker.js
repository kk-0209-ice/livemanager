// Live Manager v4 - TicketDive専用取得API
// Cloudflare Workers (Module Worker)
// 公開TicketDiveイベントページだけを取得し、必要な公演情報をJSONで返します。

const ALLOWED_HOSTS = new Set(["ticketdive.com", "www.ticketdive.com"]);
const LABEL_ONLY = /^(?:アーティスト(?:名|情報)?|出演(?:者|者名|者情報|アーティスト|アーティスト名|グループ|グループ名)?|ARTISTS?|PERFORMERS?|CAST)$/i;
const STOP_LINE = /^(?:TICKET INFO|販売情報|詳細|申し込み|申込|チケット|公演日時|開場時刻|開演時刻|会場|お支払い方法|注意事項)$/i;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...extra,
    },
  });
}

function decodeEntities(s="") {
  const map = {
    "&amp;":"&", "&lt;":"<", "&gt;":">", "&quot;":'"',
    "&#39;":"'", "&apos;":"'", "&nbsp;":" "
  };
  return String(s)
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m=>map[m]||m)
    .replace(/&#(\d+);/g, (_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_,n)=>String.fromCodePoint(parseInt(n,16)));
}

function decodeNextEscapes(s="") {
  return String(s)
    .replace(/\\u003c/gi,"<")
    .replace(/\\u003e/gi,">")
    .replace(/\\u0026/gi,"&")
    .replace(/\\u002f/gi,"/")
    .replace(/\\u0022/gi,'"')
    .replace(/\\"/g,'"');
}

function stripTags(s="") {
  return decodeEntities(
    String(s)
      .replace(/<script\b[\s\S]*?<\/script>/gi," ")
      .replace(/<style\b[\s\S]*?<\/style>/gi," ")
      .replace(/<(?:br|hr)\b[^>]*>/gi,"\n")
      .replace(/<\/(?:div|p|li|h[1-6]|section|article|header|main|footer|tr)>/gi,"\n")
      .replace(/<[^>]+>/g," ")
  )
    .replace(/\r/g,"")
    .split("\n")
    .map(x=>x.replace(/\s+/g," ").trim())
    .filter(Boolean)
    .join("\n");
}

function cleanName(v="") {
  let s=decodeEntities(stripTags(v))
    .replace(/^[#>*_\-\s]+|[#>*_\-\s]+$/g,"")
    .replace(/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|PERFORMERS?|ARTISTS?|CAST)\s*[:：\-–—]?\s*/i,"")
    .trim();
  if(!s || LABEL_ONLY.test(s) || STOP_LINE.test(s)) return "";
  if(/https?:\/\//i.test(s)) return "";
  if(/(?:タイムテーブル|変更|キャンセル|払い戻し|注意事項|主催|制作|お問い合わせ|チケット)/i.test(s)) return "";
  return s.length <= 120 ? s : "";
}

function uniqNames(arr=[]) {
  const out=[];
  const seen=new Set();
  for(const raw of arr) {
    const name=cleanName(raw);
    if(!name) continue;
    const key=name.toLocaleLowerCase("ja");
    if(seen.has(key)) continue;
    seen.add(key); out.push(name);
  }
  return out;
}

function splitNames(value="") {
  let s=String(value).trim();
  for(let i=0;i<5;i++){
    const before=s;
    s=s.replace(/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|PERFORMERS?|ARTISTS?|CAST)\s*[:：\-–—]?\s*/i,"").trim();
    if(s===before) break;
  }
  return uniqNames(
    s.split(/\s*(?:\/|／|、|,|\||｜|・)\s*/).filter(Boolean)
  );
}

function extractArtistLinks(html="") {
  const out=[];
  const variants=[String(html), decodeNextEscapes(html)];
  const rx=/<a\b[^>]*href=["'](?:https?:\/\/(?:www\.)?ticketdive\.com)?\/artist\/[^"']+["'][^>]*>([\s\S]{0,500}?)<\/a>/gi;
  for(const source of variants){
    let m; rx.lastIndex=0;
    while((m=rx.exec(source))) out.push(m[1]);
  }
  return uniqNames(out);
}

function extractStructuredNames(html="") {
  const out=[];
  const source=decodeNextEscapes(html);

  // performers/artists/cast 配列内の name/displayName/artistName
  const arrayRx=/(?:["'](?:performers?|artists?|casts?)["']|\\?"(?:performers?|artists?|casts?)\\?")\s*:\s*\[([\s\S]{0,12000}?)\]/gi;
  let m;
  while((m=arrayRx.exec(source))){
    const block=m[1];
    const nameRx=/["'](?:name|displayName|artistName)["']\s*:\s*["']([^"'\\]{1,120})["']/gi;
    let n;
    while((n=nameRx.exec(block))) out.push(n[1]);
  }

  // performer / artist 単体object
  const singleRx=/["'](?:performer|artist)["']\s*:\s*\{[\s\S]{0,1600}?["']name["']\s*:\s*["']([^"'\\]{1,120})["']/gi;
  while((m=singleRx.exec(source))) out.push(m[1]);

  return uniqNames(out);
}

function extractVisibleNames(text="") {
  const lines=String(text).split("\n").map(x=>x.trim()).filter(Boolean);
  const out=[];

  for(let i=0;i<lines.length;i++){
    const line=lines[i];

    // 「出演iON! / iMiN! / iLiFE!」形式
    const inline=line.match(/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|PERFORMERS?|ARTISTS?|CAST)\s*[:：]?\s*(.+)$/i);
    if(inline && inline[1]){
      out.push(...splitNames(inline[1]));
      continue;
    }

    // 「出演」だけの行 → 後続数行
    if(LABEL_ONLY.test(line)){
      for(let j=i+1;j<Math.min(lines.length,i+7);j++){
        const next=lines[j];
        if(STOP_LINE.test(next)) break;
        if(/^(?:公演日時|開場時刻|開演時刻|会場)/.test(next)) break;
        out.push(...splitNames(next));
      }
    }
  }

  return uniqNames(out);
}

function cleanTitle(s="") {
  return decodeEntities(stripTags(s))
    .replace(/\s*[|｜]\s*TicketDive.*$/i,"")
    .replace(/\s*-\s*TicketDive.*$/i,"")
    .trim();
}

function extractTitle(html,text) {
  const og=String(html).match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || String(html).match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["'][^>]*>/i);
  if(og?.[1]) return cleanTitle(og[1]);

  const h1=String(html).match(/<h1\b[^>]*>([\s\S]{0,1000}?)<\/h1>/i);
  if(h1?.[1]) {
    const t=cleanTitle(h1[1]);
    if(t) return t;
  }

  const lines=String(text).split("\n").map(x=>x.trim()).filter(Boolean);
  for(const line of lines){
    if(/^(?:公演日時|開場時刻|開演時刻|会場|出演|TICKET INFO|販売情報|詳細)/i.test(line)) continue;
    if(line.length<=180) return line;
  }
  return "";
}

function normalizeDate(s="") {
  const m=String(s).match(/(\d{4})\s*[\/年.-]\s*(\d{1,2})\s*[\/月.-]\s*(\d{1,2})/);
  if(!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
}

function fieldFromLine(text,label) {
  const rx=new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]?\\s*([^\\n]+)`,"i");
  return (String(text).match(rx)||[])[1]?.trim()||"";
}

export function parseTicketDiveHtml(html, url="") {
  const text=stripTags(html);
  const title=extractTitle(html,text);

  const date=normalizeDate(fieldFromLine(text,"公演日時")||text);
  const venue=fieldFromLine(text,"会場");

  let openTime="", startTime="";
  const pair=String(text).match(/開場時刻\s*[:：]?\s*(\d{1,2}:\d{2})\s*[\/／]\s*開演時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)
    || String(text).match(/(?:OPEN|開場)\s*[:：]?\s*(\d{1,2}:\d{2})[^\n]{0,50}?(?:START|開演)\s*[:：]?\s*(\d{1,2}:\d{2})/i);
  if(pair){ openTime=pair[1]||""; startTime=pair[2]||""; }
  if(!openTime) openTime=(String(text).match(/開場時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)||[])[1]||"";
  if(!startTime) startTime=(String(text).match(/開演時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)||[])[1]||"";

  const performerNames=uniqNames([
    ...extractArtistLinks(html),
    ...extractStructuredNames(html),
    ...extractVisibleNames(text)
  ]);

  const manualText=[
    title,
    date?`公演日時 ${date}`:"",
    (openTime||startTime)?`開場時刻 ${openTime||"-"} / 開演時刻 ${startTime||"-"}`:"",
    venue?`会場 ${venue}`:"",
    performerNames.length?`出演 ${performerNames.join(" / ")}`:""
  ].filter(Boolean).join("\n");

  return {
    title, date, venue, openTime, startTime,
    performerNames,
    performers: performerNames.join(" / "),
    artist: performerNames.join(" / "),
    url,
    text: manualText
  };
}

function mergeEvents(events, url) {
  const valid=events.filter(Boolean);
  const performerNames=uniqNames(valid.flatMap(x=>x.performerNames||[]));
  const pick=(key)=>valid.map(x=>x[key]).find(Boolean)||"";
  return {
    title:pick("title"),
    date:pick("date"),
    venue:pick("venue"),
    openTime:pick("openTime"),
    startTime:pick("startTime"),
    performerNames,
    performers:performerNames.join(" / "),
    artist:performerNames.join(" / "),
    url,
    text:[
      pick("title"),
      pick("date")?`公演日時 ${pick("date")}`:"",
      (pick("openTime")||pick("startTime"))?`開場時刻 ${pick("openTime")||"-"} / 開演時刻 ${pick("startTime")||"-"}`:"",
      pick("venue")?`会場 ${pick("venue")}`:"",
      performerNames.length?`出演 ${performerNames.join(" / ")}`:""
    ].filter(Boolean).join("\n")
  };
}

async function fetchVersion(target, userAgent) {
  // 片方のUAが遅くてもWorker全体を待たせない。
  // 4.5秒を超えたTicketDive取得は中断し、もう片方の成功結果だけで返す。
  const signal=AbortSignal.timeout(4500);
  const r=await fetch(target,{
    method:"GET",
    headers:{
      "User-Agent":userAgent,
      "Accept":"text/html,application/xhtml+xml",
      "Accept-Language":"ja,en-US;q=0.8,en;q=0.6",
      "Cache-Control":"no-cache"
    },
    redirect:"follow",
    signal,
    cf:{cacheTtl:120,cacheEverything:true}
  });
  if(!r.ok) throw new Error(`TicketDive HTTP ${r.status}`);
  return await r.text();
}

export default {
  async fetch(request, env, ctx) {
    if(request.method==="OPTIONS") return new Response(null,{headers:corsHeaders()});
    if(request.method!=="GET") return json({ok:false,error:"GET only"},405);

    const reqUrl=new URL(request.url);
    if(reqUrl.pathname==="/health"){
      return json({ok:true,service:"live-manager-ticketdive-v4"});
    }

    const raw=reqUrl.searchParams.get("url");
    if(!raw) return json({ok:false,error:"url parameter is required"},400);

    let target;
    try{ target=new URL(raw); }
    catch{ return json({ok:false,error:"invalid url"},400); }

    if(target.protocol!=="https:" || !ALLOWED_HOSTS.has(target.hostname) || !/^\/event\//i.test(target.pathname)){
      return json({ok:false,error:"only public TicketDive event URLs are allowed"},403);
    }

    // Workerキャッシュ。5分以内の同じイベントはTicketDiveへ再アクセスしない。
    const cache=caches.default;
    const cacheKey=new Request(`${reqUrl.origin}/__cache/ticketdive?url=${encodeURIComponent(target.toString())}`);
    const cached=await cache.match(cacheKey);
    if(cached){
      const data=await cached.json();
      return json({...data,cached:true},200,{"X-Live-Manager-Cache":"HIT"});
    }

    try{
      // TicketDive側のUA差を吸収するため2種類を並列取得。
      const settled=await Promise.allSettled([
        fetchVersion(target.toString(),"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"),
        fetchVersion(target.toString(),"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
      ]);

      const bodies=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
      if(!bodies.length){
        const reason=settled.map(x=>x.status==="rejected"?String(x.reason):"").filter(Boolean).join(" / ");
        throw new Error(reason||"TicketDive fetch failed");
      }

      const parsed=bodies.map(body=>parseTicketDiveHtml(body,target.toString()));
      const event=mergeEvents(parsed,target.toString());

      if(!event.title && !event.date && !event.venue){
        throw new Error("public event data was not found");
      }

      const payload={
        ok:true,
        source:"TicketDive専用Worker",
        cached:false,
        performerCount:event.performerNames.length,
        event,
        text:event.text
      };

      const cacheResponse=json(payload,200);
      ctx.waitUntil(cache.put(cacheKey,cacheResponse.clone()));
      return cacheResponse;
    }catch(error){
      return json({
        ok:false,
        error:error?.message||"TicketDive fetch failed",
        hint:"TicketDive側の一時的な制限の可能性があります。数秒後に再試行してください。"
      },502,{"Cache-Control":"no-store"});
    }
  }
};
