const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");
const out={};
for(const ac of [61,62,63]){const key=`UTTARPRADESH::${ac}::2026::Final`;
 const r=await v.aggregate([{$match:{key,source:"main"}},
  {$project:{a:{$convert:{input:"$age",to:"int",onError:null,onNull:null}},st:"$actionStatus"}},
  {$group:{_id:null,rows:{$sum:1},
    missing:{$sum:{$cond:[{$eq:["$a",null]},1,0]}},
    lt18:{$sum:{$cond:[{$and:[{$ne:["$a",null]},{$lt:["$a",18]}]},1,0]}},
    zero:{$sum:{$cond:[{$eq:["$a",0]},1,0]}},
    a1_9:{$sum:{$cond:[{$and:[{$gte:["$a",1]},{$lte:["$a",9]}]},1,0]}},
    a10_17:{$sum:{$cond:[{$and:[{$gte:["$a",10]},{$lte:["$a",17]}]},1,0]}},
    a17:{$sum:{$cond:[{$eq:["$a",17]},1,0]}},
    gt120:{$sum:{$cond:[{$gt:["$a",120]},1,0]}},
    lt18added:{$sum:{$cond:[{$and:[{$ne:["$a",null]},{$lt:["$a",18]},{$eq:["$st","added"]}]},1,0]}},
  }}]).toArray();
 const hist=await v.aggregate([{$match:{key,source:"main"}},
  {$project:{a:{$convert:{input:"$age",to:"int",onError:null,onNull:null}}}},
  {$match:{a:{$ne:null,$lt:18}}},{$group:{_id:"$a",n:{$sum:1}}},{$sort:{_id:1}}]).toArray();
 const parts=await v.aggregate([{$match:{key,source:"main"}},
  {$project:{p:"$partNo",a:{$convert:{input:"$age",to:"int",onError:null,onNull:null}}}},
  {$match:{a:{$ne:null,$lt:18}}},{$group:{_id:"$p",n:{$sum:1}}},{$sort:{n:-1}},{$limit:5}]).toArray();
 out[ac]={...r[0],hist:Object.fromEntries(hist.map(h=>[h._id,h.n])),topParts:parts};
 console.log(ac,JSON.stringify(out[ac]));
}
fs.writeFileSync(path.join(__dirname,"under18.json"),JSON.stringify(out,null,1));
await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
