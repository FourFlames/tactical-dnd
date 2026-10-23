//! Routing on the grid.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use crate::creature::Creature;
use crate::geom::{Cell, SQUARE_FT};
use crate::room::RoomState;
use crate::stance::Stance;

/// A route from a creature's square: every square after the start, and what it costs in feet.
#[derive(Clone, Debug, PartialEq)]
pub struct Route {
    pub path: Vec<Cell>,
    pub cost_ft: u32,
}

/// Squares `who` can't pass through: those held by creatures hostile to it, by their own reading
/// of it. A convincing disguise lets you slip past.
fn blocked_by_occupants(state: &RoomState, who: &Creature) -> HashSet<Cell> {
    state.creatures.values().filter(|c| c.id != who.id && state.stance(c.id, who.id) == Stance::Hostile).map(|c| c.pos).collect()
}

/// What it costs to step from `from` into the neighbouring square `to`, or `None` if it can't.
/// Walls block, as do `blocked` squares, and a diagonal can't slip between two blocked corners.
/// A step *out of* difficult terrain costs double (house rule: entering is free, so a creature
/// shoved or conjured into rubble pays to get out, while crossing a strip costs the same as by the book).
fn step_cost(state: &RoomState, blocked: &HashSet<Cell>, from: Cell, to: Cell) -> Option<u32> {
    state.map.terrain(to).filter(|t| !t.blocks_move)?;
    if blocked.contains(&to) {
        return None;
    }
    if from.x != to.x && from.y != to.y {
        let a = Cell::new(to.x, from.y);
        let b = Cell::new(from.x, to.y);
        if !state.map.passable(a) && !state.map.passable(b) {
            return None;
        }
    }
    let leaving_difficult = state.map.terrain(from).is_some_and(|t| t.difficult);
    Some(if leaving_difficult { 2 * SQUARE_FT } else { SQUARE_FT })
}

/// The cheapest route for `who` to `goal` (Dijkstra; costs are small integers). It may pass
/// through creatures that aren't hostile to it but must end on an empty square. Speed is not checked here. Among routes of
/// equal cost it takes the one with fewest diagonal steps, so routes run straight, not zig-zag.
pub fn route(state: &RoomState, who: &Creature, goal: Cell) -> Option<Route> {
    if goal == who.pos {
        return None;
    }
    route_to_any(state, who, &HashSet::from([goal]))
}

/// The cheapest route for `who` to any of `goals` (same rules as [`route`]). Goals that aren't
/// open, empty squares are ignored, as is the creature's own square.
pub fn route_to_any(state: &RoomState, who: &Creature, goals: &HashSet<Cell>) -> Option<Route> {
    let goals: HashSet<Cell> = goals.iter().copied().filter(|&g| g != who.pos && state.map.passable(g) && state.creature_at(g).is_none()).collect();
    if goals.is_empty() {
        return None;
    }
    let blocked = blocked_by_occupants(state, who);
    // Ranked by (feet, diagonal steps).
    let mut best: HashMap<Cell, (u32, u32)> = HashMap::from([(who.pos, (0, 0))]);
    let mut came_from: HashMap<Cell, Cell> = HashMap::new();
    let mut open = BinaryHeap::from([Reverse(((0u32, 0u32), who.pos))]);

    while let Some(Reverse(((cost, diagonals), at))) = open.pop() {
        if goals.contains(&at) {
            let mut path = vec![at];
            while let Some(&prev) = came_from.get(path.last().unwrap()) {
                if prev == who.pos {
                    break;
                }
                path.push(prev);
            }
            path.reverse();
            return Some(Route { path, cost_ft: cost });
        }
        if best.get(&at).is_some_and(|&b| b < (cost, diagonals)) {
            continue;
        }
        for next in at.neighbors() {
            let Some(step) = step_cost(state, &blocked, at, next) else { continue };
            let diagonal = u32::from(next.x != at.x && next.y != at.y);
            let total = (cost + step, diagonals + diagonal);
            if best.get(&next).is_none_or(|&b| total < b) {
                best.insert(next, total);
                came_from.insert(next, at);
                open.push(Reverse((total, next)));
            }
        }
    }
    None
}
