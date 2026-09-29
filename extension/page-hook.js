(() => {
  const CHANNEL = "glossline-page-v1";
  const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;
  const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
  const MAX_TRACKS = 32;
  const subtitlePattern = /(?:\.ttml2?|\.dfxp|\.vtt|\.srt)(?:$|[?#])/i;

  function isSupportedPlayerRoute() {
    const path = location.pathname.toLowerCase();
    if (location.hostname.endsWith(".primevideo.com") || location.hostname === "primevideo.com") {
      return /(?:^|\/)detail(?:\/|$)/.test(path);
    }
    return /^\/gp\/video\/(?:detail|watch)(?:\/|$)/.test(path);
  }

  function currentPageKey() {
    // Search params belong in the identity: Amazon swaps the ASIN via query string on some
    // routes without changing the path, and those swaps must reset the captured tracks.
    return `${location.origin}${location.pathname}${location.search}`;
  }

  function playbackIdFromUrl(value, pageKey) {
    try {
      const url = new URL(value, location.href);
      const entry = [...url.searchParams].find(([key]) => ["asin", "titleid", "title_id"].includes(key.toLowerCase()));
      return String(entry?.[1] || pageKey).slice(0, 512);
    } catch {
      return pageKey;
    }
  }

  async function readBoundedText(response, maximumBytes) {
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maximumBytes) return "";
    const copy = response.clone();
    if (!copy.body?.getReader) {
      const text = await copy.text();
      return text.length <= maximumBytes ? text : "";
    }

    const reader = copy.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return "";
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  }

  function publishRouteChange() {
    window.postMessage(
      { source: CHANNEL, type: "route-change", pageKey: currentPageKey() },
      window.location.origin
    );
  }

  for (const method of ["pushState", "replaceState"]) {
    const nativeMethod = history[method];
    if (typeof nativeMethod !== "function") continue;
    history[method] = function glosslineHistoryChange(...args) {
      const result = nativeMethod.apply(this, args);
      queueMicrotask(publishRouteChange);
      return result;
    };
  }
  window.addEventListener("popstate", publishRouteChange);

  function looksLikeSubtitle(url, contentType = "") {
    const target = String(url || "");
    // DASH manifests and other XML sidecars share generic XML media types with real
    // TTML tracks. Letting them through captures them, fails parsing downstream, and
    // burns the per-load capture budget in content.js before the real tracks arrive —
    // the cold-start-no-subtitles failure. Real player-fetched subtitle files carry a
    // subtitle extension; extensionless TTML still loads via the manifest path, whose
    // validation is unchanged.
    if (/\.mpd([?#]|$)/i.test(target)) {
      return false;
    }
    if (subtitlePattern.test(target)) {
      return true;
    }
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (type.includes("dash")) {
      return false;
    }
    return (
      type === "text/vtt" ||
      type === "application/ttml+xml" ||
      type === "application/ttml" ||
      type.includes("subrip")
    );
  }

  function publish(url, body, contentType, pageKey) {
    if (typeof body !== "string" || !body.trim() || body.length > MAX_SUBTITLE_BYTES) return;
    // Belt-and-braces for mislabeled responses that pass the URL/type check: without
    // a timing marker this body fails parsing downstream and burns capture budget.
    if (!/(-->|WEBVTT|<\s*tt[\s>])/i.test(body.slice(0, 8192))) return;
    window.postMessage(
      {
        source: CHANNEL,
        type: "subtitle-resource",
        url: String(url || ""),
        contentType: String(contentType || ""),
        pageKey,
        body
      },
      window.location.origin
    );
  }

  function publishManifest(url, body, pageKey) {
    if (!String(url).includes("GetVodPlaybackResources") || typeof body !== "string" || body.length > MAX_MANIFEST_BYTES) return;
    try {
      const payload = JSON.parse(body);
      const rawTracks = payload?.timedTextUrls?.result?.subtitleUrls;
      if (!Array.isArray(rawTracks)) return;
      const tracks = rawTracks
        .slice(0, MAX_TRACKS)
        .map((track) => ({
          label: String(track?.displayName || track?.languageCode || "Subtitle").slice(0, 120),
          language: String(track?.languageCode || "und").slice(0, 24),
          url: String(track?.url || "").slice(0, 4096)
        }))
        .filter((track) => /^https:\/\//.test(track.url));
      if (!tracks.length) return;
      // Two pathnames collide across episodes that share the first two subtitle assets; four
      // tracks + a 512-char cap keeps the fallback discriminative without unbounded growth.
      const trackFingerprint = tracks
        .slice(0, 4)
        .map((track) => {
          try {
            return new URL(track.url).pathname;
          } catch {
            return track.url;
          }
        })
        .join("|")
        .slice(0, 512);
      window.postMessage(
        {
          source: CHANNEL,
          type: "subtitle-manifest",
          pageKey,
          playbackId: playbackIdFromUrl(url, trackFingerprint || pageKey),
          tracks
        },
        window.location.origin
      );
    } catch {
      // Playback-resource responses can include unrelated/non-JSON bodies.
    }
  }

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    window.fetch = async function glosslineFetch(...args) {
      const requestPageKey = currentPageKey();
      const response = await nativeFetch.apply(this, args);
      try {
        if (!isSupportedPlayerRoute()) return response;
        const requestedUrl =
          typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0]?.url;
        const contentType = response.headers.get("content-type") || "";
        if (looksLikeSubtitle(response.url || requestedUrl, contentType)) {
          readBoundedText(response, MAX_SUBTITLE_BYTES)
            .then((body) => publish(response.url || requestedUrl, body, contentType, requestPageKey))
            .catch(() => {});
        }
        if (String(response.url || requestedUrl).includes("GetVodPlaybackResources")) {
          readBoundedText(response, MAX_MANIFEST_BYTES)
            .then((body) => publishManifest(response.url || requestedUrl, body, requestPageKey))
            .catch(() => {});
        }
      } catch {
        // Subtitle capture is best-effort and must never disturb playback.
      }
      return response;
    };
  }

  const NativeXHR = window.XMLHttpRequest;
  if (NativeXHR?.prototype) {
    const nativeOpen = NativeXHR.prototype.open;
    const nativeSend = NativeXHR.prototype.send;

    NativeXHR.prototype.open = function glosslineOpen(method, url, ...rest) {
      this.__glosslineUrl = String(url || "");
      this.__glosslinePageKey = currentPageKey();
      return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXHR.prototype.send = function glosslineSend(...args) {
      this.addEventListener(
        "load",
        () => {
          try {
            if (!isSupportedPlayerRoute()) return;
            const contentType = this.getResponseHeader("content-type") || "";
            const responseUrl = this.responseURL || this.__glosslineUrl;
            const shouldReadSubtitle = looksLikeSubtitle(responseUrl, contentType);
            const shouldReadManifest = String(responseUrl).includes("GetVodPlaybackResources");
            if (!shouldReadSubtitle && !shouldReadManifest) return;
            const responseBody =
              this.responseType === "" || this.responseType === "text"
                ? this.responseText
                : this.responseType === "json" && this.response
                  ? JSON.stringify(this.response)
                  : "";
            if (
              shouldReadSubtitle &&
              responseBody
            ) {
              publish(responseUrl, responseBody, contentType, this.__glosslinePageKey);
            }
            if (shouldReadManifest) {
              publishManifest(responseUrl, responseBody, this.__glosslinePageKey);
            }
          } catch {
            // Some XHR responses do not expose responseText; ignore them.
          }
        },
        { once: true }
      );
      return nativeSend.apply(this, args);
    };
  }
})();
