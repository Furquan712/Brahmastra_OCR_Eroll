const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const key=`UTTARPRADESH::63::2026::Final`;
const g=JSON.parse(fs.readFileSync(path.join(__dirname,"dups_jewar.json"),"utf8"));
// pick 12 groups: same age, added+existing; spread over the list
const sel=g.filter(x=>x.rows.length===2&&new Set(x.rows.map(r=>r.age)).size===1&&x.rows.some(r=>r.status==="added")&&x.rows.some(r=>r.status==="existing"));
const step=Math.max(1,Math.floor(sel.length/12)); const pick=sel.filter((_,i)=>i%step===0).slice(0,12);
const out=[];
for(const x of pick){for(const r of x.rows){
  const rows=await v.find({key,source:"main",partNo:r.part,pageNo:r.page},{projection:{serialNo:1}}).toArray();
  const serials=rows.map(a=>a.serialNo).sort((a,b)=>a-b);
  out.push({epic:x._id,part:r.part,page:r.page,serial:r.serial,idx:serials.indexOf(r.serial),onPage:serials.length,first:serials[0],status:r.status,name:r.name,age:r.age,gender:r.gender,rel:r.rel,house:r.house});
}}
fs.writeFileSync(path.join(__dirname,"dups_pick.json"),JSON.stringify(out,null,1));
console.log(out.map(o=>`${o.epic} part ${o.part} p${o.page} s${o.serial} idx ${o.idx}/${o.onPage} first ${o.first} ${o.status} ${o.name} ${o.age} ${o.gender||"-"}`).join("\n"));
await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
