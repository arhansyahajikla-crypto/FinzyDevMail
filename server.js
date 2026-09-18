require("dotenv").config();
const express=require("express");
const path=require("path");
const fs=require("fs");
const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const dns=require("dns").promises;

const app=express();
const dbFile=process.env.DB_FILE||"/app/data/finzydevmail.db";
fs.mkdirSync(path.dirname(dbFile),{recursive:true});
const db=new Database(dbFile);
const SECRET=process.env.JWT_SECRET||"CHANGE_ME";
const PRICE=3800;
const VERSION="2.0.1";

db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,name TEXT,role TEXT DEFAULT 'user',balance INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT DEFAULT 'PENDING',total_items INTEGER,accepted_items INTEGER DEFAULT 0,rejected_items INTEGER DEFAULT 0,credit_applied INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submission_items(id INTEGER PRIMARY KEY,submission_id INTEGER,email TEXT,normalized_email TEXT,status TEXT DEFAULT 'PENDING',reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS email_checks(id INTEGER PRIMARY KEY,user_id INTEGER,email TEXT,normalized_email TEXT,syntax_status TEXT,dns_status TEXT,mx_status TEXT,smtp_status TEXT,final_status TEXT,reason TEXT,checker_version TEXT,checked_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,user_id INTEGER,type TEXT,amount INTEGER,status TEXT,note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY,user_id INTEGER,amount INTEGER,method TEXT,account_name TEXT,destination TEXT,status TEXT DEFAULT 'PENDING',note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_at TEXT);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Safe migrations for databases created by older versions.
for(const sql of [
  "ALTER TABLE submissions ADD COLUMN accepted_items INTEGER DEFAULT 0",
  "ALTER TABLE submissions ADD COLUMN rejected_items INTEGER DEFAULT 0",
  "ALTER TABLE submissions ADD COLUMN credit_applied INTEGER DEFAULT 0"
]){try{db.exec(sql)}catch(e){if(!String(e.message).includes("duplicate column")) throw e}}

app.use(express.json({limit:"300kb"}));
app.use(express.static(path.join(__dirname,"public")));
const norm=x=>String(x??"").trim().toLowerCase();
function valid(e){
  if(e.length>254)return false;
  const m=e.match(/^([^@\s]+)@([^@\s]+)$/); if(!m)return false;
  const l=m[1],d=m[2];
  return l.length<=64&&!l.includes("..")&&!l.startsWith(".")&&!l.endsWith(".")&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(l)&&d.includes(".");
}
const token=u=>jwt.sign({id:u.id,email:u.email,name:u.name,role:u.role},SECRET,{expiresIn:"7d"});
function auth(req,res,next){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Unauthorized"});try{const payload=jwt.verify(h.slice(7),SECRET);const u=db.prepare("SELECT id,email,name,role,balance FROM users WHERE id=?").get(payload.id);if(!u)return res.status(401).json({error:"User tidak ditemukan."});req.user=u;next()}catch{return res.status(401).json({error:"Session expired"})}}
function admin(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Akses admin diperlukan."});next()}
function audit(userId,action,type,id,meta={}){db.prepare("INSERT INTO audit_logs(user_id,action,target_type,target_id,metadata) VALUES(?,?,?,?,?)").run(userId,action,type,id,JSON.stringify(meta))}

app.get("/health",(req,res)=>res.json({ok:true,service:"FinzyDevMail",version:VERSION}));

app.post("/api/auth/register",async(req,res)=>{
  const email=norm(req.body.email),name=String(req.body.name||"").trim(),pw=String(req.body.password||"");
  if(!valid(email)||name.length<2||pw.length<8)return res.status(400).json({error:"Data tidak valid. Password minimal 8 karakter."});
  try{const h=await bcrypt.hash(pw,12);const r=db.prepare("INSERT INTO users(email,password_hash,name) VALUES(?,?,?)").run(email,h,name);const u=db.prepare("SELECT id,email,name,role,balance FROM users WHERE id=?").get(r.lastInsertRowid);res.json({token:token(u),user:u})}
  catch(e){res.status(409).json({error:"Email sudah terdaftar."})}
});
app.post("/api/auth/login",async(req,res)=>{const email=norm(req.body.email);const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);if(!u||!(await bcrypt.compare(String(req.body.password||""),u.password_hash||"")))return res.status(401).json({error:"Email atau password salah."});res.json({token:token(u),user:{id:u.id,email:u.email,name:u.name,role:u.role,balance:u.balance}})});
app.get("/api/me",auth,(req,res)=>{const u=db.prepare("SELECT id,email,name,role,balance,created_at FROM users WHERE id=?").get(req.user.id);if(!u)return res.status(401).json({error:"User tidak ditemukan."});res.json({user:u})});

app.post("/api/checker",auth,async(req,res)=>{
  const arr=Array.isArray(req.body.emails)?req.body.emails.slice(0,300):[];
  if(!arr.length)return res.status(400).json({error:"Masukkan email."});
  const seen=new Set(),out=[];
  for(const raw0 of arr){
    const raw=String(raw0||"").trim(),e=norm(raw);
    if(seen.has(e)){out.push({email:raw,normalized_email:e,syntax:"NOT_CHECKED",dns:"NOT_CHECKED",mx:"NOT_CHECKED",smtp:"NOT_CHECKED",final_status:"DUPLICATE",reason:"Duplikat dalam pemeriksaan ini."});continue}
    seen.add(e);
    if(!valid(e)){out.push({email:raw,normalized_email:e,syntax:"INVALID",dns:"NOT_CHECKED",mx:"NOT_CHECKED",smtp:"NOT_CHECKED",final_status:"INVALID_FORMAT",reason:"Format email tidak valid."});continue}
    const old=db.prepare("SELECT * FROM email_checks WHERE user_id=? AND normalized_email=? AND checker_version=? ORDER BY id DESC LIMIT 1").get(req.user.id,e,VERSION);
    if(old){out.push({email:raw,normalized_email:e,syntax:old.syntax_status,dns:old.dns_status,mx:old.mx_status,smtp:old.smtp_status,final_status:old.final_status,reason:old.reason,cached:true});continue}
    let dnsS="VALID",mxS="VALID",smtp="UNKNOWN",final="UNKNOWN",reason="Domain dan MX tersedia. Pemeriksaan ini tidak login ke akun dan tidak dapat membuktikan akses mailbox.";
    try{const mx=await dns.resolveMx(e.split("@")[1]);if(!mx.length){dnsS=mxS="NO_MX_RECORD";final="NO_MX_RECORD";reason="Tidak ada MX record."}}
    catch{dnsS=mxS="DOMAIN_NOT_FOUND";final="DOMAIN_NOT_FOUND";reason="Domain tidak ditemukan melalui DNS."}
    db.prepare("INSERT INTO email_checks(user_id,email,normalized_email,syntax_status,dns_status,mx_status,smtp_status,final_status,reason,checker_version) VALUES(?,?,?,?,?,?,?,?,?,?)").run(req.user.id,raw,e,"VALID",dnsS,mxS,smtp,final,reason,VERSION);
    out.push({email:raw,normalized_email:e,syntax:"VALID",dns:dnsS,mx:mxS,smtp,final_status:final,reason});
  }
  res.json({checker_version:VERSION,results:out});
});

app.post("/api/submissions",auth,(req,res)=>{
  const a=[...new Set((Array.isArray(req.body.emails)?req.body.emails:[]).map(norm).filter(valid))].slice(0,300);
  if(!a.length)return res.status(400).json({error:"Tidak ada email valid."});
  const id=db.transaction(()=>{const s=db.prepare("INSERT INTO submissions(user_id,total_items,status,accepted_items,rejected_items,credit_applied) VALUES(?,?,?,0,0,0)").run(req.user.id,a.length,"PENDING");const ins=db.prepare("INSERT INTO submission_items(submission_id,email,normalized_email,status) VALUES(?,?,?,?)");for(const e of a)ins.run(s.lastInsertRowid,e,e,"PENDING");audit(req.user.id,"SUBMISSION_CREATED","submission",s.lastInsertRowid,{count:a.length});return s.lastInsertRowid})();
  res.json({submission_id:id,total_items:a.length,price_per_email:PRICE,total_value:a.length*PRICE});
});
app.get("/api/history",auth,(req,res)=>res.json({items:db.prepare("SELECT s.*, (SELECT email FROM submission_items i WHERE i.submission_id=s.id ORDER BY i.id LIMIT 1) first_email FROM submissions s WHERE user_id=? ORDER BY id DESC LIMIT 200").all(req.user.id)}));
app.get("/api/transactions",auth,(req,res)=>res.json({items:db.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 200").all(req.user.id)}));

app.post("/api/withdrawals",auth,(req,res)=>{
  const amount=Math.floor(Number(req.body.amount));
  const method=String(req.body.method||"").trim().toUpperCase();
  const name=String(req.body.name||"").trim();
  const destination=String(req.body.destination||"").trim();
  const allowed=["BANK","DANA","OVO","GOPAY","SHOPEEPAY","LINKAJA"];
  if(!Number.isFinite(amount)||amount<10000||amount%1000!==0)return res.status(400).json({error:"Minimal penarikan Rp10.000 dan kelipatan Rp1.000."});
  if(!allowed.includes(method)||name.length<2||destination.length<4)return res.status(400).json({error:"Data penarikan belum lengkap."});
  try{
    const id=db.transaction(()=>{
      const u=db.prepare("SELECT balance FROM users WHERE id=?").get(req.user.id);if(!u||u.balance<amount)throw new Error("Saldo tidak mencukupi.");
      const w=db.prepare("INSERT INTO withdrawals(user_id,amount,method,account_name,destination,status,note) VALUES(?,?,?,?,?,?,?)").run(req.user.id,amount,method,name,destination,"PENDING","Menunggu verifikasi admin");
      db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(amount,req.user.id);
      db.prepare("INSERT INTO transactions(user_id,type,amount,status,note) VALUES(?,?,?,?,?)").run(req.user.id,"PENARIKAN",-amount,"PENDING",`${method} • ${destination}`);
      audit(req.user.id,"WITHDRAWAL_CREATED","withdrawal",w.lastInsertRowid,{amount,method,destination});
      return w.lastInsertRowid;
    })();
    const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);res.json({ok:true,id,status:w.status,amount});
  }catch(e){res.status(400).json({error:e.message})}
});

// ADMIN: dashboard, submissions, withdrawals and manual user balance adjustment.
app.get("/api/admin/stats",auth,admin,(req,res)=>{
  const users=db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c;
  const pendingSub=db.prepare("SELECT COUNT(*) c FROM submissions WHERE status='PENDING'").get().c;
  const pendingWd=db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='PENDING'").get().c;
  const pendingEmails=db.prepare("SELECT COALESCE(SUM(total_items),0) c FROM submissions WHERE status='PENDING'").get().c;
  res.json({users,pendingSub,pendingWd,pendingEmails});
});
app.get("/api/admin/submissions",auth,admin,(req,res)=>res.json({items:db.prepare("SELECT s.*,u.email user_email,u.name user_name FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 300").all()}));
app.get("/api/admin/withdrawals",auth,admin,(req,res)=>res.json({items:db.prepare("SELECT w.*,u.email user_email,u.name user_name FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 300").all()}));

app.post("/api/admin/submissions/:id/status",auth,admin,(req,res)=>{
  const st=["PENDING","DITERIMA","DITOLAK"].includes(req.body.status)?req.body.status:null;if(!st)return res.status(400).json({error:"Status invalid."});
  const s=db.prepare("SELECT * FROM submissions WHERE id=?").get(req.params.id);if(!s)return res.status(404).json({error:"Setoran tidak ditemukan."});
  if(s.status!=="PENDING")return res.status(409).json({error:`Setoran sudah diproses sebagai ${s.status}.`});
  db.transaction(()=>{
    const accepted=st==="DITERIMA"?Number(s.total_items):0,rejected=st==="DITOLAK"?Number(s.total_items):0;
    db.prepare("UPDATE submissions SET status=?,accepted_items=?,rejected_items=? WHERE id=?").run(st,accepted,rejected,s.id);
    db.prepare("UPDATE submission_items SET status=? WHERE submission_id=?").run(st,s.id);
    if(st==="DITERIMA"){
      const amount=Number(s.total_items)*PRICE;
      if(Number(s.credit_applied||0)!==1){
        db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount,s.user_id);
        db.prepare("INSERT INTO transactions(user_id,type,amount,status,note) VALUES(?,?,?,?,?)").run(s.user_id,"SETORAN",amount,"SUCCESS",`Setoran #${s.id} • ${s.total_items} email × Rp${PRICE.toLocaleString("id-ID")}`);
        db.prepare("UPDATE submissions SET credit_applied=1 WHERE id=?").run(s.id);
      }
    }
    audit(req.user.id,"STATUS_CHANGED","submission",s.id,{from:s.status,to:st,credited:st==="DITERIMA"?Number(s.total_items)*PRICE:0});
  })();
  res.json({ok:true,status:st,credited:st==="DITERIMA"?Number(s.total_items)*PRICE:0});
});

app.post("/api/admin/withdrawals/:id/status",auth,admin,(req,res)=>{
  const st=["DISETUJUI","DITOLAK"].includes(req.body.status)?req.body.status:null;if(!st)return res.status(400).json({error:"Status invalid."});
  const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(req.params.id);if(!w)return res.status(404).json({error:"Penarikan tidak ditemukan."});
  if(w.status!=="PENDING")return res.status(409).json({error:`Penarikan sudah diproses sebagai ${w.status}.`});
  db.transaction(()=>{
    db.prepare("UPDATE withdrawals SET status=?,processed_at=CURRENT_TIMESTAMP,note=? WHERE id=?").run(st,st==="DISETUJUI"?"Disetujui admin; transfer diproses manual/oleh admin.":"Ditolak admin; saldo dikembalikan.",w.id);
    db.prepare("UPDATE transactions SET status=?,note=? WHERE user_id=? AND type='PENARIKAN' AND amount=? AND status='PENDING' AND id=(SELECT MAX(id) FROM transactions WHERE user_id=? AND type='PENARIKAN' AND amount=? AND status='PENDING')").run(st,st==="DISETUJUI"?`WD #${w.id} disetujui`: `WD #${w.id} ditolak; refund saldo`,w.user_id,-w.amount,w.user_id,-w.amount);
    if(st==="DITOLAK")db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(w.amount,w.user_id);
    audit(req.user.id,"WITHDRAWAL_STATUS_CHANGED","withdrawal",w.id,{to:st,refund:st==="DITOLAK"?w.amount:0});
  })();
  res.json({ok:true,status:st,refund:st==="DITOLAK"?w.amount:0});
});

app.get("/api/admin/users",auth,admin,(req,res)=>res.json({items:db.prepare("SELECT id,email,name,role,balance,created_at FROM users ORDER BY id DESC LIMIT 300").all()}));
app.post("/api/admin/users/:id/balance",auth,admin,(req,res)=>{
  const amount=Math.floor(Number(req.body.amount)),note=String(req.body.note||"Penyesuaian admin").trim();
  if(!Number.isFinite(amount)||amount===0)return res.status(400).json({error:"Nominal tidak valid."});
  const u=db.prepare("SELECT id,balance FROM users WHERE id=?").get(req.params.id);if(!u)return res.status(404).json({error:"User tidak ditemukan."});
  if(u.balance+amount<0)return res.status(400).json({error:"Saldo tidak boleh menjadi negatif."});
  db.transaction(()=>{db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount,u.id);db.prepare("INSERT INTO transactions(user_id,type,amount,status,note) VALUES(?,?,?,?,?)").run(u.id,"PENYESUAIAN",amount,"SUCCESS",note);audit(req.user.id,"BALANCE_ADJUSTED","user",u.id,{amount,note})})();
  res.json({ok:true});
});

function reconcileAcceptedCredits(){
  // Repair every accepted submission that has no matching SETORAN transaction.
  const rows=db.prepare("SELECT * FROM submissions WHERE status='DITERIMA' ORDER BY id").all();
  let repaired=0;
  for(const s of rows){
    const already=db.prepare("SELECT id FROM transactions WHERE user_id=? AND type='SETORAN' AND note LIKE ? LIMIT 1").get(s.user_id,`Setoran #${s.id} •%`);
    if(already){
      db.prepare("UPDATE submissions SET credit_applied=1,accepted_items=? WHERE id=?").run(Number(s.total_items),s.id);
      continue;
    }
    db.transaction(()=>{
      const amount=Number(s.total_items)*PRICE;
      db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount,s.user_id);
      db.prepare("INSERT INTO transactions(user_id,type,amount,status,note) VALUES(?,?,?,?,?)").run(s.user_id,"SETORAN",amount,"SUCCESS",`Setoran #${s.id} • ${s.total_items} email × Rp${PRICE.toLocaleString("id-ID")} • repair saldo`);
      db.prepare("UPDATE submissions SET credit_applied=1,accepted_items=? WHERE id=?").run(Number(s.total_items),s.id);
    })();
    repaired++;
  }
  if(repaired) console.log(`Repair saldo: ${repaired} setoran DITERIMA dikreditkan.`);
}

async function bootstrapAdmin(){
  const email=norm(process.env.ADMIN_EMAIL),password=String(process.env.ADMIN_PASSWORD||"");
  if(!email||password.length<8)return;
  const existing=db.prepare("SELECT id,role FROM users WHERE email=?").get(email);
  if(existing){if(existing.role!=="admin")db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);return;}
  const hash=await bcrypt.hash(password,12);db.prepare("INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,'admin')").run(email,hash,process.env.ADMIN_NAME||"Administrator");
}

app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
bootstrapAdmin().then(()=>{reconcileAcceptedCredits();return app.listen(process.env.PORT||3000,()=>console.log(`FinzyDevMail ${VERSION} running`))}).catch(e=>{console.error(e);process.exit(1)});
