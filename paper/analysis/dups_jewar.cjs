const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const key=`UTTARPRADESH::63::2026::Final`;
const one=await v.findOne({key,source:"main"});console.log("fields:",Object.keys(one).join(","));
const g=await v.aggregate([{$match:{key,source:"main",epicNo:{$nin:[null,""]}}},
 {$group:{_id:"$epicNo",n:{$sum:1},rows:{$push:{part:"$partNo",serial:"$serialNo",page:"$pageNo",name:"$nameHi",nameEn:"$nameEg",age:"$age",gender:"$gender",rel:"$relationNameHi",house:"$houseNo",sec:"$sectionNo",status:"$actionStatus",conf:"$ocrConfidence",flags:"$flagReason"}}}},
 {$match:{n:{$gt:1}}},{$sort:{_id:1}}]).toArray();
console.log("dup epics:",g.length,"rows:",g.reduce((s,x)=>s+x.n,0));
fs.writeFileSync(path.join(__dirname,"dups_jewar.json"),JSON.stringify(g,null,1));
console.log(JSON.stringify(g.slice(0,3),null,0));
await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
