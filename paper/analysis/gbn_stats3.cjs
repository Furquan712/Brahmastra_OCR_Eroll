const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");const out={};
for(const ac of [61,62,63]){const key=`UTTARPRADESH::${ac}::2026::Final`;const o=out[ac]={};
 o.addedAgeGender=await v.aggregate([{$match:{key,source:"main",actionStatus:"added"}},{$project:{a:{$convert:{input:"$age",to:"int",onError:-1,onNull:-1}},g:"$gender"}},{$group:{_id:{a:"$a",g:"$g"},n:{$sum:1}}}]).toArray();
 o.pages=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:"$partNo",p:{$max:{$convert:{input:"$pageNo",to:"int",onError:0,onNull:0}}}}},{$group:{_id:null,pages:{$sum:"$p"},parts:{$sum:1}}}]).toArray();
 o.relByGender=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:{g:"$gender",r:"$relationTypeEg"},n:{$sum:1}}}]).toArray();
 o.untagged=await v.countDocuments({key,source:null});
 o.addedBySection=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:{p:"$partNo",s:"$sectionNo"},n:{$sum:1},added:{$sum:{$cond:[{$eq:["$actionStatus","added"]},1,0]}}}},{$group:{_id:null,sections:{$sum:1},secWithAdd:{$sum:{$cond:[{$gt:["$added",0]},1,0]}}}}]).toArray();
 console.log("AC",ac,JSON.stringify({pages:o.pages,untagged:o.untagged,relByGender:o.relByGender,addedBySection:o.addedBySection}));
}
fs.writeFileSync(process.argv[2],JSON.stringify(out));await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
