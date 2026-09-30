(async function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const tabId=Number(new URL(location.href).searchParams.get('tabId'));
  let owner='', startUrl='', result=null, counts=null,finalVerified=false;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function show(phase,message,percent,detail='') {
    $('phase').textContent=phase;$('progress').textContent=message;$('bar').style.width=percent+'%';$('detail').textContent=detail;
  }
  async function inject(func,args=[]) {
    const response=await chrome.scripting.executeScript({target:{tabId},func,args});
    if (!response.length) throw new Error('无法读取 X 标签页。');
    return response[0].result;
  }
  async function inspect(mode,expectedOwner,timeout=30000) {
    const until=Date.now()+timeout;
    let last='页面尚未准备好';
    while(Date.now()<until) {
      try {
        const view=await inject(XRunner.readPage,[mode,expectedOwner]);
        if(view?.fatal) throw new Error(view.fatal);
        if(view?.ready && (mode==='following'||mode==='followers') && view.visible===false) {
          await chrome.tabs.update(tabId,{active:true});
          last='X 标签页未保持可见，列表加载被暂停。';
        } else if(view?.ready) return view;
        last=view?.reason || last;
      } catch(error) {
        if(/账号已切换/.test(error.message)) throw error;
        last=error.message;
      }
      await sleep(350);
    }
    throw new Error(last+' 请确认 X 已登录、页面已加载。');
  }
  async function navigate(path,mode,timeout=30000) {
    await chrome.tabs.update(tabId,{url:'https://x.com/'+path});
    return inspect(mode,owner,timeout);
  }
  async function scan(kind,expected,{attempt=0,ordered=false,deadline}={}) {
    const label=kind==='following'?'正在关注':'关注者';
    let view=await navigate(owner+'/'+kind,kind);
    const map=new Map();let lastWindow=[],lastTop=-1,orderReliable=true,terminal=0,stalled='';
    const fraction=ordered?(attempt?.25:.42):(attempt?.3:.55);
    const until=Math.min(deadline,Date.now()+180000);
    const maxSteps=Math.max(100,Math.min(1500,Math.ceil(expected*5)));
    function collect(current) {
      const keys=current.rows.map(row=>row.handle.toLowerCase());
      if(ordered && lastWindow.length && keys.length && current.scrollTop>lastTop+4 && !keys.some(key=>lastWindow.includes(key))) orderReliable=false;
      for(const row of current.rows) {
        const key=row.handle.toLowerCase();
        if(ordered && !map.has(key)) XRunner.merge(map,[{...row,position:map.size+1}]);
        else XRunner.merge(map,[row]);
      }
      if(keys.length) {lastWindow=keys;lastTop=current.scrollTop;}
    }
    async function waitForMore(current) {
      const before=map.size, height=current.scrollHeight, untilGrowth=Math.min(until,Date.now()+12000);
      let tick=0;
      while(Date.now()<untilGrowth) {
        if(tick++%5===0) {
          await inject(XRunner.scrollPage,[kind,'up',.12,90]);
          await inject(XRunner.scrollPage,[kind,'down',.2,180]);
        }
        await inject(XRunner.scrollPage,[kind,'hold',0,400]);
        current=await inspect(kind,owner,8000);collect(current);
        if(map.size>before || current.scrollHeight>height+8 || !current.atBottom) return {view:current,grew:true};
      }
      return {view:current,grew:false};
    }
    for(let step=0;step<maxSteps && Date.now()<until;step++) {
      collect(view);
      const base=ordered?84:kind==='following'?10:48;
      show(ordered?'复核列表顺序':'扫描'+label,`已读取 ${map.size} / ${expected}`,Math.min(94,base+Math.floor((ordered?10:36)*Math.min(1,map.size/Math.max(1,expected)))),`${ordered?'自上而下复核':'第 '+(attempt+1)+' 次扫描'} · 页面 ${step+1}`);
      if(map.size>expected) {stalled='读到的账号多于主页人数';break;}
      terminal=view.atBottom && !view.busy && map.size===expected ? terminal+1 : 0;
      if(terminal>=2) break;
      if(view.atBottom && map.size<expected) {
        show('等待 X 加载'+label,`已读取 ${map.size} / ${expected}；正在等待下一批`,base,'到底后继续等待，未将此处视作列表末尾');
        const growth=await waitForMore(view);view=growth.view;
        if(!growth.grew) {stalled=`${label}停在 ${map.size}/${expected}，等待下一批超时`;break;}
        continue;
      }
      const moved=await inject(XRunner.scrollPage,[kind,'down',fraction,view.busy?450:220]);
      const next=await inspect(kind,owner,10000);
      if(!moved?.moved && next.scrollTop===view.scrollTop && next.scrollHeight===view.scrollHeight && map.size<expected) {
        const growth=await waitForMore(next);view=growth.view;
        if(!growth.grew) {stalled=`${label}无法继续滚动，停在 ${map.size}/${expected}`;break;}
      } else view=next;
    }
    const complete=map.size===expected && terminal>=2 && (!ordered||orderReliable);
    if(!complete && !stalled) stalled=ordered && !orderReliable?'相邻视窗缺少重叠，无法确认完整顺序':`未能核实 ${label} ${map.size}/${expected}`;
    return {rows:[...map.values()],complete,stalled,orderReliable};
  }
  function safeFile(text,mime,filename) {
    const url=URL.createObjectURL(new Blob([text],{type:mime}));
    const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function csv(rows) {
    const quote=value=>'"'+String(value).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
    return '\uFEFF'+[['正在关注序号','账号','名称','主页'],...rows.map(r=>[r.position,r.handle,r.name,'https://x.com/'+r.handle.slice(1)])].map(r=>r.map(quote).join(',')).join('\r\n');
  }
  function markdown() {
    const safeName=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replaceAll(/\r?\n/g,' ');
    const lines=['# X 未回关名单','',`核对时间：${new Date().toLocaleString('zh-CN')}。账号：@${owner}。`,'',`正在关注 ${counts.following}，关注者 ${counts.followers}，未回关 ${result.candidates.length}。`,'','序号为扫描时“正在关注”页面从上到下的位置。','','| 正在关注序号 | 名称 | 账号 |','| ---: | --- | --- |',...result.candidates.map(r=>`| ${r.position} | ${safeName(r.name)} | [${r.handle}](https://x.com/${r.handle.slice(1)}) |`),'','仅含公开显示的账号名称与主页链接。'];
    return lines.join('\n');
  }
  function renderRows() {
    const query=$('filter').value.trim().toLowerCase();$('list').replaceChildren();
    for(const row of result.candidates.filter(r=>(r.handle+' '+r.name).toLowerCase().includes(query))) {
      const li=document.createElement('li'),a=document.createElement('a'),name=document.createElement('span');
      a.href='https://x.com/'+row.handle.slice(1);a.target='_blank';a.rel='noopener noreferrer';a.textContent=row.handle;
      li.value=row.position;name.textContent=row.name;li.append(a,name);$('list').append(li);
    }
  }
  function finish(outcome,verified,reason) {
    result=outcome;finalVerified=verified;$('summary').hidden=false;
    $('resultTitle').textContent=verified?`未回关 · ${outcome.candidates.length}`:'名单未核实';
    $('resultTitle').className=verified?'ok':'error';
    $('counts').textContent=`@${owner}：正在关注 ${outcome.followingCount} / ${counts.following}，关注者 ${outcome.followerCount} / ${counts.followers}。`;
    $('status').textContent=reason;
    $('listSection').hidden=!verified;$('md').disabled=!verified;$('csv').disabled=!verified;
    if(verified) renderRows();
    show(verified?'核对完成':'核对未通过',reason,verified?100:90);
  }
  $('filter').addEventListener('input',()=>{if(result)renderRows()});
  $('md').addEventListener('click',()=>safeFile(markdown(),'text/markdown;charset=utf-8',`X未回关名单-${owner}.md`));
  $('csv').addEventListener('click',()=>safeFile(csv(result.candidates),'text/csv;charset=utf-8',`X未回关名单-${owner}.csv`));
  if(!Number.isSafeInteger(tabId)||tabId<=0) {show('请打开 X','请先在 Chrome 或 Edge 登录 X，切到 X 标签页后点击扩展图标。',0);return;}
  try {
    const tab=await chrome.tabs.get(tabId);startUrl=tab.url || '';
    if(!/^https:\/\/x\.com(?:\/|$)/i.test(startUrl)) throw new Error('请先切到已登录的 x.com 标签页再点击扩展图标。');
    await chrome.tabs.update(tabId,{active:true});
    const identity=await inspect('identity',null);
    owner=identity.owner;
    show('核对主页人数',`正在读取 @${owner} 的人数`,5);
    const profile=await navigate(owner,'profile');
    counts={following:XRunner.parseCount(profile.followingText),followers:XRunner.parseCount(profile.followersText)};
    const deadline=Date.now()+360000;
    let following=await scan('following',counts.following,{deadline});
    let followers=await scan('followers',counts.followers,{deadline});
    if(!following.complete && Date.now()<deadline) following=await scan('following',counts.following,{attempt:1,deadline});
    if(!followers.complete && Date.now()<deadline) followers=await scan('followers',counts.followers,{attempt:1,deadline});
    let ordered=null;
    if(following.complete && followers.complete) {
      ordered=await scan('following',counts.following,{ordered:true,deadline});
      if(!ordered.complete && Date.now()<deadline) ordered=await scan('following',counts.following,{ordered:true,attempt:1,deadline});
    }
    show('复核主页','正在检查账号和人数是否变化',94);
    const fresh=await navigate(owner,'profile');
    const freshCounts={following:XRunner.parseCount(fresh.followingText),followers:XRunner.parseCount(fresh.followersText)};
    if(freshCounts.following!==counts.following || freshCounts.followers!==counts.followers) throw new Error('扫描期间主页人数发生变化，请重新扫描。');
    if(!following.complete || !followers.complete || !ordered?.complete) {
      const reason=[!following.complete&&following.stalled,!followers.complete&&followers.stalled,ordered&&!ordered.complete&&ordered.stalled].filter(Boolean).join('；');
      finish({followingCount:following.rows.length,followerCount:followers.rows.length,candidates:[]},false,`名单未核实：${reason}。未生成未回关结论。`);
    } else {
      const outcome=XRunner.reconcile(ordered.rows,followers.rows,counts.following,counts.followers);
      finish(outcome,outcome.verified,outcome.verified?'两份名单与主页人数一致；已按“正在关注”页面顺序复核。':`完整名单存在 ${outcome.conflicts.length} 个关系标记冲突，未生成结论。`);
    }
  } catch(error) {
    $('summary').hidden=false;$('resultTitle').textContent='扫描未完成';$('resultTitle').className='error';$('status').textContent=error.message;
    show('扫描未完成',error.message,0);
  } finally {
    try {
      const tab=await chrome.tabs.get(tabId);
      const current=tab.url?.toLowerCase();
      if(owner && (current===`https://x.com/${owner.toLowerCase()}` || current===`https://x.com/${owner.toLowerCase()}/following` || current===`https://x.com/${owner.toLowerCase()}/followers`)) await chrome.tabs.update(tabId,{url:startUrl});
    } catch {}
    try {
      await chrome.action.setBadgeBackgroundColor({tabId,color:finalVerified?'#168040':'#bb3333'});
      await chrome.action.setBadgeText({tabId,text:finalVerified?'✓':'!'});
    } catch {}
    try { const resultTab=await chrome.tabs.getCurrent();if(resultTab?.id) await chrome.tabs.update(resultTab.id,{active:true}); } catch {}
  }
})();
