//! The DM's inbox: what players send, the batch the DM gets on each wake, and how fast each
//! message moves through it (sent → seen by the DM → first reply → done).

use std::time::{Duration, Instant};

use kernel_core::{step_line, Cell, Handle, Observer, Room};

pub struct Message {
    pub id: u64,
    pub from: Handle,
    pub text: String,
    /// What the player was pointing at, in their names: a handle, or a square "x,y".
    pub at: Option<String>,
    pub received: Instant,
    pub delivered: Option<Instant>,
    pub first_reply: Option<Instant>,
    pub done: Option<Instant>,
    pub replies: Vec<String>,
}

#[derive(Default)]
pub struct Inbox {
    messages: Vec<Message>,
    next: u64,
    /// Recent command execution times, for `stats`.
    exec: Vec<Duration>,
}

impl Inbox {
    pub fn add(&mut self, from: Handle, text: String, at: Option<String>) -> u64 {
        self.next += 1;
        self.messages.push(Message { id: self.next, from, text, at, received: Instant::now(), delivered: None, first_reply: None, done: None, replies: Vec::new() });
        self.next
    }

    pub fn get_mut(&mut self, id: u64) -> Option<&mut Message> {
        self.messages.iter_mut().find(|m| m.id == id)
    }

    pub fn all(&self) -> impl Iterator<Item = &Message> {
        self.messages.iter()
    }

    /// Messages the DM hasn't been shown yet.
    pub fn undelivered(&self) -> usize {
        self.messages.iter().filter(|m| m.delivered.is_none()).count()
    }

    /// Messages not yet marked done.
    pub fn open(&self) -> usize {
        self.messages.iter().filter(|m| m.done.is_none()).count()
    }

    /// Marks everything undelivered as delivered now, and returns their ids.
    pub fn deliver(&mut self) -> Vec<u64> {
        let now = Instant::now();
        self.messages
            .iter_mut()
            .filter(|m| m.delivered.is_none())
            .map(|m| {
                m.delivered = Some(now);
                m.id
            })
            .collect()
    }

    pub fn record_exec(&mut self, d: Duration) {
        if self.exec.len() >= 500 {
            self.exec.remove(0);
        }
        self.exec.push(d);
    }

    pub fn stats(&self) -> String {
        let span = |f: &dyn Fn(&Message) -> Option<Duration>| -> Vec<Duration> { self.messages.iter().filter_map(f).collect() };
        let seen = span(&|m| Some(m.delivered? - m.received));
        let first = span(&|m| Some(m.first_reply? - m.delivered?));
        let done = span(&|m| Some(m.done? - m.received));
        let answered = self.messages.iter().filter(|m| m.first_reply.is_some()).count();
        [
            format!("messages: {} ({answered} answered, {} open)", self.messages.len(), self.open()),
            format!("  sent → DM saw it:       {}", spread(&seen)),
            format!("  DM saw it → 1st reply:  {}", spread(&first)),
            format!("  sent → done:            {}", spread(&done)),
            format!("commands executed: {} · {}", self.exec.len(), spread(&self.exec)),
        ]
        .join("\n")
    }
}

/// "p50 1.2 s · p95 4.0 s", or "none yet".
fn spread(ds: &[Duration]) -> String {
    if ds.is_empty() {
        return "none yet".into();
    }
    let mut v = ds.to_vec();
    v.sort();
    let at = |p: f64| v[((v.len() - 1) as f64 * p).round() as usize];
    format!("p50 {} · p95 {}", human(at(0.5)), human(at(0.95)))
}

fn human(d: Duration) -> String {
    match d.as_secs_f64() {
        s if s < 1.0 => format!("{:.1} ms", s * 1000.0),
        s => format!("{s:.1} s"),
    }
}

/// `x,y` → a square, if that's what the text is.
fn as_cell(text: &str) -> Option<Cell> {
    let nums: Vec<i32> = text.replace(['(', ')', ','], " ").split_whitespace().map(|n| n.parse().ok()).collect::<Option<_>>()?;
    match nums[..] {
        [x, y] => Some(Cell::new(x, y)),
        _ => None,
    }
}

/// One wake for the DM: every message in the batch with what's needed to answer it without
/// further lookups: the speaker's sheet, what they pointed at (resolved), who's nearby, and the
/// last few steps.
pub fn bundle(room: &Room, ids: &[u64], inbox: &Inbox) -> String {
    let s = room.state();
    let dm = Observer::Dm;
    let msgs: Vec<&Message> = inbox.all().filter(|m| ids.contains(&m.id)).collect();
    let mut out = vec![format!("📨 {} message{} · {} · main at #{}", msgs.len(), if msgs.len() == 1 { "" } else { "s" }, s.clock, room.seq())];
    for m in &msgs {
        let seat = Observer::Seat(m.from.clone());
        let lead = s.lead(&m.from).map(|id| &s.creatures[&id]);
        let who = lead.map_or_else(String::new, |c| format!(" ({}, {}/{} HP, {} ft, at {})", c.name, c.hp, c.max_hp, c.speed_ft, c.pos));
        out.push(format!("#{} {}{who}: \"{}\"", m.id, m.from, m.text));
        if let Some(at) = &m.at {
            let target = s.names.get(&seat).and_then(|n| n.resolve(at)).and_then(|id| s.creatures.get(&id));
            let line = match (target, as_cell(at)) {
                (Some(t), _) => {
                    let dist = lead.map_or_else(String::new, |l| format!(", {} ft away", l.pos.distance_ft(t.pos)));
                    format!("   pointing at {} (their \"{at}\") at {}{dist}", s.label(&dm, t.id), t.pos)
                }
                (None, Some(c)) => {
                    let terrain = s.map.terrain(c).map_or("off the map", |t| t.name.as_str());
                    let dist = lead.map_or_else(String::new, |l| format!(", {} ft away", l.pos.distance_ft(c)));
                    let who = s.creature_at(c).map_or_else(String::new, |o| format!(", {} is there", s.label(&dm, o.id)));
                    format!("   pointing at {c}: {terrain}{dist}{who}")
                }
                (None, None) => format!("   pointing at \"{at}\", which they have no name for"),
            };
            out.push(line);
        }
        if let Some(l) = lead {
            let near: Vec<String> = s
                .creatures
                .values()
                .filter(|c| c.id != l.id && l.pos.distance_ft(c.pos) <= 30)
                .map(|c| format!("{} at {} {} ft, {} to {}", s.label(&dm, c.id), c.pos, l.pos.distance_ft(c.pos), format!("{:?}", s.stance(c.id, l.id)).to_lowercase(), l.name))
                .collect();
            out.push(format!("   nearby: {}", if near.is_empty() { "nobody within 30 ft".into() } else { near.join("; ") }));
        }
    }
    let recent: Vec<String> = room.history(None, 5).unwrap_or_default().iter().filter_map(|st| step_line(s, &dm, st)).collect();
    out.push("recent:".into());
    out.extend(recent.into_iter().map(|l| format!("   {l}")));
    out.push("answer each: dm reply <id> \"…\" (add --done when it's resolved)".into());
    out.join("\n")
}
