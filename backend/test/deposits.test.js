"use strict";
// npm: node --test test/   — services/deposits.js (approve/reject/refund) ያለ MongoDB ይፈትናል
const test=require("node:test");
const Module=require("module"),assert=require("assert");
const setPath=(o,p,v)=>{const k=p.split(".");let c=o;for(let i=0;i<k.length-1;i++){c=c[k[i]]=c[k[i]]||{}}c[k[k.length-1]]=v};
const match=(d,f)=>Object.entries(f).every(([k,v])=>{const val=d[k];
 if(k==="$or")return v.some(s=>match(d,s));
 if(v&&typeof v==="object"){if("$in" in v)return v.$in.includes(val);if("$gt" in v)return val>v.$gt;if("$ne" in v)return String(val)!==String(v.$ne)}
 return String(val)===String(v)});
const applyUpd=(d,u)=>{for(const[k,v]of Object.entries(u.$set||{}))setPath(d,k,v);for(const[k,v]of Object.entries(u.$inc||{}))d[k]=(d[k]||0)+v};
let failInc=false;
const mk=(arr)=>{const wrap=(d)=>{if(d&&!d.save)Object.defineProperty(d,"save",{value:async()=>d,enumerable:false});return d};
 const m={
 findById:async(id)=>wrap(arr.find(x=>String(x._id)===String(id))||null),
 findOne:(f)=>{const r=arr.find(x=>match(x,f))||null;const q=Promise.resolve(r);q.select=()=>q;q.lean=()=>Promise.resolve(r);return q},
 findOneAndUpdate:async(f,u)=>{const d=arr.find(x=>match(x,f));if(!d)return null;applyUpd(d,u);return wrap(d)},
 findByIdAndUpdate:async(id,u)=>{ if(failInc&&u.$inc)throw new Error("boom"); const d=arr.find(x=>String(x._id)===String(id));if(!d)return null;applyUpd(d,u);return wrap(d)},
 updateOne:async(f,u)=>{const d=arr.find(x=>match(x,f));if(d)applyUpd(d,u)},
 create:async(o)=>{const d={_id:"id"+arr.length,...o};arr.push(d);return d}};return m};
const db={users:[],txs:[],notes:[]};
const User=mk(db.users),Tx=mk(db.txs),Note=mk(db.notes);
const sent=[];
const fakeBot={telegram:{sendMessage:async(id,text,extra)=>{sent.push({id,text,extra})}}};
const ol=Module._load;
Module._load=function(r,p,i){
 if(r.endsWith("models/User")){User.User=User;User.Notification=Note;return User}
 if(r.endsWith("models/Transaction"))return Tx;
 if(r==="../bot")return {bot:fakeBot};
 return ol.apply(this,arguments)};
process.env.ADMIN_CHAT_ID="";process.env.ADMIN_TELEGRAM_IDS="7,8";
const d=require("../services/deposits");
test("deposits: approve/reject/refund — atomic, ድርብ የለም, ሲከሽፍ ይመለሳል",async()=>{
 assert.deepEqual(d.adminChatIds(),["7","8"],"no hardcoded fallback; env fallback"); assert.equal(d.isAdminChatId("494653076"),false);
 process.env.ADMIN_CHAT_ID="-100"; assert.deepEqual(d.adminChatIds(),["-100"]);
 db.users.push({_id:"u1",telegramId:"55",firstName:"A",balance:100,totalDeposits:0,totalWithdrawals:0});
 db.txs.push({_id:"t1",user:"u1",type:"deposit",amount:50,status:"pending",meta:{transactionId:"X",smsFingerprint:"f1"}});
 const [a,b]=await Promise.all([d.approveTransaction("t1"),d.approveTransaction("t1")]);
 assert.equal([a,b].filter(r=>r.ok).length,1); assert.equal(db.users[0].balance,150); assert.equal(db.txs[0].balanceAfter,150);
 // withdrawal reject refund, no double refund, meta preserved
 db.users[0].balance=20;
 db.txs.push({_id:"t2",user:"u1",type:"withdrawal",amount:80,status:"pending",meta:{phone:"0911"}});
 assert.ok((await d.rejectTransaction("t2","no")).ok); assert.equal(db.users[0].balance,100);
 assert.equal(db.txs[1].meta.phone,"0911"); assert.equal(db.txs[1].meta.rejectReason,"no");
 assert.equal((await d.rejectTransaction("t2")).ok,false); assert.equal(db.users[0].balance,100);
 // refund failure → reverted to pending (no lost money)
 db.users[0].balance=0; db.txs.push({_id:"t3",user:"u1",type:"withdrawal",amount:30,status:"pending",meta:{}});
 failInc=true; const rf=await d.rejectTransaction("t3"); failInc=false;
 assert.equal(rf.ok,false); assert.equal(db.txs[2].status,"pending","withdrawal stays pending when refund fails");
 assert.ok((await d.rejectTransaction("t3")).ok); assert.equal(db.users[0].balance,30,"retry refunds");
 // deposit credit failure → reverted
 db.txs.push({_id:"t4",user:"u1",type:"deposit",amount:40,status:"pending",meta:{}});
 failInc=true; const af=await d.approveTransaction("t4"); failInc=false;
 assert.equal(af.ok,false); assert.equal(db.txs[3].status,"pending"); assert.equal(db.users[0].balance,30);
 assert.ok((await d.approveTransaction("t4")).ok); assert.equal(db.users[0].balance,70);
 // wrong type / missing user
 db.txs.push({_id:"t5",user:"u1",type:"prize",amount:5,status:"pending"});
 assert.match((await d.approveTransaction("t5")).error,/Only deposits/);
 db.txs.push({_id:"t6",user:"ghost",type:"deposit",amount:10,status:"pending",meta:{}});
 assert.equal((await d.approveTransaction("t6")).code,404); assert.equal(db.txs.find(t=>t._id==="t6").status,"pending");
 // notification failure must not break approval
 Note.create=async()=>{throw new Error("notif down")};
 db.txs.push({_id:"t7",user:"u1",type:"withdrawal",amount:5,status:"pending",meta:{}});
 assert.ok((await d.approveTransaction("t7")).ok);
 // admin notify
 sent.length=0; const ok=await d.notifyAdminsOfDeposit({_id:"t9",amount:60,reference:"R",meta:{transactionId:"TX1"}},db.users[0]);
 assert.ok(ok); assert.equal(sent[0].id,"-100"); assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][1].callback_data,"dep_no:t9");
});
