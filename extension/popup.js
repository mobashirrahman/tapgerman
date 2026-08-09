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
    node.addEventListener("input", () => {
      settings[key] = mode === "checked" ? node.checked : mode === "number" ? Number(node.value) : node.value;
      updateOutputs();
      scheduleSave();
    });
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
    const selected = select.value;
    select.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = placeholder;
    select.append(automatic);
    for (const track of pageStatus?.tracks || []) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = `${track.label} · ${track.cueCount} cues`;
      select.append(option);
    }
    select.value = selected || (selector === "#learning-track" ? settings.learningTrackId : settings.nativeTrackId) || "";
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
    await tabMessage({ type: "LOAD_TRACK", track, role });
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
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.dataset.tab === name));
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
  try {
    const { words } = await runtimeMessage({ type: "GET_LAPSED_WORDS" });
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
        watch.addEventListener("click", async () => {
          watch.disabled = true;
          watch.textContent = "Opening…";
          try {
            await runtimeMessage({
              type: "WATCH_SCENE",
              sourceUrl: card.sourceUrl,
              sourceTimeSeconds: card.sourceTimeSeconds
            });
          } catch (error) {
            setSaveState(error.message, true);
          } finally {
            watch.disabled = false;
            watch.textContent = "Watch scene";
          }
        });
        row.append(watch);
      }
      list.append(row);
    }
  } catch {
    panel.hidden = true;
  }
}

function renderVocabulary() {
  $("#word-count").textContent = vocabulary.length;
  const container = $("#vocabulary");
  container.replaceChildren();
  container.classList.toggle("empty", !vocabulary.length);
  if (!vocabulary.length) {
    const message = document.createElement("p");
    message.textContent = "Click a word in the upper subtitle, then choose “Save word”.";
    container.append(message);
    return;
  }
  for (const card of vocabulary.slice(0, 100)) {
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
    anki.addEventListener("click", async () => {
      anki.disabled = true;
      try {
        await runtimeMessage({ type: "ADD_TO_ANKI", card });
        anki.textContent = "Added";
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
    remove.addEventListener("click", async () => {
      await runtimeMessage({ type: "DELETE_WORD", id: card.id });
      vocabulary = vocabulary.filter((entry) => entry.id !== card.id);
      renderVocabulary();
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
}

function exportVocabulary() {
  if (!vocabulary.length) return setSaveState("There are no saved words to export.", true);
  const header = ["#separator:Tab", "#html:true", "#columns:Word\tMeaning\tSentence\tTranslation\tGrammar\tSource\tTags"];
  const rows = vocabulary.map((card) =>
    [card.word, card.definitions?.join("\n") || card.meaning, card.sentence, card.translation, card.grammar, card.source, `lexicue language::${card.languageCode}`]
      .map(toAnkiTsvCell)
      .join("\t")
  );
  const url = URL.createObjectURL(new Blob([[...header, ...rows].join("\n")], { type: "text/tab-separated-values;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lexicue-anki-${new Date().toISOString().slice(0, 10)}.txt`;
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
        "AnkiConnect access was denied. Approve LexiCue in Anki; if no dialog appears, remove its origin from ignoreOriginList in the add-on configuration."
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
  $("#export-words").addEventListener("click", exportVocabulary);
  $("#test-anki").addEventListener("click", testAnki);
  $("#open-demo").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("demo.html") }));

  try {
    settings = (await runtimeMessage({ type: "GET_SETTINGS" })).settings;
    if (settings.nativeLanguage !== "en") {
      settings.nativeLanguage = "en";
      settings = (await runtimeMessage({ type: "SAVE_SETTINGS", settings })).settings;
    }
    renderSettings();
  } catch (error) {
    setSaveState(error.message, true);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id || null;
  await Promise.all([refreshPageStatus(), loadVocabulary()]);
}

init();
