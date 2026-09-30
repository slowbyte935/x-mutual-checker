(function (root) {
  'use strict';
  const validHandle = /^@[A-Za-z0-9_]{1,15}$/;
  function parseCount(value) {
    const text = String(value).trim();
    const match = text.match(/^([0-9][0-9,]*)(?![0-9,.])/);
    if (!match || /^[.KMB万亿千]/i.test(text.slice(match[1].length))) throw new Error('主页人数不是精确数字：' + text.slice(0, 40));
    const count = Number(match[1].replaceAll(',', ''));
    if (!Number.isSafeInteger(count)) throw new Error('主页人数无法核对。');
    return count;
  }
  // Serialized by chrome.scripting.executeScript. Everything this function uses is local to it.
  function readPage(mode, expectedOwner) {
    const ownLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]') ||
      [...document.querySelectorAll('header a[href], nav a[href]')].find(a => ['个人资料', 'Profile'].includes(a.textContent.trim()) && /^\/[A-Za-z0-9_]{1,15}\/?$/.test(a.getAttribute('href') || ''));
    const ownPath = ownLink?.getAttribute('href')?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    const owner = ownPath?.[1] || null;
    if (!owner) return {ready:false, reason:'未检测到已登录的 X 账号。'};
    if (expectedOwner && owner.toLowerCase() !== expectedOwner.toLowerCase()) return {ready:false, fatal:'检测到登录账号已切换，已停止扫描。'};
    if (mode === 'identity') return {ready:true, owner};
    const path = location.pathname.toLowerCase();
    if (mode === 'profile') {
      if (path !== '/' + expectedOwner.toLowerCase()) return {ready:false};
      const links = [...document.querySelectorAll('main a[href]')];
      const following = links.find(a => a.getAttribute('href')?.toLowerCase() === '/' + expectedOwner.toLowerCase() + '/following');
      const followers = links.find(a => ['/verified_followers','/followers'].some(s => a.getAttribute('href')?.toLowerCase() === '/' + expectedOwner.toLowerCase() + s));
      if (!following || !followers) return {ready:false};
      return {ready:true, owner, followingText:following.textContent.trim(), followersText:followers.textContent.trim()};
    }
    if (path !== '/' + expectedOwner.toLowerCase() + '/' + mode) return {ready:false};
    const names = mode === 'following' ? ['正在关注','Following'] : ['关注者','Followers'];
    const region = [...document.querySelectorAll('main [role="region"]')].find(e => names.includes(e.getAttribute('aria-label')) || names.includes(e.querySelector('h1')?.textContent.trim()));
    if (!region) return {ready:false};
    const rows = [...region.querySelectorAll('[data-testid="UserCell"]')].map(cell => {
      const links = [...cell.querySelectorAll('a[href]')];
      const account = links.find(a => /^@[A-Za-z0-9_]{1,15}$/.test(a.textContent.trim()) && a.getAttribute('href')?.toLowerCase() === '/' + a.textContent.trim().slice(1).toLowerCase());
      if (!account) return null;
      const handle = account.textContent.trim();
      const name = links.find(a => a.getAttribute('href')?.toLowerCase() === account.getAttribute('href').toLowerCase() && a.textContent.trim() && !a.textContent.trim().startsWith('@'))?.textContent.trim() || handle;
      const followsYou = [...cell.querySelectorAll('span,div')].some(e => ['关注了你','Follows you'].includes(e.textContent.trim()));
      const youFollow = [...cell.querySelectorAll('button')].some(b => ['正在关注','Following'].includes(b.textContent.trim()) || ['正在关注 ' + handle, 'Following ' + handle].some(t => b.getAttribute('aria-label')?.toLowerCase() === t.toLowerCase()));
      return {handle,name:name.slice(0,200),followsYou,youFollow};
    }).filter(Boolean);
    const isScrollable = element => element && element.scrollHeight > element.clientHeight + 8 && /auto|scroll|overlay/.test(getComputedStyle(element).overflowY);
    let scroll = null;
    for (let element=region; element && element!==document.documentElement; element=element.parentElement) {
      if (isScrollable(element)) { scroll=element; break; }
    }
    if (!scroll && document.scrollingElement.scrollHeight <= innerHeight + 8) {
      const firstCell=region.querySelector('[data-testid="UserCell"]');
      scroll=[...region.querySelectorAll('*')].find(element => element.contains(firstCell) && isScrollable(element)) || null;
    }
    scroll ||= document.scrollingElement;
    const viewport=scroll===document.scrollingElement ? innerHeight : scroll.clientHeight;
    return {ready:true, owner, rows, visible:document.visibilityState==='visible', atBottom: scroll.scrollHeight - scroll.scrollTop - viewport < 8, busy: Boolean(region.querySelector('[role="progressbar"]')), scrollTop:scroll.scrollTop, scrollHeight:scroll.scrollHeight, viewport, scrollRoot:scroll===document.scrollingElement?'document':'nested'};
  }
  async function scrollPage(kind, direction, fraction, waitMs=180) {
    const names=kind==='following'?['正在关注','Following']:['关注者','Followers'];
    const region=[...document.querySelectorAll('main [role="region"]')].find(e => names.includes(e.getAttribute('aria-label')) || names.includes(e.querySelector('h1')?.textContent.trim()));
    if (!region) return {moved:false};
    const isScrollable=element=>element && element.scrollHeight>element.clientHeight+8 && /auto|scroll|overlay/.test(getComputedStyle(element).overflowY);
    let scroll=null;
    for(let element=region;element && element!==document.documentElement;element=element.parentElement){if(isScrollable(element)){scroll=element;break;}}
    if(!scroll && document.scrollingElement.scrollHeight<=innerHeight+8){const firstCell=region.querySelector('[data-testid="UserCell"]');scroll=[...region.querySelectorAll('*')].find(element=>element.contains(firstCell)&&isScrollable(element))||null;}
    scroll ||= document.scrollingElement;
    const viewport=scroll===document.scrollingElement?innerHeight:scroll.clientHeight;
    const before=scroll.scrollTop;
    if(direction==='top') scroll.scrollTop=0;
    else if(direction!=='hold') scroll.scrollTop += (direction==='up'?-1:1)*Math.max(80,Math.floor(viewport*fraction));
    if(waitMs>0) await new Promise(resolve=>setTimeout(resolve,waitMs));
    return {moved:scroll.scrollTop!==before,scrollTop:scroll.scrollTop};
  }
  function merge(map, rows) {
    for (const row of rows) {
      if (!validHandle.test(row.handle)) continue;
      const key = row.handle.toLowerCase(), prior = map.get(key);
      map.set(key,{...prior,...row,followsYou:Boolean(prior?.followsYou || row.followsYou),youFollow:Boolean(prior?.youFollow || row.youFollow)});
    }
  }
  function reconcile(followingRows, followerRows, expectedFollowing, expectedFollowers) {
    const following = new Map(), followers = new Map();
    merge(following,followingRows); merge(followers,followerRows);
    const orderedFollowing=[...following.values()].sort((a,b)=>a.position-b.position);
    const orderVerified=orderedFollowing.every((row,index)=>row.position===index+1);
    const complete=following.size===expectedFollowing && followers.size===expectedFollowers && orderVerified;
    const conflicts=complete?orderedFollowing.filter(row=>row.followsYou && !followers.has(row.handle.toLowerCase())):[];
    const candidates=complete?orderedFollowing.filter(row=>!row.followsYou && !followers.has(row.handle.toLowerCase())):[];
    return {verified:complete && conflicts.length===0,followingCount:following.size,followerCount:followers.size,orderVerified,conflicts:conflicts.map(r=>r.handle),candidates};
  }
  root.XRunner={parseCount,readPage,scrollPage,merge,reconcile};
  if (typeof module !== 'undefined') module.exports=root.XRunner;
})(globalThis);
