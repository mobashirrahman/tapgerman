## What this changes

<!-- A short description, and the issue it closes if there is one. -->

## How it was verified

- [ ] `npm run verify` passes
- [ ] Loaded unpacked from `extension/` and exercised the change in the browser
- [ ] Checked against real Prime Video playback (say so if you could not)

## Checklist

- [ ] Host permissions and content-script matches are unchanged, or the new host is justified below
- [ ] No new data leaves the browser, or the new request is documented in `PRIVACY.md`
- [ ] `extension/manifest.json` and `package.json` versions still match
- [ ] If `diffWords` changed, the twin in `extension/content.js` was updated with it
- [ ] `CHANGELOG.md` updated for user-visible changes
