// PreToolUse hook for the npc agent: the only commands an NPC may run are reading its own brief and opening its own
// talk menu (built from what it knows, like the brief). Anything else (reading state.json, show, status, the DM log...)
// would leak what the NPC can't know.
'use strict';

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = String((JSON.parse(raw).tool_input || {}).command || '').trim(); } catch { /* blocked below */ }
  if (/^node engine\.js mind [A-Za-z0-9_-]+ (brief|menu talk)$/.test(cmd)) process.exit(0);
  process.stderr.write('An NPC knows only its brief. The commands allowed are: node engine.js mind <your-id> brief, and node engine.js mind <your-id> menu talk\n');
  process.exit(2);
});
