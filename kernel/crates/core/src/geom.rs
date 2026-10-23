use serde::{Deserialize, Serialize};

/// Feet per grid square.
pub const SQUARE_FT: u32 = 5;

/// A grid square. (0, 0) is the top-left corner; x grows right, y grows down.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Cell {
    pub x: i32,
    pub y: i32,
}

impl Cell {
    pub const fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    /// The eight squares around this one.
    pub fn neighbors(self) -> impl Iterator<Item = Cell> {
        const D: [(i32, i32); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];
        D.into_iter().map(move |(dx, dy)| Cell::new(self.x + dx, self.y + dy))
    }

    /// 5e default grid rule: a diagonal step costs the same as an orthogonal one.
    pub fn distance_ft(self, other: Cell) -> u32 {
        let dx = self.x.abs_diff(other.x);
        let dy = self.y.abs_diff(other.y);
        dx.max(dy) * SQUARE_FT
    }
}

impl std::fmt::Display for Cell {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "({}, {})", self.x, self.y)
    }
}
