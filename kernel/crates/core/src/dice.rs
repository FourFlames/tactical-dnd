//! Dice tied to steps. Every roll is seeded from the step's dice key and the roll's position within
//! the step, so replaying history after an edit gives an untouched step the same rolls it had.

use crate::timeline::StepId;

pub struct Dice {
    key: u64,
    n: u64,
}

impl Dice {
    pub fn new(key: StepId) -> Self {
        Self { key: key.0, n: 0 }
    }

    /// 1..=sides.
    pub fn roll(&mut self, sides: u32) -> u32 {
        self.n += 1;
        (splitmix64(self.key.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ self.n) % u64::from(sides.max(1))) as u32 + 1
    }

    pub fn d20(&mut self) -> u32 {
        self.roll(20)
    }
}

fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_key_same_rolls_different_key_different_rolls() {
        let rolls = |k| {
            let mut d = Dice::new(StepId(k));
            (0..8).map(|_| d.d20()).collect::<Vec<_>>()
        };
        assert_eq!(rolls(7), rolls(7));
        assert_ne!(rolls(7), rolls(8));
        assert!(rolls(7).iter().all(|r| (1..=20).contains(r)));
    }
}
