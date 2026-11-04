const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const key=`UTTARPRADESH::63::2026::Final`;
const rows=await v.aggregate([{$match:{key,source:"main",gender:{$in:["",null]}}},{$sample:{size:24}}]).toArray();
const out=[];
for(const r of rows){const same=await v.find({key,source:"main",partNo:r.partNo,pageNo:r.pageNo},{projection:{serialNo:1}}).toArray();
  const serials=same.map(a=>a.serialNo).sort((a,b)=>a-b);
  out.push({epic:r.epicNo||"noepic",part:r.partNo,page:r.pageNo,serial:r.serialNo,idx:serials.indexOf(r.serialNo),onPage:serials.length,status:r.actionStatus,name:r.nameHi,age:r.age});}
fs.writeFileSync(path.join(__dirname,"blank_pick.json"),JSON.stringify(out,null,1));
console.log(out.map(o=>`${o.epic} p${o.part} pg${o.page} s${o.serial} idx${o.idx} ${o.status} ${o.name}`).join("\n"));
await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
