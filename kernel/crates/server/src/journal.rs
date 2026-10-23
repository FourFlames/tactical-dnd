//! The session journal: an append-only operations log of everything that passes between the
//! players, the DM and the room, for post-mortems. It is not the timeline: surgery never rewrites
//! it, and a rewound step stays in it with the rewind after it.
//!
//! `kernel/saves/<room>/journal.log` (with the room's other saved files) has one line per event, always the same shape:
//!
//! ```text
//! <time> <ref> <verb> <actor> <payload> [key=value …]
//! 10:02:11.402 m3   sent      alice   "I walk over and ask the priest what that book is." at=priest→osric
//! 10:02:11.655 w7   wake      dm      m3 batch=1 waited=253ms
//! 10:02:20.118 #4   step      dm      "Rook walks over" — Rook moves 20 ft to (4, 4) re=m3 took=0.3ms
//! 10:04:02.511 ?    parse     dm      act "shove grub east": unknown command "shove"
//! ```
//!
//! Refs are prefixed so one grep finds an item's whole story: `m3` messages, `#12` steps,
//! `draft-15` branches, `w7` wakes, `?` for things that belong to nothing yet. A link guessed from
//! timing rather than tagged is written `re=m3?`. `journal.jsonl` holds the same entries with
//! the structured facts the review needs; it is also what a restart reads back, so a room's journal
//! is one session across restarts (the `open` line of each later start says `resume=true`).

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

/// One journal line.
#[derive(Clone, Debug)]
pub struct Entry {
    /// Unix milliseconds.
    pub ms: i64,
    /// Local wall-clock time, `HH:MM:SS.mmm`.
    pub time: String,
    pub refr: String,
    pub verb: &'static str,
    pub actor: String,
    pub payload: String,
    pub kv: Vec<(&'static str, String)>,
    /// Structured facts for `journal.jsonl` and the review, not shown on the line.
    pub facts: serde_json::Map<String, Value>,
}

impl Entry {
    pub fn new(refr: impl Into<String>, verb: &'static str, actor: impl Into<String>, payload: impl Into<String>) -> Self {
        let now = chrono::Local::now();
        Self {
            ms: now.timestamp_millis(),
            time: now.format("%H:%M:%S%.3f").to_string(),
            refr: refr.into(),
            verb,
            actor: actor.into(),
            payload: payload.into(),
            kv: Vec::new(),
            facts: serde_json::Map::new(),
        }
    }

    pub fn kv(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.kv.push((key, value.into()));
        self
    }

    pub fn fact(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.facts.insert(key.into(), value.into());
        self
    }

    pub fn line(&self) -> String {
        let mut line = format!("{} {:<4} {:<9} {:<7} {}", self.time, self.refr, self.verb, self.actor, self.payload);
        for (k, v) in &self.kv {
            let v = if v.is_empty() || v.contains(char::is_whitespace) { quote(v) } else { v.clone() };
            line += &format!(" {k}={v}");
        }
        line
    }

    fn json(&self) -> Value {
        let mut o = json!({ "ms": self.ms, "time": self.time, "ref": self.refr, "verb": self.verb, "actor": self.actor, "payload": self.payload });
        let map = o.as_object_mut().unwrap();
        for (k, v) in &self.kv {
            map.insert((*k).into(), json!(v));
        }
        map.insert("facts".into(), Value::Object(self.facts.clone()));
        // In order, which the flattened keys above can't keep.
        map.insert("kv".into(), json!(self.kv));
        o
    }

    /// An entry as `journal.jsonl` wrote it.
    fn from_json(v: &Value) -> Option<Self> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        let kv = v.get("kv")?.as_array()?.iter().filter_map(|p| Some((intern(p.get(0)?.as_str()?), p.get(1)?.as_str()?.to_owned()))).collect();
        Some(Self {
            ms: v.get("ms")?.as_i64()?,
            time: text("time")?,
            refr: text("ref")?,
            verb: intern(v.get("verb")?.as_str()?),
            actor: text("actor")?,
            payload: text("payload")?,
            kv,
            facts: v.get("facts")?.as_object()?.clone(),
        })
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.kv.iter().find(|(k, _)| *k == key).map(|(_, v)| v.as_str())
    }

    fn n(&self, key: &str) -> Option<u64> {
        self.facts.get(key).and_then(Value::as_u64)
    }

    /// The message this entry resolves, tagged or guessed.
    fn re(&self) -> Option<(u64, bool)> {
        let re = self.get("re")?;
        let guess = re.ends_with('?');
        re.trim_end_matches('?').strip_prefix('m')?.parse().ok().map(|n| (n, guess))
    }
}

/// Verbs and keys read back from disk, as the `&'static str`s the journal uses. A handful of
/// distinct words, so leaking them is fine.
fn intern(word: &str) -> &'static str {
    static WORDS: std::sync::Mutex<BTreeMap<String, &'static str>> = std::sync::Mutex::new(BTreeMap::new());
    let mut words = WORDS.lock().unwrap();
    words.entry(word.to_owned()).or_insert_with(|| Box::leak(word.to_owned().into_boxed_str()))
}

/// Text in double quotes, on one line.
pub fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n"))
}

/// `0.3ms` · `253ms` · `12.3s` · `4m05s`: durations as the journal writes them.
pub fn short(d: Duration) -> String {
    let s = d.as_secs_f64();
    match s {
        s if s < 0.01 => format!("{:.2}ms", s * 1000.0),
        s if s < 1.0 => format!("{:.0}ms", s * 1000.0),
        s if s < 60.0 => format!("{s:.1}s"),
        s => format!("{}m{:02}s", (s / 60.0) as u64, (s % 60.0) as u64),
    }
}

fn short_ms(ms: i64) -> String {
    short(Duration::from_millis(ms.max(0) as u64))
}

/// What `dm log` asks for. Empty fields don't filter.
#[derive(Default)]
pub struct Filter {
    /// A ref: `m3` (or `3`), `#4`, `draft-15`, `w7`. Matches the entry itself and everything tagged
    /// with it.
    pub re: Option<String>,
    /// Verbs, comma-separated.
    pub kind: Option<String>,
    pub who: Option<String>,
    /// `10:02`, `10:02:11` (wall clock today) or `5m`, `30s` (that long ago).
    pub since: Option<String>,
    pub limit: Option<usize>,
}

pub struct Journal {
    /// `journal.log` and `journal.jsonl`; none for a journal kept in memory only.
    files: Option<(File, File)>,
    pub dir: Option<PathBuf>,
    /// The room's id: one session per room, however many times the server restarts.
    pub session: String,
    entries: Vec<Entry>,
    wakes: u64,
}

impl Journal {
    /// Opens a room's journal in its save directory and writes the `open` line. If the directory
    /// already has a journal, its entries are read back (so `dm log` and `dm review` see the whole
    /// session), numbering carries on from the highest wake, and the `open` line says `resume=true`.
    pub fn open(dir: &Path, room: &str, title: &str) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let (entries, resume) = match std::fs::read_to_string(dir.join("journal.jsonl")) {
            Ok(text) => {
                let entries: Vec<Entry> = text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|v| Entry::from_json(&v)).collect();
                let resume = !entries.is_empty();
                (entries, resume)
            }
            Err(_) => (Vec::new(), false),
        };
        let wakes = entries.iter().filter(|e| e.verb == "wake").filter_map(|e| e.refr.strip_prefix('w')?.parse::<u64>().ok()).max().unwrap_or(0);
        let create = |name: &str| OpenOptions::new().create(true).append(true).open(dir.join(name));
        let files = Some((create("journal.log")?, create("journal.jsonl")?));
        let mut j = Self { files, dir: Some(dir.to_owned()), session: room.to_owned(), entries, wakes };
        let open = Entry::new("-", "open", "kernel", quote(title)).kv("room", room).kv("session", j.session.clone());
        j.record(if resume { open.kv("resume", "true") } else { open });
        Ok(j)
    }

    pub fn memory(room: &str) -> Self {
        Self { files: None, dir: None, session: format!("{room} (in memory)"), entries: Vec::new(), wakes: 0 }
    }

    pub fn record(&mut self, e: Entry) {
        if let Some((log, jsonl)) = &mut self.files {
            let wrote = writeln!(log, "{}", e.line()).and_then(|_| writeln!(jsonl, "{}", e.json()));
            if let Err(err) = wrote {
                eprintln!("journal: can't write: {err}");
            }
        }
        self.entries.push(e);
    }

    /// The ref for the next wake: `w1`, `w2`, …
    pub fn next_wake(&mut self) -> String {
        self.wakes += 1;
        format!("w{}", self.wakes)
    }

    /// The lines `dm log` asks for, oldest first; the last `limit` (default 50) that match.
    pub fn query(&self, f: &Filter) -> Vec<String> {
        let re = f.re.as_deref().map(|r| if r.chars().all(|c| c.is_ascii_digit()) { format!("m{r}") } else { r.to_owned() });
        let kinds: Option<Vec<&str>> = f.kind.as_deref().map(|k| k.split(',').map(str::trim).collect());
        let since = f.since.as_deref().map(|s| self.since(s));
        let matched: Vec<&Entry> = self
            .entries
            .iter()
            .filter(|e| re.as_deref().is_none_or(|r| mentions(e, r)))
            .filter(|e| kinds.as_ref().is_none_or(|k| k.contains(&e.verb)))
            .filter(|e| f.who.as_deref().is_none_or(|w| e.actor == w))
            .filter(|e| match &since {
                Some(Since::Ms(ms)) => e.ms >= *ms,
                Some(Since::Clock(t)) => e.time.as_str() >= t.as_str(),
                None => true,
            })
            .collect();
        let limit = f.limit.unwrap_or(50);
        matched[matched.len().saturating_sub(limit)..].iter().map(|e| e.line()).collect()
    }

    fn since(&self, s: &str) -> Since {
        if s.contains(':') {
            // `9:05` → `09:05`, so it compares with the zero-padded times.
            return Since::Clock(if s.find(':') == Some(1) { format!("0{s}") } else { s.to_owned() });
        }
        let split = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        let n: i64 = s[..split].parse().unwrap_or(0);
        let per = match &s[split..] {
            "h" => 3_600_000,
            "m" | "min" => 60_000,
            _ => 1000,
        };
        Since::Ms(chrono::Local::now().timestamp_millis() - n * per)
    }

    /// The post-mortem: what went through the DM, what didn't need to, and what got in the way.
    pub fn review(&self) -> String {
        let msgs = self.messages();
        let steps: Vec<&Entry> = self.verb("step").collect();
        let first = self.entries.iter().find(|e| e.verb != "open");
        let span = match (first, self.entries.last()) {
            (Some(a), Some(b)) => format!("{} → {} ({})", &a.time[..8], &b.time[..8], short_ms(b.ms - a.ms)),
            _ => "nothing yet".into(),
        };
        let count = |n: usize, what: &str| format!("{n} {what}{}", if n == 1 { "" } else { "s" });
        let mut out = vec![format!(
            "review: {} · {span} · {}, {}, {}",
            self.session,
            count(msgs.len(), "message"),
            count(steps.len(), "step"),
            count(self.verb("wake").count(), "wake")
        )];

        let mut skippable = Vec::new();
        let mut answered = Vec::new();
        let mut rulings = Vec::new();
        let mut open = Vec::new();
        for m in msgs.values() {
            let line = m.line();
            if m.done.is_none() {
                open.push(line);
            } else if m.steps.is_empty() {
                answered.push(format!("{line} → {}", m.replies.last().map_or("(no reply)".into(), |r| r.payload.clone())));
            } else if m.steps.iter().all(|s| own_moves(s, &m.from)) {
                skippable.push(format!("{line} → {}", m.step_refs()));
            } else {
                rulings.push(format!("{line} → {}", m.step_refs()));
            }
        }
        section(&mut out, "could have skipped the DM: only moved the sender's own creature", skippable);
        section(&mut out, "answered without a step: could the bundle or the kernel have answered?", answered);
        section(&mut out, "rulings: the DM changed more than the sender's own position", rulings);
        section(&mut out, "still open", open);

        let mut slow: Vec<&Msg> = msgs.values().collect();
        slow.sort_by_key(|m| std::cmp::Reverse(m.wait(self.entries.last().map_or(0, |e| e.ms))));
        let slow = slow
            .iter()
            .take(5)
            .map(|m| {
                let hop = |at: Option<i64>| at.map_or("—".into(), |t| short_ms(t - m.sent.ms));
                let total = m.done.map_or_else(|| format!("open {}", short_ms(m.wait(self.entries.last().map_or(0, |e| e.ms)))), |d| short_ms(d - m.sent.ms));
                format!("m{} {total} (seen {} · 1st reply {}) {} {}", m.n, hop(m.seen), hop(m.replies.first().map(|r| r.ms)), m.from, m.sent.payload)
            })
            .collect();
        section(&mut out, "slowest waits, sent → done", slow);

        let wishes = self.verb("wish").map(|e| format!("{} {}{}", &e.time[..8], e.payload, e.get("re").map_or(String::new(), |r| format!(" re={r}")))).collect();
        section(&mut out, "wishes", wishes);

        let mut missing: BTreeMap<String, Vec<&Entry>> = BTreeMap::new();
        for e in self.verb("parse") {
            let what = e.facts.get("missing").and_then(Value::as_str).unwrap_or("(syntax)").to_owned();
            missing.entry(what).or_default().push(e);
        }
        let missing = missing.iter().map(|(what, es)| format!("{what} ×{}: {}", es.len(), es[0].payload)).collect();
        section(&mut out, "parse errors (commands that don't exist yet)", missing);

        let mut refusals: BTreeMap<String, Vec<&Entry>> = BTreeMap::new();
        for e in self.verb("refused") {
            refusals.entry(e.get("code").unwrap_or("?").to_owned()).or_default().push(e);
        }
        let refusals = refusals.iter().map(|(code, es)| format!("{code} ×{}: {} {}", es.len(), es[0].actor, es[0].payload)).collect();
        section(&mut out, "refusals", refusals);

        let committed: Vec<&str> = self.verb("commit").map(|e| e.refr.as_str()).collect();
        let fiat = steps
            .iter()
            .filter(|s| s.n("places").is_some_and(|n| n > 0))
            .map(|s| format!("{} {} {}", s.refr, s.actor, s.get("cmd").unwrap_or(&s.payload)))
            .chain(self.verb("preview").filter_map(|e| {
                let what = match (e.facts.get("op").and_then(Value::as_str), e.get("cmd")) {
                    (Some("keep_as_fiat"), _) => format!("keep as fiat {}", e.get("step").unwrap_or("?")),
                    (_, Some(cmd)) if cmd.split(';').any(|c| c.trim().starts_with("place ")) => format!("{} {cmd}", e.payload.split(':').next().unwrap_or("edit")),
                    _ => return None,
                };
                Some(format!("{} {what}{}", e.refr, if committed.contains(&e.refr.as_str()) { " (committed)" } else { " (not committed)" }))
            }))
            .collect();
        section(&mut out, "fiat used: places and dropped steps kept", fiat);
        out.join("\n")
    }

    fn verb<'a>(&'a self, verb: &'a str) -> impl Iterator<Item = &'a Entry> + 'a {
        self.entries.iter().filter(move |e| e.verb == verb)
    }

    /// Every message's story, by id.
    fn messages(&self) -> BTreeMap<u64, Msg<'_>> {
        let mut msgs = BTreeMap::new();
        for e in &self.entries {
            match e.verb {
                "sent" => {
                    if let Some(n) = e.n("msg") {
                        msgs.insert(n, Msg { n, from: e.actor.clone(), sent: e, seen: None, replies: Vec::new(), done: None, steps: Vec::new() });
                    }
                }
                "wake" => {
                    for n in e.facts.get("msgs").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_u64) {
                        if let Some(m) = msgs.get_mut(&n) {
                            m.seen.get_or_insert(e.ms);
                        }
                    }
                }
                "reply" | "done" | "step" => {
                    let n = e.n("msg").or_else(|| e.re().map(|(n, _)| n));
                    let Some(m) = n.and_then(|n| msgs.get_mut(&n)) else { continue };
                    match e.verb {
                        "reply" => m.replies.push(e),
                        "done" => m.done = Some(e.ms),
                        _ => m.steps.push(e),
                    }
                }
                _ => {}
            }
        }
        msgs
    }
}

enum Since {
    Ms(i64),
    Clock(String),
}

/// Whether an entry is about `r`: it is `r`, is tagged with it, or (a wake) carried it.
fn mentions(e: &Entry, r: &str) -> bool {
    e.refr == r
        || e.get("re").is_some_and(|v| v.trim_end_matches('?') == r)
        || r.strip_prefix('m').and_then(|n| n.parse::<u64>().ok()).is_some_and(|n| e.facts.get("msgs").and_then(Value::as_array).is_some_and(|a| a.contains(&json!(n))))
}

/// A step that only moved creatures `seat` controls: the player could have done it themselves.
fn own_moves(step: &Entry, seat: &str) -> bool {
    step.facts.get("own_moves_of").and_then(Value::as_array).is_some_and(|a| a.iter().any(|s| s == seat))
}

fn section(out: &mut Vec<String>, title: &str, items: Vec<String>) {
    if items.is_empty() {
        out.push(format!("{title}: none"));
    } else {
        out.push(format!("{title} ({}):", items.len()));
        out.extend(items.into_iter().map(|i| format!("  {i}")));
    }
}

struct Msg<'a> {
    n: u64,
    from: String,
    sent: &'a Entry,
    seen: Option<i64>,
    replies: Vec<&'a Entry>,
    done: Option<i64>,
    steps: Vec<&'a Entry>,
}

impl Msg<'_> {
    fn line(&self) -> String {
        let took = self.done.map_or(String::new(), |d| format!(" · {}", short_ms(d - self.sent.ms)));
        format!("m{} {} {}{took}", self.n, self.from, self.sent.payload)
    }

    fn step_refs(&self) -> String {
        self.steps.iter().map(|s| format!("{}{}", s.refr, if s.re().is_some_and(|(_, g)| g) { "?" } else { "" })).collect::<Vec<_>>().join(" ")
    }

    /// Sent → done, or sent → `now` while it's open.
    fn wait(&self, now: i64) -> i64 {
        self.done.unwrap_or(now) - self.sent.ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(ms: i64, e: Entry) -> Entry {
        Entry { ms, time: format!("10:00:{:02}.{:03}", ms / 1000, ms % 1000), ..e }
    }

    /// m1: alice asks to walk somewhere (the DM moves her own creature); m2: a question answered
    /// with words; m3: a shove the DM can't type, resolved by placing the goblin; m4 still open.
    fn session() -> Journal {
        let mut j = Journal::memory("crossroads");
        let entries = [
            at(0, Entry::new("m1", "sent", "alice", quote("I walk to the well")).fact("msg", 1)),
            at(250, Entry::new("w1", "wake", "dm", "m1").kv("batch", "1").fact("msgs", json!([1]))),
            at(4000, Entry::new("#2", "step", "dm", "— Rook moves 20 ft to (4, 4)").kv("re", "m1").fact("own_moves_of", json!(["alice"]))),
            at(4500, Entry::new("m1", "reply", "dm", quote("You reach the well.")).fact("msg", 1)),
            at(4500, Entry::new("m1", "done", "dm", "").fact("msg", 1)),
            at(5000, Entry::new("m2", "sent", "sam", quote("What's the book called?")).fact("msg", 2)),
            at(5100, Entry::new("m3", "sent", "alice", quote("I shove the goblin east")).fact("msg", 3)),
            at(5350, Entry::new("w2", "wake", "dm", "m2,m3").kv("batch", "2").fact("msgs", json!([2, 3]))),
            at(9000, Entry::new("m2", "reply", "dm", quote("Leaves of Ithil.")).fact("msg", 2)),
            at(9000, Entry::new("m2", "done", "dm", "").fact("msg", 2)),
            at(10000, Entry::new("?", "parse", "dm", "act \"shove snikka east\": unknown command \"shove\"").fact("missing", "shove")),
            at(11000, Entry::new("?", "wish", "dm", quote("a shove command")).kv("re", "m3")),
            at(12000, Entry::new("#3", "step", "dm", "\"Shoved\" — Snikka is placed at (6, 2)").kv("re", "m3?").kv("cmd", "place snikka 6,2").fact("places", 1).fact("own_moves_of", json!([]))),
            at(13000, Entry::new("?", "refused", "alice", "move rook 19,1: too far").kv("code", "too_far")),
            at(30000, Entry::new("m3", "done", "dm", "").fact("msg", 3)),
            at(31000, Entry::new("m4", "sent", "sam", quote("Can I hide?")).fact("msg", 4)),
            at(32000, Entry::new("draft-5", "preview", "dm", "keep_as_fiat: 1 kept as fiat").kv("step", "#4").fact("op", "keep_as_fiat")),
            at(33000, Entry::new("draft-5", "commit", "dm", "").kv("main", "#6")),
            at(34000, Entry::new("draft-7", "preview", "dm", "insert \"Wren was there\": 1 change: 1 inserted").kv("cmd", "place wren 5,8").fact("op", "insert")),
        ];
        entries.into_iter().for_each(|e| j.record(e));
        j
    }

    #[test]
    fn lines_have_one_shape() {
        let e = at(11402, Entry::new("m3", "sent", "alice", quote("I ask \"what's that\"")).kv("at", "priest→osric").kv("note", "two words"));
        assert_eq!(e.line(), "10:00:11.402 m3   sent      alice   \"I ask \\\"what's that\\\"\" at=priest→osric note=\"two words\"");
        assert_eq!(short(Duration::from_micros(300)), "0.30ms");
        assert_eq!(short(Duration::from_millis(253)), "253ms");
        assert_eq!(short(Duration::from_millis(12_340)), "12.3s");
        assert_eq!(short(Duration::from_secs(245)), "4m05s");
    }

    #[test]
    fn log_filters_by_ref_kind_who_and_time() {
        let j = session();
        let m3: Vec<String> = j.query(&Filter { re: Some("3".into()), ..Filter::default() });
        assert_eq!(m3.iter().map(|l| l[13..17].trim()).collect::<Vec<_>>(), ["m3", "w2", "?", "#3", "m3"], "{m3:#?}");
        let steps = j.query(&Filter { kind: Some("step,refused".into()), who: Some("dm".into()), ..Filter::default() });
        assert_eq!(steps.len(), 2);
        assert!(steps.iter().all(|l| l.contains(" step ")));
        assert_eq!(j.query(&Filter { since: Some("10:00:31".into()), ..Filter::default() }).len(), 4);
        assert_eq!(j.query(&Filter { limit: Some(2), ..Filter::default() }).len(), 2);
    }

    #[test]
    fn review_sorts_messages_by_what_they_needed() {
        let r = session().review();
        let after = |title: &str| r.lines().skip_while(|l| !l.starts_with(title)).nth(1).unwrap_or("").to_owned();
        assert!(r.starts_with("review: crossroads (in memory) · 10:00:00 → 10:00:34 (34.0s) · 4 messages, 2 steps, 2 wakes"), "{r}");
        assert!(after("could have skipped").contains("m1 alice \"I walk to the well\" · 4.5s → #2"), "{r}");
        assert!(after("answered without a step").contains("m2 sam") && after("answered without").contains("Leaves of Ithil"), "{r}");
        assert!(after("rulings").contains("m3 alice") && after("rulings").ends_with("→ #3?"), "{r}");
        assert!(after("still open").contains("m4 sam"), "{r}");
        assert!(after("slowest waits").starts_with("  m3 24.9s (seen 250ms · 1st reply —)"), "{r}");
        assert!(after("wishes").contains("\"a shove command\" re=m3"), "{r}");
        assert!(after("parse errors").contains("shove ×1"), "{r}");
        assert!(after("refusals").contains("too_far ×1: alice"), "{r}");
        assert!(r.contains("#3 dm place snikka 6,2") && r.contains("draft-5 keep as fiat #4 (committed)"), "{r}");
        assert!(r.contains("draft-7 insert \"Wren was there\" place wren 5,8 (not committed)"), "{r}");
    }

    #[test]
    fn a_restart_resumes_the_same_journal() {
        let dir = std::env::temp_dir().join(format!("kernel-journal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut j = Journal::open(&dir, "crossroads", "The Crossroads Shrine").unwrap();
        j.record(Entry::new("m1", "sent", "alice", quote("hi \"there\"")).kv("at", "priest→osric").fact("msg", 1));
        j.record(Entry::new("w1", "wake", "dm", "m1").kv("batch", "1").fact("msgs", json!([1])));
        j.record(Entry::new("#2", "step", "dm", "— moves").kv("re", "m1").kv("took", "0.30ms").fact("places", 0));
        let before = j.query(&Filter::default());
        assert_eq!(before.len(), 4);
        assert!(!before[0].contains("resume"), "{}", before[0]);
        drop(j);

        let mut j = Journal::open(&dir, "crossroads", "The Crossroads Shrine").unwrap();
        let after = j.query(&Filter::default());
        assert_eq!(after[..4], before[..], "the old lines come back exactly, key order included");
        assert!(after[4].contains(" open ") && after[4].ends_with("session=crossroads resume=true"), "{}", after[4]);
        assert_eq!(j.next_wake(), "w2", "wake numbers continue");
        assert!(j.review().contains("1 message, 1 step, 1 wake"), "{}", j.review());
        let log = std::fs::read_to_string(dir.join("journal.log")).unwrap();
        assert_eq!(log.lines().count(), 5);
        let last: Value = serde_json::from_str(std::fs::read_to_string(dir.join("journal.jsonl")).unwrap().lines().last().unwrap()).unwrap();
        assert_eq!(last["verb"], "open");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
