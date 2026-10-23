//! Shared fixtures for the kernel's tests.

use std::collections::BTreeMap;

use crate::codex::Codex;
use crate::command::Command;
use crate::def::{CreatureDef, RoomDef};
use crate::event::Event;
use crate::geom::Cell;
use crate::id::{EntityId, Handle};
use crate::map::Terrain;
use crate::observer::Observer;
use crate::room::Room;
use crate::timeline::Step;

fn terrain(name: &str, blocks: bool, difficult: bool) -> Terrain {
    Terrain { name: name.into(), blocks_move: blocks, blocks_sight: blocks, difficult }
}

pub fn h(s: &str) -> Handle {
    Handle::new(s).unwrap()
}

fn codex() -> Codex {
    serde_json::from_value(serde_json::json!({
        "identities": {
            "human": { "label": "human", "kind": "kind" },
            "goblin": { "label": "goblin", "kind": "kind" },
            "red-watch": { "label": "Red Watch", "kind": "group" },
            "stranger": { "label": "stranger", "kind": "relational" }
        },
        "marks": {
            "human-features": { "senses": { "sight": 2 }, "layers": [ { "reveals": { "text": "a human", "identity": "human" } } ] },
            "goblin-features": { "senses": { "sight": 3 }, "layers": [ { "reveals": { "text": "a goblin", "identity": "goblin", "salience": "high" } } ] },
            "red-tabard": { "senses": { "sight": 3 }, "layers": [ { "reveals": { "text": "a red tabard" }, "children": [
                { "gate": { "knows": "red-watch-insignia" }, "reveals": { "text": "the Red Watch's colours", "identity": "red-watch", "salience": "high" } }
            ] } ] }
        }
    }))
    .unwrap()
}

fn creature(key: &str, name: &str, x: i32, y: i32, extra: serde_json::Value) -> CreatureDef {
    let mut v = serde_json::json!({ "key": key, "name": name, "at": { "x": x, "y": y }, "hp": 10 });
    v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(v).unwrap()
}

/// Rook (id 1) wears the Red Watch's colours. Snikka (2) knows them and hates the Watch; Grub (3)
/// doesn't know them and is merely wary of humans, so Grub's square doesn't block Rook but Snikka's would.
///
/// ```text
/// #########
/// #.......#   row 1: a corridor between the walls (the places `corridor` and `rubble-strip`)
/// #.#####.#
/// #.,,,,,.#   row 3: rubble
/// #########
/// ```
pub fn room_with(snikka_at: (i32, i32), grub_at: (i32, i32)) -> Room {
    use serde_json::json;
    let def = RoomDef {
        name: "test".into(),
        legend: BTreeMap::from([('.', terrain("floor", false, false)), ('#', terrain("wall", true, false)), (',', terrain("rubble", false, true))]),
        rows: vec!["#########".into(), "#.......#".into(), "#.#####.#".into(), "#.,,,,,.#".into(), "#########".into()],
        creatures: vec![
            creature("rook", "Rook", 1, 1, json!({
                "marks": [ { "kind": "human-features" }, { "kind": "red-tabard" } ],
                "identities": ["red-watch"], "knows": ["red-watch-insignia"], "dispositions": { "goblin": "hostile" }
            })),
            creature("snikka", "Snikka", snikka_at.0, snikka_at.1, json!({
                "marks": [ { "kind": "goblin-features" } ], "knows": ["red-watch-insignia"], "dispositions": { "red-watch": "hostile" }
            })),
            creature("grub", "Grub", grub_at.0, grub_at.1, json!({
                "marks": [ { "kind": "goblin-features" } ], "dispositions": { "human": "wary" }
            })),
        ],
        seats: BTreeMap::from([(h("alice"), vec![h("rook")])]),
        places: serde_json::from_value(json!([
            { "key": "corridor", "name": "the corridor", "rects": [ { "x": 1, "y": 1, "w": 7, "h": 1 } ] },
            { "key": "rubble-strip", "name": "the rubble", "rects": [ { "x": 2, "y": 3, "w": 5, "h": 1 } ] }
        ]))
        .unwrap(),
    };
    Room::open("t", def, codex()).unwrap()
}

pub fn room() -> Room {
    room_with((7, 3), (4, 1))
}

pub const DM: Observer = Observer::Dm;

pub fn alice() -> Observer {
    Observer::Seat(h("alice"))
}

pub fn mv(who: &str, x: i32, y: i32) -> Command<String> {
    Command::Move { who: who.into(), to: Cell::new(x, y) }
}

pub fn place(who: &str, x: i32, y: i32) -> Command<String> {
    Command::Place { who: who.into(), to: Cell::new(x, y) }
}

/// The cost of a step's first event, which must be a move.
pub fn cost(step: &Step) -> u32 {
    match &step.events()[0] {
        Event::CreatureMoved { cost_ft, .. } => *cost_ft,
        e => panic!("{e:?}"),
    }
}

pub fn pos(r: &Room, id: u32) -> Cell {
    r.state().creatures[&EntityId(id)].pos
}

/// Runs commands as the DM and returns the step.
pub fn run(r: &mut Room, cmds: &[Command<String>]) -> Step {
    r.execute(&DM, cmds, None, false).unwrap()
}
