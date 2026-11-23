const fs=require("node:fs"),path=require("node:path");const {MongoClient}=require("mongodb");
const DASH="/Volumes/External/algo/Brahmastra_Dashboard";
const t=fs.readFileSync(path.join(DASH,".env"),"utf8");const e=Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).replace(/\s*#.*$/,"").trim().replace(/^["']|["']$/g,"")]}));
(async()=>{const c=new MongoClient(e.MONGO_URI);await c.connect();const db=c.db(e.MONGO_DB||"brahmastra");const v=db.collection("eroll_voters");const out={};
for(const ac of [61,62,63]){const key=`UTTARPRADESH::${ac}::2026::Final`;const o=out[ac]={};
 o.rel=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:"$relationTypeEg",n:{$sum:1}}}]).toArray();
 o.epicPat=await v.aggregate([{$match:{key,source:"main"}},{$project:{p:{$cond:[{$regexMatch:{input:{$ifNull:["$epicNo",""]},regex:/^[A-Z]{3}[0-9]{7}$/}},"modern",{$cond:[{$regexMatch:{input:{$ifNull:["$epicNo",""]},regex:/\//}},"slash",{$cond:[{$regexMatch:{input:{$ifNull:["$epicNo",""]},regex:/^[A-Z]{3}[0-9]{6}$/}},"3L6D",{$cond:[{$regexMatch:{input:{$ifNull:["$epicNo",""]},regex:/^[A-Z]{2}[0-9]{7,8}$/}},"2L",{$cond:[{$eq:[{$ifNull:["$epicNo",""]},""]},"empty","other"]}]}]}]}]}}},{$group:{_id:"$p",n:{$sum:1}}}]).toArray();
 o.epicOther=await v.aggregate([{$match:{key,source:"main",epicNo:{$not:/^[A-Z]{3}[0-9]{7}$/}}},{$sample:{size:12}},{$project:{_id:0,epicNo:1}}]).toArray();
 o.genderO=await v.aggregate([{$match:{key,source:"main",gender:"O"}},{$sample:{size:6}},{$project:{_id:0,genderHi:1,age:1,relationTypeEg:1}}]).toArray();
 o.genderKeys=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:{g:"$gender",gh:"$genderHi"},n:{$sum:1}}},{$sort:{n:-1}},{$limit:8}]).toArray();
 // duplicate EPICs: same person (name+age within 1) vs different
 o.dups=await v.aggregate([{$match:{key,source:"main",epicNo:{$regex:/^[A-Z]{3}[0-9]{7}$/}}},{$group:{_id:"$epicNo",n:{$sum:1},names:{$addToSet:"$nameHi"},ages:{$addToSet:"$age"},parts:{$addToSet:"$partNo"}}},{$match:{n:{$gt:1}}},{$project:{sameName:{$eq:[{$size:"$names"},1]},sameAge:{$eq:[{$size:"$ages"},1]},samePart:{$eq:[{$size:"$parts"},1]},n:1}},{$group:{_id:{sameName:"$sameName",sameAge:"$sameAge",samePart:"$samePart"},epics:{$sum:1},rows:{$sum:"$n"}}}]).toArray();
 o.sections=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:{p:"$partNo",s:"$sectionNo"}}},{$group:{_id:"$_id.p",n:{$sum:1}}},{$group:{_id:null,parts:{$sum:1},sections:{$sum:"$n"},max:{$max:"$n"}}}]).toArray();
 o.emptyName=await v.countDocuments({key,source:"main",$or:[{nameHi:""},{nameHi:null}]});
 o.emptyAge=await v.countDocuments({key,source:"main",$or:[{age:""},{age:null}]});
 o.addedByPart=await v.aggregate([{$match:{key,source:"main"}},{$group:{_id:"$partNo",n:{$sum:1},added:{$sum:{$cond:[{$eq:["$actionStatus","added"]},1,0]}},modified:{$sum:{$cond:[{$eq:["$actionStatus","modified"]},1,0]}}}}]).toArray();
 o.addedGender=await v.aggregate([{$match:{key,source:"main",actionStatus:"added"}},{$group:{_id:"$gender",n:{$sum:1}}}]).toArray();
 o.addedAges=await v.aggregate([{$match:{key,source:"main",actionStatus:"added"}},{$project:{a:{$convert:{input:"$age",to:"int",onError:-1,onNull:-1}}}},{$bucket:{groupBy:"$a",boundaries:[-1,0,18,20,25,30,40,50,60,70,80,200],default:"x",output:{n:{$sum:1}}}}]).toArray();
 console.log("AC",ac,JSON.stringify({rel:o.rel,epicPat:o.epicPat,epicOther:o.epicOther.map(x=>x.epicNo),genderO:o.genderO,genderKeys:o.genderKeys,dups:o.dups,sections:o.sections,emptyName:o.emptyName,emptyAge:o.emptyAge,addedGender:o.addedGender,addedAges:o.addedAges}));
}
fs.writeFileSync(process.argv[2],JSON.stringify(out));await c.close();})().catch(e=>{console.error(e.message);process.exit(1)});
