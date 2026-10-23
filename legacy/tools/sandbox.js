// The engine against a scratch game in .sandbox/ instead of the live one. Same commands as engine.js:
//   node tools/sandbox.js load rope-bridge
//   node tools/sandbox.js seat tester rook      (the link works on the sandbox viewer, port 5174)
// Start the sandbox viewer with the "viewer-sandbox" entry in .claude/launch.json.
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const data = process.env.TDND_DATA || path.join(root, '.sandbox');
fs.mkdirSync(data, { recursive: true });
const r = spawnSync(process.execPath, [path.join(root, 'engine.js'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root, env: Object.assign({}, process.env, { TDND_DATA: data, PORT: process.env.PORT || '5174' }) });
process.exit(r.status === null ? 1 : r.status);
