(() => {
  "use strict";

  const STORAGE_KEY = "live-manager-v3-data";
  const LEGACY_STORAGE_KEYS = ["live-manager-v2-data","live-manager-v1-data"];
  const APP_VERSION = 3;
  const PUBLIC_TICKETDIVE_WORKER_URL = "https://live-manager-ticketdive.47frzzcfhy.workers.dev";
  const defaultData = {
    version: APP_VERSION,
    groups: [],
    members: [],
    lives: [],
    chekiRecords: [],
    chekiImages: [],
    chekiTickets: [],
    expenses: [],
    settings: {
      oshiMemberId: "",
      activeLiveId: "",
      milestones: [100,200,300,500,1000],
      notificationsEnabled: false,
      sentNoticeKeys: [],
      urlProxy: "",
      aiEndpoint: "",
      cloud: { supabaseUrl:"", anonKey:"", email:"", syncImages:true },
      scanDefaults: { memberId:"", liveId:"", date:"", type:"2ショット", signed:false, favorite:false }
    }
  };

  let state = load();
  let route = "home";
  let params = {};
  let calendarCursor = new Date();
  let scanSession = { sourceCanvas:null, corners:null, dragIndex:-1, lastMeta:null, detection:null, tone:"natural", ratioMode:"cheki", rotation:0, quality:null, previewCanvas:null };
  let batchSession = { sourceCanvas:null, regions:[], selected:new Set() };
  let albumFilter = { memberId:"", liveId:"", month:"", signed:"", favorite:"", q:"", sort:"newest" };

  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const main = $("#main");
  const modal = $("#modal");
  const modalTitle = $("#modalTitle");
  const modalBody = $("#modalBody");

  function uid(prefix="id"){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
  function safe(v){ return String(v ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function yen(n){ return new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY",maximumFractionDigits:0}).format(Number(n||0)); }
  function fmtDate(v){ if(!v)return "未設定"; const d=new Date(`${v}T00:00:00`); return new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"short",day:"numeric",weekday:"short"}).format(d); }
  function todayStr(){ const d=new Date(); return localDateStr(d); }
  function localDateStr(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function monthKey(v){ return v ? v.slice(0,7) : ""; }
  function thisMonth(){ return todayStr().slice(0,7); }
  function thisYear(){ return todayStr().slice(0,4); }
  function daysUntil(date){ if(!date)return null; const a=new Date(`${todayStr()}T00:00:00`), b=new Date(`${date}T00:00:00`); return Math.ceil((b-a)/86400000); }
  function groupById(id){ return state.groups.find(x=>x.id===id); }
  function memberById(id){ return state.members.find(x=>x.id===id); }
  function liveById(id){ return state.lives.find(x=>x.id===id); }
  function totalCheki(filter=()=>true){ return state.chekiRecords.filter(filter).reduce((s,r)=>s+Number(r.qty||0),0); }
  function totalChekiCost(filter=()=>true){ return state.chekiRecords.filter(filter).reduce((s,r)=>s+Number(r.qty||0)*Number(r.unitPrice||0),0); }
  function totalExpense(filter=()=>true){ return state.expenses.filter(filter).reduce((s,r)=>s+Number(r.amount||0),0); }

  function load(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map(k=>localStorage.getItem(k)).find(Boolean);
      if(!raw)return structuredClone(defaultData);
      const d=JSON.parse(raw);
      const merged={...structuredClone(defaultData),...d,settings:{...defaultData.settings,...(d.settings||{})}};
      merged.version=APP_VERSION;
      merged.chekiImages=Array.isArray(merged.chekiImages)?merged.chekiImages:[];
      merged.chekiTickets=Array.isArray(merged.chekiTickets)?merged.chekiTickets:[];
      merged.settings.scanDefaults={...defaultData.settings.scanDefaults,...(merged.settings.scanDefaults||{})};
      merged.settings.cloud={...defaultData.settings.cloud,...(merged.settings.cloud||{})};
      merged.settings.milestones=Array.isArray(merged.settings.milestones)?merged.settings.milestones:defaultData.settings.milestones;
      merged.settings.sentNoticeKeys=Array.isArray(merged.settings.sentNoticeKeys)?merged.settings.sentNoticeKeys:[];
      return merged;
    }catch(e){ return structuredClone(defaultData); }
  }
  function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  const MEDIA_DB="live-manager-media-v2";
  const MEDIA_STORE="cheki";
  function mediaDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(MEDIA_DB,1);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(MEDIA_STORE))db.createObjectStore(MEDIA_STORE,{keyPath:"id"}); };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function mediaPut(id,blob,thumb){ const db=await mediaDB(); return new Promise((res,rej)=>{const tx=db.transaction(MEDIA_STORE,"readwrite");tx.objectStore(MEDIA_STORE).put({id,blob,thumb});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}); }
  async function mediaGet(id){ const db=await mediaDB(); return new Promise((res,rej)=>{const r=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)}); }
  async function mediaDelete(id){ const db=await mediaDB(); return new Promise((res,rej)=>{const tx=db.transaction(MEDIA_STORE,"readwrite");tx.objectStore(MEDIA_STORE).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}); }
  async function mediaClear(){ const db=await mediaDB(); return new Promise((res,rej)=>{const tx=db.transaction(MEDIA_STORE,"readwrite");tx.objectStore(MEDIA_STORE).clear();tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)}); }
  async function mediaEntries(){ const db=await mediaDB(); return new Promise((res,rej)=>{const r=db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)}); }
  function blobToDataURL(blob){ return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(blob)}); }
  function dataURLToBlob(data){ const [h,b64]=data.split(',');const mime=(h.match(/data:([^;]+)/)||[])[1]||'image/jpeg';const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);return new Blob([arr],{type:mime}); }
  function commit(msg="保存しました"){ save(); render(); toast(msg); }
  function toast(msg){
    const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.add("hidden"),1700);
  }

  function setRoute(next, nextParams={}){
    route=next; params=nextParams;
    $$(".nav-item[data-route]").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
    render(); window.scrollTo({top:0,behavior:"smooth"});
  }

  function pageTitle(title){ $("#pageTitle").textContent=title; }

  function render(){
    if(route==="home") renderHome();
    else if(route==="lives") renderLives();
    else if(route==="live-detail") renderLiveDetail(params.id);
    else if(route==="calendar") renderCalendar();
    else if(route==="cheki") renderChekiToday();
    else if(route==="cheki-hub") renderChekiHub();
    else if(route==="groups") renderGroups();
    else if(route==="members") renderMembers();
    else if(route==="expenses") renderExpenses();
    else if(route==="search") renderSearch();
    else if(route==="stats") renderStats();
    else if(route==="field") renderFieldMode();
    else if(route==="scan") renderScan();
    else if(route==="album") renderAlbum();
    else if(route==="cheki-storage") renderChekiStorage();
    else if(route==="cheki-tickets") renderChekiTickets();
    else if(route==="import-url") renderUrlImport();
    else if(route==="seat-map") renderSeatMap();
    else if(route==="batch-scan") renderBatchScan();
    else if(route==="integrations") renderIntegrations();
    else if(route==="cloud") renderCloudSync();
    else if(route==="more") renderMore();
    bindRouteLinks();
  }

  function bindRouteLinks(){
    $$("[data-go]").forEach(el=>el.onclick=()=>setRoute(el.dataset.go, el.dataset.id?{id:el.dataset.id}:{}));
  }

  function statusPill(status){
    const cls = status==="当選"||status==="支払い済み"||status==="発券済み" ? "green" :
      status==="落選" ? "red" : status==="抽選待ち"||status==="支払い待ち" ? "yellow" :
      status==="申込済み"||status==="発券待ち" ? "blue" : "";
    return `<span class="pill ${cls}">${safe(status||"未設定")}</span>`;
  }

  function nextLive(){
    return [...state.lives].filter(x=>x.date>=todayStr()).sort((a,b)=>a.date.localeCompare(b.date))[0] || null;
  }

  function liveTicketStatus(live){
    const t=live.tickets||[];
    if(!t.length)return "未申込";
    if(t.some(x=>x.status==="発券済み"))return "発券済み";
    if(t.some(x=>x.status==="支払い済み"))return "支払い済み";
    if(t.some(x=>x.status==="当選"))return "当選";
    if(t.some(x=>x.status==="抽選待ち"))return "抽選待ち";
    if(t.some(x=>x.status==="申込済み"))return "申込済み";
    if(t.every(x=>x.status==="落選"))return "落選";
    return t[t.length-1].status||"未設定";
  }

  function renderHome(){
    pageTitle("ホーム");
    const nl=nextLive();
    const future=state.lives.filter(x=>x.date>=todayStr()).length;
    const thisMonthLives=state.lives.filter(x=>monthKey(x.date)===thisMonth()).length;
    const waiting=state.lives.flatMap(x=>x.tickets||[]).filter(t=>["申込済み","抽選待ち"].includes(t.status)).length;
    const wins=state.lives.flatMap(x=>x.tickets||[]).filter(t=>["当選","支払い待ち","支払い済み","発券待ち","発券済み"].includes(t.status)).length;
    const monthCheki=totalCheki(r=>monthKey(r.date)===thisMonth());
    const monthChekiCost=totalChekiCost(r=>monthKey(r.date)===thisMonth());
    const yearSpend = totalExpense(e=>e.date?.startsWith(thisYear())) + totalChekiCost(r=>r.date?.startsWith(thisYear()));
    const oshi=memberById(state.settings.oshiMemberId);

    main.innerHTML=`
      ${nl?`
      <section class="card hero clickable" data-go="live-detail" data-id="${nl.id}">
        <div class="kicker">NEXT LIVE</div>
        <h2>${safe(nl.title||nl.artist||"ライブ")}</h2>
        <div class="muted">${safe(nl.artist||groupById(nl.groupId)?.name||"")} · ${fmtDate(nl.date)}</div>
        <div style="margin-top:10px">${safe(nl.venue||"会場未設定")}</div>
        <div class="row" style="margin-top:16px">
          <div>${nl.openTime?`開場 ${safe(nl.openTime)}`:""} ${nl.startTime?` / 開演 ${safe(nl.startTime)}`:""}</div>
          <div class="pill">${daysUntil(nl.date)===0?"今日":`あと${daysUntil(nl.date)}日`}</div>
        </div>
      </section>`:`
      <section class="card hero">
        <div class="kicker">NEXT LIVE</div>
        <h2>次のライブを登録しよう</h2>
        <p class="muted">予定・チケット・座席・チェキを、このアプリにまとめられます。</p>
        <button class="btn" data-action="add-live">ライブを追加</button>
      </section>`}

      <div class="section-title"><h2>ダッシュボード</h2><span class="sub">${thisYear()}年</span></div>
      <section class="grid two desktop-4">
        ${metric("今後のライブ",future,"件")}
        ${metric("申込中",waiting,"件")}
        ${metric("当選",wins,"件")}
        ${metric("今月のライブ",thisMonthLives,"件")}
        ${metric("今月のチェキ",monthCheki,"枚")}
        ${metric("今月のチェキ代",yen(monthChekiCost),"")}
        ${metric("今年の推し活",yen(yearSpend),"")}
      </section>

      <div class="section-title"><h2>推し</h2><button class="btn small secondary" data-action="choose-oshi">設定</button></div>
      ${oshi ? renderOshiCard(oshi) : `<section class="card empty"><div class="emoji">💜</div><b>推しを設定すると累計がここに表示されます</b></section>`}

      <div class="section-title"><h2>クイック操作</h2></div>
      <section class="quick-grid">
        <button data-go="field"><span>⚡</span>現場モード</button>
        <button data-go="cheki-hub"><span>📸</span>チェキ管理</button>
        <button data-go="scan"><span>▣</span>チェキスキャン</button>
        <button data-go="batch-scan"><span>▦</span>一括スキャン</button>
        <button data-go="import-url"><span>🔗</span>URL取込</button>
        <button data-go="album"><span>🖼️</span>アルバム</button>
        <button data-go="calendar"><span>🗓️</span>カレンダー</button>
        <button data-go="expenses"><span>💴</span>費用</button>
      </section>`;
    bindActions();
  }

  function metric(label,value,suffix){
    return `<div class="card metric"><div class="label">${label}</div><div class="value">${typeof value==="number"?value:value}${suffix}</div></div>`;
  }

  function renderOshiCard(m){
    const all=totalCheki(r=>r.memberId===m.id);
    const y=totalCheki(r=>r.memberId===m.id&&r.date?.startsWith(thisYear()));
    const mo=totalCheki(r=>r.memberId===m.id&&monthKey(r.date)===thisMonth());
    const milestones=[100,200,300,500,1000,1500,2000];
    const next=milestones.find(x=>x>all)||Math.ceil((all+1)/500)*500;
    return `<section class="card">
      <div class="row">
        <div class="row" style="justify-content:flex-start">
          <div class="avatar member">${safe(m.name.slice(0,1))}</div>
          <div><b>${safe(m.name)}</b><div class="muted small">${safe(groupById(m.groupId)?.name||"")}</div></div>
        </div>
        <span class="pill green">推し</span>
      </div>
      <div class="grid three" style="margin-top:16px">
        <div><div class="big-number">${all}</div><div class="muted small">累計</div></div>
        <div><div class="big-number">${y}</div><div class="muted small">今年</div></div>
        <div><div class="big-number">${mo}</div><div class="muted small">今月</div></div>
      </div>
      <div class="divider"></div>
      <div class="small">NEXT MILESTONE <b>あと ${Math.max(0,next-all)}枚</b> で ${next}枚</div>
      <div class="progress" style="margin-top:8px"><i style="width:${Math.min(100,(all/(next||1))*100)}%"></i></div>
    </section>`;
  }

  function renderLives(){
    pageTitle("ライブ");
    const sorted=[...state.lives].sort((a,b)=>a.date.localeCompare(b.date));
    main.innerHTML=`
      <div class="row"><div class="tabs">
        <button class="tab active" data-filter="future">予定</button>
        <button class="tab" data-filter="pending">申込中</button>
        <button class="tab" data-filter="past">終了</button>
        <button class="tab" data-filter="all">すべて</button>
      </div><button class="btn small" data-action="add-live">＋追加</button></div>
      <section id="liveList" class="card" style="margin-top:12px">${renderLiveList(sorted.filter(x=>x.date>=todayStr()))}</section>`;
    $$(".tab").forEach(t=>t.onclick=()=>{
      $$(".tab").forEach(x=>x.classList.remove("active")); t.classList.add("active");
      const f=t.dataset.filter; let rows=sorted;
      if(f==="future") rows=sorted.filter(x=>x.date>=todayStr());
      if(f==="past") rows=sorted.filter(x=>x.date<todayStr());
      if(f==="pending") rows=sorted.filter(x=>(x.tickets||[]).some(t=>["申込予定","申込済み","抽選待ち"].includes(t.status)));
      $("#liveList").innerHTML=renderLiveList(rows); bindRouteLinks();
    });
    bindActions();
  }

  function renderLiveList(rows){
    if(!rows.length)return `<div class="empty"><div class="emoji">🎫</div>該当するライブがありません</div>`;
    return rows.map(l=>{
      const d=new Date(`${l.date}T00:00:00`);
      return `<div class="list-item clickable" data-go="live-detail" data-id="${l.id}">
        <div class="live-date"><small>${d.getMonth()+1}月</small><b>${d.getDate()}</b></div>
        <div style="min-width:0;flex:1"><b>${safe(l.title||l.artist||"ライブ")}</b><div class="muted small">${safe(l.artist||groupById(l.groupId)?.name||"")} · ${safe(l.venue||"会場未設定")}</div></div>
        ${statusPill(liveTicketStatus(l))}
      </div>`;
    }).join("");
  }

  function renderLiveDetail(id){
    const l=liveById(id); if(!l){setRoute("lives");return}
    pageTitle("ライブ詳細");
    const tickets=l.tickets||[], benefits=l.benefits||[];
    const chekis=state.chekiRecords.filter(r=>r.liveId===id);
    const expenses=state.expenses.filter(e=>e.liveId===id);
    const chekiQty=chekis.reduce((s,r)=>s+Number(r.qty||0),0);
    const chekiCost=chekis.reduce((s,r)=>s+Number(r.qty||0)*Number(r.unitPrice||0),0);
    const exp=expenses.reduce((s,e)=>s+Number(e.amount||0),0);
    main.innerHTML=`
      <section class="card hero">
        <div class="row start">
          <div>
            <div class="kicker">${safe(l.artist||groupById(l.groupId)?.name||"LIVE")}</div>
            <h2>${safe(l.title||"名称未設定")}</h2>
            <div>${fmtDate(l.date)} · ${safe(l.venue||"会場未設定")}</div>
          </div>
          ${statusPill(liveTicketStatus(l))}
        </div>
        <div class="divider"></div>
        <div class="row">
          <div class="muted small">${l.openTime?`開場 ${safe(l.openTime)}`:""} ${l.startTime?` / 開演 ${safe(l.startTime)}`:""}</div>
          <div class="btn-row"><button class="btn small secondary" data-action="edit-live" data-id="${l.id}">編集</button><button class="btn small danger" data-action="delete-live" data-id="${l.id}">削除</button></div>
        </div>
      </section>

      <div class="section-title"><h2>チケット申込</h2><button class="btn small" data-action="add-ticket" data-id="${l.id}">＋申込</button></div>
      <section class="card">${tickets.length?tickets.map(t=>`
        <div class="list-item">
          <div style="flex:1"><b>${safe(t.name||"チケット申込")}</b><div class="muted small">${safe(t.service||"")} ${t.total?` · ${yen(t.total)}`:""}</div></div>
          ${statusPill(t.status)}
          <button class="btn small secondary" data-action="edit-ticket" data-live="${l.id}" data-id="${t.id}">編集</button>
        </div>`).join(""):`<div class="empty">まだ申込情報がありません</div>`}</section>

      <div class="section-title"><h2>座席</h2><button class="btn small secondary" data-action="edit-seat" data-id="${l.id}">設定</button></div>
      <section class="card">
        ${l.seat && Object.values(l.seat).some(Boolean) ? `
        <div class="big-number" style="font-size:20px">${safe([l.seat.level,l.seat.block,l.seat.row,l.seat.number].filter(Boolean).join(" "))}</div>
        <div class="muted small" style="margin-top:6px">${safe([l.seat.gate,l.seat.floor,l.seat.type].filter(Boolean).join(" · "))}</div>` :
        `<div class="empty">座席は未登録です</div>`}
      </section>

      <div class="section-title"><h2>特典会</h2><button class="btn small secondary" data-action="add-benefit" data-id="${l.id}">＋追加</button></div>
      <section class="card">${benefits.length?benefits.map(b=>`
        <div class="list-item"><div><b>${safe(b.name||"特典会")}</b><div class="muted small">${safe(b.time||"")} ${safe(b.place||"")}</div></div></div>`).join(""):`<div class="empty">特典会情報はありません</div>`}</section>

      <div class="section-title"><h2>当日の記録</h2></div>
      <section class="grid two">
        ${metric("チェキ",chekiQty,"枚")}
        ${metric("チェキ代",yen(chekiCost),"")}
        ${metric("その他費用",yen(exp),"")}
        ${metric("当日合計",yen(exp+chekiCost),"")}
      </section>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-action="set-active-live" data-id="${l.id}">この現場を選択</button>
        <button class="btn secondary" data-action="add-expense" data-live="${l.id}">費用を追加</button>
        <button class="btn secondary" data-go="scan">チェキスキャン</button>
        <button class="btn secondary" data-action="google-calendar" data-id="${l.id}">Googleカレンダー</button>
        <button class="btn secondary" data-action="ics-calendar" data-id="${l.id}">.ics保存</button>
        ${isKArena(l.venue)?`<button class="btn secondary" data-action="seat-map-live" data-id="${l.id}">Kアリーナ座席</button>`:""}
      </div>

      ${renderLiveScanProgress(l.id)}

      <div class="section-title"><h2>同行者</h2><button class="btn small secondary" data-action="add-companion" data-id="${l.id}">＋追加</button></div>
      <section class="card">${(l.companions||[]).length?(l.companions||[]).map(c=>`<div class="list-item"><div style="flex:1"><b>${safe(c.name)}</b><div class="muted small">${safe(c.paymentStatus||"未精算")} · ${c.amount?yen(c.amount):"金額未設定"} · ${safe(c.distributionStatus||"分配未設定")}</div></div></div>`).join(""):`<div class="empty">同行者はいません</div>`}</section>

      ${l.memo?`<div class="section-title"><h2>メモ</h2></div><section class="card">${safe(l.memo)}</section>`:""}`;
    bindActions();
  }

  function renderCalendar(){
    pageTitle("カレンダー");
    const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
    const first=new Date(y,m,1), start=new Date(y,m,1-first.getDay());
    const cells=[];
    for(let i=0;i<42;i++){
      const d=new Date(start); d.setDate(start.getDate()+i);
      const ds=localDateStr(d), lives=state.lives.filter(l=>l.date===ds);
      cells.push(`<div class="day ${d.getMonth()!==m?"out":""} ${ds===todayStr()?"today":""}">
        <div class="n">${d.getDate()}</div>
        ${lives.slice(0,2).map(l=>`<span class="event-dot clickable" data-go="live-detail" data-id="${l.id}">${safe(l.title||l.artist||"LIVE")}</span>`).join("")}
        ${lives.length>2?`<span class="event-dot">+${lives.length-2}</span>`:""}
      </div>`);
    }
    main.innerHTML=`
      <div class="row">
        <button class="btn secondary small" id="prevMonth">←</button>
        <h2 style="margin:0">${y}年 ${m+1}月</h2>
        <button class="btn secondary small" id="nextMonth">→</button>
      </div>
      <section class="card" style="margin-top:12px;padding:10px">
        <div class="calendar-head">${["日","月","火","水","木","金","土"].map(x=>`<div>${x}</div>`).join("")}</div>
        <div class="calendar-grid">${cells.join("")}</div>
      </section>`;
    $("#prevMonth").onclick=()=>{calendarCursor=new Date(y,m-1,1);renderCalendar()};
    $("#nextMonth").onclick=()=>{calendarCursor=new Date(y,m+1,1);renderCalendar()};
    bindRouteLinks();
  }

  function renderChekiToday(){
    pageTitle("今日のチェキ");
    const live = liveById(state.settings.activeLiveId) || state.lives.find(l=>l.date===todayStr()) || null;
    const date=todayStr();
    const groupId=live?.groupId||"";
    let members=state.members.filter(m=>!groupId||m.groupId===groupId);
    if(!members.length)members=state.members;
    const dayRecords=state.chekiRecords.filter(r=>r.date===date);
    const total=dayRecords.reduce((s,r)=>s+Number(r.qty||0),0);
    const cost=dayRecords.reduce((s,r)=>s+Number(r.qty||0)*Number(r.unitPrice||0),0);

    main.innerHTML=`
      <section class="card hero">
        <div class="kicker">TODAY</div>
        <h2>${safe(live?.title||"現場未選択")}</h2>
        <div class="muted">${live?safe(live.venue||""):"ライブ詳細から「この現場を選択」を押すと連携できます。"}</div>
        <div class="grid two" style="margin-top:16px">
          <div><div class="big-number">${total}枚</div><div class="muted small">今日のチェキ</div></div>
          <div><div class="big-number">${yen(cost)}</div><div class="muted small">今日のチェキ代</div></div>
        </div>
      </section>
      <div class="section-title"><h2>メンバー</h2><button class="btn small secondary" data-action="cheki-settings">単価設定</button></div>
      <section class="card" id="chekiMembers">
        ${members.length?members.map(m=>renderChekiMember(m,live,date)).join(""):`<div class="empty"><div class="emoji">📸</div>先にメンバーを登録してください</div>`}
      </section>
      <div class="section-title"><h2>今日の内訳</h2></div>
      <section class="card">${renderTodayBreakdown(dayRecords)}</section>`;
    bindActions();
  }

  function renderChekiMember(m,live,date){
    const rec=state.chekiRecords.find(r=>r.date===date && r.memberId===m.id && r.liveId===(live?.id||""));
    const qty=Number(rec?.qty||0), unit=Number(rec?.unitPrice||m.defaultChekiPrice||0);
    const all=totalCheki(r=>r.memberId===m.id);
    return `<div class="list-item cheki-member">
      <div class="avatar member">${safe(m.name.slice(0,1))}</div>
      <div><b>${safe(m.name)}</b><div class="muted small">今日 ${qty}枚 · 累計 ${all}枚 · ${unit?yen(unit)+"/枚":"単価未設定"}</div></div>
      <div class="counter">
        <button class="minus" data-cheki="${m.id}" data-delta="-1">−</button>
        <button class="plus" data-cheki="${m.id}" data-delta="1">+1</button>
        <button class="plus" data-cheki="${m.id}" data-delta="3">+3</button>
        <button class="plus" data-cheki="${m.id}" data-delta="5">+5</button>
      </div>
    </div>`;
  }

  function renderTodayBreakdown(rows){
    const by={};
    rows.forEach(r=>{const k=r.memberId;by[k]=(by[k]||0)+Number(r.qty||0)});
    const entries=Object.entries(by).filter(([,q])=>q>0);
    if(!entries.length)return `<div class="empty">まだチェキ記録がありません</div>`;
    return entries.sort((a,b)=>b[1]-a[1]).map(([id,q])=>`<div class="row list-item"><b>${safe(memberById(id)?.name||"不明")}</b><span>${q}枚</span></div>`).join("");
  }

  function changeCheki(memberId,delta){
    const date=todayStr();
    const live=liveById(state.settings.activeLiveId) || state.lives.find(l=>l.date===date) || null;
    const before=totalCheki(r=>r.memberId===memberId);
    let rec=state.chekiRecords.find(r=>r.date===date && r.memberId===memberId && r.liveId===(live?.id||""));
    const m=memberById(memberId);
    if(!rec){
      rec={id:uid("cheki"),date,liveId:live?.id||"",groupId:m?.groupId||"",memberId,type:"2ショット",qty:0,unitPrice:Number(m?.defaultChekiPrice||0),signed:false,memo:""};
      state.chekiRecords.push(rec);
    }
    rec.qty=Math.max(0,Number(rec.qty||0)+Number(delta));
    const after=totalCheki(r=>r.memberId===memberId);
    save();
    const hit=(state.settings.milestones||[]).find(n=>before<n && after>=n);
    if(hit) showMilestone(m,hit);
    if(route==="field") renderFieldMode(); else renderChekiToday();
  }

  function renderGroups(){
    pageTitle("グループ");
    main.innerHTML=`
      <div class="row"><p class="muted">アーティスト・アイドルグループを管理</p><button class="btn small" data-action="add-group">＋追加</button></div>
      <section class="card">${state.groups.length?state.groups.map(g=>`
        <div class="list-item">
          <div class="avatar">${safe(g.name.slice(0,1))}</div>
          <div style="flex:1"><b>${safe(g.name)}</b><div class="muted small">メンバー ${state.members.filter(m=>m.groupId===g.id).length}人 · 参戦 ${state.lives.filter(l=>l.groupId===g.id).length}件</div></div>
          <button class="btn small secondary" data-action="edit-group" data-id="${g.id}">編集</button>
        </div>`).join(""):`<div class="empty">グループがありません</div>`}</section>`;
    bindActions();
  }

  function renderMembers(){
    pageTitle("メンバー");
    const rows=[...state.members].sort((a,b)=>(groupById(a.groupId)?.name||"").localeCompare(groupById(b.groupId)?.name||""));
    main.innerHTML=`
      <div class="row"><p class="muted">チェキ集計の対象メンバー</p><button class="btn small" data-action="add-member">＋追加</button></div>
      <section class="card">${rows.length?rows.map(m=>`
        <div class="list-item">
          <div class="avatar member">${safe(m.name.slice(0,1))}</div>
          <div style="flex:1"><b>${safe(m.name)}</b> ${state.settings.oshiMemberId===m.id?'<span class="pill green">推し</span>':""}
          <div class="muted small">${safe(groupById(m.groupId)?.name||"未所属")} · 累計 ${totalCheki(r=>r.memberId===m.id)}枚</div></div>
          <button class="btn small secondary" data-action="edit-member" data-id="${m.id}">編集</button>
        </div>`).join(""):`<div class="empty">メンバーがいません</div>`}</section>`;
    bindActions();
  }

  function renderExpenses(){
    pageTitle("費用");
    const categories=["チケット","チェキ／特典会","グッズ","交通費","宿泊","飲食","ロッカー","その他"];
    const year=thisYear();
    const chekiCost=totalChekiCost(r=>r.date?.startsWith(year));
    const by={}; categories.forEach(c=>by[c]=0);
    state.expenses.filter(e=>e.date?.startsWith(year)).forEach(e=>by[e.category]=(by[e.category]||0)+Number(e.amount||0));
    by["チェキ／特典会"]+=chekiCost;
    const total=Object.values(by).reduce((s,n)=>s+n,0);
    main.innerHTML=`
      <section class="card hero"><div class="kicker">${year} PUSH ACTIVITY</div><h2>${yen(total)}</h2><div class="muted">今年の推し活費用</div></section>
      <div class="section-title"><h2>カテゴリ別</h2><button class="btn small" data-action="add-expense">＋費用</button></div>
      <section class="card">${categories.map(c=>`<div class="row list-item"><span>${c}</span><b>${yen(by[c]||0)}</b></div>`).join("")}</section>
      <div class="section-title"><h2>最近の費用</h2></div>
      <section class="card">${[...state.expenses].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(e=>`
        <div class="list-item"><div style="flex:1"><b>${safe(e.category)}</b><div class="muted small">${fmtDate(e.date)} · ${safe(liveById(e.liveId)?.title||e.memo||"")}</div></div><b>${yen(e.amount)}</b></div>`).join("")||`<div class="empty">費用記録はありません</div>`}</section>`;
    bindActions();
  }

  function renderSearch(){
    pageTitle("検索");
    main.innerHTML=`<div class="searchbox"><input id="searchInput" type="search" placeholder="ライブ・会場・メンバー・グループを検索"></div><div id="searchResults"></div>`;
    $("#searchInput").oninput=e=>doSearch(e.target.value);
    doSearch("");
  }

  function doSearch(q){
    const box=$("#searchResults");
    const s=q.trim().toLowerCase();
    if(!s){box.innerHTML=`<section class="card empty"><div class="emoji">🔎</div>キーワードを入力してください</section>`;return}
    const lives=state.lives.filter(l=>[l.title,l.artist,l.venue,l.tour].join(" ").toLowerCase().includes(s));
    const members=state.members.filter(m=>[m.name,groupById(m.groupId)?.name].join(" ").toLowerCase().includes(s));
    const groups=state.groups.filter(g=>g.name.toLowerCase().includes(s));
    box.innerHTML=`
      ${lives.length?`<div class="section-title"><h2>ライブ</h2></div><section class="card">${renderLiveList(lives)}</section>`:""}
      ${members.length?`<div class="section-title"><h2>メンバー</h2></div><section class="card">${members.map(m=>`<div class="list-item"><div class="avatar member">${safe(m.name.slice(0,1))}</div><div><b>${safe(m.name)}</b><div class="muted small">${safe(groupById(m.groupId)?.name||"")}</div></div></div>`).join("")}</section>`:""}
      ${groups.length?`<div class="section-title"><h2>グループ</h2></div><section class="card">${groups.map(g=>`<div class="list-item"><div class="avatar">${safe(g.name.slice(0,1))}</div><b>${safe(g.name)}</b></div>`).join("")}</section>`:""}
      ${!lives.length&&!members.length&&!groups.length?`<section class="card empty">見つかりませんでした</section>`:""}`;
    bindRouteLinks();
  }

  function renderStats(){
    pageTitle("統計");
    const year=thisYear();
    const liveCount=state.lives.filter(l=>l.date?.startsWith(year)).length;
    const chekiCount=totalCheki(r=>r.date?.startsWith(year));
    const chekiCost=totalChekiCost(r=>r.date?.startsWith(year));
    const other=totalExpense(e=>e.date?.startsWith(year));
    const venueMap={}; state.lives.filter(l=>l.date?.startsWith(year)).forEach(l=>{if(l.venue)venueMap[l.venue]=(venueMap[l.venue]||0)+1});
    const topVenue=Object.entries(venueMap).sort((a,b)=>b[1]-a[1])[0];
    const memberRank=state.members.map(m=>({name:m.name,qty:totalCheki(r=>r.memberId===m.id&&r.date?.startsWith(year))})).sort((a,b)=>b.qty-a.qty).filter(x=>x.qty>0);
    main.innerHTML=`
      <section class="grid two">
        ${metric("年間参戦",liveCount,"件")}
        ${metric("年間チェキ",chekiCount,"枚")}
        ${metric("年間チェキ代",yen(chekiCost),"")}
        ${metric("年間推し活",yen(chekiCost+other),"")}
      </section>
      <div class="section-title"><h2>よく行った会場</h2></div>
      <section class="card">${topVenue?`<div class="big-number" style="font-size:20px">${safe(topVenue[0])}</div><div class="muted">${topVenue[1]}回</div>`:`<div class="empty">データがありません</div>`}</section>
      <div class="section-title"><h2>チェキランキング</h2></div>
      <section class="card">${memberRank.length?memberRank.slice(0,10).map((x,i)=>`<div class="row list-item"><b>${i+1}. ${safe(x.name)}</b><span>${x.qty}枚</span></div>`).join(""):`<div class="empty">データがありません</div>`}</section>`;
  }

  function renderMore(){
    pageTitle("その他");
    main.innerHTML=`
      <section class="card stack">
        ${moreLink("⚡","現場モード","field")}
        ${moreLink("📸","チェキ管理","cheki-hub")}
        ${moreLink("▣","チェキスキャン","scan")}
        ${moreLink("🖼️","チェキアルバム","album")}
        ${moreLink("💾","チェキ保存・ストレージ","cheki-storage")}
        ${moreLink("🎟️","チェキ券・特典券","cheki-tickets")}
        ${moreLink("🔗","ライブURL取り込み","import-url")}
        ${moreLink("🪑","座席マップ","seat-map")}
        ${moreLink("▦","複数チェキ一括スキャン","batch-scan")}
        ${moreLink("🔌","外部連携設定","integrations")}
        ${moreLink("☁️","クラウド同期","cloud")}
        ${moreLink("👥","グループ","groups")}
        ${moreLink("🧑","メンバー","members")}
        ${moreLink("💴","費用","expenses")}
        ${moreLink("📊","統計","stats")}
        ${moreLink("🔎","検索","search")}
      </section>
      <div class="section-title"><h2>データ</h2></div>
      <section class="card stack">
        <button class="btn secondary full" data-action="notification-settings">通知を設定する</button>
        <button class="btn secondary full" data-action="export">画像込みバックアップを書き出す</button>
        <button class="btn secondary full" data-action="import">バックアップを読み込む</button>
        <button class="btn danger full" data-action="reset">全データを削除</button>
      </section>
      <div class="section-title"><h2>このバージョン</h2></div>
      <section class="card"><b>Live Manager v5.0</b><p class="muted small" style="margin:8px 0 0">Cheki Studio / 高精度スキャン / チェキ管理・保存 / TicketDive自動連携 / クラウド同期</p></section>`;
    bindActions();
  }

  function moreLink(icon,label,to){return `<button class="row" data-go="${to}" style="border:0;background:transparent;color:var(--text);padding:8px 2px"><span>${icon} ${label}</span><span class="muted">›</span></button>`}

  function bindActions(){
    $$("[data-action]").forEach(el=>{
      el.onclick=()=>{
        const a=el.dataset.action;
        if(a==="quick-add") openQuickAdd();
        if(a==="add-live") openLiveForm();
        if(a==="edit-live") openLiveForm(liveById(el.dataset.id));
        if(a==="delete-live") deleteLive(el.dataset.id);
        if(a==="add-ticket") openTicketForm(el.dataset.id);
        if(a==="edit-ticket") openTicketForm(el.dataset.live,(liveById(el.dataset.live)?.tickets||[]).find(x=>x.id===el.dataset.id));
        if(a==="edit-seat") openSeatForm(el.dataset.id);
        if(a==="add-benefit") openBenefitForm(el.dataset.id);
        if(a==="set-active-live"){state.settings.activeLiveId=el.dataset.id;commit("現場モード対象に設定しました")}
        if(a==="add-group") openGroupForm();
        if(a==="edit-group") openGroupForm(groupById(el.dataset.id));
        if(a==="add-member") openMemberForm();
        if(a==="edit-member") openMemberForm(memberById(el.dataset.id));
        if(a==="choose-oshi") openChooseOshi();
        if(a==="add-expense") openExpenseForm(el.dataset.live||"");
        if(a==="cheki-settings") openChekiSettings();
        if(a==="add-companion") openCompanionForm(el.dataset.id);
        if(a==="add-cheki-ticket") openChekiTicketForm();
        if(a==="edit-cheki-ticket") openChekiTicketForm(state.chekiTickets.find(x=>x.id===el.dataset.id));
        if(a==="notification-settings") openNotificationSettings();
        if(a==="google-calendar") openGoogleCalendar(el.dataset.id);
        if(a==="ics-calendar") exportICS(el.dataset.id);
        if(a==="seat-map-live"){ state.settings.activeLiveId=el.dataset.id; save(); setRoute("seat-map",{id:el.dataset.id}); }
        if(a==="export") exportData();
        if(a==="import") importData();
        if(a==="reset") resetData();
      };
    });
    $$("[data-cheki]").forEach(b=>b.onclick=()=>changeCheki(b.dataset.cheki,Number(b.dataset.delta)));
  }

  function openModal(title,html,onReady){
    modalTitle.textContent=title; modalBody.innerHTML=html; modal.classList.remove("hidden");
    if(onReady)onReady();
  }
  function closeModal(){ modal.classList.add("hidden"); modalBody.innerHTML=""; }
  $$("[data-close-modal]").forEach(x=>x.onclick=closeModal);

  function formValue(form,name){ return form.elements[name]?.value?.trim?.() ?? form.elements[name]?.value ?? ""; }
  function checked(form,name){ return !!form.elements[name]?.checked; }

  function groupOptions(selected=""){return `<option value="">未選択</option>`+state.groups.map(g=>`<option value="${g.id}" ${g.id===selected?"selected":""}>${safe(g.name)}</option>`).join("")}
  function liveOptions(selected=""){return `<option value="">未選択</option>`+[...state.lives].sort((a,b)=>b.date.localeCompare(a.date)).map(l=>`<option value="${l.id}" ${l.id===selected?"selected":""}>${safe(l.date)} ${safe(l.title||l.artist)}</option>`).join("")}

  function openQuickAdd(){
    openModal("クイック追加",`<div class="quick-grid">
      <button data-q="live"><span>🎫</span>ライブ</button>
      <button data-q="cheki"><span>📸</span>チェキ管理</button>
      <button data-q="scan"><span>▣</span>チェキスキャン</button>
      <button data-q="batch"><span>▦</span>一括スキャン</button>
      <button data-q="url"><span>🔗</span>URL取込</button>
      <button data-q="ticket"><span>🎟️</span>チェキ券</button>
      <button data-q="expense"><span>💴</span>費用</button>
      <button data-q="member"><span>🧑</span>メンバー</button>
    </div>`,()=>{
      $$("[data-q]",modalBody).forEach(b=>b.onclick=()=>{
        const q=b.dataset.q; closeModal();
        if(q==="live")openLiveForm();
        if(q==="cheki")setRoute("cheki-hub");
        if(q==="scan")setRoute("scan");
        if(q==="batch")setRoute("batch-scan");
        if(q==="url")setRoute("import-url");
        if(q==="ticket")openChekiTicketForm();
        if(q==="expense")openExpenseForm();
        if(q==="member")openMemberForm();
      });
    });
  }

  function openLiveForm(l=null){
    openModal(l?"ライブを編集":"ライブを追加",`
      <form id="liveForm" class="form">
        <div class="form-grid">
          <div class="field"><label>グループ</label><select name="groupId">${groupOptions(l?.groupId)}</select></div>
          <div class="field"><label>アーティスト名</label><input name="artist" value="${safe(l?.artist||"")}" placeholder="例：iLiFE!"></div>
          <div class="field wide"><label>公演名 *</label><input name="title" required value="${safe(l?.title||"")}" placeholder="例：○○ LIVE TOUR 2026"></div>
          <div class="field"><label>公演日 *</label><input type="date" name="date" required value="${safe(l?.date||todayStr())}"></div>
          <div class="field"><label>会場</label><input name="venue" value="${safe(l?.venue||"")}" placeholder="例：Kアリーナ横浜"></div>
          <div class="field"><label>開場</label><input type="time" name="openTime" value="${safe(l?.openTime||"")}"></div>
          <div class="field"><label>開演</label><input type="time" name="startTime" value="${safe(l?.startTime||"")}"></div>
          <div class="field"><label>終演予定</label><input type="time" name="endTime" value="${safe(l?.endTime||"")}"></div>
          <div class="field"><label>ツアー名</label><input name="tour" value="${safe(l?.tour||"")}"></div>
          <div class="field wide"><label>公式URL</label><input type="url" name="url" value="${safe(l?.url||"")}" placeholder="https://"></div>
          <div class="field wide"><label>メモ</label><textarea name="memo">${safe(l?.memo||"")}</textarea></div>
        </div>
        <div class="grid two">${l?"":`<button class="btn secondary" type="button" id="goUrlImport">URLから自動入力</button>`}<button class="btn full" type="submit">${l?"更新":"登録"}</button></div>
      </form>`,()=>{
        if($("#goUrlImport")) $("#goUrlImport").onclick=()=>{ closeModal(); setRoute("import-url"); };
        $("#liveForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget;
          const obj=l||{id:uid("live"),tickets:[],seat:{},benefits:[]};
          Object.assign(obj,{groupId:formValue(f,"groupId"),artist:formValue(f,"artist"),title:formValue(f,"title"),date:formValue(f,"date"),venue:formValue(f,"venue"),openTime:formValue(f,"openTime"),startTime:formValue(f,"startTime"),endTime:formValue(f,"endTime"),tour:formValue(f,"tour"),url:formValue(f,"url"),memo:formValue(f,"memo")});
          if(!l)state.lives.push(obj); closeModal(); commit(l?"ライブを更新しました":"ライブを登録しました"); setRoute("live-detail",{id:obj.id});
        };
      });
  }

  function deleteLive(id){
    if(!confirm("このライブを削除しますか？関連するチケット・座席・特典会情報も削除されます。"))return;
    state.lives=state.lives.filter(x=>x.id!==id);
    if(state.settings.activeLiveId===id)state.settings.activeLiveId="";
    commit("ライブを削除しました"); setRoute("lives");
  }

  function openTicketForm(liveId,t=null){
    const l=liveById(liveId); if(!l)return;
    const statuses=["申込予定","申込済み","抽選待ち","当選","落選","支払い待ち","支払い済み","発券待ち","発券済み","公演終了"];
    openModal(t?"チケット申込を編集":"チケット申込を追加",`
      <form id="ticketForm" class="form">
        <div class="form-grid">
          <div class="field wide"><label>受付名 *</label><input name="name" required value="${safe(t?.name||"")}" placeholder="例：FC一次先行"></div>
          <div class="field"><label>チケットサービス</label><input name="service" value="${safe(t?.service||"")}" placeholder="TicketDive など"></div>
          <div class="field"><label>状態</label><select name="status">${statuses.map(s=>`<option ${s===(t?.status||"申込済み")?"selected":""}>${s}</option>`).join("")}</select></div>
          <div class="field"><label>申込日</label><input type="date" name="applyDate" value="${safe(t?.applyDate||todayStr())}"></div>
          <div class="field"><label>申込枚数</label><input type="number" min="1" name="qty" value="${safe(t?.qty||1)}"></div>
          <div class="field"><label>チケット料金</label><input type="number" min="0" name="price" value="${safe(t?.price||0)}"></div>
          <div class="field"><label>手数料</label><input type="number" min="0" name="fees" value="${safe(t?.fees||0)}"></div>
          <div class="field"><label>支払総額</label><input type="number" min="0" name="total" value="${safe(t?.total||0)}"></div>
          <div class="field"><label>当落発表日</label><input type="date" name="resultDate" value="${safe(t?.resultDate||"")}"></div>
          <div class="field"><label>支払期限</label><input type="date" name="paymentDue" value="${safe(t?.paymentDue||"")}"></div>
          <div class="field wide"><label>申込URL</label><input type="url" name="url" value="${safe(t?.url||"")}"></div>
          <div class="field wide"><label>メモ</label><textarea name="memo">${safe(t?.memo||"")}</textarea></div>
        </div>
        <button class="btn full" type="submit">保存</button>
      </form>`,()=>{
        $("#ticketForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget;
          const obj=t||{id:uid("ticket")};
          Object.assign(obj,{name:formValue(f,"name"),service:formValue(f,"service"),status:formValue(f,"status"),applyDate:formValue(f,"applyDate"),qty:Number(formValue(f,"qty")||1),price:Number(formValue(f,"price")||0),fees:Number(formValue(f,"fees")||0),total:Number(formValue(f,"total")||0),resultDate:formValue(f,"resultDate"),paymentDue:formValue(f,"paymentDue"),url:formValue(f,"url"),memo:formValue(f,"memo")});
          if(!t)l.tickets.push(obj); closeModal(); commit("チケット申込を保存しました");
        };
      });
  }

  function openSeatForm(liveId){
    const l=liveById(liveId); if(!l)return; const s=l.seat||{};
    openModal("座席を設定",`
      <form id="seatForm" class="form">
        <div class="form-grid">
          <div class="field"><label>座席発表日</label><input type="date" name="announceDate" value="${safe(s.announceDate||"")}"></div>
          <div class="field"><label>ゲート</label><input name="gate" value="${safe(s.gate||"")}"></div>
          <div class="field"><label>LEVEL</label><input name="level" value="${safe(s.level||"")}" placeholder="LEVEL 3"></div>
          <div class="field"><label>階</label><input name="floor" value="${safe(s.floor||"")}"></div>
          <div class="field"><label>ブロック</label><input name="block" value="${safe(s.block||"")}" placeholder="302ブロック"></div>
          <div class="field"><label>列</label><input name="row" value="${safe(s.row||"")}" placeholder="10列"></div>
          <div class="field"><label>番号</label><input name="number" value="${safe(s.number||"")}" placeholder="25番"></div>
          <div class="field"><label>座席種別</label><input name="type" value="${safe(s.type||"")}" placeholder="指定席"></div>
          <div class="field wide"><label>メモ</label><textarea name="memo">${safe(s.memo||"")}</textarea></div>
        </div>
        <button class="btn full" type="submit">保存</button>
      </form>`,()=>{
        $("#seatForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget;
          l.seat={announceDate:formValue(f,"announceDate"),gate:formValue(f,"gate"),level:formValue(f,"level"),floor:formValue(f,"floor"),block:formValue(f,"block"),row:formValue(f,"row"),number:formValue(f,"number"),type:formValue(f,"type"),memo:formValue(f,"memo")};
          closeModal();commit("座席を保存しました");
        };
      });
  }

  function openBenefitForm(liveId){
    const l=liveById(liveId); if(!l)return;
    openModal("特典会を追加",`
      <form id="benefitForm" class="form">
        <div class="field"><label>名称 *</label><input name="name" required placeholder="例：終演後特典会"></div>
        <div class="form-grid">
          <div class="field"><label>時間</label><input name="time" placeholder="19:30〜"></div>
          <div class="field"><label>場所</label><input name="place"></div>
          <div class="field wide"><label>特典内容</label><textarea name="benefit"></textarea></div>
          <div class="field"><label>チェキ券販売時間</label><input name="ticketSaleTime"></div>
          <div class="field"><label>メモ</label><input name="memo"></div>
        </div>
        <button class="btn full" type="submit">登録</button>
      </form>`,()=>{
        $("#benefitForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget;
          l.benefits=l.benefits||[]; l.benefits.push({id:uid("benefit"),name:formValue(f,"name"),time:formValue(f,"time"),place:formValue(f,"place"),benefit:formValue(f,"benefit"),ticketSaleTime:formValue(f,"ticketSaleTime"),memo:formValue(f,"memo")});
          closeModal();commit("特典会を追加しました");
        };
      });
  }

  function openGroupForm(g=null){
    openModal(g?"グループを編集":"グループを追加",`
      <form id="groupForm" class="form">
        <div class="field"><label>グループ名 *</label><input name="name" required value="${safe(g?.name||"")}"></div>
        <div class="field"><label>メモ</label><textarea name="memo">${safe(g?.memo||"")}</textarea></div>
        <button class="btn full" type="submit">保存</button>
      </form>`,()=>{
        $("#groupForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget; const obj=g||{id:uid("group")};
          obj.name=formValue(f,"name");obj.memo=formValue(f,"memo"); if(!g)state.groups.push(obj);
          closeModal();commit("グループを保存しました");
        };
      });
  }

  function openMemberForm(m=null){
    openModal(m?"メンバーを編集":"メンバーを追加",`
      <form id="memberForm" class="form">
        <div class="field"><label>名前 *</label><input name="name" required value="${safe(m?.name||"")}"></div>
        <div class="field"><label>グループ</label><select name="groupId">${groupOptions(m?.groupId)}</select></div>
        <div class="field"><label>メンバーカラー</label><input name="color" value="${safe(m?.color||"")}" placeholder="例：水色"></div>
        <div class="field"><label>チェキ標準単価</label><input type="number" min="0" name="defaultChekiPrice" value="${safe(m?.defaultChekiPrice||0)}" placeholder="2000"></div>
        <div class="field"><label>メモ</label><textarea name="memo">${safe(m?.memo||"")}</textarea></div>
        <button class="btn full" type="submit">保存</button>
      </form>`,()=>{
        $("#memberForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget; const obj=m||{id:uid("member")};
          Object.assign(obj,{name:formValue(f,"name"),groupId:formValue(f,"groupId"),color:formValue(f,"color"),defaultChekiPrice:Number(formValue(f,"defaultChekiPrice")||0),memo:formValue(f,"memo")});
          if(!m)state.members.push(obj);closeModal();commit("メンバーを保存しました");
        };
      });
  }

  function openChooseOshi(){
    if(!state.members.length){toast("先にメンバーを登録してください");return}
    openModal("推しを設定",`<div class="stack">${state.members.map(m=>`<button class="btn ${state.settings.oshiMemberId===m.id?"":"secondary"} full" data-oshi="${m.id}">${safe(m.name)} <span class="small">${safe(groupById(m.groupId)?.name||"")}</span></button>`).join("")}</div>`,()=>{
      $$("[data-oshi]",modalBody).forEach(b=>b.onclick=()=>{state.settings.oshiMemberId=b.dataset.oshi;closeModal();commit("推しを設定しました")});
    });
  }

  function openChekiSettings(){
    if(!state.members.length){toast("メンバーがいません");return}
    openModal("チェキ単価設定",`<form id="chekiPriceForm" class="form">${state.members.map(m=>`<div class="field"><label>${safe(m.name)}</label><input type="number" min="0" name="${m.id}" value="${Number(m.defaultChekiPrice||0)}"></div>`).join("")}<button class="btn full" type="submit">保存</button></form>`,()=>{
      $("#chekiPriceForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;state.members.forEach(m=>m.defaultChekiPrice=Number(formValue(f,m.id)||0));closeModal();commit("単価を保存しました")};
    });
  }

  function openExpenseForm(liveId=""){
    openModal("費用を追加",`
      <form id="expenseForm" class="form">
        <div class="form-grid">
          <div class="field"><label>日付</label><input type="date" name="date" value="${todayStr()}"></div>
          <div class="field"><label>カテゴリ</label><select name="category">${["チケット","グッズ","交通費","宿泊","飲食","ロッカー","その他"].map(c=>`<option>${c}</option>`).join("")}</select></div>
          <div class="field wide"><label>関連ライブ</label><select name="liveId">${liveOptions(liveId)}</select></div>
          <div class="field wide"><label>金額 *</label><input type="number" min="0" name="amount" required></div>
          <div class="field wide"><label>メモ</label><input name="memo"></div>
        </div>
        <button class="btn full" type="submit">登録</button>
      </form>`,()=>{
        $("#expenseForm").onsubmit=e=>{
          e.preventDefault(); const f=e.currentTarget;
          state.expenses.push({id:uid("expense"),date:formValue(f,"date"),category:formValue(f,"category"),liveId:formValue(f,"liveId"),amount:Number(formValue(f,"amount")||0),memo:formValue(f,"memo")});
          closeModal();commit("費用を登録しました");
        };
      });
  }


  function renderLiveScanProgress(liveId){
    const shot=totalCheki(r=>r.liveId===liveId);
    const scanned=state.chekiImages.filter(x=>x.liveId===liveId).length;
    const missing=Math.max(0,shot-scanned);
    const pct=shot?Math.min(100,Math.round(scanned/shot*100)):(scanned?100:0);
    return `<div class="section-title"><h2>チェキ整理</h2><span class="sub">${scanned} / ${shot}</span></div>
      <section class="card">
        <div class="row"><div><b>スキャン済み ${scanned}枚</b><div class="muted small">未スキャン ${missing}枚</div></div><b>${pct}%</b></div>
        <div class="progress" style="margin-top:10px"><i style="width:${pct}%"></i></div>
      </section>`;
  }

  function showMilestone(member,n){
    openModal("🎉 マイルストーン",`<div class="milestone"><div class="milestone-number">${n}</div><h2>${safe(member?.name||"推し")}とのチェキが ${n}枚になりました！</h2><p class="muted">記念の節目に到達しました。</p><button class="btn full" data-close-milestone>閉じる</button></div>`,()=>{$("[data-close-milestone]",modalBody).onclick=closeModal});
  }

  function currentFieldLive(){ return liveById(state.settings.activeLiveId) || state.lives.find(l=>l.date===todayStr()) || nextLive(); }

  function renderFieldMode(){
    pageTitle("現場モード");
    const live=currentFieldLive();
    const date=todayStr();
    const groupId=live?.groupId||"";
    let members=state.members.filter(m=>!groupId||m.groupId===groupId); if(!members.length)members=state.members;
    const rows=state.chekiRecords.filter(r=>r.date===date && (!live||r.liveId===live.id));
    const qty=rows.reduce((s,r)=>s+Number(r.qty||0),0), cost=rows.reduce((s,r)=>s+Number(r.qty||0)*Number(r.unitPrice||0),0);
    const tickets=state.chekiTickets.filter(t=>!live||!t.liveId||t.liveId===live.id);
    const remaining=tickets.reduce((s,t)=>s+Math.max(0,Number(t.purchaseQty||0)-Number(t.usedQty||0)),0);
    main.innerHTML=`
      <section class="card field-hero">
        <div class="kicker">FIELD MODE / TODAY</div>
        <h2>${safe(live?.title||"現場を選択してください")}</h2>
        <div class="muted">${live?`${safe(live.venue||"")} ${live.startTime?`· 開演 ${safe(live.startTime)}`:""}`:"ライブ詳細から「この現場を選択」を押してください"}</div>
        <div class="grid three field-stats">
          <div><div class="big-number">${qty}</div><div class="small muted">チェキ</div></div>
          <div><div class="big-number">${yen(cost)}</div><div class="small muted">チェキ代</div></div>
          <div><div class="big-number">${remaining}</div><div class="small muted">残り券</div></div>
        </div>
      </section>
      <section class="field-actions">
        <button class="field-action primary" data-go="scan"><span>▣</span>スキャン</button>
        <button class="field-action" data-action="add-cheki-ticket"><span>🎟️</span>チェキ券</button>
        <button class="field-action" data-action="add-expense" data-live="${live?.id||""}"><span>💴</span>費用</button>
      </section>
      <div class="section-title"><h2>チェキを追加</h2><button class="btn small secondary" data-action="cheki-settings">単価</button></div>
      <section class="card">${members.length?members.map(m=>renderChekiMember(m,live,date)).join(""):`<div class="empty">メンバーを登録してください</div>`}</section>
      ${live?renderLiveScanProgress(live.id):""}`;
    bindActions(); bindRouteLinks();
  }

  function memberOptions(selected=""){ return `<option value="">メンバーを選択</option>`+state.members.map(m=>`<option value="${m.id}" ${m.id===selected?"selected":""}>${safe(m.name)}${groupById(m.groupId)?` / ${safe(groupById(m.groupId).name)}`:""}</option>`).join(""); }


  function renderChekiHub(){
    pageTitle("チェキ");
    const totalSaved=state.chekiImages.length;
    const todaySaved=state.chekiImages.filter(x=>x.date===todayStr()).length;
    const totalShot=totalCheki();
    const unscanned=Math.max(0,totalShot-totalSaved);
    const favorites=state.chekiImages.filter(x=>x.favorite).length;
    const recent=[...state.chekiImages].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).slice(0,6);
    main.innerHTML=`
      <section class="card hero cheki-studio-hero">
        <div class="kicker">CHEKI STUDIO</div>
        <h2>撮る・整える・残すをひとつに</h2>
        <p class="muted">チェキのスキャン、台形補正、管理、アルバム、端末保存までまとめて使えます。</p>
        <div class="grid two" style="margin-top:16px">
          <button class="btn" data-go="scan">▣ 1枚スキャン</button>
          <button class="btn secondary" data-go="batch-scan">▦ 一括スキャン</button>
        </div>
      </section>
      <section class="grid two desktop-4" style="margin-top:12px">
        ${metric("保存済み",totalSaved,"枚")}
        ${metric("今日の保存",todaySaved,"枚")}
        ${metric("未スキャン目安",unscanned,"枚")}
        ${metric("お気に入り",favorites,"枚")}
      </section>
      <div class="section-title"><h2>チェキメニュー</h2></div>
      <section class="cheki-menu-grid">
        <button data-go="scan"><span>▣</span><b>チェキスキャン</b><small>自動四隅検出・台形補正</small></button>
        <button data-go="album"><span>🖼️</span><b>チェキ管理</b><small>検索・編集・端末保存</small></button>
        <button data-go="cheki"><span>＋</span><b>枚数を記録</b><small>今日誰と何枚撮ったか</small></button>
        <button data-go="batch-scan"><span>▦</span><b>一括スキャン</b><small>複数枚を自動切り分け</small></button>
        <button data-go="cheki-tickets"><span>🎟️</span><b>チェキ券</b><small>購入・使用・残数管理</small></button>
        <button data-go="cheki-storage"><span>💾</span><b>保存とバックアップ</b><small>容量確認・データ保護</small></button>
      </section>
      <div class="section-title"><h2>最近保存したチェキ</h2><button class="btn small secondary" data-go="album">すべて見る</button></div>
      ${recent.length?`<section class="album-grid hub-album">${recent.map(x=>`<button class="album-item" data-image-detail="${x.id}"><div class="album-photo"><img data-hub-thumb="${x.id}" alt="チェキ"><span class="album-no">#${String(x.chekiNo||0).padStart(4,"0")}</span>${x.favorite?'<span class="album-fav">★</span>':""}</div><div class="album-caption"><b>${safe(memberById(x.memberId)?.name||"未設定")}</b><span>${safe(x.date||"")}</span></div></button>`).join("")}</section>`:`<section class="card empty"><div class="emoji">📸</div><b>まだ保存したチェキがありません</b><p>「チェキスキャン」から最初の1枚を保存できます。</p></section>`}
      <section class="notice" style="margin-top:14px">撮影枚数と保存画像数は別管理です。撮影枚数は「枚数を記録」、画像は「チェキスキャン」で保存します。</section>`;
    $$('[data-image-detail]').forEach(b=>b.onclick=()=>openChekiImageDetail(b.dataset.imageDetail));
    loadHubThumbs();
    bindRouteLinks();
  }

  async function loadHubThumbs(){
    for(const img of $$("[data-hub-thumb]")){
      try{
        const rec=await mediaGet(img.dataset.hubThumb);if(!rec)continue;
        const u=URL.createObjectURL(rec.thumb||rec.blob);img.onload=()=>URL.revokeObjectURL(u);img.src=u;
      }catch(e){}
    }
  }

  function formatBytes(n){
    n=Number(n||0);if(n<1024)return `${n} B`;if(n<1024**2)return `${(n/1024).toFixed(1)} KB`;
    if(n<1024**3)return `${(n/1024**2).toFixed(1)} MB`;return `${(n/1024**3).toFixed(2)} GB`;
  }

  async function renderChekiStorage(){
    pageTitle("チェキ保存");
    main.innerHTML=`
      <section class="card hero"><div class="kicker">CHEKI STORAGE</div><h2>大切なチェキを守る</h2><p class="muted">画像はこの端末のブラウザ内ストレージに保存されます。バックアップも定期的に作成してください。</p></section>
      <section class="grid two" style="margin-top:12px">
        ${metric("保存画像",state.chekiImages.length,"枚")}
        <article class="metric"><div class="label">使用容量</div><div class="value" id="chekiStorageUsed">計算中</div><div class="suffix" id="chekiStorageQuota"></div></article>
      </section>
      <section class="card stack" style="margin-top:12px">
        <div class="row"><div><b>端末保存を保護</b><div class="muted small" id="persistStatus">状態を確認中…</div></div><button class="btn small secondary" id="requestPersist">保持をリクエスト</button></div>
        <div class="divider"></div>
        <button class="btn secondary full" data-action="export">画像込みバックアップを書き出す</button>
        <button class="btn secondary full" data-action="import">バックアップを読み込む</button>
        <button class="btn secondary full" id="downloadAllGuide">端末への画像保存について</button>
      </section>
      <section class="warning" style="margin-top:12px">ブラウザの「サイトデータを削除」を行うと、端末内のチェキ画像も消える可能性があります。公開アプリとして使う場合はバックアップまたはクラウド同期を推奨します。</section>`;
    bindActions();
    try{
      if(navigator.storage?.estimate){
        const e=await navigator.storage.estimate();
        $("#chekiStorageUsed").textContent=formatBytes(e.usage||0);
        $("#chekiStorageQuota").textContent=e.quota?` / ${formatBytes(e.quota)}`:"";
      }
      const persisted=navigator.storage?.persisted?await navigator.storage.persisted():false;
      $("#persistStatus").textContent=persisted?"この端末で永続保存が許可されています":"ブラウザ判断で削除される可能性があります";
    }catch(e){$("#persistStatus").textContent="保存状態を取得できませんでした"}
    $("#requestPersist").onclick=async()=>{
      if(!navigator.storage?.persist){toast("このブラウザは永続保存リクエストに対応していません");return}
      const ok=await navigator.storage.persist();toast(ok?"端末保存が保護されました":"ブラウザにより許可されませんでした");renderChekiStorage();
    };
    $("#downloadAllGuide").onclick=()=>openModal("画像を端末へ保存",`<div class="stack"><p>チェキ管理で画像を開き、「画像を端末に保存」を押すとJPEGとして保存できます。</p><button class="btn full" data-go="album">チェキ管理を開く</button></div>`,()=>{modalBody.querySelector("[data-go]").onclick=()=>{closeModal();setRoute("album")}});
  }

  function scanEngineLabel(){
    const d=scanSession.detection;
    if(!d)return "四隅未検出";
    const pct=Math.round((d.confidence||0)*100);
    return `${d.engine||"自動検出"} ${pct}%`;
  }

  function qualityHTML(q){
    if(!q)return `<div class="muted small">補正プレビューを作成すると品質を診断します。</div>`;
    const cls=q.score>=85?"quality-good":q.score>=65?"quality-ok":q.score>=45?"quality-warn":"quality-bad";
    return `<div class="scan-quality ${cls}"><div><span class="quality-score">${q.score}</span><small>/100</small></div><div><b>${safe(q.label)}</b><div class="muted small">${q.warnings.length?safe(q.warnings.join(" / ")):"解像感・明るさとも良好です"}</div></div></div>`;
  }

  function renderScan(){
    pageTitle("チェキスキャン");
    const d=state.settings.scanDefaults||{};
    const active=currentFieldLive();
    const selectedLive=d.liveId||active?.id||"";
    main.innerHTML=`
      <section class="card scan-intro">
        <div><div class="kicker">SMART SCAN</div><b>チェキをきれいにデジタル保存</b><div class="muted small">高精度の四隅検出 → 台形補正 → 画質補正 → 品質チェック → 保存</div></div>
        <label class="btn scan-file-label">${scanSession.sourceCanvas?"別の写真を選ぶ":"カメラ / 写真を選ぶ"}<input id="scanFile" type="file" accept="image/*" capture="environment" hidden></label>
      </section>
      ${scanSession.sourceCanvas?`
      <section class="scan-stepper">
        <span class="active">1 四隅</span><span>2 補正</span><span>3 情報</span><span>4 保存</span>
      </section>
      <section class="card scanner-card">
        <div class="row"><div><b>① 四隅を確認</b><div class="muted small">${safe(scanEngineLabel())}</div></div><div class="btn-row"><button class="btn small secondary" id="autoCorners">高精度で再検出</button><button class="btn small secondary" id="resetCorners">リセット</button></div></div>
        <canvas id="scanCanvas" class="scan-canvas"></canvas>
        <div class="notice">紫の丸をチェキ外枠の四隅へ合わせてください。自動検出がずれても手動で正確に直せます。</div>
      </section>
      <section class="card scan-preview-card" style="margin-top:12px">
        <div class="row"><div><b>② 補正プレビュー</b><div class="muted small">台形・傾き・明るさを補正</div></div><div class="btn-row"><button class="btn small secondary" id="rotateLeft">↶ 90°</button><button class="btn small secondary" id="rotateRight">↷ 90°</button></div></div>
        <div class="scan-preview-wrap"><canvas id="scanPreviewCanvas"></canvas><div id="scanPreviewLoading" class="scan-preview-loading">プレビュー作成中…</div></div>
        <div class="form-grid">
          <div class="field"><label>画質補正</label><select id="scanTone"><option value="natural" ${scanSession.tone==="natural"?"selected":""}>自然に自動補正</option><option value="original" ${scanSession.tone==="original"?"selected":""}>補正なし</option><option value="bright" ${scanSession.tone==="bright"?"selected":""}>明るめ</option></select></div>
          <div class="field"><label>出力比率</label><select id="scanRatio"><option value="cheki" ${scanSession.ratioMode==="cheki"?"selected":""}>チェキ比率 54×86</option><option value="free" ${scanSession.ratioMode==="free"?"selected":""}>検出した比率</option></select></div>
        </div>
        <button class="btn secondary full" id="refreshPreview" style="margin-top:10px">補正プレビューを更新</button>
        <div id="scanQualityBox" style="margin-top:10px">${qualityHTML(scanSession.quality)}</div>
      </section>
      <section class="card" style="margin-top:12px">
        <form id="scanMetaForm" class="form">
          <div class="section-title compact"><h2>③ チェキ情報</h2></div>
          <div class="form-grid">
            <div class="field"><label>メンバー *</label><select name="memberId" required>${memberOptions(d.memberId)}</select><button type="button" class="btn small secondary" id="suggestMember" style="margin-top:6px">AI / イベント候補</button></div>
            <div class="field"><label>イベント</label><select name="liveId">${liveOptions(selectedLive)}</select></div>
            <div class="field"><label>撮影日</label><input type="date" name="date" value="${safe(d.date||todayStr())}"></div>
            <div class="field"><label>種類</label><select name="type">${["2ショット","ソロ","サインあり","サインなし","写メ","その他"].map(x=>`<option ${x===(d.type||"2ショット")?"selected":""}>${x}</option>`).join("")}</select></div>
            <label class="check-row"><input type="checkbox" name="signed" ${d.signed?"checked":""}> サインあり</label>
            <label class="check-row"><input type="checkbox" name="favorite" ${d.favorite?"checked":""}> お気に入り</label>
            <div class="field wide"><label>メモ</label><textarea name="memo" placeholder="ポーズ・衣装・会話メモなど"></textarea></div>
          </div>
          <div class="section-title compact"><h2>④ 保存</h2></div>
          <div class="grid two"><button class="btn" type="submit">保存して管理画面へ</button><button class="btn secondary" type="button" id="saveContinue">保存して次をスキャン</button></div>
        </form>
      </section>`:`
      <section class="card empty scan-empty"><div class="emoji">▣</div><b>チェキを撮影・選択してください</b><p>机や床とチェキの境界が分かるように撮ると自動検出が安定します。少し斜めでも台形補正できます。</p><div class="scan-tips"><span>✓ 影を減らす</span><span>✓ 全体を入れる</span><span>✓ ピントを合わせる</span></div></section>`}`;
    $("#scanFile").onchange=e=>{ const f=e.target.files?.[0]; if(f)loadScanFile(f); };
    if(scanSession.sourceCanvas){
      mountScannerCanvas();
      $("#autoCorners").onclick=()=>autoDetectScanCorners(true);
      $("#resetCorners").onclick=()=>{scanSession.corners=ChekiScanner.defaultCorners(scanSession.sourceCanvas);scanSession.detection={engine:"手動調整",confidence:0};mountScannerCanvas();refreshScanPreview()};
      $("#suggestMember").onclick=()=>suggestMemberForScan($("#scanMetaForm"));
      $("#scanMetaForm").onsubmit=e=>{e.preventDefault();saveScannedCheki(false,e.currentTarget)};
      $("#saveContinue").onclick=()=>saveScannedCheki(true,$("#scanMetaForm"));
      $("#scanTone").onchange=e=>{scanSession.tone=e.target.value;refreshScanPreview()};
      $("#scanRatio").onchange=e=>{scanSession.ratioMode=e.target.value;refreshScanPreview()};
      $("#rotateLeft").onclick=()=>{scanSession.rotation=(scanSession.rotation+270)%360;refreshScanPreview()};
      $("#rotateRight").onclick=()=>{scanSession.rotation=(scanSession.rotation+90)%360;refreshScanPreview()};
      $("#refreshPreview").onclick=()=>refreshScanPreview(true);
      setTimeout(()=>refreshScanPreview(false),30);
    }
  }

  async function loadScanFile(file){
    try{
      const bmp=await createImageBitmap(file);
      const max=2800, scale=Math.min(1,max/Math.max(bmp.width,bmp.height));
      const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(bmp.width*scale));c.height=Math.max(1,Math.round(bmp.height*scale));
      c.getContext("2d").drawImage(bmp,0,0,c.width,c.height); bmp.close?.();
      scanSession={...scanSession,sourceCanvas:c,corners:ChekiScanner.defaultCorners(c),detection:{engine:"検出準備中",confidence:0},rotation:0,quality:null,previewCanvas:null};
      renderScan();
      await autoDetectScanCorners(false);
    }catch(e){console.error(e);alert("画像を読み込めませんでした。別の画像を選択してください。");}
  }

  async function autoDetectScanCorners(showToast=true){
    if(!scanSession.sourceCanvas)return;
    if(showToast)toast("高精度で四隅を検出中…");
    const btn=$("#autoCorners");if(btn){btn.disabled=true;btn.textContent="検出中…"}
    try{
      const result=await ChekiScanner.detectCorners(scanSession.sourceCanvas);
      scanSession.corners=result.corners;scanSession.detection=result;
      renderScan();
      if(showToast)toast(result.confidence>=.55?"四隅を検出しました":"検出結果を確認して四隅を調整してください");
    }catch(e){console.error(e);toast("自動検出できませんでした。四隅を手動調整してください");}
    finally{if(btn){btn.disabled=false;btn.textContent="高精度で再検出"}}
  }

  function mountScannerCanvas(){
    const out=$("#scanCanvas"); if(!out||!scanSession.sourceCanvas)return; const src=scanSession.sourceCanvas;
    const width=Math.min(900,src.width),scale=width/src.width;out.width=width;out.height=Math.round(src.height*scale);const ctx=out.getContext("2d");
    const draw=()=>{
      ctx.clearRect(0,0,out.width,out.height);ctx.drawImage(src,0,0,out.width,out.height);
      const pts=scanSession.corners.map(p=>({x:p.x*scale,y:p.y*scale}));
      ctx.fillStyle="rgba(0,0,0,.28)";ctx.fillRect(0,0,out.width,out.height);
      ctx.save();ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.clip();ctx.drawImage(src,0,0,out.width,out.height);ctx.restore();
      ctx.lineWidth=3;ctx.strokeStyle="#ffffff";ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.stroke();
      pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.fillStyle="rgba(139,92,246,.96)";ctx.fill();ctx.lineWidth=3;ctx.strokeStyle="#fff";ctx.stroke();ctx.fillStyle="#fff";ctx.font="bold 11px system-ui";ctx.fillText(String(i+1),p.x-3,p.y+4)});
    };draw();
    const pos=e=>{const r=out.getBoundingClientRect(),sx=out.width/r.width,sy=out.height/r.height;return{x:(e.clientX-r.left)*sx,y:(e.clientY-r.top)*sy}};
    out.onpointerdown=e=>{const p=pos(e),pts=scanSession.corners.map(q=>({x:q.x*scale,y:q.y*scale}));let best=-1,dd=999;pts.forEach((q,i)=>{const d=Math.hypot(p.x-q.x,p.y-q.y);if(d<dd){dd=d;best=i}});if(dd<44){scanSession.dragIndex=best;out.setPointerCapture(e.pointerId)}};
    out.onpointermove=e=>{if(scanSession.dragIndex<0)return;const p=pos(e),i=scanSession.dragIndex;scanSession.corners[i]={x:Math.max(0,Math.min(src.width,p.x/scale)),y:Math.max(0,Math.min(src.height,p.y/scale))};scanSession.detection={engine:"手動調整",confidence:1};draw()};
    out.onpointerup=()=>{if(scanSession.dragIndex>=0){scanSession.dragIndex=-1;refreshScanPreview()}};
    out.onpointercancel=()=>scanSession.dragIndex=-1;
  }

  async function refreshScanPreview(showToast=false){
    if(!scanSession.sourceCanvas||!scanSession.corners)return;
    const canvas=$("#scanPreviewCanvas"),loading=$("#scanPreviewLoading"),box=$("#scanQualityBox");
    if(!canvas)return;
    if(loading)loading.style.display="grid";
    try{
      const out=await ChekiScanner.crop(scanSession.sourceCanvas,scanSession.corners,{tone:scanSession.tone,ratioMode:scanSession.ratioMode,rotation:scanSession.rotation,maxLongEdge:760});
      scanSession.previewCanvas=out;
      scanSession.quality=ChekiScanner.quality(out,scanSession.detection?.confidence||0);
      canvas.width=out.width;canvas.height=out.height;canvas.getContext("2d").drawImage(out,0,0);
      if(box)box.innerHTML=qualityHTML(scanSession.quality);
      if(showToast)toast("補正プレビューを更新しました");
    }catch(e){console.error(e);if(box)box.innerHTML=`<div class="warning">プレビューを作成できませんでした。四隅を確認してください。</div>`}
    finally{if(loading)loading.style.display="none"}
  }

  async function suggestMemberForScan(form){
    const liveId=formValue(form,"liveId"),live=liveById(liveId),eligible=state.members.filter(m=>!live?.groupId||m.groupId===live.groupId);
    const candidates=(eligible.length?eligible:state.members).slice(0,20);if(!candidates.length){toast("メンバーを登録してください");return}
    const endpoint=(state.settings.aiEndpoint||"").trim();
    if(endpoint&&scanSession.sourceCanvas){try{toast("AI候補を取得中…");const c=document.createElement("canvas"),sc=Math.min(1,640/Math.max(scanSession.sourceCanvas.width,scanSession.sourceCanvas.height));c.width=Math.round(scanSession.sourceCanvas.width*sc);c.height=Math.round(scanSession.sourceCanvas.height*sc);c.getContext("2d").drawImage(scanSession.sourceCanvas,0,0,c.width,c.height);const image=c.toDataURL("image/jpeg",.72);const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image,candidates:candidates.map(m=>({memberId:m.id,name:m.name,group:groupById(m.groupId)?.name||""}))})});const j=await r.json();if(r.ok&&j.memberId&&memberById(j.memberId)){form.elements.memberId.value=j.memberId;toast(`${memberById(j.memberId).name} 候補 ${j.confidence!=null?Math.round(j.confidence*100)+"%":""}`);return}}catch(e){console.warn(e)}}
    const last=state.settings.scanDefaults.memberId,c=candidates.find(m=>m.id===last)||candidates[0];form.elements.memberId.value=c.id;toast(`イベント候補：${c.name}`);
  }

  async function cropScannerBlob(maxLongEdge=1800){
    if(!scanSession.sourceCanvas||!scanSession.corners)throw new Error("no scan");
    const out=await ChekiScanner.crop(scanSession.sourceCanvas,scanSession.corners,{tone:scanSession.tone,ratioMode:scanSession.ratioMode,rotation:scanSession.rotation,maxLongEdge});
    return new Promise((res,rej)=>out.toBlob(b=>b?res(b):rej(new Error("blob failed")),"image/jpeg",.92));
  }

  async function makeThumbnail(blob){const bmp=await createImageBitmap(blob),c=document.createElement("canvas"),max=320,sc=Math.min(1,max/Math.max(bmp.width,bmp.height));c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);bmp.close?.();return new Promise(res=>c.toBlob(res,"image/jpeg",.78));}
  function nextChekiNo(memberId){return Math.max(0,...state.chekiImages.filter(x=>x.memberId===memberId).map(x=>Number(x.chekiNo||0)))+1;}

  async function saveScannedCheki(continueMode,form){
    const memberId=formValue(form,"memberId");if(!memberId){toast("メンバーを選択してください");return}
    const btns=$$("button",form);btns.forEach(b=>b.disabled=true);
    try{
      const blob=await cropScannerBlob(1800),thumb=await makeThumbnail(blob),id=uid("img");
      const meta={id,memberId,liveId:formValue(form,"liveId"),date:formValue(form,"date")||todayStr(),type:formValue(form,"type"),signed:checked(form,"signed"),favorite:checked(form,"favorite"),memo:formValue(form,"memo"),chekiNo:nextChekiNo(memberId),createdAt:new Date().toISOString(),scanEngine:scanSession.detection?.engine||"",scanConfidence:scanSession.detection?.confidence||0,scanQuality:scanSession.quality?.score||null};
      await mediaPut(id,blob,thumb);state.chekiImages.push(meta);state.settings.scanDefaults={memberId:meta.memberId,liveId:meta.liveId,date:meta.date,type:meta.type,signed:meta.signed,favorite:false};save();scanSession={...scanSession,lastMeta:meta,sourceCanvas:null,corners:null,detection:null,rotation:0,quality:null,previewCanvas:null};
      toast(`${memberById(memberId)?.name||"チェキ"} #${String(meta.chekiNo).padStart(4,"0")} を保存しました`);
      if(continueMode)renderScan(); else setRoute("album");
    }catch(e){console.error(e);alert("チェキ画像の保存に失敗しました。");btns.forEach(b=>b.disabled=false)}
  }

  function renderAlbum(){
    pageTitle("チェキ管理");
    const f=albumFilter;
    let rows=[...state.chekiImages];
    const q=(f.q||"").trim().toLocaleLowerCase("ja");
    if(f.memberId)rows=rows.filter(x=>x.memberId===f.memberId);
    if(f.liveId)rows=rows.filter(x=>x.liveId===f.liveId);
    if(f.month)rows=rows.filter(x=>monthKey(x.date)===f.month);
    if(f.signed)rows=rows.filter(x=>String(!!x.signed)===f.signed);
    if(f.favorite)rows=rows.filter(x=>String(!!x.favorite)===f.favorite);
    if(q)rows=rows.filter(x=>[
      memberById(x.memberId)?.name,groupById(memberById(x.memberId)?.groupId)?.name,
      liveById(x.liveId)?.title,x.memo,x.type,x.date
    ].some(v=>String(v||"").toLocaleLowerCase("ja").includes(q)));
    rows.sort((a,b)=>{
      if(f.sort==="oldest")return (a.date||"").localeCompare(b.date||"")||(a.createdAt||"").localeCompare(b.createdAt||"");
      if(f.sort==="number")return Number(b.chekiNo||0)-Number(a.chekiNo||0);
      return (b.date||"").localeCompare(a.date||"")||(b.createdAt||"").localeCompare(a.createdAt||"");
    });
    main.innerHTML=`
      <section class="card hero compact-hero">
        <div class="row"><div><div class="kicker">CHEKI LIBRARY</div><h2>${state.chekiImages.length}枚を保存中</h2><div class="muted small">検索・編集・お気に入り・端末保存</div></div><button class="btn" data-go="scan">＋ スキャン</button></div>
      </section>
      <section class="card album-filters" style="margin-top:12px">
        <div class="field wide"><label>検索</label><input id="albumSearch" value="${safe(f.q)}" placeholder="メンバー・イベント・メモを検索"></div>
        <div class="form-grid" style="margin-top:10px">
          <div class="field"><label>メンバー</label><select id="albumMember">${memberOptions(f.memberId)}</select></div>
          <div class="field"><label>イベント</label><select id="albumLive">${liveOptions(f.liveId)}</select></div>
          <div class="field"><label>年月</label><input id="albumMonth" type="month" value="${safe(f.month)}"></div>
          <div class="field"><label>絞り込み</label><select id="albumFlags"><option value="">すべて</option><option value="signed" ${f.signed==="true"?"selected":""}>サインあり</option><option value="favorite" ${f.favorite==="true"?"selected":""}>お気に入り</option></select></div>
          <div class="field"><label>並び順</label><select id="albumSort"><option value="newest" ${f.sort==="newest"?"selected":""}>新しい順</option><option value="oldest" ${f.sort==="oldest"?"selected":""}>古い順</option><option value="number" ${f.sort==="number"?"selected":""}>チェキ番号順</option></select></div>
        </div>
      </section>
      <div class="section-title"><h2>${rows.length}枚</h2><button class="btn small secondary" data-go="cheki-storage">保存設定</button></div>
      ${rows.length?`<section class="album-grid">${rows.map(x=>`<button class="album-item" data-image-detail="${x.id}"><div class="album-photo"><img data-thumb-id="${x.id}" alt="チェキ ${safe(memberById(x.memberId)?.name||"")}"><span class="album-no">#${String(x.chekiNo||0).padStart(4,"0")}</span>${x.favorite?'<span class="album-fav">★</span>':""}${x.scanQuality?`<span class="album-quality">${x.scanQuality}</span>`:""}</div><div class="album-caption"><b>${safe(memberById(x.memberId)?.name||"未設定")}</b><span>${safe(x.date||"")}${x.type?` · ${safe(x.type)}`:""}</span></div></button>`).join("")}</section>`:`<section class="card empty"><div class="emoji">🖼️</div><b>条件に合うチェキがありません</b><p>検索条件を変えるか、新しいチェキをスキャンしてください。</p></section>`}`;
    const update=()=>{albumFilter.memberId=$("#albumMember").value;albumFilter.liveId=$("#albumLive").value;albumFilter.month=$("#albumMonth").value;albumFilter.sort=$("#albumSort").value;const flag=$("#albumFlags").value;albumFilter.signed=flag==="signed"?"true":"";albumFilter.favorite=flag==="favorite"?"true":"";renderAlbum()};
    ["#albumMember","#albumLive","#albumMonth","#albumFlags","#albumSort"].forEach(s=>$(s)?.addEventListener("change",update));
    let qt;$("#albumSearch").addEventListener("input",e=>{clearTimeout(qt);qt=setTimeout(()=>{albumFilter.q=e.target.value;renderAlbum()},260)});
    $$('[data-image-detail]').forEach(b=>b.onclick=()=>openChekiImageDetail(b.dataset.imageDetail));
    loadAlbumThumbs();bindRouteLinks();
  }

  async function loadAlbumThumbs(){for(const img of $$('[data-thumb-id]')){try{const rec=await mediaGet(img.dataset.thumbId);if(!rec)continue;const u=URL.createObjectURL(rec.thumb||rec.blob);img.onload=()=>URL.revokeObjectURL(u);img.src=u}catch(e){}}}

  async function downloadChekiImage(id){
    const m=state.chekiImages.find(x=>x.id===id),rec=await mediaGet(id);if(!m||!rec)return;
    const member=(memberById(m.memberId)?.name||"cheki").replace(/[\\/:*?"<>|]/g,"_");
    const a=document.createElement("a"),u=URL.createObjectURL(rec.blob);a.href=u;a.download=`${m.date||todayStr()}_${member}_${String(m.chekiNo||0).padStart(4,"0")}.jpg`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);
    toast("画像を端末に保存しました");
  }

  function openChekiEdit(m){
    openModal("チェキ情報を編集",`<form id="chekiEditForm" class="form">
      <div class="form-grid">
        <div class="field"><label>メンバー *</label><select name="memberId" required>${memberOptions(m.memberId)}</select></div>
        <div class="field"><label>イベント</label><select name="liveId">${liveOptions(m.liveId)}</select></div>
        <div class="field"><label>撮影日</label><input type="date" name="date" value="${safe(m.date||todayStr())}"></div>
        <div class="field"><label>種類</label><select name="type">${["2ショット","ソロ","サインあり","サインなし","写メ","その他"].map(x=>`<option ${x===m.type?"selected":""}>${x}</option>`).join("")}</select></div>
        <label class="check-row"><input type="checkbox" name="signed" ${m.signed?"checked":""}> サインあり</label>
        <label class="check-row"><input type="checkbox" name="favorite" ${m.favorite?"checked":""}> お気に入り</label>
        <div class="field wide"><label>メモ</label><textarea name="memo">${safe(m.memo||"")}</textarea></div>
      </div><button class="btn full" type="submit">変更を保存</button></form>`,()=>{
      $("#chekiEditForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;Object.assign(m,{memberId:formValue(f,"memberId"),liveId:formValue(f,"liveId"),date:formValue(f,"date"),type:formValue(f,"type"),signed:checked(f,"signed"),favorite:checked(f,"favorite"),memo:formValue(f,"memo")});save();closeModal();renderAlbum();toast("チェキ情報を更新しました")};
    });
  }

  async function openChekiImageDetail(id){
    const m=state.chekiImages.find(x=>x.id===id);if(!m)return;
    openModal("チェキ詳細",`<div class="cheki-detail">
      <div class="detail-image-wrap"><img id="detailChekiImage" alt="チェキ"></div>
      <div class="card flat">
        <div class="row"><div><b>${safe(memberById(m.memberId)?.name||"未設定")}</b><div class="muted small">${safe(groupById(memberById(m.memberId)?.groupId)?.name||"")}</div></div><span class="pill">#${String(m.chekiNo||0).padStart(4,"0")}</span></div>
        <div class="divider"></div>
        <div class="stack small"><div>撮影日：${fmtDate(m.date)}</div><div>イベント：${safe(liveById(m.liveId)?.title||"未設定")}</div><div>種類：${safe(m.type||"")}</div><div>サイン：${m.signed?"あり":"なし"}</div>${m.scanQuality?`<div>スキャン品質：${m.scanQuality}/100</div>`:""}${m.scanEngine?`<div>検出：${safe(m.scanEngine)}</div>`:""}${m.memo?`<div>メモ：${safe(m.memo)}</div>`:""}</div>
      </div>
      <div class="grid two">
        <button class="btn secondary" id="toggleFavorite">${m.favorite?"★ お気に入り解除":"☆ お気に入り"}</button>
        <button class="btn secondary" id="editChekiMeta">情報を編集</button>
        <button class="btn secondary" id="downloadChekiImage">画像を端末に保存</button>
        <button class="btn danger" id="deleteChekiImage">削除</button>
      </div>
    </div>`,async()=>{
      const rec=await mediaGet(id);if(rec){const u=URL.createObjectURL(rec.blob);const img=$("#detailChekiImage");img.onload=()=>URL.revokeObjectURL(u);img.src=u}
      $("#toggleFavorite").onclick=()=>{m.favorite=!m.favorite;save();closeModal();renderAlbum();toast(m.favorite?"お気に入りに追加しました":"お気に入りを解除しました")};
      $("#editChekiMeta").onclick=()=>{closeModal();openChekiEdit(m)};
      $("#downloadChekiImage").onclick=()=>downloadChekiImage(id);
      $("#deleteChekiImage").onclick=async()=>{if(!confirm("このスキャン画像を削除しますか？"))return;await mediaDelete(id);state.chekiImages=state.chekiImages.filter(x=>x.id!==id);save();closeModal();renderAlbum();toast("画像を削除しました")};
    });
  }

  function renderChekiTickets(){
    pageTitle("チェキ券・特典券");const rows=[...state.chekiTickets].sort((a,b)=>(b.purchaseDate||"").localeCompare(a.purchaseDate||""));const remaining=rows.reduce((s,t)=>s+Math.max(0,Number(t.purchaseQty||0)-Number(t.usedQty||0)),0);
    main.innerHTML=`<section class="card hero"><div class="kicker">CHEKI TICKETS</div><h2>残り ${remaining}枚</h2><div class="muted">購入・使用枚数から自動計算</div></section><div class="section-title"><h2>券一覧</h2><button class="btn small" data-action="add-cheki-ticket">＋追加</button></div><section class="card">${rows.length?rows.map(t=>{const r=Math.max(0,Number(t.purchaseQty||0)-Number(t.usedQty||0));return `<div class="list-item"><div style="flex:1"><b>${safe(t.type||"チェキ券")}</b><div class="muted small">${safe(liveById(t.liveId)?.title||"")} · ${t.expiryDate?`期限 ${safe(t.expiryDate)}`:"期限なし"}</div></div><div style="text-align:right"><b>${r} / ${Number(t.purchaseQty||0)}枚</b><div class="muted small">${yen(Number(t.price||0)*Number(t.purchaseQty||0))}</div></div><button class="btn small secondary" data-action="edit-cheki-ticket" data-id="${t.id}">編集</button></div>`}).join(""):`<div class="empty">チェキ券を登録すると残数を管理できます</div>`}</section>`;bindActions();
  }

  function openChekiTicketForm(t=null){
    openModal(t?"チェキ券を編集":"チェキ券を追加",`<form id="chekiTicketForm" class="form"><div class="form-grid"><div class="field"><label>券種 *</label><input name="type" required value="${safe(t?.type||"チェキ券")}"></div><div class="field"><label>イベント</label><select name="liveId">${liveOptions(t?.liveId||state.settings.activeLiveId)}</select></div><div class="field"><label>購入日</label><input type="date" name="purchaseDate" value="${safe(t?.purchaseDate||todayStr())}"></div><div class="field"><label>対象メンバー</label><select name="memberId">${memberOptions(t?.memberId)}</select></div><div class="field"><label>購入枚数</label><input type="number" min="0" name="purchaseQty" value="${Number(t?.purchaseQty||0)}"></div><div class="field"><label>使用枚数</label><input type="number" min="0" name="usedQty" value="${Number(t?.usedQty||0)}"></div><div class="field"><label>1枚の価格</label><input type="number" min="0" name="price" value="${Number(t?.price||0)}"></div><div class="field"><label>使用期限</label><input type="date" name="expiryDate" value="${safe(t?.expiryDate||"")}"></div><div class="field wide"><label>メモ</label><textarea name="memo">${safe(t?.memo||"")}</textarea></div></div><button class="btn full" type="submit">保存</button></form>`,()=>{$("#chekiTicketForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget,obj=t||{id:uid("ct")};Object.assign(obj,{type:formValue(f,"type"),liveId:formValue(f,"liveId"),memberId:formValue(f,"memberId"),purchaseDate:formValue(f,"purchaseDate"),purchaseQty:Number(formValue(f,"purchaseQty")||0),usedQty:Number(formValue(f,"usedQty")||0),price:Number(formValue(f,"price")||0),expiryDate:formValue(f,"expiryDate"),memo:formValue(f,"memo")});if(!t)state.chekiTickets.push(obj);closeModal();commit("チェキ券を保存しました")}});
  }

  function openCompanionForm(liveId){
    const l=liveById(liveId);if(!l)return;openModal("同行者を追加",`<form id="companionForm" class="form"><div class="field"><label>名前 / ニックネーム *</label><input name="name" required></div><div class="form-grid"><div class="field"><label>支払額</label><input type="number" min="0" name="amount"></div><div class="field"><label>支払い状況</label><select name="paymentStatus"><option>未精算</option><option>支払い済み</option><option>受取済み</option></select></div><div class="field wide"><label>チケット分配状況</label><select name="distributionStatus"><option>未分配</option><option>分配済み</option><option>受取済み</option><option>不要</option></select></div><div class="field wide"><label>メモ</label><textarea name="memo"></textarea></div></div><button class="btn full" type="submit">追加</button></form>`,()=>{$("#companionForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;l.companions=l.companions||[];l.companions.push({id:uid("comp"),name:formValue(f,"name"),amount:Number(formValue(f,"amount")||0),paymentStatus:formValue(f,"paymentStatus"),distributionStatus:formValue(f,"distributionStatus"),memo:formValue(f,"memo")});closeModal();commit("同行者を追加しました")}});
  }


  function isKArena(venue){ return /K\s*アリーナ|Ｋアリーナ|K-Arena/i.test(venue||""); }

  function toCalendarStamp(date,time){
    const d=(date||todayStr()).replaceAll("-","");
    const t=(time||"12:00").replace(":","")+"00";
    return d+"T"+t;
  }
  function googleCalendarUrl(l){
    const start=toCalendarStamp(l.date,l.startTime||l.openTime||"12:00");
    let endTime=l.endTime||"";
    if(!endTime){const [h,m]=(l.startTime||l.openTime||"12:00").split(":").map(Number);endTime=`${String((h+3)%24).padStart(2,"0")}:${String(m||0).padStart(2,"0")}`;}
    const end=toCalendarStamp(l.date,endTime);
    const details=[l.artist||groupById(l.groupId)?.name||"",l.url||"",l.memo||""].filter(Boolean).join("\n");
    const q=new URLSearchParams({action:"TEMPLATE",text:l.title||l.artist||"Live Manager",dates:`${start}/${end}`,stz:"Asia/Tokyo",etz:"Asia/Tokyo",location:l.venue||"",details});
    return `https://calendar.google.com/calendar/r/eventedit?${q.toString()}`;
  }
  function openGoogleCalendar(id){const l=liveById(id);if(!l)return;window.open(googleCalendarUrl(l),"_blank","noopener");}
  function icsEscape(v){return String(v||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
  function exportICS(id){
    const l=liveById(id);if(!l)return;
    const start=toCalendarStamp(l.date,l.startTime||l.openTime||"12:00");
    let end=l.endTime||"";if(!end){const [h,m]=(l.startTime||l.openTime||"12:00").split(":").map(Number);end=`${String((h+3)%24).padStart(2,"0")}:${String(m||0).padStart(2,"0")}`;}
    const dtend=toCalendarStamp(l.date,end);const desc=[l.artist||"",l.url||"",l.memo||""].filter(Boolean).join("\n");
    const text=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Live Manager//JP","CALSCALE:GREGORIAN","BEGIN:VEVENT",`UID:${l.id}@live-manager.local`, `DTSTART;TZID=Asia/Tokyo:${start}`,`DTEND;TZID=Asia/Tokyo:${dtend}`,`SUMMARY:${icsEscape(l.title||l.artist||"ライブ")}`,`LOCATION:${icsEscape(l.venue||"")}`,`DESCRIPTION:${icsEscape(desc)}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
    const blob=new Blob([text],{type:"text/calendar;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${(l.title||"live").replace(/[\\/:*?\"<>|]/g,"_")}.ics`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("カレンダーファイルを保存しました");
  }

  function normalizeJPDate(text){
    const m=String(text||"").match(/(20\d{2})[\/年.\-]\s*(\d{1,2})[\/月.\-]\s*(\d{1,2})日?/);
    return m?`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`:"";
  }
  function normalizeImportUrl(raw){
    let u=String(raw||"").trim();
    if(!u)return "";
    if(!/^https?:\/\//i.test(u))u="https://"+u;
    try{
      const x=new URL(u);
      x.hash="";
      return x.toString();
    }catch(e){return ""}
  }
  function isTicketDiveUrl(url){
    try{const u=new URL(url);return /(^|\.)ticketdive\.com$/i.test(u.hostname) && /^\/event\//i.test(u.pathname)}catch(e){return false}
  }
  function cleanReaderText(text){
    let t=String(text||"").replace(/\r/g,"");
    // Jina Readerのメタ情報は本文解析時には除外する。
    t=t.replace(/^Title:\s*.*$/gmi,"")
       .replace(/^URL Source:\s*.*$/gmi,"")
       .replace(/^Published Time:\s*.*$/gmi,"")
       .replace(/^Warning:\s*.*$/gmi,"")
       .replace(/^Markdown Content:\s*$/gmi,"")
       .replace(/^={3,}\s*$/gm,"")
       .replace(/\n{3,}/g,"\n\n");
    return t.trim();
  }
  function cleanTitleCandidate(line){
    let v=String(line||"").trim();
    v=v.replace(/^#+\s*/,"").trim();
    // Markdownの太字・引用など、タイトルそのものに不要な装飾だけ外す。
    v=v.replace(/^>\s*/,"").replace(/^\*\*(.*?)\*\*$/,"$1").trim();
    return v;
  }
  function isNoiseTitleLine(line){
    const v=cleanTitleCandidate(line);
    if(!v)return true;
    const ignored=/^(TICKET INFO|販売情報|詳細|枚数|申し込みをする|お支払い方法|販売終了したチケットを表示|ログイン|新規登録|トップ|イベント一覧)$/i;
    if(ignored.test(v))return true;
    if(/^(公演日時|開場時刻|開演時刻|会場|出演|販売中|販売前|販売終了|チケット|料金|注意事項|お知らせ)\s*[:：]?/i.test(v))return true;
    // Jina Readerが画像をMarkdownとして先頭に出すケースを完全に除外。
    if(/^!\s*\[.*?\]\s*\(/i.test(v))return true;
    if(/^\[?https?:\/\//i.test(v))return true;
    if(/_next\/image\?|storage\.googleapis\.com|\.(?:webp|png|jpe?g|gif)(?:\?|$)/i.test(v))return true;
    if(/^Image\s*\d*\s*[:：]/i.test(v)||/背景画像/i.test(v))return true;
    // Markdownリンクだけの行もタイトル候補にしない。
    if(/^\[[^\]]+\]\([^\)]+\)$/i.test(v))return true;
    return false;
  }
  function extractReaderMetaTitle(text){
    const m=String(text||"").match(/^Title:\s*(.+)$/mi);
    if(!m)return "";
    let v=cleanTitleCandidate(m[1]).replace(/\s*[|｜]\s*TicketDive\s*$/i,"").trim();
    if(!v || /^TicketDive$/i.test(v) || isNoiseTitleLine(v))return "";
    return v;
  }
  function findEventTitleFromLines(lines){
    const cleaned=lines.map(cleanTitleCandidate);
    // TicketDiveでは公演タイトルの後に公演日時等が続くことが多い。
    // 「公演日時」より前にある直近の有効行を優先すると背景画像Markdownを避けやすい。
    const infoIndex=cleaned.findIndex(v=>/^(公演日時|開場時刻|開演時刻|会場|出演)\s*[:：]?/i.test(v));
    if(infoIndex>0){
      for(let i=infoIndex-1;i>=Math.max(0,infoIndex-12);i--){
        const v=cleaned[i];
        if(!isNoiseTitleLine(v))return v.replace(/\s*[|｜]\s*TicketDive\s*$/i,"").trim();
      }
    }
    for(const v0 of cleaned){
      const v=v0.replace(/\s*[|｜]\s*TicketDive\s*$/i,"").trim();
      if(!isNoiseTitleLine(v))return v;
    }
    return "";
  }
  function isPerformerLabelToken(value){
    const v=String(value||"")
      .replace(/^[#>*_\s]+|[#>*_\s]+$/g,"")
      .replace(/[：:]\s*$/,"")
      .trim();

    // 「出演者名」などの項目ラベルだけを出演者として数えない。
    // 完全一致に限定し、実際のグループ名を誤って消さないようにする。
    return /^(?:アーティスト(?:名|情報)?|出演(?:者|者名|者情報|アーティスト|アーティスト名|グループ|グループ名)?|ARTISTS?|PERFORMERS?|CAST)$/i.test(v);
  }

  function cleanPerformerCandidate(line){
    let v=String(line||"").trim();
    if(!v)return "";
    // Markdown画像は出演者ではないので削除。リンクは表示名だけ残す。
    v=v.replace(/!\[[^\]]*\]\([^)]*\)/g,"")
       .replace(/cite[^†]+†([^]+)/g,"$1")
       .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
       .replace(/<[^>]+>/g," ")
       .replace(/^#+\s*/,"")
       .replace(/^>\s*/,"")
       .replace(/^\*\*(.*?)\*\*$/,"$1")
       .replace(/^__(.*?)__$/,"$1")
       .replace(/^\s*(?:[-*+・•]|\d+[.)])\s*/,"")
       .replace(/\s+/g," ")
       .trim();
    return v;
  }
  function isPerformerStopLine(line){
    const v=cleanPerformerCandidate(line);
    if(!v)return false;
    return /^(?:公演日時|開場時刻|開演時刻|会場|TICKET INFO|販売情報|販売中|販売前|販売終了|チケット|料金|注意事項|お知らせ|詳細|公演に関するお問合せ先|申し込みに関する注意事項|チケット受け取り方法|お支払い方法|申し込みをする)/i.test(v);
  }

  function stripLeadingPerformerLabels(value){
    let v=String(value||"").trim();
    for(let i=0;i<6;i++){
      const before=v;
      v=v.replace(/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|PERFORMERS?|ARTISTS?|CAST)\s*[:：\-–—]?\s*/i,"").trim();
      if(v===before)break;
    }
    return v;
  }

  function extractTicketDiveArtistLinks(html){
    const source=String(html||"");
    if(!source.trim())return [];
    const out=[];

    try{
      const doc=new DOMParser().parseFromString(source,"text/html");

      // TicketDiveの出演者は /artist/... のリンクとしてSSR HTMLに含まれることがある。
      for(const a of doc.querySelectorAll('a[href*="/artist/"]')){
        const name=cleanPerformerCandidate(
          a.textContent||a.getAttribute("aria-label")||a.getAttribute("title")||""
        );
        if(name)out.push(name);
      }

      // 「出演」ラベル付近のartistリンクも優先して拾う。
      for(const el of doc.querySelectorAll("body *")){
        const own=cleanPerformerCandidate(
          el.childNodes.length===1 ? el.textContent : ""
        );
        if(!/^(?:出演|出演者|出演アーティスト|ARTISTS?|PERFORMERS?|CAST)$/i.test(own))continue;

        const scope=el.parentElement||el;
        for(const a of scope.querySelectorAll('a[href*="/artist/"]')){
          const name=cleanPerformerCandidate(a.textContent||"");
          if(name)out.push(name);
        }

        let sib=el.nextElementSibling, hops=0;
        while(sib && hops<5){
          if(sib.querySelectorAll){
            for(const a of sib.querySelectorAll('a[href*="/artist/"]')){
              const name=cleanPerformerCandidate(a.textContent||"");
              if(name)out.push(name);
            }
          }
          if(/TICKET INFO|販売情報|詳細/.test(sib.textContent||""))break;
          sib=sib.nextElementSibling;
          hops++;
        }
      }
    }catch(e){}

    // Next.jsのescaped HTML断片も拾う。
    const decoded=source
      .replace(/\\u003c/gi,"<")
      .replace(/\\u003e/gi,">")
      .replace(/\\u0026/gi,"&")
      .replace(/\\"/g,'"')
      .replace(/&quot;/g,'"')
      .replace(/&#34;/g,'"');

    const rx=/<a\b[^>]*href=["'][^"']*\/artist\/[^"']+["'][^>]*>([\s\S]{0,300}?)<\/a>/gi;
    let m;
    while((m=rx.exec(decoded))){
      const name=cleanPerformerCandidate(m[1]);
      if(name)out.push(name);
    }

    return uniqCleanPerformerNames(out);
  }

  function splitPerformerNames(value){
    let v=String(value||"")
      .replace(/!\[[^\]]*\]\([^)]*\)/g,"")
      .replace(/cite[^†]+†([^]+)/g,"$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
      .replace(/<[^>]+>/g," ")
      .replace(/\s+(?:TICKET INFO|販売情報|詳細)\s*$/i,"")
      .trim();
    if(!v)return [];

    const names=v.split(/\s*(?:\/|／|、|,|\n|\||・)\s*/)
      .map(cleanPerformerCandidate)
      .map(stripLeadingPerformerLabels)
      .filter(Boolean)
      .filter(x=>!isPerformerLabelToken(x))
      .filter(x=>!isPerformerStopLine(x))
      .filter(x=>!/^https?:\/\//i.test(x))
      .filter(x=>!/_next\/image\?|storage\.googleapis\.com/i.test(x))
      .filter(x=>!/^(?:Image\s*\d*\s*[:：]|背景画像)/i.test(x));
    return [...new Set(names)];
  }
  function extractPerformerNames(text){
    const raw=String(text||"").replace(/\r/g,"");
    const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);
    const labelOnly=/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|ARTISTS?|PERFORMERS?|CAST)\s*[:：]?\s*$/i;
    const inlineLabel=/^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|ARTISTS?|PERFORMERS?|CAST)\s*[:：]?\s*(.+)$/i;

    for(let i=0;i<lines.length;i++){
      // 表形式「| 出演 | [iON!](...) / ... |」にも対応。
      const tableLine=lines[i].replace(/^\|\s*/,"").replace(/\s*\|$/,"");
      const tableCells=tableLine.split("|").map(cleanPerformerCandidate).filter(Boolean);
      if(tableCells.length>=2 && /^(?:アーティスト名|アーティスト|出演アーティスト名|出演アーティスト|出演者名|出演者|出演|ARTISTS?|PERFORMERS?|CAST)$/i.test(tableCells[0])){
        const found=splitPerformerNames(tableCells.slice(1).join(" / "));
        if(found.length)return found;
      }

      const line=cleanPerformerCandidate(lines[i]);
      // 「出演者」のようなラベルだけの行は、短い「出演」+「者」と誤認しないよう先に判定する。
      if(labelOnly.test(line)){
        const parts=[];
        // Jina Readerでは出演者が1名ずつMarkdownリンクの別行になる場合がある。
        for(let j=i+1;j<Math.min(lines.length,i+24);j++){
          const nextRaw=lines[j];
          const next=cleanPerformerCandidate(nextRaw);
          if(!next)continue;
          if(isPerformerStopLine(next) || labelOnly.test(next) || inlineLabel.test(next))break;
          if(/^https?:\/\//i.test(next))continue;
          if(/_next\/image\?|storage\.googleapis\.com/i.test(next))continue;
          if(/^(?:Image\s*\d*\s*[:：]|背景画像)/i.test(next))continue;
          parts.push(nextRaw);
        }
        const found=splitPerformerNames(parts.join("\n"));
        if(found.length)return found;
        continue;
      }

      const inline=line.match(inlineLabel);
      if(inline){
        const found=splitPerformerNames(inline[1]);
        if(found.length)return found;
      }
    }

    // 「出演[iON!](...) / ...」のように改行や装飾で通常行判定が崩れた場合。
    const markdownCompact=raw.match(/(?:^|\n|\s|\|)(?:出演アーティスト名|出演アーティスト|出演者|出演|ARTISTS?|CAST)\s*[:：]?\s*([\s\S]{1,1600}?)(?=\n\s*(?:公演日時|開場時刻|開演時刻|会場|TICKET INFO|販売情報|詳細|公演に関するお問合せ先|申し込みに関する注意事項|チケット受け取り方法)|$)/i);
    if(markdownCompact){
      const found=splitPerformerNames(markdownCompact[1]);
      if(found.length)return found;
    }

    return [];
  }
  function parseEventText(text,url=""){
    const source=String(text||"");
    const metaTitle=extractReaderMetaTitle(source);
    const raw=cleanReaderText(source);
    const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);
    const title=metaTitle||findEventTitleFromLines(lines);
    const dateSource=(raw.match(/公演日時\s*[:：]?\s*([^\n]+)/i)||[])[1]||raw;
    const date=normalizeJPDate(dateSource);
    let openTime="",startTime="";
    const pair=raw.match(/開場時刻\s*[:：]?\s*(\d{1,2}:\d{2})\s*[\/／]\s*開演時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)
      || raw.match(/(?:OPEN|開場)\s*[:：]?\s*(\d{1,2}:\d{2})[^\n]{0,30}?(?:START|開演)\s*[:：]?\s*(\d{1,2}:\d{2})/i);
    if(pair){openTime=pair[1]||"";startTime=pair[2]||"";}
    if(!openTime)openTime=(raw.match(/開場時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)||[])[1]||"";
    if(!startTime)startTime=(raw.match(/開演時刻\s*[:：]?\s*(\d{1,2}:\d{2})/i)||[])[1]||"";
    const venue=((raw.match(/(?:^|\n)\s*会場\s*[:：]?\s*([^\n]+)/i)||[])[1]||"").trim();
    const performerNames=extractPerformerNames(raw);
    const performers=performerNames.join(" / ");
    // ライブ管理側の「アーティスト名」には、TicketDiveの出演欄をそのまま反映する。
    // 複数出演イベントでも先頭1組だけにせず、全出演者を保持する。
    const artist=performers;
    return {title,date,openTime,startTime,venue,artist,performers,performerNames,url};
  }
  async function fetchTextWithTimeout(target, options={}, timeout=12000){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),timeout);
    try{
      const r=await fetch(target,{...options,signal:ctl.signal,cache:"no-store"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const ct=r.headers.get("content-type")||"";
      if(ct.includes("application/json")){
        const j=await r.json();
        if(typeof j.body==="string")return j.body;
        if(typeof j.content==="string")return j.content;
        return JSON.stringify(j);
      }
      return await r.text();
    }finally{clearTimeout(timer)}
  }
  function configuredProxyTarget(url){
    const proxy=(state.settings.urlProxy||"").trim();
    if(!proxy)return "";
    return proxy.includes("{url}")?proxy.replace("{url}",encodeURIComponent(url)):proxy+(proxy.includes("?")?"&":"?")+"url="+encodeURIComponent(url);
  }

  function normalizeWorkerEvent(data,url=""){
    const src=(data&&data.event)||data||{};
    const names=uniqCleanPerformerNames(
      Array.isArray(src.performerNames)?src.performerNames:
      Array.isArray(src.performers)?src.performers:
      typeof src.performers==="string"?splitPerformerNames(src.performers):
      typeof src.artist==="string"?splitPerformerNames(src.artist):[]
    );
    return {
      title:String(src.title||"").trim(),
      date:String(src.date||"").trim(),
      openTime:String(src.openTime||"").trim(),
      startTime:String(src.startTime||"").trim(),
      venue:String(src.venue||"").trim(),
      performerNames:names,
      performers:names.join(" / "),
      artist:names.join(" / "),
      url:String(src.url||url||"").trim()
    };
  }

  function automaticTicketDiveApiTarget(url){
    // Cloudflare Pages版では同一オリジンの Functions API を設定不要で利用する。
    if(!/^https?:$/i.test(location.protocol))return "";
    const api=new URL("./api/ticketdive",location.href);
    api.searchParams.set("url",url);
    return api.toString();
  }

  function publicTicketDiveWorkerTarget(url){
    const api=new URL(PUBLIC_TICKETDIVE_WORKER_URL);
    api.searchParams.set("url",url);
    return api.toString();
  }

  function ticketDiveApiTargets(url){
    const out=[
      {target:publicTicketDiveWorkerTarget(url),label:"TicketDive自動連携"}
    ];
    const auto=automaticTicketDiveApiTarget(url);
    if(auto && auto!==out[0].target)out.push({target:auto,label:"内蔵TicketDive API"});
    return out;
  }

  async function requestTicketDiveJsonApi(target,url,label){
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(new Error("TicketDive API timeout")),12000);
    try{
      const r=await fetch(target,{
        method:"GET",
        headers:{Accept:"application/json"},
        signal:ctl.signal,
        cache:"no-store"
      });
      if(!r.ok)throw new Error(`${label} HTTP ${r.status}`);
      const ct=r.headers.get("content-type")||"";
      if(!ct.includes("application/json")){
        throw new Error(`${label}がJSONを返していません`);
      }
      const j=await r.json();
      if(j&&j.ok===false)throw new Error(j.error||`${label}で取得できませんでした`);
      const event=normalizeWorkerEvent(j,url);
      if(!hasUsefulEventData(event))throw new Error(`${label}から公演情報を取得できませんでした`);
      return {
        event,
        text:String(j.text||"").slice(0,50000),
        method:String(j.source||label),
        cached:!!j.cached
      };
    }finally{
      clearTimeout(timer);
    }
  }

  async function fetchTicketDiveWorkerData(url){
    const targets=ticketDiveApiTargets(url);
    if(!targets.length)return null;

    let lastErr=null;
    for(const item of targets){
      try{
        return await requestTicketDiveJsonApi(item.target,url,item.label);
      }catch(e){
        lastErr=e;
        console.warn(`[${item.label}]`,e);
      }
    }
    if(lastErr)throw lastErr;
    return null;
  }
  function hasConfiguredTicketDiveWorker(){
    return !!PUBLIC_TICKETDIVE_WORKER_URL;
  }

  function isGitHubPages(){
    return /(?:^|\.)github\.io$/i.test(location.hostname);
  }

  async function fetchExternalText(url){
    const normalized=normalizeImportUrl(url);
    if(!normalized)throw new Error("URLが正しくありません");
    const attempts=[];

    // v4ではTicketDiveの設定済みWorkerはJSON専用APIとして別処理する。
    // ここでは、Worker未設定またはWorker失敗時の公開ページフォールバックだけを扱う。
    if(!isTicketDiveUrl(normalized)){
      const custom=configuredProxyTarget(normalized);
      if(custom)attempts.push({name:"設定済みプロキシ",target:custom,options:{headers:{Accept:"text/html,text/plain,application/json"}}});
    }

    // TicketDiveは静的ホスティングからの直接fetchがCORSで失敗しやすいため、
    // 公開イベントURLのみJina Readerを自動フォールバックとして使用する。
    if(isTicketDiveUrl(normalized)){
      attempts.push({name:"TicketDive Reader",target:`https://r.jina.ai/${normalized}`,options:{headers:{Accept:"text/plain,text/markdown,*/*"}}});
      attempts.push({name:"TicketDive直接取得",target:normalized,options:{mode:"cors",headers:{Accept:"text/html,text/plain,*/*"}}});
    }else{
      attempts.push({name:"直接取得",target:normalized,options:{mode:"cors",headers:{Accept:"text/html,text/plain,*/*"}}});
    }

    let lastErr=null;
    for(const a of attempts){
      try{
        const body=await fetchTextWithTimeout(a.target,a.options,14000);
        if(!String(body||"").trim())throw new Error("空のレスポンス");
        return {body,method:a.name};
      }catch(e){lastErr=e;console.warn(`[URL import] ${a.name} failed`,e)}
    }
    throw lastErr||new Error("取得に失敗しました");
  }
  function mergeEventData(primary, extra){
    const a=primary||{}, b=extra||{};
    const performerNames=(a.performerNames&&a.performerNames.length)?a.performerNames:(b.performerNames||[]);
    const performers=(a.performers||"")||(b.performers||"")||performerNames.join(" / ");
    return {
      ...b,...a,
      title:a.title||b.title||"",
      date:a.date||b.date||"",
      openTime:a.openTime||b.openTime||"",
      startTime:a.startTime||b.startTime||"",
      venue:a.venue||b.venue||"",
      performerNames,
      performers,
      artist:(a.artist||"")||performers||(b.artist||"")
    };
  }

  const PERFORMER_CACHE_KEY="live-manager-ticketdive-performer-cache-v1";
  const PERFORMER_CACHE_TTL=6*60*60*1000;

  function loadPerformerCache(){
    try{
      const raw=localStorage.getItem(PERFORMER_CACHE_KEY);
      return raw?JSON.parse(raw):{};
    }catch(e){return {}}
  }

  function getCachedPerformers(url){
    try{
      const cache=loadPerformerCache();
      const item=cache[url];
      if(!item||!Array.isArray(item.names)||!item.names.length)return [];
      if(Date.now()-Number(item.savedAt||0)>PERFORMER_CACHE_TTL)return [];
      return uniqCleanPerformerNames(item.names);
    }catch(e){return []}
  }

  function cachePerformers(url,names){
    const clean=uniqCleanPerformerNames(names);
    if(!url||!clean.length)return;
    try{
      const cache=loadPerformerCache();
      cache[url]={names:clean,savedAt:Date.now()};
      const keys=Object.keys(cache)
        .sort((a,b)=>Number(cache[b]?.savedAt||0)-Number(cache[a]?.savedAt||0))
        .slice(0,80);
      const trimmed={};
      keys.forEach(k=>trimmed[k]=cache[k]);
      localStorage.setItem(PERFORMER_CACHE_KEY,JSON.stringify(trimmed));
    }catch(e){}
  }

  function firstNonNull(promises){
    return new Promise(resolve=>{
      let pending=promises.length;
      if(!pending){resolve(null);return}
      let settled=false;
      promises.forEach(p=>Promise.resolve(p).then(value=>{
        if(settled)return;
        if(value){
          settled=true;
          resolve(value);
          return;
        }
        pending--;
        if(pending===0){settled=true;resolve(null)}
      }).catch(()=>{
        if(settled)return;
        pending--;
        if(pending===0){settled=true;resolve(null)}
      }));
    });
  }

  async function tryPerformerAttempt(a,url,timeout=6500){
    try{
      const body=await fetchTextWithTimeout(a.target,a.options,timeout);
      if(!String(body||"").trim())return null;
      const d=parseEventSource(body,url);
      const anchorNames=extractTicketDiveArtistLinks(body);
      if(anchorNames.length)fillPerformerData(d,anchorNames);
      d.performerNames=uniqCleanPerformerNames(
        (d.performerNames||[]).map(stripLeadingPerformerLabels)
      );
      d.performers=d.performerNames.join(" / ");
      d.artist=d.performers;
      if(!d.performerNames.length)return null;
      return {body,method:a.name,data:d};
    }catch(e){
      console.warn(`[出演者高速取得] ${a.name} failed`,e);
      return null;
    }
  }

  async function fetchTicketDivePerformerFallback(url){
    const attempts=[];
    const custom=configuredProxyTarget(url);
    if(custom)attempts.push({
      name:"設定済みプロキシ（出演者）",
      target:custom,
      options:{headers:{Accept:"text/html,text/plain,application/json,*/*"}}
    });

    attempts.push(
      {
        name:"TicketDive HTML（corsproxy.io）",
        target:`https://corsproxy.io/?${encodeURIComponent(url)}`,
        options:{headers:{Accept:"text/html,application/xhtml+xml,*/*"}}
      },
      {
        name:"TicketDive HTML（CodeTabs）",
        target:`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        options:{headers:{Accept:"text/html,application/xhtml+xml,*/*"}}
      },
      {
        name:"TicketDive HTML（isomorphic-git）",
        target:`https://cors.isomorphic-git.org/${url}`,
        options:{headers:{Accept:"text/html,application/xhtml+xml,*/*"}}
      },
      {
        name:"TicketDive Reader再取得",
        target:`https://r.jina.ai/${url}`,
        options:{headers:{
          Accept:"application/json,text/plain,text/markdown,*/*",
          "X-No-Cache":"true",
          "X-Engine":"cf-browser-rendering",
          "X-Retain-Images":"false",
          "X-Timeout":"6"
        }}
      },
      {
        name:"TicketDive HTML補完",
        target:`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        options:{headers:{Accept:"text/html,text/plain,*/*"}}
      }
    );

    // 以前は上から1件ずつ待っていたため非常に遅かった。
    // v3.9では全候補を同時に開始し、出演者が取れた最初の1件を即採用する。
    return await firstNonNull(
      attempts.map(a=>tryPerformerAttempt(a,url,6500))
    );
  }

  function uniqCleanPerformerNames(names){
    const bad=/^(?:TicketDive|TICKET INFO|販売情報|詳細|公演日時|開場時刻|開演時刻|会場|申し込み|お支払い方法|注意事項|アーティスト|アーティスト名|出演|出演者|出演者名|出演アーティスト|出演アーティスト名|ARTIST|ARTISTS|PERFORMER|PERFORMERS|CAST)$/i;
    return [...new Set((names||[])
      .map(x=>cleanPerformerCandidate(x))
      .map(x=>x.replace(/\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))))
      .map(x=>x.trim())
      .filter(Boolean)
      .filter(x=>x.length<=100)
      .filter(x=>!bad.test(x))
      .filter(x=>!isPerformerLabelToken(x))
      .filter(x=>!/https?:\/\//i.test(x))
      .filter(x=>!/(?:タイムテーブル|変更|キャンセル|払い戻し|注意事項|主催|制作|お問い合わせ|チケット)/i.test(x))
    )];
  }

  function collectNamedValues(value,out,depth=0){
    if(depth>6 || value==null)return;
    if(typeof value==="string"){
      const v=value.trim();
      if(v && v.length<=100)out.push(v);
      return;
    }
    if(Array.isArray(value)){
      value.forEach(x=>collectNamedValues(x,out,depth+1));
      return;
    }
    if(typeof value==="object"){
      if(typeof value.name==="string")out.push(value.name);
      if(typeof value.title==="string" && Object.keys(value).some(k=>/(?:artist|perform|cast)/i.test(k)))out.push(value.title);
      for(const [k,v] of Object.entries(value)){
        if(/^(?:name|title)$/i.test(k))continue;
        if(/(?:performers?|artists?|casts?|出演)/i.test(k))collectNamedValues(v,out,depth+1);
      }
    }
  }

  function extractStructuredPerformerNames(html){
    const source=String(html||"");
    if(!source.trim())return [];
    const out=[...extractTicketDiveArtistLinks(source)];
    try{
      const doc=new DOMParser().parseFromString(source,"text/html");
      const scripts=[...doc.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]')];
      for(const s of scripts){
        const txt=(s.textContent||"").trim();
        if(!txt)continue;
        try{
          const data=JSON.parse(txt);
          const walk=(node,depth=0)=>{
            if(depth>10||node==null)return;
            if(Array.isArray(node)){node.forEach(x=>walk(x,depth+1));return}
            if(typeof node!=="object")return;
            for(const [k,v] of Object.entries(node)){
              if(/^(?:performer|performers|artist|artists|cast|casts|出演者|出演)$/i.test(k)){
                collectNamedValues(v,out,0);
              }
              if(typeof v==="object"&&v!==null)walk(v,depth+1);
            }
          };
          walk(data);
        }catch(e){}
      }
    }catch(e){}

    // Next.jsのself.__next_f.push(...)やエスケープ済みJSON断片にも対応。
    const decoded=source
      .replace(/&quot;/g,'"').replace(/&#34;/g,'"')
      .replace(/\\&quot;/g,'"').replace(/\\"/g,'"')
      .replace(/\\\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));

    const arrayPatterns=[
      /["'](?:performers?|artists?|casts?)["']\s*:\s*\[([\s\S]{1,5000}?)\]/gi,
      /["'](?:出演者|出演)["']\s*:\s*\[([\s\S]{1,5000}?)\]/gi
    ];
    for(const rx of arrayPatterns){
      let m;
      while((m=rx.exec(decoded))){
        const block=m[1];
        const nameRx=/["'](?:name|displayName|artistName)["']\s*:\s*["']([^"'\\]{1,100})["']/gi;
        let n;
        while((n=nameRx.exec(block)))out.push(n[1]);
        if(!/["'](?:name|displayName|artistName)["']\s*:/.test(block)){
          block.split(",").forEach(x=>{
            const mm=x.trim().match(/^["']([^"']{1,100})["']$/);
            if(mm)out.push(mm[1]);
          });
        }
      }
    }

    // 単一 performer / artist object
    const singleRx=/["'](?:performer|artist)["']\s*:\s*\{[\s\S]{0,1000}?["']name["']\s*:\s*["']([^"'\\]{1,100})["']/gi;
    let sm;
    while((sm=singleRx.exec(decoded)))out.push(sm[1]);

    return uniqCleanPerformerNames(out);
  }

  function fillPerformerData(d,names){
    const clean=uniqCleanPerformerNames(names);
    if(!clean.length)return d;
    d.performerNames=clean;
    d.performers=clean.join(" / ");
    d.artist=d.performers;
    return d;
  }

  function extractPerformersFromSearchSource(raw,baseData={},eventUrl=""){
    let text=String(raw||"");
    if(!text.trim())return [];
    if(/^\s*</.test(text))text=htmlToText(text);
    text=text.replace(/\r/g,"").replace(/\u00a0/g," ");

    const title=String(baseData.title||"").trim();
    const venue=String(baseData.venue||"").trim();
    let slug="";
    try{slug=new URL(eventUrl).pathname.split("/").filter(Boolean).pop()||""}catch(e){}

    const candidates=[];
    const rx=/(?:出演アーティスト名|出演アーティスト|出演者|出演)\s*[:：]?\s*([^\n]{1,350})/gi;
    let m;
    while((m=rx.exec(text))){
      let value=m[1]
        .split(/(?:TICKET INFO|販売情報|公演日時|開場時刻|開演時刻|会場|詳細|申込受付中|受付終了|TicketDive)/i)[0]
        .trim();
      if(!value || /^(?:者)?[・、]?(?:タイムテーブル|変更|キャンセル)/i.test(value))continue;
      if(/(?:変更|キャンセル|払い戻し|注意事項)/i.test(value))continue;
      const names=uniqCleanPerformerNames(
        splitPerformerNames(value).map(stripLeadingPerformerLabels)
      );
      if(!names.length)continue;

      const start=Math.max(0,m.index-700), end=Math.min(text.length,m.index+m[0].length+700);
      const around=text.slice(start,end);
      let score=0;
      if(title && around.includes(title))score+=6;
      if(venue && around.includes(venue))score+=4;
      if(slug && around.includes(slug))score+=5;
      if(/ticketdive\.com\/event/i.test(around))score+=4;
      if(baseData.date){
        const ds=String(baseData.date).replace(/-/g,"/");
        if(around.includes(ds) || around.includes(ds.replace(/^(\d{4})\/0?(\d+)\/0?(\d+)$/,"$1/$2/$3")))score+=3;
      }
      candidates.push({names,score,index:m.index});
    }

    if(!candidates.length)return [];
    candidates.sort((a,b)=>b.score-a.score || a.index-b.index);
    return uniqCleanPerformerNames(candidates[0].names);
  }

  function buildTicketDiveSearchQuery(url,d={}){
    let slug="";
    try{slug=new URL(url).pathname.split("/").filter(Boolean).pop()||""}catch(e){}
    const parts=[];
    if(d.title)parts.push(`"${d.title}"`);
    if(d.venue)parts.push(`"${d.venue}"`);
    if(d.date)parts.push(d.date.replace(/-/g,"/"));
    if(slug)parts.push(`"${slug}"`);
    parts.push("TicketDive 出演");
    return parts.join(" ");
  }

  async function fetchTicketDivePerformerSearchFallback(url,baseData={}){
    const q=buildTicketDiveSearchQuery(url,baseData);
    const google=`https://www.google.com/search?hl=ja&num=10&q=${encodeURIComponent(q)}`;
    const bing=`https://www.bing.com/search?setlang=ja-JP&q=${encodeURIComponent(q)}`;
    const yahoo=`https://search.yahoo.co.jp/search?p=${encodeURIComponent(q)}`;

    const attempts=[
      {
        name:"検索インデックス（Reader）",
        target:`https://r.jina.ai/https://www.google.com/search?hl=ja&q=${encodeURIComponent(q)}`,
        options:{headers:{Accept:"text/plain,text/markdown,*/*","X-No-Cache":"true"}}
      },
      {
        name:"検索インデックス（Google）",
        target:`https://api.allorigins.win/raw?disableCache=true&url=${encodeURIComponent(google)}`,
        options:{headers:{Accept:"text/html,text/plain,*/*"}}
      },
      {
        name:"検索インデックス（Bing）",
        target:`https://api.allorigins.win/raw?disableCache=true&url=${encodeURIComponent(bing)}`,
        options:{headers:{Accept:"text/html,text/plain,*/*"}}
      },
      {
        name:"検索インデックス（Yahoo!）",
        target:`https://api.allorigins.win/raw?disableCache=true&url=${encodeURIComponent(yahoo)}`,
        options:{headers:{Accept:"text/html,text/plain,*/*"}}
      }
    ];

    const jobs=attempts.map(async a=>{
      try{
        const body=await fetchTextWithTimeout(a.target,a.options,6500);
        if(!String(body||"").trim())return null;
        const names=extractPerformersFromSearchSource(body,baseData,url);
        if(!names.length)return null;
        return {body,method:a.name,data:fillPerformerData({...baseData},names)};
      }catch(e){
        console.warn(`[出演者検索高速補完] ${a.name} failed`,e);
        return null;
      }
    });

    return await firstNonNull(jobs);
  }

  function ensurePerformerLineInManualText(text,d){
    let out=String(text||"").trim();
    const performers=(d?.performers||"").trim();
    if(!performers)return out;
    if(/(?:^|\n)\s*(?:出演アーティスト名|出演アーティスト|出演者|出演)\s*[:：]?\s*[^\n]+/i.test(out))return out;
    const line=`出演：${performers}`;
    if(/(?:^|\n)\s*会場\s*[:：]?[^\n]*/i.test(out)){
      out=out.replace(/((?:^|\n)\s*会場\s*[:：]?[^\n]*\n?)/i,`$1${line}\n`);
    }else if(/(?:^|\n)\s*TICKET INFO/i.test(out)){
      out=out.replace(/((?:^|\n)\s*TICKET INFO)/i,`\n${line}\n$1`);
    }else{
      out=`${out}\n\n${line}`.trim();
    }
    return out;
  }
  function renderPerformerFetchStatus(d,method=""){
    const box=$("#performerImportStatus");if(!box)return;
    const names=Array.isArray(d?.performerNames)?d.performerNames:[];
    if(names.length){
      box.className="notice";
      box.innerHTML=`<b>出演者取得：</b>${safe(names.join(" / "))} <span class="pill">${names.length}組</span>${method?` <span class="pill green">${safe(method)}</span>`:""}`;
    }else{
      box.className="warning";
      box.innerHTML=`<b>出演者：</b>自動連携から取得できませんでした。しばらくしてから再試行してください。基本情報は取得できている場合があります。`;
    }
    box.style.display="block";
  }
  function htmlToText(html){const doc=new DOMParser().parseFromString(html,"text/html");return (doc.body?.innerText||doc.documentElement?.textContent||html).replace(/\n{3,}/g,"\n\n");}
  function parseEventSource(raw,url=""){
    if(!String(raw||"").trim().startsWith("<")) return parseEventText(raw,url);
    const doc=new DOMParser().parseFromString(raw,"text/html"),text=(doc.body?.innerText||doc.body?.textContent||"").replace(/\n{3,}/g,"\n\n"),d=parseEventText(text,url);
    const h1=doc.querySelector("h1")?.textContent?.trim(),title=doc.querySelector('meta[property="og:title"]')?.content?.trim()||h1||doc.title?.replace(/\s*\|\s*TicketDive.*$/i,"").trim();
    if(title)d.title=title.replace(/\s*\|\s*TicketDive\s*$/i,"").trim();

    // 本文に出演欄が無くても、TicketDiveの /artist/... リンクや
    // Next.js / JSON-LD / hydration data に残っていれば直接拾う。
    const structured=extractStructuredPerformerNames(raw);
    if(structured.length){
      const textNames=uniqCleanPerformerNames(d.performerNames||[]);
      const merged=uniqCleanPerformerNames([...structured,...textNames]);
      fillPerformerData(d,merged);
    }
    return d;
  }
  function hasUsefulEventData(d){return !!(d&&(d.title||d.date||d.venue||d.openTime||d.startTime||d.artist));}
  function renderImportPreview(d,method=""){
    const box=$("#importPreview");if(!box)return;
    const performerCount=Array.isArray(d.performerNames)?d.performerNames.length:(d.performers?d.performers.split(/\s*\/\s*/).filter(Boolean).length:0);
    box.innerHTML=`<div class="card flat"><div class="row"><div class="kicker">解析結果</div>${method?`<span class="pill green">${safe(method)}</span>`:""}</div><div class="stack small" style="margin-top:8px"><div><b>公演名：</b>${safe(d.title||"未検出")}</div><div><b>アーティスト名：</b>${safe(d.artist||"未検出")} ${performerCount>1?`<span class="pill">${performerCount}組</span>`:""}</div><div><b>日付：</b>${safe(d.date||"未検出")}</div><div><b>会場：</b>${safe(d.venue||"未検出")}</div><div><b>開場/開演：</b>${safe(d.openTime||"-")} / ${safe(d.startTime||"-")}</div><div><b>出演：</b>${safe(d.performers||"未検出")}</div></div><button class="btn full" style="margin-top:12px" id="createImportedLive">この内容でライブ登録</button></div>`;
    $("#createImportedLive").onclick=()=>createImportedLive(d);
  }
  function createImportedLive(d){
    if(!hasUsefulEventData(d)){toast("登録できる情報がありません");return}
    const matchedGroup=(d.performerNames||[]).length===1?state.groups.find(g=>g.name.trim().toLowerCase()===(d.performerNames[0]||"").trim().toLowerCase()):null;
    const obj={id:uid("live"),tickets:[],seat:{},benefits:[],companions:[],groupId:matchedGroup?.id||"",artist:d.artist||d.performers||"",performers:d.performers||"",performerNames:Array.isArray(d.performerNames)?d.performerNames:[],title:d.title||"ライブ",date:d.date||todayStr(),venue:d.venue||"",openTime:d.openTime||"",startTime:d.startTime||"",endTime:"",tour:"",url:d.url||"",memo:d.url&&/ticketdive\.com/i.test(d.url)?"TicketDive URLから登録":""};state.lives.push(obj);save();toast(`ライブを登録しました${obj.performerNames.length?`（出演者${obj.performerNames.length}組を取得）`:""}`);setRoute("live-detail",{id:obj.id});
  }
  function renderUrlImport(){
    pageTitle("ライブURL取り込み");
    main.innerHTML=`<section class="card hero"><div class="kicker">URL IMPORT</div><h2>TicketDiveのURLから公演情報を取り込む</h2><p class="muted">TicketDiveは自動連携API経由で公演名・出演者・日付・会場・開場/開演をまとめて取得します。利用者によるWorker URLの設定は不要です。</p></section>
      <section class="card" style="margin-top:12px"><div class="form"><div class="field"><label>TicketDiveイベントURL</label><input id="importUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://ticketdive.com/event/..."></div><div class="grid two"><button class="btn" id="fetchImport">URLから取得</button><button class="btn secondary" id="openImportUrl">ページを開く</button></div><div id="importStatus" class="notice" style="display:none"></div><div id="performerImportStatus" class="notice" style="display:none;margin-top:8px"></div><div class="divider"></div><details><summary class="small" style="cursor:pointer;font-weight:800">取得できない場合の手動解析</summary><div class="field" style="margin-top:12px"><label>ページ本文を貼り付け</label><textarea id="importText" style="min-height:180px" placeholder="TicketDiveのイベントページ本文を貼り付け"></textarea></div><button class="btn secondary full" id="parseImportText">貼り付け内容を解析</button></details></div></section>
      <div id="importPreview" style="margin-top:12px"></div>
      <section class="notice" style="margin-top:12px">通常はTicketDive自動連携を使用します。「TicketDive Reader」と表示された場合は自動連携が一時的に利用できず、基本情報取得へフォールバックしています。</section>`;
    const status=$("#importStatus"),btn=$("#fetchImport"),urlInput=$("#importUrl");
    function setStatus(msg,type="info"){
      status.style.display="block";status.className=type==="error"?"warning":"notice";status.textContent=msg;
    }
    async function runFetch(){
      const u=normalizeImportUrl(urlInput.value);
      if(!u){setStatus("正しいURLを入力してください。","error");return}
      if(!isTicketDiveUrl(u)){setStatus("TicketDiveのイベントURLではありません。その他サイトは直接取得できる場合のみ対応します。","error")}
      btn.disabled=true;btn.textContent="取得中…";setStatus("公演情報を取得しています…");
      try{
        let result=null;
        let raw="";
        let d=null;
        let performerMethod="";
        let supplementalRaw="";

        // v4: TicketDiveは専用Cloudflare Workerを最優先。
        // Worker側で公演情報と出演者を完成済みJSONへして返すため、
        // ブラウザ側で複数プロキシを巡回する必要がない。
        if(isTicketDiveUrl(u)){
          setStatus("TicketDive APIへ接続しています…");
          try{
            const workerResult=await fetchTicketDiveWorkerData(u);
            if(workerResult){
              d=workerResult.event;
              raw=workerResult.text||"";
              performerMethod=workerResult.method+(workerResult.cached?"（キャッシュ）":"");
              result={body:raw,method:performerMethod};
              if((d.performerNames||[]).length)cachePerformers(u,d.performerNames);
              renderPerformerFetchStatus(d,performerMethod);
            }
          }catch(workerError){
            console.warn("[TicketDive API]",workerError);
            const timeoutLike = workerError?.name==="AbortError" || /abort|timeout/i.test(String(workerError?.message||workerError||""));
            setStatus(timeoutLike
              ? "TicketDive APIの応答が時間内に返らなかったため、基本情報だけReaderで取得します。"
              : `TicketDive APIを利用できません：${workerError?.message||workerError}`,"error");
          }
        }

        // Worker未設定・失敗時のみ旧公開取得を使う。
        if(!d){
          result=await fetchExternalText(u);
          raw=result.body;
          d=parseEventSource(raw,u);
          if(!hasUsefulEventData(d))throw new Error("公演情報を検出できませんでした");
          performerMethod=result.method;
          renderPerformerFetchStatus(d,result.method);
          if(isTicketDiveUrl(u) && (d.performerNames||[]).length){
            cachePerformers(u,d.performerNames);
          }
        }

        // v3.9: 同じURLで以前取得した出演者があれば即時利用。
        if(isTicketDiveUrl(u) && !(d.performerNames||[]).length){
          const cached=getCachedPerformers(u);
          if(cached.length){
            fillPerformerData(d,cached);
            performerMethod="高速キャッシュ";
            renderPerformerFetchStatus(d,performerMethod);
          }
        }

        // v3.9: HTML/埋め込みデータ系と検索インデックス系を同時に開始。
        // どちらかが出演者を取得できた時点ですぐ先へ進む。
        if(isTicketDiveUrl(u) && !(d.performerNames||[]).length && !isGitHubPages() && !hasConfiguredTicketDiveWorker()){
          setStatus(`出演者を公開経路で補完しています…`);
          const fast=await firstNonNull([
            fetchTicketDivePerformerFallback(u),
            fetchTicketDivePerformerSearchFallback(u,d)
          ]);
          if(fast){
            d=mergeEventData(d,fast.data);
            performerMethod=fast.method;
            supplementalRaw=fast.body||"";
            cachePerformers(u,d.performerNames||[]);
          }
          renderPerformerFetchStatus(d,performerMethod);
        }

        // 取得経路ごとの差を吸収し、ラベルだけの文字列を最終結果から除外。
        d.performerNames=uniqCleanPerformerNames(
          (d.performerNames||[]).map(stripLeadingPerformerLabels)
        );
        d.performers=d.performerNames.join(" / ");
        d.artist=d.performers;

        let text=raw
          ? (raw.trim().startsWith("<")?htmlToText(raw):cleanReaderText(raw))
          : [
              d.title,
              d.date?`公演日時 ${d.date}`:"",
              (d.openTime||d.startTime)?`開場時刻 ${d.openTime||"-"} / 開演時刻 ${d.startTime||"-"}`:"",
              d.venue?`会場 ${d.venue}`:"",
              d.performers?`出演 ${d.performers}`:""
            ].filter(Boolean).join("\n");
        if(supplementalRaw && (d.performerNames||[]).length){
          const supplementText=supplementalRaw.trim().startsWith("<")?htmlToText(supplementalRaw):cleanReaderText(supplementalRaw);
          if(!/(?:^|\n)\s*(?:出演アーティスト名|出演アーティスト|出演者|出演)\s*[:：]?/i.test(text) && supplementText){
            const perfBlock=(supplementText.match(/(?:^|\n)\s*(?:出演アーティスト名|出演アーティスト|出演者|出演)\s*[:：]?[\s\S]{0,1200}?(?=\n\s*(?:公演日時|開場時刻|開演時刻|会場|TICKET INFO|販売情報|詳細)|$)/i)||[])[0]||"";
            if(perfBlock)text=`${text}\n\n${perfBlock}`;
          }
        }
        text=ensurePerformerLineInManualText(text,d);
        $("#importText").value=text.slice(0,50000);
        renderImportPreview(d,(d.performerNames||[]).length?`${result.method} + 出演者補完` : result.method);
        setStatus((d.performerNames||[]).length?`取得成功：出演者 ${(d.performerNames||[]).length}組を含めて取得しました`:`公演基本情報は取得できましたが、出演者取得APIが使われていないため出演者は取得できませんでした。画面に「TicketDive Reader」と表示される場合はAPI未接続です。`,(d.performerNames||[]).length?"info":"error");
        toast((d.performerNames||[]).length?"TicketDiveの出演者まで取得しました":"出演者以外の公演情報を取得しました");
      }catch(e){
        console.warn(e);
        setStatus(`取得に失敗しました：${e?.message||"不明なエラー"}。下の「手動解析」も利用できます。`,"error");
        toast("取得できませんでした");
      }finally{btn.disabled=false;btn.textContent="URLから取得"}
    }
    $("#openImportUrl").onclick=()=>{const u=normalizeImportUrl(urlInput.value);if(u)window.open(u,"_blank","noopener")};
    $("#parseImportText").onclick=()=>{const d=parseEventText($("#importText").value,normalizeImportUrl(urlInput.value));renderPerformerFetchStatus(d,"貼り付け解析");renderImportPreview(d,"貼り付け解析");};
    $("#fetchImport").onclick=runFetch;
    urlInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();runFetch()}});
    urlInput.addEventListener("paste",()=>setTimeout(()=>{
      if(isTicketDiveUrl(normalizeImportUrl(urlInput.value))){
        setStatus("TicketDive URLを認識しました。自動取得を開始します…");
        runFetch();
      }
    },300));
  }

  function seatPositionEstimate(level,row,seat){
    const lvl=Number(String(level||"").match(/\d+/)?.[0]||3),r=Math.max(1,Number(row||1)),n=Math.max(1,Number(seat||1));
    const maxSeat=lvl===7?320:lvl===5?300:280;
    const x=Math.max(7,Math.min(93,7+(n/maxSeat)*86));
    const base=lvl===3?42:lvl===5?32:22;const y=Math.max(15,Math.min(83,base+r*1.55));return{x,y,lvl};
  }
  function renderKArenaSchematic(level,row,seat){const p=seatPositionEstimate(level,row,seat);return `<div class="seatmap-wrap"><div class="seat-stage">STAGE</div><div class="seat-tier tier7">LEVEL 7</div><div class="seat-tier tier5">LEVEL 5</div><div class="seat-tier tier3">LEVEL 3</div><div class="seat-pin" style="left:${p.x}%;top:${p.y}%"></div></div>`;}
  function renderSeatMap(){
    pageTitle("座席マップ");const live=liveById(params.id)||currentFieldLive();const s=live?.seat||{};const isK=isKArena(live?.venue);
    main.innerHTML=`<section class="card hero"><div class="kicker">SEAT MAP</div><h2>${safe(live?.venue||"会場未選択")}</h2><div class="muted">${safe([s.level,s.block,s.row,s.number].filter(Boolean).join(" ")||"座席情報を入力してください")}</div></section>
      <section class="card" style="margin-top:12px"><div class="form-grid"><div class="field wide"><label>対象ライブ</label><select id="seatMapLive">${liveOptions(live?.id||"")}</select></div><div class="field"><label>LEVEL</label><select id="seatMapLevel"><option ${String(s.level).includes("3")?"selected":""}>LEVEL 3</option><option ${String(s.level).includes("5")?"selected":""}>LEVEL 5</option><option ${String(s.level).includes("7")?"selected":""}>LEVEL 7</option></select></div><div class="field"><label>ブロック</label><input id="seatMapBlock" value="${safe(s.block||"")}"></div><div class="field"><label>列</label><input id="seatMapRow" type="number" value="${safe(String(s.row||"").replace(/\D/g,""))}"></div><div class="field"><label>番号</label><input id="seatMapNumber" type="number" value="${safe(String(s.number||"").replace(/\D/g,""))}"></div></div><button class="btn full" style="margin-top:12px" id="showSeatPin">位置を表示</button></section>
      <div id="seatMapResult" style="margin-top:12px">${isK?renderKArenaSchematic(s.level,s.row,s.number):`<section class="card empty">現在の内蔵座席ガイドはKアリーナ横浜向けです。会場名に「Kアリーナ」が含まれるライブを選択してください。</section>`}</div>
      ${isK?`<div class="grid two" style="margin-top:12px"><button class="btn secondary" id="openOfficialSeat">Kアリーナ公式シートマップ</button><button class="btn secondary" id="saveSeatFromMap">この座席をライブに保存</button></div><section class="notice" style="margin-top:12px">内蔵図のピンはLEVEL・列・番号から位置を分かりやすくする簡易ガイドです。公演ごとにアリーナ配置等が変わるため、最終確認は公式シートマップとチケット表記を使用してください。</section>`:""}`;
    $("#seatMapLive").onchange=e=>setRoute("seat-map",{id:e.target.value});
    if($("#showSeatPin"))$("#showSeatPin").onclick=()=>{$("#seatMapResult").innerHTML=isKArena(live?.venue)?renderKArenaSchematic($("#seatMapLevel").value,$("#seatMapRow").value,$("#seatMapNumber").value):`<section class="card empty">Kアリーナ横浜向けガイドです</section>`};
    if($("#openOfficialSeat"))$("#openOfficialSeat").onclick=()=>window.open("https://k-arena.com/seat/","_blank","noopener");
    if($("#saveSeatFromMap"))$("#saveSeatFromMap").onclick=()=>{if(!live)return;live.seat={...(live.seat||{}),level:$("#seatMapLevel").value,block:$("#seatMapBlock").value,row:$("#seatMapRow").value?$("#seatMapRow").value+"列":"",number:$("#seatMapNumber").value?$("#seatMapNumber").value+"番":""};commit("座席を保存しました")};
  }

  async function detectChekiRegions(c){
    try{
      const regions=await ChekiScanner.detectRegions(c);
      if(regions?.length)return regions;
    }catch(e){console.warn(e)}
    return detectChekiRegionsFallback(c);
  }
  async function detectChekiRegionsFallback(c){
    const max=520,sc=Math.min(1,max/Math.max(c.width,c.height)),w=Math.round(c.width*sc),h=Math.round(c.height*sc),t=document.createElement("canvas");t.width=w;t.height=h;const ctx=t.getContext("2d",{willReadFrequently:true});ctx.drawImage(c,0,0,w,h);const d=ctx.getImageData(0,0,w,h).data;const cw=26,ch=26,boxes=[];
    for(let gy=0;gy<h;gy+=ch)for(let gx=0;gx<w;gx+=cw){let bright=0,total=0;for(let y=gy;y<Math.min(h,gy+ch);y+=3)for(let x=gx;x<Math.min(w,gx+cw);x+=3){const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2];if(lum>190)bright++;total++;}if(total&&bright/total>.62)boxes.push({x:gx,y:gy,w:Math.min(cw,w-gx),h:Math.min(ch,h-gy)});}
    if(!boxes.length)return [{x:c.width*.05,y:c.height*.05,w:c.width*.9,h:c.height*.9}];
    const pts=boxes.map(b=>({x:b.x+b.w/2,y:b.y+b.h/2})),groups=[];const used=new Set();
    pts.forEach((p,i)=>{if(used.has(i))return;const stack=[i],ids=[];used.add(i);while(stack.length){const k=stack.pop();ids.push(k);pts.forEach((q,j)=>{if(used.has(j))return;if(Math.abs(q.x-pts[k].x)<=cw*1.6&&Math.abs(q.y-pts[k].y)<=ch*1.6){used.add(j);stack.push(j)}})}groups.push(ids)});
    const out=[];for(const ids of groups){const bs=ids.map(i=>boxes[i]);let x1=Math.min(...bs.map(b=>b.x)),y1=Math.min(...bs.map(b=>b.y)),x2=Math.max(...bs.map(b=>b.x+b.w)),y2=Math.max(...bs.map(b=>b.y+b.h));const ww=x2-x1,hh=y2-y1,area=ww*hh/(w*h),ratio=ww/hh;if(area>.025&&area<.55&&ratio>.45&&ratio<1.4){const pad=8;x1=Math.max(0,x1-pad);y1=Math.max(0,y1-pad);x2=Math.min(w,x2+pad);y2=Math.min(h,y2+pad);out.push({x:x1/sc,y:y1/sc,w:(x2-x1)/sc,h:(y2-y1)/sc})}}
    out.sort((a,b)=>a.y-b.y||a.x-b.x);return out.slice(0,20).length?out.slice(0,20):[{x:c.width*.05,y:c.height*.05,w:c.width*.9,h:c.height*.9}];
  }
  function renderBatchScan(){
    pageTitle("複数チェキ一括スキャン");main.innerHTML=`<section class="card hero"><div class="kicker">BATCH SCAN</div><h2>1枚の写真から複数チェキを高精度切り分け</h2><p class="muted">輪郭を検出して候補ごとに台形補正し、個別のチェキ画像として保存します。</p></section><section class="card" style="margin-top:12px"><label class="btn scan-file-label">写真を選ぶ<input id="batchFile" type="file" accept="image/*" capture="environment" hidden></label>${batchSession.sourceCanvas?`<div class="row" style="margin-top:12px"><b>${batchSession.regions.length}枚候補を検出</b><button class="btn small secondary" id="redetectBatch">再検出</button></div><canvas id="batchCanvas" class="scan-canvas" style="margin-top:10px"></canvas>`:""}</section>${batchSession.sourceCanvas?`<section class="card" style="margin-top:12px"><form id="batchMetaForm" class="form"><div class="form-grid"><div class="field"><label>メンバー *</label><select name="memberId" required>${memberOptions(state.settings.scanDefaults.memberId)}</select></div><div class="field"><label>イベント</label><select name="liveId">${liveOptions(state.settings.scanDefaults.liveId||currentFieldLive()?.id||"")}</select></div><div class="field"><label>撮影日</label><input type="date" name="date" value="${todayStr()}"></div><div class="field"><label>種類</label><select name="type"><option>2ショット</option><option>ソロ</option><option>サインあり</option><option>サインなし</option><option>その他</option></select></div></div><div class="notice">黄色枠が保存対象です。枠をタップすると対象/除外を切り替えられます。検出できない1枚は「チェキスキャン」で手動四隅補正できます。</div><button class="btn full" type="submit">選択した候補を一括保存</button></form></section>`:""}`;
    $("#batchFile").onchange=e=>{const f=e.target.files?.[0];if(f)loadBatchFile(f)};if(batchSession.sourceCanvas){mountBatchCanvas();$("#redetectBatch").onclick=async()=>{batchSession.regions=await detectChekiRegions(batchSession.sourceCanvas);batchSession.selected=new Set(batchSession.regions.map((_,i)=>i));renderBatchScan()};$("#batchMetaForm").onsubmit=e=>{e.preventDefault();saveBatchCheki(e.currentTarget)}}
  }
  async function loadBatchFile(file){try{const bmp=await createImageBitmap(file),max=2400,sc=Math.min(1,max/Math.max(bmp.width,bmp.height)),c=document.createElement("canvas");c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);bmp.close?.();batchSession.sourceCanvas=c;batchSession.regions=await detectChekiRegions(c);batchSession.selected=new Set(batchSession.regions.map((_,i)=>i));renderBatchScan()}catch(e){alert("画像を読み込めませんでした")}}
  function pointInQuad(x,y,pts){
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
      const hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi||1e-9)+xi);if(hit)inside=!inside;
    }return inside;
  }
  function mountBatchCanvas(){
    const out=$("#batchCanvas"),src=batchSession.sourceCanvas;if(!out||!src)return;
    const w=Math.min(900,src.width),sc=w/src.width;out.width=w;out.height=Math.round(src.height*sc);
    const ctx=out.getContext("2d"),draw=()=>{
      ctx.drawImage(src,0,0,out.width,out.height);
      batchSession.regions.forEach((r,i)=>{
        const pts=(r.corners||[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}]).map(p=>({x:p.x*sc,y:p.y*sc}));
        ctx.lineWidth=4;ctx.strokeStyle=batchSession.selected.has(i)?"#facc15":"#94a3b8";ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let k=1;k<4;k++)ctx.lineTo(pts[k].x,pts[k].y);ctx.closePath();ctx.stroke();
        ctx.fillStyle="rgba(0,0,0,.75)";ctx.fillRect(pts[0].x,pts[0].y,30,25);ctx.fillStyle="#fff";ctx.font="bold 14px system-ui";ctx.fillText(String(i+1),pts[0].x+8,pts[0].y+17);
      });
    };draw();
    out.onclick=e=>{
      const b=out.getBoundingClientRect(),x=(e.clientX-b.left)*(out.width/b.width)/sc,y=(e.clientY-b.top)*(out.height/b.height)/sc;
      const i=batchSession.regions.findIndex(r=>r.corners?pointInQuad(x,y,r.corners):(x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h));
      if(i>=0){batchSession.selected.has(i)?batchSession.selected.delete(i):batchSession.selected.add(i);draw()}
    };
  }
  async function cropRectBlob(c,r){
    if(r.corners){
      const out=await ChekiScanner.crop(c,r.corners,{tone:"natural",ratioMode:"cheki",rotation:0,maxLongEdge:1600});
      return new Promise((res,rej)=>out.toBlob(b=>b?res(b):rej(new Error("blob failed")),"image/jpeg",.92));
    }
    const out=document.createElement("canvas"),scale=Math.min(1,1300/Math.max(r.w,r.h));out.width=Math.max(80,Math.round(r.w*scale));out.height=Math.max(80,Math.round(r.h*scale));out.getContext("2d").drawImage(c,r.x,r.y,r.w,r.h,0,0,out.width,out.height);return new Promise(res=>out.toBlob(res,"image/jpeg",.9))
  }
  async function saveBatchCheki(form){const memberId=formValue(form,"memberId");if(!memberId){toast("メンバーを選択してください");return}const ids=[...batchSession.selected].sort((a,b)=>a-b);if(!ids.length){toast("保存対象を選択してください");return}try{toast(`${ids.length}枚を保存中…`);for(const i of ids){const blob=await cropRectBlob(batchSession.sourceCanvas,batchSession.regions[i]),thumb=await makeThumbnail(blob),id=uid("img"),meta={id,memberId,liveId:formValue(form,"liveId"),date:formValue(form,"date")||todayStr(),type:formValue(form,"type"),signed:false,favorite:false,memo:"一括スキャン",chekiNo:nextChekiNo(memberId),createdAt:new Date().toISOString()};await mediaPut(id,blob,thumb);state.chekiImages.push(meta)}save();batchSession={sourceCanvas:null,regions:[],selected:new Set()};toast(`${ids.length}枚保存しました`);setRoute("album")}catch(e){console.error(e);alert("一括保存に失敗しました")}}

  function renderIntegrations(){
    pageTitle("外部連携設定");
    main.innerHTML=`<section class="card hero"><div class="kicker">INTEGRATIONS</div><h2>外部連携</h2><p class="muted">TicketDive連携は公開版に組み込み済みです。利用者がWorker URLを入力する必要はありません。</p></section>
      <section class="card" style="margin-top:12px">
        <div class="row"><div><b>TicketDive連携</b><div class="muted small" style="margin-top:5px">公演情報・出演者情報のURL取り込み</div></div><span class="pill green">自動設定済み</span></div>
        <div class="notice" style="margin-top:12px">TicketDiveのイベントURLを「ライブURL取り込み」に貼るだけで利用できます。</div>
      </section>
      <section class="card" style="margin-top:12px">
        <form id="integrationForm" class="form">
          <div class="field"><label>AIメンバー候補 API（任意）</label><input name="aiEndpoint" value="${safe(state.settings.aiEndpoint||"")}" placeholder="https://your-api.example/analyze-cheki"></div>
          <div class="muted small">画像と候補メンバー一覧をPOSTし、memberId / confidence を返す自作API向けです。OpenAI等の秘密APIキーはこの画面へ直接入力しないでください。</div>
          <button class="btn full" type="submit">AI連携設定を保存</button>
        </form>
      </section>
      <section class="notice" style="margin-top:12px">TicketDive連携は公開公演情報の取り込みだけを行います。ログイン・購入・認証操作は行いません。</section>`;
    const form=$("#integrationForm");
    form.onsubmit=e=>{
      e.preventDefault();
      state.settings.aiEndpoint=formValue(e.currentTarget,"aiEndpoint");
      commit("AI連携設定を保存しました");
    };
  }

  function cloudCfg(){return state.settings.cloud||defaultData.settings.cloud}
  function cloudSession(){try{return JSON.parse(sessionStorage.getItem("live-manager-cloud-session")||"null")}catch(e){return null}}
  function setCloudSession(v){if(v)sessionStorage.setItem("live-manager-cloud-session",JSON.stringify(v));else sessionStorage.removeItem("live-manager-cloud-session")}
  function supaHeaders(token,json=true){const c=cloudCfg();return {apikey:c.anonKey,Authorization:`Bearer ${token}`,...(json?{"Content-Type":"application/json"}:{})}}
  async function supabaseLogin(email,password){const c=cloudCfg(),r=await fetch(`${c.supabaseUrl.replace(/\/$/,"")}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:c.anonKey,"Content-Type":"application/json"},body:JSON.stringify({email,password})});const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.msg||"ログイン失敗");const sess={access_token:j.access_token,userId:j.user?.id,email:j.user?.email,expires_at:Date.now()+Number(j.expires_in||3600)*1000};setCloudSession(sess);return sess}
  async function cloudPush(){const c=cloudCfg(),sess=cloudSession();if(!sess?.access_token)throw new Error("先にログインしてください");toast("クラウドへ同期中…");const base=c.supabaseUrl.replace(/\/$/,"");const payload={...state,settings:{...state.settings,cloud:{...state.settings.cloud,anonKey:""}}};let r=await fetch(`${base}/rest/v1/live_manager_sync?on_conflict=user_id`,{method:"POST",headers:{...supaHeaders(sess.access_token),Prefer:"resolution=merge-duplicates"},body:JSON.stringify([{user_id:sess.userId,payload,updated_at:new Date().toISOString()}])});if(!r.ok)throw new Error(`データ同期 HTTP ${r.status}`);if(c.syncImages){const media=await mediaEntries();for(const m of media){r=await fetch(`${base}/storage/v1/object/cheki-images/${sess.userId}/${encodeURIComponent(m.id)}.jpg`,{method:"POST",headers:{...supaHeaders(sess.access_token,false),"Content-Type":"image/jpeg","x-upsert":"true"},body:m.blob});if(!r.ok&&r.status!==409)console.warn("image upload",r.status)}}toast("クラウドへ保存しました")}
  async function cloudPull(){const c=cloudCfg(),sess=cloudSession();if(!sess?.access_token)throw new Error("先にログインしてください");if(!confirm("この端末のデータをクラウド内容で置き換えますか？"))return;toast("クラウドから取得中…");const base=c.supabaseUrl.replace(/\/$/,"");let r=await fetch(`${base}/rest/v1/live_manager_sync?user_id=eq.${encodeURIComponent(sess.userId)}&select=payload`,{headers:supaHeaders(sess.access_token,false)});if(!r.ok)throw new Error(`取得 HTTP ${r.status}`);const rows=await r.json();if(!rows[0]?.payload)throw new Error("クラウドデータがありません");const incoming=rows[0].payload;state={...structuredClone(defaultData),...incoming,settings:{...defaultData.settings,...(incoming.settings||{}),cloud:{...cloudCfg(),...(incoming.settings?.cloud||{}),anonKey:c.anonKey}}};await mediaClear();if(c.syncImages){for(const meta of state.chekiImages||[]){try{r=await fetch(`${base}/storage/v1/object/authenticated/cheki-images/${sess.userId}/${encodeURIComponent(meta.id)}.jpg`,{headers:supaHeaders(sess.access_token,false)});if(r.ok){const blob=await r.blob(),thumb=await makeThumbnail(blob);await mediaPut(meta.id,blob,thumb)}}catch(e){console.warn(e)}}}save();renderCloudSync();toast("クラウドから復元しました")}
  function renderCloudSync(){
    pageTitle("クラウド同期");const c=cloudCfg(),sess=cloudSession();main.innerHTML=`<section class="card hero"><div class="kicker">CLOUD SYNC</div><h2>${sess?"ログイン済み":"Supabaseと同期"}</h2><p class="muted">複数端末でライブ・チェキ記録・画像を共有するためのオプション機能です。</p></section><section class="card" style="margin-top:12px"><form id="cloudConfigForm" class="form"><div class="field"><label>Supabase Project URL</label><input name="url" value="${safe(c.supabaseUrl||"")}" placeholder="https://xxxxx.supabase.co"></div><div class="field"><label>Anon / Publishable Key</label><input name="key" type="password" value="${safe(c.anonKey||"")}"></div><div class="field"><label>ログインメール</label><input name="email" type="email" value="${safe(c.email||sess?.email||"")}"></div><label class="check-row"><input name="syncImages" type="checkbox" ${c.syncImages!==false?"checked":""}> チェキ画像も同期</label><button class="btn secondary full" type="submit">接続設定を保存</button></form></section>${sess?`<section class="card stack" style="margin-top:12px"><div class="notice">${safe(sess.email||"")} でログイン中</div><button class="btn full" id="cloudPush">この端末 → クラウド</button><button class="btn secondary full" id="cloudPull">クラウド → この端末</button><button class="btn danger full" id="cloudLogout">ログアウト</button></section>`:`<section class="card" style="margin-top:12px"><form id="cloudLoginForm" class="form"><div class="field"><label>パスワード</label><input name="password" type="password" autocomplete="current-password"></div><button class="btn full" type="submit">Supabase Authでログイン</button></form></section>`}<section class="notice" style="margin-top:12px">初回のみSupabase側にテーブル・Storage・RLS設定が必要です。ZIP内の <b>supabase_setup.sql</b> を使用してください。Anon Key自体は公開クライアント用ですが、RLSを必ず有効にしてください。</section>`;
    $("#cloudConfigForm").onsubmit=e=>{e.preventDefault();const f=e.currentTarget;state.settings.cloud={supabaseUrl:formValue(f,"url"),anonKey:formValue(f,"key"),email:formValue(f,"email"),syncImages:checked(f,"syncImages")};save();toast("クラウド設定を保存しました");renderCloudSync()};
    if($("#cloudLoginForm"))$("#cloudLoginForm").onsubmit=async e=>{e.preventDefault();try{await supabaseLogin(cloudCfg().email,formValue(e.currentTarget,"password"));toast("ログインしました");renderCloudSync()}catch(err){alert(err.message)}};
    if($("#cloudPush"))$("#cloudPush").onclick=()=>cloudPush().catch(e=>alert(e.message));if($("#cloudPull"))$("#cloudPull").onclick=()=>cloudPull().catch(e=>alert(e.message));if($("#cloudLogout"))$("#cloudLogout").onclick=()=>{setCloudSession(null);toast("ログアウトしました");renderCloudSync()};
  }

  async function openNotificationSettings(){
    const perm=("Notification" in window)?Notification.permission:"unsupported";
    openModal("通知設定",`<div class="stack"><div class="notice">ブラウザ版では、アプリを開いている時や次回起動時に期限を確認します。OSの完全なバックグラウンド通知は、将来のクラウド/PWA通知機能で拡張できます。</div><div class="card flat"><b>現在の権限</b><div class="muted small" style="margin-top:5px">${safe(perm)}</div></div><button class="btn full" id="enableNotifications">通知を有効にする</button><button class="btn secondary full" id="testNotification">テスト通知</button></div>`,()=>{
      $("#enableNotifications").onclick=async()=>{if(!("Notification" in window)){alert("このブラウザは通知に対応していません");return}const p=await Notification.requestPermission();state.settings.notificationsEnabled=p==="granted";save();closeModal();toast(p==="granted"?"通知を有効にしました":"通知は許可されませんでした");if(p==="granted")checkDueNotices(true)};
      $("#testNotification").onclick=()=>sendBrowserNotification("Live Manager","通知テストです");
    });
  }

  async function sendBrowserNotification(title,body){
    if(!("Notification" in window)||Notification.permission!=="granted"){toast("通知権限がありません");return}
    try{const reg=await navigator.serviceWorker?.ready;if(reg)await reg.showNotification(title,{body,icon:"./icon.svg",badge:"./icon.svg"});else new Notification(title,{body})}catch(e){new Notification(title,{body})}
  }

  function collectDueNotices(){
    const notices=[],today=todayStr();
    state.lives.forEach(l=>{const d=daysUntil(l.date);if(d===1)notices.push({key:`live-${l.id}-${today}`,text:`明日は「${l.title||l.artist||"ライブ"}」です`});if(d===0)notices.push({key:`live-today-${l.id}-${today}`,text:`今日は「${l.title||l.artist||"ライブ"}」です`});(l.tickets||[]).forEach(t=>{if(t.resultDate){const n=daysUntil(t.resultDate);if(n===1)notices.push({key:`result-${t.id}-${today}`,text:`「${t.name}」の当落発表は明日です`});if(n===0)notices.push({key:`result-today-${t.id}-${today}`,text:`「${t.name}」は今日が当落発表日です`})}if(t.paymentDue){const n=daysUntil(t.paymentDue);if(n===1)notices.push({key:`pay-${t.id}-${today}`,text:`「${t.name}」の支払期限まであと1日です`});if(n===0)notices.push({key:`pay-today-${t.id}-${today}`,text:`「${t.name}」は今日が支払期限です`})}})});
    state.chekiTickets.forEach(t=>{if(t.expiryDate){const n=daysUntil(t.expiryDate);if(n===1)notices.push({key:`ct-${t.id}-${today}`,text:`${t.type||"チェキ券"}の使用期限まであと1日です`})}});return notices;
  }
  async function checkDueNotices(force=false){if(!force&&!state.settings.notificationsEnabled)return;if(!("Notification" in window)||Notification.permission!=="granted")return;const sent=new Set(state.settings.sentNoticeKeys||[]);for(const n of collectDueNotices()){if(sent.has(n.key))continue;await sendBrowserNotification("Live Manager",n.text);sent.add(n.key)}state.settings.sentNoticeKeys=[...sent].slice(-100);save();}

  async function exportData(){
    try{
      toast("バックアップを作成中…");const media=await mediaEntries();const packed=[];for(const r of media)packed.push({id:r.id,blob:await blobToDataURL(r.blob),thumb:r.thumb?await blobToDataURL(r.thumb):null});
      const payload={format:"live-manager-backup-v3",exportedAt:new Date().toISOString(),state,media:packed};const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`live-manager-v3-backup-${todayStr()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("画像込みバックアップを書き出しました");
    }catch(e){console.error(e);alert("バックアップ作成に失敗しました")}
  }

  function importData(){
    const input=document.createElement("input");input.type="file";input.accept=".json,application/json";input.onchange=async()=>{try{const obj=JSON.parse(await input.files[0].text());const incoming=obj.state||obj;if(!incoming||!Array.isArray(incoming.lives))throw new Error("invalid");if(!confirm("現在のデータをバックアップ内容で置き換えますか？"))return;await mediaClear();if(Array.isArray(obj.media))for(const r of obj.media){await mediaPut(r.id,dataURLToBlob(r.blob),r.thumb?dataURLToBlob(r.thumb):null)}state={...structuredClone(defaultData),...incoming,settings:{...defaultData.settings,...(incoming.settings||{})}};state.chekiImages=Array.isArray(state.chekiImages)?state.chekiImages:[];state.chekiTickets=Array.isArray(state.chekiTickets)?state.chekiTickets:[];save();render();toast("バックアップを読み込みました")}catch(e){console.error(e);alert("バックアップファイルを読み込めませんでした。")}};input.click();
  }


  async function resetData(){
    if(!confirm("全データと保存済みチェキ画像を削除します。元に戻せません。よろしいですか？"))return;
    await mediaClear(); state=structuredClone(defaultData);save();render();toast("全データを削除しました");
  }

  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-route]"); if(nav)setRoute(nav.dataset.route);
    const qa=e.target.closest('[data-action="quick-add"]'); if(qa)openQuickAdd();
  });
  $("#quickAddBtn").onclick=openQuickAdd;

  if("serviceWorker" in navigator){ window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{})); }
  render();
  setTimeout(()=>checkDueNotices(false),1200);
})();