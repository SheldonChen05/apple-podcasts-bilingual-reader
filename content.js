(() => {
  if (window.__applePodcastSyncInstalled) return;
  window.__applePodcastSyncInstalled = true;
  let last = -1, lastEp = "";
  const timer = setInterval(() => {
    // 扩展重新加载后，旧脚本仍在页面里运行但已无法访问 chrome.* API
    if (!chrome.runtime?.id) { clearInterval(timer); return; }
    const audios = [...document.querySelectorAll("audio")];
    const audio = audios.find(a => !a.paused) || audios.find(a => a.currentSrc) || audios[0];
    if (!audio) return;
    const t = Number(audio.currentTime || 0);
    const md = navigator.mediaSession?.metadata;
    const title = md?.title || "", show = md?.artist || "";
    const ep = title + "|" + show + "|" + audio.currentSrc;
    if (!Number.isFinite(t) || (Math.abs(t-last) < 0.15 && ep === lastEp)) return;
    last = t; lastEp = ep;
    const link = document.querySelector('[data-testid="player-bar"] a[href*="?i="]');
    try {
      chrome.storage.local.set({
        applePodcastSync: {
          currentTime: t,
          duration: Number(audio.duration || 0),
          paused: Boolean(audio.paused),
          page: location.href,
          title,
          show,
          src: audio.currentSrc || "",
          episodeLink: link ? link.href : "",
          updatedAt: Date.now()
        }
      });
    } catch {
      clearInterval(timer);
    }
  }, 250);
})();
