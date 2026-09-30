chrome.action.onClicked.addListener(async tab => {
  const url = new URL(chrome.runtime.getURL('results.html'));
  const onX=Boolean(tab.id && /^https:\/\/x\.com(?:\/|$)/i.test(tab.url || ''));
  if (onX) {
    url.searchParams.set('tabId', String(tab.id));
    try {
      await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#1d9bf0'});
      await chrome.action.setBadgeText({tabId:tab.id,text:'RUN'});
    } catch {}
  }
  await chrome.tabs.create({url:url.href,active:!onX});
});
