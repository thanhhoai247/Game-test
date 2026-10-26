# Mintegral ad creatives – Caller ID: Identify & Block

Static image ads for `com.blockcall.id.spam.filter.app` (Solaris Digital Studio),
built from the app's own Play Store icon and screenshots (`assets/`).

3 concepts × 7 sizes = 21 PNGs in `output/`:

| Concept | Headline | Screenshot used |
|---|---|---|
| `block` | BLOCK / UNWANTED CALLS | Block list |
| `callerid` | IDENTIFY / UNKNOWN CALLERS | Caller ID call log |
| `sms` | KEEP SPAM / OUT OF MESSAGES | Spam messages |

Sizes: 1200x628, 480x320, 300x250, 320x480, 720x1280, 1080x1920, 320x50.

Regenerate: `cd src && node build.js` (needs Playwright + Chromium).
Edit copy in the `CONCEPTS` object in `src/build.js`.
