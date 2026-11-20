'use strict';
/**
 * Builds the standalone prototype: the whole app (back end + UI) in ONE html file
 * that runs in any browser with no server. Data is kept in that browser.
 *
 *   npm run build  ->  dist/muratab.html            (open directly in a browser)
 *                      dist/muratab.artifact.html   (body-only variant for embedding)
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const swap = { crypto: 'web/crypto-browser.js', storage: 'web/storage-browser.js' };

const swapNodeModules = {
  name: 'swap-node-modules',
  setup(build) {
    build.onResolve({ filter: /^\.\/(crypto|storage)(\.js)?$/ }, (args) => {
      if (!args.importer.startsWith(path.join(root, 'src'))) return undefined;
      const name = args.path.replace(/^\.\//, '').replace(/\.js$/, '');
      return { path: path.join(root, swap[name]) };
    });
  },
};

async function main() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'web/standalone.js')],
    bundle: true,
    write: false,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    plugins: [swapNodeModules],
    logLevel: 'warning',
  });
  const engine = result.outputFiles[0].text;
  const read = (f) => fs.readFileSync(path.join(root, 'public', f), 'utf8');
  const html = read('index.html');
  const css = read('styles.css');
  const ui = read('app.js');
  const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
    .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}</style>`);
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    // (function replacers: the code contains `$'`-style sequences that string replacement would expand)
    .replace('<script src="app.js"></script>', () => `<script>${safe(engine)}</script>\n  <script>\n${safe(ui)}</script>`);

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/muratab.html'), `<!doctype html>\n<html lang="en">\n<head>${head}</head>\n<body>${body}</body>\n</html>\n`);

  // Body-only variant: the host page supplies <!doctype>, <html>, <head> and <body>.
  const keep = head.split('\n').filter((l) => /<title>|<meta name="claude|fonts\.g|<style>/.test(l) || !/<meta|<link/.test(l)).join('\n');
  fs.writeFileSync(path.join(root, 'dist/muratab.artifact.html'), `${keep}\n${body}\n`);

  const kb = (f) => `${Math.round(fs.statSync(path.join(root, f)).size / 1024)} KB`;
  console.log(`Built dist/muratab.html (${kb('dist/muratab.html')}) and dist/muratab.artifact.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
