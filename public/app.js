const API="";
let mode="login";
let user=JSON.parse(localStorage.getItem("fdm_user")||"null");
let token=localStorage.getItem("fdm_token")||"";
let cache={me:null,history:[],tx:[],adminStats:null,adminSub:[],adminWd:[],members:[]};

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const rupiah=n=>"Rp "+Number(n||0).toLocaleString("id-ID");
const date=v=>v?new Date(v.replace(" ","T")+"Z").toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"}):"-";

async function api(path,opts={}){
  const headers={"Content-Type":"application/json",...(opts.headers||{})};
  if(token) headers.Authorization="Bearer "+token;
  const r=await fetch(API+path,{...opts,headers});
  let data={}; try{data=await r.json()}catch{}
  if(!r.ok){if(r.status===401){logout(false);throw new Error("Sesi login berakhir.")}throw new Error(data.error||"Permintaan gagal")}
  return data;
}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2600)}
function setMsg(msg){$("authMsg").textContent=msg;$("authMsg").classList.toggle("hidden",!msg)}
function togglePassword(){const x=$("password");x.type=x.type==="password"?"text":"password"}
function toggleAuth(){
  mode=mode==="login"?"register":"login";
  $("authTitle").textContent=mode==="login"?"Masuk":"Daftar";
  $("authSubtitle").textContent=mode==="login"?"Masuk untuk melanjutkan":"Buat akun FinzyDevMail";
  $("authButton").innerHTML=mode==="login"?"↪ &nbsp; Masuk":"✦ &nbsp; Buat Akun";
  $("switchAuth").innerHTML=mode==="login"?"Belum punya akun? <b>Daftar →</b>":"Sudah punya akun? <b>Masuk →</b>";
  $("nameWrap").classList.toggle("hidden",mode==="login");setMsg("");
}
async function submitAuth(){
  setMsg("");
  const email=$("email").value.trim(), password=$("password").value;
  const name=$("name").value.trim();
  if(!email||!password||(mode==="register"&&!name)){setMsg("Lengkapi semua data terlebih dahulu.");return}
  try{
    const data=await api(mode==="login"?"/api/auth/login":"/api/auth/register",{method:"POST",body:JSON.stringify({email,password,name})});
    token=data.token;user=data.user;localStorage.setItem("fdm_token",token);localStorage.setItem("fdm_user",JSON.stringify(user));boot();
  }catch(e){setMsg(e.message)}
}
function googleLogin(){toast("Google OAuth belum dikonfigurasi di server. Login email/password sudah aktif.")}
function logout(show=true){token="";user=null;cache={me:null,history:[],tx:[],adminStats:null,adminSub:[],adminWd:[],members:[]};localStorage.removeItem("fdm_token");localStorage.removeItem("fdm_user");boot();if(show)toast("Kamu sudah keluar")}
async function boot(){
  if(!token){$("auth").classList.remove("hidden");$("app").classList.add("hidden");return}
  try{cache.me=await api("/api/me");user=cache.me.user;localStorage.setItem("fdm_user",JSON.stringify(user));$("auth").classList.add("hidden");$("app").classList.remove("hidden");setupRole();show(user.role==="admin"?"admin":"home")}
  catch{logout(false)}
}
function setupRole(){
  const admin=user?.role==="admin";
  $("userNav").classList.toggle("hidden",admin);$("adminNav").classList.toggle("hidden",!admin);
  $("roleBadge").textContent=admin?"ADMIN":"USER";
}
function activeNav(p){document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===p))}
function show(p){
  activeNav(p);
  const views={home:viewHome,job:viewJob,generate:viewGenerate,history:viewHistory,profile:viewProfile,admin:viewAdmin,adminSub:viewAdminSub,adminWd:viewAdminWd,members:viewMembers};
  if(views[p]) views[p]();
}
function shell(title,sub,body,icon="✦"){
  $("page").innerHTML=`<div class="hero glass"><div class="hero-icon">${icon}</div><div class="muted">${esc(sub||"")}</div><h1>${esc(title)}</h1></div>${body}`;
}
async function viewHome(){
  try{cache.me=await api("/api/me");cache.history=(await api("/api/history")).items||[];cache.tx=(await api("/api/transactions")).items||[];user=cache.me.user}
  catch(e){toast(e.message);return}
  const u=user||{}, total=cache.history.reduce((a,x)=>a+Number(x.total_items||0),0), accepted=cache.history.reduce((a,x)=>a+Number(x.accepted_items||0),0);
  shell("Halo, "+(u.name||u.email.split("@")[0]),"Dashboard FinzyDevMail • akun kamu siap digunakan","",
  );
  $("page").innerHTML+=`
  <div class="card balance-card glass"><div class="label">Saldo tersedia</div><div class="money">${rupiah(u.balance)}</div><span class="reward">Reward setor Rp 3.800 / email</span></div>
  <div class="grid grid-3">
    <div class="stat"><span class="label">Total email</span><span class="big">${total}</span></div>
    <div class="stat"><span class="label">Diterima</span><span class="big green">${accepted}</span></div>
    <div class="stat"><span class="label">Setoran</span><span class="big cyan">${cache.history.length}</span></div>
  </div>
  <div class="section-title"><h2>Aktivitas terbaru</h2><span>Live dari server</span></div>
  <div class="card">${renderHistory(cache.history.slice(0,5))}</div>
  <div class="section-title"><h2>Akses cepat</h2></div>
  <div class="grid"><button class="card btn" onclick="show('job')">▣<br>Setor Gmail</button><button class="card btn" onclick="show('generate')">✦<br>Generate Testing</button></div>`;
}
function renderHistory(items){
  if(!items?.length)return `<div class="empty">Belum ada aktivitas.</div>`;
  return items.map(x=>`<div class="item"><div class="item-main"><b>Setoran #${x.id}</b><small>${date(x.created_at)} • ${x.total_items} email</small></div><div class="item-side"><span class="status ${x.status==="DITERIMA"?"ok":x.status==="DITOLAK"?"bad":"pending"}">${esc(x.status)}</span><small>${x.status==="DITERIMA"?rupiah(Number(x.accepted_items||0)*3800):""}</small></div></div>`).join("");
}
function viewJob(){
  shell("Setor Gmail","Kirim daftar email yang memang kamu miliki/berhak kamu serahkan.","", "▣");
  $("page").innerHTML+=`<div class="card glass">
    <div class="row"><div><b>Reward per email</b><div class="muted">Rp 3.800 setelah disetujui</div></div><span class="reward">SETORAN</span></div>
    <div class="section-title"><h2>Daftar email</h2><span>1 email / baris</span></div>
    <textarea id="emails" placeholder="contoh@gmail.com&#10;contoh2@gmail.com"></textarea>
    <div class="notice" style="margin-top:12px">Jangan masukkan password, OTP, cookie, atau data rahasia. Sistem hanya menerima alamat email.</div>
    <div class="btn-row"><button class="btn primary" onclick="submitJob()">Kirim Setoran</button><button class="btn" onclick="$('emails').value=''">Bersihkan</button></div>
  </div>`;
}
async function submitJob(){
  const emails=$("emails").value.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!emails.length){toast("Masukkan minimal satu email.");return}
  try{const r=await api("/api/submissions",{method:"POST",body:JSON.stringify({emails})});toast(`Setoran #${r.submission_id} dibuat: ${r.total_items} email`);$("emails").value="";show("history")}
  catch(e){toast(e.message)}
}
function viewGenerate(){
  shell("Generate","Tool untuk membuat alamat testing lokal. Tidak membuat akun Gmail.","","✦");
  $("page").innerHTML+=`<div class="card glass"><div class="grid"><div><label class="label">Prefix</label><input id="prefix" placeholder="finzytest"></div><div><label class="label">Jumlah</label><input id="count" type="number" min="1" max="100" value="10"></div></div>
  <div class="btn-row"><button class="btn primary" onclick="generate()">✦ Generate</button><button class="btn" onclick="copyOut()">Salin hasil</button></div>
  <textarea id="out" readonly placeholder="Hasil generate akan muncul di sini"></textarea></div>`;
}
function generate(){const p=($("prefix").value.trim()||"finzytest").replace(/\s+/g,"");const n=Math.min(100,Math.max(1,Number($("count").value)||10));$("out").value=Array.from({length:n},(_,i)=>`${p}+test${String(i+1).padStart(3,"0")}@example.test`).join("\n");toast(`${n} alamat testing dibuat`)}
async function copyOut(){try{await navigator.clipboard.writeText($("out").value);toast("Hasil disalin")}catch{toast("Clipboard tidak tersedia")}}
async function viewHistory(){
  try{cache.history=(await api("/api/history")).items||[]}catch(e){toast(e.message);return}
  shell("Riwayat","Semua setoran dan status verifikasi.","","◷");
  $("page").innerHTML+=`<div class="card glass">${renderHistory(cache.history)}</div>`;
}
async function withdraw(){
  const name=$("wdName")?.value.trim(), destination=$("wdDest")?.value.trim(), amount=Number($("wdAmount")?.value), method=$("wdMethod")?.value;
  if(!name||!destination||!amount){toast("Lengkapi data penarikan.");return}
  try{const r=await api("/api/withdrawals",{method:"POST",body:JSON.stringify({name,destination,amount,method})});toast(`Penarikan ${rupiah(r.amount)} dibuat • status ${r.status}`);show("profile")}
  catch(e){toast(e.message)}
}
async function viewProfile(){
  try{cache.me=await api("/api/me");user=cache.me.user}catch(e){toast(e.message);return}
  shell("Profil","Akun dan keamanan FinzyDevMail.","","♙");
  $("page").innerHTML+=`<div class="card glass"><div class="row"><div><h2>${esc(user.name||"User")}</h2><div class="muted">${esc(user.email)}</div></div><span class="role-badge">${esc(user.role||"user").toUpperCase()}</span></div><hr><div class="item"><span>ID pengguna</span><b>#${user.id}</b></div><div class="item"><span>Saldo</span><b class="cyan">${rupiah(user.balance)}</b></div></div>
  <div class="card glass"><h2>Tarik saldo / WS</h2><p class="muted">Minimal Rp10.000 dan kelipatan Rp1.000.</p>
    <div class="grid"><input id="wdName" placeholder="Nama pemilik"><select id="wdMethod"><option value="DANA">DANA</option><option value="OVO">OVO</option><option value="GOPAY">GOPAY</option><option value="SHOPEEPAY">SHOPEEPAY</option><option value="LINKAJA">LINKAJA</option><option value="BANK">BANK</option></select></div>
    <input id="wdDest" placeholder="Nomor rekening / tujuan">
    <input id="wdAmount" type="number" min="10000" step="1000" placeholder="Nominal penarikan">
    <button class="btn primary" onclick="withdraw()">Ajukan Penarikan</button>
  </div>
  <div class="card glass"><h2>Keamanan</h2><p class="muted">Session menggunakan token JWT. Jangan bagikan token atau password.</p><button class="btn danger" onclick="logout()">Keluar dari akun</button></div>`;
}
async function viewAdmin(){
  try{cache.adminStats=await api("/api/admin/stats")}catch(e){toast(e.message);return}
  const s=cache.adminStats;
  shell("Admin Dashboard","Kontrol operasional FinzyDevMail.","","⌂");
  $("page").innerHTML+=`<div class="grid grid-3"><div class="stat glass"><span class="label">Anggota</span><span class="big">${s.users}</span></div><div class="stat glass"><span class="label">Setoran pending</span><span class="big orange">${s.pendingSub}</span></div><div class="stat glass"><span class="label">WS/Tarik pending</span><span class="big red">${s.pendingWd}</span></div></div>
  <div class="card glass"><div class="row"><div><h2>Antrean</h2><p class="muted">${s.pendingEmails} email menunggu proses</p></div><span class="status pending">LIVE</span></div><div class="btn-row"><button class="btn primary" onclick="show('adminSub')">Kelola Setoran</button><button class="btn" onclick="show('adminWd')">Kelola WS/Tarik</button><button class="btn" onclick="show('members')">Anggota</button></div></div>`;
}
async function viewAdminSub(){
  try{cache.adminSub=(await api("/api/admin/submissions")).items||[]}catch(e){toast(e.message);return}
  shell("Setoran","Validasi setoran anggota dan berikan kredit hanya saat diterima.","","▣");
  $("page").innerHTML+=`<div class="card glass"><input class="search" placeholder="Cari email/nama..." oninput="filterTable(this,'subTable')"><div class="table-wrap"><table id="subTable"><thead><tr><th>#</th><th>Anggota</th><th>Email</th><th>Item</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${cache.adminSub.map(x=>`<tr><td>${x.id}</td><td>${esc(x.user_name)}</td><td>${esc(x.user_email)}</td><td>${x.total_items}</td><td><span class="status ${x.status==="DITERIMA"?"ok":x.status==="DITOLAK"?"bad":"pending"}">${x.status}</span></td><td>${x.status==="PENDING"?`<button class="btn success" onclick="setSub(${x.id},'DITERIMA')">Terima</button> <button class="btn danger" onclick="setSub(${x.id},'DITOLAK')">Tolak</button>`:"—"}</td></tr>`).join("")}</tbody></table></div></div>`;
}
async function setSub(id,status){try{await api(`/api/admin/submissions/${id}/status`,{method:"POST",body:JSON.stringify({status})});toast(`Setoran #${id} → ${status}`);show("adminSub")}catch(e){toast(e.message)}}
async function viewAdminWd(){
  try{cache.adminWd=(await api("/api/admin/withdrawals")).items||[]}catch(e){toast(e.message);return}
  shell("WS / Penarikan","Kelola permintaan penarikan anggota.","","↗");
  $("page").innerHTML+=`<div class="card glass"><div class="table-wrap"><table><thead><tr><th>#</th><th>Anggota</th><th>Metode</th><th>Tujuan</th><th>Nominal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${cache.adminWd.map(x=>`<tr><td>${x.id}</td><td>${esc(x.user_name)}<br><small>${esc(x.user_email)}</small></td><td>${esc(x.method)}</td><td>${esc(x.destination)}</td><td>${rupiah(x.amount)}</td><td><span class="status ${x.status==="DISETUJUI"?"ok":x.status==="DITOLAK"?"bad":"pending"}">${x.status}</span></td><td>${x.status==="PENDING"?`<button class="btn success" onclick="setWd(${x.id},'DISETUJUI')">Setujui</button> <button class="btn danger" onclick="setWd(${x.id},'DITOLAK')">Tolak</button>`:"—"}</td></tr>`).join("")}</tbody></table></div></div>`;
}
async function setWd(id,status){try{await api(`/api/admin/withdrawals/${id}/status`,{method:"POST",body:JSON.stringify({status})});toast(`WS #${id} → ${status}`);show("adminWd")}catch(e){toast(e.message)}}
async function viewMembers(){
  try{cache.members=(await api("/api/admin/users")).items||[]}catch(e){toast(e.message);return}
  shell("Anggota","Daftar akun, role, dan saldo anggota.","","♙");
  $("page").innerHTML+=`<div class="card glass"><input class="search" placeholder="Cari anggota..." oninput="filterTable(this,'memberTable')"><div class="table-wrap"><table id="memberTable"><thead><tr><th>ID</th><th>Nama</th><th>Email</th><th>Role</th><th>Saldo</th><th>Aksi</th></tr></thead><tbody>${cache.members.map(x=>`<tr><td>#${x.id}</td><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.role)}</td><td>${rupiah(x.balance)}</td><td><button class="btn" onclick="adjustBalance(${x.id})">Atur saldo</button></td></tr>`).join("")}</tbody></table></div></div>`;
}
function adjustBalance(id){const amount=prompt("Masukkan penyesuaian saldo. Contoh: 10000 atau -5000");if(amount===null)return;const note=prompt("Catatan","Penyesuaian admin");api(`/api/admin/users/${id}/balance`,{method:"POST",body:JSON.stringify({amount:Number(amount),note:note||"Penyesuaian admin"})}).then(()=>{toast("Saldo diperbarui");show("members")}).catch(e=>toast(e.message))}
function filterTable(input,id){const q=input.value.toLowerCase();document.querySelectorAll(`#${id} tbody tr`).forEach(tr=>tr.style.display=tr.innerText.toLowerCase().includes(q)?"":"none")}
boot();
