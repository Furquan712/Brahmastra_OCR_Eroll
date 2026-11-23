const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const out={};
for(const ac of [61,62,63]){const key=`UTTARPRADESH::${ac}::2026::Final`;
 const st=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:{s:"$actionStatus",r:"$actionReason"},n:{$sum:1}}}]).toArray();
 const blank=await v.countDocuments({key,source:"main",gender:{$in:["",null]}});
 const blankByStatus=await v.aggregate([{$match:{key,source:"main",gender:{$in:["",null]}}},{$group:{_id:"$actionStatus",n:{$sum:1}}}]).toArray();
 // duplicate-EPIC groups and whether a member has blank gender / deleted status
 const g=await v.aggregate([{$match:{key,source:"main",epicNo:{$nin:[null,""]}}},{$group:{_id:"$epicNo",n:{$sum:1},blank:{$sum:{$cond:[{$in:["$gender",["",null]]},1,0]}},del:{$sum:{$cond:[{$eq:["$actionStatus","deleted"]},1,0]}},added:{$sum:{$cond:[{$eq:["$actionStatus","added"]},1,0]}},parts:{$addToSet:"$partNo"},ages:{$addToSet:"$age"}}},{$match:{n:{$gt:1}}},
   {$group:{_id:null,groups:{$sum:1},withBlank:{$sum:{$cond:[{$gt:["$blank",0]},1,0]}},withDel:{$sum:{$cond:[{$gt:["$del",0]},1,0]}},withAdded:{$sum:{$cond:[{$gt:["$added",0]},1,0]}},crossPart:{$sum:{$cond:[{$gt:[{$size:"$parts"},1]},1,0]}},sameAge:{$sum:{$cond:[{$eq:[{$size:"$ages"},1]},1,0]}},blankAndAdded:{$sum:{$cond:[{$and:[{$gt:["$blank",0]},{$gt:["$added",0]}]},1,0]}}}}]).toArray();
 out[ac]={status:st.map(x=>[x._id.s,x._id.r,x.n]),blankGender:blank,blankByStatus:blankByStatus.map(x=>[x._id,x.n]),dup:g[0]};
 console.log(ac,JSON.stringify(out[ac]));
}
fs.writeFileSync(path.join(__dirname,"deleted_stats.json"),JSON.stringify(out,null,1));
await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
