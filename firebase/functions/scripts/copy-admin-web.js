const {copyFileSync, mkdirSync, cpSync} = require('node:fs');
const {resolve} = require('node:path');
const destination = resolve(__dirname, '../lib/admin-web-assets');
mkdirSync(destination, {recursive: true});
for (const file of ['index.html', 'app.js', 'style.css', 'map.html', 'map.js', 'map.css']) {
  copyFileSync(resolve(__dirname, '../../admin-web', file), resolve(destination, file));
}

cpSync(resolve(__dirname, '../../admin-web/icons'), resolve(destination, 'icons'), {recursive: true});

cpSync(resolve(__dirname, '../../admin-web/vendor'), resolve(destination, 'vendor'), {recursive: true});
