
(function(){
'use strict';
var $=function(s){return document.querySelector(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var pad=function(n){return String(n).padStart(2,'0')};
var iso=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
var base=new Date();base.setHours(0,0,0,0);
var TODAY=iso(base);
var addDays=function(n){var d=new Date(base);d.setDate(d.getDate()+n);return iso(d)};
var daysBetween=function(a,b){return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/864e5)};
var CURS={NZD:'NZ$',AUD:'A$',USD:'US$',THB:'\u0E3F'};
var DEFAULT_SETTINGS=function(){return {base:'NZD',rates:{NZD:1,AUD:1.1,USD:1.7,THB:0.052},services:{}}};
var fmt=function(n,cur){return (CURS[cur]||'$')+Math.round(n||0).toLocaleString('en-US')};
var toBase=function(n,cur){var r=(S.settings.rates[cur||'NZD'])||1,b=S.settings.rates[S.settings.base]||1;return (n||0)*r/b};
var money=function(n){return fmt(n,S.settings.base)};
var fmtDate=function(s){if(!s)return 'No date';return new Date(s+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})};
function dueInfo(s){
  if(!s)return {text:'No date',cls:''};
  var n=daysBetween(TODAY,s);
  if(n<0)return {text:Math.abs(n)+'d overdue',cls:'late'};
  if(n===0)return {text:'Today',cls:'soon'};
  if(n<=3)return {text:'In '+n+'d',cls:'soon'};
  return {text:fmtDate(s),cls:''};
}

var STAGES=[{id:'lead',name:'New lead',w:.1},{id:'contacted',name:'Contacted',w:.2},{id:'proposal',name:'Proposal sent',w:.4},{id:'negotiation',name:'Negotiating',w:.7},{id:'won',name:'Won',w:1},{id:'lost',name:'Lost',w:0}];
var PHASES=[{id:'booked',name:'Booked'},{id:'prep',name:'Prep'},{id:'production',name:'Production'},{id:'post',name:'Post and build'},{id:'review',name:'Client review'},{id:'delivered',name:'Delivered'},{id:'paid',name:'Paid'}];
var BASE_SERVICES={re:'Property photo',str:'Rental photo',video:'Video',ai:'AI consulting',brand:'Personal brand'};
var SERVICES=Object.assign({},BASE_SERVICES);
var EXTRA_COLORS=['#B8860B','#C2410C','#0F766E','#4D7C0F','#BE185D','#4338CA','#7C3AED','#0369A1'];
function refreshServices(){SERVICES=Object.assign({},BASE_SERVICES,(S&&S.settings&&S.settings.services)||{})}
function fillSvcFilter(){
  var el=$('#svc'),cur=el.value||'all';
  el.innerHTML='<option value="all">All services</option>'+Object.keys(SERVICES).map(function(k){return '<option value="'+esc(k)+'">'+esc(SERVICES[k])+'</option>'}).join('');
  el.value=SERVICES[cur]?cur:'all';
}
var BASE_TASKS={
  booked:['Send contract and deposit invoice','Confirm date and location'],
  prep:['Agree shot list or scope','Check gear and logistics'],
  production:['Shoot day'],
  post:['Edit and colour grade','Quality check'],
  review:['Send for client review','Apply revisions'],
  delivered:['Deliver final files','Ask for a testimonial'],
  paid:['Send final invoice','Mark as paid']
};
function tasksFor(service){
  var t=JSON.parse(JSON.stringify(BASE_TASKS));
  if(service==='ai'||service==='brand'){t.production=['Working session or workshop'];t.post=['Write up recommendations','Build templates and assets'];}
  return t;
}
var seq=0;
var uid=function(){return crypto.randomUUID()};
function mkTasks(service,curIdx,doneInCur){
  var tpl=tasksFor(service),out=[];
  PHASES.forEach(function(ph,i){
    tpl[ph.id].forEach(function(text,j){
      out.push({id:uid('t'),phase:ph.id,text:text,done:i<curIdx||(i===curIdx&&j<doneInCur)});
    });
  });
  return out;
}
/* ---------- data layer: Supabase ---------- */
var S={clients:[],deals:[],projects:[],settings:DEFAULT_SETTINGS()};
var sb=null,session=null;
var snap={clients:{},projects:{},deals:{},tasks:{},settings:''};
var queue=Promise.resolve(),retryTimer=null;
function setSaveState(t,bad){var e=$('#savestate');if(e){e.textContent=t;e.classList.toggle('bad',!!bad)}}
function rowsFrom(){
  var r={clients:{},projects:{},deals:{},tasks:{}};
  var cids={},pids={};
  S.clients.forEach(function(c){cids[c.id]=1;r.clients[c.id]={id:c.id,name:c.name||'Unnamed',company:c.company||'',email:c.email||'',phone:c.phone||'',notes:c.notes||'',sold_value:Math.max(0,Number(c.soldValue)||0),sold_jobs:Math.max(0,Math.round(Number(c.soldJobs)||0)),sold_currency:c.soldCur||'NZD',follow_up:c.followUp||null}});
  S.projects.forEach(function(p){
    pids[p.id]=1;
    r.projects[p.id]={id:p.id,client_id:cids[p.clientId]?p.clientId:null,title:p.title||'Untitled',service:p.service,value:Number(p.value)||0,currency:p.cur,phase:p.phase,due:p.due||null,notes:p.notes||''};
    p.tasks.forEach(function(t,i){r.tasks[t.id]={id:t.id,project_id:p.id,phase:t.phase,text:t.text,done:!!t.done,position:i}});
  });
  S.deals.forEach(function(d){
    r.deals[d.id]={id:d.id,client_id:cids[d.clientId]?d.clientId:null,project_id:pids[d.projectId]?d.projectId:null,title:d.title||'Untitled',service:d.service,value:Number(d.value)||0,currency:d.cur,stage:d.stage,follow_up:d.followUp||null,won_date:d.wonDate||null,notes:d.notes||''};
  });
  return r;
}
function chunks(a,n){var o=[];for(var i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o}
async function doSync(){
  var cur=rowsFrom(),t,k,ids,c;
  var up=['clients','projects','deals','tasks'];
  for(k=0;k<up.length;k++){
    t=up[k];
    ids=Object.keys(cur[t]).filter(function(id){return JSON.stringify(cur[t][id])!==snap[t][id]});
    for(c of chunks(ids,300)){
      var res=await sb.from(t).upsert(c.map(function(id){return cur[t][id]}),{onConflict:'id'});
      if(res.error)throw res.error;
      c.forEach(function(id){snap[t][id]=JSON.stringify(cur[t][id])});
    }
  }
  var down=['tasks','deals','projects','clients'];
  for(k=0;k<down.length;k++){
    t=down[k];
    ids=Object.keys(snap[t]).filter(function(id){return !cur[t][id]});
    for(c of chunks(ids,100)){
      var dr2=await sb.from(t).delete().in('id',c);
      if(dr2.error)throw dr2.error;
      c.forEach(function(id){delete snap[t][id]});
    }
  }
  var sj=JSON.stringify(S.settings);
  if(sj!==snap.settings){
    var sr=await sb.from('settings').upsert({user_id:session.user.id,base_currency:S.settings.base,rates:S.settings.rates,services:S.settings.services||{}},{onConflict:'user_id'});
    if(sr.error)throw sr.error;
    snap.settings=sj;
  }
}
function save(){
  if(!sb||!session)return;
  setSaveState('Saving…');
  queue=queue.then(doSync).then(function(){setSaveState('All changes saved')}).catch(function(err){
    console.error(err);
    setSaveState('Not saved. Retrying…',true);
    toast('Could not save. Check your connection. I will retry.');
    clearTimeout(retryTimer);retryTimer=setTimeout(save,6000);
  });
}
async function fetchAll(t){
  var out=[],from=0,size=1000;
  for(;;){
    var r=await sb.from(t).select('*').order('created_at',{ascending:true}).order('id').range(from,from+size-1);
    if(r.error)throw r.error;
    out=out.concat(r.data);
    if(r.data.length<size)break;
    from+=size;
  }
  return out;
}
async function dbLoad(){
  var all=await Promise.all([fetchAll('clients'),fetchAll('projects'),fetchAll('deals'),fetchAll('tasks'),sb.from('settings').select('*').maybeSingle()]);
  var st=all[4];if(st.error)throw st.error;
  var tasksBy={};
  all[3].sort(function(a,b){return a.position-b.position}).forEach(function(t){(tasksBy[t.project_id]=tasksBy[t.project_id]||[]).push({id:t.id,phase:t.phase,text:t.text,done:t.done})});
  S={
    clients:all[0].map(function(c){return {id:c.id,name:c.name,company:c.company,email:c.email,phone:c.phone,notes:c.notes,soldValue:Number(c.sold_value)||0,soldJobs:c.sold_jobs||0,soldCur:c.sold_currency||'NZD',followUp:c.follow_up||''}}),
    projects:all[1].map(function(p){return {id:p.id,clientId:p.client_id||'',title:p.title,service:p.service,value:Number(p.value),cur:p.currency,phase:p.phase,due:p.due||'',notes:p.notes,tasks:tasksBy[p.id]||[]}}),
    deals:all[2].map(function(d){return {id:d.id,clientId:d.client_id||'',projectId:d.project_id||'',title:d.title,service:d.service,value:Number(d.value),cur:d.currency,stage:d.stage,followUp:d.follow_up||'',wonDate:d.won_date||'',notes:d.notes}}),
    settings:st.data?{base:st.data.base_currency,rates:Object.assign(DEFAULT_SETTINGS().rates,st.data.rates),services:st.data.services||{}}:DEFAULT_SETTINGS()
  };
  refreshServices();fillSvcFilter();
  var r=rowsFrom();
  snap={clients:{},projects:{},deals:{},tasks:{},settings:st.data?JSON.stringify(S.settings):''};
  ['clients','projects','deals','tasks'].forEach(function(t){Object.keys(r[t]).forEach(function(id){snap[t][id]=JSON.stringify(r[t][id])})});
}

var ui={view:'dashboard',q:'',svc:'all',sort:'sold',dir:-1};
var drag=null;
var dr={k:null,id:null,confirm:false,fresh:false};
var lastFocus=null;

var byId=function(list,id){for(var i=0;i<list.length;i++)if(list[i].id===id)return list[i];return null};
var client=function(id){return byId(S.clients,id)};
var cname=function(id){var c=client(id);return c?c.name:'No client'};
var ccompany=function(id){var c=client(id);return c&&c.company?c.company:''};
var rec=function(k,id){return byId(k==='deal'?S.deals:k==='project'?S.projects:S.clients,id)};

function matches(item){
  if(ui.svc!=='all'&&item.service&&item.service!==ui.svc)return false;
  if(ui.q){
    var hay=((item.title||'')+' '+(item.name||'')+' '+(item.company||'')+' '+cname(item.clientId)+' '+ccompany(item.clientId)).toLowerCase();
    if(hay.indexOf(ui.q.toLowerCase())<0)return false;
  }
  return true;
}
function mkClient(o){return Object.assign({id:uid('c'),name:'',company:'',email:'',phone:'',notes:'',soldValue:0,soldJobs:0,soldCur:S.settings.base,followUp:''},o||{})}
function clientStats(c){
  var ps=S.projects.filter(function(p){return p.clientId===c.id});
  var paid=ps.filter(function(p){return p.phase==='paid'}),open=ps.filter(function(p){return p.phase!=='paid'});
  var sum=function(l){return l.reduce(function(a,p){return a+toBase(p.value,p.cur)},0)};
  return {jobs:(c.soldJobs||0)+paid.length,sold:toBase(c.soldValue,c.soldCur)+sum(paid),booked:sum(open),
    openDeals:S.deals.filter(function(d){return d.clientId===c.id&&d.stage!=='won'&&d.stage!=='lost'}).length,projects:ps.length};
}
function tag(s){
  if(BASE_SERVICES[s])return '<span class="tag s-'+esc(s)+'"><i></i>'+esc(SERVICES[s]||s)+'</span>';
  var i=Object.keys((S.settings.services)||{}).indexOf(s);
  return '<span class="tag"><i style="background:'+EXTRA_COLORS[(i<0?0:i)%EXTRA_COLORS.length]+';border-radius:2px"></i>'+esc(SERVICES[s]||s)+'</span>';
}
function opts(list,sel){return list.map(function(o){return '<option value="'+esc(o[0])+'"'+(o[0]===sel?' selected':'')+'>'+esc(o[1])+'</option>'}).join('')}
function progress(p){var t=p.tasks.length,d=p.tasks.filter(function(x){return x.done}).length;return {d:d,t:t,pct:t?Math.round(d/t*100):0}}

/* ---------- views ---------- */
function titleFor(){
  if(ui.view==='dashboard'){
    var h=new Date().getHours();
    return {t:(h<12?'Good morning':h<18?'Good afternoon':'Good evening')+', Jeremy',s:attention().length+' things want your attention today. Politely.'};
  }
  if(ui.view==='pipeline')return {t:'Sales pipeline',s:'Drag a deal to a new stage. Drop it on Won and a project appears.'};
  if(ui.view==='projects')return {t:'Projects',s:'Every project moves through the same seven phases.'};
  return {t:'Clients',s:S.clients.length+' people and companies'};
}
function attention(){
  var items=[];
  S.deals.forEach(function(d){
    if(d.stage==='won'||d.stage==='lost'||!d.followUp)return;
    var n=daysBetween(TODAY,d.followUp);
    if(n<0)items.push({k:'deal',id:d.id,why:'Overdue',cls:'late',text:'Follow up with '+cname(d.clientId),sub:d.title+' · '+Math.abs(n)+' days late',o:n});
    else if(n===0)items.push({k:'deal',id:d.id,why:'Today',cls:'soon',text:'Follow up with '+cname(d.clientId),sub:d.title,o:0});
  });
  S.clients.forEach(function(c){
    if(!c.followUp)return;
    var n=daysBetween(TODAY,c.followUp);
    if(n>0)return;
    var st=clientStats(c);
    items.push({k:'client',id:c.id,why:n<0?'Overdue':'Today',cls:n<0?'late':'soon',text:'Check in with '+c.name,sub:money(st.sold)+' sold, '+st.jobs+' job'+(st.jobs===1?'':'s')+(n<0?' \u00B7 '+Math.abs(n)+' days late':''),o:n});
  });
  S.projects.forEach(function(p){
    if(p.phase==='paid')return;
    if(p.phase==='delivered')items.push({k:'project',id:p.id,why:'Unpaid',cls:'money',text:'Chase payment from '+cname(p.clientId),sub:p.title+' · '+fmt(p.value,p.cur),o:5});
    else if(p.due){
      var n=daysBetween(TODAY,p.due);
      if(n<0)items.push({k:'project',id:p.id,why:'Late',cls:'late',text:p.title+' is past its due date',sub:cname(p.clientId)+' · '+Math.abs(n)+' days late',o:n});
      else if(n<=3)items.push({k:'project',id:p.id,why:'Due soon',cls:'soon',text:p.title+' is due '+(n===0?'today':'in '+n+' days'),sub:cname(p.clientId),o:n});
    }
  });
  return items.sort(function(a,b){return a.o-b.o});
}
function bars(rows,fmt){
  var max=Math.max.apply(null,rows.map(function(r){return r.v}).concat([1]));
  return rows.map(function(r){return '<div class="bar-row"><span title="'+esc(r.l)+'">'+esc(r.l)+'</span><div class="bar" aria-hidden="true"><i style="width:'+(r.v/max*100)+'%"></i></div><b class="num">'+esc(fmt(r.v))+'</b></div>'}).join('');
}
function renderDashboard(){
  var open=S.deals.filter(function(d){return d.stage!=='won'&&d.stage!=='lost'});
  var openVal=open.reduce(function(a,d){return a+toBase(d.value,d.cur)},0);
  var weighted=open.reduce(function(a,d){var s=byId(STAGES,d.stage);return a+toBase(d.value,d.cur)*(s?s.w:0)},0);
  var ym=TODAY.slice(0,7);
  var won=S.deals.filter(function(d){return d.stage==='won'&&d.wonDate&&d.wonDate.slice(0,7)===ym});
  var wonVal=won.reduce(function(a,d){return a+toBase(d.value,d.cur)},0);
  var active=S.projects.filter(function(p){return p.phase!=='paid'});
  var dueWeek=active.filter(function(p){return p.due&&daysBetween(TODAY,p.due)<=7&&p.phase!=='delivered'}).length;
  var unpaid=S.projects.filter(function(p){return p.phase==='delivered'});
  var unpaidVal=unpaid.reduce(function(a,p){return a+toBase(p.value,p.cur)},0);
  var stageRows=STAGES.filter(function(s){return s.id!=='won'&&s.id!=='lost'}).map(function(s){return {l:s.name,v:S.deals.filter(function(d){return d.stage===s.id}).reduce(function(a,d){return a+toBase(d.value,d.cur)},0)}});
  var phaseRows=PHASES.map(function(p){return {l:p.name,v:S.projects.filter(function(x){return x.phase===p.id}).length}});
  var svcRows=Object.keys(SERVICES).map(function(k){return {l:SERVICES[k],v:S.projects.filter(function(p){return p.service===k}).reduce(function(a,p){return a+toBase(p.value,p.cur)},0)}});
  var cs=S.clients.map(function(c){return {c:c,s:clientStats(c)}});
  var soldTotal=cs.reduce(function(a,x){return a+x.s.sold},0),jobsTotal=cs.reduce(function(a,x){return a+x.s.jobs},0),repeat=cs.filter(function(x){return x.s.jobs>=2}).length;
  var topRows=cs.filter(function(x){return x.s.sold>0}).sort(function(a,b){return b.s.sold-a.s.sold}).slice(0,8).map(function(x){return {l:x.c.name,v:x.s.sold}});
  var at=attention();
  var first=(!S.clients.length&&!S.deals.length&&!S.projects.length)?'<div class="firstrun"><h2>Your CRM is empty</h2><p>Start with Clients, then Import CSV to bring in your contacts, or press New deal to add your first lead.</p></div>':'';
  return first+'<div class="kpis">'+
   tile('Sold to date',money(soldTotal),jobsTotal+' jobs \u00B7 '+repeat+' repeat client'+(repeat===1?'':'s'))+
   tile('Open pipeline',money(openVal),open.length+' deals · '+money(weighted)+' weighted')+
   tile('Won this month',money(wonVal),won.length+' deal'+(won.length===1?'':'s'))+
   tile('Active projects',String(active.length),dueWeek+' due in the next 7 days')+
   tile('Awaiting payment',money(unpaidVal),unpaid.length+' delivered, unpaid')+
  '</div>'+
  '<div class="two">'+
   '<section class="panel"><h2>Needs attention</h2>'+(at.length?'<ul class="attn">'+at.slice(0,8).map(function(a){return '<li><button data-act="open" data-k="'+a.k+'" data-id="'+esc(a.id)+'"><span class="why '+a.cls+'">'+esc(a.why)+'</span><span>'+esc(a.text)+'<small>'+esc(a.sub)+'</small></span></button></li>'}).join('')+'</ul>'+(at.length>8?'<p class="hintline" style="margin-top:8px">+ '+(at.length-8)+' more. Sort Clients by follow-up to see them all.</p>':''):'<p class="empty">Nothing is on fire. Suspicious, but nice.</p>')+'</section>'+
   '<section class="panel"><h2>Pipeline value by stage</h2>'+bars(stageRows,money)+'<p class="hintline">Totals convert to '+S.settings.base+' using the rates under Currency rates. Weighted forecast uses 10%, 20%, 40% and 70% by stage.</p></section>'+
  '</div>'+
  '<div class="two">'+
   '<section class="panel"><h2>Projects by phase</h2>'+bars(phaseRows,function(v){return String(v)})+'</section>'+
   '<section class="panel"><h2>Project value by service</h2>'+bars(svcRows,money)+'</section>'+
   '<section class="panel"><h2>Top clients by sold value</h2>'+(topRows.length?bars(topRows,money):'<p class="empty">Import your Xero customer list on the Clients page to see your best clients here.</p>')+'</section>'+
  '</div>';
}
function tile(l,big,hint){return '<div class="tile"><div class="lbl">'+esc(l)+'</div><div class="big num">'+esc(big)+'</div><div class="hint">'+esc(hint)+'</div></div>'}

function dealCard(d){
  var due=dueInfo(d.followUp);
  var closed=d.stage==='won'||d.stage==='lost';
  return '<div class="card" draggable="true" data-card data-k="deal" data-id="'+esc(d.id)+'"><button class="card-btn" data-act="open" data-k="deal" data-id="'+esc(d.id)+'">'+
    '<span class="t">'+esc(d.title)+'</span><span class="c">'+esc(cname(d.clientId))+(ccompany(d.clientId)?' · '+esc(ccompany(d.clientId)):'')+'</span>'+
    '<span class="row">'+tag(d.service)+'<span class="push num"><b>'+fmt(d.value,d.cur)+'</b></span></span>'+
    (closed?'':'<span class="row"><span class="chip '+due.cls+'">'+(d.followUp?'Follow up '+esc(due.text.toLowerCase()==='today'?'today':due.text):'No follow-up set')+'</span></span>')+
  '</button></div>';
}
function projectCard(p){
  var due=dueInfo(p.due),pr=progress(p);
  var finished=p.phase==='paid'||p.phase==='delivered';
  return '<div class="card" draggable="true" data-card data-k="project" data-id="'+esc(p.id)+'"><button class="card-btn" data-act="open" data-k="project" data-id="'+esc(p.id)+'">'+
    '<span class="t">'+esc(p.title)+'</span><span class="c">'+esc(cname(p.clientId))+'</span>'+
    '<span class="row">'+tag(p.service)+'<span class="push num"><b>'+fmt(p.value,p.cur)+'</b></span></span>'+
    '<span class="prog" role="img" aria-label="'+pr.d+' of '+pr.t+' tasks done"><i style="width:'+pr.pct+'%"></i></span>'+
    '<span class="row"><span class="chip num">'+pr.d+'/'+pr.t+' tasks</span>'+(finished?'':'<span class="chip push '+due.cls+'">Due '+esc(due.text)+'</span>')+'</span>'+
  '</button></div>';
}
function boardHtml(cols,items,cardFn,colKey,sumFn){
  return '<div class="board">'+cols.map(function(c){
    var list=items.filter(function(x){return x[colKey]===c.id});
    return '<section class="colm" data-col="'+c.id+'" aria-label="'+esc(c.name)+'"><header><h3>'+esc(c.name)+'</h3><span class="cnt num">'+list.length+'</span>'+(sumFn?'<span class="sum num">'+money(sumFn(list))+'</span>':'')+'</header><div class="cards">'+(list.length?list.map(cardFn).join(''):'<div class="dropnote">Drop here</div>')+'</div></section>';
  }).join('')+'</div>';
}
function renderPipeline(){
  var items=S.deals.filter(matches).sort(function(a,b){return (a.followUp||'9999').localeCompare(b.followUp||'9999')});
  return boardHtml(STAGES,items,dealCard,'stage',function(l){return l.reduce(function(a,d){return a+toBase(d.value,d.cur)},0)});
}
function renderProjects(){
  var items=S.projects.filter(matches).sort(function(a,b){return (a.due||'9999').localeCompare(b.due||'9999')});
  return boardHtml(PHASES,items,projectCard,'phase',null);
}
function renderClients(){
  var note='<p class="toolbar-note">Sold value is past work from Xero plus paid projects here. Booked value is projects not yet paid. Import CSV columns: name, email, company, phone, notes, jobs, total revenue, follow-up date.</p>';
  var list=S.clients.filter(matches).map(function(c){return {c:c,s:clientStats(c)}});
  if(!list.length)return note+'<p class="empty">No clients yet. Add one, or use Import CSV.</p>';
  var key=ui.sort,dir=ui.dir;
  var val=function(x){return key==='name'?x.c.name.toLowerCase():key==='jobs'?x.s.jobs:key==='booked'?x.s.booked:key==='follow'?(x.c.followUp||'9999-99-99'):x.s.sold};
  list.sort(function(a,b){var A=val(a),B=val(b);return ((A<B?-1:A>B?1:0)*dir)||a.c.name.localeCompare(b.c.name)});
  var th=function(k,label,cls){return '<th class="'+cls+'" aria-sort="'+(key===k?(dir>0?'ascending':'descending'):'none')+'"><button class="thbtn" data-act="sort" data-v="'+k+'">'+label+(key===k?(dir>0?' ▲':' ▼'):'')+'</button></th>'};
  var tj=0,ts=0,tb=0;
  var rows=list.map(function(x){
    var c=x.c,st=x.s;tj+=st.jobs;ts+=st.sold;tb+=st.booked;
    var fu=c.followUp?dueInfo(c.followUp):null;
    return '<tr><td><button class="rowbtn" data-act="open" data-k="client" data-id="'+esc(c.id)+'">'+esc(c.name)+'</button>'+(st.jobs>=2?' <span class="chip">Repeat</span>':'')+(c.company?'<div class="c" style="color:var(--muted);font-size:12.5px">'+esc(c.company)+'</div>':'')+'</td><td>'+esc(c.email)+'</td><td class="r num">'+st.jobs+'</td><td class="r num">'+money(st.sold)+'</td><td class="r num">'+money(st.booked)+'</td><td class="r num">'+st.openDeals+'</td><td>'+(fu?'<span class="chip '+fu.cls+'">'+esc(fu.text)+'</span>':'<span style="color:var(--muted)">None</span>')+'</td></tr>';
  }).join('');
  return note+'<div class="tbl-wrap"><table><thead><tr>'+th('name','Client','')+'<th>Email</th>'+th('jobs','Jobs','r')+th('sold','Sold value ('+S.settings.base+')','r')+th('booked','Booked value','r')+'<th class="r">Open deals</th>'+th('follow','Follow-up','')+'</tr></thead><tbody>'+rows+'</tbody><tfoot><tr><td colspan="2">'+list.length+' client'+(list.length===1?'':'s')+'</td><td class="r num">'+tj+'</td><td class="r num">'+money(ts)+'</td><td class="r num">'+money(tb)+'</td><td colspan="2"></td></tr></tfoot></table></div>';
}

function render(){
  var v=$('#view');
  var t=titleFor();
  $('#pagetitle').innerHTML=esc(t.t)+'<span class="sub">'+esc(t.s)+'</span>';
  document.title=t.t.split(',')[0]+' · Jeremysim.co Studio CRM';
  var boards=ui.view==='pipeline'||ui.view==='projects';
  v.className=boards?'boardview':'';
  v.innerHTML=ui.view==='dashboard'?renderDashboard():ui.view==='pipeline'?renderPipeline():ui.view==='projects'?renderProjects():renderClients();
  document.querySelectorAll('.nav button').forEach(function(b){if(b.dataset.v===ui.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  $('#filters').style.display=ui.view==='dashboard'?'none':'flex';
  $('#svc').style.display=ui.view==='clients'?'none':'';
  $('#importbtn').style.display=ui.view==='clients'?'':'none';
  $('#newbtn').textContent=ui.view==='projects'?'New project':ui.view==='clients'?'New client':'New deal';
}
function setView(v){
  ui.view=v;
  try{history.replaceState(null,'','#'+v)}catch(e){location.hash=v}
  render();
}

/* ---------- data actions ---------- */
function toast(msg){
  var t=$('#toast');t.textContent=msg;t.hidden=false;
  clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true},3200);
}
function moveDeal(id,stage){
  var d=rec('deal',id);if(!d||d.stage===stage)return;
  d.stage=stage;
  if(stage==='won'){
    d.wonDate=TODAY;
    if(!d.projectId||!rec('project',d.projectId)){
      var p={id:uid('p'),clientId:d.clientId,title:d.title,service:d.service,value:d.value,cur:d.cur,phase:'booked',due:addDays(21),notes:'',tasks:mkTasks(d.service,0,0)};
      S.projects.push(p);d.projectId=p.id;
      toast('Won. A project for '+cname(d.clientId)+' is waiting in Booked.');
    }
  }
  save();
}
function movePhase(id,phase){var p=rec('project',id);if(!p||p.phase===phase)return;p.phase=phase;save()}
function newRecord(k){
  var r;
  if(k==='client'){r=mkClient({name:'New client'});S.clients.push(r)}
  else if(k==='project'){r={id:uid('p'),clientId:'',title:'New project',service:'re',value:0,cur:S.settings.base,phase:'booked',due:addDays(14),notes:'',tasks:mkTasks('re',0,0)};S.projects.push(r)}
  else{r={id:uid('d'),clientId:'',title:'New deal',service:'re',value:0,cur:S.settings.base,stage:'lead',followUp:addDays(2),notes:''};S.deals.push(r)}
  save();render();openDrawer(k,r.id,true);
}
function deleteRec(k,id){
  if(k==='deal')S.deals=S.deals.filter(function(x){return x.id!==id});
  else if(k==='project'){S.projects=S.projects.filter(function(x){return x.id!==id});S.deals.forEach(function(d){if(d.projectId===id)d.projectId=''})}
  else S.clients=S.clients.filter(function(x){return x.id!==id});
  save();
}

/* ---------- drawer ---------- */
function openDrawer(k,id,isNew){
  if(dr.k===null)lastFocus=document.activeElement;
  dr={k:k,id:id,confirm:false,fresh:true,isNew:!!isNew,adding:null};
  renderDrawer();
  $('#drawer').hidden=false;$('#scrim').hidden=false;
  var f=isNew?$('#f-title')||$('#f-name'):$('#drawer .icon');
  if(f){f.focus();if(isNew&&f.select)f.select()}
}
function closeDrawer(){
  if(dr.k===null)return;
  dr.k=null;$('#drawer').hidden=true;$('#scrim').hidden=true;$('#drawer').innerHTML='';
  render();
  if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
}
var X='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
function fld(id,label,inner){return '<div class="fld"><label for="'+id+'">'+label+'</label>'+inner+'</div>'}
function valueField(r){
  return fld('f-value','Value','<div class="valrow"><input id="f-value" type="number" min="0" step="50" data-f="value" value="'+esc(r.value)+'"><select id="f-cur" data-f="cur" aria-label="Currency">'+opts(Object.keys(CURS).map(function(c){return [c,c]}),r.cur)+'</select></div>');
}
function renderSettings(){
  var el=$('#drawer');
  el.innerHTML='<header class="dr-head"><div><p class="eyebrow">Settings</p><h2 id="dr-title">Currency rates</h2></div><button class="icon" data-act="close" aria-label="Close panel">'+X+'</button></header><div class="dr-body">'+
   '<p class="hintline">Each deal and project keeps its own currency. Dashboard totals convert to the reporting currency using these rates. They are placeholders, so set them to the rates you use.</p>'+
   fld('s-base','Reporting currency','<select id="s-base" data-base="1">'+opts(Object.keys(CURS).map(function(c){return [c,c]}),S.settings.base)+'</select>')+
   Object.keys(CURS).map(function(c){return fld('s-'+c,'1 '+c+' equals (in NZD)','<input id="s-'+c+'" type="number" min="0" step="0.001" data-rate="'+c+'" value="'+S.settings.rates[c]+'"'+(c==='NZD'?' disabled':'')+'>')}).join('')+
   '</div>';
}
function addForm(){
  if(!dr.adding)return '';
  var isC=dr.adding==='clientId';
  return '<form class="inlineadd" data-add="'+dr.adding+'"><label class="lab" for="new-name">'+(isC?'New client name':'New service name')+'</label><div class="row2"><input id="new-name" required maxlength="80" placeholder="'+(isC?'e.g. Jane Smith':'e.g. Drone video')+'">'+(isC?'<input id="new-company" maxlength="80" placeholder="Company (optional)" aria-label="Company (optional)">':'')+'<button class="btn" type="submit">Add</button><button class="btn ghost" type="button" data-act="addcancel">Cancel</button></div></form>';
}
function renderDrawer(){
  if(dr.k==='settings'){renderSettings();return}
  var el=$('#drawer'),r=rec(dr.k,dr.id);
  if(!r){closeDrawer();return}
  var openSet=null,scroll=0,active=document.activeElement&&document.activeElement.id;
  if(!dr.fresh){openSet=new Set([].map.call(el.querySelectorAll('details[open]'),function(d){return d.dataset.ph}));var b=el.querySelector('.dr-body');scroll=b?b.scrollTop:0}
  var clientOpts=S.clients.map(function(c){return [c.id,c.name+(c.company?' ('+c.company+')':'')]});
  if(!r.clientId)clientOpts.unshift(['','Choose a client\u2026']);
  clientOpts.push(['__new__','+ Add new client\u2026']);
  var svcOpts=Object.keys(SERVICES).map(function(k){return [k,SERVICES[k]]});
  svcOpts.push(['__new__','+ Add new service\u2026']);
  var head,body,foot='';
  if(dr.k==='deal'){
    head=['Deal',r.title];
    body=fld('f-title','Deal title','<input id="f-title" data-f="title" value="'+esc(r.title)+'">')+
      '<div class="g2">'+fld('f-clientId','Client','<select id="f-clientId" data-f="clientId">'+opts(clientOpts,r.clientId)+'</select>')+fld('f-service','Service','<select id="f-service" data-f="service">'+opts(svcOpts,r.service)+'</select>')+'</div>'+addForm()+
      '<div class="g2">'+fld('f-stage','Stage','<select id="f-stage" data-f="stage">'+opts(STAGES.map(function(s){return [s.id,s.name]}),r.stage)+'</select>')+valueField(r)+'</div>'+
      fld('f-followUp','Next follow-up','<input id="f-followUp" type="date" data-f="followUp" value="'+esc(r.followUp||'')+'">')+
      fld('f-notes','Notes','<textarea id="f-notes" data-f="notes">'+esc(r.notes)+'</textarea>');
    if(r.stage==='won'&&r.projectId&&rec('project',r.projectId))body+='<div><p class="lab">Linked project</p><ul class="linklist"><li><button data-act="open" data-k="project" data-id="'+esc(r.projectId)+'">'+esc(rec('project',r.projectId).title)+'</button></li></ul></div>';
    if(r.clientId)body+='<div><p class="lab">Client</p><ul class="linklist"><li><button data-act="open" data-k="client" data-id="'+esc(r.clientId)+'">'+esc(cname(r.clientId))+'</button></li></ul></div>';
  }else if(dr.k==='project'){
    var pr=progress(r),idx=PHASES.map(function(p){return p.id}).indexOf(r.phase);
    head=['Project',r.title];
    body=fld('f-title','Project title','<input id="f-title" data-f="title" value="'+esc(r.title)+'">')+
      '<div class="g2">'+fld('f-clientId','Client','<select id="f-clientId" data-f="clientId">'+opts(clientOpts,r.clientId)+'</select>')+fld('f-service','Service','<select id="f-service" data-f="service">'+opts(svcOpts,r.service)+'</select>')+'</div>'+addForm()+
      '<div class="g2">'+fld('f-due','Due date','<input id="f-due" type="date" data-f="due" value="'+esc(r.due||'')+'">')+valueField(r)+'</div>'+
      '<div><p class="lab" id="phlab">Phase</p><ol class="steps" aria-labelledby="phlab">'+PHASES.map(function(p,i){return '<li><button data-act="setphase" data-v="'+p.id+'" aria-pressed="'+(p.id===r.phase)+'" class="'+(i<idx?'passed':'')+'">'+esc(p.name)+'</button></li>'}).join('')+'</ol></div>'+
      '<div><p class="lab">Progress: '+pr.d+' of '+pr.t+' tasks done</p><div class="prog" aria-hidden="true"><i style="width:'+pr.pct+'%"></i></div></div>'+
      '<div style="display:flex;flex-direction:column;gap:8px">'+PHASES.map(function(ph,i){
        var ts=r.tasks.filter(function(t){return t.phase===ph.id}),dn=ts.filter(function(t){return t.done}).length;
        var open=openSet?openSet.has(ph.id):ph.id===r.phase;
        return '<details class="ph'+(ph.id===r.phase?' cur':'')+'" data-ph="'+ph.id+'"'+(open?' open':'')+'><summary><span>'+esc(ph.name)+'</span><span class="count num">'+dn+'/'+ts.length+'</span></summary><ul class="tasks">'+
          ts.map(function(t){return '<li class="'+(t.done?'done':'')+'"><input type="checkbox" id="t-'+t.id+'" data-task="'+t.id+'"'+(t.done?' checked':'')+'><label for="t-'+t.id+'">'+esc(t.text)+'</label><button class="x" data-act="deltask" data-task="'+t.id+'" aria-label="Remove task '+esc(t.text)+'">'+X+'</button></li>'}).join('')+'</ul>'+
          '<form class="addtask" data-ph="'+ph.id+'"><input id="add-'+ph.id+'" aria-label="Add a task to '+esc(ph.name)+'" placeholder="Add a task"><button type="submit">Add</button></form></details>';
      }).join('')+'</div>'+
      fld('f-notes','Notes','<textarea id="f-notes" data-f="notes">'+esc(r.notes)+'</textarea>');
    if(r.clientId)body+='<div><p class="lab">Client</p><ul class="linklist"><li><button data-act="open" data-k="client" data-id="'+esc(r.clientId)+'">'+esc(cname(r.clientId))+'</button></li></ul></div>';
  }else{
    head=['Client',r.name];
    var cst=clientStats(r);
    var ds=S.deals.filter(function(d){return d.clientId===r.id}),ps=S.projects.filter(function(p){return p.clientId===r.id});
    body=fld('f-name','Name','<input id="f-name" data-f="name" value="'+esc(r.name)+'">')+
      fld('f-company','Company','<input id="f-company" data-f="company" value="'+esc(r.company)+'">')+
      '<div class="g2">'+fld('f-email','Email','<input id="f-email" type="email" data-f="email" value="'+esc(r.email)+'">')+fld('f-phone','Phone','<input id="f-phone" type="tel" data-f="phone" value="'+esc(r.phone)+'">')+'</div>'+
      '<div class="stats">'+[['Jobs',String(cst.jobs)],['Sold value',money(cst.sold)],['Booked now',money(cst.booked)]].map(function(p){return '<div class="stat"><span>'+p[0]+'</span><b class="num">'+esc(p[1])+'</b></div>'}).join('')+'</div>'+
      '<div class="g2">'+fld('f-soldJobs','Past jobs (from Xero)','<input id="f-soldJobs" type="number" min="0" step="1" data-f="soldJobs" value="'+esc(r.soldJobs||0)+'">')+
      fld('f-soldValue','Past revenue (from Xero)','<div class="valrow"><input id="f-soldValue" type="number" min="0" step="0.01" data-f="soldValue" value="'+esc(r.soldValue||0)+'"><select id="f-soldCur" data-f="soldCur" aria-label="Currency">'+opts(Object.keys(CURS).map(function(c){return [c,c]}),r.soldCur||'NZD')+'</select></div>')+'</div>'+
      fld('f-followUp','Next follow-up','<input id="f-followUp" type="date" data-f="followUp" value="'+esc(r.followUp||'')+'">')+
      '<div class="dr-foot"><button class="btn ghost" data-act="snooze" data-d="7">In 1 week</button><button class="btn ghost" data-act="snooze" data-d="30">In 1 month</button><button class="btn ghost" data-act="snooze" data-d="0">Clear</button></div>'+
      fld('f-notes','Notes','<textarea id="f-notes" data-f="notes">'+esc(r.notes)+'</textarea>')+
      '<div><p class="lab">Deals</p>'+(ds.length?'<ul class="linklist">'+ds.map(function(d){return '<li><button data-act="open" data-k="deal" data-id="'+esc(d.id)+'"><span>'+esc(d.title)+'</span><span class="chip push">'+esc(byId(STAGES,d.stage).name)+'</span></button></li>'}).join('')+'</ul>':'<p class="hintline">No deals yet.</p>')+'</div>'+
      '<div><p class="lab">Projects</p>'+(ps.length?'<ul class="linklist">'+ps.map(function(p){return '<li><button data-act="open" data-k="project" data-id="'+esc(p.id)+'"><span>'+esc(p.title)+'</span><span class="chip push">'+esc(byId(PHASES,p.phase).name)+'</span></button></li>'}).join('')+'</ul>':'<p class="hintline">No projects yet.</p>')+'</div>';
    if(ds.length||ps.length)foot='<p class="hintline" style="width:100%">Remove this client\'s deals and projects before deleting them.</p>';
  }
  var canDel=!(dr.k==='client'&&S.deals.concat(S.projects).some(function(x){return x.clientId===r.id}));
  foot+='<button class="btn danger" data-act="del"'+(canDel?'':' disabled')+'>'+(dr.confirm?'Click again to delete':'Delete '+dr.k)+'</button>';
  el.innerHTML='<header class="dr-head"><div><p class="eyebrow">'+esc(head[0])+'</p><h2 id="dr-title">'+esc(head[1])+'</h2></div><button class="icon" data-act="close" aria-label="Close panel">'+X+'</button></header><div class="dr-body">'+body+'<div class="dr-foot">'+foot+'</div></div>';
  dr.fresh=false;
  var b2=el.querySelector('.dr-body');if(b2&&scroll)b2.scrollTop=scroll;
  if(active){var a=document.getElementById(active);if(a&&el.contains(a))a.focus()}
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');if(!t||t.disabled)return;
  var a=t.dataset.act;
  if(a==='nav'){closeDrawer();setView(t.dataset.v)}
  else if(a==='close')closeDrawer();
  else if(a==='open'){
    if(dr.k!==null){var keep=lastFocus;dr.k=null;openDrawer(t.dataset.k,t.dataset.id);lastFocus=keep}
    else openDrawer(t.dataset.k,t.dataset.id);
  }
  else if(a==='new')newRecord(ui.view==='projects'?'project':ui.view==='clients'?'client':'deal');
  else if(a==='sort'){var k2=t.dataset.v;if(ui.sort===k2)ui.dir=-ui.dir;else{ui.sort=k2;ui.dir=(k2==='name'||k2==='follow')?1:-1}render()}
  else if(a==='snooze'){var cr=rec('client',dr.id);cr.followUp=t.dataset.d==='0'?'':addDays(Number(t.dataset.d));save();renderDrawer();render()}
  else if(a==='addcancel'){dr.adding=null;renderDrawer()}
  else if(a==='settings'){if(dr.k===null)openDrawer('settings','x')}
  else if(a==='signout'){signOut()}
  else if(a==='setphase'){movePhase(dr.id,t.dataset.v);renderDrawer();render()}
  else if(a==='deltask'){var p=rec('project',dr.id);p.tasks=p.tasks.filter(function(x){return x.id!==t.dataset.task});save();renderDrawer();render()}
  else if(a==='del'){
    if(!dr.confirm){dr.confirm=true;renderDrawer();return}
    var k=dr.k,id=dr.id;deleteRec(k,id);dr.k=null;$('#drawer').hidden=true;$('#scrim').hidden=true;$('#drawer').innerHTML='';render();
    if(lastFocus&&document.contains(lastFocus))lastFocus.focus();
  }
});
document.addEventListener('change',function(e){
  var t=e.target;
  if(t.id==='svc'){ui.svc=t.value;render();return}
  if(dr.k==='settings'){
    if(t.dataset.base){S.settings.base=t.value}
    else if(t.dataset.rate){var n=Number(t.value);if(n>0)S.settings.rates[t.dataset.rate]=n}
    save();render();return;
  }
  if(dr.k===null)return;
  if(t.dataset.f&&t.value==='__new__'){dr.adding=t.dataset.f;renderDrawer();var nn=document.getElementById('new-name');if(nn)nn.focus();return}
  if(t.dataset.task){
    var p=rec('project',dr.id),task=p.tasks.filter(function(x){return x.id===t.dataset.task})[0];
    task.done=t.checked;save();
    t.closest('li').classList.toggle('done',t.checked);
    var det=t.closest('details'),ph=det.dataset.ph,ts=p.tasks.filter(function(x){return x.phase===ph});
    det.querySelector('.count').textContent=ts.filter(function(x){return x.done}).length+'/'+ts.length;
    var pr=progress(p);var lab=document.querySelector('#drawer .prog');
    if(lab){lab.firstElementChild.style.width=pr.pct+'%';lab.previousElementSibling.textContent='Progress: '+pr.d+' of '+pr.t+' tasks done'}
    render();return;
  }
  var f=t.dataset.f;if(!f)return;
  var r=rec(dr.k,dr.id),v=t.type==='number'?(Number(t.value)||0):t.value;
  if(f==='value'||f==='soldValue')v=Math.max(0,v);
  if(f==='soldJobs')v=Math.max(0,Math.round(v));
  if(dr.k==='deal'&&f==='stage'){moveDeal(dr.id,v)}
  else{r[f]=v;if(dr.k==='project'&&f==='service'&&!r.tasks.some(function(x){return x.done})){r.tasks=mkTasks(v,PHASES.map(function(p){return p.id}).indexOf(r.phase),0)}}
  save();
  var titleField=(f==='title'||f==='name'||f==='stage'||f==='service');
  if(titleField)renderDrawer();
  render();
});
document.addEventListener('submit',function(e){
  var af=e.target.closest('.inlineadd');
  if(af){
    e.preventDefault();
    var nm=$('#new-name').value.trim();if(!nm)return;
    var r2=rec(dr.k,dr.id);
    if(af.dataset.add==='clientId'){
      var c=mkClient({name:nm,company:($('#new-company')?$('#new-company').value.trim():'')});
      S.clients.push(c);r2.clientId=c.id;
    }else{
      var key=nm.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'service',base=key,n=2;
      while(SERVICES[key]){
        if(SERVICES[key].toLowerCase()===nm.toLowerCase())break;
        key=base+'-'+(n++);
      }
      if(!SERVICES[key]){S.settings.services=Object.assign({},S.settings.services,{[key]:nm});refreshServices();fillSvcFilter()}
      r2.service=key;
      if(dr.k==='project'&&!r2.tasks.some(function(x){return x.done}))r2.tasks=mkTasks(key,PHASES.map(function(p){return p.id}).indexOf(r2.phase),0);
    }
    dr.adding=null;save();renderDrawer();render();
    return;
  }
  var f=e.target.closest('.addtask');if(!f)return;
  e.preventDefault();
  var inp=f.querySelector('input'),text=inp.value.trim();if(!text)return;
  var p=rec('project',dr.id);p.tasks.push({id:uid('t'),phase:f.dataset.ph,text:text,done:false});
  save();var id='add-'+f.dataset.ph;renderDrawer();render();
  var n=document.getElementById(id);if(n)n.focus();
});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&dr.k!==null)closeDrawer()});
$('#q').addEventListener('input',function(e){ui.q=e.target.value.trim();var pos=e.target.selectionStart;render();});

/* CSV import */
function parseCSV(text){
  text=text.replace(/^\uFEFF/,'');
  var rows=[],row=[],cur='',q=false,i,c;
  for(i=0;i<text.length;i++){
    c=text[i];
    if(q){
      if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}
      else cur+=c;
    }else if(c==='"')q=true;
    else if(c===','){row.push(cur);cur=''}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cur);cur='';
      if(row.some(function(x){return x.trim()!==''}))rows.push(row);
      row=[];
    }else cur+=c;
  }
  row.push(cur);
  if(row.some(function(x){return x.trim()!==''}))rows.push(row);
  return rows;
}
var HMAP={name:['name','fullname','contact','contactname','client','clientname','customer','customername'],first:['firstname','first','givenname'],last:['lastname','last','surname','familyname'],company:['company','companyname','organization','organisation','business'],email:['email','emailaddress','mail'],phone:['phone','phonenumber','mobile','mobilephone','tel','telephone'],notes:['notes','note','comments','comment'],jobs:['jobs','jobcount','numberofjobs','numjobs'],follow:['followupdate','followup','nextfollowup','nextfollowupdate']};
function parseMoney(v){var n=Number(String(v==null?'':v).replace(/[^0-9.\-]/g,''));return isFinite(n)?n:0}
function parseDate(v){
  v=String(v||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
  var m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){var d=Number(m[1]),mo=Number(m[2]);if(d>=1&&d<=31&&mo>=1&&mo<=12)return m[3]+'-'+pad(mo)+'-'+pad(d)}
  return '';
}
function importCSV(text){
  var rows=parseCSV(text);
  if(rows.length<2){toast('That file has no contact rows. The first row must be column headings.');return}
  var heads=rows[0].map(function(h){return h.toLowerCase().replace(/[^a-z0-9]/g,'')});
  var col={};
  Object.keys(HMAP).forEach(function(k){for(var j=0;j<heads.length;j++){if(HMAP[k].indexOf(heads[j])>=0){col[k]=j;break}}});
  for(var j2=0;j2<heads.length;j2++){if(/^(totalrevenue|revenue|totalsold|soldvalue)/.test(heads[j2])){col.revenue=j2;break}}
  if(col.name===undefined&&col.first===undefined&&col.email===undefined){toast('No name or email column found. Check the column headings.');return}
  var cm=col.revenue!==undefined?String(rows[0][col.revenue]).match(/\b(NZD|AUD|USD|THB)\b/i):null;
  var revCur=cm?cm[1].toUpperCase():S.settings.base;
  var get=function(r,k){return col[k]===undefined?'':String(r[col[k]]||'').trim()};
  var existing={};S.clients.forEach(function(c){if(c.email)existing[c.email.toLowerCase()]=c});
  var hasSold=col.jobs!==undefined||col.revenue!==undefined||col.follow!==undefined;
  var added=0,updated=0,dupes=0,bad=0;
  rows.slice(1).forEach(function(r){
    var name=get(r,'name')||(get(r,'first')+' '+get(r,'last')).trim(),email=get(r,'email');
    if(!name)name=email;
    if(!name){bad++;return}
    var jobs=Math.max(0,Math.round(parseMoney(get(r,'jobs')))),rev=Math.max(0,parseMoney(get(r,'revenue'))),fu=parseDate(get(r,'follow'));
    var notes=get(r,'notes');if(/^Xero top \d+ #\d+:/i.test(notes))notes='';
    var ex=email?existing[email.toLowerCase()]:null;
    if(ex){
      if(hasSold){
        if(col.jobs!==undefined)ex.soldJobs=jobs;
        if(col.revenue!==undefined){ex.soldValue=rev;ex.soldCur=revCur}
        if(fu)ex.followUp=fu;
        updated++;
      }else dupes++;
      return;
    }
    var c=mkClient({name:name,company:get(r,'company'),email:email,phone:get(r,'phone'),notes:notes,soldJobs:jobs,soldValue:rev,soldCur:revCur,followUp:fu});
    S.clients.push(c);if(email)existing[email.toLowerCase()]=c;
    added++;
  });
  save();render();
  toast('Imported '+added+' new client'+(added===1?'':'s')+(updated?', updated '+updated+' existing':'')+(dupes?', skipped '+dupes+' duplicate'+(dupes===1?'':'s'):'')+(bad?', '+bad+' row'+(bad===1?'':'s')+' had no name or email':'')+'.');
}
$('#importbtn').addEventListener('click',function(){$('#csvfile').click()});
$('#csvfile').addEventListener('change',function(e){
  var f=e.target.files&&e.target.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){importCSV(String(rd.result||''))};
  rd.onerror=function(){toast('Could not read that file.')};
  rd.readAsText(f);
  e.target.value='';
});

/* drag and drop */
var viewEl=$('#view');
viewEl.addEventListener('dragstart',function(e){
  var c=e.target.closest('[data-card]');if(!c)return;
  drag={k:c.dataset.k,id:c.dataset.id};
  try{e.dataTransfer.setData('text/plain',drag.id);e.dataTransfer.effectAllowed='move'}catch(x){}
  c.classList.add('dragging');
});
viewEl.addEventListener('dragend',function(){drag=null;viewEl.querySelectorAll('.dragging,.over').forEach(function(n){n.classList.remove('dragging','over')})});
viewEl.addEventListener('dragover',function(e){var c=e.target.closest('.colm');if(!c||!drag)return;e.preventDefault();c.classList.add('over')});
viewEl.addEventListener('dragleave',function(e){var c=e.target.closest('.colm');if(c&&!c.contains(e.relatedTarget))c.classList.remove('over')});
viewEl.addEventListener('drop',function(e){
  var c=e.target.closest('.colm');if(!c||!drag)return;
  e.preventDefault();
  if(drag.k==='deal')moveDeal(drag.id,c.dataset.col);else movePhase(drag.id,c.dataset.col);
  drag=null;render();
});

/* ---------- auth and start-up ---------- */
var VIEWS=['dashboard','pipeline','projects','clients'];
function showAuth(mode,msg){
  $('#loading').hidden=true;$('.app').hidden=true;$('#auth').hidden=false;
  $('#loginform').hidden=mode!=='login';$('#resetform').hidden=mode!=='reset';$('#newpwform').hidden=mode!=='newpw';
  var m=$('#authmsg');m.textContent=msg||'';m.classList.toggle('ok',false);
  var f=mode==='login'?$('#au-email'):mode==='reset'?$('#re-email'):$('#np-pass');if(f)f.focus();
}
function authOk(msg){var m=$('#authmsg');m.textContent=msg;m.classList.add('ok')}
async function enter(sess){
  session=sess;
  $('#auth').hidden=true;$('#loading').hidden=false;$('#loading').textContent='Loading your data…';
  try{await dbLoad()}catch(err){
    console.error(err);
    $('#loading').innerHTML='Could not load your data. <button class="btn" id="retryload" type="button">Try again</button>';
    $('#retryload').addEventListener('click',function(){enter(session)});
    return;
  }
  $('#loading').hidden=true;$('.app').hidden=false;
  var h=(location.hash||'').replace('#','');
  ui.view=VIEWS.indexOf(h)>=0?h:'dashboard';
  setSaveState('All changes saved');
  render();
}
async function signOut(){
  closeDrawer();
  try{await queue}catch(e){}
  await sb.auth.signOut();
  session=null;S={clients:[],deals:[],projects:[],settings:DEFAULT_SETTINGS()};
  snap={clients:{},projects:{},deals:{},tasks:{},settings:''};
  showAuth('login');
}
$('#loginform').addEventListener('submit',async function(e){
  e.preventDefault();
  var btn=$('#loginbtn');btn.disabled=true;
  var r=await sb.auth.signInWithPassword({email:$('#au-email').value.trim(),password:$('#au-pass').value});
  btn.disabled=false;
  if(r.error){$('#authmsg').classList.remove('ok');$('#authmsg').textContent='That email and password did not match. Try again.';return}
  $('#au-pass').value='';
  enter(r.data.session);
});
$('#forgotbtn').addEventListener('click',function(){showAuth('reset')});
$('#backbtn').addEventListener('click',function(){showAuth('login')});
$('#resetform').addEventListener('submit',async function(e){
  e.preventDefault();
  var r=await sb.auth.resetPasswordForEmail($('#re-email').value.trim(),{redirectTo:location.origin+location.pathname});
  if(r.error){$('#authmsg').classList.remove('ok');$('#authmsg').textContent='Could not send the email. Try again in a minute.';return}
  authOk('If that email has an account, a reset link is on its way.');
});
$('#newpwform').addEventListener('submit',async function(e){
  e.preventDefault();
  var p=$('#np-pass').value;
  if(p.length<10){$('#authmsg').classList.remove('ok');$('#authmsg').textContent='Use at least 10 characters.';return}
  var r=await sb.auth.updateUser({password:p});
  if(r.error){$('#authmsg').classList.remove('ok');$('#authmsg').textContent=r.error.message;return}
  $('#np-pass').value='';
  var g=await sb.auth.getSession();enter(g.data.session);
});
fillSvcFilter();
window.addEventListener('hashchange',function(){var n=(location.hash||'').replace('#','');if(session&&VIEWS.indexOf(n)>=0&&n!==ui.view){ui.view=n;render()}});
(async function boot(){
  if(!window.supabase||!window.CONFIG){$('#loading').textContent='App failed to load. Refresh the page.';return}
  sb=window.supabase.createClient(window.CONFIG.url,window.CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  var recovery=/type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange(function(ev){
    if(ev==='PASSWORD_RECOVERY'){recovery=true;showAuth('newpw')}
    else if(ev==='SIGNED_OUT'&&session){session=null;showAuth('login')}
  });
  var g=await sb.auth.getSession();
  if(recovery){showAuth('newpw');return}
  if(g.data.session)enter(g.data.session);else showAuth('login');
})();
})();
