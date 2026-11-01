(function(){
//#core
function pad(n){return(n<10?"0":"")+n}
function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function idxOf(s){return +s.slice(0,4)*12+ +s.slice(5,7)-1}
function ymOf(i){return Math.floor(i/12)+"-"+pad(i%12+1)}
function dnum(s){return Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/864e5}
function dueIn(it,i){var s=idxOf(it.date);if(i<s)return false;if(it.freq===0)return i===s;if(it.until&&i>idxOf(it.until))return false;if(it.gaps&&inGap(it,i))return false;if(it.freq>=12)return true;return (i-s)%(12/it.freq)===0}
function monthAmt(it,i){if(!dueIn(it,i))return 0;return it.freq<=12?it.amt:it.amt*it.freq/12}
function yearAmt(it,y){var t=0;for(var m=0;m<12;m++)t+=monthAmt(it,y*12+m);return t}
function inGap(it,i){var g=it.gaps;if(!g)return false;for(var k=0;k<g.length;k++){if(i>=idxOf(g[k].a)&&(!g[k].b||i<=idxOf(g[k].b)))return true}return false}
function recStatus(it,ci){if(it.freq===0)return "once";if(it.until&&ci>idxOf(it.until))return "ended";if(idxOf(it.date)>ci)return "later";if(inGap(it,ci))return "paused";return "active"}
function pauseIt(it,ci){if(!(it.gaps||[]).some(function(g){return !g.b}))it.gaps=(it.gaps||[]).concat([{a:ymOf(ci),b:null}])}
function resumeIt(it,ci){var gs=(it.gaps||[]).slice();
  if(it.until&&idxOf(it.until)<ci&&idxOf(it.until)+1<=ci-1)gs.push({a:ymOf(idxOf(it.until)+1),b:ymOf(ci-1)});
  it.until=null;
  gs=gs.map(function(g){if(g.b)return g;return idxOf(g.a)>=ci?null:{a:g.a,b:ymOf(ci-1)}}).filter(Boolean);
  if(gs.length)it.gaps=gs;else delete it.gaps}
function endIt(it,ci){it.until=ymOf(Math.max(ci,idxOf(it.date)))}
function parseTags(s){var out=[],seen={};String(s==null?"":s).split(/[,;\s]+/).forEach(function(t){t=t.replace(/^#+/,"").replace(/[<>"'&`\\]/g,"").trim().toLowerCase().slice(0,24);if(t&&!seen[t]&&out.length<8){seen[t]=1;out.push(t)}});return out}
function fold(s){s=String(s==null?"":s).toLowerCase();try{s=s.normalize("NFD").replace(/[̀-ͯ]/g,"")}catch(e){}return s.replace(/ς/g,"σ")}
function qTokens(q){return fold(q).split(/\s+/).filter(Boolean)}
function qMatch(it,toks,label){if(!toks.length)return true;var hay=null,tg=it.tags||[];
  for(var k=0;k<toks.length;k++){var t=toks[k];
    if(t.charAt(0)==="#"){var w=t.slice(1);if(!w)continue;var ok=false;for(var j=0;j<tg.length;j++)if(fold(tg[j]).indexOf(w)===0){ok=true;break}if(!ok)return false}
    else{if(hay===null)hay=fold(it.name+" "+it.cat+" "+(label||"")+" "+tg.join(" "));if(hay.indexOf(t)<0)return false}}
  return true}
function goalInfo(g,ci){var tg=+g.target||0,sv=+g.saved||0,left=Math.max(0,tg-sv),r={left:left,pct:tg>0?Math.min(100,sv/tg*100):0,done:tg>0&&sv>=tg,n:null,per:null,late:false};
  if(g.by&&!r.done){var n=idxOf(g.by)-ci+1;if(n>=1){r.n=n;r.per=left/n}else r.late=true}return r}
function r2(x){return Math.round(x*100)/100}
function flVatOf(o){var r=+o.vr||0;if(!(r>0))return 0;return o.incl?r2(o.amt-o.amt/(1+r/100)):r2(o.amt*r/100)}
function flNet(o){return (+o.vr>0&&o.incl)?r2(o.amt-flVatOf(o)):o.amt}
function flGross(o){return (+o.vr>0&&!o.incl)?r2(o.amt+flVatOf(o)):o.amt}
function flCost(o){return o.vd===false?flGross(o):flNet(o)}
function vatPeriod(i,mode){if(mode==="m")return {key:ymOf(i),from:i,to:i};var y=Math.floor(i/12),q=Math.floor((i%12)/3);return {key:y+"-Q"+(q+1),from:y*12+q*3,to:y*12+q*3+2,q:q+1,y:y}}
function vatSum(items,from,to){var r={out:0,inn:0,unp:0,n:0};(items||[]).forEach(function(o){var i=idxOf(o.date);if(i<from||i>to)return;var v=flVatOf(o);if(!(v>0))return;
  if(o.type==="out"){if(o.vd!==false)r.inn+=v}else{r.out+=v;if(!o.paid)r.unp+=v}r.n++});r.out=r2(r.out);r.inn=r2(r.inn);r.unp=r2(r.unp);r.due=r2(r.out-r.inn);return r}
function vatDeadline(to){var n=to+1,y=Math.floor(n/12),m=n%12;return ymd(new Date(y,m+1,0))}
function clientStats(items,year){var m={};(items||[]).forEach(function(o){if(o.type==="out")return;if(year!=null&&+o.date.slice(0,4)!==year)return;var k=o.client||"",e=m[k]||(m[k]={n:0,net:0,pend:0,last:""});e.n++;var n=flNet(o);if(o.paid)e.net+=n;else e.pend+=n;if(o.date>e.last)e.last=o.date});return m}
function flReport(items,i){var r={earn:0,pend:0,vat:0,gross:0,exp:0,inn:0,clients:{},cats:{},rows:[]};
  (items||[]).forEach(function(o){if(idxOf(o.date)!==i)return;r.rows.push(o);var v=flVatOf(o);
    if(o.type==="out"){var c=flCost(o);r.exp+=c;if(o.vd!==false)r.inn+=v;var k=o.cat||"";r.cats[k]=(r.cats[k]||0)+c}
    else{var n=flNet(o),g=flGross(o),ck=o.client||"",e=r.clients[ck]||(r.clients[ck]={n:0,net:0,vat:0,gross:0,pend:0});e.n++;e.net+=n;e.vat+=v;e.gross+=g;r.vat+=v;r.gross+=g;if(o.paid)r.earn+=n;else{r.pend+=n;e.pend+=n}}});
  r.profit=r.earn-r.exp;return r}
function dueDateOf(day,i){var y=Math.floor(i/12),m=i%12,l=new Date(y,m+1,0).getDate();return y+"-"+pad(m+1)+"-"+pad(Math.min(day,l))}
function remindersFor(cats,items,today,snooze,now){
  var ti=idxOf(today),out=[];
  cats.forEach(function(c){
    if(!c.bill)return;
    var every=c.every||1,mine=items.filter(function(it){return it.cat===c.name});
    if(!mine.length)return;
    var last=mine.reduce(function(a,b){return b.date>a.date?b:a}),li=idxOf(last.date),day=c.dueDay||+last.date.slice(8,10);
    for(var i=li+every;i<=ti+1;i+=every){
      if(i<ti-24)continue;
      var key=c.name+"|"+ymOf(i);if(snooze&&snooze[key]>now)continue;
      var due=dueDateOf(day,i),days=dnum(due)-dnum(today);
      if(days<=3)out.push({cat:c,key:key,month:ymOf(i),due:due,days:days})}});
  out.sort(function(a,b){return a.days-b.days});return out}
function savedMonths(firstIdx,ci,year){var a=Math.max(firstIdx,year*12),b=Math.min(ci-1,year*12+11),r=[];for(var i=a;i<=b;i++)r.push(i);return r}
function prevBill(items,it){var best=null;items.forEach(function(o){if(o===it||o.cat!==it.cat)return;
  var before=o.date<it.date||(o.date===it.date&&(o.created||"")<(it.created||""));if(!before)return;
  if(!best||o.date>best.date||(o.date===best.date&&(o.created||"")>(best.created||"")))best=o});return best}
var XP=[{k:"xmas",n:"Christmas",d:11},{k:"easter",n:"Easter",d:3},{k:"summer",n:"Summer",d:7}];
function xpays(st){var p=+st.payments||12;if(p<=12)return [];var hf=st.half||"summer";
  return XP.map(function(x){var m=st.xm&&st.xm[x.k]!=null?+st.xm[x.k]:x.d;
    var mult=p>=14.5?(x.k===hf?.5:1):(x.k==="xmas"?1:.5);return {k:x.k,n:x.n,m:m,mult:mult}})}
function baseBudget(st,i){var b=st.budgets&&st.budgets[ymOf(i)];return b!=null?+b:(+st.income||0)}
function oneSum(st,i,to){return (st.oneoff||[]).reduce(function(t,o){return t+(o.to===to&&idxOf(o.date)===i?(+o.amt||0):0)},0)}
function budgetOf(st,i){return baseBudget(st,i)+oneSum(st,i,"budget")}
function extraSav(st,i){var s=+st.salary||0,m=((i%12)+12)%12,t=0;
  xpays(st).forEach(function(x){if(x.m===m)t+=s*x.mult});
  return t+oneSum(st,i,"savings")}
function planSav(st,i){return (+st.salary||0)-baseBudget(st,i)+extraSav(st,i)}
function wdSum(st,i){return (st.withdraw||[]).reduce(function(t,o){return t+(idxOf(o.date)===i?(+o.amt||0):0)},0)}
function realSav(st,i,spent){return (+st.salary||0)+oneSum(st,i,"budget")+extraSav(st,i)-spent-wdSum(st,i)}
function flMonth(items,i){var r={earn:0,exp:0,pend:0};(items||[]).forEach(function(o){if(idxOf(o.date)!==i)return;if(o.type==="out")r.exp+=flCost(o);else if(o.paid)r.earn+=flNet(o);else r.pend+=flNet(o)});return r}
function flYearT(items,y){var r={earn:0,exp:0,pend:0};for(var m=0;m<12;m++){var t=flMonth(items,y*12+m);r.earn+=t.earn;r.exp+=t.exp;r.pend+=t.pend}return r}
var TAX_NEW=[[10000,.09],[10000,.20],[10000,.26],[10000,.34],[20000,.39],[Infinity,.44]],TAX_OLD=[[10000,.09],[10000,.22],[10000,.28],[10000,.36],[Infinity,.44]];
function taxScale(year,age){if(year<2026)return TAX_OLD.map(function(b){return b.slice()});var s=TAX_NEW.map(function(b){return b.slice()});
  if(age==="25"){s[0][1]=0;s[1][1]=0}else if(age==="26"){s[1][1]=.09}return s}
function calcTax(income,scale){var left=Math.max(0,income),from=0,rows=[],tot=0;
  scale.forEach(function(b){var take=Math.min(left,b[0]);if(take>0){var t=take*b[1];rows.push({from:from,to:from+take,amt:take,rate:b[1],tax:t});tot+=t}left-=take;from+=b[0]});
  return {tax:tot,rows:rows}}
function calcFreelance(o){var efka=(+o.efka||0)*12,pre=(+o.rev||0)-(+o.exp||0),taxable=Math.max(0,pre-efka),t=calcTax(taxable,taxScale(o.year,o.age)),fee=+o.fee||0;
  return {rev:+o.rev||0,exp:+o.exp||0,efka:efka,taxable:taxable,tax:t.tax,rows:t.rows,fee:fee,net:pre-efka-t.tax-fee,prepay:o.first?0:t.tax*0.55,eff:pre>0?t.tax/pre:0,aside:pre>0?(t.tax+fee)/pre:0}}
function catStats(st,today){
  var ci=idxOf(today),items=st.items||[],cats=st.cats||[],isB={};cats.forEach(function(c){if(c.bill)isB[c.name]=1});
  var first=ci;if(items.length){first=Infinity;for(var fi=0;fi<items.length;fi++){var fx=idxOf(items[fi].date);if(fx<first)first=fx}}
  var prev=[];for(var k=1;k<=3;k++)if(ci-k>=first)prev.push(ci-k);
  function catM(c,i){return items.reduce(function(t,it){return it.cat===c?t+monthAmt(it,i):t},0)}
  function totM(i){return items.reduce(function(t,it){return t+monthAmt(it,i)},0)}
  var names={};items.forEach(function(it){names[it.cat]=1});
  var rows=Object.keys(names).map(function(c){var cur=catM(c,ci),avg=prev.length?prev.reduce(function(t,i){return t+catM(c,i)},0)/prev.length:0;return {cat:c,cur:cur,avg:avg,bill:!!isB[c]}});
  return {ci:ci,n:prev.length,rows:rows,sp:totM(ci),b:budgetOf(st,ci),avgTot:prev.length?prev.reduce(function(t,i){return t+totM(i)},0)/prev.length:0,isB:isB}}
function insightsFor(st,today){
  var S=catStats(st,today),items=st.items||[],out=[],ci=S.ci,b=S.b,sp=S.sp;
  if(!items.length)return out;
  var dd=+today.slice(8,10),dim=new Date(+today.slice(0,4),+today.slice(5,7),0).getDate(),left=dim-dd+1;
  if(b>0&&sp>b)out.push({id:"over",tone:"warn",w:1e9,over:sp-b});
  else if(b>0&&sp>=b*0.85&&left>0)out.push({id:"near",tone:"warn",w:1e8,left:b-sp,days:left,perDay:(b-sp)/left});
  S.rows.forEach(function(r){
    if(r.bill)return;
    if(S.n>=2&&r.avg>0&&r.cur>r.avg*1.25&&r.cur-r.avg>=10)out.push({id:"rise",tone:"tip",w:(r.cur-r.avg)*12,cat:r.cat,pct:Math.round((r.cur/r.avg-1)*100),avg:r.avg,yearly:(r.cur-r.avg)*12});
    else if(S.n>=2&&r.avg>0&&r.cur<r.avg*0.85&&r.avg-r.cur>=10)out.push({id:"down",tone:"good",w:1,cat:r.cat,pct:Math.round((1-r.cur/r.avg)*100)})});
  var subs=items.filter(function(it){return it.cat==="Subscriptions"&&it.freq!==0&&yearAmt(it,Math.floor(ci/12))>0});
  if(subs.length>=2)out.push({id:"subs",tone:"tip",w:subs.reduce(function(t,it){return t+yearAmt(it,Math.floor(ci/12))},0)*0.3,n:subs.length,yearly:subs.reduce(function(t,it){return t+yearAmt(it,Math.floor(ci/12))},0)});
  (st.cats||[]).forEach(function(c){if(!c.bill)return;
    var m=items.filter(function(it){return it.cat===c.name}).sort(function(a,b2){return a.date<b2.date?-1:a.date>b2.date?1:((a.created||"")<(b2.created||"")?-1:1)});
    if(m.length<2)return;var l=m[m.length-1],p=m[m.length-2];
    if(idxOf(l.date)>=ci-3&&p.amt>0&&l.amt>p.amt*1.1&&l.amt-p.amt>=3)out.push({id:"bill",tone:"warn",w:(l.amt-p.amt)*12/(c.every||1),cat:c.name,pct:Math.round((l.amt/p.amt-1)*100),diff:l.amt-p.amt})});
  var base=+st.income||0;
  if(S.n>=2&&base>0&&S.avgTot>0&&S.avgTot<base*0.8&&base-S.avgTot>=20){var tgt=Math.ceil(S.avgTot*1.05/10)*10;if(tgt<base)out.push({id:"lowerbudget",tone:"tip",w:(base-tgt)*12,diff:base-S.avgTot,tgt:tgt,yearly:(base-tgt)*12})}
  var top=null;S.rows.forEach(function(r){if(!r.bill&&(!top||r.cur>top.cur))top=r});
  if(top&&sp>0&&top.cur/sp>=0.3&&top.cur>=10)out.push({id:"trim",tone:"tip",w:top.cur*0.1*12*0.5,cat:top.cat,share:Math.round(top.cur/sp*100),yearly:top.cur*0.1*12});
  out.sort(function(a,b2){return b2.w-a.w});
  return out.slice(0,4)}
/* ---- merchants (names matched ignoring case, accents and Greek/Latin spelling) ---- */
function nrm(s){return fold(s).replace(/[^a-z0-9α-ω]+/g," ").replace(/^ +| +$/g,"")}
var GRM={"α":["a"],"β":["v","b"],"γ":["g"],"δ":["d"],"ε":["e"],"ζ":["z"],"η":["i","h"],"θ":["th"],"ι":["i"],"κ":["k","c"],"λ":["l"],"μ":["m"],"ν":["n"],"ξ":["x","ks"],"ο":["o"],"π":["p"],"ρ":["r"],"σ":["s"],"τ":["t"],"υ":["y","i","u"],"φ":["f","ph"],"χ":["ch","h","x"],"ψ":["ps"],"ω":["o","w"]};
var GRD={"ου":["ou","u"],"αι":["ai","e"],"ει":["ei","i"],"οι":["oi","i"],"μπ":["b","mp"],"ντ":["nt","d"],"γκ":["g","gk"],"τσ":["ts"],"τζ":["tz"],"αυ":["av","au","af"],"ευ":["ev","ef","eu"]};
function grVar(s){var res=[""],i=0,two,opts,nx;
  while(i<s.length){two=s.substr(i,2);if(GRD[two]){opts=GRD[two];i+=2}else{opts=GRM[s.charAt(i)]||[s.charAt(i)];i++}
    nx=[];for(var a=0;a<res.length;a++)for(var b=0;b<opts.length;b++)if(nx.length<48)nx.push(res[a]+opts[b]);res=nx}
  return res}
//  key|English name|Greek name|default category|extra spellings (comma separated)
var MERCH_SRC=[
"sklavenitis|Sklavenitis|Σκλαβενίτης|Supermarket|sklaveniths",
"ab|AB Vassilopoulos|ΑΒ Βασιλόπουλος|Supermarket|ab,αβ,ab basilopoulos,ab shop go",
"lidl|Lidl|Lidl|Supermarket|λιντλ,λιντλ",
"mymarket|My Market|My Market|Supermarket|mymarket,μαι μαρκετ",
"masoutis|Masoutis|Μασούτης|Supermarket|masoutes",
"galaxias|Galaxias|Γαλαξίας|Supermarket|",
"kritikos|Kritikos|Κρητικός|Supermarket|",
"bazaar|Bazaar|Bazaar|Supermarket|μπαζαρ",
"themart|The Mart|The Mart|Supermarket|themart,ντε μαρτ",
"marketin|Market In|Market In|Supermarket|marketin,μαρκετ ιν",
"spar|Spar|Spar|Supermarket|σπαρ",
"shell|Shell|Shell|Transport|σελ",
"bp|BP|BP|Transport|μπι πι",
"eko|EKO|ΕΚΟ|Transport|",
"avin|Avin|Avin|Transport|αβιν",
"aegean|Aegean|Aegean|Transport|aegean oil,aegean airlines,αιγαιον,αιγαιο",
"revoil|Revoil|Revoil|Transport|ρεβοιλ",
"cyclon|Cyclon|Cyclon|Transport|κυκλων",
"elin|Elin|ΕΛΙΝ|Transport|",
"uber|Uber|Uber|Transport|ουμπερ",
"freenow|FREENOW|FREENOW|Transport|free now,beat,μπιτ",
"olympic|Olympic Air|Ολυμπιακή|Transport|olympic",
"skyexpress|Sky Express|Sky Express|Transport|skyexpress,σκαι εξπρες",
"ryanair|Ryanair|Ryanair|Transport|ραιναιρ",
"bluestar|Blue Star Ferries|Blue Star|Transport|bluestar,μπλου σταρ",
"seaways|Hellenic Seaways|Hellenic Seaways|Transport|",
"attikiodos|Attiki Odos|Αττική Οδός|Transport|",
"olympiaodos|Olympia Odos|Ολυμπία Οδός|Transport|",
"egnatia|Egnatia Odos|Εγνατία Οδός|Transport|egnatia",
"oasa|OASA|ΟΑΣΑ|Transport|",
"osy|OSY|ΟΣΥ|Transport|",
"cosmote|Cosmote|Cosmote|Mobile phone|κοσμοτε",
"vodafone|Vodafone|Vodafone|Mobile phone|βοντάφον,βοδαφον",
"wind|Wind|Wind|Mobile phone|ουιντ",
"nova|Nova|Nova|Internet|νοβα",
"forthnet|Forthnet|Forthnet|Internet|φορθνετ",
"ote|OTE|ΟΤΕ|Internet|",
"dei|PPC|ΔΕΗ|Electricity|dei,deh,public power corporation",
"heron|Heron|Heron|Electricity|ηρων",
"protergia|Protergia|Protergia|Electricity|προτεργια",
"elpedison|Elpedison|Elpedison|Electricity|ελπεδισον",
"deddie|DEDDIE|ΔΕΔΔΗΕ|Electricity|heddie",
"eydap|EYDAP|ΕΥΔΑΠ|Water|eydap,eudap,evdap",
"eyath|EYATH|ΕΥΑΘ|Water|eyath,euath,evath",
"gas|Natural gas|Φυσικό Αέριο|Bills|fysiko aerio,epa,depa,δεπα,natural gas",
"efood|efood|efood|Food|εφουντ",
"wolt|Wolt|Wolt|Food|ουολτ",
"starbucks|Starbucks|Starbucks|Food|σταρμπακς",
"everest|Everest|Everest|Food|εβερεστ",
"coffeeisland|Coffee Island|Coffee Island|Food|κοφι αιλαντ",
"mikel|Mikel|Mikel|Food|μικελ",
"goodys|Goody's|Goody's|Food|goodys,γκουντις",
"flocafe|Flocafe|Flocafe|Food|φλοκαφε",
"mcdonalds|McDonald's|McDonald's|Food|mcdonalds,mc donalds,μακντοναλντς",
"kfc|KFC|KFC|Food|",
"dominos|Domino's|Domino's|Food|dominos,ντομινος",
"pizzafan|Pizza Fan|Pizza Fan|Food|πιτσα φαν",
"venetis|Venetis|Βενέτης|Food|",
"netflix|Netflix|Netflix|Subscriptions|νετφλιξ",
"spotify|Spotify|Spotify|Subscriptions|σποτιφαι",
"disney|Disney+|Disney+|Subscriptions|disney,disney plus,ντισνευ",
"youtube|YouTube|YouTube|Subscriptions|γιουτουμπ",
"apple|Apple|Apple|Subscriptions|icloud,apple music,app store",
"google|Google|Google|Subscriptions|google one,google play",
"microsoft|Microsoft|Microsoft|Subscriptions|microsoft 365,office 365",
"adobe|Adobe|Adobe|Subscriptions|",
"piraeus|Piraeus Bank|Τράπεζα Πειραιώς|Bills|piraeus,πειραιως",
"alphabank|Alpha Bank|Alpha Bank|Bills|αλφα μπανκ,αλφα τραπεζα",
"eurobank|Eurobank|Eurobank|Bills|ευρωτραπεζα",
"nbg|National Bank|Εθνική Τράπεζα|Bills|nbg,εθνικη τραπεζα",
"loan|Loan|Δάνειο|Bank|δανεια,loans",
"installments|Installments|Δόσεις|Bank|δοση,installment",
"interamerican|Interamerican|Interamerican|Bills|ιντεραμερικαν",
"ethniki|Ethniki Insurance|Εθνική Ασφαλιστική|Bills|ethniki asfalistiki",
"generali|Generali|Generali|Bills|τζενεραλι",
"hygeia|Hygeia|Υγεία|Health|ygeia,igia",
"metropolitan|Metropolitan|Metropolitan|Health|μητροπολιταν",
"iatriko|Iatriko|Ιατρικό|Health|",
"holmes|Holmes Place|Holmes Place|Leisure|holmesplace",
"village|Village Cinemas|Village Cinemas|Leisure|village cinema,villagecinemas",
"odeon|Odeon|Odeon|Leisure|οδεον",
"intersport|Intersport|Intersport|Leisure|ιντερσπορτ",
"decathlon|Decathlon|Decathlon|Leisure|ντεκαθλον",
"cosmossport|Cosmos Sport|Cosmos Sport|Leisure|κοσμος σπορ",
"public|Public|Public|Other|παμπλικ",
"kotsovolos|Kotsovolos|Κωτσόβολος|Other|",
"mediamarkt|MediaMarkt|MediaMarkt|Other|media markt,μιντια μαρκτ",
"plaisio|Plaisio|Πλαίσιο|Other|",
"germanos|Germanos|Γερμανός|Other|",
"skroutz|Skroutz|Skroutz|Other|σκρουτζ",
"amazon|Amazon|Amazon|Other|αμαζον",
"aliexpress|AliExpress|AliExpress|Other|ali express",
"temu|Temu|Temu|Other|",
"shein|Shein|Shein|Other|",
"ikea|IKEA|IKEA|Housing|ικεα",
"leroymerlin|Leroy Merlin|Leroy Merlin|Housing|λερουα μερλεν",
"jumbo|Jumbo|Jumbo|Other|τζαμπο",
"elta|ELTA|ΕΛΤΑ|Other|",
"acs|ACS|ACS|Other|acs courier,ακς",
"speedex|Speedex|Speedex|Other|σπιντεξ",
"boxnow|Box Now|Box Now|Other|",
"zara|Zara|Zara|Other|ζαρα",
"hm|H&M|H&M|Other|h and m",
"attica|Attica|Attica|Other|αττικα",
"petcity|Pet City|Pet City|Other|"
];
//  generic words: category|comma separated words
var MKW_SRC=[
"Supermarket|supermarket,super market,σουπερ μαρκετ,mini market,μινι μαρκετ,minimarket",
"Transport|fuel,gas station,petrol,βενζινη,βενζιναδικο,parking,παρκινγκ,taxi,ταξι,διοδια,toll",
"Food|restaurant,εστιατοριο,ταβερνα,taverna,coffee,καφε,cafe,pizza,souvlaki,σουβλακι,bakery,φουρνος,delivery",
"Health|pharmacy,φαρμακειο,farmakeio,doctor,γιατρος,dentist,οδοντιατρος,hospital,νοσοκομειο",
"Leisure|cinema,σινεμα,gym,γυμναστηριο,concert,theatre,θεατρο"
];
var MBY={},MIDX=null,KWIDX=null;
function mBuild(){
  var list=[],kw=[];
  MERCH_SRC.forEach(function(r){var p=r.split("|"),key=p[0],al=(p[4]||"").split(",");
    MBY[key]={key:key,en:p[1],el:p[2],cat:p[3]};al.push(p[1],p[2]);var seen={};
    al.forEach(function(a){a=nrm(a);if(!a)return;var vs=[a];if(/[α-ω]/.test(a))vs=vs.concat(grVar(a));
      vs.forEach(function(v){v=nrm(v);if(v.length>=2&&!seen[v]){seen[v]=1;list.push([v,key])}})})});
  MKW_SRC.forEach(function(r){var p=r.split("|");p[1].split(",").forEach(function(w){w=nrm(w);if(w)kw.push([w,p[0]])})});
  var byLen=function(a,b){return b[0].length-a[0].length};
  list.sort(byLen);kw.sort(byLen);MIDX=list;KWIDX=kw}
// longest word-boundary match of an alias list inside a text; returns the list entry or null
function mFind(text,idx){var t=" "+nrm(text)+" ";if(t.length<4)return null;
  for(var i=0;i<idx.length;i++){var a=idx[i][0];if(a.length+2>t.length)continue;var p=t.indexOf(" "+a);
    while(p>=0){if(a.length>3||t.charAt(p+1+a.length)===" ")return idx[i];p=t.indexOf(" "+a,p+1)}}
  return null}
function mBuiltin(text){if(!MIDX)mBuild();var e=mFind(text,MIDX);return e?MBY[e[1]]:null}
function mKeyword(text){if(!MIDX)mBuild();var e=mFind(text,KWIDX);return e?e[1]:null}
//#endcore
var LANG=(function(){try{var q=localStorage.getItem("xpence-lang");if(q==="el"||q==="en")return q}catch(e){}try{return /^el/i.test(navigator.language||"")?"el":"en"}catch(e){return "en"}})();
try{document.documentElement.lang=LANG}catch(e){}
var selYear=null,editing=null,layEdit=false,openD={},st=null,lastDay="",laterKey=null,lastSig="";
var ONCE_CATS=["Food","Supermarket","Transport","Health","Leisure","Other"],freqTouched=false;
function defaultCats(){var s=today().slice(0,7);return [
 {name:"Housing",icon:"house"},{name:"Κοινόχρηστα",icon:"building",bill:1},{name:"Mobile phone",icon:"phone",bill:1},{name:"Electricity",icon:"bolt",bill:1},
 {name:"Water",icon:"drop",bill:1},{name:"Internet",icon:"wifi",bill:1},{name:"Food",icon:"fork"},{name:"Supermarket",icon:"cart"},{name:"Transport",icon:"car"},
 {name:"Bills",icon:"receipt"},{name:"Bank",icon:"bank"},{name:"Subscriptions",icon:"screen"},{name:"Health",icon:"heart"},{name:"Leisure",icon:"spark"},{name:"Other",icon:"grid"}
 ].map(function(c){c.bill=!!c.bill;c.dueDay=null;c.every=1;c.since=s;c.group=["Water","Electricity","Internet"].indexOf(c.name)>=0?"Utilities":"";return c})}
var FLC=["flov","flvat","flen","flcc","flrep","fltc","fladd"],DEF_FL={L:[],A:["flov","flvat","flen","flcc","flrep","fltc"],B:["fladd"]};
var VIEWS=["insights","goals","trend","whatif","savings","extra","bills","bycat"];
var DEF_LAYOUT={L:["savings","goals","extra"],M:["totals","add","expenses","bills","bycat","trend"],R:["side","insights","whatif"]},CARDS=["totals","savings","goals","extra","add","side","insights","expenses","bills","bycat","trend","whatif"];
function normFl(l){var seen={},out={L:[],A:[],B:[]};
  if(l&&typeof l==="object")["L","A","B"].forEach(function(c){(Array.isArray(l[c])?l[c]:[]).forEach(function(id){if(FLC.indexOf(id)>=0&&!seen[id]){seen[id]=1;out[c].push(id)}})});
  ["L","A","B"].forEach(function(c){DEF_FL[c].forEach(function(id){if(!seen[id]){seen[id]=1;out[c].push(id)}})});return out}
function normLayout(l){var seen={},out={L:[],M:[],R:[]};
  if(l&&typeof l==="object")["L","M","R"].forEach(function(c){(Array.isArray(l[c])?l[c]:[]).forEach(function(id){if(CARDS.indexOf(id)>=0&&!seen[id]){seen[id]=1;out[c].push(id)}})});
  ["L","M","R"].forEach(function(c){DEF_LAYOUT[c].forEach(function(id){if(!seen[id]){seen[id]=1;out[c].push(id)}})});return out}
var state={items:[],cur:"€",income:0,savings:0,salary:0,payments:12,budgets:{},xm:{xmas:11,easter:3,summer:7},half:"summer",oneoff:[],withdraw:[],layout:null,simple:false,tab:"personal",freelancer:false,fl:{items:[],tax:0,calc:{rev:"",exp:"",efka:250.77,age:"31",pre:"free",fee:0,first:false},vat:{on:false,period:"q",incl:false,rate:24,paid:{}},clients:[]},goals:[],cats:defaultCats(),snooze:{},mer:{},learn:{},theme:{pal:"green",mode:"auto"},minTray:false,lang:null,order:"new",collapsed:{fcd:true,xs:true},fullLists:false,trend:"line",show:{},flLayout:null,autoUpdate:true};
var STATE0=JSON.stringify(state);
var L={0:"one-time",365:"daily",52:"weekly",26:"every 2 weeks",12:"monthly",4:"quarterly",1:"yearly"};
var $=function(i){return document.getElementById(i)};
function today(){return ymd(new Date())}
function nid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function vrate(x){x=+x;return isFinite(x)&&x>=0&&x<=100?Math.round(x*100)/100:0}
function normVat(v){v=v&&typeof v==="object"?v:{};var paid={};if(v.paid&&typeof v.paid==="object")Object.keys(v.paid).forEach(function(k){if(/^\d{4}-(\d{2}|Q[1-4])$/.test(k)&&v.paid[k]===true)paid[k]=true});
  return {on:!!v.on,period:v.period==="m"?"m":"q",incl:!!v.incl,rate:[0,6,13,24].indexOf(+v.rate)>=0?+v.rate:24,paid:paid}}
function normClients(a){var out=[],seen={};(Array.isArray(a)?a:[]).forEach(function(n){n=String(n==null?"":n).trim().slice(0,60);var k=n.toLowerCase();if(n&&!seen[k]&&out.length<500){seen[k]=1;out.push(n)}});return out}
function normMer(m){var out={},n=0;if(!m||typeof m!=="object"||Array.isArray(m))return out;
  Object.keys(m).forEach(function(k){var v=m[k];if(n>=300||!/^[a-z0-9_]{1,40}$/.test(k)||!v||typeof v!=="object")return;var o={};
    if(typeof v.logo==="string"&&v.logo.length<=100000&&/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(v.logo))o.logo=v.logo;
    if(v.u){o.u=1;o.n=String(v.n==null?"":v.n).trim().slice(0,40);o.c=String(v.c==null?"Other":v.c).slice(0,40);if(!o.n)return}
    if(!o.logo&&!o.u)return;out[k]=o;n++});return out}
function normLearn(l){var out={},ks;if(!l||typeof l!=="object"||Array.isArray(l))return out;ks=Object.keys(l).slice(-500);
  ks.forEach(function(k){var v=l[k];if(k.length>=2&&k.length<=60&&v&&typeof v.c==="string"&&v.c.length<=40)out[k]={c:v.c}});return out}
function normGoals(a){return (Array.isArray(a)?a:[]).filter(function(g){return g&&typeof g==="object"&&+g.target>0}).slice(0,200).map(function(g){return {id:g.id||nid(),name:String(g.name||"").trim().slice(0,60)||"Goal",target:+g.target,saved:(+g.saved>0?+g.saved:0),by:/^\d{4}-\d{2}$/.test(g.by||"")?g.by:""}})}
function norm(d){var t=today(),y=t.slice(0,4);
  var th=d.theme&&typeof d.theme==="object"?d.theme:{};d.theme={pal:PAL[th.pal]?th.pal:"green",mode:({auto:1,light:1,dark:1})[th.mode]?th.mode:"auto"};d.minTray=!!d.minTray;d.autoUpdate=d.autoUpdate!==false;d.flLayout=d.flLayout&&typeof d.flLayout==="object"?normFl(d.flLayout):null;d.trend=d.trend==="bar"?"bar":"line";var sh={};if(d.show&&typeof d.show==="object")VIEWS.forEach(function(k){if(d.show[k]===false)sh[k]=false});d.show=sh;d.lang=(d.lang==="el"||d.lang==="en")?d.lang:null;d.order=d.order==="old"?"old":"new";d.fullLists=!!d.fullLists;var cl=d.collapsed&&typeof d.collapsed==="object"?d.collapsed:{};d.collapsed={};["savings","extra","insights","goals"].forEach(function(k){if(cl[k]===true)d.collapsed[k]=true});d.collapsed.fcd=cl.fcd!==false;d.collapsed.xs=cl.xs!==false;d.goals=normGoals(d.goals);
  if(!Array.isArray(d.cats)||!d.cats.length)d.cats=defaultCats();
  var hadGroup=d.cats.some(function(c){return "group" in c});
  d.cats.forEach(function(c){if(!("group" in c))c.group=(!hadGroup&&["Water","Electricity","Internet"].indexOf(c.name)>=0)?"Utilities":"";c.group=typeof c.group==="string"?c.group.trim().slice(0,40):"";if(!ICONS[c.icon])c.icon="grid";c.bill=!!c.bill;c.dueDay=c.dueDay?+c.dueDay:null;c.every=+c.every||1;if(!c.since)c.since=t.slice(0,7)});
  if(!d.snooze||typeof d.snooze!=="object")d.snooze={};
  var bg=d.budgets&&typeof d.budgets==="object"&&!Array.isArray(d.budgets)?d.budgets:{};d.budgets={};
  Object.keys(bg).forEach(function(k){var v=bg[k];if(/^\d{4}-\d{2}$/.test(k)&&v!==""&&v!==null&&isFinite(+v)&&+v>=0)d.budgets[k]=+v});
  var xm=d.xm&&typeof d.xm==="object"?d.xm:{};d.xm={};
  [["xmas",11],["easter",3],["summer",7]].forEach(function(x){var v=xm[x[0]];d.xm[x[0]]=(v!==""&&v!==null&&Number.isInteger(+v)&&+v>=0&&+v<=11)?+v:x[1]});
  d.half=["xmas","easter","summer"].indexOf(d.half)>=0?d.half:"summer";
  d.layout=normLayout(d.layout);d.simple=!!d.simple;d.tab=d.tab==="freelancer"?"freelancer":"personal";
  var fl=d.fl&&typeof d.fl==="object"?d.fl:{};
  var fc=fl.calc&&typeof fl.calc==="object"?fl.calc:{};
  d.freelancer="freelancer" in d?!!d.freelancer:((fl.items&&fl.items.length>0)||d.tab==="freelancer");
  d.fl={calc:{rev:fc.rev===""||fc.rev==null||!(+fc.rev>=0)?"":+fc.rev,exp:fc.exp===""||fc.exp==null||!(+fc.exp>=0)?"":+fc.exp,efka:(fc.efka!==""&&fc.efka!=null&&+fc.efka>=0)?+fc.efka:250.77,age:({"25":1,"26":1,"31":1})[fc.age]?fc.age:"31",pre:({free:1,block:1,biz:1,custom:1})[fc.pre]?fc.pre:"free",fee:(+fc.fee>=0)?+fc.fee:0,first:!!fc.first},tax:(isFinite(+fl.tax)&&+fl.tax>=0&&+fl.tax<=100)?+fl.tax:0,items:(Array.isArray(fl.items)?fl.items:[]).filter(function(o){return o&&/^\d{4}-\d{2}-\d{2}$/.test(o.date||"")&&+o.amt>0}).map(function(o){var out=o.type==="out",r={id:o.id||nid(),type:out?"out":"in",name:String(o.name||"").slice(0,60),amt:+o.amt,date:o.date,cat:String(o.cat||"").slice(0,40),paid:out?true:o.paid!==false,client:out?"":String(o.client||"").trim().slice(0,60),vr:vrate(o.vr),incl:!!o.incl};if(out)r.vd=o.vd!==false;return r}),vat:normVat(fl.vat),clients:normClients(fl.clients)};
  d.fl.items.forEach(function(o){if(o.client&&d.fl.clients.map(function(c){return c.toLowerCase()}).indexOf(o.client.toLowerCase())<0)d.fl.clients.push(o.client)});
  d.withdraw=(Array.isArray(d.withdraw)?d.withdraw:[]).filter(function(o){return o&&/^\d{4}-\d{2}-\d{2}$/.test(o.date||"")&&+o.amt>0}).map(function(o){return {id:o.id||nid(),date:o.date,reason:String(o.reason||"").slice(0,60),amt:+o.amt}});
  d.oneoff=(Array.isArray(d.oneoff)?d.oneoff:[]).filter(function(o){return o&&/^\d{4}-\d{2}-\d{2}$/.test(o.date||"")&&+o.amt>0}).map(function(o){return {id:o.id||nid(),date:o.date,label:String(o.label||"").slice(0,60),amt:+o.amt,to:o.to==="budget"?"budget":"savings"}});
  var bills={};d.cats.forEach(function(c){if(c.bill)bills[c.name]=1});
  d.mer=normMer(d.mer);d.learn=normLearn(d.learn);
  d.items=d.items.filter(function(it){return it&&typeof it==="object"});
  d.items.forEach(function(it){if(!it.id)it.id=nid();it.amt=+it.amt||0;it.freq=it.freq==null?12:+it.freq;if(L[it.freq]===undefined)it.freq=12;
    it.name=String(it.name==null?"":it.name);it.cat=String(it.cat==null||it.cat===""?"Other":it.cat);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(it.date||""))it.date=y+"-01-01";if(!it.created)it.created=t;if(bills[it.cat])it.freq=0;
    var tg=parseTags(Array.isArray(it.tags)?it.tags.join(" "):it.tags);if(tg.length)it.tags=tg;else delete it.tags;
    if(!/^\d{4}-\d{2}$/.test(it.until||"")||it.freq===0)delete it.until;
    if(Array.isArray(it.gaps)&&it.freq!==0){var gs=it.gaps.filter(function(g){return g&&/^\d{4}-\d{2}$/.test(g.a||"")&&(g.b==null||/^\d{4}-\d{2}$/.test(g.b))&&(g.b==null||idxOf(g.b)>=idxOf(g.a))}).map(function(g){return {a:g.a,b:g.b||null}});if(gs.length)it.gaps=gs;else delete it.gaps}else delete it.gaps});
  return d}
var NF={};function fmt(n){var l=LANG==="el"?"el-GR":"en-US",f=NF[l]||(NF[l]=new Intl.NumberFormat(l,{minimumFractionDigits:2,maximumFractionDigits:2}));return state.cur+" "+f.format(n)}
function esc(t){var d=document.createElement("div");d.textContent=t;return d.innerHTML}
function dm(s){return s.slice(8,10)+"/"+s.slice(5,7)}
var MNC=["January","February","March","April","May","June","July","August","September","October","November","December"];function MN(i){return MNC[((i%12)+12)%12]}
function colorFor(p){return "hsl("+Math.max(0,120-120*Math.min(p,100)/100)+",65%,42%)"}
// the same green-to-red for text: mixed with the theme's text colour (darker in light, lighter in dark) so it reads at 4.5:1 or more in every theme
function textColorFor(p){return "color-mix(in oklab,"+colorFor(p)+" 55%,var(--text))"}
function say(t){$("ds").textContent=t}

var ICONS={
house:{c:"#4f8ef7",p:'<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'},
building:{c:"#8b6cf0",p:'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2M10 21v-4h4v4"/>'},
phone:{c:"#5b6ef0",p:'<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'},
bolt:{c:"#e3a600",p:'<path d="M13 2.5L5.5 13.5H12l-1 8 7.5-11H12z"/>'},
drop:{c:"#1fa8d9",p:'<path d="M12 3s6 6.2 6 10.5a6 6 0 01-12 0C6 9.2 12 3 12 3z"/>'},
wifi:{c:"#b05fd8",p:'<path d="M3 9.5a13 13 0 0118 0M6 13a8.5 8.5 0 0112 0M9 16.5a4 4 0 016 0"/><path d="M12 19.5h.01"/>'},
fork:{c:"#f08a3c",p:'<path d="M7 3v7M4.5 3v5a2.5 2.5 0 005 0V3M7 10.5V21"/><path d="M17 21V3c-2.5 1.2-3.5 4-3.5 7.5H17"/>'},
cart:{c:"#5aa83b",p:'<path d="M3 4h2.2l2.3 10.5h10.2L20 7.5H6.2"/><path d="M8 10.5h11"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>'},
car:{c:"#e5534b",p:'<path d="M5 17h14v-5l-2-5H7l-2 5z"/><path d="M5 12h14"/><circle cx="8" cy="17" r="1.4"/><circle cx="16" cy="17" r="1.4"/>'},
receipt:{c:"#2fa39b",p:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'},
screen:{c:"#d655a8",p:'<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M10 8.5l5 3-5 3z"/><path d="M8 20h8"/>'},
heart:{c:"#e04f6f",p:'<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>'},
spark:{c:"#d9a416",p:'<path d="M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z"/>'},
grid:{c:"#7b8a82",p:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'},
shield:{c:"#3b8f8f",p:'<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>'},
book:{c:"#7a5cc9",p:'<path d="M3 5.5C5.5 4.5 9 4.5 12 6c3-1.5 6.5-1.5 9-.5V19c-2.5-1-6-1-9 .5-3-1.5-6.5-1.5-9-.5z"/><path d="M12 6v13.5"/>'},
paw:{c:"#b8793a",p:'<circle cx="6.5" cy="11" r="1.8"/><circle cx="9.8" cy="6.8" r="1.8"/><circle cx="14.2" cy="6.8" r="1.8"/><circle cx="17.5" cy="11" r="1.8"/><path d="M12 12.5c-3 0-5.5 2.8-5.5 5 0 1.8 1.8 2.3 3.2 2 .9-.2 1.5-.5 2.3-.5s1.4.3 2.3.5c1.4.3 3.2-.2 3.2-2 0-2.2-2.5-5-5.5-5z"/>'},
shirt:{c:"#4a7fc1",p:'<path d="M8 3L3 6l2 4 3-1v11h8V9l3 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z"/>'},
gift:{c:"#e0527a",p:'<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5"/><path d="M12 9c-1-3-5-4-5-1.5S10 9 12 9zM12 9c1-3 5-4 5-1.5S14 9 12 9z"/>'},
fuel:{c:"#c8553d",p:'<path d="M5 20.5V5a1.5 1.5 0 011.5-1.5h6A1.5 1.5 0 0114 5v15.5"/><path d="M4 20.5h11"/><path d="M5 9.5h9"/><path d="M14 8l3 2.5v7a1.5 1.5 0 003 0V9l-2.5-2.5"/>'},
dumbbell:{c:"#5c7cfa",p:'<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'},
flame:{c:"#ef6a2c",p:'<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.2 2-4.2.2 1.5.9 2.2 1.7 2.7C10.3 8.5 11 5.5 12 3z"/>'},
plane:{c:"#3aa0e0",p:'<path d="M21 4.5L3 11l6 2.5L11.5 20 21 4.5z"/><path d="M9 13.5L21 4.5"/>'},
cup:{c:"#8d6748",p:'<path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"/><path d="M17 10.5h1.5a2.5 2.5 0 010 5H16.5"/><path d="M8 3.5v2M11.5 3.5v2"/>'},
bank:{c:"#4b6b88",p:'<path d="M3 9.5l9-5.5 9 5.5z"/><path d="M6 11v6.5M10 11v6.5M14 11v6.5M18 11v6.5"/><path d="M3.5 20h17"/>'},
percent:{c:"#6c8e3a",p:'<circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/><path d="M18.5 5.5l-13 13"/>'},
wrench:{c:"#8a8f98",p:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'},
pill:{c:"#ce4f7d",p:'<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M9.2 9.2l5.6 5.6"/>'},
airplane:{c:"#2f8fd8",p:'<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>'},
ship:{c:"#2b7a9b",p:'<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.4 20A11.6 11.6 0 0021 14l-9-4-9 4c0 2.9.9 5.3 2.8 7.8"/><path d="M19 13V7a2 2 0 00-2-2H7a2 2 0 00-2 2v6"/><path d="M12 10v4M12 2v3"/>'}
};
function icTile(id){var k=ICONS[id]?id:"grid";return '<span class="ib" style="--c:'+ICONS[k].c+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS[k].p+'</svg></span>'}
function catOf(n){for(var i=0;i<state.cats.length;i++)if(state.cats[i].name===n)return state.cats[i];return null}
function isBill(n){var c=catOf(n);return !!(c&&c.bill)}
function ic(n){var c=catOf(n);return icTile(c?c.icon:"grid")}
function mChips(mm){if(!mm)return"";var ks=Object.keys(mm).sort(function(a,b){return mm[b].amt-mm[a].amt});if(!ks.length)return"";
  return '<div class="mch">'+ks.slice(0,10).map(function(k){var m=mGet(k);if(!m)return"";
    return '<button type="button" class="mc" data-mq="'+esc(k)+'" title="'+esc(X("Show only ","Μόνο "))+esc(mName(m))+'">'+(m.logo?logoTile(m.logo):ic(mm[k].cat))+'<span>'+esc(mName(m))+'</span><b>'+fmt(mm[k].amt)+'</b></button>'}).join("")+'</div>'}
function icGroup(names){
  var pos=names.length>=3?[[11,2.5],[2.5,19.5],[19.5,19.5]]:[[2.5,11],[19.5,11]];
  var g=names.slice(0,pos.length).map(function(n,i){var c=catOf(n),k=c&&ICONS[c.icon]?c.icon:"grid";
    return '<g transform="translate('+pos[i][0]+' '+pos[i][1]+') scale(.58)" fill="none" stroke="'+ICONS[k].c+'">'+ICONS[k].p+'</g>'}).join("");
  return '<span class="ib gi" style="--c:var(--muted)"><svg viewBox="0 0 36 36" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+g+'</svg></span>'}
var MC={};
function mClear(){MC={}}
function mGet(key){if(!MIDX)mBuild();var b=MBY[key],c=state.mer&&state.mer[key]||null;
  if(b)return {key:key,en:b.en,el:b.el,cat:b.cat,logo:c&&c.logo||"",custom:false};
  if(c&&c.u)return {key:key,en:c.n,el:c.n,cat:c.c||"Other",logo:c.logo||"",custom:true};return null}
function mName(m){return LANG==="el"&&m.el?m.el:m.en}
function mCustomKeys(){var m=state.mer||{};return Object.keys(m).filter(function(k){return m[k].u})}
function mOf(text){var k=nrm(text);if(!k||k===undefined)return null;if(Object.prototype.hasOwnProperty.call(MC,k))return MC[k]||null;
  var r=null,best=0,t=" "+k+" ";
  mCustomKeys().forEach(function(key){var a=nrm(state.mer[key].n);if(!a)return;var vs=[a];if(/[α-ω]/.test(a))vs=vs.concat(grVar(a));
    vs.forEach(function(v){if(v.length>best&&t.indexOf(" "+v+" ")>=0){best=v.length;r=mGet(key)}})});
  if(!r){var b=mBuiltin(text);if(b)r=mGet(b.key)}
  MC[k]=r||0;return r}
function logoTile(src){return '<span class="ib ml"><img src="'+esc(src)+'" alt=""></span>'}
function icItem(it){var m=mOf(it.name);return m&&m.logo?logoTile(m.logo):ic(it.cat)}
function sugOf(name){var k=nrm(name);if(k.length<2)return null;
  var l=state.learn&&state.learn[k],m=mOf(name);if(l&&catOf(l.c))return {cat:l.c,mer:m};
  if(m&&catOf(m.cat))return {cat:m.cat,mer:m};
  var w=mKeyword(name);if(w&&catOf(w))return {cat:w,mer:m};
  return m?{cat:null,mer:m}:null}
function learnIt(name,cat){var k=nrm(name);if(k.length<2||k.length>60||k===nrm(cat))return;if(!state.learn)state.learn={};
  delete state.learn[k];state.learn[k]={c:cat};var ks=Object.keys(state.learn);while(ks.length>500){delete state.learn[ks.shift()]}}
function groupIcon(e){var ns=state.cats.map(function(c){return c.name}).filter(function(n){return e.members[n]!==undefined});return ns.length>1?icGroup(ns):ic(e.icon)}
var BELL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/></svg>';

function curReminders(){return remindersFor(state.cats,LS().items,today(),state.snooze,Date.now())}
function find(id){for(var i=0;i<state.items.length;i++)if(state.items[i].id===id)return state.items[i];return null}
var LV=null,RF={},MS={},LAZY={},qStr="",qToks=[];
function liveState(){var f=function(k,l){return l.filter(function(o){return !isPend(k,o.id)})};return Object.assign({},state,{items:f("x",state.items),withdraw:f("w",state.withdraw),oneoff:f("e",state.oneoff)})}
function LS(){return LV||state}
function qLabel(it){var m=mOf(it.name);return (LANG==="el"?trCat(it.cat):"")+(m?" "+m.en+" "+m.el:"")}
function clone(x){return JSON.parse(JSON.stringify(x))}
function minIdx(items,fb){var m=Infinity;for(var k=0;k<items.length;k++){var x=idxOf(items[k].date);if(x<m)m=x}return m===Infinity?fb:m}
function rowsFor(i){var c=RF[i];if(c)return c;var o=state.order==="old"?1:-1,srch=qToks.length;
  var r=state.items.filter(function(it){return dueIn(it,i)&&(!srch||qMatch(it,qToks,qLabel(it)))});
  // same day and same "created" (it holds only the date): fall back to the order they were added in
  var pos=new Map();state.items.forEach(function(it,k){pos.set(it,k)});
  r.sort(function(a,b){var x=a.date.slice(8,10),y=b.date.slice(8,10);if(x!==y)return x<y?-o:o;var c1=(a.created||""),d=(b.created||"");return c1<d?-o:c1>d?o:(pos.get(a)-pos.get(b))*o});
  return RF[i]=r}
function sumM(i){var c=MS[i];if(c!==undefined)return c;var items=LS().items,t=0;for(var k=0;k<items.length;k++)t+=monthAmt(items[k],i);return MS[i]=t}

var billFilter="all";
function diffTxt(d,base){return d===0?"same amount":(d>0?"▲ +":"▼ −")+fmt(Math.abs(d))+(base?" ("+Math.abs(d/base*100).toFixed(0)+"%)":"")}
function billDelta(it){if(!isBill(it.cat))return "";var p=prevBill(state.items,it);if(!p)return "";var d=it.amt-p.amt;
  return '<small class="'+(d>0?'up':d<0?'dn':'')+'">'+diffTxt(d,p.amt)+' vs '+MN(idxOf(p.date))+' ('+fmt(p.amt)+')</small>'}
function lastOf(cat){var b=null;state.items.forEach(function(o){if(o.cat!==cat)return;if(!b||o.date>b.date||(o.date===b.date&&(o.created||"")>(b.created||"")))b=o});return b}
function updateLP(){var el=$("lp"),c=$("cat").value,l=null;
  if(isBill(c))l=editing?prevBill(state.items,find(editing)||{cat:c,date:"9999"}):lastOf(c);
  if(!l){el.textContent="";return}
  var t="Previous "+c+" bill: "+fmt(l.amt)+" ("+dm(l.date)+")",v=parseFloat($("amt").value);
  if(!isNaN(v))t+=" · this one: "+diffTxt(v-l.amt,l.amt);
  el.textContent=t}
function renderBills(){
  var all=LS().items.filter(function(it){return isBill(it.cat)}),cs={};all.forEach(function(it){cs[it.cat]=1});
  if(billFilter!=="all"&&!cs[billFilter])billFilter="all";
  var names=state.cats.filter(function(c){return cs[c.name]}).map(function(c){return c.name});
  $("bchips").innerHTML=all.length?['all'].concat(names).map(function(n){return '<button type="button" class="bchip'+(n===billFilter?' on':'')+'" data-bf="'+encodeURIComponent(n)+'">'+(n==='all'?'All bills':esc(n))+'</button>'}).join(""):"";
  var rows=all.filter(function(it){return billFilter==="all"||it.cat===billFilter});
  var pos=new Map();state.items.forEach(function(it,k){pos.set(it,k)});
  rows.sort(function(a,b){var c1=(a.created||""),d=(b.created||"");return a.date<b.date?1:a.date>b.date?-1:c1<d?1:c1>d?-1:pos.get(b)-pos.get(a)});
  if(!rows.length){$("bsum").textContent="";$("blist").innerHTML='<div class="empty">No bills yet. Add an expense in a bill category (Electricity, Κοινόχρηστα, Water…) and its history appears here.</div>';return}
  var tot=rows.reduce(function(t,it){return t+it.amt},0),am=rows.map(function(it){return it.amt});
  $("bsum").textContent=billFilter==="all"?rows.length+(rows.length===1?" payment · total ":" payments · total ")+fmt(tot):
    "Last "+fmt(rows[0].amt)+" · average "+fmt(tot/rows.length)+" · highest "+fmt(Math.max.apply(null,am))+" · lowest "+fmt(Math.min.apply(null,am));
  if(state.order==="old")rows.reverse();
  $("blist").innerHTML=rows.map(function(it){return '<div class="br"><div>'+icItem(it)+esc(it.name)+'<small>'+esc(it.cat)+' · '+dm(it.date)+'/'+it.date.slice(0,4)+'</small></div><div class="num"><b>'+fmt(it.amt)+'</b>'+billDelta(it)+'</div></div>'}).join("")}
function rowHTML(it,i){
  if(isPend("x",it.id))return phHTML("x",it.id);
  var a=monthAmt(it,i),rec=it.freq!==0;
  var sub=esc(it.cat)+" · "+fmt(it.amt)+" "+L[it.freq]+" · "+(it.freq===0?dm(it.date):"from "+dm(it.date));
  if(rec&&it.until)sub+=" · "+X("ends after "+MNY(it.until),"τελευταίος μήνας: "+MNY(it.until));
  var tg=it.tags&&it.tags.length?'<span class="tgs">'+it.tags.map(function(t){return '<button type="button" class="tg" data-tg="'+esc(t)+'">#'+esc(t)+'</button>'}).join("")+'</span>':"";
  return '<div class="row"><div>'+icItem(it)+esc(it.name)+'<small>'+sub+'</small>'+tg+billDelta(it)+'</div>'+
    '<div class="num">'+fmt(a)+'<small>/mo</small></div><div class="num yr">'+fmt(yearAmt(it,selYear))+'<small>/yr</small></div>'+
    '<span class="act">'+(rec?'<button class="ed2" data-rp="pause" data-id="'+it.id+'" aria-label="Pause" title="Pause">'+PAUSEI+'</button>':'')+'<button class="ed" data-id="'+it.id+'" aria-label="Edit">✎</button><button class="del" data-id="'+it.id+'" aria-label="Delete">✕</button></span></div>'}
function yearSums(y){var r={yb:0,plan:0,ex:0,ob:0};for(var m=0;m<12;m++){var i=y*12+m;r.yb+=budgetOf(LS(),i);r.ob+=oneSum(LS(),i,"budget");r.plan+=planSav(LS(),i);r.ex+=extraSav(LS(),i)}return r}
function monthOpts(sel){var o="";for(var m=0;m<12;m++)o+='<option value="'+m+'"'+(m===sel?' selected':'')+'>'+MN(m)+'</option>';return o}
function renderXs(){var xp=xpays(state),p=+state.payments||12,s=+state.salary||0;$("xs").hidden=!xp.length;
  if(!xp.length){$("xsl").innerHTML="";return}
  $("xsl").innerHTML=xp.map(function(x){
    var btn=p>=14.5&&x.mult===1?'<button type="button" class="pill" data-half="'+x.k+'">Make this the half</button>':'';
    return '<div class="xr"><span><b>'+x.n+'</b> · '+(x.mult===1?'Full salary':'Half salary')+(s>0?' (+'+fmt(s*x.mult)+')':'')+'</span><span style="display:flex;gap:8px;align-items:center">'+btn+'<select data-xm="'+x.k+'" aria-label="'+x.n+' month">'+monthOpts(x.m)+'</select></span></div>'}).join("")+
    '<div class="hint">'+(p>=14.5?'14.5 salaries = 2 full + 1 half. Choose which payment is the half one; the other two are full.':'14 salaries = Christmas full, Easter and Summer half each.')+'</div>'}
function renderMb(){var el=$("mbl");if(el.contains(document.activeElement))return;var h="";
  for(var m=0;m<12;m++){var i=selYear*12+m,k=ymOf(i),cu=state.budgets&&state.budgets[k]!=null,ex=extraSav(state,i),ob=oneSum(state,i,"budget");
    h+='<div class="mbr"><span>'+MN(i)+'</span><input type="number" step="0.01" min="0" data-mb="'+k+'" value="'+(cu?(state.budgets[k]+ob).toFixed(2):'')+'" placeholder="'+((+state.income||0)+ob).toFixed(2)+'" aria-label="Budget for '+MN(i)+' '+selYear+'"><small>'+[ob?'incl. +'+fmt(ob)+' extra money':'',ex?'+'+fmt(ex)+' to savings':''].filter(Boolean).join(' · ')+'</small></div>'}
  el.innerHTML=h+'<div class="hint">Empty = your default monthly budget. Extra money added to a month’s budget is already included in the figure shown. Type a number to change only that month; clear the box to go back to the default.</div>'}
var XICON='<span class="ib" style="--c:#e5484d"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></span>';
function periodHTML(l,pre,rowFn,sign,emptyCur,nm,sumFn,yr){nm=nm||"months";yr=yr==null?selYear:yr;var flat=pre==="w"||pre==="g";
  var W=function(kk,m){if(flat)return m.map(rowFn).join("");LAZY[kk]=function(){return m.map(rowFn).join("")};return '<div class="scl s" data-lz="'+kk+'">'+(openD[kk]?LAZY[kk]():"")+'</div>'};
  var ci=idxOf(today()),cy=Math.floor(ci/12),cur=[],prev={},up={};
  l=l.slice().sort(function(a,b){return state.order==="old"?(a.date<b.date?-1:1):(a.date<b.date?1:-1)});
  l.forEach(function(o){var i=idxOf(o.date);if(i===ci)cur.push(o);else if(i<ci)(prev[i]=prev[i]||[]).push(o);else(up[i]=up[i]||[]).push(o)});
  function folder(k,label,map,desc){var ks=Object.keys(map).map(Number).sort(function(a,b){return state.order==="old"?a-b:b-a});if(!ks.length)return"";
    return '<details data-k="'+pre+k+'"'+(openD[pre+k]?' open':'')+'><summary><span class="sum">'+label+'</span><span class="num">'+ks.length+(ks.length===1?' month':' months')+'</span></summary>'+ks.map(function(i){var m=map[i],t=m.reduce(function(s,o){return s+o.amt},0),kk=pre+k+i;
      return '<details data-k="'+kk+'"'+(openD[kk]?' open':'')+'><summary><span class="sum">'+MN(i)+' '+Math.floor(i/12)+'</span><span class="num">'+m.length+(m.length===1?' entry':' entries')+' · '+(sumFn?sumFn(m):sign+fmt(t))+'</span></summary>'+W(kk,m)+'</details>'}).join("")+'</details>'}
  return (cur.length?(flat?cur.map(rowFn).join(""):'<div class="scl s">'+cur.map(rowFn).join("")+'</div>'):(yr===cy?emptyCur:""))+folder("p",yr<cy?(nm==="months"?"Months of ":nm.charAt(0).toUpperCase()+nm.slice(1)+" of ")+yr:"Previous "+nm,prev,true)+folder("u","Upcoming "+nm,up,false)}
function wdRow(o){if(isPend("w",o.id))return phHTML("w",o.id);return '<div class="eo wd"><div>'+XICON+' '+esc(o.reason||"Withdrawal")+'<small>'+dm(o.date)+' · taken from savings</small></div><div class="num">−'+fmt(o.amt)+'</div><span class="act"><button class="ed" data-wed="'+o.id+'" aria-label="Edit">✎</button><button class="del" data-wdel="'+o.id+'" aria-label="Delete">✕</button></span></div>'}
function renderWd(){$("wlist").innerHTML=periodHTML(state.withdraw.filter(function(o){return +o.date.slice(0,4)===selYear}),"w",wdRow,"−","","withdrawals")}
var TICK='<span class="ib" style="--c:#2f9e44"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>';
function renderGains(){$("gainlist").innerHTML=periodHTML(state.oneoff.filter(function(o){return o.to==="savings"&&+o.date.slice(0,4)===selYear}),"g",eoRow,"+","","savings money")}
function eoRow(o){if(isPend("e",o.id))return phHTML("e",o.id);return '<div class="eo gd"><div>'+TICK+' '+esc(o.label||"Extra money")+'<small>'+dm(o.date)+' · added to '+(o.to==="budget"?'budget':'savings')+'</small></div><div class="num">+'+fmt(o.amt)+'</div><span class="act"><button class="ed" data-eed="'+o.id+'" aria-label="Edit">✎</button><button class="del" data-edel="'+o.id+'" aria-label="Delete">✕</button></span></div>'}
function renderEo(){$("eolist").innerHTML=periodHTML(state.oneoff.filter(function(o){return o.to==="budget"&&+o.date.slice(0,4)===selYear}),"e",eoRow,"+",'<div class="hint">No extra money added to this month’s budget.</div>')}
function monthDetails(i){
  var rows=rowsFor(i),k="m"+i,head;
  if(qToks.length){var sp0=0;rows.forEach(function(it){if(!isPend("x",it.id))sp0+=monthAmt(it,i)});head='<span class="num">'+rows.length+(rows.length===1?' entry':' entries')+' · '+fmt(sp0)+'</span>'}
  else{var sp=sumM(i),b=budgetOf(LS(),i),left=b-sp,col=b>0?textColorFor(sp/b*100):"var(--muted)",av=+state.salary||0;
    head='<span class="num" style="color:'+col+'">'+fmt(sp)+(b>0?' · '+(left>=0?fmt(left)+' left':fmt(-left)+' over'):'')+(oneSum(LS(),i,"budget")>0?' <span class="gd">+'+fmt(oneSum(LS(),i,"budget"))+' extra</span>':'')+(i<idxOf(today())&&av>0?'<span class="adv"> · saved '+fmt(realSav(LS(),i,sp))+'</span>':'')+'</span>'}
  LAZY[k]=function(){return rows.map(function(it){return rowHTML(it,i)}).join("")};
  return '<details data-k="'+k+'"'+(openD[k]?' open':'')+'><summary><span class="sum">'+MN(i)+' '+Math.floor(i/12)+'</span>'+head+'</summary><div class="scl" data-lz="'+k+'">'+(openD[k]?LAZY[k]():"")+'</div></details>'}
function group(k,label,list){
  if(!list.length)return "";
  return '<details data-k="'+k+'"'+(openD[k]?' open':'')+'><summary><span class="sum">'+label+'</span><span class="num">'+list.length+(list.length===1?' month':' months')+'</span></summary>'+list.map(monthDetails).join("")+'</details>'}
function months(a,b){var r=[];for(var i=a;i<=b;i++)if(rowsFor(i).length)r.push(i);return state.order==="old"?r:r.reverse()}

function render(){
  var td=today(),ci=idxOf(td),cy=Math.floor(ci/12);lastDay=td;RF={};MS={};LAZY={};LV=liveState();
  if(selYear===null)selYear=cy;
  var ys={};ys[cy]=1;state.items.forEach(function(it){ys[+it.date.slice(0,4)]=1});
  if(!ys[selYear])selYear=cy;
  var yl=Object.keys(ys).map(Number).sort(function(a,b){return a-b});
  $("cur").value=state.cur;Array.prototype.forEach.call(document.querySelectorAll(".ordsel"),function(o){o.value=state.order});
  $("yrs").innerHTML=yl.map(function(y){return '<button type="button" class="chip'+(y===selYear?' on':'')+'" data-y="'+y+'">'+y+'</button>'}).join("");
  var planned=0,cats={};
  var mcat={};
  LS().items.forEach(function(it){var a=yearAmt(it,selYear);planned+=a;if(a>0){cats[it.cat]=(cats[it.cat]||0)+a;var mm=mOf(it.name);if(mm){var mc=mcat[it.cat]||(mcat[it.cat]={});var me=mc[mm.key]||(mc[mm.key]={amt:0,cat:it.cat});me.amt+=a}}});
  var Y=yearSums(selYear),inc=budgetOf(LS(),ci),pm=+state.payments||12,yb=Y.yb,cm=sumM(ci),avg=+state.salary||0,fi=minIdx(LS().items,ci);
  $("mlab").textContent="Spent in "+MN(ci);$("m").textContent=fmt(cm);
  $("ylab").textContent="Planned for "+selYear;$("y").textContent=fmt(planned);
  $("ysl").textContent="Total yearly salary (salary × "+pm+")";$("ysal").textContent=fmt((+state.salary||0)*pm);
  $("yb").textContent=fmt(yb);$("ybl").textContent="Total yearly budget ("+selYear+")";$("ybx").textContent=Y.ob>0?"+"+fmt(Y.ob)+" from extra money":"";renderXs();renderMb();renderEo();renderWd();renderGains();renderFl();renderGoals();renderTrend();renderWhatIf();
  $("sv2").hidden=!(avg>0);$("shd").hidden=!(avg>0);$("sh").textContent=avg>0?(Y.plan<0?"Your budgets are higher than your salary plus extra money, so planned savings are negative.":""):"Set your monthly salary in Profile to see how much you are saving.";$("sh").hidden=!$("sh").textContent;
  if(avg>0){var sm=savedMonths(fi,ci,selYear),real=sm.reduce(function(t,i){return t+realSav(LS(),i,sumM(i))},0),wdx=0,pl=sm.reduce(function(t,i){return t+planSav(LS(),i)},0);for(var q=0;q<12;q++){var qi=selYear*12+q;if(qi<=ci&&sm.indexOf(qi)<0)wdx+=wdSum(LS(),qi)}real-=wdx;var diff=real-pl;
    $("avgl").textContent="Monthly income (salary)";$("avg").textContent=fmt(avg);
    var pmn=avg-(+state.income||0);$("ps").textContent=fmt(pmn);$("ps").style.color=pmn<0?"var(--danger)":"";
    $("xv").textContent=fmt(Y.ex);$("pys").textContent=fmt(Y.plan);$("pys").style.color=Y.plan<0?"var(--danger)":"";
    $("rsl").textContent="Real savings in "+selYear+(sm.length?" ("+sm.length+(sm.length===1?" completed month)":" completed months)"):"");
    $("rs").textContent=(sm.length||wdx)?fmt(real):"—";$("rs").style.color=real<0?"var(--danger)":"";
    $("rsd").textContent=sm.length?(diff>=0?"+"+fmt(diff)+" more than planned":fmt(-diff)+" less than planned"):"Real savings start counting once the first month is completed."}
  if(yb>0){var pc=planned/yb*100,left=yb-planned,col=colorFor(pc);
    $("bb").style.width=Math.min(pc,100)+"%";$("bb").style.background=col;$("y").style.color=textColorFor(pc);$("bs").style.color=textColorFor(pc);
    $("bs").textContent=pc.toFixed(0)+"% of the yearly budget planned ("+selYear+") · "+(left>=0?fmt(left)+" left":fmt(-left)+" over budget");
  }else{$("bb").style.width="0";$("y").style.color="";$("bs").style.color="";$("bs").textContent="Set your monthly budget in Profile to see your budget status."}

  var rs=curReminders();lastSig=rs.map(function(r){return r.key}).join(",");
  var remH=rs.length?'<div class="rl">'+rs.map(function(r){
    var t=r.days<0?"overdue by "+(-r.days)+(r.days===-1?" day":" days"):r.days===0?"due today":"due in "+r.days+(r.days===1?" day":" days"),k=encodeURIComponent(r.key);
    return '<div class="ri od"><div>'+ic(r.cat.name)+esc(r.cat.name)+'<small>'+t+' · '+dm(r.due)+' · '+MN(idxOf(r.month))+(lastOf(r.cat.name)?' · last bill '+fmt(lastOf(r.cat.name).amt):'')+'</small></div>'+
      '<div class="ra"><button type="button" class="pill" data-add="'+k+'">Add expense</button><button type="button" class="pill" data-later="'+k+'">Remind me later</button></div>'+
      (laterKey===r.key?'<div class="later"><span>Remind me again:</span><button type="button" data-sn="h1" data-k="'+k+'">In 1 hour</button><button type="button" data-sn="tm" data-k="'+k+'">Tomorrow morning</button><button type="button" data-sn="d3" data-k="'+k+'">In 3 days</button><button type="button" data-sn="w1" data-k="'+k+'">In a week</button><input type="datetime-local" id="snd" aria-label="Remind me at"><button type="button" data-snd="'+k+'">Set</button></div>':'')+'</div>'}).join("")+'</div>':"";
  var h="";
  if(selYear===cy){
    var rows=rowsFor(ci);
    h+='<div class="cur"><div class="head"><h2>This month ('+MN(ci)+')</h2><span class="num">'+fmt(cm)+(inc>0?' of '+fmt(inc)+(state.budgets&&state.budgets[ymOf(ci)]!=null?' (custom)':'')+(oneSum(LS(),ci,"budget")>0?' <span class="gd">+'+fmt(oneSum(LS(),ci,"budget"))+' extra</span>':''):'')+'</span></div>';
    if(inc>0){var pm2=cm/inc*100,c2=colorFor(pm2),l2=inc-cm;
      h+='<div class="bb"><i style="width:'+Math.min(pm2,100)+'%;background:'+c2+'"></i></div><div class="st" style="color:'+textColorFor(pm2)+'">'+pm2.toFixed(0)+'% of the monthly budget used · '+(l2>=0?fmt(l2)+' left':fmt(-l2)+' over budget')+'</div>'}
    if(avg>0){var rl=realSav(LS(),ci,cm),pl2=planSav(LS(),ci);h+='<div class="st adv" style="color:'+(rl<0?'var(--danger)':rl>=pl2?'var(--accent)':'var(--text)')+'">Saving this month: '+fmt(rl)+' (planned '+fmt(pl2)+')</div>'}
    h+=remH+(rows.length?'<div class="scl">'+rows.map(function(it){return rowHTML(it,ci)}).join("")+'</div>':'<div class="empty">'+(qToks.length?X("No expenses match your search.","Κανένα έξοδο δεν ταιριάζει με την αναζήτηση."):"No expenses this month yet.")+'</div>')+'</div>';
    h+=group("up","Upcoming months",months(ci+1,cy*12+11));
    h+=group("prev","Previous months",months(cy*12,ci-1));
  }else{
    h+=group("y"+selYear,selYear>cy?"Upcoming months":"Months of "+selYear,months(selYear*12,selYear*12+11))||'<div class="empty">'+(qToks.length?X("No expenses match your search.","Κανένα έξοδο δεν ταιριάζει με την αναζήτηση."):"Nothing recorded for "+selYear+".")+'</div>';
  }
  if(selYear!==cy)h=remH+h;
  $("sec").innerHTML=h;
  var grp={};Object.keys(cats).forEach(function(n){var c=catOf(n),g=c&&c.group?c.group:n,e=grp[g]||(grp[g]={total:0,icon:n,top:-1,members:{},count:0});
    e.total+=cats[n];e.members[n]=cats[n];e.count++;if(mcat[n]){e.mer=e.mer||{};Object.keys(mcat[n]).forEach(function(k){var x=e.mer[k]||(e.mer[k]={amt:0,cat:mcat[n][k].cat});x.amt+=mcat[n][k].amt})}if(cats[n]>e.top){e.top=cats[n];e.icon=n}});
  var keys=Object.keys(grp).sort(function(a,b){return grp[b].total-grp[a].total});
  $("ch").textContent="By category ("+selYear+")";
  $("cats").innerHTML=keys.length?keys.map(function(k){var e=grp[k],p=planned?e.total/planned*100:0,ms=Object.keys(e.members).sort(function(a,b){return e.members[b]-e.members[a]});
    return '<div><div class="cat"><span>'+groupIcon(e)+' '+esc(k)+'</span><span class="num">'+fmt(e.total)+' · '+p.toFixed(0)+'%</span></div><div class="bar"><i style="width:'+p+'%"></i></div>'+
      (e.count>1?'<div class="gm">'+ms.map(function(n){return esc(n)+' '+fmt(e.members[n])}).join(' · ')+'</div>':'')+mChips(e.mer)+'</div>'}).join(""):'<div class="empty">Nothing to show yet.</div>';
  renderSearch();renderRec();renderBills();renderIns();
}

// every change is sent to the server (see "account" below); save() waits a moment so typing is sent once
function persistNow(){dataSave()}
function save(){clearTimeout(st);st=setTimeout(function(){st=null;persistNow()},250)}

function applyData(d){
  if(!d||!Array.isArray(d.items))return false;
  state=norm(Object.assign({cur:"€",income:0,savings:0,salary:0,payments:12},d));mClear();
  $("eod").value=today();$("wd").value=today();
  $("inc").value=state.income||"";$("sal").value=state.salary||"";$("pay").value=state.payments||12;
  buildMenu();renderCats();stopEdit();syncCat();applyTheme();syncOpts();applyLayout();applyFlLayout();syncFcalc();applyTab();applySimple();applyCollapse();applyFull();syncLang();$("fltax").value=state.fl.tax||"";stopFl();stopGoal();stopCl();syncEnd();applyView();render();return true}

// everyday spending starts as one-time, everything else as monthly, until the user picks "How often" themselves
function applyCatRules(){var c=$("cat").value,f=$("freq");if(isBill(c)){f.value="0";f.disabled=true}else{f.disabled=false;if(!freqTouched)f.value=ONCE_CATS.indexOf(c)>=0?"0":"12"}syncEnd()}
function syncCat(){var v=$("cat").value;$("ddb").innerHTML=ic(v)+'<span class="dl">'+esc(v)+'</span><span>▾</span>';applyCatRules();updateLP()}
function stopEdit(){editing=null;catTouched=false;freqTouched=false;exactKey=null;showSug(null);acHide();$("sb").textContent="Add";$("cc").hidden=true;$("name").value="";delete $("name").dataset.auto;$("amt").value="";$("tags").value="";$("endm").value="";$("dt").value=today();applyCatRules();updateLP()}
function startEdit(id){var it=find(id);if(!it)return;editing=id;freqTouched=true;
  $("cat").value=it.cat;syncCat();
  $("name").value=it.name;delete $("name").dataset.auto;$("amt").value=it.amt;if(!$("freq").disabled)$("freq").value=it.freq;$("dt").value=it.date;$("tags").value=(it.tags||[]).join(", ");$("endm").value=it.until||"";syncEnd();
  $("sb").textContent="Save";$("cc").hidden=false;$("f").scrollIntoView({behavior:"smooth",block:"center"});$("amt").focus();updateLP()}
function prefillBill(r){stopEdit();$("cat").value=r.cat.name;syncCat();
  var mine=state.items.filter(function(e){return e.cat===r.cat.name});
  if(mine.length){var l=mine.reduce(function(a,b){return b.date>a.date?b:a});$("amt").value=l.amt}
  $("name").value=r.cat.name;$("dt").value=r.due;$("f").scrollIntoView({behavior:"smooth",block:"center"});$("amt").focus();updateLP()}
$("f").addEventListener("submit",function(e){
  e.preventDefault();
  var a=parseFloat($("amt").value);if(!(a>0)){alert("Enter an amount greater than 0.");return}
  var o={name:$("name").value.trim()||$("cat").value,amt:a,freq:isBill($("cat").value)?0:+$("freq").value,cat:$("cat").value,date:$("dt").value||today()};
  var tg=parseTags($("tags").value),en=$("endm").value;
  if(o.freq!==0&&/^\d{4}-\d{2}$/.test(en)){if(idxOf(en)<idxOf(o.date)){alert("The end month can’t be before the start date.");return}o.until=en}
  var pvX=null;if(editing){var it=find(editing);if(it){pvX=clone(it);Object.assign(it,o);learnIt(o.name,o.cat);mClear();if(!o.until)delete it.until;if(tg.length)it.tags=tg;else delete it.tags}}
  else{var dp=dupOf(o);
    if(dp){ask("This looks like a duplicate of “"+dp.name+"” ("+fmt(dp.amt)+", "+dmy(dp.date)+"). Add it anyway?",function(){commitNew(o,tg)},{ok:"Add anyway"});return}
    commitNew(o,tg);return}
  stopEdit();$("amt").focus();save();render();if(pvX)editToast(X("Expense updated","Το έξοδο ενημερώθηκε"),function(){return state.items},pvX);
});
function dupOf(o){var its=LS().items,nm=o.name.toLowerCase();
  for(var k=0;k<its.length;k++){var it=its[k];if(it.cat!==o.cat||it.name.toLowerCase()!==nm||Math.abs(it.amt-o.amt)>=.005)continue;
    if(o.freq===0?(it.freq===0&&idxOf(it.date)===idxOf(o.date)):it.freq===o.freq)return it}return null}
function commitNew(o,tg){learnIt(o.name,o.cat);o.id=nid();o.created=today();if(tg.length)o.tags=tg;state.items.push(o);stopEdit();$("amt").focus();save();render()}
$("cc").addEventListener("click",stopEdit);
$("amt").addEventListener("input",updateLP);
$("name").addEventListener("input",function(){delete this.dataset.auto});
function buildMenu(){$("ddm").innerHTML=state.cats.map(function(c,i){return '<button type="button" data-i="'+i+'">'+ic(c.name)+'<span>'+esc(c.name)+'</span></button>'}).join("")}
$("ddb").addEventListener("click",function(){$("ddm").hidden=!$("ddm").hidden});
$("ddm").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var c=state.cats[+b.dataset.i];if(!c)return;$("cat").value=c.name;syncCat();this.hidden=true;catTouched=true;showSug(null);
  var nm=$("name");if(c.bill&&(!nm.value||nm.dataset.auto)){nm.value=c.name;nm.dataset.auto="1"}else if(nm.dataset.auto){nm.value="";delete nm.dataset.auto}});
document.addEventListener("click",function(e){
  var t=e.target,x;
  if(x=t.closest("[data-bf]")){billFilter=decodeURIComponent(x.dataset.bf);render();return}
  if(x=t.closest("[data-add]")){var rr=curReminders().filter(function(r){return r.key===decodeURIComponent(x.dataset.add)})[0];if(rr)prefillBill(rr);return}
  if(x=t.closest("[data-later]")){var lk=decodeURIComponent(x.dataset.later);laterKey=laterKey===lk?null:lk;render();return}
  if(x=t.closest("[data-sn]")){snoozeFor(decodeURIComponent(x.dataset.k),x.dataset.sn);return}
  if(x=t.closest("[data-snd]")){var v=$("snd").value,ms=v?new Date(v).getTime():NaN;if(isNaN(ms)||ms<=Date.now()){alert("Pick a date and time in the future.");return}setSnooze(decodeURIComponent(x.dataset.snd),ms);return}
  if(x=t.closest("[data-ce]")){$("cmp").hidden=false;openCat(+x.dataset.ce);return}
  if(x=t.closest("[data-cd]")){delCat(+x.dataset.cd);return}
  if(x=t.closest(".ed")){startEdit(x.dataset.id);return}
  if(x=t.closest("[data-undo]")){undoDel(x.dataset.undo);return}
  if(x=t.closest(".del")){var d=find(x.dataset.id);if(!d)return;askDel("x",d.id,d.name,d.freq!==0);return}
  if(x=t.closest(".chip")){selYear=+x.dataset.y;render();return}
  if(!t.closest("#dd"))$("ddm").hidden=true;
});
$("inc").addEventListener("input",function(){state.income=parseFloat(this.value)||0;save();render()});
$("sal").addEventListener("input",function(){state.salary=parseFloat(this.value)||0;save();render()});
$("pay").addEventListener("change",function(){state.payments=+this.value;save();render()});
$("cur").addEventListener("change",function(){state.cur=this.value;save();render()});
$("clear").addEventListener("click",function(){if(state.items.length)ask((state.items.length===1?X("Delete your only expense?","Να διαγραφεί το μοναδικό σας έξοδο;"):
  X("Delete all "+state.items.length+" expenses, from every month and year?","Να διαγραφούν και τα "+state.items.length+" έξοδα, από όλους τους μήνες και τα έτη;"))+" "+
  X("Your budget, savings and categories stay.","Ο προϋπολογισμός, οι αποταμιεύσεις και οι κατηγορίες μένουν."),function(){
  var prev=state.items;state.items=[];stopEdit();save();render();
  // the same way back as after deleting one expense: an Undo button for a few seconds
  var t=$("toast");if(!t)return;
  t.innerHTML='<span>'+esc(X("All expenses deleted","Όλα τα έξοδα διαγράφηκαν"))+'</span><button type="button" id="toastu">'+X("Undo","Αναίρεση")+'</button>';t.hidden=false;
  clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},8000);
  $("toastu").addEventListener("click",function(){t.hidden=true;clearTimeout(toastT);if(!state.items.length)state.items=prev;else state.items=prev.concat(state.items);save();render()})},{ok:"Delete all",danger:true})});
function dlBlob(name,blob){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},4000)}
function saveAs(name,blob,desc,mime,ext){
  if(typeof window.showSaveFilePicker!=="function"){dlBlob(name,blob);return Promise.resolve(true)}
  var acc={};acc[mime]=[ext];
  return window.showSaveFilePicker({suggestedName:name,types:[{description:desc,accept:acc}]}).then(function(h){return h.createWritable()}).then(function(w){return w.write(blob).then(function(){return w.close()})}).then(function(){return true},function(e){if(e&&e.name==="AbortError")return false;dlBlob(name,blob);return true})}
$("ex").addEventListener("click",function(){
  var d=new Date(),nm="cent-aur-backup-"+ymd(d)+".json";
  saveAs(nm,new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),"Cent-aur backup","application/json",".json").then(function(done){if(done)say("Backup saved")})});
$("im").addEventListener("click",function(){$("imf").click()});
$("imf").addEventListener("change",function(){
  var f=this.files[0];this.value="";if(!f)return;
  f.text().then(function(t){try{var d=JSON.parse(t);if(!applyData(d))throw 0;save();setTimeout(function(){say("Imported "+d.items.length+" expenses")},400)}catch(e){alert("That file isn’t a Cent-aur backup.")}})});

function setSnooze(key,ms){var cut=Date.now()-30*864e5;Object.keys(state.snooze).forEach(function(k){if(state.snooze[k]<cut)delete state.snooze[k]});
  state.snooze[key]=ms;laterKey=null;save();render()}
function snoozeFor(key,code){var d=new Date(),ms;
  if(code==="h1")ms=Date.now()+36e5;
  else if(code==="tm"){d.setDate(d.getDate()+1);d.setHours(9,0,0,0);ms=d.getTime()}
  else if(code==="d3")ms=Date.now()+3*864e5;
  else ms=Date.now()+7*864e5;
  setSnooze(key,ms)}

var ci=null,selIcon="grid";
function buildIcons(){$("ip").innerHTML=Object.keys(ICONS).map(function(id){return '<button type="button" class="icb" data-ic="'+id+'" aria-label="'+id+'">'+icTile(id)+'</button>'}).join("")}
function markIcon(){var b=$("ip").querySelectorAll(".icb");for(var i=0;i<b.length;i++)b[i].classList.toggle("on",b[i].dataset.ic===selIcon)}
function openCat(i){ci=i;var c=i>=0?state.cats[i]:{name:"",icon:"grid",bill:false,dueDay:null,every:1};
  $("cn").value=c.name;$("cg").value=c.group||"";selIcon=c.icon;$("cb").checked=c.bill;$("cd").value=c.dueDay||"";$("ce").value=String(c.every||1);$("cbo").hidden=!c.bill;markIcon();$("cf").hidden=false;$("cn").focus()}
function renderCats(){$("cl").innerHTML=state.cats.map(function(c,i){
  return '<div class="crow"><div>'+ic(c.name)+esc(c.name)+'<small>'+(c.bill?'Bill · due '+(c.dueDay?'day '+c.dueDay:'day of your last payment')+' · every '+(c.every>1?c.every+' months':'month'):'Expense category')+(c.group?' · Group: '+esc(c.group):'')+'</small></div>'+
  '<span class="act"><button class="ed" data-ce="'+i+'" aria-label="Edit category">✎</button><button class="del" data-cd="'+i+'" aria-label="Delete category">✕</button></span></div>'}).join("")}
function saveCat(force){
  var n=$("cn").value.trim();if(!n){alert("Give the category a name.");return}
  for(var j=0;j<state.cats.length;j++)if(j!==ci&&state.cats[j].name.toLowerCase()===n.toLowerCase()){alert("A category with that name already exists.");return}
  var dd=parseInt($("cd").value,10);if(!(dd>=1&&dd<=31))dd=null;
  var old=ci>=0?state.cats[ci]:null,bill=$("cb").checked;
  if(bill&&state.items.some(function(it){return it.cat===(old?old.name:n)&&it.freq!==0})&&force!==true){ask("Bills are one-time payments, so recurring expenses in this category will become one-time. Continue?",function(){saveCat(true)});return}
  var cfg={name:n,icon:selIcon,group:$("cg").value.trim().slice(0,40),bill:bill,dueDay:dd,every:+$("ce").value||1,since:old&&old.bill===bill?old.since:today().slice(0,7)};
  if(old&&old.name!==n){state.items.forEach(function(it){if(it.cat===old.name)it.cat=n});if($("cat").value===old.name)$("cat").value=n}
  if(old)state.cats[ci]=cfg;else state.cats.push(cfg);
  if(bill)state.items.forEach(function(it){if(it.cat===n)it.freq=0});
  $("cf").hidden=true;ci=null;buildMenu();renderCats();syncCat();save();render()}
function delCat(i){var c=state.cats[i];if(!c)return;
  if(c.name==="Other"){alert("The Other category can’t be deleted.");return}
  var n=state.items.filter(function(it){return it.cat===c.name}).length;
  ask("Delete the category \""+c.name+"\"?"+(n?" Its "+n+" expense"+(n===1?"":"s")+" will move to Other.":""),function(){doDelCat(c)},{ok:"Delete"})}
function doDelCat(c){
  if(!catOf("Other"))state.cats.push({name:"Other",icon:"grid",bill:false,dueDay:null,every:1,since:today().slice(0,7)});
  state.items.forEach(function(it){if(it.cat===c.name)it.cat="Other"});
  state.cats.splice(state.cats.indexOf(c),1);
  if($("cat").value===c.name)$("cat").value="Other";
  buildMenu();renderCats();syncCat();save();render()}
// one button opens the category list (✎ edits, ✕ deletes) with the form for a new category below it, and closes it again
$("cadd").addEventListener("click",function(){if(!$("cmp").hidden){$("cmp").hidden=true;$("cf").hidden=true;ci=null}else{$("cmp").hidden=false;openCat(-1)}});
$("ip").addEventListener("click",function(e){var b=e.target.closest(".icb");if(!b)return;selIcon=b.dataset.ic;markIcon()});
$("cb").addEventListener("change",function(){$("cbo").hidden=!this.checked});
$("cx").addEventListener("click",function(){$("cf").hidden=true;ci=null});
$("cs").addEventListener("click",function(){saveCat()});

function tick(){var sig=curReminders().map(function(r){return r.key}).join(",");if(today()!==lastDay||sig!==lastSig)render()}
setInterval(tick,60000);window.addEventListener("focus",tick);

var VN={bg:"--bg",card:"--card",text:"--text",muted:"--muted",line:"--line",accent:"--accent",at:"--accent-text"};
var PAL={
green:{n:"Green",p:["#f6f5f1","#2f7d5b"]},
ocean:{n:"Ocean",p:["#f1f5f9","#2563a8"],
 l:{bg:"#f1f5f9",card:"#ffffff",text:"#1c2430",muted:"#64707f",line:"#dfe5ec",accent:"#2563a8",at:"#ffffff"},
 d:{bg:"#0f1720",card:"#18232f",text:"#e6edf5",muted:"#8fa0b3",line:"#27384a",accent:"#5aa9f0",at:"#08182a"}},
sunset:{n:"Sunset",p:["#faf5ef","#c2570c"],
 l:{bg:"#faf5ef",card:"#ffffff",text:"#2a211a",muted:"#7a6a5c",line:"#eaded0",accent:"#c2570c",at:"#ffffff"},
 d:{bg:"#1a1511",card:"#251e18",text:"#f1e8df",muted:"#a8998a",line:"#3a2f26",accent:"#f0913f",at:"#2a1405"}},
violet:{n:"Violet",p:["#f6f3fa","#6d3fc0"],
 l:{bg:"#f6f3fa",card:"#ffffff",text:"#231d2c",muted:"#6f6680",line:"#e5deef",accent:"#6d3fc0",at:"#ffffff"},
 d:{bg:"#17131d",card:"#211b2a",text:"#ece6f4",muted:"#a095b3",line:"#352c44",accent:"#a98af0",at:"#1a0e33"}},
rose:{n:"Rose",p:["#fbf3f5","#c02a5a"],
 l:{bg:"#fbf3f5",card:"#ffffff",text:"#2b1d22",muted:"#7d6670",line:"#f0dde3",accent:"#c02a5a",at:"#ffffff"},
 d:{bg:"#1c1215",card:"#27191e",text:"#f4e6ea",muted:"#b09aa3",line:"#3d2830",accent:"#f06a93",at:"#2d0716"}},
graphite:{n:"Graphite",p:["#f2f2f2","#3d4852"],
 l:{bg:"#f2f2f2",card:"#ffffff",text:"#1e1e1e",muted:"#6b6b6b",line:"#e0e0e0",accent:"#3d4852",at:"#ffffff"},
 d:{bg:"#141414",card:"#1e1e1e",text:"#ececec",muted:"#999999",line:"#303030",accent:"#c9d1d9",at:"#14181c"}}
};
function isDark(){var m=state.theme.mode;if(m==="dark")return true;if(m==="light")return false;try{return !!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)}catch(e){return false}}
function applyTheme(){
  var r=document.documentElement,t=state.theme,pal=PAL[t.pal]||PAL.green,dark=isDark();
  if(t.mode==="auto")r.removeAttribute("data-theme");else r.setAttribute("data-theme",t.mode);
  Object.keys(VN).forEach(function(k){r.style.removeProperty(VN[k])});
  r.style.colorScheme="";
  if(pal.l){var v=dark?pal.d:pal.l;Object.keys(VN).forEach(function(k){r.style.setProperty(VN[k],v[k])});r.style.colorScheme=dark?"dark":"light"}
  try{localStorage.setItem("xpence-theme",JSON.stringify(t))}catch(e){}
  deskTitleBar(dark)}
// the desktop app's window title bar takes the page's background and text colours (ceTitleBar is given to the page by the app)
// links that open a new tab: in the desktop app they open in the PC's own browser instead
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[target="_blank"]');
  if(a&&typeof window.ceOpen==="function"&&/^https:\/\//.test(a.href)){e.preventDefault();Promise.resolve(window.ceOpen(a.href)).catch(function(){})}});
function deskTitleBar(dark){if(typeof window.ceTitleBar!=="function")return;
  var cs=getComputedStyle(document.body),c=function(s){var m=s.match(/\d+/g)||[0,0,0];return (+m[0])|(+m[1]<<8)|(+m[2]<<16)};   // Windows wants 0x00BBGGRR
  Promise.resolve(window.ceTitleBar(c(cs.backgroundColor),c(cs.color),dark)).catch(function(){})}
function earlyTheme(){try{var t=JSON.parse(localStorage.getItem("xpence-theme")||"null");if(t&&PAL[t.pal]){state.theme.pal=t.pal;if(t.mode==="light"||t.mode==="dark"||t.mode==="auto")state.theme.mode=t.mode}}catch(e){}applyTheme()}
function buildSw(){$("sw").innerHTML=Object.keys(PAL).map(function(k){var p=PAL[k];return '<button type="button" class="swb" data-p="'+k+'" aria-label="'+p.n+' theme"><span class="dot" style="background:linear-gradient(135deg,'+p.p[0]+' 50%,'+p.p[1]+' 50%)"></span>'+p.n+'</button>'}).join("")}
function syncOpts(){
  var b=$("sw").querySelectorAll(".swb");for(var i=0;i<b.length;i++)b[i].classList.toggle("on",b[i].dataset.p===state.theme.pal);
  $("mode").value=state.theme.mode;mrLabels()}
$("gear").addEventListener("click",function(e){e.stopPropagation();var o=$("opt");o.hidden=!o.hidden;this.setAttribute("aria-expanded",String(!o.hidden))});
function helpOpen(v){$("hov").hidden=!v;if(v){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false");$("hpx").focus()}else $("helpb").focus()}
$("helpb").addEventListener("click",function(e){e.stopPropagation();helpOpen(true)});
$("hpx").addEventListener("click",function(){helpOpen(false)});
// Help and Profile can be closed from several places; their buttons follow whether they are open
[["hov","helpb"],["pfov","pfb"]].forEach(function(p){new MutationObserver(function(){$(p[1]).setAttribute("aria-expanded",String(!$(p[0]).hidden))}).observe($(p[0]),{attributes:true,attributeFilter:["hidden"]})});
$("hov").addEventListener("click",function(e){if(e.target===this)helpOpen(false)});
// Profile: backups and the account, in a window like Help
function profileOpen(v){$("pfov").hidden=!v;if(v){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false");$("pfx").focus()}else $("pfb").focus()}
$("pfb").addEventListener("click",function(e){e.stopPropagation();profileOpen(true)});
$("pfx").addEventListener("click",function(){profileOpen(false)});
$("pfov").addEventListener("click",function(e){if(e.target===this)profileOpen(false)});
// a dialog opened from the profile (manage users, a question) closes first
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("pfov").hidden&&!document.querySelector(".dlgo:not([hidden])"))profileOpen(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("hov").hidden)helpOpen(false)});
$("optx").addEventListener("click",function(){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false")});
// open Settings moves down only the card columns it would cover, so nothing sits under it
function optPush(){var o=$("opt"),cs=document.querySelectorAll("#cols>.col,#flcols>.col");
  cs.forEach(function(c){c.style.marginTop=""});if(o.hidden)return;
  var r=o.getBoundingClientRect();
  cs.forEach(function(c){if(!c.offsetParent)return;var b=c.getBoundingClientRect();if(b.height&&b.left<r.right&&b.right>r.left&&b.top<r.bottom+40)c.style.marginTop=Math.ceil(r.bottom+40-b.top)+"px"})}
new MutationObserver(optPush).observe($("opt"),{attributes:true,attributeFilter:["hidden"]});
if(window.ResizeObserver)new ResizeObserver(function(){if(!$("opt").hidden)optPush()}).observe($("opt"));
window.addEventListener("resize",optPush);
document.addEventListener("click",function(e){if(!$("opt").hidden&&!e.target.closest("#opt")&&!e.target.closest("#gear")){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false")}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("opt").hidden){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false")}});
$("sw").addEventListener("click",function(e){var b=e.target.closest(".swb");if(!b)return;state.theme.pal=b.dataset.p;applyTheme();syncOpts();save()});
$("mode").addEventListener("change",function(){state.theme.mode=this.value;applyTheme();save()});
try{var mq=window.matchMedia("(prefers-color-scheme: dark)");if(mq.addEventListener)mq.addEventListener("change",function(){if(state.theme.mode==="auto")applyTheme()})}catch(e){}
buildSw();earlyTheme();syncOpts();

//#calc
function cfmt(n){return String(parseFloat(n.toPrecision(12)))}
function cnew(){return {a:null,op:null,cur:"0",fresh:true,expr:""}}
function cpress(s,k){
  if(s.cur==="Error"&&k!=="C"){return s}
  if(/^[0-9]$/.test(k)){if(s.fresh){s.cur=k;s.fresh=false}else if(s.cur.replace(/[-.]/g,"").length<14)s.cur=s.cur==="0"?k:s.cur==="-0"?"-"+k:s.cur+k;return s}
  if(k==="."){if(s.fresh){s.cur="0.";s.fresh=false}else if(s.cur.indexOf(".")<0)s.cur+=".";return s}
  if(k==="C"){return cnew()}
  if(k==="B"){if(!s.fresh&&s.cur.length>1&&s.cur!=="-0"){s.cur=s.cur.slice(0,-1);if(s.cur==="-")s.cur="0"}else if(!s.fresh)s.cur="0";return s}
  if(k==="N"){var v=parseFloat(s.cur);if(v!==0||s.cur.indexOf(".")>=0||s.cur==="-0"){s.cur=s.cur.charAt(0)==="-"?s.cur.slice(1):"-"+s.cur}return s}
  if(k==="%"){var p=parseFloat(s.cur)/100;if(s.op&&s.a!==null)p=s.a*parseFloat(s.cur)/100;s.cur=cfmt(p);s.fresh=true;return s}
  if(k==="+"||k==="-"||k==="*"||k==="/"){
    if(s.op&&!s.fresh){s=cpress(s,"=");if(s.cur==="Error")return s}
    if(s.a===null||!s.op)s.a=parseFloat(s.cur);
    s.op=k;s.fresh=true;s.expr=cfmt(s.a)+" "+({"*":"×","/":"÷","-":"−","+":"+"})[k];return s}
  if(k==="="){if(!s.op)return s;var a=s.a,b=parseFloat(s.cur),r;
    r=s.op==="+"?a+b:s.op==="-"?a-b:s.op==="*"?a*b:(b===0?NaN:a/b);
    var sym=({"*":"×","/":"÷","-":"−","+":"+"})[s.op];
    if(!isFinite(r)){return {a:null,op:null,cur:"Error",fresh:true,expr:cfmt(a)+" "+sym+" "+cfmt(b)+" ="}}
    s.expr=cfmt(a)+" "+sym+" "+cfmt(b)+" =";s.cur=cfmt(r);s.a=null;s.op=null;s.fresh=true;return s}
  return s}
//#endcalc
var calcs=[],zc=60,ccount=0;
var KEYS=[["C","C"],["⌫","B"],["%","%"],["÷","/"],["7","7"],["8","8"],["9","9"],["×","*"],["4","4"],["5","5"],["6","6"],["−","-"],["1","1"],["2","2"],["3","3"],["+","+"],["±","N"],["0","0"],[".","."],["=","="]];
function closeCalc(c){var i=calcs.indexOf(c);if(i>=0)calcs.splice(i,1);if(c.el.parentNode)c.el.parentNode.removeChild(c.el);$("calcx").hidden=!calcs.length}
function openCalc(){
  var el=document.createElement("div"),k=ccount++%8,c={el:el,s:cnew()};
  el.className="calc";el.tabIndex=0;el.setAttribute("role","dialog");el.setAttribute("aria-label","Calculator");
  el.innerHTML='<div class="ch"><span>Calculator</span><button type="button" data-x="1" aria-label="Close calculator">✕</button></div><div class="cdp"><div class="cex"></div><div class="cv">0</div></div><div class="ck">'+
    KEYS.map(function(kk){var cl="+-*/".indexOf(kk[1])>=0&&kk[1].length===1?"op":kk[1]==="="?"eq":"";return '<button type="button" class="'+cl+'" data-k="'+kk[1]+'">'+kk[0]+'</button>'}).join("")+'</div>';
  var w=Math.max(window.innerWidth||800,300);
  el.style.left=Math.max(8,Math.min(w-250,(w-236)/2+k*28-100))+"px";el.style.top=(90+k*28)+"px";el.style.zIndex=++zc;
  function show(){var v=el.querySelector(".cv");v.textContent=c.s.cur;v.style.fontSize=c.s.cur.length>12?"1.1rem":c.s.cur.length>9?"1.4rem":"1.7rem";el.querySelector(".cex").textContent=c.s.expr}
  function front(){el.style.zIndex=++zc}
  el.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;
    if(b.dataset.x){closeCalc(c);return}
    c.s=cpress(c.s,b.dataset.k);show();el.focus()});
  el.addEventListener("keydown",function(e){var key=e.key,m=null;
    if(/^[0-9]$/.test(key)||key==="."||key==="+"||key==="-"||key==="*"||key==="/"||key==="%")m=key;
    else if(key===",")m=".";else if(key==="Enter"||key==="=")m="=";else if(key==="Backspace")m="B";else if(key==="Delete"||key==="c"||key==="C")m="C";
    else if(key==="Escape"){closeCalc(c);return}
    if(m){e.preventDefault();c.s=cpress(c.s,m);show()}});
  el.addEventListener("pointerdown",front);
  var hd=el.querySelector(".ch"),dx=0,dy=0,drag=false;
  hd.addEventListener("pointerdown",function(e){if(e.target.closest("button"))return;drag=true;dx=e.clientX-el.offsetLeft;dy=e.clientY-el.offsetTop;try{hd.setPointerCapture(e.pointerId)}catch(x){}});
  hd.addEventListener("pointermove",function(e){if(!drag)return;el.style.left=Math.max(0,Math.min((window.innerWidth||800)-60,e.clientX-dx))+"px";el.style.top=Math.max(0,Math.min((window.innerHeight||600)-40,e.clientY-dy))+"px"});
  hd.addEventListener("pointerup",function(){drag=false});
  document.body.appendChild(el);calcs.push(c);$("calcx").hidden=false;show();el.focus()}
var flYear=null,flType="in",flEdit=null;
var FL_IN=["Client work","Retainer","Product sales","Other income"],FL_OUT=["Software & tools","Equipment","Travel","Marketing","Office & coworking","Taxes & fees","Other expense"];
var UPI='<path d="M12 19V5M6 11l6-6 6 6"/>',DNI='<path d="M12 5v14M6 13l6 6 6-6"/>';
function flTile(out){return '<span class="ib" style="--c:'+(out?'#e5484d':'#2f9e44')+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(out?DNI:UPI)+'</svg></span>'}
function flRow(o){if(isPend("f",o.id))return phHTML("f",o.id);
  var out=o.type==="out",v=flVatOf(o),amt=out?flCost(o):flNet(o);
  var sub=dm(o.date)+(o.client&&o.name?' · '+esc(o.client):'')+(o.cat?' · '+esc(o.cat):'');
  var vt=v>0?'<small>'+(out?X("VAT "+fmt(v)+(o.vd===false?" (not deductible)":" (deductible)"),"ΦΠΑ "+fmt(v)+(o.vd===false?" (μη εκπεστέο)":" (εκπεστέο)")):X("VAT "+fmt(v)+" · gross "+fmt(flGross(o)),"ΦΠΑ "+fmt(v)+" · μικτό "+fmt(flGross(o))))+'</small>':'';
  return '<div class="eo"><div>'+flTile(out)+esc(o.name||o.client||o.cat||(out?"Expense":"Earning"))+(o.paid?'':'<span class="pend">pending</span>')+'<small>'+sub+'</small></div><div class="num '+(out?'neg':'pos')+'">'+(out?'−':'+')+fmt(amt)+vt+'</div><span class="act">'+(o.paid?'':'<button type="button" class="pill" data-flrecv="'+o.id+'">Received</button>')+'<button class="ed" data-fled="'+o.id+'" aria-label="Edit">✎</button><button class="del" data-fldel="'+o.id+'" aria-label="Delete">✕</button></span></div>'}
function flSum(m){var e=0,x=0;m.forEach(function(o){if(isPend("f",o.id))return;if(o.type==="out")x+=flCost(o);else if(o.paid)e+=flNet(o)});var n=e-x;return (n<0?'−':'+')+fmt(Math.abs(n))+' profit'}
var flClient=null;
function renderFl(){
  var ci=idxOf(today()),cy=Math.floor(ci/12),all=state.fl.items,its=flLive(),ys={};ys[cy]=1;all.forEach(function(o){ys[+o.date.slice(0,4)]=1});
  if(flYear===null||!ys[flYear])flYear=cy;
  $("flyrs").innerHTML=Object.keys(ys).map(Number).sort(function(a,b){return a-b}).map(function(y){return '<button type="button" class="flchip'+(y===flYear?' on':'')+'" data-fy="'+y+'">'+y+'</button>'}).join("");
  var Y=flYearT(its,flYear),cur=flYear===cy,t=cur?flMonth(its,ci):Y,lab=cur?MN(ci):String(flYear),pr=t.earn-t.exp;
  $("flmlab").textContent="Profit in "+lab;$("flmp").textContent=fmt(pr);$("flme").textContent=fmt(t.earn);$("flmx").textContent=fmt(t.exp);
  $("flpl").textContent="Pending invoices in "+flYear+" (not yet received)";$("flpend").textContent=fmt(Y.pend);
  $("flyl").textContent="Totals for "+flYear;$("fye").textContent=fmt(Y.earn);$("fyx").textContent=fmt(Y.exp);
  var yp=Y.earn-Y.exp;$("fyp").textContent=fmt(yp);$("fyp").className=yp<0?"neg":"pos";
  $("fltaxv").textContent=fmt(Math.max(0,yp)*(+state.fl.tax||0)/100);
  renderFcalc();renderVat(its);renderClients(its);renderRep(its);
  var fb=$("flfilt");
  if(flClient!==null){fb.hidden=false;fb.innerHTML='<span>'+X("Showing: ","Εμφάνιση: ")+'<b>'+esc(flClient||X("No client","Χωρίς πελάτη"))+'</b></span><button type="button" class="pill" data-flclear="1">'+X("Show all","Εμφάνιση όλων")+'</button>'}
  else{fb.hidden=true;fb.innerHTML=""}
  $("fllist").innerHTML=periodHTML(all.filter(function(o){return +o.date.slice(0,4)===flYear&&(flClient===null||(o.client||"")===flClient)}),"f",flRow,"",'<div class="hint">No entries this month yet.</div>',"months",flSum,flYear)}
var FEE_PRE={free:0,block:500,biz:800};
function renderFcalc(){var c=state.fl.calc,its=flLive(),Y=flYearT(its,flYear===null?0:flYear);
  var rev=c.rev===""?Y.earn:+c.rev,exp=c.exp===""?Y.exp:+c.exp;
  $("fcrev").placeholder=fmt(Y.earn);$("fcexp").placeholder=fmt(Y.exp);
  var r=calcFreelance({rev:rev,exp:exp,efka:c.efka,age:c.age,fee:c.fee,first:c.first,year:flYear});
  var rows=r.rows.map(function(b){return '<div class="yb" style="margin:2px 0;font-size:.85rem"><span>'+(b.from===0?'First '+fmt(b.to):fmt(b.from)+' – '+fmt(b.to))+' × '+(b.rate*100).toFixed(0)+'%</span><b>'+fmt(b.tax)+'</b></div>'}).join("");
  function line(l,v,cls){return '<div class="yb" style="margin:6px 0"><span>'+l+'</span><b'+(cls?' class="'+cls+'"':'')+'>'+v+'</b></div>'}
  $("fctop").textContent="Estimate for "+flYear+" · "+(flYear<2026?"2025 tax scale (9/22/28/36/44%)":"2026 tax scale (9/20/26/34/39/44%)")+(c.rev===""&&c.exp===""?" · using your entries":"");
  $("fcres").innerHTML='<div class="ol">Result</div>'+line("Revenue",fmt(r.rev))+line("− Business expenses",fmt(r.exp))+line("− ΕΦΚΑ (12 months)",fmt(r.efka))+line("= Taxable income",fmt(r.taxable))+
    (rows?'<div class="ol">Income tax by bracket</div>'+rows:'')+line("Income tax",fmt(r.tax),"neg")+line("Τέλος επιτηδεύματος",fmt(r.fee),r.fee>0?"neg":"")+
    line("Net after tax, ΕΦΚΑ and fee",fmt(r.net),r.net<0?"neg":"pos")+line("Effective tax rate",(r.eff*100).toFixed(1)+"%")+
    line("Tax prepayment next year (55%)",c.first?"none in the first year":fmt(r.prepay))+line("Suggested set-aside (tax + fee) of profit",(r.aside*100).toFixed(1)+"%");
  $("fcapply").dataset.v=(Math.round(r.aside*1000)/10)}
function fillFlCats(sel){var l=flType==="out"?FL_OUT:FL_IN;$("flc").innerHTML=l.map(function(c){return '<option'+(c===sel?' selected':'')+'>'+c+'</option>'}).join("")}
function setFlType(t,sel){flType=t==="out"?"out":"in";fillFlCats(sel);$("flpaidw").style.display=flType==="out"?"none":"flex";
  Array.prototype.forEach.call(document.querySelectorAll("[data-fltype]"),function(b){b.classList.toggle("on",b.getAttribute("data-fltype")===flType)});syncFlForm()}
function stopFl(){flEdit=null;$("fla").value="";$("fln").value="";$("flcli").value="";$("fld").value=today();$("flpaid").checked=true;$("flb").textContent="Add";$("flcn").hidden=true;
  var v=state.fl.vat;fillVr(v.rate);$("flvr").value=String(v.rate);$("flinc").value=v.incl?"1":"0";$("flvd").checked=true;setFlType(flType)}
function syncFcalc(){var c=state.fl.calc;$("fcrev").value=c.rev;$("fcexp").value=c.exp;$("fcefka").value=c.efka;$("fcage").value=c.age;$("fcpre").value=c.pre;$("fcfee").value=c.fee||"";$("fcfirst").checked=c.first;$("freel").checked=!!state.freelancer}
function applyTab(){if(!state.freelancer)state.tab="personal";document.querySelector(".tabs").hidden=!state.freelancer;var f=state.tab==="freelancer";$("cols").hidden=f;$("flview").hidden=!f;
  $("tabP").classList.toggle("on",!f);$("tabF").classList.toggle("on",f);$("tabP").setAttribute("aria-selected",String(!f));$("tabF").setAttribute("aria-selected",String(f));
  $("viewb").hidden=f;if(f)viewOpen(false)}
function foldCard(k){return k==="fcd"?null:document.querySelector('.slot[data-card="'+k+'"] .card')}
function applyCollapse(){if(!document.querySelector)return;var c=state.collapsed||{};
  ["savings","extra","insights","goals","trend"].forEach(function(k){var e=foldCard(k);if(!e)return;if(!e.classList.add)return;e.classList.add("fold");e.classList.toggle("shut",!!c[k]);var h=e.querySelector(".head h2");if(h)foldBtn(h).setAttribute("aria-expanded",String(!c[k]))});
  var f=$("fcd");if(f)f.open=!c.fcd;var x=$("xs");if(x)x.open=!c.xs}
// the heading stays a heading; its text goes inside a real button that opens and closes the card
function foldBtn(h){var b=h.querySelector(".foldb");if(!b){b=document.createElement("button");b.type="button";b.className="foldb";while(h.firstChild)b.appendChild(h.firstChild);h.appendChild(b)}return b}
function toggleFold(k){state.collapsed=state.collapsed||{};if(state.collapsed[k])delete state.collapsed[k];else state.collapsed[k]=true;applyCollapse();save()}
if(document.querySelector){["savings","extra","insights","goals","trend"].forEach(function(k){var e=foldCard(k),h=e&&e.querySelector(".head h2");if(!h)return;
  h.addEventListener("click",function(){toggleFold(k)})});
  [["fcd","fcd"],["xs","xs"]].forEach(function(p){var fd=$(p[0]);if(fd&&fd.addEventListener)fd.addEventListener("toggle",function(){var c=state.collapsed=state.collapsed||{};if(fd.open===!c[p[1]])return;c[p[1]]=!fd.open;save()})})}
function applyFull(){if(document.body&&document.body.classList)document.body.classList.toggle("fulllists",!!state.fullLists);if($("fulll"))$("fulll").checked=!!state.fullLists}
$("fulll").addEventListener("change",function(){state.fullLists=this.checked;applyFull();save()});
function applySimple(){if(document.body&&document.body.classList)document.body.classList.toggle("simple",!!state.simple);$("simpleb").setAttribute("aria-pressed",String(!!state.simple));$("simpleb").querySelector("span").textContent=state.simple?"Full view":"Simple"}
function applyLayout(){if(!document.querySelector)return;var l=normLayout(state.layout);
  ["L","M","R"].forEach(function(c){var col=$("col"+c);l[c].forEach(function(id){var s=document.querySelector('.slot[data-card="'+id+'"]');if(s)col.appendChild(s)})});syncCtl()}
function applyFlLayout(){if(!document.querySelector)return;var l=normFl(state.flLayout);
  ["L","A","B"].forEach(function(c){var col=$("fl"+c);l[c].forEach(function(id){var sl=document.querySelector('.slot[data-card="'+id+'"]');if(sl)col.appendChild(sl)})});syncFlCols();syncCtl()}
function flHas(c){return Array.prototype.some.call($("fl"+c).children,function(x){return x.classList&&x.classList.contains("slot")})}
// Freelancer columns work like the Personal ones: left | main | right on wide screens,
// main + stacked side columns on medium screens, one column on phones; empty columns hide (not in Edit mode).
function syncFlCols(){var g=$("flcols");if(!g||!$("flL"))return;
  var w=window.innerWidth,ed=document.body.classList.contains("editing"),cols=["L","A","B"],vis={},el={};
  cols.forEach(function(c){el[c]=$("fl"+c);vis[c]=ed||flHas(c);el[c].style.display=vis[c]?"":"none";el[c].style.gridColumn="";el[c].style.gridRow=""});
  g.classList.toggle("eL",!flHas("L"));g.classList.toggle("eA",!flHas("A"));g.classList.toggle("eB",!flHas("B"));
  if(w<860){g.style.gridTemplateColumns="";return}
  var vc=cols.filter(function(c){return vis[c]});if(!vc.length)return;
  if(w>=1240){g.style.gridTemplateColumns=vc.map(function(c){return c==="L"?"340px":c==="B"?"380px":"minmax(0,1fr)"}).join(" ");
    vc.forEach(function(c,i){el[c].style.gridColumn=String(i+1);el[c].style.gridRow="1"});return}
  var side=["L","B"].filter(function(c){return vis[c]});
  if(vis.A&&side.length){g.style.gridTemplateColumns="minmax(0,1fr) 380px";el.A.style.gridColumn="1";el.A.style.gridRow="1 / span "+side.length;
    side.forEach(function(c,i){el[c].style.gridColumn="2";el[c].style.gridRow=String(i+1)})}
  else{g.style.gridTemplateColumns="minmax(0,1fr)";vc.forEach(function(c,i){el[c].style.gridColumn="1";el[c].style.gridRow=String(i+1)})}}
window.addEventListener("resize",function(){syncFlCols()})
function readFl(){var o={};["L","A","B"].forEach(function(c){o[c]=Array.prototype.filter.call($("fl"+c).children,function(x){return x.getAttribute&&x.getAttribute("data-card")}).map(function(x){return x.getAttribute("data-card")})});return o}
function readLayout(){var o={};["L","M","R"].forEach(function(c){o[c]=Array.prototype.filter.call($("col"+c).children,function(s){return s.getAttribute&&s.getAttribute("data-card")}).map(function(s){return s.getAttribute("data-card")})});return o}
var COLORD={colL:0,colM:1,colR:2,flL:0,flA:1,flB:2};
function syncCtl(){if(!document.querySelectorAll)return;
  Array.prototype.forEach.call(document.querySelectorAll(".slot"),function(s){var col=s.parentNode,b=function(k){return s.querySelector('[data-mv="'+k+'"]')},ci=COLORD[col.id],mx=2;if(!b("u"))return;
    b("u").disabled=!s.previousElementSibling;b("d").disabled=!s.nextElementSibling;b("l").disabled=ci<=0;b("r").disabled=ci>=mx})}
function commitLayout(){state.layout=readLayout();state.flLayout=readFl();syncFlCols();applyView();save();syncCtl()}
function setEdit(on){layEdit=on;document.body.classList.toggle("editing",on);syncFlCols();$("editb").setAttribute("aria-pressed",String(on));$("editb").querySelector("span").textContent=on?"Done":"Edit";$("editr").hidden=!on;
  Array.prototype.forEach.call(document.querySelectorAll(".slot"),function(s){s.draggable=on;s.querySelector(".ctl").hidden=!on});syncCtl()}
$("editb").addEventListener("click",function(){setEdit(!layEdit)});
$("editr").addEventListener("click",function(){if(state.tab==="freelancer"){state.flLayout=normFl(null);applyFlLayout()}else{state.layout=normLayout(null);applyLayout()}save()});
var dragS=null;
[$("cols"),$("flcols")].forEach(function(C){
C.addEventListener("click",function(e){var b=e.target.closest("[data-mv]");if(!b||b.disabled)return;var s=b.closest(".slot"),col=s.parentNode,k=b.getAttribute("data-mv"),order=C.id==="cols"?["colL","colM","colR"]:["flL","flA","flB"];
  if(k==="u"&&s.previousElementSibling)col.insertBefore(s,s.previousElementSibling);
  else if(k==="d"&&s.nextElementSibling)col.insertBefore(s.nextElementSibling,s);
  else if(k==="l"||k==="r"){var ci=order.indexOf(col.id)+(k==="r"?1:-1);if(ci<0||ci>=order.length)return;var t=$(order[ci]),idx=Array.prototype.indexOf.call(col.children,s);t.insertBefore(s,t.children[idx]||null)}
  commitLayout();s.scrollIntoView&&s.scrollIntoView({block:"nearest"})});
C.addEventListener("dragstart",function(e){var s=e.target.closest&&e.target.closest(".slot");if(!layEdit||!s){e.preventDefault();return}dragS=s;s.classList.add("dragging");try{e.dataTransfer.setData("text/plain",s.getAttribute("data-card"));e.dataTransfer.effectAllowed="move"}catch(x){}});
C.addEventListener("dragover",function(e){if(!dragS)return;var col=e.target.closest(".col");if(!col||!C.contains(col))return;e.preventDefault();
  var after=null,sl=Array.prototype.filter.call(col.children,function(c){return c!==dragS});
  for(var i=0;i<sl.length;i++){var r=sl[i].getBoundingClientRect();if(e.clientY<r.top+r.height/2){after=sl[i];break}}
  if(after){if(dragS.nextElementSibling!==after||dragS.parentNode!==col)col.insertBefore(dragS,after)}else if(col.lastElementChild!==dragS||dragS.parentNode!==col)col.appendChild(dragS)});
C.addEventListener("drop",function(e){if(dragS)e.preventDefault()});
C.addEventListener("dragend",function(){if(dragS){dragS.classList.remove("dragging");dragS=null;commitLayout()}})});
document.querySelector(".tabs").addEventListener("click",function(e){var b=e.target.closest("[data-tab]");if(!b)return;state.tab=b.getAttribute("data-tab");applyTab();save();render()});
$("simpleb").addEventListener("click",function(){state.simple=!state.simple;applySimple();save();render()});
$("flview").addEventListener("click",function(e){var b;
  if(b=e.target.closest("[data-fy]")){flYear=+b.getAttribute("data-fy");renderFl();return}
  if(b=e.target.closest("[data-fltype]")){setFlType(b.getAttribute("data-fltype"));return}
  if(b=e.target.closest("[data-flrecv]")){var id=b.getAttribute("data-flrecv");state.fl.items.forEach(function(o){if(o.id===id)o.paid=true});save();renderFl();return}
  if(b=e.target.closest("[data-fldel]")){var d=b.getAttribute("data-fldel"),o0=state.fl.items.filter(function(o){return o.id===d})[0];askDel("f",d,o0?(o0.name||o0.cat):"");return}
  if(b=e.target.closest("[data-fled]")){var o=state.fl.items.filter(function(x){return x.id===b.getAttribute("data-fled")})[0];if(!o)return;
    flEdit=o.id;setFlType(o.type,o.cat);$("fla").value=o.amt;$("fld").value=o.date;$("fln").value=o.name;$("flpaid").checked=o.paid;$("flcli").value=o.client||"";fillVr(o.vr||0);$("flvr").value=String(o.vr||0);$("flinc").value=o.incl?"1":"0";$("flvd").checked=o.vd!==false;updateFlPrev();$("flb").textContent="Save";$("flcn").hidden=false;$("fla").focus()}});
$("flf").addEventListener("submit",function(e){e.preventDefault();var a=parseFloat($("fla").value);if(!(a>0)||!$("fld").value)return;
  var pvF=flEdit?state.fl.items.filter(function(x){return x.id===flEdit})[0]:null,on=flVatOn(),out=flType==="out";
  var o={id:flEdit||nid(),type:flType,name:$("fln").value.trim().slice(0,60),amt:a,date:$("fld").value,cat:$("flc").value,paid:out?true:$("flpaid").checked,
    client:out?"":clientName($("flcli").value),vr:on?+$("flvr").value:(pvF?pvF.vr||0:0),incl:on?$("flinc").value==="1":(pvF?!!pvF.incl:false)};
  if(out)o.vd=on?$("flvd").checked:!(pvF&&pvF.vd===false);
  if(on){state.fl.vat.incl=o.incl;if([0,6,13,24].indexOf(o.vr)>=0)state.fl.vat.rate=o.vr}
  if(flEdit)state.fl.items=state.fl.items.map(function(x){return x.id===flEdit?o:x});else state.fl.items.push(o);
  stopFl();save();renderFl();if(pvF)editToast(X("Entry updated","Η καταχώρηση ενημερώθηκε"),function(){return state.fl.items},pvF)});
$("flcn").addEventListener("click",stopFl);
$("fltax").addEventListener("input",function(){var v=parseFloat(this.value);state.fl.tax=(v>=0&&v<=100)?v:0;save();renderFl()});
fillFlCats();$("fld").value=today();
function fcSet(k,v){state.fl.calc[k]=v;save();renderFcalc()}
$("fcrev").addEventListener("input",function(){fcSet("rev",this.value===""||!(parseFloat(this.value)>=0)?"":parseFloat(this.value))});
$("fcexp").addEventListener("input",function(){fcSet("exp",this.value===""||!(parseFloat(this.value)>=0)?"":parseFloat(this.value))});
$("fcefka").addEventListener("input",function(){fcSet("efka",parseFloat(this.value)>=0?parseFloat(this.value):0)});
$("fcefk1").addEventListener("click",function(){$("fcefka").value="250.77";fcSet("efka",250.77)});
$("fcage").addEventListener("change",function(){fcSet("age",this.value)});
$("fcfirst").addEventListener("change",function(){fcSet("first",this.checked)});
$("fcpre").addEventListener("change",function(){var v=this.value;state.fl.calc.pre=v;if(v!=="custom"){state.fl.calc.fee=FEE_PRE[v];$("fcfee").value=FEE_PRE[v]||""}save();renderFcalc()});
$("fcfee").addEventListener("input",function(){state.fl.calc.pre="custom";$("fcpre").value="custom";fcSet("fee",parseFloat(this.value)>=0?parseFloat(this.value):0)});
$("fcapply").addEventListener("click",function(){var v=parseFloat(this.dataset.v);if(!(v>=0))return;state.fl.tax=Math.min(100,v);$("fltax").value=state.fl.tax||"";save();renderFl()});
$("freel").addEventListener("change",function(){state.freelancer=this.checked;if(!this.checked)state.tab="personal";applyTab();save();render()});
var editWD=null;
function stopWD(){editWD=null;$("wa").value="";$("wr").value="";$("wd").value=today();$("wb").textContent="Withdraw";$("wc").hidden=true}
$("wd").value=today();
$("wf").addEventListener("submit",function(e){e.preventDefault();var a=parseFloat($("wa").value);if(!(a>0)||!$("wd").value)return;
  var o={id:editWD||nid(),date:$("wd").value,reason:$("wr").value.trim().slice(0,60),amt:a};
  var pvW=editWD?state.withdraw.filter(function(x){return x.id===editWD})[0]:null;if(editWD)state.withdraw=state.withdraw.map(function(x){return x.id===editWD?o:x});else state.withdraw.push(o);
  stopWD();save();render();if(pvW)editToast(X("Withdrawal updated","Η ανάληψη ενημερώθηκε"),function(){return state.withdraw},pvW)});
$("wc").addEventListener("click",stopWD);
$("wlist").addEventListener("click",function(e){var b;
  if(b=e.target.closest("[data-wdel]")){var id=b.getAttribute("data-wdel"),o0=state.withdraw.filter(function(x){return x.id===id})[0];askDel("w",id,o0?o0.reason:"")}
  else if(b=e.target.closest("[data-wed]")){var o=state.withdraw.filter(function(x){return x.id===b.getAttribute("data-wed")})[0];if(!o)return;
    editWD=o.id;$("wd").value=o.date;$("wa").value=o.amt;$("wr").value=o.reason;$("wb").textContent="Save";$("wc").hidden=false;$("wa").focus()}});
var editEO=null;
function stopEO(){editEO=null;$("eoa").value="";$("eon").value="";$("eod").value=today();$("eot").value="savings";$("eob").textContent="Add";$("eoc").hidden=true}
$("eod").value=today();
$("eof").addEventListener("submit",function(e){e.preventDefault();var a=parseFloat($("eoa").value);if(!(a>0)||!$("eod").value)return;
  var o={id:editEO||nid(),date:$("eod").value,label:$("eon").value.trim().slice(0,60),amt:a,to:$("eot").value==="budget"?"budget":"savings"};
  var pvE=editEO?state.oneoff.filter(function(x){return x.id===editEO})[0]:null;if(editEO)state.oneoff=state.oneoff.map(function(x){return x.id===editEO?o:x});else state.oneoff.push(o);
  stopEO();save();render();if(pvE)editToast(X("Extra money updated","Τα έκτακτα έσοδα ενημερώθηκαν"),function(){return state.oneoff},pvE)});
$("eoc").addEventListener("click",stopEO);
function eoClick(e){var b;
  if(b=e.target.closest("[data-edel]")){var id=b.getAttribute("data-edel"),o0=state.oneoff.filter(function(x){return x.id===id})[0];askDel("e",id,o0?o0.label:"")}
  else if(b=e.target.closest("[data-eed]")){var o=state.oneoff.filter(function(x){return x.id===b.getAttribute("data-eed")})[0];if(!o)return;
    editEO=o.id;$("eod").value=o.date;$("eoa").value=o.amt;$("eon").value=o.label;$("eot").value=o.to;$("eob").textContent="Save";$("eoc").hidden=false;$("eoa").focus()}}
$("eolist").addEventListener("click",eoClick);$("gainlist").addEventListener("click",eoClick);
$("xsl").addEventListener("change",function(e){var k=e.target.getAttribute("data-xm");if(!k)return;state.xm[k]=+e.target.value;save();render()});
$("xsl").addEventListener("click",function(e){var b=e.target.closest("[data-half]");if(!b)return;state.half=b.getAttribute("data-half");save();render()});
$("mbl").addEventListener("change",function(e){var k=e.target.getAttribute("data-mb");if(!k)return;
  var v=e.target.value,ob=oneSum(state,idxOf(k+"-01"),"budget"),n=parseFloat(v)-ob;
  if(v===""||!(parseFloat(v)>=0)||Math.abs(n-(+state.income||0))<0.005)delete state.budgets[k];else state.budgets[k]=Math.max(0,n);save();render()});
Array.prototype.forEach.call(document.querySelectorAll(".ordsel"),function(o){o.addEventListener("change",function(){state.order=this.value==="old"?"old":"new";save();render()})});
$("calcb").addEventListener("click",openCalc);
$("calcx").addEventListener("click",function(){calcs.slice().forEach(closeCalc)});
// buttons in the cards that open a panel, form, menu or window stay highlighted while it is open
var OPENB=[["cadd",function(){return !$("cmp").hidden}],
  ["mrt",function(){return !$("mrp").hidden}],["calcb",function(){return calcs.length>0}],["ddb",function(){return !$("ddm").hidden}]];
function syncOpenB(){OPENB.forEach(function(p){var b=$(p[0]);if(!b)return;var on=!!p[1]();if(b.classList.contains("isopen")!==on){b.classList.toggle("isopen",on);b.setAttribute("aria-expanded",String(on))}})}
new MutationObserver(syncOpenB).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden"]});

/* ===== Language (English / Ελληνικά) ===== */
var EN_M="January|February|March|April|May|June|July|August|September|October|November|December".split("|"),MONRE=EN_M.join("|"),
  EL_M=["Ιανουάριος","Φεβρουάριος","Μάρτιος","Απρίλιος","Μάιος","Ιούνιος","Ιούλιος","Αύγουστος","Σεπτέμβριος","Οκτώβριος","Νοέμβριος","Δεκέμβριος"],
  EL_G=["Ιανουαρίου","Φεβρουαρίου","Μαρτίου","Απριλίου","Μαΐου","Ιουνίου","Ιουλίου","Αυγούστου","Σεπτεμβρίου","Οκτωβρίου","Νοεμβρίου","Δεκεμβρίου"];
function mNom(n){return EL_M[EN_M.indexOf(n)]}
function mGen(n){return EL_G[EN_M.indexOf(n)]}
function mAcc(n){return EL_M[EN_M.indexOf(n)].slice(0,-1)}
function plu(n,a,b){return +n===1?a:b}
var A="(\\S+ -?[\\d.,]+)";
var DICT={"Data folder":"Φάκελος δεδομένων","Change…":"Αλλαγή…","Use the standard folder":"Χρήση του βασικού φακέλου","Where this PC keeps your offline data and the app’s settings. Changing it moves them there.":"Πού κρατά αυτός ο υπολογιστής τα δεδομένα εκτός σύνδεσης και τις ρυθμίσεις της εφαρμογής. Αν τον αλλάξετε, μεταφέρονται εκεί.","Enter the full path of a folder, for example D:\\Cent-aur":"Βάλτε την πλήρη διαδρομή ενός φακέλου, για παράδειγμα D:\\Cent-aur","Cent-aur cannot save files in that folder.":"Το Cent-aur δεν μπορεί να αποθηκεύσει αρχεία σε αυτόν τον φάκελο.","Your data could not be moved there. Nothing was changed.":"Δεν ήταν δυνατή η μεταφορά των δεδομένων σας εκεί. Τίποτα δεν άλλαξε.","The server could not be reached. Check the address and your connection.": "Δεν ήταν δυνατή η σύνδεση με τον διακομιστή. Ελέγξτε τη διεύθυνση και τη σύνδεσή σας.", "That address answered, but it is not a Cent-aur server.": "Αυτή η διεύθυνση απάντησε, αλλά δεν είναι διακομιστής Cent-aur.", "Enter the server address, for example https://cent-aur.example.com": "Βάλτε τη διεύθυνση του διακομιστή, για παράδειγμα https://cent-aur.example.com", "This is not available while working offline.": "Αυτό δεν είναι διαθέσιμο όταν δουλεύετε εκτός σύνδεσης.", "Could not change the start-with-Windows setting.": "Δεν ήταν δυνατή η αλλαγή της εκκίνησης με τα Windows.", "Start with Windows": "Εκκίνηση με τα Windows", "Opens Cent-aur when you sign in to Windows.": "Ανοίγει το Cent-aur όταν συνδέεστε στα Windows.","Choose a password that is harder to guess.":"Επιλέξτε έναν κωδικό που μαντεύεται πιο δύσκολα.","Your data is too large to save.":"Τα δεδομένα σας είναι πολύ μεγάλα για να αποθηκευτούν.",
"Wrong user name or password.":"Λάθος όνομα χρήστη ή κωδικός.","Too many wrong tries. Wait 10 minutes and try again.":"Πάρα πολλές λάθος προσπάθειες. Περιμένετε 10 λεπτά και δοκιμάστε ξανά.","Please sign in.":"Παρακαλώ συνδεθείτε.","The current password is not right.":"Ο τρέχων κωδικός δεν είναι σωστός.","The password must be at least 8 characters.":"Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.","The password is too long.":"Ο κωδικός είναι πολύ μεγάλος.","That user name is already taken.":"Αυτό το όνομα χρήστη χρησιμοποιείται ήδη.","The user name must be 2-40 letters, numbers or . _ - @":"Το όνομα χρήστη πρέπει να έχει 2-40 γράμματα, αριθμούς ή . _ - @","There must always be one active administrator.":"Πρέπει να υπάρχει πάντα ένας ενεργός διαχειριστής.","You can't delete your own account while signed in.":"Δεν μπορείτε να διαγράψετε τον λογαριασμό σας ενώ είστε συνδεδεμένοι.","Only the administrator can do that.":"Μόνο ο διαχειριστής μπορεί να το κάνει αυτό.","No such user.":"Δεν υπάρχει τέτοιος χρήστης.","Enter your user name and password.":"Βάλτε όνομα χρήστη και κωδικό.","Something went wrong on the server.":"Κάτι πήγε στραβά στον διακομιστή.","Blocked: wrong origin.":"Αποκλείστηκε: λάθος προέλευση.",
"Reset layout":"Επαναφορά διάταξης","Simple":"Απλή","Full view":"Πλήρης προβολή","Edit":"Επεξεργασία","Done":"Τέλος","Help":"Βοήθεια","More":"Περισσότερα","Options":"Ρυθμίσεις","Settings":"Ρυθμίσεις","Profile":"Προφίλ","Close profile":"Κλείσιμο προφίλ","Language":"Γλώσσα",
"Switch between the full and the simplified view":"Εναλλαγή μεταξύ πλήρους και απλής προβολής","Edit layout":"Επεξεργασία διάταξης",
"Close options":"Κλείσιμο ρυθμίσεων","Close settings":"Κλείσιμο ρυθμίσεων","Close help":"Κλείσιμο βοήθειας","Close calculator":"Κλείσιμο αριθμομηχανής",
"Move up":"Μετακίνηση πάνω","Move down":"Μετακίνηση κάτω","Move left":"Μετακίνηση αριστερά","Move right":"Μετακίνηση δεξιά",
"Color theme":"Χρωματικό θέμα","Appearance":"Εμφάνιση","Automatic (system)":"Αυτόματο (σύστημα)","Light":"Φωτεινή","Dark":"Σκούρα","Custom":"Προσαρμοσμένο",
"Green":"Πράσινο","Graphite":"Γραφίτης","Ocean":"Ωκεανός","Rose":"Ροζ","Sunset":"Ηλιοβασίλεμα","Violet":"Βιολετί",
"I’m a freelancer (shows the Freelancer tab)":"Είμαι ελεύθερος επαγγελματίας (εμφανίζει την καρτέλα Ελεύθερος επαγγελματίας)",
"Welcome to Cent-aur":"Καλώς ήρθατε στο Cent-aur","Every cent counts.":"Κάθε λεπτό μετράει.","Cent-aur on GitHub":"Το Cent-aur στο GitHub","Know where your money goes.":"Μάθετε πού πηγαίνουν τα χρήματά σας.",
"Cent-aur logo":"Λογότυπο Cent-aur",
"Personal":"Προσωπικά","Freelancer":"Ελεύθερος επαγγελματίας",
"Newest first":"Πρώτα τα νεότερα","Oldest first":"Πρώτα τα παλαιότερα","Sort order":"Σειρά ταξινόμησης","OK":"Εντάξει","Enter an amount greater than 0.":"Εισαγάγετε ποσό μεγαλύτερο από 0.","Show full lists (no scrolling)":"Εμφάνιση πλήρων λιστών (χωρίς κύλιση)","Savings":"Αποταμιεύσεις","Insights":"Συμβουλές","Copy summary for AI":"Αντιγραφή σύνοψης για AI","Extra money":"Έκτακτα έσοδα","Totals":"Σύνολα","Budget":"Προϋπολογισμός","Add expense":"Προσθήκη εξόδου","Expenses":"Έξοδα","Bills history":"Ιστορικό λογαριασμών","By category":"Ανά κατηγορία","Your data":"Τα δεδομένα σας","Categories & bills":"Κατηγορίες & λογαριασμοί",
"Monthly income (salary)":"Μηνιαίο εισόδημα (μισθός)",
"Planned savings per month (salary − default budget)":"Προγραμματισμένες αποταμιεύσεις ανά μήνα (μισθός − προεπιλεγμένος προϋπολογισμός)",
"Extra money going to savings this year (extra salaries, one-offs)":"Έκτακτα έσοδα προς αποταμίευση φέτος (έξτρα μισθοί, εφάπαξ ποσά)",
"Planned savings per year (including extras)":"Προγραμματισμένες αποταμιεύσεις ανά έτος (με τα έκτακτα)",
"Real savings so far":"Πραγματικές αποταμιεύσεις μέχρι τώρα",
"Withdraw from savings":"Ανάληψη από αποταμιεύσεις","Amount":"Ποσό","Reason (e.g. car repair)":"Αιτία (π.χ. επισκευή αυτοκινήτου)","Withdraw":"Ανάληψη","Withdrawal":"Ανάληψη","Cancel":"Άκυρο","Date":"Ημερομηνία",
"One-off money (a sale, a gift, stocks…)":"Εφάπαξ έσοδα (πώληση, δώρο, μετοχές…)",
"What was it? (e.g. sold my bike)":"Τι ήταν; (π.χ. πούλησα το ποδήλατό μου)","Where does it go":"Πού πηγαίνει","To savings":"Στις αποταμιεύσεις","To budget":"Στον προϋπολογισμό",
"“To savings” adds it to your savings. “To budget” adds it to that month’s spending budget.":"Το «Στις αποταμιεύσεις» το προσθέτει στις αποταμιεύσεις σας. Το «Στον προϋπολογισμό» το προσθέτει στον προϋπολογισμό δαπανών του μήνα.",
"Add":"Προσθήκη","Save":"Αποθήκευση","Planned this year":"Προγραμματισμένα φέτος","Spent this month":"Έξοδα αυτού του μήνα",
"Monthly salary":"Μηνιαίος μισθός","Monthly budget":"Μηνιαίος προϋπολογισμός","Salary payments per year":"Μισθοί ανά έτος",
"Extra salaries — paid into savings in the month they arrive":"Έξτρα μισθοί — πηγαίνουν στις αποταμιεύσεις τον μήνα που εισπράττονται",
"Total yearly budget":"Συνολικός ετήσιος προϋπολογισμός","Budget per month":"Προϋπολογισμός ανά μήνα",
"Name (e.g. Rent, Mobile phone 2)":"Όνομα (π.χ. Ενοίκιο, Κινητό 2)","Date (due date for bills)":"Ημερομηνία (ημερομηνία λήξης για λογαριασμούς)","How often":"Πόσο συχνά",
"One-time":"Εφάπαξ","Daily":"Καθημερινά","Weekly":"Εβδομαδιαία","Every 2 weeks":"Ανά 2 εβδομάδες","Monthly":"Μηνιαία","Quarterly":"Ανά τρίμηνο","Yearly":"Ετήσια",
"Currency":"Νόμισμα","Clear all":"Διαγραφή όλων","Delete all":"Διαγραφή όλων","Manage":"Διαχείριση","+ New category":"+ Νέα κατηγορία","Edit / Add Categories":"Επεξεργασία / Προσθήκη κατηγοριών",
"Category name (e.g. Mobile phone 2)":"Όνομα κατηγορίας (π.χ. Κινητό 2)",
"Group (optional): categories with the same group are combined in By category":"Ομάδα (προαιρετικό): κατηγορίες με την ίδια ομάδα συγχωνεύονται στο «Ανά κατηγορία»",
"This is a bill (remind me when the next payment is due)":"Αυτός είναι λογαριασμός (υπενθύμιση όταν λήξει η επόμενη πληρωμή)",
"Due day of the month":"Ημέρα λήξης του μήνα","auto":"αυτόματα","Repeats every":"Επαναλαμβάνεται κάθε","month":"μήνα","year":"έτος","Save category":"Αποθήκευση κατηγορίας",
"Calculator":"Αριθμομηχανή","Close all":"Κλείσιμο όλων","Export backup":"Εξαγωγή αντιγράφου","Import backup":"Εισαγωγή αντιγράφου","Merge backup":"Συγχώνευση αντιγράφου","Update":"Ενημέρωση","Backup saved":"Το αντίγραφο αποθηκεύτηκε","View":"Προβολή","Choose which cards to show":"Επιλέξτε ποιες κάρτες θα εμφανίζονται","Choose what you want to see. Hidden cards are removed from the screen; your data is kept.":"Επιλέξτε τι θέλετε να βλέπετε. Οι κρυμμένες κάρτες αφαιρούνται από την οθόνη· τα δεδομένα σας διατηρούνται.","What if I cut back?":"Κι αν περικόψω;","Close view":"Κλείσιμο προβολής","Add anyway":"Προσθήκη ούτως ή άλλως","Spending by month":"Έξοδα ανά μήνα","Nothing new to merge":"Δεν υπάρχει κάτι νέο για συγχώνευση",
"All bills":"Όλοι οι λογαριασμοί",
"No bills yet. Add an expense in a bill category (Electricity, Κοινόχρηστα, Water…) and its history appears here.":"Δεν υπάρχουν λογαριασμοί ακόμη. Προσθέστε ένα έξοδο σε κατηγορία λογαριασμών (Ρεύμα, Κοινόχρηστα, Νερό…) και το ιστορικό του θα εμφανιστεί εδώ.",
"Previous months":"Προηγούμενοι μήνες","Upcoming months":"Επόμενοι μήνες","Previous withdrawals":"Προηγούμενες αναλήψεις","Upcoming withdrawals":"Μελλοντικές αναλήψεις","Previous savings money":"Προηγούμενα ποσά αποταμίευσης","Upcoming savings money":"Μελλοντικά ποσά αποταμίευσης",
"No expenses this month yet.":"Δεν υπάρχουν έξοδα αυτόν τον μήνα ακόμη.","No entries this month yet.":"Δεν υπάρχουν καταχωρήσεις αυτόν τον μήνα ακόμη.",
"No extra money added to this month’s budget.":"Δεν έχουν προστεθεί έκτακτα έσοδα στον προϋπολογισμό αυτού του μήνα.",
"Nothing to show yet.":"Δεν υπάρχει κάτι να εμφανιστεί ακόμη.","Show less":"Εμφάνιση λιγότερων",
"Set your monthly budget in Profile to see your budget status.":"Ορίστε τον μηνιαίο προϋπολογισμό σας στο Προφίλ για να δείτε την κατάστασή του.",
"Set your monthly salary in Profile to see how much you are saving.":"Ορίστε τον μηνιαίο μισθό σας στο Προφίλ για να δείτε πόσα αποταμιεύετε.",
"Your budgets are higher than your salary plus extra money, so planned savings are negative.":"Οι προϋπολογισμοί σας είναι υψηλότεροι από τον μισθό και τα έκτακτα έσοδα, οπότε οι προγραμματισμένες αποταμιεύσεις είναι αρνητικές.",
"Real savings = your salary plus any extra money (extra salaries, one-offs), minus what you actually spent, for each completed month. Whatever you don’t spend of your budget counts as saved.":"Πραγματικές αποταμιεύσεις = ο μισθός σας συν τυχόν έκτακτα έσοδα (έξτρα μισθοί, εφάπαξ ποσά), μείον όσα ξοδέψατε πραγματικά, για κάθε ολοκληρωμένο μήνα. Ό,τι δεν ξοδεύετε από τον προϋπολογισμό σας θεωρείται αποταμιευμένο.",
"Real savings start counting once the first month is completed.":"Οι πραγματικές αποταμιεύσεις μετρούν μόλις ολοκληρωθεί ο πρώτος μήνας.",
"Empty = your default monthly budget. Extra money added to a month’s budget is already included in the figure shown. Type a number to change only that month; clear the box to go back to the default.":"Κενό = ο προεπιλεγμένος μηνιαίος προϋπολογισμός σας. Τα έκτακτα έσοδα που προστίθενται στον προϋπολογισμό ενός μήνα περιλαμβάνονται ήδη στο ποσό που εμφανίζεται. Πληκτρολογήστε έναν αριθμό για να αλλάξετε μόνο αυτόν τον μήνα· διαγράψτε το πεδίο για να επιστρέψετε στην προεπιλογή.",
"14 salaries = Christmas full, Easter and Summer half each.":"14 μισθοί = Χριστούγεννα ολόκληρος, Πάσχα και Καλοκαίρι μισός ο καθένας.",
"14.5 salaries = 2 full + 1 half. Choose which payment is the half one; the other two are full.":"14,5 μισθοί = 2 ολόκληροι + 1 μισός. Επιλέξτε ποια πληρωμή είναι ο μισός· οι άλλες δύο είναι ολόκληρες.",
"Make this the half":"Κάνε αυτόν τον μισό","Full salary":"Ολόκληρος μισθός","Half salary":"Μισός μισθός",
"Christmas":"Χριστούγεννα","Easter":"Πάσχα","Summer":"Καλοκαίρι","Christmas month":"Μήνας Χριστουγέννων","Easter month":"Μήνας Πάσχα","Summer month":"Μήνας καλοκαιριού",
"Remind me later":"Υπενθύμιση αργότερα","Remind me again:":"Υπενθύμιση ξανά:","In 1 hour":"Σε 1 ώρα","Tomorrow morning":"Αύριο το πρωί","In 3 days":"Σε 3 ημέρες","In a week":"Σε μία εβδομάδα","Remind me at":"Υπενθύμιση στις","Set":"Ορισμός",
"Pick a date and time in the future.":"Επιλέξτε ημερομηνία και ώρα στο μέλλον.",
"taken from savings":"αφαιρέθηκε από τις αποταμιεύσεις","added to savings":"προστέθηκε στις αποταμιεύσεις","added to budget":"προστέθηκε στον προϋπολογισμό",
"Delete":"Διαγραφή","Edit category":"Επεξεργασία κατηγορίας","Delete category":"Διαγραφή κατηγορίας","Expense category":"Κατηγορία εξόδων","Category":"Κατηγορία","Status":"Κατάσταση",
"Give the category a name.":"Δώστε ένα όνομα στην κατηγορία.","A category with that name already exists.":"Υπάρχει ήδη κατηγορία με αυτό το όνομα.",
"Bills are one-time payments, so recurring expenses in this category will become one-time. Continue?":"Οι λογαριασμοί είναι εφάπαξ πληρωμές, επομένως τα επαναλαμβανόμενα έξοδα αυτής της κατηγορίας θα γίνουν εφάπαξ. Συνέχεια;",
"The Other category can’t be deleted.":"Η κατηγορία «Άλλο» δεν μπορεί να διαγραφεί.","Remove all expenses?":"Να αφαιρεθούν όλα τα έξοδα;",
"That file isn’t a Cent-aur backup.":"Αυτό το αρχείο δεν είναι αντίγραφο ασφαλείας του Cent-aur.",
"Saved":"Αποθηκεύτηκε",
"Housing":"Στέγαση","Mobile phone":"Κινητό τηλέφωνο","Electricity":"Ρεύμα","Water":"Νερό","Internet":"Διαδίκτυο","Food":"Φαγητό","Bank":"Τράπεζα","How it works":"Πώς λειτουργεί","Supermarket":"Σούπερ μάρκετ","Transport":"Μεταφορές","Bills":"Λογαριασμοί","Subscriptions":"Συνδρομές","Health":"Υγεία","Leisure":"Ψυχαγωγία","Other":"Άλλο","Utilities":"Υπηρεσίες κοινής ωφέλειας",
"Bill":"Λογαριασμός","due day of your last payment":"ημέρα λήξης: της τελευταίας πληρωμής","every month":"κάθε μήνα","using your entries":"με βάση τις καταχωρήσεις σας","Previous payment":"Προηγούμενη πληρωμή",
"/mo":"/μήν.","/yr":"/έτος",
"Freelance overview":"Επισκόπηση ελεύθερου επαγγελματία","Profit":"Κέρδος","Earned":"Έσοδα","Pending invoices":"Εκκρεμή τιμολόγια","Year":"Έτος",
"Set aside for tax (% of profit)":"Παρακράτηση για φόρο (% του κέρδους)","Tax to set aside this year":"Φόρος προς παρακράτηση φέτος",
"Freelancer earnings and expenses are kept separate: they never change your Personal totals, budget or savings.":"Τα έσοδα και τα έξοδα του ελεύθερου επαγγελματία τηρούνται χωριστά: δεν αλλάζουν ποτέ τα σύνολα, τον προϋπολογισμό ή τις αποταμιεύσεις σας στα Προσωπικά.",
"Add earning or expense":"Προσθήκη εσόδου ή εξόδου","Earning":"Έσοδο","Expense":"Έξοδο","Client or description":"Πελάτης ή περιγραφή",
"Already received (untick for a pending invoice)":"Έχει εισπραχθεί (ξετσεκάρετε για εκκρεμές τιμολόγιο)","Entries":"Καταχωρήσεις","pending":"εκκρεμεί","Received":"Εισπράχθηκε",
"Client work":"Εργασία για πελάτες","Retainer":"Πάγια αμοιβή","Product sales":"Πωλήσεις προϊόντων","Other income":"Άλλα έσοδα",
"Software & tools":"Λογισμικό & εργαλεία","Equipment":"Εξοπλισμός","Travel":"Ταξίδια","Marketing":"Μάρκετινγκ","Office & coworking":"Γραφείο & coworking","Taxes & fees":"Φόροι & τέλη","Other expense":"Άλλα έξοδα",
"tax calculator":"υπολογιστής φόρου",
"Estimate of income tax, ΕΦΚΑ contributions and the τέλος επιτηδεύματος.":"Εκτίμηση φόρου εισοδήματος, εισφορών ΕΦΚΑ και τέλους επιτηδεύματος.",
"Annual revenue":"Ετήσια έσοδα","Business expenses":"Επαγγελματικά έξοδα","from your entries":"από τις καταχωρήσεις σας","ΕΦΚΑ contribution per month":"Εισφορά ΕΦΚΑ ανά μήνα",
"Main pension + health, 1st category, 2026 (approximate)":"Κύρια σύνταξη + υγεία, 1η κατηγορία, 2026 (κατά προσέγγιση)","1st cat. 250.77":"1η κατ. 250,77",
"Age group (tax year 2026 and later)":"Ηλικιακή ομάδα (φορολογικό έτος 2026 και μετά)","31 and over":"31 και άνω","Up to 25":"Έως 25",
"Freelancer – exempt":"Ελεύθερος επαγγελματίας – απαλλαγή","Business – 800-1,000":"Επιχείρηση – 800-1.000",
"First year of activity (no tax prepayment)":"Πρώτο έτος δραστηριότητας (χωρίς προκαταβολή φόρου)","Result":"Αποτέλεσμα","Revenue":"Έσοδα",
"− Business expenses":"− Επαγγελματικά έξοδα","− ΕΦΚΑ (12 months)":"− ΕΦΚΑ (12 μήνες)","= Taxable income":"= Φορολογητέο εισόδημα",
"Income tax by bracket":"Φόρος εισοδήματος ανά κλιμάκιο","Income tax":"Φόρος εισοδήματος","Net after tax, ΕΦΚΑ and fee":"Καθαρά μετά από φόρο, ΕΦΚΑ και τέλος",
"Effective tax rate":"Πραγματικός φορολογικός συντελεστής","Tax prepayment next year (55%)":"Προκαταβολή φόρου επόμενου έτους (55%)","none in the first year":"καμία το πρώτο έτος",
"Suggested set-aside (tax + fee) of profit":"Προτεινόμενη παρακράτηση (φόρος + τέλος) από το κέρδος","Use as my tax set-aside %":"Χρήση ως το ποσοστό παρακράτησης φόρου",
"Estimate only, not tax advice. It uses the scale for the year selected above (2026 scale from tax year 2026, otherwise the 2025 scale), no tax credit for freelancers, and ΕΦΚΑ deducted from taxable income. It does not include child reductions, minimum presumed income, VAT or other fees. The τέλος επιτηδεύματος is reported as abolished for freelancers from 2025, 400-500 € for μπλοκάκι and 800-1,000 € for businesses in 2026 (planned abolition 2027) — check with your accountant or AADE.":"Μόνο εκτίμηση, όχι φορολογική συμβουλή. Χρησιμοποιεί την κλίμακα του έτους που έχει επιλεγεί παραπάνω (κλίμακα 2026 από το φορολογικό έτος 2026, αλλιώς κλίμακα 2025), χωρίς φορολογική έκπτωση για ελεύθερους επαγγελματίες και με αφαίρεση των εισφορών ΕΦΚΑ από το φορολογητέο εισόδημα. Δεν περιλαμβάνει μειώσεις για τέκνα, τεκμαρτό εισόδημα, ΦΠΑ ή άλλα τέλη. Το τέλος επιτηδεύματος αναφέρεται ως καταργημένο για ελεύθερους επαγγελματίες από το 2025, 400-500 € για μπλοκάκι και 800-1.000 € για επιχειρήσεις το 2026 (προγραμματισμένη κατάργηση το 2027) — ελέγξτε με τον λογιστή σας ή την ΑΑΔΕ.",
"The date decides which month an expense belongs to. Bills (mobile phone, electricity, water, internet, Κοινόχρηστα and any category you mark as a bill) are one-time payments: add one each time you pay. A bill is reminded only after its first payment is added: if the next one is not paid one month after the last payment date, Cent-aur reminds you.":"Η ημερομηνία καθορίζει σε ποιον μήνα ανήκει ένα έξοδο. Οι λογαριασμοί (κινητό, ρεύμα, νερό, διαδίκτυο, Κοινόχρηστα και κάθε κατηγορία που ορίζετε ως λογαριασμό) είναι εφάπαξ πληρωμές: προσθέστε μία κάθε φορά που πληρώνετε. Ένας λογαριασμός υπενθυμίζεται μόνο αφού προστεθεί η πρώτη του πληρωμή: αν η επόμενη δεν πληρωθεί έναν μήνα μετά την ημερομηνία της τελευταίας πληρωμής, το Cent-aur σας το υπενθυμίζει.",
"Track what you spend, see what is left of your budget, and never miss a bill. Quick start:":"Καταγράψτε τα έξοδά σας, δείτε τι απομένει από τον προϋπολογισμό σας και μην ξεχνάτε ποτέ έναν λογαριασμό. Γρήγορη εκκίνηση:",
"airplane":"αεροπλάνο","bank":"τράπεζα","bolt":"κεραυνός","book":"βιβλίο","building":"κτίριο","car":"αυτοκίνητο","cart":"καλάθι","cup":"φλιτζάνι","drop":"σταγόνα","dumbbell":"αλτήρας","flame":"φλόγα","fork":"πιρούνι","fuel":"καύσιμα","gift":"δώρο","grid":"πλέγμα","heart":"καρδιά","house":"σπίτι","paw":"πατούσα","percent":"ποσοστό","phone":"τηλέφωνο","pill":"χάπι","plane":"αεροπλάνο","receipt":"απόδειξη","screen":"οθόνη","shield":"ασπίδα","ship":"πλοίο","shirt":"πουκάμισο","spark":"σπίθα","wifi":"wifi","wrench":"κλειδί",
"Add client":"Προσθήκη πελάτη","Add goal":"Προσθήκη στόχου","Amount is after VAT":"Το ποσό είναι μετά το ΦΠΑ","Amount is before VAT":"Το ποσό είναι πριν το ΦΠΑ",
"Clients":"Πελάτες","Copy as text":"Αντιγραφή ως κείμενο","Download CSV":"Λήψη CSV","Ends after (optional)":"Λήγει μετά (προαιρετικά)",
"Goals track money you have set aside for something. They do not change the savings figures above.":"Οι στόχοι καταγράφουν χρήματα που έχετε βάλει στην άκρη για κάτι. Δεν αλλάζουν τα ποσά αποταμίευσης παραπάνω.",
"I charge VAT on my invoices":"Χρεώνω ΦΠΑ στα τιμολόγιά μου","Monthly report":"Μηνιαία αναφορά","No VAT (0%)":"Χωρίς ΦΠΑ (0%)",
"Pause an expense that repeats while you are not paying it, or end it for good. Past months stay exactly as they were.":"Θέστε σε παύση ένα έξοδο που επαναλαμβάνεται όσο δεν το πληρώνετε ή λήξτε το οριστικά. Οι προηγούμενοι μήνες μένουν ακριβώς όπως ήταν.",
"Print / save as PDF":"Εκτύπωση / αποθήκευση ως PDF","Reach it by (optional)":"Να τον πετύχω έως (προαιρετικά)","Recurring expenses":"Επαναλαμβανόμενα έξοδα","Savings goals":"Στόχοι αποταμίευσης",
"The VAT on this expense is deductible":"Το ΦΠΑ αυτού του εξόδου είναι εκπεστέο","VAT (ΦΠΑ)":"ΦΠΑ",
"Client":"Πελάτης","Client (optional)":"Πελάτης (προαιρετικά)","Client name":"Όνομα πελάτη","Description (optional)":"Περιγραφή (προαιρετικά)","Goal (e.g. Holiday)":"Στόχος (π.χ. Διακοπές)","Goal name":"Όνομα στόχου",
"Is the amount before or after VAT?":"Το ποσό είναι πριν ή μετά το ΦΠΑ;","Last month it counts":"Τελευταίος μήνας που μετράει","Month":"Μήνας","Pause":"Παύση","Saved so far":"Έχω αποταμιεύσει ήδη",
"Search expenses":"Αναζήτηση εξόδων","Search name, category or #tag":"Αναζήτηση ονόματος, κατηγορίας ή #ετικέτας","Tags":"Ετικέτες","Tags (e.g. work, holiday)":"Ετικέτες (π.χ. δουλειά, διακοπές)",
"Target amount":"Ποσό-στόχος","Target month":"Μήνας-στόχος","VAT rate":"Συντελεστής ΦΠΑ",
"The end month can’t be before the start date.":"Ο μήνας λήξης δεν μπορεί να είναι πριν από την ημερομηνία έναρξης."
};
MONRE.split("|").forEach(function(m,i){DICT[m]=EL_M[i]});
var FREQ={"one-time":"εφάπαξ","daily":"καθημερινά","weekly":"εβδομαδιαίως","every 2 weeks":"ανά 2 εβδομάδες","monthly":"μηνιαίως","quarterly":"ανά τρίμηνο","yearly":"ετησίως"};
function trCat(n){return Object.prototype.hasOwnProperty.call(DICT,n)?DICT[n]:n}
function trDiff(s){return s==="same amount"?"ίδιο ποσό":s}
var RULES=[];
function R(re,fn){RULES.push([new RegExp(re),fn])}
R("^(\\d+(?:\\.\\d+)?)% of the monthly budget used$",function(m){return "Χρησιμοποιήθηκε το "+m[1]+"% του μηνιαίου προϋπολογισμού"});
R("^(\\d+(?:\\.\\d+)?)% of the yearly budget planned \\((\\d{4})\\)$",function(m){return "Προγραμματίστηκε το "+m[1]+"% του ετήσιου προϋπολογισμού ("+m[2]+")"});
R("^"+A+" left$",function(m){return m[1]+" απομένουν"});
R("^"+A+" over budget$",function(m){return m[1]+" πάνω από τον προϋπολογισμό"});
R("^"+A+" over$",function(m){return m[1]+" πάνω"});
R("^Spent in ("+MONRE+")$",function(m){return "Έξοδα "+mGen(m[1])});
R("^Planned for (\\d{4})$",function(m){return "Προγραμματισμένα για το "+m[1]});
R("^Total yearly salary \\(salary × ([\\d.]+)\\)$",function(m){return "Συνολικός ετήσιος μισθός (μισθός × "+m[1]+")"});
R("^Total yearly budget \\((\\d{4})\\)$",function(m){return "Συνολικός ετήσιος προϋπολογισμός ("+m[1]+")"});
R("^By category \\((\\d{4})\\)$",function(m){return "Ανά κατηγορία ("+m[1]+")"});
R("^This month \\(("+MONRE+")\\)$",function(m){return "Αυτός ο μήνας ("+mNom(m[1])+")"});
R("^Saving this month: "+A+" \\(planned "+A+"\\)$",function(m){return "Αποταμίευση του μήνα: "+m[1]+" (προγραμματισμένη "+m[2]+")"});
R("^saved "+A+"$",function(m){return "αποταμιεύθηκαν "+m[1]});
R("^"+A+" extra$",function(m){return m[1]+" έκτακτα"});
R("^"+A+" from extra money$",function(m){return m[1]+" από έκτακτα έσοδα"});
R("^"+A+" to savings$",function(m){return m[1]+" στις αποταμιεύσεις"});
R("^incl\\. "+A+" extra money$",function(m){return "συμπ. "+m[1]+" έκτακτα έσοδα"});
R("^"+A+" less than planned$",function(m){return m[1]+" λιγότερα από το προγραμματισμένο"});
R("^"+A+" more than planned$",function(m){return m[1]+" περισσότερα από το προγραμματισμένο"});
R("^"+A+" (one-time|daily|weekly|every 2 weeks|monthly|quarterly|yearly)$",function(m){return m[1]+" "+FREQ[m[2]]});
R("^from (\\d\\d/\\d\\d)$",function(m){return "από "+m[1]});
R("^overdue by (\\d+) days?$",function(m){return "καθυστέρηση "+m[1]+" "+plu(m[1],"ημέρα","ημέρες")});
R("^due in (\\d+) days?$",function(m){return "λήγει σε "+m[1]+" "+plu(m[1],"ημέρα","ημέρες")});
R("^due today$",function(){return "λήγει σήμερα"});
R("^last bill "+A+"$",function(m){return "τελευταίος λογαριασμός "+m[1]});
R("^due day (\\d+)$",function(m){return "ημέρα λήξης "+m[1]});
R("^every (\\d+) months$",function(m){return "κάθε "+m[1]+" μήνες"});
R("^Group: (.+)$",function(m){return "Ομάδα: "+trCat(m[1])});
R("^(\\d+) (?:entry|entries)$",function(m){return m[1]+" "+plu(m[1],"καταχώρηση","καταχωρήσεις")});
R("^(\\d+) (?:month|months)$",function(m){return m[1]+" "+plu(m[1],"μήνας","μήνες")});
R("^(\\d+) (?:payment|payments)$",function(m){return m[1]+" "+plu(m[1],"πληρωμή","πληρωμές")});
R("^total "+A+"$",function(m){return "σύνολο "+m[1]});
R("^Last "+A+"$",function(m){return "Τελευταίος "+m[1]});
R("^average "+A+"$",function(m){return "μέσος όρος "+m[1]});
R("^highest "+A+"$",function(m){return "υψηλότερος "+m[1]});
R("^lowest "+A+"$",function(m){return "χαμηλότερος "+m[1]});
R("^"+A+" profit$",function(m){return m[1]+" κέρδος"});
R("^Real savings in (\\d{4})(?: \\((\\d+) completed months?\\))?$",function(m){return "Πραγματικές αποταμιεύσεις το "+m[1]+(m[2]?" ("+m[2]+" "+plu(m[2],"ολοκληρωμένος μήνας","ολοκληρωμένοι μήνες")+")":"")});
R("^Pending invoices in (\\d{4}) \\(not yet received\\)$",function(m){return "Εκκρεμή τιμολόγια το "+m[1]+" (δεν έχουν εισπραχθεί)"});
R("^Profit in ("+MONRE+")$",function(m){return "Κέρδος "+mGen(m[1])});
R("^Profit in (\\d{4})$",function(m){return "Κέρδος το "+m[1]});
R("^Totals for (\\d{4})$",function(m){return "Σύνολα για το "+m[1]});
R("^Months of (\\d{4})$",function(m){return "Μήνες του "+m[1]});
R("^(Withdrawals|Savings money) of (\\d{4})$",function(m){return (m[1]==="Withdrawals"?"Αναλήψεις":"Ποσά αποταμίευσης")+" του "+m[2]});
R("^Estimate for (\\d{4})$",function(m){return "Εκτίμηση για το "+m[1]});
R("^(\\d{4}) tax scale \\((.+)\\)$",function(m){return "Κλίμακα φόρου "+m[1]+" ("+m[2]+")"});
R("^Budget for ("+MONRE+") (\\d{4})$",function(m){return "Προϋπολογισμός "+mGen(m[1])+" "+m[2]});
R("^("+MONRE+") (\\d{4})$",function(m){return mNom(m[1])+" "+m[2]});
R("^Nothing recorded for (\\d{4})\\.$",function(m){return "Δεν έχει καταγραφεί τίποτα για το "+m[1]+"."});
R("^Previous (.+) bill: "+A+" \\((\\d\\d/\\d\\d)\\)$",function(m){return "Προηγούμενος λογαριασμός "+trCat(m[1])+": "+m[2]+" ("+m[3]+")"});
R("^this one: (.+)$",function(m){return "αυτός: "+trDiff(m[1])});
R("^(.+?) vs ("+MONRE+") \\("+A+"\\)$",function(m){return trDiff(m[1])+" σε σχέση με τον "+mAcc(m[2])+" ("+m[3]+")"});
R("^(Full|Half) salary \\((.+)\\)$",function(m){return (m[1]==="Full"?"Ολόκληρος μισθός":"Μισός μισθός")+" ("+m[2]+")"});
R("^same amount$",function(){return "ίδιο ποσό"});
R("^Show more \\((\\d+) more\\)$",function(m){return "Εμφάνιση περισσότερων ("+m[1]+" ακόμη)"});
R("^First "+A+" × (\\d+)%$",function(m){return "Πρώτα "+m[1]+" × "+m[2]+"%"});
R("^"+A+" of "+A+"(?: \\(custom\\))?$",function(m){return m[1]+" από "+m[2]+(/\(custom\)$/.test(m[0])?" (προσαρμοσμένο)":"")});
R("^(.+) theme$",function(m){return "Θέμα "+trCat(m[1])});
R("^Merged (\\d+) expenses?, (\\d+) other (?:entry|entries)$",function(m){return "Συγχωνεύτηκαν "+m[1]+" "+plu(m[1],"έξοδο","έξοδα")+" και "+m[2]+" "+plu(m[2],"άλλη εγγραφή","άλλες εγγραφές")});
R("^This looks like a duplicate of “(.*)” \\((.*), (.*)\\)\\. Add it anyway\\?$",function(m){return "Μοιάζει με διπλότυπο του «"+m[1]+"» ("+m[2]+", "+m[3]+"). Να προστεθεί παρ’ όλα αυτά;"});
R("^Imported (\\d+) expenses$",function(m){return "Εισήχθησαν "+m[1]+" "+plu(m[1],"έξοδο","έξοδα")});
R("^Delete \"(.+)\"\\?$",function(m){return "Να διαγραφεί το «"+trCat(m[1])+"»;"});
R("^Delete this entry\\?$",function(){return "Να διαγραφεί αυτή η καταχώρηση;"});
R("^Delete \"(.+)\"\\? It will be removed from all months\\.$",function(m){return "Διαγραφή του «"+trCat(m[1])+"»; Θα αφαιρεθεί από όλους τους μήνες."});
R("^Delete the category \"(.+)\"\\?(?: Its (\\d+) expenses? will move to Other\\.)?$",function(m){return "Διαγραφή της κατηγορίας «"+trCat(m[1])+"»;"+(m[2]?" "+plu(m[2],"Το έξοδό της θα μεταφερθεί","Τα "+m[2]+" έξοδά της θα μεταφερθούν")+" στην κατηγορία «Άλλο».":"")});
R("^VAT (\\d+(?:\\.\\d+)?)%$",function(m){return "ΦΠΑ "+m[1].replace(".",",")+"%"});
R("^(.+) "+A+"$",function(m){return Object.prototype.hasOwnProperty.call(DICT,m[1])?DICT[m[1]]+" "+m[2]:null});
function numfix(s){return s.replace(/(\d)\.(\d{1,2})(?!\d)/g,"$1,$2")}
function trSeg(s){
  if(Object.prototype.hasOwnProperty.call(DICT,s))return DICT[s];
  for(var i=0;i<RULES.length;i++){var m=RULES[i][0].exec(s);if(m){var r=RULES[i][1](m);if(r!=null)return r}}
  return s}
function trLine(core){
  var key=core.replace(/\s+/g," ");
  if(Object.prototype.hasOwnProperty.call(DICT,key))return DICT[key];
  var p=key.split(/(\s*·\s*)/);
  for(var i=0;i<p.length;i+=2)p[i]=numfix(trSeg(p[i]));
  return p.join("")}
var EN_EX={"Φόρος επιτηδεύματος · tax calculator":"Freelancer tax calculator"};
var EN_T=[[/Φόρος επιτηδεύματος/g,"Freelancer tax"],[/Τέλος επιτηδεύματος/g,"Professional activity fee"],[/τέλος επιτηδεύματος/g,"professional activity fee"],[/ΕΦΚΑ/g,"EFKA"],[/Μπλοκάκι/g,"Receipt block"],[/μπλοκάκι/g,"receipt block"],[/Κοινόχρηστα/g,"Common charges"],[/ΑΑΔΕ/g,"AADE"]];
function trEn(s){if(!/[Α-ώ]/.test(s))return s;var m=/^(\s*)([\s\S]*?)(\s*)$/.exec(s);if(!m[2])return s;var c=m[2].replace(/\s+/g," ");if(EN_EX[c])return m[1]+EN_EX[c]+m[3];EN_T.forEach(function(t){c=c.replace(t[0],t[1])});return m[1]+c+m[3]}
function trAny(s){return LANG==="el"?trText(s):trEn(s)}
function trText(s){var m=/^(\s*)([\s\S]*?)(\s*)$/.exec(s);return m[2]?m[1]+trLine(m[2])+m[3]:s}
function T(s){return LANG==="el"?trText(String(s)):s}
var dlgYes=null;
function ask(msg,yes,o){o=o||{};var d=$("dlg");d.hidden=false;$("dlgm").textContent=T(msg);dlgYes=yes||null;
  $("dlgy").textContent=o.ok||"OK";$("dlgc").hidden=!!o.info;if(!o.info)$("dlgc").textContent="Cancel";
  // o.danger: the button deletes something; it turns red and Cancel takes the focus, so Enter never deletes by accident
  $("dlgy").classList.toggle("danger",!!o.danger);$("dlgy").classList.toggle("primary",!o.danger);
  var f=o.danger&&!o.info?$("dlgc"):$("dlgy");if(typeof f.focus==="function")f.focus()}
function closeDlg(run){var d=$("dlg"),y=dlgYes;d.hidden=true;dlgYes=null;if(run&&y)y()}
$("dlgy").addEventListener("click",function(){closeDlg(true)});$("dlgc").addEventListener("click",function(){closeDlg(false)});
$("dlg").addEventListener("click",function(e){if(e.target===this)closeDlg(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("dlg").hidden)closeDlg(false)});
function alert(m){ask(m,null,{info:true})}
/* ---- account: sign in, your data on the server, administrator ---- */
// Everything lives on the server. The page loads it after sign-in and saves it back after every change.
// DESK: set when the page runs in the Windows app ({mode:"online"|"offline"|"", server, autostart}), else null
var DESK=null;
var ACC={user:null,rev:0,loaded:false,dirty:false,saving:false,again:false,last:0,err:"",tries:0,timer:null};
function api(path,o){o=o||{};var h={"X-Requested-With":"CentAur"};if(o.body)h["Content-Type"]="application/json";
  return apiRes(fetch(path,{method:o.method||"GET",headers:h,body:o.body,cache:"no-store",credentials:"same-origin"}))}
// reads a fetch's answer the same way for every request (also the one the page starts in its <head>)
function apiRes(req){return req.then(function(r){
    return r.json().catch(function(){return {}}).then(function(j){if(!r.ok){var e=new Error(j&&j.error||("HTTP "+r.status));e.status=r.status;e.data=j;throw e}return j})})}
function accTime(ts){return new Date(ts).toLocaleTimeString(LANG==="el"?"el-GR":"en-GB",{hour:"2-digit",minute:"2-digit"})}
function accStatus(){if(ACC.err)return ACC.err;if(ACC.saving||ACC.dirty)return X("Saving…","Αποθήκευση…");return ACC.last?X("Saved at ","Αποθηκεύτηκε στις ")+accTime(ACC.last):""}
// ---- the account block in "Your data", and the bar shown while the server cannot be reached
function deskOffline(){return !!(DESK&&DESK.mode==="offline")}
function accUI(){var w=$("acw");if(!w)return;var u=ACC.user;w.hidden=!u;
  var v=$("appver");v.hidden=!(u&&u.version);v.textContent=u&&u.version?"v"+u.version:"";if(!u)return;
  $("act").textContent=deskOffline()?X("This PC","Αυτός ο υπολογιστής"):X("Account","Λογαριασμός");
  if(deskOffline()){$("acb").innerHTML='<button type="button" class="primary" data-ac="leave">'+esc(X("Sign in to a server","Σύνδεση σε διακομιστή"))+'</button>';accStatusUI();return}
  $("acb").innerHTML='<button type="button" data-ac="pw">'+esc(X("Change password","Αλλαγή κωδικού"))+'</button><button type="button" data-ac="out">'+esc(X("Sign out","Αποσύνδεση"))+'</button>'+
    (u.role==="admin"?'<button type="button" class="primary" data-ac="usrm">'+esc(X("Manage users","Διαχείριση χρηστών"))+'</button>':'');
  accStatusUI()}
function accStatusUI(){var u=ACC.user;if(u)$("ach").innerHTML=(deskOffline()?esc(X("Working offline: your data is kept on this PC only.","Εργασία εκτός σύνδεσης: τα δεδομένα σας φυλάσσονται μόνο σε αυτόν τον υπολογιστή.")):
    '<span class="who">'+esc(u.username)+'</span>'+(u.role==="admin"?' <span class="bdg a">'+esc(X("administrator","διαχειριστής"))+'</span>':'')+(DESK&&DESK.server?' · '+esc(DESK.server.replace(/^https?:\/\//,"")):''))+'<br><span class="'+(ACC.err?"off":"ok")+'">'+esc(accStatus())+'</span>';
  $("netbart").textContent=ACC.err;$("netbar").hidden=!ACC.err}
// ---- one small form window for everything (sign in, change password, add user ...)
var FM=null;
function fmClose(){$("fmm").hidden=true;$("fmm").classList.remove("lock","boot");FM=null}
function fmOpen(o){FM=o;$("fmt").textContent=o.title;$("fmi").textContent=o.intro||"";$("fmi").hidden=!o.intro;$("fme").hidden=true;
  $("fmb").innerHTML=o.fields.map(function(f){if(f.type==="checkbox")return '<label class="oc"><input id="fm_'+f.id+'" type="checkbox"'+(f.value?' checked':'')+'> '+esc(f.label)+'</label>';
    return '<label>'+esc(f.label)+'<input id="fm_'+f.id+'" type="'+(f.type||"text")+'" value="'+esc(f.value||"")+'"'+(f.ph?' placeholder="'+esc(f.ph)+'"':'')+(f.auto?' autocomplete="'+f.auto+'"':' autocomplete="off"')+(f.name?' name="'+f.name+'"':'')+' maxlength="200" required></label>'}).join("");
  $("fma").innerHTML=(o.lock?'':'<button type="button" class="ghost" id="fmc">'+esc(X("Cancel","Άκυρο"))+'</button>')+(o.alt?'<button type="button" id="fma2">'+esc(o.alt.text)+'</button>':'')+'<button type="submit" class="primary" id="fmo">'+esc(o.ok)+'</button>';
  $("fmm").classList.toggle("lock",!!o.lock);$("fmm").classList.remove("boot");$("fmm").hidden=false;
  var c=$("fmc");if(c)c.addEventListener("click",function(){var f=FM;fmClose();if(f&&f.onCancel)f.onCancel()});
  var a2=$("fma2");if(a2)a2.addEventListener("click",function(){var f=FM;fmClose();f.alt.fn()});
  var first=$("fmb").querySelector("input");if(first)first.focus();else $("fmo").focus()}
function fmErr(m){var e=$("fme");e.textContent=T(m);e.hidden=false}
$("fmf").addEventListener("submit",function(e){e.preventDefault();if(!FM)return;var o=FM,v={};o.fields.forEach(function(f){var el=$("fm_"+f.id);v[f.id]=f.type==="checkbox"?el.checked:el.value});
  var b=$("fmo");b.disabled=true;$("fme").hidden=true;
  Promise.resolve().then(function(){return o.onOk(v)}).then(function(){if(FM===o)fmClose()},function(er){fmErr(er&&er.message||X("Something went wrong.","Κάτι πήγε στραβά."))}).then(function(){b.disabled=false})});
$("fmm").addEventListener("click",function(e){if(e.target===this&&FM&&!FM.lock){var f=FM;fmClose();if(f.onCancel)f.onCancel()}});
// ---- sign in, and the forced new password after signing in with the default one
function accLogin(msg){var f=[{id:"u",label:X("User name","Όνομα χρήστη"),auto:"username",name:"username"},{id:"p",label:X("Password","Κωδικός"),type:"password",auto:"current-password",name:"password"}];
  if(DESK){f.unshift({id:"srv",label:X("Server address","Διεύθυνση διακομιστή"),ph:"https://cent-aur.example.com",value:DESK.server||"",auto:"url",name:"server"});
    f.push({id:"rem",type:"checkbox",label:X("Remember me","Να με θυμάσαι"),value:DESK.remember!==false})}   // off: signed out when the app closes
  fmOpen({title:X("Sign in","Σύνδεση"),fields:f,ok:X("Sign in","Σύνδεση"),lock:true,alt:DESK?{text:X("Back","Πίσω"),fn:function(){accChoose()}}:null,
    onOk:function(v){var b={username:v.u.trim(),password:v.p};if(DESK){b.server=v.srv.trim();b.remember=v.rem}
      return api("/api/login",{method:"POST",body:JSON.stringify(b)}).then(function(j){if(j.desktop){DESK=j.desktop;deskUI()}accStart(j.user)},function(e){
      if(e.status===undefined)throw new Error(X("The server could not be reached. Check your connection.","Δεν ήταν δυνατή η σύνδεση με τον διακομιστή. Ελέγξτε τη σύνδεσή σας."));throw e})}});
  if(msg)fmErr(msg)}
// the desktop app's first screen: an account on a server, or no account and the data on this PC
function accChoose(msg){
  fmOpen({title:X("Welcome to Cent-aur","Καλώς ήρθατε στο Cent-aur"),intro:X("Sign in to use your account on your Cent-aur server, or work offline: no account needed, and your data stays on this PC.","Συνδεθείτε για να χρησιμοποιήσετε τον λογαριασμό σας στον διακομιστή Cent-aur ή δουλέψτε εκτός σύνδεσης: χωρίς λογαριασμό, με τα δεδομένα σας μόνο σε αυτόν τον υπολογιστή."),
    fields:[],ok:X("Sign in","Σύνδεση"),lock:true,alt:{text:X("Work offline on this PC","Εργασία εκτός σύνδεσης σε αυτόν τον υπολογιστή"),fn:accOffline},onOk:function(){accLogin()}});
  if(msg)fmErr(msg)}
function accOffline(){$("fmm").classList.add("boot");$("fmm").hidden=false;   // the starting cover, until the data is on screen
  api("/api/offline",{method:"POST",body:"{}"}).then(function(j){DESK=j.desktop;deskUI();accStart(j.user)},function(e){accChoose(T(e.message))})}
// leave offline (or the server) for the first screen; data kept on this PC stays there
function accLeave(){
  if(st||ACC.dirty||ACC.saving){alert(X("Your latest changes are still being saved. Try again in a moment.","Οι τελευταίες αλλαγές σας αποθηκεύονται ακόμη. Δοκιμάστε ξανά σε λίγο."));return}
  ask(X("Sign in to a server instead? The data on this PC stays here for when you work offline again.","Σύνδεση σε διακομιστή; Τα δεδομένα αυτού του υπολογιστή μένουν εδώ για όταν δουλέψετε ξανά εκτός σύνδεσης."),
    function(){api("/api/logout",{method:"POST",body:"{}"}).catch(function(){}).then(function(){location.reload()})},{ok:X("Continue","Συνέχεια")})}
// Start with Windows: only in the desktop app
function deskUI(){$("autow").hidden=!DESK;if(DESK){$("autos").checked=!!DESK.autostart;$("ddp").textContent=DESK.folder||"";$("ddr").hidden=!!DESK.standard}}
// Options > Data folder: the desktop app moves its settings and offline data to another folder (and back)
function deskFolder(folder,useExisting){
  if(st||ACC.dirty||ACC.saving){alert(X("Your latest changes are still being saved. Try again in a moment.","Οι τελευταίες αλλαγές σας αποθηκεύονται ακόμη. Δοκιμάστε ξανά σε λίγο."));return}
  api("/api/desktop/folder",{method:"POST",body:JSON.stringify({folder:folder,use_existing:!!useExisting})}).then(function(){location.reload()},function(e){
    if(e.data&&e.data.exists&&!useExisting)ask(X("That folder already has Cent-aur data. Use the data in it? The data in the current folder stays where it is.","Αυτός ο φάκελος έχει ήδη δεδομένα Cent-aur. Να χρησιμοποιηθούν αυτά; Τα δεδομένα του τρέχοντος φακέλου μένουν όπου είναι."),
      function(){deskFolder(folder,true)},{ok:X("Use that data","Χρήση αυτών των δεδομένων")});
    else alert(T(e.message))})}
$("ddc").addEventListener("click",function(){
  if(DESK&&DESK.picker){api("/api/desktop/folder/pick",{method:"POST",body:JSON.stringify({title:X("Choose the folder for Cent-aur's data","Επιλέξτε τον φάκελο για τα δεδομένα του Cent-aur")})})
    .then(function(j){if(j.folder)deskFolder(j.folder)},function(e){alert(T(e.message))});return}
  fmOpen({title:X("Data folder","Φάκελος δεδομένων"),intro:X("Your offline data and the app's settings move to this folder.","Τα δεδομένα εκτός σύνδεσης και οι ρυθμίσεις της εφαρμογής μεταφέρονται σε αυτόν τον φάκελο."),
    fields:[{id:"d",label:X("Folder","Φάκελος"),value:DESK?DESK.folder:""}],ok:X("Move here","Μεταφορά εδώ"),onOk:function(v){setTimeout(function(){deskFolder(v.d.trim())},0)}})});
$("ddr").addEventListener("click",function(){ask(X("Move your data back to the standard folder?","Μεταφορά των δεδομένων σας πίσω στον βασικό φάκελο;"),function(){deskFolder("")},{ok:X("Move","Μεταφορά")})});
$("autos").addEventListener("change",function(){var box=this,want=box.checked;
  api("/api/desktop/autostart",{method:"POST",body:JSON.stringify({on:want})}).then(function(j){box.checked=!!j.on;if(DESK)DESK.autostart=!!j.on},function(e){box.checked=!want;alert(T(e.message))})});
// pre: the data, when it already came with the session (see accBoot)
function accStart(u,pre){ACC.user=u;$("pfov").hidden=true;accUI();if(u.must_change)accNewPw();else accLoad(pre)}
function accNewPw(){
  fmOpen({title:X("Choose your password","Επιλέξτε τον κωδικό σας"),intro:X("You signed in with the default password. Choose your own password to continue.","Συνδεθήκατε με τον προεπιλεγμένο κωδικό. Επιλέξτε δικό σας κωδικό για να συνεχίσετε."),
    fields:[{id:"n",label:X("New password (at least 8 characters)","Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)"),type:"password",auto:"new-password"},{id:"n2",label:X("New password again","Νέος κωδικός ξανά"),type:"password",auto:"new-password"}],
    ok:X("Save password","Αποθήκευση κωδικού"),lock:true,
    onOk:function(v){if(v.n!==v.n2)throw new Error(X("The two passwords are not the same.","Οι δύο κωδικοί δεν ταιριάζουν."));
      return api("/api/password",{method:"POST",body:JSON.stringify({"new":v.n})}).then(function(){ACC.user.must_change=false;accLoad()})}})}
// ---- the data: loaded after sign-in, saved after every change, refreshed when another device changed it
function accLoad(pre){ACC.loaded=false;
  return (pre?Promise.resolve(pre):api("/api/data")).then(function(j){ACC.rev=j.rev;ACC.loaded=true;ACC.err="";ACC.tries=0;
    if(j.data&&applyData(j.data))say(X("Loaded your data.","Τα δεδομένα σας φορτώθηκαν."));
    else applyData(JSON.parse(STATE0));
    if($("fmm").classList.contains("boot"))fmClose();
    accStatusUI()}).catch(accFail)}
function dataSave(){if(!ACC.loaded)return;ACC.dirty=true;accStatusUI();accFlush()}
function accFlush(){if(!ACC.dirty||!ACC.loaded)return;if(ACC.saving){ACC.again=true;return}
  ACC.saving=true;ACC.dirty=false;clearTimeout(ACC.timer);var clash=false;
  api("/api/data",{method:"PUT",body:JSON.stringify({rev:ACC.rev,data:state})}).then(function(j){ACC.rev=j.rev;ACC.last=Date.now();ACC.err="";ACC.tries=0},function(e){
    if(e.status===409){clash=true;return}
    ACC.dirty=true;accFail(e)}).then(function(){ACC.saving=false;
    if(clash){ACC.dirty=ACC.again=false;accLoad().then(function(){alert(X("Your data was changed on another device, so the latest version was loaded. Your last change here was not saved: please make it again.","Τα δεδομένα σας άλλαξαν σε άλλη συσκευή, οπότε φορτώθηκε η πιο πρόσφατη έκδοση. Η τελευταία σας αλλαγή εδώ δεν αποθηκεύτηκε: κάντε την ξανά."))});return}
    accStatusUI();if(ACC.again){ACC.again=false;accFlush()}})}
function accFail(e){
  if(e&&e.status===401){accSignedOut(X("You were signed out. Please sign in again.","Έχετε αποσυνδεθεί. Συνδεθείτε ξανά."));return}
  if(e&&e.status===403&&e.data&&e.data.must_change){if(ACC.user){ACC.user.must_change=true;accNewPw()}return}
  if(e&&e.status&&e.status<500){ACC.err=T(e.message);accStatusUI();return}   // the server said no (e.g. too large): trying again will not help
  ACC.err=X("Cannot reach the server. Your latest changes are not saved yet; trying again…","Δεν υπάρχει σύνδεση με τον διακομιστή. Οι τελευταίες αλλαγές σας δεν έχουν αποθηκευτεί ακόμη· νέα προσπάθεια…");accStatusUI();
  ACC.tries++;clearTimeout(ACC.timer);ACC.timer=setTimeout(function(){if(ACC.loaded)accFlush();else accLoad()},Math.min(60000,3000*ACC.tries))}
function accSignedOut(msg){ACC.user=null;$("pfov").hidden=true;ACC.loaded=ACC.dirty=false;ACC.err="";accUI();accStatusUI();applyData(JSON.parse(STATE0));$("usrm").hidden=true;accLogin(msg)}
// pick up changes made on another device (not while something is being typed here: loading would clear it)
function accRefresh(){var a=document.activeElement,typing=a&&/^(INPUT|TEXTAREA)$/.test(a.tagName)&&a.value!=="";
  if(!ACC.loaded||ACC.dirty||ACC.saving||st||document.hidden||editing||typing||!$("fmm").hidden)return;
  api("/api/data?rev="+ACC.rev).then(function(j){if(j.same||ACC.dirty||ACC.saving||st)return;ACC.rev=j.rev;if(j.data)applyData(j.data)},function(e){if(e&&(e.status===401||e.status===403))accFail(e)})}
document.addEventListener("visibilitychange",function(){if(!document.hidden){accFlush();accRefresh()}});
window.addEventListener("online",function(){accFlush();accRefresh()});
setInterval(accRefresh,30000);
window.addEventListener("beforeunload",function(e){if(st||ACC.dirty||ACC.saving){e.preventDefault();e.returnValue=""}});
// ---- sign out, change password
function accOut(){
  if(st||ACC.dirty||ACC.saving){alert(X("Your latest changes are still being saved. Try again in a moment.","Οι τελευταίες αλλαγές σας αποθηκεύονται ακόμη. Δοκιμάστε ξανά σε λίγο."));return}
  ask(X("Sign out?","Αποσύνδεση;"),function(){api("/api/logout",{method:"POST",body:"{}"}).catch(function(){}).then(function(){location.reload()})},{ok:X("Sign out","Αποσύνδεση")})}
function accPw(){fmOpen({title:X("Change password","Αλλαγή κωδικού"),intro:X("Your other devices will be signed out.","Οι άλλες συσκευές σας θα αποσυνδεθούν."),
  fields:[{id:"o",label:X("Current password","Τρέχων κωδικός"),type:"password",auto:"current-password"},{id:"n",label:X("New password (at least 8 characters)","Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)"),type:"password",auto:"new-password"},{id:"n2",label:X("New password again","Νέος κωδικός ξανά"),type:"password",auto:"new-password"}],
  ok:X("Change password","Αλλαγή κωδικού"),onOk:function(v){if(v.n!==v.n2)throw new Error(X("The two passwords are not the same.","Οι δύο κωδικοί δεν ταιριάζουν."));
    return api("/api/password",{method:"POST",body:JSON.stringify({old:v.o,"new":v.n})}).then(function(){say(X("Password changed.","Ο κωδικός άλλαξε."))})}})}
// ---- administrator: manage users
var AD={users:[],me:0};
function adLoad(){return api("/api/admin/users").then(function(j){AD.users=j.users;AD.me=j.me;adDraw()},function(e){$("usri").textContent=T(e.message)})}
function adOpen(){$("usrt").textContent=X("Manage users","Διαχείριση χρηστών");$("usri").textContent=X("Everyone has their own separate data. Only you, as administrator, can add, edit or remove accounts.","Ο καθένας έχει τα δικά του ξεχωριστά δεδομένα. Μόνο εσείς, ως διαχειριστής, μπορείτε να προσθέσετε, επεξεργαστείτε ή αφαιρέσετε λογαριασμούς.");
  $("usrtop").innerHTML='<button type="button" class="primary" data-um="add">'+esc(X("+ Add user","+ Προσθήκη χρήστη"))+'</button><button type="button" data-um="bak">'+esc(X("Download backup","Λήψη αντιγράφου ασφαλείας"))+'</button>';$("usrx").textContent=X("Close","Κλείσιμο");$("usrm").hidden=false;adLoad()}
function adDraw(){$("usrl").innerHTML=AD.users.map(function(u){var D=function(t){return t?new Date(t).toLocaleDateString(LANG==="el"?"el-GR":"en-GB"):X("never","ποτέ")},seen=D(u.seen),saved=D(u.saved),me=u.id===AD.me;
  return '<div class="usrr'+(u.active?'':' off')+'"><div class="t"><b>'+esc(u.username)+'</b>'+(u.role==="admin"?'<span class="bdg a">'+esc(X("administrator","διαχειριστής"))+'</span>':'')+(u.active?'':'<span class="bdg">'+esc(X("disabled","απενεργοποιημένος"))+'</span>')+(me?'<span class="bdg">'+esc(X("you","εσείς"))+'</span>':'')+'</div>'+
  '<div class="m">'+esc(X("Last saved: ","Τελευταία αποθήκευση: ")+saved+" · "+X("Last seen: ","Τελευταία χρήση: ")+seen+" · "+X("Devices signed in: ","Συνδεδεμένες συσκευές: ")+u.sessions)+'</div>'+
  '<div class="b"><button type="button" data-um="rename" data-id="'+u.id+'">'+esc(X("Rename","Μετονομασία"))+'</button><button type="button" data-um="pw" data-id="'+u.id+'">'+esc(X("Reset password","Επαναφορά κωδικού"))+'</button>'+
  '<button type="button" data-um="role" data-id="'+u.id+'">'+esc(u.role==="admin"?X("Make normal user","Κάνε απλό χρήστη"):X("Make administrator","Κάνε διαχειριστή"))+'</button>'+
  '<button type="button" data-um="act" data-id="'+u.id+'">'+esc(u.active?X("Disable","Απενεργοποίηση"):X("Enable","Ενεργοποίηση"))+'</button>'+
  '<button type="button" data-um="out" data-id="'+u.id+'">'+esc(X("Sign out everywhere","Αποσύνδεση παντού"))+'</button>'+
  (me?'':'<button type="button" data-um="del" data-id="'+u.id+'">'+esc(X("Delete","Διαγραφή"))+'</button>')+'</div></div>'}).join("")}
// the whole database (every account) as one file
function adBackup(){fetch("/api/admin/backup",{cache:"no-store",credentials:"same-origin"}).then(function(r){
    if(!r.ok)return r.json().catch(function(){return {}}).then(function(j){throw new Error(j&&j.error||("HTTP "+r.status))});
    return r.blob().then(function(b){dlBlob("cent-aur-"+new Date().toISOString().slice(0,10)+".db",b)})}).catch(function(e){alert(T(e.message))})}
function adCall(path,method,body){return api(path,{method:method,body:body?JSON.stringify(body):undefined}).then(adLoad).catch(function(e){alert(T(e.message))})}
function adAct(a,id){var u=AD.users.filter(function(x){return x.id===id})[0];
  if(a==="bak"){adBackup();return}
  if(a==="add"){fmOpen({title:X("Add user","Προσθήκη χρήστη"),fields:[{id:"u",label:X("User name","Όνομα χρήστη")},{id:"p",label:X("Password (at least 8 characters)","Κωδικός (τουλάχιστον 8 χαρακτήρες)"),type:"password",auto:"new-password"}],ok:X("Add user","Προσθήκη"),
      onOk:function(v){return api("/api/admin/users",{method:"POST",body:JSON.stringify({username:v.u.trim(),password:v.p})}).then(adLoad)}});return}
  if(!u)return;
  if(a==="rename"){fmOpen({title:X("Rename","Μετονομασία"),fields:[{id:"u",label:X("User name","Όνομα χρήστη"),value:u.username}],ok:X("Save","Αποθήκευση"),onOk:function(v){return api("/api/admin/users/"+id,{method:"PATCH",body:JSON.stringify({username:v.u.trim()})}).then(adLoad)}})}
  else if(a==="pw"){fmOpen({title:X("Reset password for ","Επαναφορά κωδικού για ")+u.username,intro:X("They will be signed out on all devices and must use the new password.","Θα αποσυνδεθεί από όλες τις συσκευές και θα πρέπει να χρησιμοποιήσει τον νέο κωδικό."),fields:[{id:"p",label:X("New password (at least 8 characters)","Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)"),type:"password",auto:"new-password"}],ok:X("Reset password","Επαναφορά"),onOk:function(v){return api("/api/admin/users/"+id,{method:"PATCH",body:JSON.stringify({password:v.p})}).then(adLoad)}})}
  else if(a==="role")adCall("/api/admin/users/"+id,"PATCH",{role:u.role==="admin"?"user":"admin"});
  else if(a==="act")adCall("/api/admin/users/"+id,"PATCH",{active:!u.active});
  else if(a==="out")adCall("/api/admin/users/"+id+"/logout","POST",{});
  else if(a==="del")ask(X("Delete the account “"+u.username+"” and ALL of its data? This cannot be undone.","Διαγραφή του λογαριασμού «"+u.username+"» και ΟΛΩΝ των δεδομένων του; Δεν μπορεί να αναιρεθεί."),function(){adCall("/api/admin/users/"+id,"DELETE")},{ok:X("Delete everything","Διαγραφή όλων")})}
$("usrm").addEventListener("click",function(e){if(e.target===this||e.target.id==="usrx"){this.hidden=true;return}var b=e.target.closest("[data-um]");if(b)adAct(b.dataset.um,b.dataset.id?+b.dataset.id:0)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("usrm").hidden&&$("fmm").hidden&&$("dlg").hidden)$("usrm").hidden=true});
$("acb").addEventListener("click",function(e){var b=e.target.closest("[data-ac]");if(!b)return;var a=b.dataset.ac;
  if(a==="pw")accPw();else if(a==="usrm")adOpen();else if(a==="out")accOut();else if(a==="leave")accLeave()});
// ---- start-up
function accBoot(){
  // the page's <head> already asked for the session and the data in one go, while this script was loading
  var b=window.BOOT;window.BOOT=null;
  (b?apiRes(b):api("/api/session")).then(function(j){DESK=j.desktop||null;deskUI();if(j.user)accStart(j.user,"data" in j?j:null);else if(DESK&&DESK.mode!=="online")accChoose();else accLogin()},
    function(e){DESK=e.data&&e.data.desktop||null;deskUI();var m=T(e.data&&e.data.error||"")||X("The server could not be reached. Check your connection.","Δεν ήταν δυνατή η σύνδεση με τον διακομιστή. Ελέγξτε τη σύνδεσή σας.");if(DESK)accChoose(m);else accLogin(m)})}


var ORIG=typeof WeakMap!=="undefined"?new WeakMap():null,AORIG=typeof WeakMap!=="undefined"?new WeakMap():null,LOBS=null,TRATTR=["placeholder","title","aria-label"];
function inNotr(n){for(var e=n.nodeType===3?n.parentNode:n;e&&e.nodeType===1;e=e.parentNode){if(e.tagName==="SCRIPT"||e.tagName==="STYLE"||(e.hasAttribute&&e.hasAttribute("data-notr")))return true}return false}
function doText(n){
  if(inNotr(n))return;
  var cur=n.nodeValue,rec=ORIG.get(n),src=rec&&rec.out===cur?rec.src:cur,out=trAny(src);
  if(out!==cur)n.nodeValue=out;
  if(out!==src)ORIG.set(n,{src:src,out:out});else ORIG.delete(n)}
function doAttr(e,a){
  if(inNotr(e))return;
  var cur=e.getAttribute(a);if(cur==null)return;
  var rec=AORIG.get(e)||{},r=rec[a],src=r&&r.out===cur?r.src:cur,out=trAny(src);
  if(out!==cur)e.setAttribute(a,out);
  if(out!==src){rec[a]={src:src,out:out};AORIG.set(e,rec)}else if(r){delete rec[a]}}
function walkTr(root){
  if(!ORIG||!root)return;
  if(root.nodeType===3){doText(root);return}
  if(root.nodeType!==1||inNotr(root))return;
  var w=document.createTreeWalker(root,5,{acceptNode:function(n){return n.nodeType===1&&(n.tagName==="SCRIPT"||n.tagName==="STYLE"||n.hasAttribute("data-notr"))?2:1}}),n=root;
  do{if(n.nodeType===3)doText(n);else TRATTR.forEach(function(a){if(n.hasAttribute(a))doAttr(n,a)})}while(n=w.nextNode())}
// "How it works" explanations start folded; each one remembers being opened, on this device
(function(){var o={};try{o=JSON.parse(localStorage.getItem("xpence-hints")||"{}")||{}}catch(e){}
  document.querySelectorAll("details.hintd").forEach(function(d){var k=d.getAttribute("data-hd");if(o[k])d.open=true;
    d.addEventListener("toggle",function(){if(d.open)o[k]=1;else delete o[k];try{localStorage.setItem("xpence-hints",JSON.stringify(o))}catch(e){}})})})();
function applyLang(){
  if(typeof document==="undefined"||!document.createTreeWalker||!ORIG)return;
  var r=document.documentElement;if(r)r.lang=LANG;
  if(LOBS){LOBS.disconnect();LOBS=null}
  walkTr(document.body);
  if(typeof MutationObserver!=="undefined"){
    LOBS=new MutationObserver(function(ms){ms.forEach(function(m){
      if(m.type==="childList"){Array.prototype.forEach.call(m.addedNodes,walkTr)}
      else if(m.type==="characterData"){doText(m.target)}
      else if(m.type==="attributes"){doAttr(m.target,m.attributeName)}})});
    LOBS.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:TRATTR})}
  syncLangUI();if(typeof accUI==="function")accUI();if(typeof mrLabels==="function")mrLabels()}
function setLang(l,fromData){
  if(l!=="el")l="en";
  LANG=l;state.lang=l;
  try{localStorage.setItem("xpence-lang",l)}catch(e){}
  applyLang();syncOpts();stopGoal();stopCl();render();
  if(!fromData)save()}

function syncLang(){if(state.lang&&state.lang!==LANG){LANG=state.lang;try{localStorage.setItem("xpence-lang",LANG)}catch(e){}applyLang()}}
function syncLangUI(){var el=LANG==="el";$("langn").textContent=el?"Ελληνικά":"English";$("langu").setAttribute("href",el?"#flag-el":"#flag-en");
  Array.prototype.forEach.call($("langm").children,function(li){li.setAttribute("aria-selected",String(li.getAttribute("data-l")===LANG))})}
function langOpen(v){$("langm").hidden=!v;$("langb").setAttribute("aria-expanded",String(v));if(v){var sel=$("langm").querySelector('[aria-selected="true"]');if(sel)sel.focus()}}
$("langb").addEventListener("click",function(e){e.stopPropagation();langOpen($("langm").hidden)});
$("langm").addEventListener("click",function(e){var li=e.target.closest("[data-l]");if(!li)return;langOpen(false);$("langb").focus();setLang(li.getAttribute("data-l"))});
$("langm").addEventListener("keydown",function(e){var li=e.target.closest("[data-l]");if(!li)return;
  if(e.key==="Enter"||e.key===" "){e.preventDefault();li.click()}
  else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();var n=e.key==="ArrowDown"?li.nextElementSibling:li.previousElementSibling;if(n)n.focus()}
  else if(e.key==="Escape"){langOpen(false);$("langb").focus()}});
document.addEventListener("click",function(e){if(!$("langm").hidden&&!e.target.closest("#langdd"))langOpen(false)});

var pend={},toastT=null;
function isPend(k,id){return !!pend[k+":"+id]}
function phHTML(k,id){return '<div class="ph"><span>'+X("Deleted","Διαγράφηκε")+'</span><button type="button" class="pill" data-undo="'+k+':'+esc(id)+'">'+X("Undo","Αναίρεση")+'</button></div>'}
function askDel(k,id,name,rec){
  if(isPend(k,id))return;
  var msg=name?(rec?'Delete "'+name+'"? It will be removed from all months.':'Delete "'+name+'"?'):"Delete this entry?";
  ask(msg,function(){pend[k+":"+id]=setTimeout(function(){commitDel(k,id)},5000);render()},{ok:"Delete"})}
function commitDel(k,id){var key=k+":"+id;clearTimeout(pend[key]);delete pend[key];
  if(k==="x"){state.items=state.items.filter(function(i){return i.id!==id});if(editing===id)stopEdit()}
  else if(k==="w"){state.withdraw=state.withdraw.filter(function(x){return x.id!==id});if(editWD===id)stopWD()}
  else if(k==="e"){state.oneoff=state.oneoff.filter(function(x){return x.id!==id});if(editEO===id)stopEO()}
  else if(k==="g"){state.goals=state.goals.filter(function(x){return x.id!==id});if(goalEdit===id)stopGoal()}
  else{state.fl.items=state.fl.items.filter(function(x){return x.id!==id});if(flEdit===id)stopFl()}
  save();render()}
function undoDel(key){clearTimeout(pend[key]);delete pend[key];render()}
function editToast(msg,getList,prev){var t=$("toast");if(!t)return;
  t.innerHTML='<span>'+esc(msg)+'</span><button type="button" id="toastu">'+X("Undo","Αναίρεση")+'</button>';t.hidden=false;
  clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},6000);
  $("toastu").addEventListener("click",function(){t.hidden=true;clearTimeout(toastT);var l=getList();for(var i=0;i<l.length;i++)if(l[i].id===prev.id)l[i]=prev;save();render()})}
function X(en,el){return LANG==="el"?el:en}
function cn(n){return LANG==="el"?trCat(n):n}
function renderIns(){var el=$("inslist");if(!el)return;
  var L2=insightsFor(LS(),today());
  if(!LS().items.length){el.innerHTML='<div class="hint">'+X("Add some expenses to get insights.","Προσθέστε έξοδα για να δείτε συμβουλές.")+'</div>';return}
  if(!L2.length){el.innerHTML='<div class="in good"><b>'+X("Nothing stands out this month","Τίποτα ιδιαίτερο αυτόν τον μήνα")+'</b><small>'+X("Your spending looks steady. Keep it up!","Τα έξοδά σας φαίνονται σταθερά. Συνεχίστε έτσι!")+'</small></div>';return}
  el.innerHTML=L2.map(function(x){var t,u,c=esc(cn(x.cat||""));
    if(x.id==="over"){t=X("Over budget by "+fmt(x.over)+" this month","Ξεπεράσατε τον προϋπολογισμό κατά "+fmt(x.over)+" αυτόν τον μήνα");u=X("Pause non-essential spending for the rest of the month.","Περιορίστε τα μη απαραίτητα έξοδα για το υπόλοιπο του μήνα.")}
    else if(x.id==="near"){t=X(fmt(x.left)+" left for "+x.days+(x.days===1?" day":" days"),"Απομένουν "+fmt(x.left)+" για "+x.days+(x.days===1?" ημέρα":" ημέρες"));u=X("That is about "+fmt(x.perDay)+" per day — try to stay under it.","Δηλαδή περίπου "+fmt(x.perDay)+" την ημέρα — προσπαθήστε να μείνετε κάτω από αυτό.")}
    else if(x.id==="rise"){t=X(c+" is "+x.pct+"% above your 3-month average",c+": "+x.pct+"% πάνω από τον μέσο όρο 3 μηνών");u=X("Bringing it back to "+fmt(x.avg)+" a month would save about "+fmt(x.yearly)+" a year.","Αν επιστρέψει στα "+fmt(x.avg)+" τον μήνα, θα εξοικονομήσετε περίπου "+fmt(x.yearly)+" τον χρόνο.")}
    else if(x.id==="subs"){t=X(x.n+" subscriptions cost "+fmt(x.yearly)+" a year",x.n+" συνδρομές κοστίζουν "+fmt(x.yearly)+" τον χρόνο");u=X("Cancel the ones you rarely use.","Ακυρώστε όσες σπάνια χρησιμοποιείτε.")}
    else if(x.id==="bill"){t=X(c+" bill is up "+x.pct+"% on the previous one","Ο λογαριασμός "+c+" αυξήθηκε "+x.pct+"% σε σχέση με τον προηγούμενο");u=X("Compare providers or check your usage — "+fmt(x.diff)+" more per bill adds up.","Συγκρίνετε παρόχους ή ελέγξτε την κατανάλωσή σας — τα "+fmt(x.diff)+" παραπάνω ανά λογαριασμό μετράνε.")}
    else if(x.id==="lowerbudget"){t=X("Your budget is "+fmt(x.diff)+" above your average spending","Ο προϋπολογισμός σας είναι "+fmt(x.diff)+" πάνω από τα μέσα έξοδά σας");u=X("Lowering it to about "+fmt(x.tgt)+" a month would add roughly "+fmt(x.yearly)+" a year to your planned savings.","Αν τον μειώσετε στα "+fmt(x.tgt)+" τον μήνα, οι αποταμιεύσεις σας θα αυξηθούν κατά περίπου "+fmt(x.yearly)+" τον χρόνο.")}
    else if(x.id==="trim"){t=X(c+" is your biggest expense ("+x.share+"% of the month)","Η μεγαλύτερη δαπάνη σας είναι "+c+" ("+x.share+"% του μήνα)");u=X("Trimming it by 10% would save about "+fmt(x.yearly)+" a year.","Μείωσή της κατά 10% θα εξοικονομούσε περίπου "+fmt(x.yearly)+" τον χρόνο.")}
    else{t=X(c+" is "+x.pct+"% below your 3-month average",c+": "+x.pct+"% κάτω από τον μέσο όρο 3 μηνών");u=X("Nice — keep it up.","Μπράβο — συνεχίστε έτσι.")}
    return '<div class="in '+x.tone+'"><b>'+t+'</b><small>'+u+'</small></div>'}).join("")}
function insSummary(){var S=catStats(LS(),today()),f=function(n){return fmt(n)};
  var h=X("Here is my monthly budget summary. Please suggest practical ways I could save money.\n","Ακολουθεί η σύνοψη του μηνιαίου προϋπολογισμού μου. Πρότεινέ μου πρακτικούς τρόπους να εξοικονομήσω χρήματα.\n");
  h+=X("Monthly salary: ","Μηνιαίος μισθός: ")+f(+state.salary||0)+"\n"+X("Monthly budget: ","Μηνιαίος προϋπολογισμός: ")+f(S.b)+"\n"+X("Spent this month: ","Έξοδα αυτού του μήνα: ")+f(S.sp)+"\n";
  h+=X("Average monthly spending (last "+S.n+" months): ","Μέσα μηνιαία έξοδα (τελευταίοι "+S.n+" μήνες): ")+f(S.avgTot)+"\n"+X("Per category (3-month average / this month):\n","Ανά κατηγορία (μέσος όρος 3 μηνών / αυτός ο μήνας):\n");
  S.rows.slice().sort(function(a,b){return b.cur-a.cur}).forEach(function(r){h+="- "+cn(r.cat)+": "+f(r.avg)+" / "+f(r.cur)+(r.bill?X(" (bill)"," (λογαριασμός)"):"")+"\n"});
  return h}
$("inscopy").addEventListener("click",function(){var t=insSummary(),b=this,old=b.textContent;
  function done(){b.textContent=X("Copied!","Αντιγράφηκε!");setTimeout(function(){b.textContent=X("Copy summary for AI","Αντιγραφή σύνοψης για AI")},1800)}
  try{navigator.clipboard.writeText(t).then(done,function(){fb()})}catch(e){fb()}
  function fb(){var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove();done()}});
/* ===== v51: tags & search, pause/end, goals, VAT, clients, report, start with Windows ===== */
var PAUSEI='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
var MAB_EN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],MAB_EL=["Ιαν","Φεβ","Μαρ","Απρ","Μάι","Ιουν","Ιουλ","Αυγ","Σεπ","Οκτ","Νοε","Δεκ"];
function MNY(s){var i=idxOf(s);return (LANG==="el"?EL_M[i%12]:MN(i))+" "+Math.floor(i/12)}
function MNYa(s){var i=idxOf(s);return LANG==="el"?"τον "+EL_M[i%12].slice(0,-1)+" "+Math.floor(i/12):MN(i)+" "+Math.floor(i/12)}
function dmy(s){return s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4)}

/* ---- search & tags ---- */
function setQ(v){qStr=v;qToks=qTokens(v);render()}
var qT=null;
$("q").addEventListener("input",function(){clearTimeout(qT);var el=this;qT=setTimeout(function(){setQ(el.value)},140)});
$("q").addEventListener("keydown",function(e){if(e.key==="Escape"&&this.value){this.value="";clearTimeout(qT);setQ("")}});
function toggleTag(tag){var w="#"+tag,parts=qStr.split(/\s+/).filter(Boolean),k=-1;
  for(var i=0;i<parts.length;i++)if(fold(parts[i])===fold(w)){k=i;break}
  if(k>=0)parts.splice(k,1);else parts.push(w);
  $("q").value=parts.join(" ");clearTimeout(qT);setQ($("q").value)}
function renderSearch(){
  var items=LS().items,counts={};
  items.forEach(function(it){if(it.tags)it.tags.forEach(function(t){counts[t]=(counts[t]||0)+1})});
  var names=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]||(a<b?-1:a>b?1:0)});
  $("taglist").innerHTML=names.map(function(t){return '<option value="'+esc(t)+'">'}).join("");
  var act=qToks.filter(function(t){return t.charAt(0)==="#"}).map(function(t){return t.slice(1)});
  $("tagbar").innerHTML=names.slice(0,14).map(function(t){var on=act.indexOf(fold(t))>=0;
    return '<button type="button" class="tgc'+(on?' on':'')+'" data-tg="'+esc(t)+'" aria-pressed="'+on+'">#'+esc(t)+(counts[t]>1?' <small>'+counts[t]+'</small>':'')+'</button>'}).join("");
  var qs=$("qsum");
  if(qToks.length){var ms=items.filter(function(it){return qMatch(it,qToks,qLabel(it))}),tot=0;ms.forEach(function(it){tot+=yearAmt(it,selYear)});
    qs.hidden=false;
    qs.textContent=ms.length?X("Found "+ms.length+(ms.length===1?" expense":" expenses")+" · "+fmt(tot)+" in "+selYear,(ms.length===1?"Βρέθηκε 1 έξοδο":"Βρέθηκαν "+ms.length+" έξοδα")+" · "+fmt(tot)+" το "+selYear):X("No expenses match your search.","Κανένα έξοδο δεν ταιριάζει με την αναζήτηση.")}
  else qs.hidden=true}

/* ---- recurring expenses: pause / resume / end ---- */
function syncEnd(){$("endw").hidden=(+$("freq").value===0)}
$("freq").addEventListener("change",function(){freqTouched=true;syncEnd()});
function renderRec(){
  var ci=idxOf(today()),all=LS().items.filter(function(it){return it.freq!==0}),np=0;
  all.forEach(function(it){if(recStatus(it,ci)==="paused")np++});
  $("recn").textContent=all.length?(np?X(all.length+" · "+np+" paused",all.length+" · "+np+" σε παύση"):String(all.length)):"";
  var d=$("recd");if(!!openD.rec!==d.open)d.open=!!openD.rec;
  if(!d.open){$("recl").innerHTML="";return}
  if(!all.length){$("recl").innerHTML='<div class="empty">'+X("No recurring expenses yet.","Δεν υπάρχουν επαναλαμβανόμενα έξοδα ακόμη.")+'</div>';return}
  var rk={active:0,later:0,paused:1,ended:2};
  all.sort(function(a,b){var x=rk[recStatus(a,ci)],y=rk[recStatus(b,ci)];return x-y||(fold(a.name)<fold(b.name)?-1:1)});
  $("recl").innerHTML=all.map(function(it){var s=recStatus(it,ci),sm=it.date.slice(0,7);
    var ending=!!it.until&&(s==="active"||s==="later");
    var lab=ending?X("Ends after "+MNY(it.until),"Λήγει μετά "+MNYa(it.until)):{active:X("Active","Ενεργό"),later:X("Starts "+MNY(sm),"Ξεκινά "+MNY(sm)),paused:X("Paused","Σε παύση"),ended:X("Ended","Έληξε")}[s];
    var sub=esc(it.cat)+" · "+fmt(it.amt)+" "+L[it.freq]+(it.until?" · "+X("ends after "+MNY(it.until),"τελευταίος μήνας: "+MNY(it.until)):"");
    var b=(s==="paused"||s==="ended")?'<button type="button" class="pill" data-rp="resume" data-id="'+it.id+'">'+X("Resume","Συνέχιση")+'</button>':'<button type="button" class="pill" data-rp="pause" data-id="'+it.id+'">'+X("Pause","Παύση")+'</button>';
    if(ending)b+='<button type="button" class="pill" data-rp="resume" data-id="'+it.id+'">'+X("Keep going","Να συνεχιστεί")+'</button>';
    if(s!=="ended")b+='<button type="button" class="pill" data-rp="end" data-id="'+it.id+'">'+X("End","Λήξη")+'</button>';
    b+='<button class="ed" data-id="'+it.id+'" aria-label="Edit">✎</button><button class="del" data-id="'+it.id+'" aria-label="Delete">✕</button>';
    return '<div class="rr"><div>'+icItem(it)+esc(it.name)+'<small>'+sub+'</small></div><span class="rs '+(ending?'paused':s)+'">'+lab+'</span><span class="rb">'+b+'</span></div>'}).join("")}
function recAct(act,id){var it=find(id);if(!it)return;var ci=idxOf(today()),prev=clone(it),nm=it.name,list=function(){return state.items};
  if(act==="pause"){pauseIt(it,ci);save();render();editToast(X("Paused “"+nm+"”","Σε παύση: «"+nm+"»"),list,prev)}
  else if(act==="resume"){resumeIt(it,ci);save();render();editToast(X("Resumed “"+nm+"”","Συνεχίστηκε: «"+nm+"»"),list,prev)}
  else if(act==="end"){var lm=ymOf(Math.max(ci,idxOf(it.date)));
    ask(X("End “"+nm+"” after "+MNY(lm)+"? Earlier months stay as they are.","Λήξη του «"+nm+"» μετά "+MNYa(lm)+"; Οι προηγούμενοι μήνες μένουν όπως είναι."),function(){var t=find(id);if(!t)return;var p=clone(t);endIt(t,ci);save();render();editToast(X("Ended “"+nm+"”","Έληξε: «"+nm+"»"),list,p)},{ok:X("End","Λήξη")})}}

/* ---- savings goals ---- */
var goalEdit=null;
function stopGoal(){goalEdit=null;$("gn").value="";$("gt").value="";$("gs").value="";$("gb").value="";$("gsb").textContent="Add goal";$("gsc").hidden=true}
function renderGoals(){
  var el=$("glist"),ci=idxOf(today());
  if(!state.goals.length){el.innerHTML='<div class="empty">'+X("No goals yet. Add one above.","Δεν υπάρχουν στόχοι ακόμη. Προσθέστε έναν παραπάνω.")+'</div>';return}
  el.innerHTML=state.goals.map(function(g){
    if(isPend("g",g.id))return phHTML("g",g.id);
    var gi=goalInfo(g,ci),line;
    if(gi.done)line=X("Goal reached","Ο στόχος επιτεύχθηκε");
    else if(gi.late)line=X("The target month has passed · "+fmt(gi.left)+" to go","Ο μήνας-στόχος πέρασε · απομένουν "+fmt(gi.left));
    else if(gi.n)line=X(fmt(gi.per)+" a month for "+gi.n+(gi.n===1?" month":" months")+" to reach it by "+MNY(g.by),fmt(gi.per)+" τον μήνα για "+gi.n+(gi.n===1?" μήνα":" μήνες")+" ώστε να τον πετύχετε έως "+MNYa(g.by));
    else line=X(fmt(gi.left)+" to go","Απομένουν "+fmt(gi.left));
    return '<div class="gl'+(gi.done?' done':'')+'"><div class="glh"><div><b>'+esc(g.name)+'</b><small>'+fmt(g.saved)+' / '+fmt(g.target)+' · '+Math.round(gi.pct)+'%</small></div>'+
      '<span class="act"><button class="ed2" data-gedit="'+g.id+'" aria-label="Edit">✎</button><button class="del" data-gdel="'+g.id+'" aria-label="Delete">✕</button></span></div>'+
      '<div class="bb"><i style="width:'+gi.pct+'%"></i></div>'+
      '<div class="gls"><small>'+line+'</small><span class="gla"><input type="number" step="0.01" min="0.01" data-ga="'+g.id+'" placeholder="'+X("Amount","Ποσό")+'" aria-label="'+X("Amount","Ποσό")+'"><button type="button" class="pill" data-gadd="'+g.id+'">'+X("Add","Προσθήκη")+'</button><button type="button" class="pill" data-gsub="'+g.id+'">'+X("Take out","Ανάληψη")+'</button></span></div></div>'}).join("")}
$("gf").addEventListener("submit",function(e){e.preventDefault();
  var nm=$("gn").value.trim().slice(0,60),t=parseFloat($("gt").value),sv=parseFloat($("gs").value);if(!(sv>0))sv=0;
  if(!nm||!(t>0)){alert(X("Enter a goal name and a target above 0.","Δώστε όνομα στόχου και ποσό-στόχο μεγαλύτερο από 0."));return}
  var by=/^\d{4}-\d{2}$/.test($("gb").value)?$("gb").value:"",prev=null;
  if(goalEdit){state.goals=state.goals.map(function(g){if(g.id!==goalEdit)return g;prev=g;return {id:g.id,name:nm,target:t,saved:sv,by:by}})}
  else state.goals.push({id:nid(),name:nm,target:t,saved:sv,by:by});
  stopGoal();save();renderGoals();if(prev)editToast(X("Goal updated","Ο στόχος ενημερώθηκε"),function(){return state.goals},prev)});
$("gsc").addEventListener("click",stopGoal);
function goalMove(id,sign){var inp=document.querySelector('[data-ga="'+id+'"]'),a=inp?parseFloat(inp.value):NaN;if(!(a>0)){if(inp)inp.focus();return}
  var prev=null;state.goals.forEach(function(g){if(g.id===id){prev=clone(g);g.saved=Math.max(0,r2(g.saved+sign*a))}});
  if(!prev)return;save();renderGoals();editToast(sign>0?X("Added to “"+prev.name+"”","Προστέθηκε στο «"+prev.name+"»"):X("Taken out of “"+prev.name+"”","Αφαιρέθηκε από το «"+prev.name+"»"),function(){return state.goals},prev)}
$("glist").addEventListener("click",function(e){var b;
  if(b=e.target.closest("[data-gadd]"))goalMove(b.getAttribute("data-gadd"),1);
  else if(b=e.target.closest("[data-gsub]"))goalMove(b.getAttribute("data-gsub"),-1);
  else if(b=e.target.closest("[data-gdel]")){var id=b.getAttribute("data-gdel"),g=state.goals.filter(function(x){return x.id===id})[0];askDel("g",id,g?g.name:"")}
  else if(b=e.target.closest("[data-gedit]")){var g2=state.goals.filter(function(x){return x.id===b.getAttribute("data-gedit")})[0];if(!g2)return;
    goalEdit=g2.id;$("gn").value=g2.name;$("gt").value=g2.target;$("gs").value=g2.saved||"";$("gb").value=g2.by||"";$("gsb").textContent="Save";$("gsc").hidden=false;$("gn").focus()}});
$("glist").addEventListener("keydown",function(e){if(e.key!=="Enter")return;var inp=e.target.closest&&e.target.closest("[data-ga]");if(inp){e.preventDefault();goalMove(inp.getAttribute("data-ga"),1)}});

/* ---- freelancer: VAT, clients, monthly report ---- */
function flLive(){return state.fl.items.filter(function(o){return !isPend("f",o.id)})}
function fillVr(v){v=String(v);var s=$("flvr");for(var i=0;i<s.options.length;i++)if(s.options[i].value===v)return;var o=document.createElement("option");o.value=v;o.textContent="VAT "+v+"%";s.appendChild(o)}
function flVatOn(){return !!state.fl.vat.on}
function updateFlPrev(){var el=$("flvp");if(!flVatOn()){el.hidden=true;return}var a=parseFloat($("fla").value);if(!(a>0)){el.hidden=true;return}
  var o={amt:a,vr:+$("flvr").value,incl:$("flinc").value==="1",vd:$("flvd").checked,type:flType},v=flVatOf(o);
  el.hidden=false;el.textContent=X("Net "+fmt(flNet(o))+" + VAT "+fmt(v)+" = "+fmt(flGross(o)),"Καθαρό "+fmt(flNet(o))+" + ΦΠΑ "+fmt(v)+" = "+fmt(flGross(o)))}
function syncFlForm(){var on=flVatOn(),out=flType==="out";$("flvatw").hidden=!on;$("flvdw").hidden=!(on&&out);$("flcli").hidden=out;updateFlPrev()}
["fla"].forEach(function(id){$(id).addEventListener("input",updateFlPrev)});
["flinc","flvr","flvd"].forEach(function(id){$(id).addEventListener("change",updateFlPrev)});
function clientName(v){v=String(v||"").trim().slice(0,60);if(!v)return "";var l=v.toLowerCase(),c=state.fl.clients;for(var i=0;i<c.length;i++)if(c[i].toLowerCase()===l)return c[i];c.push(v);return v}
function perName(P,mode){if(mode==="m")return (LANG==="el"?EL_M[P.from%12]:MN(P.from))+" "+Math.floor(P.from/12);
  var a=(P.q-1)*3,b=a+2,ab=LANG==="el"?MAB_EL:MAB_EN;
  return LANG==="el"?P.q+"ο τρίμηνο "+P.y+" ("+ab[a]+"–"+ab[b]+")":"Q"+P.q+" "+P.y+" ("+ab[a]+"–"+ab[b]+")"}
function renderVat(its){
  var v=state.fl.vat,on=v.on;
  $("vaton").checked=on;$("vatset").hidden=!on;
  Array.prototype.forEach.call(document.querySelectorAll("[data-vp]"),function(b){b.classList.toggle("on",b.getAttribute("data-vp")===v.period)});
  $("vath").textContent=on?X("Amounts are tracked without VAT, so your profit and tax estimate are not inflated by VAT you only collect for the state. VAT counts in the period of the invoice date, even if the client has not paid yet. These are estimates: confirm with your accountant.","Τα ποσά καταγράφονται χωρίς ΦΠΑ, ώστε το κέρδος και η εκτίμηση φόρου να μη διογκώνονται από ΦΠΑ που απλώς εισπράττετε για το Δημόσιο. Το ΦΠΑ μετράει στην περίοδο της ημερομηνίας του τιμολογίου, ακόμη κι αν ο πελάτης δεν έχει πληρώσει. Είναι εκτιμήσεις: επιβεβαιώστε με τον λογιστή σας."):X("Turn this on if you are registered for VAT. Then you can enter amounts before or after VAT and see how much VAT you owe each period.","Ενεργοποιήστε το αν είστε εγγεγραμμένος στο ΦΠΑ. Τότε μπορείτε να καταχωρείτε ποσά πριν ή μετά το ΦΠΑ και να βλέπετε πόσο ΦΠΑ οφείλετε σε κάθε περίοδο.");
  if(!on){$("vatbody").innerHTML="";return}
  var ci=idxOf(today()),cy=Math.floor(ci/12),mode=v.period,focus=flYear===cy?ci:flYear*12+11,P=vatPeriod(focus,mode),S=vatSum(its,P.from,P.to),td=today();
  var tile=function(l,val){return '<div class="tot"><span>'+l+'</span><b>'+val+'</b></div>'};
  var h='<div class="ol">'+perName(P,mode)+'</div><div class="vtop">'+tile(X("VAT charged","ΦΠΑ που χρεώσατε"),fmt(S.out))+tile(X("VAT on expenses","ΦΠΑ εξόδων"),fmt(S.inn))+
    '<div class="tot big"><span>'+(S.due<0?X("VAT credit","Πιστωτικό ΦΠΑ"):X("VAT to pay","ΦΠΑ προς πληρωμή"))+'</span><b>'+fmt(Math.abs(S.due))+'</b></div></div>'+
    '<div class="hint">'+X("File and pay by "+dmy(vatDeadline(P.to))+(S.unp>0?" · includes "+fmt(S.unp)+" from unpaid invoices":""),"Υποβολή και πληρωμή έως "+dmy(vatDeadline(P.to))+(S.unp>0?" · περιλαμβάνει "+fmt(S.unp)+" από απλήρωτα τιμολόγια":""))+'</div>';
  var per=[],seen={};
  for(var m=0;m<12;m++){var p=vatPeriod(flYear*12+m,mode);if(seen[p.key])continue;seen[p.key]=1;var s=vatSum(its,p.from,p.to);if(s.n>0)per.push({p:p,s:s})}
  if(state.order!=="old")per.reverse();
  if(per.length)h+='<div class="ol">'+X("Periods in "+flYear,"Περίοδοι του "+flYear)+'</div>'+per.map(function(x){var paid=!!v.paid[x.p.key],late=!paid&&x.s.due>0&&vatDeadline(x.p.to)<td;
    return '<div class="vr"><div><b>'+perName(x.p,mode)+'</b><small>'+X("charged "+fmt(x.s.out)+" · expenses "+fmt(x.s.inn),"χρεώσεις "+fmt(x.s.out)+" · έξοδα "+fmt(x.s.inn))+(late?' · <span class="neg">'+X("overdue","εκπρόθεσμο")+'</span>':'')+'</small></div><b'+(x.s.due<0?' class="pos"':'')+'>'+fmt(x.s.due)+'</b>'+
      (x.s.due>0?'<label><input type="checkbox" data-vpaid="'+x.p.key+'"'+(paid?' checked':'')+'> '+X("Paid","Πληρώθηκε")+'</label>':'<span></span>')+'</div>'}).join("");
  $("vatbody").innerHTML=h}
$("vaton").addEventListener("change",function(){state.fl.vat.on=this.checked;save();syncFlForm();renderFl()});
$("flvat").addEventListener("click",function(e){var b=e.target.closest("[data-vp]");if(!b)return;state.fl.vat.period=b.getAttribute("data-vp")==="m"?"m":"q";save();renderFl()});
$("flvat").addEventListener("change",function(e){var k=e.target.getAttribute&&e.target.getAttribute("data-vpaid");if(!k)return;if(e.target.checked)state.fl.vat.paid[k]=true;else delete state.fl.vat.paid[k];save();renderFl()});

function clientNames(){return state.fl.clients.slice().sort(function(a,b){return fold(a)<fold(b)?-1:fold(a)>fold(b)?1:0})}
var clEdit=null;
function stopCl(){clEdit=null;$("flcln").value="";$("flclb").textContent="Add client";$("flclc").hidden=true}
function renderClients(its){
  $("flclients").innerHTML=clientNames().map(function(n){return '<option value="'+esc(n)+'">'}).join("");
  var st2=clientStats(its,flYear),names=clientNames(),rows=[];
  names.forEach(function(n){rows.push({n:n,s:st2[n]||{n:0,net:0,pend:0,last:""},k:n})});
  if(st2[""]&&st2[""].n)rows.push({n:X("No client","Χωρίς πελάτη"),s:st2[""],k:"",fixed:true});
  if(!rows.length){$("flcll").innerHTML='<div class="empty">'+X("No clients yet. Add one above, or type a client name when you add an earning.","Δεν υπάρχουν πελάτες ακόμη. Προσθέστε έναν παραπάνω ή πληκτρολογήστε όνομα πελάτη όταν προσθέτετε έσοδο.")+'</div>';return}
  $("flcll").innerHTML=rows.map(function(r){var s=r.s,info;
    if(!s.n)info=X("No invoices in "+flYear,"Κανένα τιμολόγιο το "+flYear);
    else info=X(s.n+(s.n===1?" invoice":" invoices")+" · "+fmt(s.net)+" received"+(s.pend>0?" · "+fmt(s.pend)+" pending":"")+" · last "+dm(s.last),s.n+(s.n===1?" τιμολόγιο":" τιμολόγια")+" · εισπράχθηκαν "+fmt(s.net)+(s.pend>0?" · εκκρεμούν "+fmt(s.pend):"")+" · τελευταίο "+dm(s.last));
    var k=encodeURIComponent(r.k);
    return '<div class="cll"><div><b>'+esc(r.n)+'</b><small>'+info+'</small></div><span class="act"><button type="button" class="pill" data-clshow="'+k+'">'+X("Show","Εμφάνιση")+'</button>'+
      (r.fixed?'':'<button class="ed2" data-cled="'+k+'" aria-label="Edit">✎</button><button class="del" data-cldel="'+k+'" aria-label="Delete">✕</button>')+'</span></div>'}).join("")}
$("flclf").addEventListener("submit",function(e){e.preventDefault();var n=$("flcln").value.trim().slice(0,60);if(!n)return;
  var l=n.toLowerCase(),dup=state.fl.clients.some(function(c){return c.toLowerCase()===l&&c!==clEdit});
  if(dup){alert(X("A client with that name already exists.","Υπάρχει ήδη πελάτης με αυτό το όνομα."));return}
  if(clEdit){var old=clEdit;state.fl.clients=state.fl.clients.map(function(c){return c===old?n:c});state.fl.items.forEach(function(o){if(o.client===old)o.client=n});if(flClient===old)flClient=n}
  else state.fl.clients.push(n);
  stopCl();save();renderFl()});
$("flclc").addEventListener("click",stopCl);
$("flcll").addEventListener("click",function(e){var b;
  if(b=e.target.closest("[data-clshow]")){flClient=decodeURIComponent(b.getAttribute("data-clshow"));renderFl();var en=$("flen");if(en&&en.scrollIntoView)en.scrollIntoView({behavior:"smooth",block:"start"})}
  else if(b=e.target.closest("[data-cled]")){clEdit=decodeURIComponent(b.getAttribute("data-cled"));$("flcln").value=clEdit;$("flclb").textContent="Save";$("flclc").hidden=false;$("flcln").focus()}
  else if(b=e.target.closest("[data-cldel]")){var n=decodeURIComponent(b.getAttribute("data-cldel")),cnt=state.fl.items.filter(function(o){return o.client===n}).length;
    ask(X("Remove the client “"+n+"”?"+(cnt?" Its "+cnt+(cnt===1?" entry stays":" entries stay")+", without a client.":""),"Αφαίρεση του πελάτη «"+n+"»;"+(cnt?" "+(cnt===1?"Η καταχώρησή του μένει":"Οι "+cnt+" καταχωρήσεις του μένουν")+", χωρίς πελάτη.":"")),function(){
      state.fl.clients=state.fl.clients.filter(function(c){return c!==n});state.fl.items.forEach(function(o){if(o.client===n)o.client=""});if(flClient===n)flClient=null;if(clEdit===n)stopCl();save();renderFl()},{ok:X("Remove","Αφαίρεση")})}});
$("flfilt").addEventListener("click",function(e){if(e.target.closest("[data-flclear]")){flClient=null;renderFl()}});

var repM=null,repY=null;
function repNum(n){return (LANG==="el"?n.toFixed(2).replace(".",","):n.toFixed(2))}
function repBuild(its){var i=flYear*12+repM,R=flReport(its,i);return {i:i,R:R,vat:state.fl.vat.on}}
function renderRep(its){
  var ci=idxOf(today()),cy=Math.floor(ci/12);
  if(repY!==flYear||repM===null){repY=flYear;repM=null;
    if(flYear===cy)repM=ci%12;
    else{repM=11;for(var m=11;m>=0;m--){if(its.some(function(o){return idxOf(o.date)===flYear*12+m})){repM=m;break}}}}
  var sel=$("frm");
  if(sel.getAttribute("data-y")!==String(flYear)){var o="";for(var k=0;k<12;k++)o+='<option value="'+k+'">'+MN(flYear*12+k)+' '+flYear+'</option>';sel.innerHTML=o;sel.setAttribute("data-y",String(flYear))}
  sel.value=String(repM);
  var B=repBuild(its),R=B.R,vat=B.vat,f=fmt;
  var line=function(l,v,c){return '<div class="yb" style="margin:6px 0"><span>'+l+'</span><b'+(c?' class="'+c+'"':'')+'>'+v+'</b></div>'};
  var h='<div class="rth"><b>'+X("Freelancer report","Αναφορά ελεύθερου επαγγελματία")+'</b> · '+MNY(ymOf(B.i))+'</div>';
  if(!R.rows.length){$("frbody").innerHTML=h+'<div class="empty">'+X("No entries in this month.","Δεν υπάρχουν καταχωρήσεις αυτόν τον μήνα.")+'</div>';return}
  h+=line(vat?X("Earned (received, before VAT)","Εισπράχθηκαν (χωρίς ΦΠΑ)"):X("Earned (received)","Εισπράχθηκαν"),f(R.earn),"pos")+line(X("Pending invoices","Εκκρεμή τιμολόγια"),f(R.pend));
  if(vat)h+=line(X("VAT charged","ΦΠΑ που χρεώσατε"),f(R.vat))+line(X("Gross invoiced (with VAT)","Συνολικά τιμολογημένα (με ΦΠΑ)"),f(R.gross));
  h+=line(X("Expenses","Έξοδα"),f(R.exp),"neg");
  if(vat)h+=line(X("VAT on expenses (deductible)","ΦΠΑ εξόδων (εκπεστέο)"),f(R.inn))+line(X("VAT balance (charged − deductible)","Υπόλοιπο ΦΠΑ (χρεώσεις − εκπεστέο)"),f(r2(R.vat-R.inn)));
  h+=line(X("Profit","Κέρδος"),f(R.profit),R.profit<0?"neg":"pos");
  var cl=Object.keys(R.clients).sort(function(a,b){return R.clients[b].net-R.clients[a].net});
  if(cl.length){h+='<div class="ol">'+X("By client","Ανά πελάτη")+'</div><div class="rt-wrap"><table class="rt"><tr><th>'+X("Client","Πελάτης")+'</th><th>'+X("Invoices","Τιμολόγια")+'</th><th>'+X("Net","Καθαρό")+'</th>'+(vat?'<th>'+X("VAT","ΦΠΑ")+'</th><th>'+X("Gross","Μικτό")+'</th>':'')+'<th>'+X("Pending","Εκκρεμεί")+'</th></tr>'+
    cl.map(function(c){var e=R.clients[c];return '<tr><td>'+esc(c||X("No client","Χωρίς πελάτη"))+'</td><td>'+e.n+'</td><td>'+f(e.net)+'</td>'+(vat?'<td>'+f(e.vat)+'</td><td>'+f(e.gross)+'</td>':'')+'<td>'+f(e.pend)+'</td></tr>'}).join("")+'</table></div>'}
  var ct=Object.keys(R.cats).sort(function(a,b){return R.cats[b]-R.cats[a]});
  if(ct.length)h+='<div class="ol">'+X("Expenses by category","Έξοδα ανά κατηγορία")+'</div>'+ct.map(function(c){return line(esc(c||X("Other","Άλλο")),f(R.cats[c]))}).join("");
  $("frbody").innerHTML=h}
$("frm").addEventListener("change",function(){repM=+this.value;renderRep(flLive())});
function repText(){var B=repBuild(flLive()),R=B.R,vat=B.vat,f=function(n){return fmt(n)},t=[];
  t.push("Cent-aur · "+X("Freelancer report","Αναφορά ελεύθερου επαγγελματία")+" · "+MNY(ymOf(B.i)));t.push("");
  t.push(X("Earned (received): ","Εισπράχθηκαν: ")+f(R.earn));t.push(X("Pending invoices: ","Εκκρεμή τιμολόγια: ")+f(R.pend));
  if(vat){t.push(X("VAT charged: ","ΦΠΑ που χρεώσατε: ")+f(R.vat));t.push(X("Gross invoiced: ","Συνολικά τιμολογημένα: ")+f(R.gross))}
  t.push(X("Expenses: ","Έξοδα: ")+f(R.exp));if(vat){t.push(X("VAT on expenses (deductible): ","ΦΠΑ εξόδων (εκπεστέο): ")+f(R.inn));t.push(X("VAT balance: ","Υπόλοιπο ΦΠΑ: ")+f(r2(R.vat-R.inn)))}
  t.push(X("Profit: ","Κέρδος: ")+f(R.profit));
  var cl=Object.keys(R.clients);if(cl.length){t.push("");t.push(X("By client:","Ανά πελάτη:"));cl.sort(function(a,b){return R.clients[b].net-R.clients[a].net}).forEach(function(c){var e=R.clients[c];t.push("- "+(c||X("No client","Χωρίς πελάτη"))+": "+e.n+" · "+f(e.net)+(vat?" + "+f(e.vat)+" = "+f(e.gross):"")+(e.pend>0?" · "+X("pending ","εκκρεμεί ")+f(e.pend):""))})}
  return t.join("\n")}
function repCSV(){var B=repBuild(flLive()),R=B.R,sep=LANG==="el"?";":",";
  var c=function(v){v=String(v==null?"":v);return (v.indexOf(sep)>=0||/["\n\r]/.test(v))?'"'+v.replace(/"/g,'""')+'"':v};
  var rows=[[X("Date","Ημερομηνία"),X("Type","Τύπος"),X("Client","Πελάτης"),X("Description","Περιγραφή"),X("Category","Κατηγορία"),X("Net","Καθαρό"),X("VAT rate %","Συντελεστής ΦΠΑ %"),X("VAT","ΦΠΑ"),X("Gross","Μικτό"),X("Status","Κατάσταση")]];
  R.rows.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0}).forEach(function(o){var out=o.type==="out";
    rows.push([dmy(o.date),out?X("Expense","Έξοδο"):X("Earning","Έσοδο"),o.client||"",o.name||"",o.cat||"",repNum(flNet(o)),String(o.vr||0).replace(".",LANG==="el"?",":"."),repNum(flVatOf(o)),repNum(flGross(o)),out?(o.vd===false?X("Expense (VAT not deductible)","Έξοδο (ΦΠΑ μη εκπεστέο)"):X("Expense","Έξοδο")):(o.paid?X("Received","Εισπράχθηκε"):X("Pending","Εκκρεμεί"))])});
  return "﻿"+rows.map(function(r){return r.map(c).join(sep)}).join("\r\n")}
$("frc").addEventListener("click",function(){var t=repText(),b=this,old=b.textContent;
  function done(){b.textContent=X("Copied!","Αντιγράφηκε!");setTimeout(function(){b.textContent=old},1800)}
  function fb(){var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove();done()}
  try{navigator.clipboard.writeText(t).then(done,fb)}catch(e){fb()}});
$("frd").addEventListener("click",function(){var B=repBuild(flLive()),a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([repCSV()],{type:"text/csv;charset=utf-8"}));a.download="cent-aur-report-"+ymOf(B.i)+".csv";document.body.appendChild(a);a.click();a.remove()});
$("frp").addEventListener("click",function(){document.body.classList.add("printrep");
  var off=function(){document.body.classList.remove("printrep");window.removeEventListener("afterprint",off)};
  window.addEventListener("afterprint",off);
  try{window.print()}catch(e){off()}
  setTimeout(function(){document.body.classList.remove("printrep")},60000)});

/* ---- merchants: name suggestions, auto category, logos ---- */
var catTouched=false,acItems=[],acI=-1,exactKey=null;
// the category of a name typed in full: the one last saved with it, an earlier expense with that name, or the merchant's
function exactCat(name){var k=nrm(name);if(k.length<2)return null;
  var l=state.learn&&state.learn[k];if(l&&catOf(l.c))return l.c;
  var c=null,last="";state.items.forEach(function(it){if(nrm(it.name)===k&&k!==nrm(it.cat)&&catOf(it.cat)&&it.date>=last){last=it.date;c=it.cat}});if(c)return c;
  var m=mOf(name);return m&&(nrm(m.en)===k||nrm(m.el)===k)&&catOf(m.cat)?m.cat:null}
function showSug(s){var el=$("msug");if(!el)return;
  if(!s||(!s.cat&&!s.mer)){el.hidden=true;el.innerHTML="";return}
  var h='';if(s.mer)h+=(s.mer.logo?logoTile(s.mer.logo):"")+'<b data-notr>'+esc(mName(s.mer))+'</b>';
  if(s.cat)h+=(h?' · ':'')+X("Suggested category: ","Προτεινόμενη κατηγορία: ")+'<b>'+esc(s.cat)+'</b>';
  el.innerHTML=h;el.hidden=false}
function acBuild(q){var nq=nrm(q);if(!nq)return [];var out=[],seen={},past={};
  state.items.forEach(function(it){var k=nrm(it.name);if(!k||k===nrm(it.cat))return;var e=past[k]||(past[k]={label:it.name,cat:it.cat,n:0,last:""});e.n++;if(it.date>=e.last){e.last=it.date;e.label=it.name;e.cat=it.cat}});
  Object.keys(past).filter(function(k){return k!==nq&&(k.indexOf(nq)===0||(nq.length>=2&&k.indexOf(" "+nq)>=0))}).sort(function(a,b){var pa=a.indexOf(nq)===0?0:1,pb=b.indexOf(nq)===0?0:1;return pa-pb||past[b].n-past[a].n||(past[b].last<past[a].last?-1:1)})
    .slice(0,6).forEach(function(k){out.push({label:past[k].label,cat:past[k].cat});seen[k]=1});
  if(!MIDX)mBuild();var hit={};
  MIDX.forEach(function(e){if(hit[e[1]])return;var a=e[0];if(a.indexOf(nq)===0||(nq.length>=2&&a.indexOf(" "+nq)>=0))hit[e[1]]=1});
  mCustomKeys().forEach(function(k){var a=nrm(state.mer[k].n);if(a.indexOf(nq)===0||(nq.length>=2&&a.indexOf(" "+nq)>=0))hit[k]=1});
  var keys=MERCH_SRC.map(function(r){return r.split("|")[0]}).concat(mCustomKeys()).filter(function(k){return hit[k]});
  keys.forEach(function(k){var m=mGet(k);if(!m)return;var l=mName(m),nl=nrm(l);if(nl===nq||seen[nl]||seen[nrm(m.en)]||seen[nrm(m.el)])return;seen[nl]=1;out.push({label:l,cat:catOf(m.cat)?m.cat:null})});
  return out.slice(0,6)}
function acHide(){var l=$("acl");if(!l)return;l.hidden=true;l.innerHTML="";acItems=[];acI=-1;$("name").setAttribute("aria-expanded","false")}
function acRender(q){acItems=acBuild(q);acI=-1;var l=$("acl");
  if(!acItems.length){acHide();return}
  l.innerHTML=acItems.map(function(e,i){var m=mOf(e.label);return '<li role="option" id="aco'+i+'" data-i="'+i+'" aria-selected="false">'+(m&&m.logo?logoTile(m.logo):(e.cat?ic(e.cat):""))+'<span>'+esc(e.label)+'</span>'+(e.cat?'<small>'+esc(e.cat)+'</small>':'')+'</li>'}).join("");
  l.hidden=false;$("name").setAttribute("aria-expanded","true")}
function acMark(i){acI=i;Array.prototype.forEach.call($("acl").children,function(li,j){li.setAttribute("aria-selected",String(j===i))});
  if(i>=0){var li=$("acl").children[i];li.scrollIntoView&&li.scrollIntoView({block:"nearest"});$("name").setAttribute("aria-activedescendant","aco"+i)}else $("name").removeAttribute("aria-activedescendant")}
function acPick(i){var e=acItems[i];if(!e)return;var nm=$("name");nm.value=e.label;delete nm.dataset.auto;
  if(e.cat&&catOf(e.cat)&&!editing){$("cat").value=e.cat;syncCat()}
  exactKey=nrm(e.label);acHide();if(!editing)showSug(sugOf(e.label));$("amt").focus()}
$("name").addEventListener("input",function(){var v=this.value;acRender(v);if(editing){showSug(null);return}
  var sg=sugOf(v);showSug(sg);var ex=exactCat(v),k=nrm(v);
  // a full name picks its category even after the user chose one, but only once, so they can still change it afterwards
  if(ex){if(k!==exactKey){exactKey=k;if($("cat").value!==ex){$("cat").value=ex;syncCat()}}return}
  exactKey=null;if(sg&&sg.cat&&!catTouched&&$("cat").value!==sg.cat){$("cat").value=sg.cat;syncCat()}});
$("name").addEventListener("keydown",function(e){if($("acl").hidden)return;
  if(e.key==="ArrowDown"){e.preventDefault();acMark(Math.min(acI+1,acItems.length-1))}
  else if(e.key==="ArrowUp"){e.preventDefault();acMark(Math.max(acI-1,-1))}
  else if(e.key==="Enter"&&acI>=0){e.preventDefault();acPick(acI)}
  else if(e.key==="Escape"){e.stopPropagation();acHide()}});
$("name").addEventListener("blur",function(){setTimeout(acHide,150)});
$("acl").addEventListener("mousedown",function(e){var li=e.target.closest("li");if(!li)return;e.preventDefault();acPick(+li.dataset.i)});
// By category chips: click a merchant to show only its expenses
document.addEventListener("click",function(e){var b=e.target.closest("[data-mq]");if(!b)return;var m=mGet(b.getAttribute("data-mq"));if(!m)return;
  var q=$("q");q.value=mName(m);clearTimeout(qT);setQ(q.value);try{q.scrollIntoView({behavior:"smooth",block:"center"})}catch(x){}});

/* merchant manager: logos, own merchants, scan existing expenses */
var mrKey=null;
function mrLabels(){var b=$("mrt");if(!b)return;b.textContent=X("Merchants","Καταστήματα");
  $("mrh").textContent=X("Expenses whose name matches a merchant show its logo instead of the category icon. Without a logo, the category icon is shown. The expense still counts in its category.","Τα έξοδα με όνομα που ταιριάζει σε κατάστημα δείχνουν το λογότυπό του αντί για το εικονίδιο της κατηγορίας. Χωρίς λογότυπο εμφανίζεται το εικονίδιο της κατηγορίας. Το έξοδο εξακολουθεί να υπολογίζεται στην κατηγορία του.");
  $("mrq").placeholder=X("Search a merchant, or type a new name","Αναζήτηση καταστήματος ή νέο όνομα");
  $("mrscan").textContent=X("Categorize existing expenses","Κατηγοριοποίηση υπαρχόντων εξόδων");
  if(!$("mrp").hidden)mrRender()}
function mrRender(){var q=$("mrq").value,nq=nrm(q),keys=[],used={};
  state.items.forEach(function(it){var m=mOf(it.name);if(m)used[m.key]=(used[m.key]||0)+1});
  if(!nq){keys=Object.keys(used).sort(function(a,b){return used[b]-used[a]});mCustomKeys().forEach(function(k){if(keys.indexOf(k)<0)keys.push(k)})}
  else{if(!MIDX)mBuild();var hit={};MIDX.forEach(function(e){if(!hit[e[1]]&&(e[0].indexOf(nq)===0||e[0].indexOf(" "+nq)>=0))hit[e[1]]=1});
    mCustomKeys().forEach(function(k){if(nrm(state.mer[k].n).indexOf(nq)>=0)hit[k]=1});
    keys=MERCH_SRC.map(function(r){return r.split("|")[0]}).concat(mCustomKeys()).filter(function(k){return hit[k]})}
  var h=keys.slice(0,30).map(function(k){var m=mGet(k);if(!m)return"";
    return '<div class="mrr" data-k="'+esc(k)+'">'+(m.logo?logoTile(m.logo):ic(m.cat))+'<div><b data-notr>'+esc(mName(m))+'</b><small>'+esc(m.cat)+(used[k]?' · '+used[k]+(used[k]===1?X(" expense"," έξοδο"):X(" expenses"," έξοδα")):'')+'</small></div><span class="act"><button type="button" class="pill" data-ml="up">'+(m.logo?X("Change logo","Αλλαγή λογοτύπου"):X("Upload logo","Μεταφόρτωση λογοτύπου"))+'</button>'+(m.logo?'<button type="button" class="pill" data-ml="rm">'+X("Remove logo","Αφαίρεση")+'</button>':'')+(m.custom?'<button type="button" class="del" data-ml="del" aria-label="'+esc(X("Delete merchant","Διαγραφή καταστήματος"))+'">✕</button>':'')+'</span></div>'}).join("");
  if(!keys.length&&!nq)h='<div class="hint">'+X("Merchants from your expenses appear here. Search above to add a logo for any merchant.","Τα καταστήματα από τα έξοδά σας εμφανίζονται εδώ. Αναζητήστε παραπάνω για να προσθέσετε λογότυπο.")+'</div>';
  if(nq&&!keys.some(function(k){var m=mGet(k);return m&&nrm(mName(m))===nq})){var sg=sugOf(q),dc=sg&&sg.cat?sg.cat:"Other";
    h+='<div class="mrr"><div><b data-notr>'+esc(q.trim())+'</b><small>'+X("Add as a new merchant in","Προσθήκη ως νέο κατάστημα στην κατηγορία")+'</small></div><span class="act"><select id="mrnc" aria-label="Category">'+state.cats.map(function(c){return '<option value="'+esc(c.name)+'"'+(c.name===dc?' selected':'')+'>'+esc(c.name)+'</option>'}).join("")+'</select><button type="button" class="pill" data-ml="new">'+X("Add","Προσθήκη")+'</button></span></div>'}
  $("mrl").innerHTML=h}
function logoFromFile(f,cb){if(!f||!/^image\//.test(f.type)){cb(null);return}
  var fr=new FileReader();fr.onerror=function(){cb(null)};
  fr.onload=function(){var im=new Image();im.onerror=function(){cb(null)};
    im.onload=function(){try{var S=128,c=document.createElement("canvas");c.width=c.height=S;var g=c.getContext("2d"),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;if(!w||!h){cb(null);return}
      var k=Math.min(S/w,S/h),dw=Math.round(w*k),dh=Math.round(h*k);g.drawImage(im,Math.round((S-dw)/2),Math.round((S-dh)/2),dw,dh);
      var u=c.toDataURL("image/png");if(u.length>90000){var u2=c.toDataURL("image/webp",.85);if(/^data:image\/webp/.test(u2)&&u2.length<u.length)u=u2}
      cb(u.length<=100000&&/^data:image\/(png|webp);base64,/.test(u)?u:null)}catch(e){cb(null)}};im.src=fr.result};fr.readAsDataURL(f)}
$("mrt").addEventListener("click",function(){var p=$("mrp");p.hidden=!p.hidden;if(!p.hidden){mrLabels();mrRender()}});
$("mrq").addEventListener("input",mrRender);
$("mrl").addEventListener("click",function(e){var b=e.target.closest("[data-ml]");if(!b)return;var row=b.closest("[data-k]"),k=row&&row.getAttribute("data-k"),a=b.getAttribute("data-ml");
  if(a==="up"){mrKey=k;$("mrf").click();return}
  if(a==="rm"){var c=state.mer[k];if(c){delete c.logo;if(!c.u)delete state.mer[k]}mClear();save();render();mrRender();return}
  if(a==="del"){ask(X("Delete this merchant? Your expenses are kept.","Διαγραφή αυτού του καταστήματος; Τα έξοδά σας διατηρούνται."),function(){delete state.mer[k];mClear();save();render();mrRender()},{ok:X("Delete","Διαγραφή")});return}
  if(a==="new"){var nm=$("mrq").value.trim().slice(0,40),cat=$("mrnc").value;if(!nm||Object.keys(state.mer).length>=300)return;
    var key="u_"+(nrm(nm).replace(/[^a-z0-9]+/g,"_").slice(0,20)||"m")+"_"+Math.random().toString(36).slice(2,6);
    state.mer[key]={u:1,n:nm,c:cat};mClear();save();render();$("mrq").value="";mrRender()}});
$("mrf").addEventListener("change",function(){var f=this.files[0],k=mrKey;this.value="";if(!f||!k)return;
  logoFromFile(f,function(u){if(!u){alert(X("That image could not be used. Try a PNG, JPG or SVG file.","Δεν ήταν δυνατή η χρήση της εικόνας. Δοκιμάστε αρχείο PNG, JPG ή SVG."));return}
    if(!state.mer[k]){if(Object.keys(state.mer).length>=300){alert(X("Too many merchant logos.","Πάρα πολλά λογότυπα."));return}state.mer[k]={}}
    state.mer[k].logo=u;mClear();save();render();mrRender()})});
$("mrscan").addEventListener("click",function(){var box=$("mrs"),rows=[];
  state.items.forEach(function(it){if(it.cat!=="Other")return;var s=sugOf(it.name);if(s&&s.cat&&s.cat!=="Other")rows.push({it:it,cat:s.cat})});
  box.hidden=false;
  if(!rows.length){box.innerHTML='<div class="hint">'+X("Nothing to change: no expense in “Other” matches a known merchant or keyword.","Δεν υπάρχει κάτι προς αλλαγή: κανένα έξοδο στην κατηγορία «Other» δεν ταιριάζει με γνωστό κατάστημα ή λέξη.")+'</div>';return}
  box.innerHTML='<div class="hint">'+X("Move these expenses to the suggested category?","Να μετακινηθούν αυτά τα έξοδα στην προτεινόμενη κατηγορία;")+'</div>'+rows.map(function(r,i){return '<label><input type="checkbox" checked data-si="'+i+'"> <span><b data-notr>'+esc(r.it.name)+'</b> · Other → '+esc(r.cat)+'</span></label>'}).join("")+'<div class="data" style="margin-top:8px"><button type="button" class="primary" id="mrapply">'+X("Apply","Εφαρμογή")+'</button><button type="button" class="ghost" id="mrcancel">'+X("Cancel","Άκυρο")+'</button></div>';
  box._rows=rows});
$("mrs").addEventListener("click",function(e){var box=this;
  if(e.target.id==="mrcancel"){box.hidden=true;return}
  if(e.target.id==="mrapply"){var n=0;Array.prototype.forEach.call(box.querySelectorAll("[data-si]"),function(c){if(!c.checked)return;var r=box._rows[+c.getAttribute("data-si")];if(r&&catOf(r.cat)){r.it.cat=r.cat;n++}});
    box.hidden=true;if(n){save();render();say(X("Moved "+n+(n===1?" expense":" expenses"),"Μετακινήθηκαν "+n+(n===1?" έξοδο":" έξοδα")))}}});

/* ---- clicks added in v51 (tags, recurring buttons) ---- */
document.addEventListener("click",function(e){var t=e.target,x;
  if(x=t.closest("[data-tg]")){toggleTag(x.getAttribute("data-tg"));return}
  if(x=t.closest("[data-rp]")){recAct(x.getAttribute("data-rp"),x.getAttribute("data-id"))}});
document.addEventListener("toggle",function(e){var d=e.target;if(!d||d.tagName!=="DETAILS")return;
  if(d.id==="recd"){openD.rec=d.open;if(d.open)renderRec();return}
  var k=d.dataset&&d.dataset.k;if(!k)return;openD[k]=d.open;
  if(d.open&&LAZY[k]){var box=d.querySelector('[data-lz="'+k+'"]');if(box&&!box.firstChild)box.innerHTML=LAZY[k]()}},true);


/* ===== merge backup + spending chart ===== */
function sigOf(o){return [o.date||"",(+o.amt||0).toFixed(2),String(o.name||o.label||o.reason||o.desc||o.client||"").toLowerCase(),o.cat||o.type||""].join("|")}
function mergeList(mine,theirs){var ids={},sg={},add=0;mine.forEach(function(o){ids[o.id]=1;sg[sigOf(o)]=1});
  theirs.forEach(function(o){if(!o||ids[o.id]||sg[sigOf(o)])return;mine.push(o);ids[o.id]=1;sg[sigOf(o)]=1;add++});return add}
function mergeData(d){
  if(!d||!Array.isArray(d.items))return null;
  var o=norm(JSON.parse(JSON.stringify(d))),n=0,names={};
  state.cats.forEach(function(c){names[c.name.toLowerCase()]=1});
  o.cats.forEach(function(c){if(!names[c.name.toLowerCase()]){state.cats.push(c);names[c.name.toLowerCase()]=1}});
  n+=mergeList(state.items,o.items);
  var ex=mergeList(state.oneoff,o.oneoff)+mergeList(state.withdraw,o.withdraw);
  var gn={};state.goals.forEach(function(g){gn[g.id]=1;gn[g.name.toLowerCase()]=1});
  var go=0;o.goals.forEach(function(g){if(!gn[g.id]&&!gn[g.name.toLowerCase()]&&state.goals.length<200){state.goals.push(g);go++}});
  var fl=0;if(o.fl){fl=mergeList(state.fl.items,o.fl.items||[]);
    var cn={};state.fl.clients.forEach(function(c){cn[c.toLowerCase()]=1});(o.fl.clients||[]).forEach(function(c){if(!cn[c.toLowerCase()]&&state.fl.clients.length<500){state.fl.clients.push(c);cn[c.toLowerCase()]=1}})}
  if(o.budgets&&typeof o.budgets==="object")Object.keys(o.budgets).forEach(function(k){if(!(k in state.budgets))state.budgets[k]=o.budgets[k]});
  if(o.mer)Object.keys(o.mer).forEach(function(k){if(!(k in state.mer)&&Object.keys(state.mer).length<300)state.mer[k]=o.mer[k]});
  if(o.learn)Object.keys(o.learn).forEach(function(k){if(!(k in state.learn))state.learn[k]=o.learn[k]});mClear();
  return {items:n,extra:ex,goals:go,fl:fl}}
$("mg").addEventListener("click",function(){$("mgf").click()});
$("mgf").addEventListener("change",function(){
  var f=this.files[0];this.value="";if(!f)return;
  f.text().then(function(t){var r;try{r=mergeData(JSON.parse(t))}catch(e){r=null}
    if(!r){alert("That file isn’t a Cent-aur backup.");return}
    var tot=r.items+r.extra+r.goals+r.fl;
    if(tot){save();applyData(state);setTimeout(function(){say("Merged "+r.items+(r.items===1?" expense, ":" expenses, ")+(r.extra+r.goals+r.fl)+((r.extra+r.goals+r.fl)===1?" other entry":" other entries"))},400)}
    else say("Nothing new to merge")})});

var trY=null,trSel=null,TR3_EN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],TR3_EL=["Ιαν","Φεβ","Μαρ","Απρ","Μάι","Ιουν","Ιουλ","Αυγ","Σεπ","Οκτ","Νοε","Δεκ"];
function trAxis(v){return v>=1000?(Math.round(v/100)/10)+"k":String(Math.round(v))}
function trNice(m){if(m<=0)return 100;var p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function trCats(i){var by={},ls=LS().items;for(var k=0;k<ls.length;k++){var a=monthAmt(ls[k],i);if(a>0){var c=catOf(ls[k].cat),g=(c&&c.group)||ls[k].cat;by[g]=(by[g]||0)+a}}
  return Object.keys(by).map(function(k){return {n:k,v:by[k]}}).sort(function(a,b){return b.v-a.v})}
function trDetail(i){
  var el=$("trd");if(!el)return;var S=LS(),sp=sumM(i),b=budgetOf(S,i),t=X,mn=LANG==="el"?EL_M[i%12]:MN(i),y=Math.floor(i/12),h='<b>'+esc(mn+" "+y)+'</b> — ';
  h+=t("spent ","ξοδέψατε ")+'<b>'+fmt(sp)+'</b>';
  if(b>0){var d=sp-b;h+=t(" of "," από ")+fmt(b)+t(" budget"," προϋπολογισμό")+' (<span class="'+(d>0?'up':'dn')+'">'+fmt(Math.abs(d))+(d>0?t(" over"," πάνω"):t(" under"," κάτω"))+'</span>)'}
  var pv=sumM(i-1);
  if(pv>0&&sp>0){var df=sp-pv,pc=Math.round(Math.abs(df)/pv*100);if(pc>0)h+='<br>'+(df>0?'<span class="up">▲ ':'<span class="dn">▼ ')+fmt(Math.abs(df))+' ('+pc+'%)</span> '+t("vs ","σε σχέση με ")+esc(LANG==="el"?EL_M[(i-1+120000)%12].slice(0,-1):MN(i-1))}
  var cs=trCats(i).slice(0,3);if(cs.length)h+='<br>'+t("Biggest: ","Μεγαλύτερα: ")+cs.map(function(c){return esc(c.n)+' '+fmt(c.v)}).join(' · ');
  if(!sp)h+='<br>'+t("No expenses in this month.","Δεν υπάρχουν έξοδα αυτόν τον μήνα.");
  el.innerHTML=h}
function trPick(i){trSel=i;var g=document.querySelector("#trc .guide"),s=document.querySelector("#trc .trsvg");
  if(g&&s){var x=+s.querySelector('.hit[data-m="'+(i%12)+'"]').getAttribute("data-cx");g.setAttribute("x1",x);g.setAttribute("x2",x);g.style.opacity=.35}trDetail(i)}
function renderTrend(){
  var box=$("trc");if(!box||state.simple)return;
  var t=X,cur=idxOf(today()),S=LS(),Y=trY==null?Math.floor(cur/12):trY,type=state.trend==="bar"?"bar":"line";
  var sp=[],bu=[],mx=0,i,m;
  for(m=0;m<12;m++){i=Y*12+m;sp.push(sumM(i));bu.push(budgetOf(S,i));mx=Math.max(mx,sp[m],bu[m])}
  var stp=trNice(mx*1.05/4),nt=Math.max(1,Math.ceil(mx*1.05/stp)),top=stp*nt,W=600,H=210,ml=40,mr=8,mt=10,mb=24,pw=W-ml-mr,ph=H-mt-mb,sl=pw/12;
  function X_(m){return ml+sl*(m+.5)}function Y_(v){return mt+ph-(v/top)*ph}
  var sv='<svg class="trsvg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(t("Spending by month, ","Έξοδα ανά μήνα, ")+Y)+'">';
  for(var k=0;k<=nt;k++){var v=stp*k,y=Y_(v);sv+='<line class="gl" x1="'+ml+'" x2="'+(W-mr)+'" y1="'+y+'" y2="'+y+'"/><text x="'+(ml-6)+'" y="'+(y+4)+'" text-anchor="end">'+trAxis(v)+'</text>'}
  var TR3=LANG==="el"?TR3_EL:TR3_EN;
  for(m=0;m<12;m++){var cm=Y*12+m===cur;sv+='<text class="'+(cm?'cur':'')+'" x="'+X_(m)+'" y="'+(H-7)+'" text-anchor="middle">'+TR3[m]+'</text>'}
  var bd=bu.some(function(v){return v>0});
  if(bd){var p="";for(m=0;m<12;m++){if(bu[m]>0){var yy=Y_(bu[m]);p+=(p&&bu[m-1]>0?"L":"M")+(ml+sl*m)+" "+yy+"L"+(ml+sl*(m+1))+" "+yy}}sv+='<path class="bud" d="'+p+'"/>'}
  var hasOver=false;
  if(type==="bar"){var bw=Math.min(34,sl*.62);
    for(m=0;m<12;m++){if(sp[m]<=0)continue;var h=Math.max(2,(sp[m]/top)*ph),ov=bu[m]>0&&sp[m]>bu[m];if(ov)hasOver=true;
      sv+='<path class="bar'+(ov?' ov':'')+(Y*12+m>cur?' pj':'')+'" d="M'+(X_(m)-bw/2)+' '+(mt+ph)+'V'+(mt+ph-h+4)+'Q'+(X_(m)-bw/2)+' '+(mt+ph-h)+' '+(X_(m)-bw/2+4)+' '+(mt+ph-h)+'H'+(X_(m)+bw/2-4)+'Q'+(X_(m)+bw/2)+' '+(mt+ph-h)+' '+(X_(m)+bw/2)+' '+(mt+ph-h+4)+'V'+(mt+ph)+'Z"/>'}}
  else{var seg="",segP="",last=-1;
    for(m=0;m<12;m++){var fut=Y*12+m>cur,pt=X_(m)+" "+Y_(sp[m]);
      if(!fut){seg+=(seg?"L":"M")+pt;last=m}
      else if(sp[m]>0){if(!segP){segP=last>=0?"M"+X_(last)+" "+Y_(sp[last])+"L"+pt:"M"+pt}else segP+="L"+pt}}
    if(seg)sv+='<path class="ln" d="'+seg+'"/>';if(segP)sv+='<path class="ln pj" d="'+segP+'"/>';
    for(m=0;m<12;m++){var f2=Y*12+m>cur,ov2=!f2&&bu[m]>0&&sp[m]>bu[m];if(ov2)hasOver=true;if(sp[m]<=0&&f2)continue;
      sv+='<circle class="pt'+(ov2?' ov':'')+(f2?' pj':'')+'" cx="'+X_(m)+'" cy="'+Y_(sp[m])+'" r="4"/>'}}
  sv+='<line class="guide" x1="0" x2="0" y1="'+mt+'" y2="'+(mt+ph)+'"/>';
  for(m=0;m<12;m++){sv+='<rect class="hit" data-m="'+m+'" data-cx="'+X_(m)+'" x="'+(ml+sl*m)+'" y="'+mt+'" width="'+sl+'" height="'+ph+'" tabindex="0" role="button" aria-label="'+esc((LANG==="el"?EL_M[m]:MN(Y*12+m))+": "+fmt(sp[m]))+'"/>'}
  sv+='</svg>';
  var hd='<div class="trh"><span class="yr"><button type="button" data-try="-1" aria-label="'+t("Previous year","Προηγούμενο έτος")+'">◀</button>'+Y+'<button type="button" data-try="1" aria-label="'+t("Next year","Επόμενο έτος")+'">▶</button></span>'+
    '<span class="seg"><button type="button" data-trt="line" aria-pressed="'+(type==="line")+'">'+t("Line","Γραμμή")+'</button><button type="button" data-trt="bar" aria-pressed="'+(type==="bar")+'">'+t("Bars","Μπάρες")+'</button></span></div>';
  var lg='<div class="trleg"><span><i></i>'+t("Spent","Έξοδα")+'</span>'+(bd?'<span><i class="b"></i>'+t("Budget","Προϋπολογισμός")+'</span>':'')+(hasOver?'<span><i class="o"></i>'+t("Over budget","Πάνω από τον προϋπολογισμό")+'</span>':'')+'</div>';
  var tb='<details class="trtab"><summary>'+t("Show as table","Εμφάνιση ως πίνακα")+'</summary><table><thead><tr><th>'+t("Month","Μήνας")+'</th><th>'+t("Spent","Έξοδα")+'</th><th>'+t("Budget","Προϋπολογισμός")+'</th></tr></thead><tbody>';
  for(m=0;m<12;m++)tb+='<tr><td>'+esc(LANG==="el"?EL_M[m]:MN(Y*12+m))+'</td><td>'+fmt(sp[m])+'</td><td>'+(bu[m]>0?fmt(bu[m]):"–")+'</td></tr>';
  tb+='</tbody></table></details>';
  var any=sp.some(function(v){return v>0});
  box.innerHTML=hd+(any||bd?lg+sv+'<div class="trd" id="trd" aria-live="polite"></div>'+tb:'<div class="empty">'+t("Add some expenses to see how your spending changes month to month.","Προσθέστε έξοδα για να δείτε πώς αλλάζουν οι δαπάνες σας από μήνα σε μήνα.")+'</div>');
  if(any||bd){var pick=trSel!=null&&Math.floor(trSel/12)===Y?trSel:(Y===Math.floor(cur/12)?cur:Y*12+11);trPick(pick)}}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("#trc [data-try],#trc [data-trt],#trc .hit");if(!b)return;
  if(b.hasAttribute("data-try")){var c=trY==null?Math.floor(idxOf(today())/12):trY;trY=c+ +b.getAttribute("data-try");trSel=null;renderTrend()}
  else if(b.hasAttribute("data-trt")){state.trend=b.getAttribute("data-trt");save();renderTrend()}
  else{var Y=trY==null?Math.floor(idxOf(today())/12):trY;trPick(Y*12+ +b.getAttribute("data-m"))}});
document.addEventListener("mouseover",function(e){var b=e.target.closest&&e.target.closest("#trc .hit");if(b){var Y=trY==null?Math.floor(idxOf(today())/12):trY;trPick(Y*12+ +b.getAttribute("data-m"))}});
document.addEventListener("focusin",function(e){var b=e.target.classList&&e.target.classList.contains("hit")&&e.target.closest("#trc");if(b){var Y=trY==null?Math.floor(idxOf(today())/12):trY;trPick(Y*12+ +e.target.getAttribute("data-m"))}});

/* ===== View (optional cards) + What if ===== */
function applyView(){if(!document.querySelector)return;var sh=state.show||{};
  VIEWS.forEach(function(k){var sl=document.querySelector('.slot[data-card="'+k+'"]');if(sl)sl.hidden=sh[k]===false});
  var vis=function(id){return Array.prototype.some.call($(id).children,function(c){return c.classList.contains("slot")&&!c.hidden})};
  document.body.classList.toggle("nL",!vis("colL"));document.body.classList.toggle("nR",!vis("colR"));
  Array.prototype.forEach.call(document.querySelectorAll("#viewp [data-view]"),function(c){c.checked=sh[c.getAttribute("data-view")]!==false});
  var n=VIEWS.filter(function(k){return sh[k]===false}).length;$("viewb").classList.toggle("on",n>0)}
function viewOpen(v){var p=$("viewp");p.hidden=!v;$("viewb").setAttribute("aria-expanded",String(v));if(v){$("opt").hidden=true;$("gear").setAttribute("aria-expanded","false")}}
$("viewb").addEventListener("click",function(e){e.stopPropagation();viewOpen($("viewp").hidden)});
$("viewx").addEventListener("click",function(){viewOpen(false)});
// phones: Simple, View, Edit and Settings sit behind the ⋯ button; picking one closes the menu
function moreOpen(v){$("hmw").classList.toggle("open",v);$("hmb").setAttribute("aria-expanded",String(v))}
$("hmb").addEventListener("click",function(e){e.stopPropagation();var v=!$("hmw").classList.contains("open");moreOpen(v);if(v)$("simpleb").focus()});
var hmLast=null;$("hmw").addEventListener("click",function(e){hmLast=e.target.closest("button");moreOpen(false)},true);
document.addEventListener("click",function(e){if($("hmw").classList.contains("open")&&!e.target.closest("#hmw")&&!e.target.closest("#hmb"))moreOpen(false)});
document.addEventListener("keydown",function(e){if(e.key!=="Escape")return;
  if($("hmw").classList.contains("open")){moreOpen(false);$("hmb").focus();return}
  // a panel opened from the menu hands focus back to a button that is now hidden: give it to ⋯ instead
  setTimeout(function(){var a=document.activeElement;
    if(hmLast&&$("hmb").offsetParent&&(!a||a===document.body||(a.closest&&a.closest("#hmw"))))$("hmb").focus();hmLast=null},0)});
$("gear").addEventListener("click",function(){if(!$("opt").hidden)viewOpen(false)});
document.addEventListener("click",function(e){if(!$("viewp").hidden&&!e.target.closest("#viewp")&&!e.target.closest("#viewb"))viewOpen(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("viewp").hidden){viewOpen(false);$("viewb").focus()}});
$("viewp").addEventListener("change",function(e){var c=e.target.closest("[data-view]");if(!c)return;var k=c.getAttribute("data-view");
  state.show=state.show||{};if(c.checked)delete state.show[k];else state.show[k]=false;save();applyView();render()});

var wiP={};
function wiRows(){var cur=idxOf(today()),out=[],S=LS();
  S.items.forEach(function(it){if(it.freq>0&&dueIn(it,cur)){var m=monthAmt(it,cur);if(m>0)out.push({k:it.id,n:it.name,m:m,id:it.id})}});
  S.cats.forEach(function(c){if(!c.bill)return;var l=lastOf(c.name);if(l&&l.amt>0)out.push({k:"b:"+c.name,n:c.name,m:l.amt/(c.every||1),bill:1})});
  out.sort(function(a,b){return b.m-a.m});return out.slice(0,8)}
function wiTotals(rows){var sv=0,tot=0;rows.forEach(function(r){var p=wiP[r.k]||0;sv+=r.m*p/100});tot=sumM(idxOf(today()));return {sv:sv,tot:tot}}
function wiSumHTML(rows){var T=wiTotals(rows),t=X;
  if(T.sv<=0)return t("Drag a slider to see what you would save by cutting an expense. Nothing changes until you press Apply.","Σύρετε ένα ρυθμιστικό για να δείτε πόσα θα εξοικονομούσατε περικόπτοντας ένα έξοδο. Τίποτα δεν αλλάζει μέχρι να πατήσετε Εφαρμογή.");
  return t("You would save ","Θα εξοικονομούσατε ")+'<b>'+fmt(T.sv)+t(" a month","/μήνα")+'</b> · <b>'+fmt(T.sv*12)+t(" a year","/έτος")+'</b>'+(T.tot>0?'<br>'+t("This month: ","Αυτόν τον μήνα: ")+fmt(T.tot)+' → '+fmt(Math.max(0,T.tot-T.sv)):"")}
function wiLine(r){var p=wiP[r.k]||0;if(!p)return '<span>'+X("No change","Καμία αλλαγή")+'</span>';
  return '<span>'+X("Save ","Εξοικονόμηση ")+'<b>'+fmt(r.m*p/100)+X("/mo","/μήνα")+'</b> · <b>'+fmt(r.m*p*.12)+X("/yr","/έτος")+'</b></span>'+(r.id?'<button type="button" class="ghost" data-wiap="'+esc(r.k)+'">'+X("Apply","Εφαρμογή")+'</button>':'')}
function renderWhatIf(){var box=$("wif");if(!box||state.simple||(state.show&&state.show.whatif===false))return;
  var rows=wiRows();
  if(!rows.length){box.innerHTML='<div class="empty">'+X("Add a recurring expense or a bill to try this out.","Προσθέστε ένα επαναλαμβανόμενο έξοδο ή λογαριασμό για να το δοκιμάσετε.")+'</div>';return}
  Object.keys(wiP).forEach(function(k){if(!rows.some(function(r){return r.k===k}))delete wiP[k]});
  box.innerHTML='<div class="wsum" id="wis" aria-live="polite">'+wiSumHTML(rows)+'</div>'+rows.map(function(r){var p=wiP[r.k]||0;
    return '<div class="wir" data-wik="'+esc(r.k)+'"><div class="wt"><span>'+esc(r.n)+(r.bill?' <small>('+X("bill","λογαριασμός")+')</small>':'')+'</span><span>'+fmt(r.m)+X("/mo","/μήνα")+'</span></div>'+
      '<input type="range" min="0" max="100" step="1" value="'+Math.round(p)+'" data-wik="'+esc(r.k)+'" aria-label="'+esc(X("Cut “"+r.n+"” by percent","Περικοπή «"+r.n+"» κατά ποσοστό"))+'"><div class="wnew"><label>'+X("Or type a new amount per month","Ή πληκτρολογήστε νέο ποσό ανά μήνα")+'<input type="number" class="wiv" min="0" max="'+r.m.toFixed(2)+'" step="0.01" value="'+(r.m*(1-p/100)).toFixed(2)+'" data-wik="'+esc(r.k)+'"></label></div><div class="ws"><span class="wpc">'+(Math.round(p*10)/10)+'%</span><span class="wl">'+wiLine(r)+'</span></div></div>'}).join("")+
    '<button type="button" class="ghost" id="wireset" style="margin-top:8px">'+X("Reset sliders","Μηδενισμός")+'</button>'}
document.addEventListener("input",function(e){var r=e.target;if(!r.matches||!r.matches('#wif input[type=range],#wif input.wiv'))return;
  var k=r.getAttribute("data-wik"),rows=wiRows(),row=rows.filter(function(x){return x.k===k})[0];if(!row)return;
  var w=r.closest(".wir"),rg=w.querySelector("input[type=range]"),nv=w.querySelector("input.wiv");
  if(r===rg){wiP[k]=+r.value;nv.value=(row.m*(1-wiP[k]/100)).toFixed(2)}
  else{var v=parseFloat(r.value);if(!(v>=0)){wiP[k]=0;rg.value=0}else{var p=Math.min(100,Math.max(0,(1-v/row.m)*100));wiP[k]=Math.round(p*1e4)/1e4;rg.value=Math.round(p)}}
  w.querySelector(".wpc").textContent=(Math.round((wiP[k]||0)*10)/10)+"%";w.querySelector(".wl").innerHTML=wiLine(row);$("wis").innerHTML=wiSumHTML(rows)});
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("#wif [data-wiap],#wireset");if(!b)return;
  if(b.id==="wireset"){wiP={};renderWhatIf();return}
  var k=b.getAttribute("data-wiap"),it=find(k),p=wiP[k]||0;if(!it||!p)return;var prev=clone(it);
  it.amt=Math.round(it.amt*(100-p))/100;if(!(it.amt>0))it.amt=.01;delete wiP[k];save();render();
  editToast(X("Amount lowered","Το ποσό μειώθηκε"),function(){return state.items},prev)});

buildMenu();renderCats();buildIcons();syncCat();$("dt").value=today();stopFl();stopGoal();stopCl();syncEnd();applyFlLayout();applyView();render();applyCollapse();applyFull();
applyLang();
accBoot();
// side columns stay in place while the page scrolls. One taller than the window has no scrollbar of its own: it moves
// with the page until its end shows (scrolling down) or its start shows (scrolling up), by changing its sticky top (--st)
(function(){var last=window.scrollY,queued=false;
  function els(){return [$("colL"),$("colR"),$("flL"),$("flB"),document.querySelector('.slot[data-card="insights"]')].filter(Boolean)}
  function update(){queued=false;var dy=window.scrollY-last,vh=window.innerHeight;last=window.scrollY;
    els().forEach(function(el){if(getComputedStyle(el).position!=="sticky"){el.style.removeProperty("--st");return}
      var min=Math.min(16,vh-el.offsetHeight-16),cur=parseFloat(el.style.getPropertyValue("--st"));if(isNaN(cur))cur=16;
      el.style.setProperty("--st",Math.max(min,Math.min(16,cur-dy))+"px")})}
  function later(){if(!queued){queued=true;requestAnimationFrame(update)}}
  window.addEventListener("scroll",later,{passive:true});window.addEventListener("resize",later);
  if(window.ResizeObserver){var ro=new ResizeObserver(later);els().forEach(function(el){ro.observe(el)})}
  update()})();
// Cloudflare's bot check adds a hidden, untitled frame after this script; name it so screen readers and checkers know what it is
document.addEventListener("DOMContentLoaded",function(){[].forEach.call(document.querySelectorAll("body>iframe:not([title])"),function(f){f.title="Cloudflare security check";f.setAttribute("aria-hidden","true");f.tabIndex=-1})});
})();
