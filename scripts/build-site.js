#!/usr/bin/env node
// Builds the self-contained demo website from site/template.html:
//   docs/index.html      full page (GitHub Pages, or open the file directly in a browser)
//   build/embed.html     the same page without <html>/<head>/<body> wrappers, for embedding in another page
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const template = read('site/template.html');
const core = read('src/core.cjs');
const data = JSON.parse(read('site/demo-data.json'));
const configPath = path.join(root, 'site', 'config.json');
data.config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};

// Keep inline scripts safe: no "</script" inside them.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const safeJson = JSON.stringify(data).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
const safeCore = core.replace(/<\/script/gi, '<\\/script');

const filled = template.replace('/*__CORE__*/', () => safeCore).replace('/*__DATA__*/', () => safeJson);
const [head, body] = filled.split('<!--BODY-->');
if (body === undefined) throw new Error('site/template.html must contain <!--BODY-->');

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'index.html'), full);
fs.writeFileSync(path.join(root, 'docs', '.nojekyll'), '');
fs.writeFileSync(path.join(root, 'build', 'embed.html'), head.trim() + '\n' + body.trim() + '\n');
console.log(`Built docs/index.html (${(full.length / 1024).toFixed(0)} KB) and build/embed.html`);
