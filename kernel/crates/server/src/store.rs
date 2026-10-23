//! A room's save directory, `kernel/saves/<room>/`:
//!
//!   steps.jsonl    every step the timeline holds, on every branch, one JSON object per line, appended
//!                  as the step is created (the first is the room's opening, which carries the room
//!                  definition and codex it was opened with, so a save never depends on `rooms/*.json`)
//!   branches.json  the branch heads, rewritten when they change
//!   inbox.json     the DM's inbox (messages, replies, unix-ms timestamps), rewritten when it changes
//!   journal.log/.jsonl  the session journal (see journal.rs)
//!
//! To start a room fresh, delete its folder.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use kernel_core::{Branch, Room, Step};

use crate::inbox::{Inbox, Saved};

pub struct Store {
    pub dir: PathBuf,
    steps: File,
    /// The highest step id on disk.
    saved_upto: u64,
    /// The branches file as last written.
    branches: String,
}

/// What a save directory holds.
pub struct Loaded {
    pub room: Room,
    pub inbox: Inbox,
}

/// Whether `dir` holds a saved room.
pub fn exists(dir: &Path) -> bool {
    dir.join("steps.jsonl").is_file()
}

fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

impl Store {
    /// Starts a save for a freshly opened room: writes everything it has so far.
    pub fn create(dir: &Path, room: &Room) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let steps = OpenOptions::new().create(true).truncate(true).write(true).open(dir.join("steps.jsonl"))?;
        let mut store = Self { dir: dir.to_owned(), steps, saved_upto: 0, branches: String::new() };
        store.sync(room, &mut Inbox::default())?;
        Ok(store)
    }

    /// Reads a saved room back, and the store that carries on appending to it.
    pub fn load(dir: &Path, id: &str) -> Result<(Self, Loaded), String> {
        let read = |name: &str| std::fs::read_to_string(dir.join(name)).map_err(|e| format!("{}: {e}", dir.join(name).display()));
        let mut steps = Vec::new();
        for (n, line) in read("steps.jsonl")?.lines().enumerate().filter(|(_, l)| !l.trim().is_empty()) {
            steps.push(serde_json::from_str::<Step>(line).map_err(|e| format!("steps.jsonl line {}: {e}", n + 1))?);
        }
        let saved_upto = steps.iter().map(|s| s.id.0).max().unwrap_or(0);
        let branches_text = read("branches.json")?;
        let branches: BTreeMap<String, Branch> = serde_json::from_str(&branches_text).map_err(|e| format!("branches.json: {e}"))?;
        let room = Room::restore(id, steps, branches)?;
        let inbox = match std::fs::read_to_string(dir.join("inbox.json")) {
            Ok(text) => Inbox::restore(serde_json::from_str::<Saved>(&text).map_err(|e| format!("inbox.json: {e}"))?),
            Err(_) => Inbox::default(),
        };
        let steps = OpenOptions::new().append(true).open(dir.join("steps.jsonl")).map_err(|e| e.to_string())?;
        Ok((Self { dir: dir.to_owned(), steps, saved_upto, branches: branches_text }, Loaded { room, inbox }))
    }

    /// Writes whatever changed since the last call: new steps, moved branch heads, the inbox.
    pub fn sync(&mut self, room: &Room, inbox: &mut Inbox) -> std::io::Result<()> {
        let mut upto = self.saved_upto;
        let mut lines = String::new();
        for step in room.timeline().steps_after(self.saved_upto) {
            lines += &serde_json::to_string(step).expect("steps serialize");
            lines.push('\n');
            upto = step.id.0;
        }
        if !lines.is_empty() {
            self.steps.write_all(lines.as_bytes())?;
            self.saved_upto = upto;
        }
        let branches: BTreeMap<&String, &Branch> = room.timeline().branches().collect();
        let branches = serde_json::to_string(&branches).expect("branches serialize");
        if branches != self.branches {
            write_atomic(&self.dir.join("branches.json"), &branches)?;
            self.branches = branches;
        }
        if let Some(text) = inbox.take_save() {
            write_atomic(&self.dir.join("inbox.json"), &text)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use kernel_core::{Cell, Codex, Command, Handle, Observer, RoomDef, StepId, Surgery};

    use super::*;
    use crate::journal::{quote, Entry, Filter, Journal};

    fn room() -> Room {
        let def: RoomDef = serde_json::from_str(include_str!("../../../rooms/crossroads.json")).unwrap();
        let mut codex = Codex::default();
        codex.merge(serde_json::from_str(include_str!("../../../codex/core.json")).unwrap());
        Room::open("crossroads", def, codex).unwrap()
    }

    fn mv(who: &str, x: i32, y: i32) -> Command<String> {
        Command::Move { who: who.into(), to: Cell::new(x, y) }
    }

    #[test]
    fn a_saved_room_inbox_and_journal_come_back_and_refs_continue() {
        let dir = std::env::temp_dir().join(format!("kernel-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut r = room();
        let mut store = Store::create(&dir, &r).unwrap();
        let mut inbox = Inbox::default();
        let mut journal = Journal::open(&dir, "crossroads", "Crossroads").unwrap();

        // Play: steps, a draft, a message with a reply.
        r.execute(&Observer::Dm, &[mv("rook", 3, 8)], Some("Rook steps".into()), false).unwrap();
        r.execute(&Observer::Dm, &[mv("rook", 4, 8)], None, false).unwrap();
        r.surgery(Surgery::Remove { step: StepId(2) }, Some("never".into())).unwrap();
        let alice = Handle::new("alice").unwrap();
        let n = inbox.add(alice.clone(), "hello".into(), Some("2,3".into()));
        inbox.deliver();
        let m = inbox.get_mut(n).unwrap();
        m.first_reply = Some(m.received + 40);
        m.replies.push("hi".into());
        journal.record(Entry::new("m1", "sent", "alice", quote("hello")).fact("msg", 1));
        let w = journal.next_wake();
        journal.record(Entry::new(w.clone(), "wake", "dm", "m1").fact("msgs", serde_json::json!([1])));
        store.sync(&r, &mut inbox).unwrap();
        drop((store, journal));

        // Restart.
        assert!(exists(&dir));
        let (mut store, loaded) = Store::load(&dir, "crossroads").unwrap();
        let (mut r2, mut inbox2) = (loaded.room, loaded.inbox);
        assert_eq!(r2.timeline(), r.timeline());
        assert_eq!(r2.state(), r.state());
        assert_eq!(inbox2.all().cloned().collect::<Vec<_>>(), inbox.all().cloned().collect::<Vec<_>>());
        assert_eq!(inbox2.add(alice, "again".into(), None), n + 1, "message ids continue");
        let mut journal2 = Journal::open(&dir, "crossroads", "Crossroads").unwrap();
        assert_eq!(journal2.query(&Filter::default()).len(), 4, "open, sent, wake, open");
        assert_ne!(journal2.next_wake(), w, "wake numbers continue");

        // The next step has the next id and is appended, not rewritten.
        let a = r.execute(&Observer::Dm, &[mv("rook", 5, 8)], None, false).unwrap();
        let b = r2.execute(&Observer::Dm, &[mv("rook", 5, 8)], None, false).unwrap();
        assert_eq!(a, b);
        store.sync(&r2, &mut inbox2).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("steps.jsonl")).unwrap().lines().count() as u64, r2.timeline().peek_id().0 - 1);
        let (_, again) = Store::load(&dir, "crossroads").unwrap();
        assert_eq!(again.room.timeline(), r2.timeline());
        assert_eq!(again.inbox.all().count(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
