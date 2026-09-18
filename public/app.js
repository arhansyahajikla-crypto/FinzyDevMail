let mode="login",token=localStorage.getItem("s3l_token"),me,lastResults=[];
const $=x=>document.getElementById(x),esc=x=>String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(u,o={}){o.headers={...(o.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};if(o.body){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(o.body)}let r=await fetch(u,o),d=await r.json();if(!r.ok)throw Error(d.error||"Request gagal");return d}
async function submitAuth(){try{let d=await api(mode==="login"?"/api/auth/login":"/api/auth/register",{method:"POST",body:{name:$("name").value,email:$("email").value,password:$("password").value}});token=d.token;localStorage.setItem("s3l_token",token);start()}catch(e){$("msg").textContent=e.message}}
async function start(){try{me=(await api("/api/me")).user;$("auth").classList.add("hide");$("app").classList.remove("hide");render();loadHistory()}catch{logout()}}
function render(){$("bal").textContent=rupiah(me.balance);$("bal2").textContent=rupiah(me.balance);$("pn").textContent=me.name;$("pe").textContent=me.email;$("pr").textContent=me.role;$("pi").textContent=me.id;if(me.role==="admin"){let b=document.createElement("button");b.textContent="Admin";b.onclick=()=>show("admin");document.querySelector("header").append(b)}}
function rupiah(n){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(n||0)}
function show(id){document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===id));scrollTo(0,0);if(id==="history")loadHistory();if(id==="saldo")loadTx();if(id==="admin")loadAdmin()}
function arr(id){return [...new Set($(id).value.split(/\r?\n/).map(x=>x.trim().toLowerCase()).filter(Boolean))].slice(0,300)}
function preview(){let a=arr("storInput");$("sp").innerHTML=`<div class=result><b>${a.length} email siap dikirim.</b><div class=meta>Status akan menjadi PENDING dan hanya backend/admin yang dapat mengubahnya.</div><button class=primary onclick=submitStor()>Kirim Setoran</button></div>`}
async function submitStor(){try{let d=await api("/api/submissions",{method:"POST",body:{emails:arr("storInput")}});$("sp").innerHTML=`<div class=result><b>Setoran #${d.submission_id} dibuat.</b><div class=meta>Status: PENDING</div></div>`;$("storInput").value=""}catch(e){alert(e.message)}}
async function check(){let a=arr("checkInput");if(!a.length)return alert("Masukkan email.");$("prog").textContent="Memeriksa...";try{let d=await api("/api/checker",{method:"POST",body:{emails:a}});lastResults=d.results;$("prog").textContent=`Selesai • Checker v${d.checker_version}`;$("results").innerHTML=d.results.map(x=>{let c=["INVALID_FORMAT","DOMAIN_NOT_FOUND","NO_MX_RECORD","DUPLICATE"].includes(x.final_status)?"bad":x.final_status==="UNKNOWN"?"unk":"ok";return `<div class=result><div class=resultTop><b>${esc(x.email)}</b><span class="badge ${c}">${esc(x.final_status)}</span></div><div class=meta>Syntax: ${x.syntax} • DNS: ${x.dns} • MX: ${x.mx} • SMTP: ${x.smtp}</div><div class=meta>${esc(x.reason)}${x.cached?" • cached":""}</div></div>`}).join("")}catch(e){$("prog").textContent=e.message}}
function clearC(){$("checkInput").value="";$("results").innerHTML="";$("prog").textContent=""}
async function loadHistory(){try{let d=await api("/api/history");let items=d.items||[];$("acc").textContent=items.filter(x=>x.status==="DITERIMA").length;$("pen").textContent=items.filter(x=>x.status==="PENDING").length;$("rej").textContent=items.filter(x=>x.status==="DITOLAK").length;$("hist").innerHTML=items.length?items.map(x=>`<div class=item><div class=resultTop><b>Setoran #${x.id}</b><span class=badge>${x.status}</span></div><div class=meta>${esc(x.first_email||"-")} • ${x.total_items} email • ${x.created_at}</div></div>`).join(""):"<div class=card>Belum ada riwayat.</div>"}catch{}}
async function loadTx(){try{let d=await api("/api/transactions");$("tx").innerHTML=d.items.map(x=>`<div class=item><b>${esc(x.type)}</b><div class=meta>${rupiah(x.amount)} • ${x.status}</div></div>`).join("")||"<div class=card>Belum ada transaksi.</div>"}catch{}}
async function withdraw(){
  const amount=Number(prompt("Nominal penarikan (minimal Rp10.000):","10000"));
  if(!amount)return;

  const method=prompt("Metode (Bank / DANA / OVO / GoPay):","");
  if(!method)return;

  const name=prompt("Nama pemilik rekening/akun:","");
  if(!name)return;

  const destination=prompt("Nomor rekening/nomor tujuan:","");
  if(!destination)return;

  try{
    const d=await api("/api/withdrawals",{
      method:"POST",
      body:{amount,method,name,destination}
    });

    alert("Permintaan penarikan berhasil dibuat.\nStatus: "+d.status);
    me=(await api("/api/me")).user;
    render();
    loadTx();
  }catch(e){
    alert(e.message);
  }
}
async function loadAdmin(){if(me.role!=="admin")return;try{let d=await api("/api/admin/submissions");$("adminList").innerHTML=d.items.map(x=>`<div class=item><b>#${x.id} • ${esc(x.user_email)}</b><div class=meta>${x.total_items} email • ${x.status}</div><button onclick="setStatus(${x.id},'DITERIMA')">Terima</button> <button onclick="setStatus(${x.id},'DITOLAK')">Tolak</button></div>`).join("")}catch(e){$("adminList").textContent=e.message}}
async function setStatus(id,status){await api("/api/admin/submissions/"+id+"/status",{method:"POST",body:{status}});loadAdmin();loadHistory()}
function logout(){localStorage.removeItem("s3l_token");location.reload()}
if(token)start()
