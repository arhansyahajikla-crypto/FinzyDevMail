
require("dotenv").config();
const express=require("express"),path=require("path"),Database=require("better-sqlite3"),
bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),dns=require("dns").promises;
const app=express(),db=new Database(process.env.DB_FILE||"/app/data/finzydevmail.db");
const SECRET=process.env.JWT_SECRET||"CHANGE_ME",VERSION="1.0.0";
db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,name TEXT,role TEXT DEFAULT 'user',balance INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY,user_id INTEGER,status TEXT DEFAULT 'PENDING',total_items INTEGER,accepted_items INTEGER DEFAULT 0,rejected_items INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submission_items(id INTEGER PRIMARY KEY,submission_id INTEGER,email TEXT,normalized_email TEXT,status TEXT DEFAULT 'PENDING',reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS email_checks(id INTEGER PRIMARY KEY,user_id INTEGER,email TEXT,normalized_email TEXT,syntax_status TEXT,dns_status TEXT,mx_status TEXT,smtp_status TEXT,final_status TEXT,reason TEXT,checker_version TEXT,checked_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,user_id INTEGER,type TEXT,amount INTEGER,status TEXT,note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,target_type TEXT,target_id INTEGER,metadata TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
app.use(express.json({limit:"200kb"}));app.use(express.static(path.join(__dirname,"public")));
const norm=x=>String(x||"").trim().toLowerCase();
function valid(e){if(e.length>254)return false;let m=e.match(/^([^@\s]+)@([^@\s]+)$/);if(!m)return false;let l=m[1],d=m[2];return l.length<=64&&!l.includes("..")&&!l.startsWith(".")&&!l.endsWith(".")&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(l)&&d.includes(".")}
const token=u=>jwt.sign({id:u.id,email:u.email,name:u.name,role:u.role},SECRET,{expiresIn:"7d"});
function auth(req,res,next){let h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Unauthorized"});try{req.user=jwt.verify(h.slice(7),SECRET);next()}catch{res.status(401).json({error:"Session expired"})}}
function admin(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Admin only"});next()}

app.post("/api/auth/register",async(req,res)=>{let email=norm(req.body.email),name=String(req.body.name||"").trim(),pw=String(req.body.password||"");if(!valid(email)||name.length<2||pw.length<8)return res.status(400).json({error:"Data tidak valid; password minimal 8 karakter."});try{let h=await bcrypt.hash(pw,12),x=db.prepare("INSERT INTO users(email,password_hash,name) VALUES(?,?,?)").run(email,h,name),u=db.prepare("SELECT id,email,name,role,balance FROM users WHERE id=?").get(x.lastInsertRowid);res.json({token:token(u),user:u})}catch{res.status(409).json({error:"Email sudah terdaftar."})}});
app.post("/api/auth/login",async(req,res)=>{let email=norm(req.body.email),u=db.prepare("SELECT * FROM users WHERE email=?").get(email);if(!u||!(await bcrypt.compare(String(req.body.password||""),u.password_hash)))return res.status(401).json({error:"Email atau password salah."});res.json({token:token(u),user:{id:u.id,email:u.email,name:u.name,role:u.role,balance:u.balance}})});
app.get("/api/me",auth,(req,res)=>res.json({user:db.prepare("SELECT id,email,name,role,balance,created_at FROM users WHERE id=?").get(req.user.id)}));

app.post("/api/checker",auth,async(req,res)=>{
 let arr=Array.isArray(req.body.emails)?req.body.emails.slice(0,300):[];if(!arr.length)return res.status(400).json({error:"Masukkan email."});
 let seen=new Set(),out=[];
 for(let raw of arr){let e=norm(raw);if(seen.has(e)){out.push({email:raw,normalized_email:e,syntax:"NOT_CHECKED",dns:"NOT_CHECKED",mx:"NOT_CHECKED",smtp:"NOT_CHECKED",final_status:"DUPLICATE",reason:"Duplikat dalam pemeriksaan ini."});continue}seen.add(e);
  let old=db.prepare("SELECT * FROM email_checks WHERE user_id=? AND normalized_email=? AND checker_version=? ORDER BY id DESC LIMIT 1").get(req.user.id,e,VERSION);
  if(old){out.push({email:raw,normalized_email:e,syntax:old.syntax_status,dns:old.dns_status,mx:old.mx_status,smtp:old.smtp_status,final_status:old.final_status,reason:old.reason,cached:true});continue}
  let syntax=valid(e)?"VALID":"INVALID",dnsS="VALID",mxS="VALID",smtp="UNKNOWN",final="UNKNOWN",reason="Domain dan MX tersedia; mailbox tidak dapat dipastikan dari pemeriksaan ini.";
  if(syntax==="INVALID"){final="INVALID_FORMAT";reason="Format email tidak valid."}else{try{let mx=await dns.resolveMx(e.split("@")[1]);if(!mx.length){dnsS=mxS="NO_MX_RECORD";final="NO_MX_RECORD";reason="Tidak ada MX record."}}catch{dnsS=mxS="DOMAIN_NOT_FOUND";final="DOMAIN_NOT_FOUND";reason="Domain tidak ditemukan melalui DNS."}}
  db.prepare("INSERT INTO email_checks(user_id,email,normalized_email,syntax_status,dns_status,mx_status,smtp_status,final_status,reason,checker_version) VALUES(?,?,?,?,?,?,?,?,?,?)").run(req.user.id,raw,e,syntax,dnsS,mxS,smtp,final,reason,VERSION);
  out.push({email:raw,normalized_email:e,syntax,dns:dnsS,mx:mxS,smtp,final_status:final,reason});
 }
 res.json({checker_version:VERSION,results:out});
});
app.post("/api/submissions",auth,(req,res)=>{let a=[...new Set((Array.isArray(req.body.emails)?req.body.emails:[]).map(norm).filter(Boolean))].slice(0,300);if(!a.length)return res.status(400).json({error:"Tidak ada email."});let id=db.transaction(()=>{let s=db.prepare("INSERT INTO submissions(user_id,total_items) VALUES(?,?)").run(req.user.id,a.length),ins=db.prepare("INSERT INTO submission_items(submission_id,email,normalized_email) VALUES(?,?,?)");a.forEach(e=>ins.run(s.lastInsertRowid,e,e));db.prepare("INSERT INTO audit_logs(user_id,action,target_type,target_id,metadata) VALUES(?,?,?,?,?)").run(req.user.id,"SUBMISSION_CREATED","submission",s.lastInsertRowid,JSON.stringify({count:a.length}));return s.lastInsertRowid})();res.json({submission_id:id})});
app.get("/api/history",auth,(req,res)=>res.json({items:db.prepare("SELECT s.*, (SELECT email FROM submission_items i WHERE i.submission_id=s.id LIMIT 1) first_email FROM submissions s WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.id)}));
app.get("/api/transactions",auth,(req,res)=>res.json({items:db.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.id)}));
app.get("/api/admin/submissions",auth,admin,(req,res)=>res.json({items:db.prepare("SELECT s.*,u.email user_email FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200").all()}));
app.post("/api/admin/submissions/:id/status",auth,admin,(req,res)=>{let st=["PENDING","DITERIMA","DITOLAK"].includes(req.body.status)?req.body.status:null;if(!st)return res.status(400).json({error:"Status invalid"});let s=db.prepare("SELECT * FROM submissions WHERE id=?").get(req.params.id);if(!s)return res.status(404).json({error:"Not found"});db.transaction(()=>{db.prepare("UPDATE submissions SET status=? WHERE id=?").run(st,s.id);db.prepare("UPDATE submission_items SET status=? WHERE submission_id=?").run(st,s.id);db.prepare("INSERT INTO audit_logs(user_id,action,target_type,target_id,metadata) VALUES(?,?,?,?,?)").run(req.user.id,"STATUS_CHANGED","submission",s.id,JSON.stringify({from:s.status,to:st}))})();res.json({ok:true})});
app.get("/health",(req,res)=>res.json({ok:true,service:"FinzyDevMail"}));
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
async function bootstrapAdmin(){
 const email=String(process.env.ADMIN_EMAIL||"").trim().toLowerCase();
 const password=String(process.env.ADMIN_PASSWORD||"");
 if(!email||password.length<8)return;
 const existing=db.prepare("SELECT id,role FROM users WHERE email=?").get(email);
 if(existing){if(existing.role!=="admin")db.prepare("UPDATE users SET role=\'admin\' WHERE id=?").run(existing.id);return;}
 const hash=await bcrypt.hash(password,12);
 db.prepare("INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,\'admin\')").run(email,hash,process.env.ADMIN_NAME||"Administrator");
}
bootstrapAdmin().then(()=>app.listen(process.env.PORT||3000,()=>console.log("FinzyDevMail running"))).catch(err=>{console.error(err);process.exit(1)});
