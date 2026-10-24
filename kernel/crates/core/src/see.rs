//! `dm see`: a room, a creature or a square as one seat perceives it, next to the truth.
//! Built on the per-observer machinery (`RoomView`, `reading`, `stance`); it only words the result.

use std::collections::BTreeSet;

use crate::codex::{Attention, Facet, Gate, Layer, Salience};
use crate::creature::Creature;
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::observer::Observer;
use crate::reading::{read_passing, Abilities, MarkInstance};
use crate::room::{Room, RoomState};
use crate::stance::{self, Stance, STRANGER};
use crate::view::RoomView;

fn word(s: Stance) -> &'static str {
    match s {
        Stance::Hostile => "hostile",
        Stance::Wary => "wary",
        Stance::Neutral => "neutral",
        Stance::Friendly => "friendly",
        Stance::Deferential => "deferential",
    }
}

/// What `lead` would feel toward `target` if it read everything the target really is.
fn true_stance(lead: &Creature, target: &Creature) -> Stance {
    if let Some(st) = lead.relations.get(&target.id) {
        return *st;
    }
    if lead.acquainted.contains(&target.id) {
        return Stance::Friendly;
    }
    let stranger = Handle::new(STRANGER).unwrap();
    target.identities.iter().chain(std::iter::once(&stranger)).filter_map(|i| lead.dispositions.get(i)).copied().min().unwrap_or(Stance::Neutral)
}

fn fill(mark: &MarkInstance, text: &str) -> String {
    mark.params.iter().fold(text.to_owned(), |t, (k, v)| t.replace(&format!("{{{k}}}"), v))
}

fn facet_text(codex: &crate::Codex, f: &Facet) -> String {
    let mut tags = Vec::new();
    if let Some(i) = &f.identity {
        tags.push(codex.identities.get(i).map_or_else(|| i.to_string(), |d| d.label.clone()));
    }
    match f.salience {
        Salience::Low => tags.push("low: not noticed in passing".into()),
        Salience::High => tags.push("high".into()),
        Salience::Normal => {}
    }
    if tags.is_empty() {
        f.text.clone()
    } else {
        format!("{} [{}]", f.text, tags.join("; "))
    }
}

/// Whether the gate is open to this observer, and in words why.
fn gate_state(gate: &Gate, who: &Abilities, mark: &MarkInstance) -> Option<(bool, String)> {
    match gate {
        Gate::None => None,
        Gate::Knows { knows } => {
            let k = fill(mark, knows);
            let has = who.knows.contains(&k);
            Some((has, if has { format!("knows {k}") } else { format!("doesn't know {k}") }))
        }
        Gate::Skill { skill, dc } => {
            let p = who.passive(skill);
            Some((p >= *dc, format!("{skill} DC {dc} vs passive {p}")))
        }
    }
}

/// What stops a glance reaching this layer by itself, if anything.
fn block(l: &Layer, who: &Abilities, mark: &MarkInstance) -> Option<String> {
    let gate = gate_state(&l.gate, who, mark);
    if l.attention > Attention::Passing {
        let then = gate.map(|(_, t)| format!(", then {t}")).unwrap_or_default();
        return Some(format!("needs a close look{then}"));
    }
    gate.filter(|(ok, _)| !ok).map(|(_, t)| t)
}

/// The layer's own blocker; under a blocked parent, its gate's state even when it would pass.
fn own_why(l: &Layer, who: &Abilities, mark: &MarkInstance, inherited: Option<&str>) -> Option<String> {
    block(l, who, mark).or_else(|| inherited.and_then(|_| gate_state(&l.gate, who, mark)).map(|(_, t)| t))
}

fn join(inherited: Option<&str>, own: Option<String>) -> Option<String> {
    match (inherited, own) {
        (Some(a), Some(b)) => Some(format!("{a}; {b}")),
        (Some(a), None) => Some(a.to_owned()),
        (None, b) => b,
    }
}

/// Readings of a mark that a passing glance doesn't reach, each with why.
fn unreached(layers: &[Layer], who: &Abilities, mark: &MarkInstance, inherited: Option<&str>, out: &mut Vec<String>) {
    for l in layers {
        let why = join(inherited, own_why(l, who, mark, inherited));
        note(l, &why, mark, out);
        let mut won = false;
        for rung in &l.ladder {
            if won {
                note(rung, &Some("a better reading took precedence".into()), mark, out);
                continue;
            }
            let rung_why = join(why.as_deref(), own_why(rung, who, mark, why.as_deref()));
            note(rung, &rung_why, mark, out);
            unreached(&rung.children, who, mark, rung_why.as_deref(), out);
            // Without a blocker the rung is what the observer reads (no inherited block either).
            won = rung_why.is_none();
        }
        unreached(&l.children, who, mark, why.as_deref(), out);
    }
}

fn note(l: &Layer, why: &Option<String>, mark: &MarkInstance, out: &mut Vec<String>) {
    if let (Some(f), Some(w)) = (&l.reveals, why) {
        out.push(format!("\"{}\": {w}", fill(mark, &f.text)));
    }
}

fn parse_cell(text: &str) -> Option<Cell> {
    let t = text.trim().trim_start_matches('(').trim_end_matches(')');
    let (x, y) = t.split_once(',')?;
    Some(Cell::new(x.trim().parse().ok()?, y.trim().parse().ok()?))
}

struct Seen<'a> {
    room: &'a Room,
    seat: Handle,
    obs: Observer,
    lead: EntityId,
}

impl Seen<'_> {
    fn s(&self) -> &RoomState {
        self.room.state()
    }

    fn me(&self) -> &Creature {
        &self.s().creatures[&self.lead]
    }

    fn my_handle(&self) -> &str {
        self.s().names[&self.obs].of(self.lead).map_or("?", |a| a.handle.as_str())
    }

    /// The DM's handle and label, for the "truth" side.
    fn dm_name(&self, id: EntityId) -> String {
        let a = self.s().names.get(&Observer::Dm).and_then(|n| n.of(id));
        a.map_or_else(|| "?".into(), |a| format!("{} \"{}\"", a.handle, a.label))
    }

    /// What differs from the truth about a creature the seat perceives, in words.
    fn differences(&self, c: &Creature, seen_as: &str) -> Vec<String> {
        let s = self.s();
        let mut diffs = Vec::new();
        let truth = s.names.get(&Observer::Dm).and_then(|n| n.of(c.id));
        if truth.is_some_and(|t| !t.label.eq_ignore_ascii_case(seen_as)) {
            diffs.push(format!("really {}", self.dm_name(c.id)));
        }
        let read = stance::identities_seen(&s.codex, self.me(), c);
        let label = |h: &Handle| s.codex.identities.get(h).map_or_else(|| h.to_string(), |d| d.label.clone());
        let unread: Vec<_> = c.identities.iter().filter(|i| !read.contains(*i)).map(label).collect();
        if !unread.is_empty() {
            diffs.push(format!("identities not read: {}", unread.join(", ")));
        }
        let (reads, is) = (s.stance(self.lead, c.id), true_stance(self.me(), c));
        if reads != is {
            diffs.push(format!("stance reads {}, truth {}", word(reads), word(is)));
        }
        diffs
    }
}

/// One seat's view of the room, or of one thing in it (`at`: a handle the seat uses, or `x,y`).
pub fn see(room: &Room, seat: &str, at: Option<&str>) -> Result<String, String> {
    let s = room.state();
    let seat_h = Handle::new(seat).ok().filter(|h| s.seats.contains_key(h)).ok_or_else(|| {
        format!("this room has no seat called {seat} (seats: {})", s.seats.keys().map(|h| h.to_string()).collect::<Vec<_>>().join(", "))
    })?;
    let lead = s.lead(&seat_h).ok_or_else(|| format!("seat {seat} controls no creature, so it sees nothing"))?;
    let v = Seen { room, obs: Observer::Seat(seat_h.clone()), seat: seat_h, lead };
    match at {
        None => Ok(overview(&v)),
        Some(at) => detail(&v, at),
    }
}

fn header(v: &Seen) -> String {
    let c = v.me();
    let mut knows: Vec<_> = c.abilities.knows.iter().cloned().collect();
    knows.sort();
    let place = v.s().places.position_text(c.pos).map(|p| format!(" {p}")).unwrap_or_default();
    format!(
        "seat {} sees as {} at {}{place} · knows: {}",
        v.seat,
        v.my_handle(),
        c.pos,
        if knows.is_empty() { "nothing special".into() } else { knows.join(", ") }
    )
}

fn overview(v: &Seen) -> String {
    let s = v.s();
    let view = RoomView::new(v.room, &v.obs);
    let names = &s.names[&v.obs];
    let mut out = vec![header(v)];
    let mut seen: BTreeSet<EntityId> = BTreeSet::new();
    for cv in &view.creatures {
        let Some(id) = names.resolve(cv.handle.as_str()) else { continue };
        seen.insert(id);
        let mut line = format!("{} \"{}\" {} {} ft", cv.handle, cv.label, cv.pos, v.me().pos.distance_ft(cv.pos));
        if cv.yours {
            line += " · yours";
        } else {
            line += &format!(" · appears: {}", if cv.appears.is_empty() { "nothing in particular".into() } else { cv.appears.join("; ") });
            if let Some(st) = cv.stance {
                line += &format!(" · {}", word(st));
            }
            let diffs = v.differences(&s.creatures[&id], cv.label);
            if !diffs.is_empty() {
                line += &format!(" · ≠ truth: {}", diffs.join("; "));
            }
        }
        out.push(line);
    }
    let hidden: Vec<_> = s.creatures.keys().filter(|id| !seen.contains(id)).map(|&id| v.dm_name(id)).collect();
    if !hidden.is_empty() {
        out.push(format!("not perceived: {}", hidden.join(", ")));
    }
    out.join("\n")
}

fn detail(v: &Seen, at: &str) -> Result<String, String> {
    let s = v.s();
    let names = &s.names[&v.obs];
    if let Some(id) = names.resolve(at) {
        return Ok(creature_detail(v, id));
    }
    let Some(cell) = parse_cell(at) else {
        let known: Vec<_> = s.creatures.keys().filter_map(|&id| names.of(id)).map(|a| a.handle.to_string()).collect();
        return Err(format!("seat {} has no name \"{at}\" and it isn't a square like 5,9 (it knows: {})", v.seat, known.join(", ")));
    };
    let t = s.map.terrain(cell).ok_or_else(|| format!("{cell} is off the map ({}x{})", s.map.width, s.map.height))?;
    let mut flags = Vec::new();
    if t.blocks_move {
        flags.push("blocks movement");
    }
    if t.blocks_sight {
        flags.push("blocks sight");
    }
    if t.difficult {
        flags.push("difficult");
    }
    let place = s.places.position_text(cell).map(|p| format!(" · {p}")).unwrap_or_default();
    let mut out = vec![format!(
        "{cell}: {}{}{place} · {} ft from {}",
        t.name,
        if flags.is_empty() { String::new() } else { format!(" ({})", flags.join(", ")) },
        v.me().pos.distance_ft(cell),
        v.my_handle()
    )];
    match s.creature_at(cell) {
        None => out.push("nobody there".into()),
        Some(c) => match names.of(c.id) {
            Some(a) => out.push(format!("occupant, as {} knows it: {} \"{}\"", v.seat, a.handle, a.label)),
            None => out.push(format!("occupant: {}, which {} has no name for", v.dm_name(c.id), v.seat)),
        },
    }
    Ok(out.join("\n"))
}

fn creature_detail(v: &Seen, id: EntityId) -> String {
    let s = v.s();
    let c = &s.creatures[&id];
    let a = s.names[&v.obs].of(id).expect("resolved from the seat's names");
    let place = s.places.position_text(c.pos).map(|p| format!(" {p}")).unwrap_or_default();
    let mut out = vec![format!("{} \"{}\" at {}{place}, {} ft from {}", a.handle, a.label, c.pos, v.me().pos.distance_ft(c.pos), v.my_handle())];
    if s.controls(&v.obs, id) {
        out.push(format!("yours (truth: {})", v.dm_name(id)));
    } else {
        let diffs = v.differences(c, &a.label);
        out.push(if diffs.is_empty() { format!("same as the truth ({})", v.dm_name(id)) } else { format!("≠ truth: {}", diffs.join("; ")) });
        out.push(format!("stance: {}", word(s.stance(v.lead, id))));
    }
    let (mut reads, mut misses) = (Vec::new(), Vec::new());
    for m in &c.marks {
        let facets = read_passing(&s.codex, m, &v.me().abilities);
        reads.extend(facets.iter().map(|f| format!("  {} — {}", m.kind, facet_text(&s.codex, f))));
        if let Some(kind) = s.codex.marks.get(&m.kind) {
            let mut found = Vec::new();
            unreached(&kind.layers, &v.me().abilities, m, None, &mut found);
            misses.extend(found.into_iter().map(|f| format!("  {} — {f}", m.kind)));
        }
    }
    out.push("reads:".into());
    out.extend(if reads.is_empty() { vec!["  nothing".into()] } else { reads });
    if !misses.is_empty() {
        out.push("does not reach:".into());
        out.extend(misses);
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::def::RoomDef;
    use crate::Codex;

    fn crossroads() -> Room {
        let codex: Codex = serde_json::from_str(include_str!("../../../codex/core.json")).unwrap();
        let def: RoomDef = serde_json::from_str(include_str!("../../../rooms/crossroads.json")).unwrap();
        Room::open("crossroads", def, codex).unwrap()
    }

    fn line<'a>(text: &'a str, start: &str) -> &'a str {
        text.lines().find(|l| l.starts_with(start)).unwrap_or_else(|| panic!("no line starting {start:?} in:\n{text}"))
    }

    #[test]
    fn overview_names_things_the_way_the_seat_does() {
        let r = crossroads();
        let alice = see(&r, "alice", None).unwrap();
        assert!(alice.starts_with("seat alice sees as rook at (2, 8) in the lower hall"), "{alice}");
        let snikka = line(&alice, "goblin ");
        assert!(snikka.contains("\"goblin\"") && snikka.contains("a goblin: green skin, pointed ears"), "{snikka}");
        assert!(snikka.contains("≠ truth: really snikka \"Snikka\"") && snikka.contains("identities not read: Rotfang clan"), "{snikka}");
        assert!(line(&alice, "priest ").contains("a holy symbol"), "{alice}");
        assert!(line(&alice, "wren ").contains("a halfling"), "{alice}");
    }

    #[test]
    fn alice_and_sam_differ_where_their_characters_differ() {
        let r = crossroads();
        let s = see(&r, "sam", None).unwrap();
        assert!(s.starts_with("seat sam sees as wren") && s.contains("knows: common, elvish"), "{s}");
        assert!(line(&s, "rook ").contains("a human"), "{s}");
        let a = see(&r, "alice", None).unwrap();
        assert!(line(&a, "wren ").contains("a halfling") && line(&a, "rook ").contains("yours"), "{a}");
        // Rook wears the Watch's colours; Wren doesn't know the insignia.
        let rook = see(&r, "sam", Some("rook")).unwrap();
        assert!(rook.contains("a red tabard"), "{rook}");
        assert!(rook.contains("\"the colours of the Red Watch\": doesn't know red-watch-insignia"), "{rook}");
        assert!(rook.contains("≠ truth: identities not read: Red Watch"), "{rook}");
    }

    #[test]
    fn the_book_reads_differently_to_those_who_know_elvish() {
        let r = crossroads();
        let sam = see(&r, "sam", Some("priest")).unwrap();
        assert!(sam.contains("a holy symbol") && sam.contains("a leatherbound book"), "{sam}");
        assert!(sam.contains("\"it has a title\": needs a close look"), "{sam}");
        assert!(sam.contains("(elvish)\": needs a close look; knows elvish"), "{sam}");
        assert!(!sam.contains("doesn't know elvish"), "{sam}");
        assert!(sam.contains("holy-symbol — the sun-disc of Lathander"), "{sam}");
        let alice = see(&r, "alice", Some("priest")).unwrap();
        assert!(alice.contains("(elvish)\": needs a close look; doesn't know elvish"), "{alice}");
        assert!(alice.contains("\"the sun-disc of Lathander\": religion DC 12 vs passive 5"), "{alice}");
    }

    #[test]
    fn a_creature_in_detail_shows_what_is_read_and_what_is_not() {
        let r = crossroads();
        let d = see(&r, "sam", Some("goblin")).unwrap();
        assert!(d.starts_with("goblin \"goblin\" at (13, 2) in the east room"), "{d}");
        assert!(d.contains("≠ truth: really snikka \"Snikka\"") && d.contains("stance: hostile"), "{d}");
        assert!(d.contains("goblin-features — a goblin: green skin, pointed ears [goblin; high]"), "{d}");
        assert!(d.contains("a crude tattoo [low: not noticed in passing]"), "{d}");
        assert!(d.contains("\"a Rotfang clan tattoo\": doesn't know rotfang-signs"), "{d}");
    }

    #[test]
    fn a_square_in_detail() {
        let r = crossroads();
        let d = see(&r, "alice", Some("5,9")).unwrap();
        assert!(d.starts_with("(5, 9): flagstones · in the lower hall"), "{d}");
        assert!(d.contains("15 ft from rook") && d.contains("occupant, as alice knows it: wren \"Wren\""), "{d}");
        let rubble = see(&r, "alice", Some("(3, 8)")).unwrap();
        assert!(rubble.contains("rubble (difficult)") && rubble.contains("nobody there"), "{rubble}");
        let wall = see(&r, "alice", Some("0,0")).unwrap();
        assert!(wall.contains("blocks movement, blocks sight"), "{wall}");
    }

    #[test]
    fn unknown_seats_handles_and_squares_are_refused_clearly() {
        let r = crossroads();
        assert!(see(&r, "bob", None).unwrap_err().contains("no seat called bob (seats: alice, sam)"));
        let e = see(&r, "sam", Some("snikka")).unwrap_err();
        assert!(e.contains("no name \"snikka\"") && e.contains("goblin"), "{e}");
        assert!(see(&r, "sam", Some("40,40")).unwrap_err().contains("off the map"));
    }
}
