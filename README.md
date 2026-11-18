# Tiny Strange VIS

The visual identity booklet site for Tiny Strange, an independent design toy brand from China. Soft Friends is its collectible plush series.

**Live site:** [https://tiny-strange-vis.pages.dev/](https://tiny-strange-vis.pages.dev/)

## What's on the site

The page is a single scrolling booklet: 24 content chapters, a product film, a scroll-driven packaging animation, and a real-time folding model of the gift box.

It is static HTML, CSS, and JavaScript. There is no build step.

```
index.html          Booklet entry
styles.css          Layout and typography
swarm.js            Cursor swarm animation
rejects.js          Rejects chapter interaction
assets/             Images, fonts, and the product film
box-scroll-test/    Scroll-driven packaging sequence
box-fold/           Interactive folding chapter
_headers            Cloudflare Pages cache rules
```

## Local preview

Serve the repository root, then open `/`.

```bash
python -m http.server 8000
```

Or:

```bash
npx --yes serve .
```

The packaging sequence preloads compressed 1080p frame packs (about 84.5 MB on first visit). 4K frames load only when playback is at rest.

## Deploy

Production is the Cloudflare Pages project `tiny-strange-vis`, published from the `main` branch. The site root is the repository root.

Typography uses Fraunces and Sofia Sans. The colour palette is Cocoa `#4A3833`, Mist `#EABFC0`, Oat `#DDCDB8`, Cream `#F6F0E7`, Deep `#241B18`, and Lime `#B7D84B`.
