const test=require('node:test');
const assert=require('node:assert/strict');
const runner=require('../runner.js');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const row=(handle,extra={})=>({handle,name:handle,followsYou:false,youFollow:false,...extra});
test('profile count parser accepts exact localized counts only',()=>{
  assert.equal(runner.parseCount('171 正在关注'),171);
  assert.equal(runner.parseCount('1,234 Followers'),1234);
  for(const value of ['1.2K Followers','1万 关注者','unknown']) assert.throws(()=>runner.parseCount(value));
});
test('virtual duplicates merge and candidates retain following-page order',()=>{
  const outcome=runner.reconcile([row('@Zeta',{position:1,followsYou:true}),row('@Alpha',{position:2}),row('@ALPHA',{position:2}),row('@Bob',{position:3})],[row('@Zeta'),row('@OnlyFollower')],3,2);
  assert.equal(outcome.verified,true);
  assert.deepEqual(outcome.candidates.map(r=>[r.handle,r.position]),[['@ALPHA',2],['@Bob',3]]);
});
test('count mismatch and relationship conflict fail closed',()=>{
  assert.equal(runner.reconcile([row('@Bob',{position:1})],[],2,0).verified,false);
  assert.equal(runner.reconcile([row('@Alice',{position:1,followsYou:true})],[],1,0).verified,false);
  const incomplete=runner.reconcile([row('@Alice',{position:1,followsYou:true})],[],1,1);
  assert.equal(incomplete.verified,false);assert.deepEqual(incomplete.conflicts,[]);
  assert.equal(runner.reconcile([row('@Bob',{position:2})],[],1,0).verified,false);
  assert.equal(runner.reconcile([row('@Alice',{youFollow:true})],[row('@Alice',{youFollow:true})],1,1).verified,false);
});
test('partial follower list does not invent relationship conflicts',()=>{
  const following=Array.from({length:24},(_,i)=>row('@U'+i,{position:i+1,followsYou:i<12}));
  const followers=Array.from({length:7},(_,i)=>row('@U'+i));
  const outcome=runner.reconcile(following,followers,24,19);
  assert.equal(outcome.verified,false);
  assert.equal(outcome.followingCount,24);
  assert.equal(outcome.followerCount,7);
  assert.deepEqual(outcome.conflicts,[]);
  assert.deepEqual(outcome.candidates,[]);
});
test('one-click action keeps the X tab foreground while scanning',async()=>{
  let listener,created;
  const chrome={runtime:{getURL:name=>'chrome-extension://test/'+name},action:{onClicked:{addListener(fn){listener=fn}},async setBadgeText(){},async setBadgeBackgroundColor(){}},tabs:{async create(value){created=value}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL});
  await listener({id:17,url:'https://x.com/home'});
  assert.equal(created.active,false);
  assert.match(created.url,/tabId=17/);
  await listener({id:18,url:'https://example.com'});
  assert.equal(created.active,true);
});
