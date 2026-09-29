(() => {
  const PAGE_CHANNEL = "glossline-page-v1";
  const state = {
    settings: {
      enabled: true,
      learningLanguage: "de",
      nativeLanguage: "en",
      learningTrackId: "",
      nativeTrackId: "",
      fontScale: 1,
      verticalOffset: 12,
      learningOffset: 0,
      nativeOffset: 0,
      pauseOnHover: true,
      hideNative: false,
      adaptiveSpeed: false,
      dictationMode: false
    },
    tracks: new Map(),
    manifestTracks: [],
    successfulUrls: new Set(),
    inFlightUrls: new Map(),
    captureInFlightUrls: new Map(),
    manifestFetchCount: 0,
    capturedBodyCount: 0,
    documentFetchCount: 0,
    documentBodyCount: 0,
    documentManifestCount: 0,
    playbackTransitionCount: 0,
    generation: 0,
    pageKey: "",
    playbackId: "",
    video: null,
    host: null,
    root: null,
    elements: {},
    domCueText: "",
    learningCue: null,
    nativeCue: null,
    lastLearningKey: "",
    lastNativeText: "",
    lookupCard: null,
    flaggedWordSet: new Set(),
    knownLemmaSet: new Set(),
    dictationTargetText: "",
    dictationTargetCue: null,
    dictationReplaying: false,
    hoverPaused: false,
    translationRequests: new Map(),
    translationCache: new Map(),
    lastManifestKick: 0,
    tickTimer: null,
    domTimer: null,
    settingsLoaded: false,
    readyAnnounced: false,
    listenersAttached: false,
    lastParserError: "",
    lastParserErrorAt: 0,
    popoverAnchor: null,
    activationPromise: null
  };

  function isDemoPage() {
    return location.protocol === "chrome-extension:" && location.pathname.endsWith("/demo.html");
  }

  function isSupportedPlayerRoute() {
    if (isDemoPage()) return true;
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

  function isEditableTarget(event) {
    const target = event.composedPath?.()[0] || event.target;
    return Boolean(target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable='true']"));
  }

  function isAllowedSubtitleUrl(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (url.hostname === "primevideo.com" ||
          url.hostname.endsWith(".primevideo.com") ||
          url.hostname === "pv-cdn.net" ||
          url.hostname.endsWith(".pv-cdn.net"))
      );
    } catch {
      return false;
    }
  }

  function sendMessage(message, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      // chrome.runtime.sendMessage can hang forever when the service worker dies mid-request;
      // without a deadline that URL/sentence stays in-flight and, say, "Translating…" never
      // clears. Failing open lets the callers' finally blocks free their in-flight bookkeeping.
      const timer = setTimeout(() => reject(new Error("GlossLine timed out waiting for a response.")), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "GlossLine request failed."));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function injectOverlay() {
    if (state.host?.isConnected) return;
    const host = document.createElement("div");
    host.id = "glossline-root";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host{all:initial}
        *{box-sizing:border-box}
        /* The UA stylesheet's [hidden]{display:none} loses to any author display rule, and both
           .line and .dictation set one — so the attribute silently did nothing without this. */
        [hidden]{display:none !important}
        .stage{position:absolute;inset:0;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff}
        .subtitles{position:absolute;left:50%;bottom:calc(9% + var(--pl-offset,12px));width:min(92vw,1100px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:.32em;text-align:center;filter:drop-shadow(0 2px 6px rgba(0,0,0,.88));transition:bottom .2s ease}
        .line{display:inline;padding:.14em .42em;border-radius:.28em;background:rgba(4,9,17,.78);box-decoration-break:clone;-webkit-box-decoration-break:clone;line-height:1.34;letter-spacing:.01em;max-width:100%;pointer-events:auto}
        .learning{font-size:calc(30px * var(--pl-scale,1));font-weight:680;color:#fff}
        .native{font-size:calc(22px * var(--pl-scale,1));font-weight:520;color:#d8e4f3;transition:filter .15s,opacity .15s}
        .native.concealed,.learning.concealed{filter:blur(7px);opacity:.58;cursor:pointer;user-select:none}
        .native.concealed:hover,.native.concealed:focus{filter:none;opacity:1}
        .dictation{display:flex;flex-direction:column;align-items:center;gap:.3em;width:min(92vw,640px)}
        .dictation-input{width:100%;pointer-events:auto;padding:.24em .5em;border-radius:.28em;border:1px solid rgba(255,255,255,.35);background:rgba(4,9,17,.78);color:#fff;font:inherit;font-size:calc(24px * var(--pl-scale,1));outline:none}
        .dictation-input:focus{border-color:#f7b32b}
        .dictation-result{pointer-events:auto;font-size:calc(24px * var(--pl-scale,1));background:rgba(4,9,17,.78);padding:.14em .42em;border-radius:.28em}
        .dictation-result:empty{display:none}
        .dictation-actions{display:flex;gap:8px}
        .ctrl{all:unset;pointer-events:auto;cursor:pointer;padding:.28em .7em;border-radius:.4em;background:rgba(4,9,17,.72);border:1px solid rgba(255,255,255,.22);color:#e7eef8;font:600 13px/1.2 Inter,system-ui,sans-serif;opacity:.78;transition:opacity .15s,background .15s}
        .ctrl:hover,.ctrl:focus-visible{opacity:1;background:rgba(12,22,38,.92)}
        .controls{display:flex;justify-content:center}
        .diff-match{color:#8fe3ac}
        .diff-wrong-case{color:#f2c14e}
        .diff-missing{color:#ff8f7a;text-decoration:line-through;opacity:.85}
        .diff-extra{color:#9aa6b8;text-decoration:line-through}
        .word{all:unset;display:inline;cursor:pointer;border-radius:.16em;padding:0 .025em;pointer-events:auto;transition:background .12s,color .12s,transform .12s}
        .word.known{opacity:.55} .word.learning{border-bottom:2px solid #f7b32b} .learning.i-plus-one{outline:2px solid #53d18c;outline-offset:4px}
        .word:hover,.word:focus-visible{background:#f7b32b;color:#121820;outline:2px solid rgba(255,255,255,.8);outline-offset:1px;transform:translateY(-1px)}
        .status{position:absolute;top:18px;left:18px;display:flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(5,11,20,.78);box-shadow:0 8px 28px rgba(0,0,0,.25);font:600 12px/1.2 Inter,system-ui,sans-serif;color:#e7eef8;opacity:0;transform:translateY(-4px);transition:.2s}
        .status.visible{opacity:1;transform:none}
        .dot{width:8px;height:8px;border-radius:50%;background:#53d18c;box-shadow:0 0 0 3px rgba(83,209,140,.16)}
        .popover{position:fixed;width:min(390px,calc(100vw - 28px));max-height:min(560px,calc(100vh - 28px));overflow:auto;pointer-events:auto;color:#152033;background:#fbfcfe;border:1px solid rgba(20,32,51,.11);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.42);padding:18px;display:none;text-align:left;font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
        .popover.open{display:block;animation:appear .14s ease-out}
        @keyframes appear{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
        .pop-head{display:flex;align-items:flex-start;gap:10px}
        .title-wrap{min-width:0;flex:1}.word-title{margin:0;font-size:27px;line-height:1.1;color:#101827;overflow-wrap:anywhere}.pronunciation{margin-top:4px;color:#607089;font-size:13px}
        .icon-btn{appearance:none;border:0;border-radius:10px;background:#edf1f6;color:#26354a;min-width:34px;height:34px;padding:0 9px;cursor:pointer;font-weight:700}.icon-btn:hover{background:#e1e8f1}
        .entry{padding:13px 0;border-top:1px solid #e7ebf1}.entry:first-of-type{border-top:0}.pos{display:flex;gap:8px;align-items:center;margin-bottom:6px;color:#915f00;font-weight:750;text-transform:uppercase;font-size:11px;letter-spacing:.08em}.headword{color:#66758a;text-transform:none;letter-spacing:0;font-weight:500}
        .definition{margin:6px 0;color:#1b293c;list-style:none}.definition::before{content:counter(list-item) ". ";color:#9b6a0d;font-weight:700}.sense-choice{display:flex;gap:7px;align-items:baseline;cursor:pointer}.sense-choice input{accent-color:#9b6a0d;margin:0}.example{margin:6px 0 0 13px;padding-left:10px;border-left:2px solid #dfe5ed;color:#526176;font-size:12px}.example em{display:block;color:#77869a}
        .context{margin:12px 0;padding:11px 12px;border-radius:12px;background:#f0f4f8;color:#25344a}.context strong{display:block;color:#111c2d;margin-bottom:3px}.context .translation{color:#66758a;margin-top:4px}
        .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.action{appearance:none;border:0;border-radius:11px;padding:10px 12px;cursor:pointer;font-weight:720;background:#162238;color:#fff}.action.primary{background:#f7b32b;color:#1b1609}.action:hover{filter:brightness(1.05)}.action:disabled{opacity:.55;cursor:wait}
        .source{display:block;margin-top:12px;color:#61728a;font-size:11px}.source a{color:#345f9c}.error{padding:12px;border-radius:10px;background:#fff0ef;color:#9b2c28}.loading{color:#637188;padding:10px 0}
        .toast{position:absolute;right:18px;top:18px;max-width:360px;padding:11px 14px;border-radius:12px;background:#111d30;color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.35);font:600 13px/1.35 Inter,system-ui,sans-serif;opacity:0;transform:translateY(-6px);transition:.2s}.toast.visible{opacity:1;transform:none}.toast.error{background:#8b2724;color:#fff}
        @media (max-width:700px){.learning{font-size:calc(22px * var(--pl-scale,1))}.native{font-size:calc(17px * var(--pl-scale,1))}.subtitles{width:96vw}}
      </style>
      <div class="stage">
        <div class="status"><span class="dot"></span><span class="status-text" aria-live="polite">GlossLine ready</span></div>
        <div class="subtitles">
          <div class="line learning" lang="de"></div>
          <div class="dictation" hidden>
            <input class="dictation-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type what you heard, then press Enter" />
            <div class="dictation-actions">
              <button class="ctrl dictation-replay" type="button">↻ Listen again</button>
              <button class="ctrl dictation-reveal" type="button">Skip &amp; reveal</button>
            </div>
            <div class="dictation-result" aria-live="polite"></div>
          </div>
          <div class="line native" lang="en" tabindex="0" role="button" aria-expanded="false" aria-label="Native subtitle line — press Enter to reveal when hidden"></div>
          <div class="controls"><button class="ctrl replay" type="button" title="Replay this line (Alt+R)">↻ Replay line</button></div>
        </div>
        <section class="popover" role="dialog" aria-label="Word definition"></section>
        <div class="toast" role="status"></div>
      </div>`;

    state.host = host;
    state.root = root;
    state.elements = {
      stage: root.querySelector(".stage"),
      subtitles: root.querySelector(".subtitles"),
      learning: root.querySelector(".learning"),
      native: root.querySelector(".native"),
      dictation: root.querySelector(".dictation"),
      dictationInput: root.querySelector(".dictation-input"),
      dictationResult: root.querySelector(".dictation-result"),
      replay: root.querySelector(".replay"),
      dictationReplay: root.querySelector(".dictation-replay"),
      dictationReveal: root.querySelector(".dictation-reveal"),
      status: root.querySelector(".status"),
      statusText: root.querySelector(".status-text"),
      popover: root.querySelector(".popover"),
      toast: root.querySelector(".toast")
    };

    (document.body || document.documentElement).appendChild(host);
    applySettings();

    state.elements.learning.addEventListener("mouseenter", (event) => {
      if (event.isTrusted) pauseForHover();
    });
    state.elements.learning.addEventListener("mouseleave", (event) => {
      if (event.isTrusted) resumeAfterHover();
    });
    state.elements.native.addEventListener("click", (event) => {
      if (event.isTrusted) state.elements.native.classList.remove("concealed");
      syncNativeExpanded();
    });
    state.elements.native.addEventListener("keydown", (event) => {
      if (!event.isTrusted || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      state.elements.native.classList.remove("concealed");
      syncNativeExpanded();
    });
    state.elements.dictationInput.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.key !== "Enter") return;
      event.preventDefault();
      revealDictationDiff();
    });
    state.elements.replay.addEventListener("click", (event) => {
      if (event.isTrusted) replayLine();
    });
    state.elements.dictationReplay.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      replayDictationLine();
      state.elements.dictationInput.focus();
    });
    state.elements.dictationReveal.addEventListener("click", (event) => {
      if (event.isTrusted) revealDictationDiff();
    });
    // injectOverlay() re-runs after a body wipe (SPA replaces <body>). document-level listeners
    // survive that, so re-adding them here would stack N handlers per event — e.g. the popover
    // closing twice per click. The two document listeners are attached exactly once.
    if (!state.listenersAttached) {
      document.addEventListener("fullscreenchange", placeOverlayForFullscreen);
      document.addEventListener("pointerdown", closePopoverOnOutsideClick, true);
      state.listenersAttached = true;
    }
  }

  function placeOverlayForFullscreen() {
    if (!state.host) return;
    const parent = document.fullscreenElement || document.body || document.documentElement;
    if (state.host.parentNode === parent) return;
    // Fullscreen containers can reject adopted nodes (some players use closed shadow roots or
    // remove-then-replace the element between check and append); without the fallback the
    // overlay would vanish for the whole fullscreen session.
    try {
      parent.appendChild(state.host);
    } catch {
      document.body.appendChild(state.host);
    }
  }

  function applySettings() {
    if (!state.host) return;
    state.host.style.display = state.settings.enabled ? "block" : "none";
    state.elements.stage.style.setProperty("--pl-scale", String(Math.max(0.65, Math.min(1.8, state.settings.fontScale || 1))));
    state.elements.stage.style.setProperty("--pl-offset", `${Math.max(-80, Math.min(180, state.settings.verticalOffset || 0))}px`);
    state.elements.learning.lang = state.settings.learningLanguage || "";
    state.elements.native.lang = state.settings.nativeLanguage || "";
    state.elements.native.classList.toggle("concealed", Boolean(state.settings.hideNative));
    // updateCues() only ever writes playbackRate while adaptiveSpeed is on, so turning it off has
    // to reset the rate here — otherwise the last computed slowdown would stick indefinitely.
    if (!state.settings.adaptiveSpeed && state.video?.isConnected && state.video.playbackRate !== 1) {
      state.video.playbackRate = 1;
    }
    // Concealment tracks the setting alone, never the per-cue state: the line has to stay hidden
    // while a cue is playing too, or the learner just reads the answer instead of listening.
    state.elements.learning.classList.toggle("concealed", Boolean(state.settings.dictationMode));
    syncNativeExpanded();
    // handleDictationCueChange() only runs on a cue transition, so turning the toggle off mid-line
    // needs its own explicit cleanup rather than waiting for the next cue to clear it.
    if (!state.settings.dictationMode) clearDictationPrompt();
  }

  function clearDictationPrompt() {
    state.dictationTargetText = "";
    state.dictationTargetCue = null;
    state.dictationReplaying = false;
    if (state.elements.dictationResult) state.elements.dictationResult.replaceChildren();
    if (state.elements.dictationInput) state.elements.dictationInput.value = "";
    if (state.elements.dictation) state.elements.dictation.hidden = true;
  }

  // aria-expanded reflects the concealment toggle, not per-cue text — keyboard users need to
  // know whether the Enter-to-reveal affordance is currently meaningful.
  function syncNativeExpanded() {
    if (!state.elements.native) return;
    state.elements.native.setAttribute("aria-expanded", state.elements.native.classList.contains("concealed") ? "false" : "true");
  }

  function showStatus(message, duration = 2600) {
    if (!state.elements.status) return;
    state.elements.statusText.textContent = message;
    state.elements.status.classList.add("visible");
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => state.elements.status.classList.remove("visible"), duration);
  }

  function showToast(message, isError = false) {
    const toast = state.elements.toast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function findVideo() {
    // The largest video is cached until it leaves the DOM: re-scanning document on every 120 ms
    // tick forces style/layout for the sort and is the source of the SPA's per-tick jank.
    if (state.video?.isConnected) return state.video;
    const videos = [...document.querySelectorAll("video")];
    const candidate = videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
    state.video = candidate;
    return state.video;
  }

  function tokenize(text, language) {
    if (!text) return [];
    try {
      const segmenter = new Intl.Segmenter(language || undefined, { granularity: "word" });
      return [...segmenter.segment(text)].map((part) => ({ value: part.segment, word: part.isWordLike }));
    } catch {
      return String(text)
        .split(/([\p{L}\p{M}\p{N}'’\-]+)/gu)
        .filter(Boolean)
        .map((value) => ({ value, word: /[\p{L}\p{N}]/u.test(value) }));
    }
  }

  function normalizeFlagToken(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase();
  }

  // Flags a word the learner has previously saved (i.e. already found hard enough to look up) —
  // deliberately the opposite of a "known words" set. Checking for absence from a known-word list
  // would slow down nearly every real cue, since most common words (articles, "und", "ist", ...)
  // are never individually saved.
  // chrome.storage.local is restricted to trusted contexts by the service worker, so the overlay
  // asks it for the word list rather than reading storage directly.
  async function loadFlaggedWordSet() {
    const [{ words }, { lemmas }] = await Promise.all([
      sendMessage({ type: "GET_FLAGGED_WORDS" }, 4000),
      sendMessage({ type: "GET_KNOWN_LEMMAS" }, 4000)
    ]);
    state.flaggedWordSet = new Set(words.map(normalizeFlagToken));
    state.knownLemmaSet = new Set(lemmas.map(normalizeFlagToken));
  }

  // Hand-duplicated from src/dictation.js's diffWords (content.js cannot import from src/, so this
  // mirrors the tested canonical version — the same pattern already used for activeCueAt). A
  // longest-common-subsequence alignment, so a single missed or extra word does not misalign the
  // rest of the line the way a positional compare would.
  function diffDictationWords(typedWords, actualWords) {
    const typed = Array.isArray(typedWords) ? typedWords : [];
    const actual = Array.isArray(actualWords) ? actualWords : [];
    const equalCI = (a, b) => String(a).toLocaleLowerCase() === String(b).toLocaleLowerCase();
    const rows = typed.length;
    const cols = actual.length;
    const lcs = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
    for (let i = 1; i <= rows; i += 1) {
      for (let j = 1; j <= cols; j += 1) {
        lcs[i][j] = equalCI(typed[i - 1], actual[j - 1]) ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
    const result = [];
    let i = rows;
    let j = cols;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && equalCI(typed[i - 1], actual[j - 1])) {
        const exact = typed[i - 1] === actual[j - 1];
        result.push({ type: exact ? "match" : "wrong-case", actual: actual[j - 1], typed: typed[i - 1] });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        result.push({ type: "missing", actual: actual[j - 1] });
        j -= 1;
      } else {
        result.push({ type: "extra", typed: typed[i - 1] });
        i -= 1;
      }
    }
    result.reverse();
    return result;
  }

  function wordTokens(text) {
    return tokenize(text, state.settings.learningLanguage)
      .filter((token) => token.word)
      .map((token) => token.value);
  }

  // Quizzes on the cue that just finished playing, not the one about to start — dictation only
  // makes sense for audio the user has actually heard. Called whenever the active cue changes;
  // `justEndedCue` is state.learningCue captured before updateCues() overwrites it with the new one.
  function handleDictationCueChange(justEndedCue) {
    // A "listen again" replay makes the same cue go active and end a second time. Those two
    // transitions must not reset the prompt or retarget it, or the user's typing would vanish
    // the moment they asked to hear the line once more.
    if (state.dictationReplaying) {
      if (justEndedCue && justEndedCue === state.dictationTargetCue) {
        state.dictationReplaying = false;
        if (state.video?.isConnected) state.video.pause();
        state.elements.dictationInput?.focus();
      }
      return;
    }
    const wasHidden = state.elements.dictation?.hidden !== false;
    clearDictationPrompt();
    if (!justEndedCue?.text) return;
    state.dictationTargetText = justEndedCue.text;
    state.dictationTargetCue = justEndedCue;
    if (state.elements.dictation) state.elements.dictation.hidden = false;
    if (state.video?.isConnected) state.video.pause();
    // Focus only on the hidden→visible transition: re-focusing per cue would yank the focus
    // (and with it, IME state and selection) out from under keyboard users mid-session.
    if (wasHidden) state.elements.dictationInput?.focus();
  }

  // Alt+R and the replay button both land here: during dictation the line worth re-hearing is the
  // one being quizzed, which by then is no longer the active cue.
  function replayLine() {
    if (state.settings.dictationMode && state.dictationTargetCue) return replayDictationLine();
    return replayCurrentCue();
  }

  function replayDictationLine() {
    const cue = state.dictationTargetCue;
    const video = state.video?.isConnected ? state.video : findVideo();
    if (!cue || !video) return false;
    state.dictationReplaying = true;
    video.currentTime = Math.max(0, cue.start + Number(state.settings.learningOffset || 0) + 0.02);
    video.play().catch(() => {});
    return true;
  }

  function revealDictationDiff() {
    const input = state.elements.dictationInput;
    const resultEl = state.elements.dictationResult;
    if (!input || !resultEl || !state.dictationTargetText) return;
    const diff = diffDictationWords(wordTokens(input.value), wordTokens(state.dictationTargetText));
    resultEl.replaceChildren();
    for (const entry of diff) {
      const span = document.createElement("span");
      span.className = `diff-${entry.type}`;
      span.textContent = entry.type === "extra" ? entry.typed : entry.actual;
      resultEl.append(span, document.createTextNode(" "));
    }
    // Answering resumes playback: dictation pauses at every line, so without this the learner
    // would have to reach for the play button after each one.
    if (state.video?.isConnected) state.video.play().catch(() => {});
  }

  function renderLearningLine(text) {
    const line = state.elements.learning;
    if (!line || line.dataset.text === text) return;
    line.dataset.text = text;
    line.replaceChildren();
    for (const token of tokenize(text, state.settings.learningLanguage)) {
      if (!token.word) {
        line.append(document.createTextNode(token.value));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      // Word states come from the local model: "learning" = previously saved (flagged hard),
      // "known" = a lemma the learner once looked up. Pure highlighting — no auto-pause/jump.
      button.className = state.flaggedWordSet.has(normalizeFlagToken(token.value)) ? "word learning" : "word";
      if (state.knownLemmaSet.has(normalizeFlagToken(token.value))) button.classList.add("known");
      button.textContent = token.value;
      button.dataset.word = token.value;
      button.setAttribute("aria-label", `Define ${token.value}`);
      button.addEventListener("click", (event) => {
        if (event.isTrusted) openDictionary(event.currentTarget);
      });
      line.append(button);
    }
    line.hidden = !text;
  }

  function renderNativeLine(text) {
    const line = state.elements.native;
    if (!line || state.lastNativeText === text) return;
    state.lastNativeText = text;
    line.textContent = text;
    line.hidden = !text;
    line.classList.toggle("concealed", Boolean(state.settings.hideNative));
    syncNativeExpanded();
  }

  // Hand-copied twin of src/subtitles.js's activeCueAt (content.js is a classic script and cannot
  // import from src/). Semantics must stay identical: unsorted input, invalid bounds skipped,
  // end-exclusive matches, and the latest-starting overlap wins. test/content-parity.test.js
  // pins the two copies together — edit one without the other and that test fails.
  function activeCueAt(cues, time) {
    const target = Number(time);
    if (!Array.isArray(cues) || !Number.isFinite(target)) return null;
    let active = null;
    for (const cue of cues) {
      const valid =
        cue !== null &&
        typeof cue === "object" &&
        Number.isFinite(cue.start) &&
        (Number.isFinite(cue.end) || cue.end === Number.POSITIVE_INFINITY) &&
        cue.end >= cue.start;
      if (!valid) continue;
      if (cue.start <= target && target < cue.end && (!active || cue.start > active.start)) {
        active = cue;
      }
    }
    return active;
  }

  function chosenTrack(role) {
    const id = role === "learning" ? state.settings.learningTrackId : state.settings.nativeTrackId;
    if (id && state.tracks.has(id)) return state.tracks.get(id);
    const desiredLanguage = role === "learning" ? state.settings.learningLanguage : state.settings.nativeLanguage;
    return [...state.tracks.values()].find((track) => baseLanguage(track.language) === baseLanguage(desiredLanguage)) || null;
  }

  function baseLanguage(value) {
    return String(value || "").toLowerCase().split("-")[0];
  }

  function translationKey(text) {
    return `${baseLanguage(state.settings.learningLanguage)}:${baseLanguage(state.settings.nativeLanguage)}:${text}`;
  }

  function updateCues() {
    if (!syncPageLifecycle() || !state.settings.enabled || !state.elements.learning) return;
    const video = state.video?.isConnected ? state.video : findVideo();
    // loadPreferredManifestTracks() is idempotent for already-fetched URLs, but it still costs a
    // Map scan per call — at tick rate that is ~8 needless kicks/s. Once every 2 s is plenty for
    // late-arriving manifests.
    if (video && state.manifestTracks.length) {
      const now = Date.now();
      if (!state.lastManifestKick || now - state.lastManifestKick >= 2000) {
        state.lastManifestKick = now;
        loadPreferredManifestTracks();
      }
    }
    const time = video?.currentTime ?? 0;
    const learningTrack = chosenTrack("learning");
    const nativeTrack = chosenTrack("native");
    const learningCue = learningTrack
      ? activeCueAt(learningTrack.cues, time - Number(state.settings.learningOffset || 0))
      : state.domCueText
        ? { start: time, end: time + 1, text: state.domCueText }
        : null;
    let nativeCue = nativeTrack ? activeCueAt(nativeTrack.cues, time - Number(state.settings.nativeOffset || 0)) : null;

    const learningText = learningCue?.text || "";
    const cueKey = learningCue ? `${learningCue.start}:${learningCue.end}:${learningText}` : "";
    if (state.settings.dictationMode && cueKey !== state.lastLearningKey) {
      // state.learningCue is still the outgoing cue here — the reassignment below is what makes it
      // "previous" from this point on, so dictation mode must read it before that happens.
      handleDictationCueChange(state.learningCue);
    }

    state.learningCue = learningCue;
    state.nativeCue = nativeCue;
    if (state.settings.adaptiveSpeed && video && cueKey !== state.lastLearningKey) {
      const hasFlaggedWord = tokenize(learningText, state.settings.learningLanguage).some(
        (token) => token.word && token.value.length >= 2 && state.flaggedWordSet.has(normalizeFlagToken(token.value))
      );
      const targetRate = hasFlaggedWord ? 0.85 : 1;
      if (video.playbackRate !== targetRate) video.playbackRate = targetRate;
    }
    renderLearningLine(learningText);

    // Per-cue reading-level readout: how much of this line sits inside the learner's local
    // vocabulary, and when the line is exactly one unknown word past it — the classic i+1
    // sweet spot. Words never saved are neither known nor learning: absence from both sets
    // must stay neutral, since most function words are never individually saved.
    if (learningText && state.elements.statusText) {
      const tokens = wordTokens(learningText);
      const knownCount = tokens.filter((word) => state.knownLemmaSet.has(normalizeFlagToken(word))).length;
      const unknownTokens = tokens.filter((word) => !state.knownLemmaSet.has(normalizeFlagToken(word)));
      const knownPercent = tokens.length ? Math.round((knownCount / tokens.length) * 100) : 0;
      // i+1 only for the single genuinely unsaved unknown — a case-variant of a flagged word
      // already carries the learning class and does not count as new.
      const flaggedUnknown = unknownTokens.some((word) => state.flaggedWordSet.has(normalizeFlagToken(word)));
      const isIPlusOne = unknownTokens.length === 1 && !flaggedUnknown && tokens.length > 1;
      if (isIPlusOne) {
        const target = unknownTokens[0];
        const button = [...state.elements.learning.querySelectorAll("button.word")].find(
          (node) => (node.dataset.word || "").toLowerCase() === target.toLowerCase()
        );
        button?.classList.add("i-plus-one");
      }
      showStatus(isIPlusOne ? "1 new word" : `Known ${knownPercent}%`, 1800);
    }

    if (nativeCue?.text) {
      renderNativeLine(nativeCue.text);
    } else if (learningText) {
      const cacheKey = translationKey(learningText);
      const cached = state.translationCache.get(cacheKey);
      if (cached) {
        renderNativeLine(cached);
      } else if (state.settings.translationProvider !== "none") {
        renderNativeLine("Translating…");
        requestTranslation(learningText, cueKey, cacheKey);
      } else {
        // No native track and no provider: leave the lower line empty. An instruction sentence
        // in the subtitle position reads as if it were the translation of the current line.
        renderNativeLine("");
      }
    } else {
      renderNativeLine("");
    }
    state.lastLearningKey = cueKey;
  }

  async function requestTranslation(text, cueKey, cacheKey) {
    if (state.translationRequests.has(cacheKey)) return;
    const generation = state.generation;
    const request = sendMessage({
      type: "TRANSLATE_TEXT",
      text,
      source: baseLanguage(state.settings.learningLanguage),
      target: baseLanguage(state.settings.nativeLanguage)
    });
    const pending = { request, generation };
    state.translationRequests.set(cacheKey, pending);
    try {
      const response = await request;
      if (generation !== state.generation) return;
      state.translationCache.set(cacheKey, response.translatedText);
      while (state.translationCache.size > 250) state.translationCache.delete(state.translationCache.keys().next().value);
      if (
        translationKey(text) === cacheKey &&
        (state.lastLearningKey === cueKey || state.learningCue?.text === text)
      ) {
        renderNativeLine(response.translatedText);
      }
    } catch (error) {
      if (generation === state.generation && translationKey(text) === cacheKey && state.learningCue?.text === text) {
        renderNativeLine(`Translation unavailable · ${error.message}`);
      }
    } finally {
      if (state.translationRequests.get(cacheKey) === pending) state.translationRequests.delete(cacheKey);
    }
  }

  // Restores native caption nodes this extension dimmed (opacity + marker attribute). Every
  // exit path — extension disabled, unsupported route, real learning track chosen — must call
  // this, or a storefront page keeps its captions permanently invisible.
  function restoreHiddenCaptions() {
    document.querySelectorAll("[data-glossline-observed='true']").forEach((node) => {
      node.style.removeProperty("opacity");
      delete node.dataset.glosslineObserved;
    });
  }

  function detectNativeCaption() {
    if (!isSupportedPlayerRoute()) return;
    if (!state.settings.enabled) {
      restoreHiddenCaptions();
      state.domCueText = "";
      return;
    }
    if (!(state.video?.isConnected || findVideo())) return;
    const selectors = [
      ".atvwebplayersdk-captions-overlay",
      "[class*='captions-overlay']",
      "[class*='captionsOverlay']",
      "[data-testid*='subtitle']"
    ];
    let text = "";
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter((node) => !state.host?.contains(node));
      const visible = nodes.find((node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && node.textContent?.trim();
      });
      if (visible) {
        text = visible.textContent.replace(/\s+/g, " ").trim();
        visible.dataset.glosslineObserved = "true";
        visible.style.opacity = "0";
        break;
      }
    }
    if (text !== state.domCueText) {
      state.domCueText = text;
      if (text && !chosenTrack("learning")) updateCues();
    }
    // A real learning track must own the subtitle area: the DOM fallback must never compete with
    // it, so anything this extension hid while no track was loaded comes back now.
    if (chosenTrack("learning")) {
      restoreHiddenCaptions();
      state.domCueText = "";
    }
  }

  function pauseForHover() {
    if (!state.settings.pauseOnHover || state.elements.popover.classList.contains("open")) return;
    const video = state.video || findVideo();
    if (video && !video.paused) {
      state.hoverPaused = true;
      video.pause();
    }
  }

  function resumeAfterHover() {
    const video = state.video;
    if (state.hoverPaused && video && !state.elements.popover.classList.contains("open")) {
      state.hoverPaused = false;
      video.play().catch(() => {});
    }
  }

  function positionPopover(anchor) {
    const popover = state.elements.popover;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(390, window.innerWidth - 28);
    const left = Math.max(14, Math.min(window.innerWidth - width - 14, rect.left + rect.width / 2 - width / 2));
    const aboveSpace = Math.max(0, rect.top - 14);
    const belowSpace = Math.max(0, window.innerHeight - rect.bottom - 14);
    const above = aboveSpace > belowSpace;
    const availableHeight = Math.max(140, (above ? aboveSpace : belowSpace) - 10);
    popover.style.left = `${left}px`;
    popover.style.maxHeight = `${Math.min(560, availableHeight)}px`;
    popover.style.top = above ? "auto" : `${rect.bottom + 10}px`;
    popover.style.bottom = above ? `${window.innerHeight - rect.top + 10}px` : "auto";
  }

  async function openDictionary(anchor) {
    const word = anchor.dataset.word;
    const video = state.video || findVideo();
    if (video && !video.paused) video.pause();
    state.hoverPaused = false;
    const popover = state.elements.popover;
    popover.replaceChildren();
    popover.classList.add("open");
    positionPopover(anchor);
    state.popoverAnchor = anchor;
    const loading = document.createElement("div");
    loading.className = "loading";
    loading.textContent = `Looking up “${word}”…`;
    popover.append(loading);
    const loadingClose = element("button", "icon-btn", "Close");
    loadingClose.type = "button";
    loadingClose.addEventListener("click", (event) => {
      if (event.isTrusted) closePopover();
    });
    popover.append(loadingClose);
    loadingClose.focus();

    try {
      const { result } = await sendMessage({ type: "LOOKUP_WORD", word, languageCode: baseLanguage(state.settings.learningLanguage) });
      renderDictionary(result);
    } catch (error) {
      popover.replaceChildren();
      const message = document.createElement("div");
      message.className = "error";
      message.textContent = error.message;
      popover.append(message);
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderDictionary(result) {
    const popover = state.elements.popover;
    popover.replaceChildren();
    const head = element("div", "pop-head");
    const titleWrap = element("div", "title-wrap");
    titleWrap.append(element("h2", "word-title", result.word));
    const firstEntry = result.entries?.[0] || result.lemmaEntries?.[0];
    // Kaikki spreads pronunciation across entries: an inflected form often carries no audio while
    // its lemma does, and IPA and audio can sit on different entries. Searching every entry, then
    // the lemma's, recovers a reading or a recording that looking only at the first one misses.
    const pronunciationEntries = [...(result.entries || []), ...(result.lemmaEntries || [])];
    const ipa = pronunciationEntries.find((entry) => entry?.ipa)?.ipa || "";
    const audioUrl = pronunciationEntries.find((entry) => entry?.audioUrl)?.audioUrl || "";
    const pronunciation = [ipa, result.lemma ? `lemma: ${result.lemma}` : ""].filter(Boolean).join(" · ");
    if (pronunciation) titleWrap.append(element("div", "pronunciation", pronunciation));
    head.append(titleWrap);

    const speak = element("button", "icon-btn", "Listen");
    speak.type = "button";
    speak.title = "Pronounce word";
    speak.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(result.lemma || result.word);
      utterance.lang = state.settings.learningLanguage;
      speechSynthesis.speak(utterance);
    });
    const close = element("button", "icon-btn", "Close");
    close.type = "button";
    close.addEventListener("click", (event) => {
      if (event.isTrusted) closePopover();
    });
    head.append(speak, close);
    popover.append(head);

    const entries = (result.lemmaEntries?.length ? result.lemmaEntries : result.entries || []).slice(0, 4);
    if (!entries.length) {
      popover.append(element("div", "error", "No structured entry was found. Use the source link to inspect Wiktionary."));
    }
    const definitions = [];
    for (const entryData of entries) {
      const entry = element("section", "entry");
      const part = element("div", "pos", entryData.partOfSpeech || "entry");
      if (entryData.head) part.append(element("span", "headword", entryData.head));
      entry.append(part);
      const list = document.createElement("ol");
      list.style.margin = "0";
      list.style.paddingLeft = "22px";
      for (const definitionData of entryData.definitions.slice(0, 4)) {
        definitions.push(definitionData.gloss);
        const definition = element("li", "definition");
        // The card used to carry every gloss because the right sense was unknown at save time.
        // The learner picks the sense they actually met; Save/Send narrow definitions to that
        // one gloss, so distinct senses become distinct Anki cards instead of four-gloss mush.
        const choice = document.createElement("label");
        choice.className = "sense-choice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "sense";
        radio.value = definitionData.gloss;
        if (definitions.length === 1) radio.checked = true;
        choice.append(radio, document.createTextNode(definitionData.gloss));
        definition.append(choice);
        for (const exampleData of definitionData.examples || []) {
          const example = element("div", "example", exampleData.text);
          if (exampleData.translation) example.append(element("em", "", exampleData.translation));
          definition.append(example);
        }
        list.append(definition);
      }
      entry.append(list);
      popover.append(entry);
    }

    const context = element("div", "context");
    context.append(element("strong", "", "Current subtitle"));
    context.append(document.createTextNode(state.learningCue?.text || state.domCueText || ""));
    if (state.lastNativeText && state.lastNativeText !== "Translating…") context.append(element("div", "translation", state.lastNativeText));
    popover.append(context);

    state.lookupCard = {
      word: result.word,
      lemma: result.lemma || result.word,
      definitions,
      sentence: state.learningCue?.text || state.domCueText || "",
      translation: state.lastNativeText.startsWith("Translation unavailable") ? "" : state.lastNativeText,
      grammar: [firstEntry?.partOfSpeech, firstEntry?.head].filter(Boolean).join(" · "),
      partOfSpeech: firstEntry?.partOfSpeech || "",
      ipa,
      audioUrl,
      languageCode: baseLanguage(state.settings.learningLanguage),
      source: `${document.title} · ${formatTime(state.video?.currentTime || 0)} · ${safePageUrl()} | Dictionary: Kaikki / English Wiktionary (CC BY-SA 4.0) · ${result.sourceUrl}`,
      dictionarySource: result.sourceUrl,
      sourceUrl: safePageUrl(),
      sourceTimeSeconds: state.video?.currentTime || 0
    };

    const actions = element("div", "actions");
    // Both buttons narrow the card to the checked sense before saving: the saved card, the
    // Anki note, and the local vocabulary row must agree on which sense this card is.
    const withChosenSense = () => {
      const gloss = popover.querySelector("input[name='sense']:checked")?.value;
      return gloss ? { ...state.lookupCard, definitions: [gloss] } : state.lookupCard;
    };
    const save = element("button", "action primary", "Save word");
    save.type = "button";
    save.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      save.disabled = true;
      try {
        await sendMessage({ type: "SAVE_WORD", card: withChosenSense() });
        save.textContent = "Saved";
        showToast(`${result.word} saved to your word list.`);
        // Newly saved words should slow their next line down without waiting for a page reload.
        loadFlaggedWordSet().catch(() => {});
      } catch (error) {
        showToast(error.message, true);
      } finally {
        save.disabled = false;
      }
    });
    const anki = element("button", "action", "Send to Anki");
    anki.type = "button";
    anki.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      anki.disabled = true;
      anki.textContent = "Sending…";
      try {
        const response = await sendMessage({ type: "ADD_TO_ANKI", card: withChosenSense() });
        anki.textContent = "Added to Anki";
        showToast(
          response.appended
            ? `Added this sentence to your existing ${result.word} card.`
            : `${result.word} added to Anki.`
        );
      } catch (error) {
        anki.textContent = "Send to Anki";
        showToast(error.message, true);
      } finally {
        anki.disabled = false;
      }
    });
    actions.append(save, anki);
    popover.append(actions);

    const source = element("small", "source");
    source.append(document.createTextNode("Definitions: "));
    if (/^https:/.test(result.sourceUrl)) {
      const sourceLink = document.createElement("a");
      sourceLink.href = result.sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer";
      sourceLink.textContent = `${result.sourceName} · ${result.license}`;
      source.append(sourceLink);
    } else {
      // Dictionary metadata comes off the wire; a javascript:/data: href here would run in the
      // page on click. Anything that is not a plain https link renders as inert text.
      source.append(document.createTextNode(`${result.sourceName} · ${result.license}`));
    }
    popover.append(source);
    // Keyboard users land on Close first — the popover is dialog-like, and the entry list is
    // plain text. Focus returns to the word anchor when it closes (see closePopover).
    close.focus();
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function safePageUrl() {
    try {
      const url = new URL(location.href);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "Prime Video";
    }
  }

  function closePopover() {
    if (!state.elements.popover?.classList.contains("open")) return;
    state.elements.popover.classList.remove("open");
    // Dialog-style focus return: the anchor word is where the reader's attention lives.
    state.popoverAnchor?.focus?.();
    state.popoverAnchor = null;
  }

  function closePopoverOnOutsideClick(event) {
    if (!state.elements.popover?.classList.contains("open")) return;
    const path = event.composedPath();
    if (path.includes(state.host)) return;
    closePopover();
  }

  function addTrack(track, preferredRole = "") {
    if (!track?.id || !Array.isArray(track.cues)) return;
    state.tracks.set(track.id, track);
    const language = baseLanguage(track.language);
    if (preferredRole === "learning" || (!state.settings.learningTrackId && language === baseLanguage(state.settings.learningLanguage))) {
      state.settings.learningTrackId = track.id;
    } else if (preferredRole === "native" || (!state.settings.nativeTrackId && language === baseLanguage(state.settings.nativeLanguage))) {
      state.settings.nativeTrackId = track.id;
    }
    showStatus(`Captured ${track.label} · ${track.cues.length} cues`);
    updateCues();
  }

  function resetPlaybackState(nextPageKey = currentPageKey(), nextPlaybackId = "", reason = "Title changed") {
    state.generation += 1;
    state.tracks.clear();
    state.manifestTracks = [];
    state.successfulUrls.clear();
    state.inFlightUrls.clear();
    state.captureInFlightUrls.clear();
    state.manifestFetchCount = 0;
    state.capturedBodyCount = 0;
    // The document-wide caps (64 bodies / 200 manifests / 48 transitions / 48 fetches) guard
    // against runaway loops, not against honest use — without this reset a long binge silently
    // stops discovering subtitles partway through, with only a console.debug to show for it.
    state.documentFetchCount = 0;
    state.documentBodyCount = 0;
    state.documentManifestCount = 0;
    state.playbackTransitionCount = 0;
    state.pageKey = nextPageKey;
    state.playbackId = nextPlaybackId;
    state.domCueText = "";
    state.learningCue = null;
    state.nativeCue = null;
    state.lastLearningKey = "";
    state.lastNativeText = "__reset__";
    state.lookupCard = null;
    state.hoverPaused = false;
    // A rate computed for the previous title's last cue must not bleed into the next title.
    if (state.video?.isConnected && state.video.playbackRate !== 1) state.video.playbackRate = 1;
    // Likewise, a dictation quiz targeting the previous title's last line must not linger. The
    // concealed class is left to applySettings, which owns it — clearing it here would reveal the
    // line for the new title while dictation mode is still switched on.
    clearDictationPrompt();
    if (!state.tracks.has(state.settings.learningTrackId)) state.settings.learningTrackId = "";
    if (!state.tracks.has(state.settings.nativeTrackId)) state.settings.nativeTrackId = "";
    renderLearningLine("");
    renderNativeLine("");
    closePopover();
    if (reason) showStatus(`${reason} · discovering subtitles`);
  }

  function syncPageLifecycle() {
    const supported = isSupportedPlayerRoute();
    if (!supported) {
      if (state.host) state.host.style.display = "none";
      // Navigating player → storefront stops the cue timers; anything dimmed while the player
      // was active must be un-dimmed here or the storefront keeps invisible captions.
      restoreHiddenCaptions();
      clearInterval(state.tickTimer);
      clearInterval(state.domTimer);
      state.tickTimer = null;
      state.domTimer = null;
      return false;
    }
    if (state.host) state.host.style.display = state.settings.enabled ? "block" : "none";
    const pageKey = currentPageKey();
    if (!state.pageKey) state.pageKey = pageKey;
    else if (pageKey !== state.pageKey) resetPlaybackState(pageKey, "", "Prime title changed");
    return true;
  }

  function sanitizeManifestTracks(tracks) {
    return tracks
      .slice(0, 32)
      .map((track) => ({
        label: String(track?.label || "Subtitle").slice(0, 120),
        language: String(track?.language || "und").slice(0, 24),
        url: String(track?.url || "").slice(0, 4096)
      }))
      .filter((track) => isAllowedSubtitleUrl(track.url));
  }

  function preferredManifestTracks() {
    const selected = [];
    const selectedUrls = new Set();
    for (const language of [state.settings.learningLanguage, state.settings.nativeLanguage]) {
      const match = state.manifestTracks.find(
        (track) => baseLanguage(track.language) === baseLanguage(language) && !selectedUrls.has(track.url)
      );
      if (match) {
        selected.push(match);
        selectedUrls.add(match.url);
      }
    }
    return selected.slice(0, 2);
  }

  async function handlePageSubtitle(data) {
    if (!state.settings.enabled || !syncPageLifecycle() || !(state.video?.isConnected || findVideo())) return;
    const url = String(data.url || "").slice(0, 4096);
    const validDemoUrl = isDemoPage() && url.startsWith(`${location.origin}/demo-`);
    if ((!validDemoUrl && !isAllowedSubtitleUrl(url)) || state.successfulUrls.has(url)) return;
    if (state.captureInFlightUrls.has(url) || state.capturedBodyCount >= 12 || state.documentBodyCount >= 64) return;
    const generation = state.generation;
    state.captureInFlightUrls.set(url, generation);
    state.capturedBodyCount += 1;
    state.documentBodyCount += 1;
    try {
      const { track } = await sendMessage({
        type: "PARSE_SUBTITLE",
        payload: { text: data.body, url, contentType: String(data.contentType || "").slice(0, 160), source: "page" }
      });
      if (generation !== state.generation) return;
      state.successfulUrls.add(url);
      addTrack(track);
      state.lastParserError = "";
    } catch (error) {
      state.lastParserError = String(error?.message || error).slice(0, 200);
      state.lastParserErrorAt = Date.now();
      console.debug("GlossLine ignored a subtitle-shaped resource:", error.message);
    } finally {
      if (state.captureInFlightUrls.get(url) === generation) state.captureInFlightUrls.delete(url);
    }
  }

  async function loadPreferredManifestTracks() {
    if (!state.settings.enabled || !syncPageLifecycle() || !(state.video?.isConnected || findVideo())) return;
    const generation = state.generation;
    for (const metadata of preferredManifestTracks()) {
      if (generation !== state.generation) return;
      if (
        state.manifestFetchCount >= 8 ||
        state.documentFetchCount >= 48 ||
        state.successfulUrls.has(metadata.url) ||
        state.inFlightUrls.has(metadata.url)
      ) {
        continue;
      }
      state.inFlightUrls.set(metadata.url, generation);
      state.manifestFetchCount += 1;
      state.documentFetchCount += 1;
      try {
        const { track } = await sendMessage({
          type: "FETCH_SUBTITLE_URL",
          url: metadata.url,
          label: metadata.label,
          language: metadata.language
        });
        if (generation !== state.generation || state.successfulUrls.has(metadata.url)) continue;
        state.successfulUrls.add(metadata.url);
        addTrack(track);
        state.lastParserError = "";
      } catch (error) {
        state.lastParserError = String(error?.message || error).slice(0, 200);
        state.lastParserErrorAt = Date.now();
        console.debug("GlossLine could not load a declared subtitle track:", error.message);
      } finally {
        if (state.inFlightUrls.get(metadata.url) === generation) state.inFlightUrls.delete(metadata.url);
      }
    }
  }

  function handleSubtitleManifest(data) {
    if (!state.settings.enabled || !syncPageLifecycle()) return;
    if (data.pageKey && data.pageKey !== currentPageKey()) return;
    if (state.documentManifestCount >= 200) return;
    state.documentManifestCount += 1;
    const playbackId = String(data.playbackId || "").slice(0, 512);
    if (playbackId && state.playbackId && playbackId !== state.playbackId) {
      if (state.playbackTransitionCount >= 48) return;
      state.playbackTransitionCount += 1;
      resetPlaybackState(currentPageKey(), playbackId, "Prime episode changed");
    } else if (playbackId) {
      state.playbackId = playbackId;
    }
    state.manifestTracks = sanitizeManifestTracks(data.tracks);
    if (!state.manifestTracks.length) return;
    showStatus(
      `GlossLine found ${state.manifestTracks.length} subtitle track${state.manifestTracks.length === 1 ? "" : "s"}`
    );
    loadPreferredManifestTracks();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== PAGE_CHANNEL) return;
    if (data.type === "route-change") {
      activateForCurrentRoute();
      return;
    }
    if (data.type === "subtitle-manifest" && Array.isArray(data.tracks)) {
      handleSubtitleManifest({ ...data, tracks: data.tracks.slice(0, 32) });
      return;
    }
    if (data.type !== "subtitle-resource") return;
    if (typeof data.body !== "string" || data.body.length > 4 * 1024 * 1024) return;
    if (data.pageKey && data.pageKey !== currentPageKey()) return;
    handlePageSubtitle(data);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LOAD_TRACK") {
      if (!isSupportedPlayerRoute()) {
        sendResponse({ ok: false, error: "Open a supported Prime Video player before importing subtitles." });
        return;
      }
      // parseSubtitle() normally validates tracks, but the popup can push a track straight to
      // this listener with arbitrary JSON — so the shape is re-checked here rather than trusted.
      const roleOk = message.role === "learning" || message.role === "native";
      const track = message.track;
      const cuesOk =
        Array.isArray(track?.cues) &&
        track.cues.length <= 50_000 &&
        track.cues.every(
          (cue) =>
            cue !== null &&
            typeof cue === "object" &&
            Number.isFinite(cue.start) &&
            cue.start >= 0 &&
            Number.isFinite(cue.end) &&
            cue.end >= cue.start &&
            typeof cue.text === "string" &&
            cue.text.length <= 2000
        );
      if (!roleOk || typeof track?.id !== "string" || track.id.length < 1 || track.id.length > 240 || !cuesOk) {
        sendResponse({ ok: false, error: "Imported subtitle track is invalid." });
        return;
      }
      addTrack(message.track, message.role);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({
        ok: true,
        status: {
          videoFound: Boolean(state.video?.isConnected || findVideo()),
          currentTime: state.video?.currentTime || 0,
          tracks: [...state.tracks.values()].map(({ cues, ...track }) => ({ ...track, cueCount: cues.length })),
          settings: state.settings,
          currentLearningText: state.learningCue?.text || state.domCueText,
          currentNativeText: state.lastNativeText,
          // Diagnostics-only fields (see Copy diagnostics in the popup): deliberately no URLs,
          // no titles, no cue text — the report must be paste-safe in a public bug report.
          parserError: state.lastParserError ? `${state.lastParserError} (at ${new Date(state.lastParserErrorAt).toISOString()})` : "",
          manifestTrackCount: state.manifestTracks.length,
          adapterVersion: chrome.runtime.getManifest().version,
          domain: location.hostname
        }
      });
      return;
    }
    if (message?.type === "REPLAY_CURRENT") {
      replayCurrentCue();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "SEEK_TO") {
      // A new tab's content script needs a moment to attach, so this can legitimately fail on the
      // first attempt or two — respond ok:false explicitly (never leave the sender hanging) so the
      // background-side retry loop can tell "not ready yet" apart from "no listener at all".
      const video = state.video?.isConnected ? state.video : findVideo();
      if (!video || !isSupportedPlayerRoute()) {
        sendResponse({ ok: false, error: "No active Prime Video player to seek." });
        return;
      }
      video.currentTime = Math.max(0, Number(message.timeSeconds) || 0);
      video.play().catch(() => {});
      sendResponse({ ok: true });
      return;
    }
  });

  // Reads the physical key, not the character it produced. On macOS, Option+D types "∂" and
  // Option+R types "®", so matching on event.key silently broke every letter shortcut there (and
  // on any non-QWERTY layout). event.code is layout-independent; event.key is the fallback for
  // the rare environments that leave code empty.
  function shortcutLetter(event) {
    if (typeof event.code === "string" && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
    return typeof event.key === "string" && event.key.length === 1 ? event.key.toLowerCase() : "";
  }

  function replayCurrentCue() {
    const video = state.video || findVideo();
    if (!video || !state.learningCue) return false;
    video.currentTime = Math.max(0, state.learningCue.start + Number(state.settings.learningOffset || 0) + 0.02);
    video.play().catch(() => {});
    return true;
  }

  function jumpCue(direction) {
    const video = state.video || findVideo();
    const track = chosenTrack("learning");
    if (!video || !track?.cues.length) return false;
    const trackTime = video.currentTime - Number(state.settings.learningOffset || 0);
    const current = track.cues.findIndex((cue) => cue === state.learningCue || (trackTime >= cue.start && trackTime < cue.end));
    const next = track.cues[Math.max(0, Math.min(track.cues.length - 1, current + direction))];
    if (!next) return false;
    video.currentTime = Math.max(0, next.start + Number(state.settings.learningOffset || 0) + 0.02);
    return true;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.isTrusted || event.repeat || isEditableTarget(event)) return;
      if (event.key === "Escape") {
        closePopover();
        return;
      }
      if (!event.altKey || !state.settings.enabled || !syncPageLifecycle()) return;
      if (!(state.video?.isConnected || findVideo())) return;
      const letter = shortcutLetter(event);
      let handled = false;
      if (letter === "r") {
        handled = replayLine();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        handled = jumpCue(event.key === "ArrowLeft" ? -1 : 1);
      } else if (letter === "n") {
        state.settings.hideNative = !state.settings.hideNative;
        applySettings();
        chrome.storage.sync.set({ hideNative: state.settings.hideNative });
        handled = true;
      } else if (letter === "d") {
        state.settings.dictationMode = !state.settings.dictationMode;
        applySettings();
        chrome.storage.sync.set({ dictationMode: state.settings.dictationMode });
        handled = true;
      }
      if (handled) event.preventDefault();
    },
    true
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, change] of Object.entries(changes)) state.settings[key] = change.newValue;
    if (changes.learningLanguage && state.settings.learningTrackId) {
      const track = state.tracks.get(state.settings.learningTrackId);
      if (!track || baseLanguage(track.language) !== baseLanguage(state.settings.learningLanguage)) {
        state.settings.learningTrackId = "";
      }
    }
    if (changes.nativeLanguage && state.settings.nativeTrackId) {
      const track = state.tracks.get(state.settings.nativeTrackId);
      if (!track || baseLanguage(track.language) !== baseLanguage(state.settings.nativeLanguage)) {
        state.settings.nativeTrackId = "";
      }
    }
    applySettings();
    refreshTimers();
    loadPreferredManifestTracks();
    updateCues();
  });

  function refreshTimers() {
    const shouldRun = state.settings.enabled && isSupportedPlayerRoute();
    if (shouldRun) {
      if (!state.tickTimer) state.tickTimer = setInterval(updateCues, 120);
      if (!state.domTimer) state.domTimer = setInterval(detectNativeCaption, 180);
      return;
    }
    clearInterval(state.tickTimer);
    clearInterval(state.domTimer);
    state.tickTimer = null;
    state.domTimer = null;
    detectNativeCaption();
  }

  async function activateForCurrentRoute() {
    if (!isSupportedPlayerRoute()) {
      syncPageLifecycle();
      refreshTimers();
      return;
    }
    if (state.activationPromise) return state.activationPromise;
    state.activationPromise = (async () => {
      if (!state.pageKey) state.pageKey = currentPageKey();
      else syncPageLifecycle();
      injectOverlay();
      if (!state.settingsLoaded) {
        try {
          const { settings } = await sendMessage({ type: "GET_SETTINGS" }, 4000);
          state.settings = { ...state.settings, ...settings };
          state.settingsLoaded = true;
        } catch (error) {
          showToast(error.message, true);
        }
      }
      loadFlaggedWordSet().catch(() => {});
      if (!isSupportedPlayerRoute()) {
        syncPageLifecycle();
        refreshTimers();
        return;
      }
      applySettings();
      findVideo();
      refreshTimers();
      if (!state.readyAnnounced) {
        state.readyAnnounced = true;
        showStatus("GlossLine ready · turn on target-language subtitles");
      }
    })();
    try {
      await state.activationPromise;
    } finally {
      state.activationPromise = null;
    }
  }

  window.addEventListener("popstate", activateForCurrentRoute);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", activateForCurrentRoute, { once: true });
  else activateForCurrentRoute();
})();
