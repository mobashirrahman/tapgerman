(() => {
  const german = `<?xml version="1.0" encoding="UTF-8"?>
  <tt xmlns="http://www.w3.org/ns/ttml" xml:lang="de"><body><div>
    <p begin="0s" end="3s">Diese Blumen wachsen in einem ruhigen Garten.</p>
    <p begin="3s" end="6s">Das Sonnenlicht bewegt sich über die Blätter.</p>
    <p begin="6s" end="9s">Manchmal erkennt man Schönheit erst beim zweiten Blick.</p>
    <p begin="9s" end="12s">Neue Wörter bleiben durch echte Szenen im Gedächtnis.</p>
    <p begin="12s" end="15s">Hör genau hin und sprich den Satz noch einmal.</p>
  </div></body></tt>`;
  const english = `<?xml version="1.0" encoding="UTF-8"?>
  <tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div>
    <p begin="0s" end="3s">These flowers grow in a peaceful garden.</p>
    <p begin="3s" end="6s">The sunlight moves across the leaves.</p>
    <p begin="6s" end="9s">Sometimes you only notice beauty on a second look.</p>
    <p begin="9s" end="12s">New words stick through real scenes.</p>
    <p begin="12s" end="15s">Listen closely and say the sentence once more.</p>
  </div></body></tt>`;

  function publish(url, body) {
    window.postMessage(
      { source: "glossline-page-v1", type: "subtitle-resource", url, contentType: "application/ttml+xml", body },
      window.location.origin
    );
  }

  setTimeout(() => {
    publish(`${location.origin}/demo-de.ttml`, german);
    publish(`${location.origin}/demo-en.ttml`, english);
  }, 500);

  // The overlay only listens while it is active, and page-hook's successfulUrls set runs in the
  // content script — a re-publish is harmless there but vital when activation lands late (e.g.
  // the extension was reloaded after the demo page already opened). Republish for a bounded
  // window, then stop.
  let republishCount = 0;
  const republishTimer = setInterval(() => {
    republishCount += 1;
    if (republishCount > 6) {
      clearInterval(republishTimer);
      return;
    }
    publish(`${location.origin}/demo-de.ttml`, german);
    publish(`${location.origin}/demo-en.ttml`, english);
  }, 1000);

  const video = document.querySelector("video");
  video?.addEventListener("timeupdate", () => {
    if (video.currentTime >= 14.9) video.currentTime = 0;
  });
})();
