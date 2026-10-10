// PreToolUse hook for the npc agent: the only command an NPC may run is reading its own brief.
// Anything else (reading state.json, show, status, the DM log...) would leak what the NPC can't know.
'use strict';

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = String((JSON.parse(raw).tool_input || {}).command || '').trim(); } catch { /* blocked below */ }
  if (/^node engine\.js mind [A-Za-z0-9_-]+ brief$/.test(cmd)) process.exit(0);
  process.stderr.write('An NPC knows only its brief. The one command allowed is: node engine.js mind <your-id> brief\n');
  process.exit(2);
});
