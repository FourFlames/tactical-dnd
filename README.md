# Tactical D&D

Tactical D&D 5e with Claude Code as the Dungeon Master. This branch is the Rust kernel that replaces the
original Node engine: an event-sourced room where every observer (the DM, each player, later each NPC
mind) sees the world in their own names and through their own perception, with a timeline the DM can
edit and branch, and DM tools measured for latency from the start.

## Run it

```bash
cargo run --manifest-path kernel/Cargo.toml -p kernel-server      # battlemap at http://localhost:5180/?as=alice
cargo build --manifest-path kernel/Cargo.toml -p kernel-dm        # then: kernel/target/debug/dm look
```

`?as=dm` shows the DM's view; `?as=alice` and `?as=sam` are the seats in the sample room. How a DM runs a
room: [kernel/DM.md](kernel/DM.md). Where the work stands: [kernel/HANDOFF.md](kernel/HANDOFF.md). The
design: [docs/kernel-perception.md](docs/kernel-perception.md).

## The old engine

The Node engine, viewer and character builder are in [legacy/](legacy/) (its README and instructions are
there) until the kernel has ported what it needs. The last commit before the move is tagged
`node-engine-final`.
