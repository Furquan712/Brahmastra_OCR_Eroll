const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const st=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
for(const ac of [61,62,63]){const key=`UTTARPRADESH::${ac}::2026::Final`;
 const g=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:"$partNo",m:{$sum:{$cond:[{$eq:["$gender","M"]},1,0]}},f:{$sum:{$cond:[{$eq:["$gender","F"]},1,0]}}}}]).toArray();
 const by=new Map(g.map(x=>[String(x._id),x]));
 for(const p of st.acs[ac].perPart){const x=by.get(String(p.part));if(x){p.m=x.m;p.f=x.f;}}
 console.log(ac,"patched",g.length,"sample",JSON.stringify(st.acs[ac].perPart[0]));
}
fs.writeFileSync(process.argv[2],JSON.stringify(st));await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
