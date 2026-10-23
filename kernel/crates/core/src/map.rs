use serde::{Deserialize, Serialize};

use crate::geom::Cell;

/// What a square is made of. Rooms list each kind once in a palette; squares index into it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Terrain {
    pub name: String,
    #[serde(default)]
    pub blocks_move: bool,
    #[serde(default)]
    pub blocks_sight: bool,
    /// Costs double to leave (see `movement::step_cost`).
    #[serde(default)]
    pub difficult: bool,
}

/// The floor plan: a grid of terrain, stored row-major as indices into `palette`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Map {
    pub width: i32,
    pub height: i32,
    pub palette: Vec<Terrain>,
    pub tiles: Vec<u16>,
}

impl Map {
    pub fn in_bounds(&self, c: Cell) -> bool {
        c.x >= 0 && c.y >= 0 && c.x < self.width && c.y < self.height
    }

    /// The terrain at `c`, or `None` off the map.
    pub fn terrain(&self, c: Cell) -> Option<&Terrain> {
        if !self.in_bounds(c) {
            return None;
        }
        let i = (c.y * self.width + c.x) as usize;
        self.palette.get(self.tiles[i] as usize)
    }

    pub fn passable(&self, c: Cell) -> bool {
        self.terrain(c).is_some_and(|t| !t.blocks_move)
    }
}
