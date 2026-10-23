//! Places: named areas of a room, in a tree ("the altar" is in "the nave", which is in "the shrine").
//!
//! A place is an entity like a creature: it has an id that never leaves the kernel ([`PlaceId`]),
//! and a handle per observer. For now every observer uses the DM's handles and names; per-observer
//! place names arrive with perception. A place owns some rectangles of squares, or none yet.

use std::collections::{BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::geom::{Cell, SQUARE_FT};
use crate::id::{Handle, PlaceId};
use crate::map::Map;

/// How far, in feet, a place can be and still be mentioned as nearby.
pub const NEARBY_FT: u32 = 30;

/// A block of squares: `w` wide and `h` tall, with its top-left corner at (`x`, `y`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn contains(&self, c: Cell) -> bool {
        c.x >= self.x && c.y >= self.y && c.x < self.x + self.w && c.y < self.y + self.h
    }

    /// Every square in the block, row by row.
    pub fn cells(&self) -> impl Iterator<Item = Cell> + '_ {
        (self.y..self.y + self.h).flat_map(move |y| (self.x..self.x + self.w).map(move |x| Cell::new(x, y)))
    }

    /// Feet from `c` to the nearest square of the block (0 inside it).
    fn distance_ft(&self, c: Cell) -> u32 {
        let dx = (self.x - c.x).max(c.x - (self.x + self.w - 1)).max(0) as u32;
        let dy = (self.y - c.y).max(c.y - (self.y + self.h - 1)).max(0) as u32;
        dx.max(dy) * SQUARE_FT
    }
}

/// A place as written in a room definition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlaceDef {
    /// The DM's handle for it.
    pub key: Handle,
    /// How it reads in a sentence: "the nave".
    pub name: String,
    /// The place it is in, by key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Handle>,
    #[serde(default)]
    pub rects: Vec<Rect>,
}

/// A place in a built room.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub id: PlaceId,
    pub key: Handle,
    pub name: String,
    pub parent: Option<PlaceId>,
    pub rects: Vec<Rect>,
}

impl Place {
    /// Whether the square is among this place's own rectangles (not its sub-places').
    pub fn owns(&self, c: Cell) -> bool {
        self.rects.iter().any(|r| r.contains(c))
    }

    /// Every square this place owns, once each, in reading order.
    pub fn squares(&self) -> Vec<Cell> {
        let set: BTreeSet<(i32, i32)> = self.rects.iter().flat_map(Rect::cells).map(|c| (c.y, c.x)).collect();
        set.into_iter().map(|(y, x)| Cell::new(x, y)).collect()
    }

    fn area(&self) -> usize {
        self.squares().len()
    }

    fn distance_ft(&self, c: Cell) -> Option<u32> {
        self.rects.iter().map(|r| r.distance_ft(c)).min()
    }
}

/// All the places of a room. Ids are given out in definition order, from 1.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Places {
    list: Vec<Place>,
}

impl Places {
    /// Checks the definitions against the map and builds the tree. Errors are for the author:
    /// duplicate keys, unknown parents, cycles, empty or off-map rectangles.
    pub fn build(defs: &[PlaceDef], map: &Map) -> Result<Self, String> {
        let mut seen = HashSet::new();
        for d in defs {
            if !seen.insert(&d.key) {
                return Err(format!("two places are called {}", d.key));
            }
        }
        let id_of = |k: &Handle| defs.iter().position(|d| &d.key == k).map(|i| PlaceId(i as u32 + 1));
        let mut list = Vec::new();
        for (i, d) in defs.iter().enumerate() {
            let parent = match &d.parent {
                None => None,
                Some(p) => Some(id_of(p).ok_or_else(|| format!("place {} is in {p}, which isn't a place in the room", d.key))?),
            };
            for r in &d.rects {
                if r.w < 1 || r.h < 1 {
                    return Err(format!("place {} has an empty rectangle", d.key));
                }
                let (far_x, far_y) = (r.x.checked_add(r.w - 1), r.y.checked_add(r.h - 1));
                let corners_on = [Cell::new(r.x, r.y), Cell::new(far_x.unwrap_or(i32::MAX), far_y.unwrap_or(i32::MAX))];
                if corners_on.iter().any(|&c| !map.in_bounds(c)) {
                    return Err(format!("place {} has a rectangle ({},{} {}x{}) that isn't on the {}x{} map", d.key, r.x, r.y, r.w, r.h, map.width, map.height));
                }
            }
            list.push(Place { id: PlaceId(i as u32 + 1), key: d.key.clone(), name: d.name.clone(), parent, rects: d.rects.clone() });
        }
        let places = Self { list };
        for p in &places.list {
            // A parent chain longer than the number of places must loop.
            let mut at = p.parent;
            for _ in 0..places.list.len() {
                match at {
                    None => break,
                    Some(id) if id == p.id => return Err(format!("place {} is inside itself (a loop of parents)", p.key)),
                    Some(id) => at = places.get(id).parent,
                }
            }
            if at.is_some() {
                return Err(format!("place {} is inside itself (a loop of parents)", p.key));
            }
        }
        Ok(places)
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Place> {
        self.list.iter()
    }

    /// The place with this id. Ids come only from this room, so it exists.
    pub fn get(&self, id: PlaceId) -> &Place {
        &self.list[id.0 as usize - 1]
    }

    /// The place the DM calls `handle`.
    pub fn resolve(&self, handle: &str) -> Option<PlaceId> {
        self.list.iter().find(|p| p.key.as_str() == handle).map(|p| p.id)
    }

    /// The places around `id`, nearest first: its parent, that one's parent, and so on to the root.
    pub fn ancestors(&self, id: PlaceId) -> Vec<PlaceId> {
        std::iter::successors(self.get(id).parent, |&p| self.get(p).parent).collect()
    }

    /// How many places are above `id`.
    fn depth(&self, id: PlaceId) -> usize {
        self.ancestors(id).len()
    }

    /// The most specific place a square is in: the deepest in the tree, and among equals the
    /// smaller one. `None` if no place owns it.
    pub fn at(&self, c: Cell) -> Option<PlaceId> {
        self.list.iter().filter(|p| p.owns(c)).min_by_key(|p| (std::cmp::Reverse(self.depth(p.id)), p.area(), p.id)).map(|p| p.id)
    }

    /// Whether `c` is in `id`: on its own squares, or on those of a place inside it.
    pub fn within(&self, id: PlaceId, c: Cell) -> bool {
        self.list.iter().any(|p| p.owns(c) && (p.id == id || self.ancestors(p.id).contains(&id)))
    }

    /// Every square in `id` or the places inside it, in reading order.
    pub fn squares_within(&self, id: PlaceId) -> Vec<Cell> {
        let set: BTreeSet<(i32, i32)> = self
            .list
            .iter()
            .filter(|p| p.id == id || self.ancestors(p.id).contains(&id))
            .flat_map(Place::squares)
            .map(|c| (c.y, c.x))
            .collect();
        set.into_iter().map(|(y, x)| Cell::new(x, y)).collect()
    }

    /// Where a square is, in words: "in the nave", or "in the nave, 10 ft from the altar" when
    /// another place that doesn't hold the square lies within [`NEARBY_FT`]. `None` if no place
    /// owns the square. Names are the DM's for now.
    pub fn position_text(&self, c: Cell) -> Option<String> {
        let here = self.get(self.at(c)?);
        let near = self
            .list
            .iter()
            .filter(|p| !self.within(p.id, c))
            .filter_map(|p| Some((p.distance_ft(c).filter(|&d| d <= NEARBY_FT)?, p)))
            .min_by_key(|(d, p)| (*d, std::cmp::Reverse(self.depth(p.id)), p.area(), p.id));
        Some(match near {
            Some((ft, p)) => format!("in {}, {ft} ft from {}", here.name, p.name),
            None => format!("in {}", here.name),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex::Codex;
    use crate::def::RoomDef;
    use crate::geom::Cell;
    use crate::room::Room;
    use crate::testkit::h;

    fn open_map(w: i32, hgt: i32) -> Map {
        Map { width: w, height: hgt, palette: vec![crate::map::Terrain { name: "floor".into(), blocks_move: false, blocks_sight: false, difficult: false }], tiles: vec![0; (w * hgt) as usize] }
    }

    fn def(key: &str, name: &str, parent: Option<&str>, rects: &[(i32, i32, i32, i32)]) -> PlaceDef {
        PlaceDef { key: h(key), name: name.into(), parent: parent.map(h), rects: rects.iter().map(|&(x, y, w, h)| Rect { x, y, w, h }).collect() }
    }

    /// A 20x10 map: a hall (0,0 12x6) with a nave inside (0,0 6x6) and an altar in the nave
    /// (2,0 2x1); a yard (14,0 6x6); and a "crypt" that overlaps the nave but is deeper than it.
    fn tree() -> Places {
        Places::build(
            &[
                def("hall", "the hall", None, &[(0, 0, 12, 6)]),
                def("nave", "the nave", Some("hall"), &[(0, 0, 6, 6)]),
                def("altar", "the altar", Some("nave"), &[(2, 0, 2, 1)]),
                def("yard", "the yard", None, &[(14, 0, 6, 6)]),
                def("rug", "the rug", Some("hall"), &[(4, 4, 4, 2)]),
            ],
            &open_map(20, 10),
        )
        .unwrap()
    }

    #[test]
    fn the_most_specific_place_wins() {
        let p = tree();
        let key = |c| p.at(c).map(|id| p.get(id).key.to_string());
        assert_eq!(key(Cell::new(2, 0)), Some("altar".into()), "altar is deeper than nave and hall");
        assert_eq!(key(Cell::new(0, 0)), Some("nave".into()));
        assert_eq!(key(Cell::new(9, 3)), Some("hall".into()));
        assert_eq!(key(Cell::new(15, 2)), Some("yard".into()));
        assert_eq!(key(Cell::new(12, 8)), None, "no place owns it");
    }

    #[test]
    fn overlaps_at_the_same_depth_go_to_the_smaller_place() {
        let p = tree();
        // (4,4) and (5,5) are in both the nave (36 squares, depth 1) and the rug (8, depth 1).
        assert_eq!(p.at(Cell::new(5, 5)).map(|id| p.get(id).key.to_string()), Some("rug".into()));
        assert_eq!(p.at(Cell::new(3, 4)).map(|id| p.get(id).key.to_string()), Some("nave".into()));
    }

    #[test]
    fn chains_and_membership_follow_the_tree() {
        let p = tree();
        let altar = p.resolve("altar").unwrap();
        let keys = |ids: Vec<PlaceId>| ids.into_iter().map(|i| p.get(i).key.to_string()).collect::<Vec<_>>();
        assert_eq!(keys(p.ancestors(altar)), ["nave", "hall"]);
        assert!(p.ancestors(p.resolve("hall").unwrap()).is_empty());
        assert!(p.within(p.resolve("hall").unwrap(), Cell::new(2, 0)), "the hall holds the altar's squares");
        assert!(!p.within(altar, Cell::new(0, 0)));
        assert_eq!(p.resolve("cellar"), None);
        assert_eq!(p.squares_within(p.resolve("nave").unwrap()).len(), 36);
    }

    #[test]
    fn position_text_names_the_place_and_the_nearest_other_one() {
        let p = tree();
        // On the altar's row, two squares from it.
        assert_eq!(p.position_text(Cell::new(0, 0)).unwrap(), "in the nave, 10 ft from the altar");
        assert_eq!(p.position_text(Cell::new(1, 3)).unwrap(), "in the nave, 15 ft from the altar");
        // On the altar the nave and hall hold the square, so the nearest other place is the rug.
        assert_eq!(p.position_text(Cell::new(2, 0)).unwrap(), "in the altar, 20 ft from the rug");
        assert_eq!(p.position_text(Cell::new(14, 0)).unwrap(), "in the yard, 15 ft from the hall");
        // Beyond 30 ft there is nothing to mention.
        assert_eq!(p.position_text(Cell::new(19, 5)).unwrap(), "in the yard");
        assert_eq!(p.position_text(Cell::new(12, 8)), None);
    }

    #[test]
    fn bad_definitions_are_refused() {
        let map = open_map(10, 10);
        let err = |defs: &[PlaceDef]| Places::build(defs, &map).unwrap_err();
        assert!(err(&[def("a", "a", None, &[]), def("a", "b", None, &[])]).contains("two places are called a"));
        assert!(err(&[def("a", "a", Some("zed"), &[])]).contains("zed"));
        assert!(err(&[def("a", "a", Some("b"), &[]), def("b", "b", Some("a"), &[])]).contains("inside itself"));
        assert!(err(&[def("a", "a", Some("a"), &[])]).contains("inside itself"));
        assert!(err(&[def("a", "a", None, &[(8, 8, 3, 1)])]).contains("isn't on the 10x10 map"));
        assert!(err(&[def("a", "a", None, &[(-1, 0, 2, 2)])]).contains("isn't on the"));
        assert!(err(&[def("a", "a", None, &[(0, 0, 0, 2)])]).contains("empty"));
        // A place with no geometry yet is fine.
        assert!(Places::build(&[def("capital", "the capital", None, &[])], &map).is_ok());
    }

    #[test]
    fn the_crossroads_loads_with_its_places() {
        let codex: Codex = serde_json::from_str(include_str!("../../../codex/core.json")).unwrap();
        let def: RoomDef = serde_json::from_str(include_str!("../../../rooms/crossroads.json")).unwrap();
        let room = Room::open("crossroads", def, codex).unwrap();
        let s = room.state();
        let keys: Vec<_> = s.places.iter().map(|p| p.key.to_string()).collect();
        assert_eq!(keys, ["shrine", "nave", "altar", "east-room", "lower-hall", "ford"]);
        // Only the shrine as a whole spans walls; every other place is open floor, water or pillars.
        for p in s.places.iter().filter(|p| p.key.as_str() != "shrine") {
            for c in p.squares() {
                assert_ne!(s.map.terrain(c).unwrap().name, "wall", "{} covers a wall at {c}", p.key);
            }
        }
        let say = |x, y| s.places.position_text(Cell::new(x, y)).unwrap();
        assert_eq!(say(5, 3), "in the nave, 10 ft from the altar", "Osric");
        assert_eq!(say(13, 2), "in the east room, 25 ft from the ford", "Snikka");
        assert_eq!(say(17, 8), "in the ford, 15 ft from the east room");
        assert_eq!(say(2, 8), "in the lower hall, 15 ft from the nave", "Rook");
        // The doorway between the hall and the nave belongs to the shrine alone.
        assert_eq!(say(4, 6), "in the shrine, 5 ft from the nave");
    }
}
