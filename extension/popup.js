import { requestAnkiPermission, toAnkiTsvCell } from "./src/anki.js";

const LANGUAGES = [
  ["de", "German"], ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["it", "Italian"],
  ["pt", "Portuguese"], ["pl", "Polish"], ["nl", "Dutch"], ["sv", "Swedish"], ["ru", "Russian"],
  ["tr", "Turkish"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"]
];
const NATIVE_LANGUAGES = [["en", "English"]];
const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;

const $ = (selector) => document.querySelector(selector);
let settings = {};
let activeTabId = null;
let pageStatus = null;
let vocabulary = [];
let saveTimer = null;
let vocabularyLimit = 100;

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "Request failed."));
      resolve(response);
    });
  });
}

function tabMessage(message) {
  return new Promise((resolve, reject) => {
    if (!activeTabId) return reject(new Error("No active tab."));
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "Prime Video did not respond."));
      resolve(response);
    });
  });
}

function setSaveState(message, isError = false) {
  const node = $("#save-state");
  node.textContent = message;
  node.classList.toggle("error", isError);
}

function populateLanguages() {
  for (const [selector, languages] of [
    ["#learning-language", LANGUAGES],
    ["#native-language", NATIVE_LANGUAGES]
  ]) {
    const select = $(selector);
    for (const [code, name] of languages) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${name} · ${code}`;
      select.append(option);
    }
  }
  // sanitizeSettings() forces nativeLanguage back to "en"; a selectable list implies a choice it
  // would silently discard, so the control is disabled until multi-native support ships.
  $("#native-language").disabled = true;
}

function bindSettings() {
  const bindings = {
    "#enabled": ["enabled", "checked"],
    "#learning-language": ["learningLanguage", "value"],
    "#native-language": ["nativeLanguage", "value"],
    "#learning-track": ["learningTrackId", "value"],
    "#native-track": ["nativeTrackId", "value"],
    "#pause-on-hover": ["pauseOnHover", "checked"],
    "#hide-native": ["hideNative", "checked"],
    "#adaptive-speed": ["adaptiveSpeed", "checked"],
    "#dictation-mode": ["dictationMode", "checked"],
    "#font-scale": ["fontScale", "number"],
    "#vertical-offset": ["verticalOffset", "number"],
    "#learning-offset": ["learningOffset", "number"],
    "#native-offset": ["nativeOffset", "number"],
    "#translation-provider": ["translationProvider", "value"],
    "#libre-endpoint": ["libreTranslateEndpoint", "value"],
    "#libre-key": ["libreTranslateApiKey", "value"],
    "#anki-deck": ["ankiDeck", "value"],
    "#anki-api-key": ["ankiApiKey", "value"]
  };
  for (const [selector, [key, mode]] of Object.entries(bindings)) {
    const node = $(selector);
    const apply = () => {
      settings[key] = mode === "checked" ? node.checked : mode === "number" ? Number(node.value) : node.value;
      updateOutputs();
      scheduleSave();
    };
    // Selects and checkboxes fire "change" at the committed value; "input" fires per keystroke
    // and (before Chrome 127) even mid-navigation for selects, racing SAVE_SETTINGS whole-object
    // writes with testAnki's parallel save. Text/range keep "input" for live feel, debounced.
    const event = mode === "value" && node.tagName === "SELECT" ? "change" : mode === "checked" ? "change" : "input";
    node.addEventListener(event, apply);
  }
}

function renderSettings() {
  const values = {
    "#enabled": [settings.enabled, "checked"],
    "#learning-language": [settings.learningLanguage, "value"],
    "#native-language": [settings.nativeLanguage, "value"],
    "#learning-track": [settings.learningTrackId || "", "value"],
    "#native-track": [settings.nativeTrackId || "", "value"],
    "#pause-on-hover": [settings.pauseOnHover, "checked"],
    "#hide-native": [settings.hideNative, "checked"],
    "#adaptive-speed": [settings.adaptiveSpeed, "checked"],
    "#dictation-mode": [settings.dictationMode, "checked"],
    "#font-scale": [settings.fontScale, "value"],
    "#vertical-offset": [settings.verticalOffset, "value"],
    "#learning-offset": [settings.learningOffset, "value"],
    "#native-offset": [settings.nativeOffset, "value"],
    "#translation-provider": [settings.translationProvider, "value"],
    "#libre-endpoint": [settings.libreTranslateEndpoint, "value"],
    "#libre-key": [settings.libreTranslateApiKey, "value"],
    "#anki-deck": [settings.ankiDeck, "value"],
    "#anki-api-key": [settings.ankiApiKey, "value"]
  };
  for (const [selector, [value, property]] of Object.entries(values)) {
    if ($(selector)) $(selector)[property] = value ?? "";
  }
  updateOutputs();
}

function updateOutputs() {
  $("#font-output").textContent = `${Math.round(Number($("#font-scale").value) * 100)}%`;
  const offset = Number($("#vertical-offset").value);
  $("#offset-output").textContent = `${offset >= 0 ? "+" : ""}${offset} px`;
  for (const role of ["learning", "native"]) {
    const timing = Number($(`#${role}-offset`).value);
    $(`#${role}-offset-output`).textContent = `${timing > 0 ? "+" : ""}${timing.toFixed(1)} s`;
  }
  document.querySelectorAll(".libre-setting").forEach((node) => node.classList.toggle("hidden", settings.translationProvider !== "libretranslate"));
}

function scheduleSave() {
  setSaveState("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const response = await runtimeMessage({ type: "SAVE_SETTINGS", settings });
      settings = response.settings;
      setSaveState("Saved.");
    } catch (error) {
      setSaveState(error.message, true);
    }
  }, 180);
}

function renderTracks() {
  for (const [selector, placeholder] of [
    ["#learning-track", "Auto-detect / visible Prime subtitle"],
    ["#native-track", "Translate upper line when no track matches"]
  ]) {
    const select = $(selector);
    select.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = placeholder;
    select.append(automatic);
    for (const track of pageStatus?.tracks || []) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = `${track.label} · ${track.language} · ${track.cueCount} cues`;
      select.append(option);
    }
    const stored = selector === "#learning-track" ? settings.learningTrackId : settings.nativeTrackId;
    const overlayChosen =
      (selector === "#learning-track" ? pageStatus?.settings?.learningTrackId : pageStatus?.settings?.nativeTrackId) || "";
    // The overlay auto-selects a matching track in memory (addTrack) but does not persist it —
    // persisting from content would write-loop with this popup's storage listener. So the popup
    // displays what the overlay actually chose when it knows, else the stored preference.
    const wanted = overlayChosen || stored || "";
    if (wanted && [...select.options].some((option) => option.value === wanted)) {
      select.value = wanted;
    } else {
      // A stored id the player no longer offers (episode changed, track gone) falls back to
      // Auto; persist that once so the stale id does not resurface next open.
      select.value = "";
      if (stored && pageStatus) {
        settings[selector === "#learning-track" ? "learningTrackId" : "nativeTrackId"] = "";
        scheduleSave();
      }
    }
  }
}

function renderPageStatus(error) {
  const card = $("#page-status");
  const strong = card.querySelector("strong");
  const small = card.querySelector("small");
  card.classList.remove("ready", "warning");
  if (error) {
    card.classList.add("warning");
    strong.textContent = "Open a Prime Video player";
    small.textContent = "The extension activates on supported Prime/Amazon video pages.";
  } else if (pageStatus?.videoFound) {
    card.classList.add("ready");
    strong.textContent = `${pageStatus.tracks.length} subtitle track${pageStatus.tracks.length === 1 ? "" : "s"} ready`;
    small.textContent = pageStatus.tracks.length ? "Choose tracks below, or leave Auto selected." : "Play the title and enable its target-language captions.";
  } else {
    card.classList.add("warning");
    strong.textContent = "Prime page found — waiting for playback";
    small.textContent = "Start a film or episode to discover its subtitle tracks.";
  }
}

async function importFile(input, role) {
  const file = input.files?.[0];
  if (!file) return;
  setSaveState(`Reading ${file.name}…`);
  try {
    if (file.size > MAX_SUBTITLE_BYTES) throw new Error("Subtitle files must be 4 MiB or smaller.");
    const { track } = await runtimeMessage({
      type: "PARSE_SUBTITLE",
      payload: { text: await file.text(), filename: file.name, label: `${file.name} · imported`, source: "import" }
    });
    try {
      await tabMessage({ type: "LOAD_TRACK", track, role });
    } catch (loadError) {
      // Parse succeeded; only the push to a player tab failed (no Prime tab, wrong window).
      // Silently dropping here wasted a successful parse — say what the user can do next.
      setSaveState("Parsed OK — open a Prime player or the demo to load it.", true);
      input.value = "";
      return;
    }
    settings[role === "learning" ? "learningTrackId" : "nativeTrackId"] = track.id;
    await runtimeMessage({ type: "SAVE_SETTINGS", settings });
    await refreshPageStatus();
    renderSettings();
    setSaveState(`${file.name} loaded.`);
  } catch (error) {
    setSaveState(error.message, true);
  } finally {
    input.value = "";
  }
}

// Collects everything a bug report needs without anything identification-adjacent: no page
// URLs, no titles, no cue text, and the two API keys are stripped. Diagnostics that leak
// subtitles would not get pasted into a public issue — hence the field whitelist.
async function copyDiagnostics() {
  try {
    const [page, settingsResponse] = await Promise.all([
      tabMessage({ type: "GET_PAGE_STATUS" }).catch(() => null),
      runtimeMessage({ type: "GET_SETTINGS" })
    ]);
    const { libreTranslateApiKey: _lt, ankiApiKey: _ak, ankiApiKeyRequired: _ar, ...safeSettings } = settingsResponse.settings;
    const report = {
      extensionVersion: chrome.runtime.getManifest().version,
      settings: safeSettings,
      page: page
        ? {
            supported: Boolean(page.tracks?.length) || page.videoFound,
            domain: page.domain,
            videoFound: page.videoFound,
            manifestTrackCount: page.manifestTrackCount,
            capturedTrackCount: page.tracks?.length || 0,
            tracks: (page.tracks || []).map((track) => ({ id: track.id, label: track.label, language: track.language, cueCount: track.cueCount })),
            parserError: page.parserError || ""
          }
        : "No LingoDeck player tab is open — open a Prime player or the demo, then copy again."
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setSaveState("Diagnostics copied — paste into a bug report.");
  } catch (error) {
    setSaveState(`Diagnostics copied failed: ${error.message}`, true);
  }
}

async function refreshPageStatus() {
  try {
    const response = await tabMessage({ type: "GET_PAGE_STATUS" });
    pageStatus = response.status;
    renderPageStatus();
    renderTracks();
  } catch (error) {
    renderPageStatus(error);
  }
}

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((node) => {
    const selected = node.dataset.tab === name;
    node.classList.toggle("active", selected);
    node.setAttribute("aria-selected", selected ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((node) => node.classList.toggle("active", node.id === `tab-${name}`));
  if (name === "words") {
    loadVocabulary();
    loadLapsedWords();
  }
}

async function loadVocabulary() {
  try {
    vocabulary = (await runtimeMessage({ type: "GET_VOCABULARY" })).vocabulary;
    renderVocabulary();
  } catch (error) {
    setSaveState(error.message, true);
  }
}

// Fetched only when the Words tab is actually opened, not on every popup launch — unlike
// GET_VOCABULARY (pure local storage), this needs a live AnkiConnect round trip, and popup
// startup shouldn't be slowed down or show an error banner just because Anki isn't running.
async function loadLapsedWords() {
  const panel = $("#lapsed-panel");
  const list = $("#lapsed-list");
  let words = [];
  try {
    words = (await runtimeMessage({ type: "GET_LAPSED_WORDS", days: 1 })).words;
  } catch {
    // Anki being closed is normal, not an error — but hiding the panel entirely reads as "no
    // lapses". Say what still works without Anki.
    panel.hidden = true;
    list.replaceChildren();
    setSaveState("Anki is not running — saved words still export to TSV.", true);
    return;
  }
  list.replaceChildren();
  panel.hidden = !words.length;
  for (const card of words) {
    const row = document.createElement("div");
    row.className = "lapsed-item";
    const word = document.createElement("span");
    word.className = "lapsed-word";
    word.textContent = card.word;
    row.append(word);
    if (card.sourceUrl) {
      const watch = document.createElement("button");
      watch.className = "tiny";
      watch.type = "button";
      watch.textContent = "Watch scene";
      watch.setAttribute("aria-label", `Open the scene for ${card.word}`);
      watch.addEventListener("click", async () => {
        watch.disabled = true;
        watch.textContent = "Opening…";
        try {
          const { seeked } = await runtimeMessage({
            type: "WATCH_SCENE",
            sourceUrl: card.sourceUrl,
            sourceTimeSeconds: card.sourceTimeSeconds,
            days: 1
          });
          if (seeked) {
            watch.textContent = "Opened ✓";
          } else {
            // The player tab opened but never answered a SEEK_TO retry; the user must seek
            // manually. The card's stored offset gives them the exact spot.
            const seconds = Math.max(0, Math.floor(Number(card.sourceTimeSeconds) || 0));
            const mm = Math.floor(seconds / 60);
            const ss = String(seconds % 60).padStart(2, "0");
            watch.textContent = `Opened — seek to ${mm}:${ss}`;
          }
        } catch (error) {
          setSaveState(error.message, true);
        } finally {
          watch.disabled = false;
        }
      });
      row.append(watch);
    }
    list.append(row);
  }
}

function renderVocabulary() {
  $("#word-count").textContent = vocabulary.length;
  const container = $("#vocabulary");
  container.replaceChildren();
  container.classList.toggle("empty", !vocabulary.length);
  if (!vocabulary.length) {
    vocabularyLimit = 100;
    const message = document.createElement("p");
    message.textContent = "Click a word in the upper subtitle, then choose “Save word”.";
    container.append(message);
    return;
  }
  const shown = vocabulary.slice(0, vocabularyLimit);
  const summary = document.createElement("p");
  summary.className = "vocab-summary";
  summary.textContent = `Showing ${shown.length} of ${vocabulary.length}`;
  container.append(summary);
  for (const card of shown) {
    const node = document.createElement("article");
    node.className = "word-card";
    const head = document.createElement("div");
    head.className = "word-card-head";
    const title = document.createElement("h3");
    title.textContent = card.word;
    const actions = document.createElement("div");
    actions.className = "word-actions";
    const anki = document.createElement("button");
    anki.className = "tiny";
    anki.type = "button";
    anki.textContent = "Anki";
    anki.setAttribute("aria-label", `Send ${card.word} to Anki`);
    anki.addEventListener("click", async () => {
      anki.disabled = true;
      try {
        const response = await runtimeMessage({ type: "ADD_TO_ANKI", card });
        // The toast in the overlay distinguishes these; the button must too, or a sentence
        // append leaves the button claiming a new card was created.
        anki.textContent = response.appended ? "Added sentence" : "Added ✓";
      } catch (error) {
        setSaveState(error.message, true);
      } finally {
        anki.disabled = false;
      }
    });
    const remove = document.createElement("button");
    remove.className = "tiny delete";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${card.word} from your word list`);
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await runtimeMessage({ type: "DELETE_WORD", id: card.id });
        vocabulary = vocabulary.filter((entry) => entry.id !== card.id);
        renderVocabulary();
      } catch (error) {
        setSaveState(error.message, true);
      } finally {
        remove.disabled = false;
      }
    });
    actions.append(anki, remove);
    head.append(title, actions);
    node.append(head);
    const meaning = document.createElement("p");
    meaning.className = "meaning";
    meaning.textContent = card.definitions?.slice(0, 2).join(" · ") || card.meaning || "No definition saved";
    node.append(meaning);
    if (card.sentence) {
      const sentence = document.createElement("p");
      sentence.className = "sentence";
      sentence.textContent = card.sentence;
      node.append(sentence);
    }
    container.append(node);
  }
  if (vocabulary.length > shown.length) {
    const more = document.createElement("button");
    more.className = "tiny";
    more.type = "button";
    more.textContent = "Show more";
    more.addEventListener("click", () => {
      vocabularyLimit += 100;
      renderVocabulary();
    });
    container.append(more);
  }
}

function exportVocabulary() {
  if (!vocabulary.length) return setSaveState("There are no saved words to export.", true);
  const header = ["#separator:Tab", "#html:true", "#columns:Word\tMeaning\tSentence\tTranslation\tGrammar\tSource\tTags"];
  const rows = vocabulary.map((card) =>
    [card.word, card.definitions?.join("\n") || card.meaning, card.sentence, card.translation, card.grammar, card.source, `lingodeck language::${card.languageCode}`]
      .map(toAnkiTsvCell)
      .join("\t")
  );
  const url = URL.createObjectURL(new Blob([[...header, ...rows].join("\n")], { type: "text/tab-separated-values;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lingodeck-anki-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function testAnki() {
  const button = $("#test-anki");
  const badge = $("#anki-badge");
  button.disabled = true;
  badge.className = "badge";
  badge.textContent = "Connecting…";
  try {
    clearTimeout(saveTimer);
    const permissionRequest = requestAnkiPermission();
    const settingsSave = runtimeMessage({ type: "SAVE_SETTINGS", settings });
    const [permission, saved] = await Promise.all([permissionRequest, settingsSave]);
    settings = saved.settings;
    if (permission.permission !== "granted") {
      throw new Error(
        "AnkiConnect access was denied. Approve LingoDeck in Anki; if no dialog appears, remove its origin from ignoreOriginList in the add-on configuration."
      );
    }
    if (permission.requireApiKey && !settings.ankiApiKey) {
      throw new Error("AnkiConnect requires an API key. Enter it above and test again.");
    }
    const { status } = await runtimeMessage({ type: "ANKI_STATUS", requireApiKey: permission.requireApiKey });
    badge.className = "badge good";
    badge.textContent = `Connected · API ${status.version}${status.requireApiKey ? " · key" : ""}`;
    setSaveState(status.requireApiKey ? "AnkiConnect is ready and the API key was accepted." : "AnkiConnect is ready.");
  } catch (error) {
    badge.className = "badge bad";
    badge.textContent = "Not connected";
    setSaveState(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  $("#version").textContent = `v${chrome.runtime.getManifest().version}`;
  populateLanguages();
  bindSettings();
  document.querySelectorAll(".tab").forEach((node) => node.addEventListener("click", () => activateTab(node.dataset.tab)));
  $("#learning-file").addEventListener("change", (event) => importFile(event.target, "learning"));
  $("#native-file").addEventListener("change", (event) => importFile(event.target, "native"));
  // The file inputs are visually hidden inside their labels; the label is the keyboard
  // surface, so Enter/Space must open the browser's file picker like a click would.
  for (const [labelId, inputId] of [
    ["#learning-file", "#learning-file"],
    ["#native-file", "#native-file"]
  ]) {
    const label = document.querySelector(`label[for='${labelId.slice(1)}']`);
    const input = $(inputId);
    label?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
  }
  $("#export-words").addEventListener("click", exportVocabulary);
  $("#test-anki").addEventListener("click", testAnki);
  $("#copy-diagnostics").addEventListener("click", copyDiagnostics);
  $("#open-demo").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("demo.html") }));
  // The store build excludes demo.* (a bundled page loading a remote MP4 is what review
  // scrutinizes); when the file is absent, HEAD fails and the button hides. Dev keeps it.
  fetch(chrome.runtime.getURL("demo.html"), { method: "HEAD" }).catch(() => {
    $("#open-demo").hidden = true;
  });

  // Content scripts toggle Alt+N / Alt+D by writing storage.sync directly; a popup open at that
  // moment would otherwise show stale checkboxes until reopen.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    renderSettings();
    renderTracks();
  });
  // Re-query on tab switch and window refocus: GET_PAGE_STATUS speaks to a captured tab id, and
  // the user's idea of "the page" changes with focus without the popup closing.
  chrome.tabs.onActivated.addListener((info) => {
    activeTabId = info.tabId;
    refreshPageStatus();
  });
  window.addEventListener("focus", () => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        activeTabId = tab.id;
        refreshPageStatus();
      }
    });
  });

  // Controls are hidden until real settings arrive; the blank-controls state briefly shows
  // provider defaults that the stored values then contradict (the "MyMemory-first flash").
  const main = document.querySelector("main");
  main.setAttribute("inert", "");
  main.classList.add("loading-settings");
  try {
    settings = (await runtimeMessage({ type: "GET_SETTINGS" })).settings;
    if (settings.nativeLanguage !== "en") {
      settings.nativeLanguage = "en";
      settings = (await runtimeMessage({ type: "SAVE_SETTINGS", settings })).settings;
    }
    renderSettings();
  } catch (error) {
    setSaveState(error.message, true);
  } finally {
    main.removeAttribute("inert");
    main.classList.remove("loading-settings");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id || null;
  await Promise.all([refreshPageStatus(), loadVocabulary()]);
}

init();
