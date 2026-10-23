//! Rebuilding a room from what was saved: its steps (every branch) and branch heads. The server
//! decides where and how they are stored; this only checks them and replays.

use std::collections::BTreeMap;

use crate::room::Room;
use crate::timeline::{Branch, Step, Timeline};

impl Room {
    /// A room as it was when `steps` and `branches` were saved from its timeline.
    pub fn restore(id: impl Into<String>, steps: Vec<Step>, branches: BTreeMap<String, Branch>) -> Result<Self, String> {
        let (timeline, state) = Timeline::restore(steps, branches)?;
        Ok(Self { id: id.into(), timeline, state })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::Command;
    use crate::surgery::Surgery;
    use crate::testkit::*;
    use crate::timeline::StepId;

    /// What a server writes and reads back: steps and branches through JSON.
    fn round_trip(r: &Room) -> Room {
        let steps: Vec<Step> = r.timeline().steps().map(|s| serde_json::from_str(&serde_json::to_string(s).unwrap()).unwrap()).collect();
        let branches: BTreeMap<String, Branch> = r.timeline().branches().map(|(n, b)| (n.clone(), b.clone())).collect();
        let branches = serde_json::from_str(&serde_json::to_string(&branches).unwrap()).unwrap();
        Room::restore(r.id.clone(), steps, branches).unwrap()
    }

    #[test]
    fn a_saved_room_loads_equal_and_goes_on_the_same() {
        let mut r = room();
        for i in 0..40 {
            run(&mut r, &[mv("rook", if i % 2 == 0 { 2 } else { 1 }, 1)]);
        }
        assert!(r.execute(&DM, &[mv("rook", 9, 9)], None, false).is_err());
        let p = r.surgery(Surgery::Insert { after: StepId(1), commands: vec![place("snikka", 3, 1)] }, Some("Snikka waits".into())).unwrap();
        r.commit(&p.branch).unwrap(); // leaves dropped steps, a before-* branch, replayed keys
        let on_main = r.timeline().path(r.timeline().head())[10];
        r.surgery(Surgery::Remove { step: on_main }, None).unwrap(); // a draft left open

        let mut loaded = round_trip(&r);
        assert_eq!(loaded.timeline(), r.timeline(), "same steps, branches, heads and keyframes");
        assert_eq!(loaded.state(), r.state());
        assert_eq!(loaded.seq(), r.seq());
        assert_eq!(loaded.timeline().peek_id(), r.timeline().peek_id());

        // Further commands decide the same, dice and ids included.
        for room in [&mut r, &mut loaded] {
            room.execute(&alice(), &[mv("rook", 3, 1)], Some("on".into()), false).ok();
            room.execute(&DM, &[place("rook", 5, 1), Command::Wait { seconds: 6 }], None, false).unwrap();
        }
        assert_eq!(loaded.timeline(), r.timeline());
        assert_eq!(loaded.state(), r.state());
    }

    #[test]
    fn a_save_with_holes_is_refused() {
        let mut r = room();
        run(&mut r, &[mv("rook", 2, 1)]);
        run(&mut r, &[mv("rook", 3, 1)]);
        let mut steps: Vec<Step> = r.timeline().steps().cloned().collect();
        steps.remove(1);
        let branches = r.timeline().branches().map(|(n, b)| (n.clone(), b.clone())).collect();
        assert!(Room::restore("t", steps, branches).unwrap_err().contains("isn't saved"));
    }
}
