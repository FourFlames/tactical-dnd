//! `dm`: the DM's tool. Talks to a running kernel server and prints short text: one line per
//! step, summary first, with ids that can be passed straight back. See kernel/DM.md.

use serde_json::{json, Value};

const HELP: &str = "\
dm <command> [--room R]          (server: $KERNEL_URL, default http://localhost:5180)

  look                            the room now: everyone, where, HP, stance to the party
  act \"<script>\" [--gist G] [--re MSG] [--as SEAT] [--dry]
                                  run commands as one step, e.g. act \"move rook 4,5; wait 1 round\" --re 3
  history [N] [--branch B]        the last N steps (default 20)
  wait [--timeout SECONDS]        block until players message you; prints them as one batch
  reply <id> \"<text>\" [--done]    answer a message (--done when it's resolved)
  messages                        every message and its replies
  insert <after> \"<script>\"       edit history: each makes a draft branch and prints a preview
  remove <step> · edit <step> \"<script>\" · fiat <step>     (all take --gist and --re)
  commit <branch> · discard <branch> · branches · rewind <step>
  stats                           latency of every hop

  log [N] [--re m3] [--kind step,reply] [--who alice] [--since 10:02|5m]
                                  the session journal (last 50 lines that match)
  wish \"<tool you wanted>\" [--re MSG]   note a command or tool you wished you had
  review                          the post-mortem: what skipped the DM, rulings, slow waits, wishes

script: move <who> <x>,<y> · place <who> <x>,<y> · wait <n> s|rounds|min|hours  (one per line or ;)";

struct Client {
    base: String,
    room: String,
    agent: ureq::Agent,
}

impl Client {
    fn url(&self, path: &str) -> String {
        format!("{}/api/rooms/{}{path}", self.base, self.room)
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        self.read(self.agent.get(&self.url(path)).call())
    }

    fn get_with(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let req = query.iter().fold(self.agent.get(&self.url(path)), |r, (k, v)| r.query(k, v));
        self.read(req.call())
    }

    fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.read(self.agent.post(&self.url(path)).send_json(body))
    }

    /// Refusals come back as bodies with `ok: false`, for the caller to word; only a dead
    /// connection is an error here.
    fn read(&self, r: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
        match r {
            Ok(resp) => resp.into_json().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(_, resp)) => Ok(resp.into_json().unwrap_or_else(|_| json!({ "ok": false, "reason": "the server sent an error" }))),
            Err(e) => Err(format!("can't reach the kernel at {}: {e}", self.base)),
        }
    }
}

fn refused(v: &Value) -> Option<String> {
    (v["ok"] == false).then(|| v["reason"].as_str().unwrap_or("refused").to_owned())
}

fn ok(v: Value) -> Result<Value, String> {
    match refused(&v) {
        Some(r) => Err(format!("REFUSED: {r}")),
        None => Ok(v),
    }
}

fn lines(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

/// Removes `--name value` from args.
fn opt(args: &mut Vec<String>, name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    args.remove(i);
    (i < args.len()).then(|| args.remove(i))
}

fn flag(args: &mut Vec<String>, name: &str) -> bool {
    args.iter().position(|a| a == name).map(|i| args.remove(i)).is_some()
}

fn step_arg(rest: &[String], what: &str) -> Result<u64, String> {
    rest.first().and_then(|s| s.trim_start_matches('#').parse().ok()).ok_or_else(|| format!("which {what}? (a step id like 12 or #12)"))
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let base = std::env::var("KERNEL_URL").unwrap_or_else(|_| "http://localhost:5180".into());
    let agent = ureq::AgentBuilder::new().build();
    let room = match opt(&mut args, "--room").or_else(|| std::env::var("KERNEL_ROOM").ok()) {
        Some(r) => r,
        None => {
            let rooms: Value = agent.get(&format!("{base}/api/rooms")).call().map_err(|e| format!("can't reach the kernel at {base}: {e}"))?.into_json().map_err(|e| e.to_string())?;
            rooms[0]["id"].as_str().ok_or("the server has no rooms")?.to_owned()
        }
    };
    let c = Client { base, room, agent };
    let gist = opt(&mut args, "--gist");
    let seat = opt(&mut args, "--as");
    let branch = opt(&mut args, "--branch");
    let timeout = opt(&mut args, "--timeout");
    let re = opt(&mut args, "--re");
    let (kind, who, since) = (opt(&mut args, "--kind"), opt(&mut args, "--who"), opt(&mut args, "--since"));
    let (dry, done) = (flag(&mut args, "--dry"), flag(&mut args, "--done"));
    let Some((cmd, rest)) = args.split_first() else {
        println!("{HELP}");
        return Ok(());
    };

    match cmd.as_str() {
        "look" => look(&c)?,
        "act" => {
            let text = rest.join(" ");
            let v = c.post("/commands", json!({ "as": seat, "gist": gist, "script": text, "dry_run": dry, "re": re }))?;
            match refused(&v) {
                Some(r) if v["index"].is_number() => return Err(format!("REFUSED (command {}): {r}", v["index"].as_u64().unwrap_or(0) + 1)),
                Some(r) => return Err(format!("REFUSED: {r}")),
                None => println!("{}{}", if dry { "would: " } else { "" }, v["line"].as_str().unwrap_or("(nothing you'd see)")),
            }
        }
        "history" => {
            let n = rest.first().and_then(|s| s.parse::<usize>().ok()).unwrap_or(20);
            let mut q = format!("/history?limit={n}");
            if let Some(b) = &branch {
                q += &format!("&branch={b}");
            }
            if let Some(s) = &seat {
                q += &format!("&as={s}");
            }
            let v = ok(c.get(&q)?)?;
            lines(&v["lines"]).iter().for_each(|l| println!("{l}"));
        }
        "wait" => {
            let t = timeout.unwrap_or_else(|| "300".into());
            let v = ok(c.get(&format!("/wait?timeout={t}"))?)?;
            println!("{}", v["text"].as_str().unwrap_or(""));
            return Ok(()); // no footer: this *is* the inbox
        }
        "reply" => {
            let n = step_arg(rest, "message")?;
            let text = rest[1..].join(" ");
            if text.trim().is_empty() {
                return Err("reply with what? dm reply <id> \"text\"".into());
            }
            ok(c.post(&format!("/messages/{n}/reply"), json!({ "text": text, "done": done }))?)?;
            println!("replied to #{n}{}", if done { " (done)" } else { "" });
        }
        "messages" => {
            let v = ok(c.get("/messages")?)?;
            for m in v.as_array().into_iter().flatten() {
                let at = m["at"].as_str().map(|a| format!(" @{a}")).unwrap_or_default();
                println!("#{} {} [{}] \"{}\"{at}", m["id"], m["from"].as_str().unwrap_or("?"), m["status"].as_str().unwrap_or("?"), m["text"].as_str().unwrap_or(""));
                lines(&m["replies"]).iter().for_each(|r| println!("   ↳ {r}"));
            }
        }
        "insert" | "remove" | "edit" | "fiat" => {
            let step = step_arg(rest, "step")?;
            let script = rest[1..].join(" ");
            let mut body = match cmd.as_str() {
                "insert" => json!({ "op": "insert", "after": step, "script": script }),
                "edit" => json!({ "op": "edit", "step": step, "script": script }),
                "remove" => json!({ "op": "remove", "step": step }),
                _ => json!({ "op": "keep_as_fiat", "step": step }),
            };
            body["gist"] = json!(gist);
            body["re"] = json!(re);
            let v = ok(c.post("/surgery", body)?)?;
            let name = v["branch"].as_str().unwrap_or("?");
            println!("{}", v["summary"].as_str().unwrap_or(""));
            lines(&v["lines"]).iter().for_each(|l| println!("{l}"));
            println!("draft {name}: dm commit {name} · dm discard {name}");
        }
        "commit" => {
            let name = rest.first().ok_or("commit which branch?")?;
            let v = ok(c.post(&format!("/branches/{name}/commit"), json!({}))?)?;
            println!("main is now at #{} (the old main is kept as {})", v["head"], v["kept_as"].as_str().unwrap_or("?"));
            let replayed = lines(&v["replayed"]);
            if replayed.first().is_some_and(|s| *s != "no changes") {
                println!("steps added meanwhile, replayed onto it:");
                replayed.iter().for_each(|l| println!("{l}"));
            }
        }
        "discard" => {
            let name = rest.first().ok_or("discard which branch?")?;
            ok(c.post(&format!("/branches/{name}/discard"), json!({}))?)?;
            println!("discarded {name}");
        }
        "branches" => {
            let v = ok(c.get("/branches")?)?;
            for b in v.as_array().into_iter().flatten() {
                let gist = b["gist"].as_str().map(|g| format!(" ({g})")).unwrap_or_default();
                println!("{} → #{}{gist}", b["name"].as_str().unwrap_or("?"), b["head"]);
            }
        }
        "rewind" => {
            let step = step_arg(rest, "step")?;
            let v = ok(c.post("/rewind", json!({ "step": step }))?)?;
            println!("main is now at #{} (what came after is kept as {})", v["head"], v["kept_as"].as_str().unwrap_or("?"));
        }
        "stats" => println!("{}", ok(c.get("/stats")?)?["text"].as_str().unwrap_or("")),
        "log" => {
            let limit = rest.first().filter(|s| s.parse::<usize>().is_ok()).cloned();
            let q: Vec<(&str, &str)> = [("re", &re), ("kind", &kind), ("who", &who), ("since", &since), ("limit", &limit)]
                .into_iter()
                .filter_map(|(k, v)| Some((k, v.as_deref()?)))
                .collect();
            let v = ok(c.get_with("/journal", &q)?)?;
            let found = lines(&v["lines"]);
            if found.is_empty() {
                println!("(nothing in the journal matches)");
            }
            found.iter().for_each(|l| println!("{l}"));
        }
        "wish" => {
            let text = rest.join(" ");
            let v = ok(c.post("/journal", json!({ "verb": "wish", "text": text, "re": re }))?)?;
            println!("{}", v["line"].as_str().unwrap_or("noted"));
        }
        "review" => println!("{}", ok(c.get("/review")?)?["text"].as_str().unwrap_or("")),
        "help" | "--help" | "-h" => println!("{HELP}"),
        other => {
            // A command the DM reached for and didn't find: worth knowing in the review.
            let tried = std::iter::once(other).chain(rest.iter().map(String::as_str)).collect::<Vec<_>>().join(" ");
            let _ = c.post("/journal", json!({ "verb": "parse", "text": format!("dm {tried}: unknown dm command \"{other}\""), "re": re }));
            return Err(format!("unknown command \"{other}\"\n\n{HELP}"));
        }
    }
    footer(&c);
    Ok(())
}

fn look(c: &Client) -> Result<(), String> {
    let v = ok(c.get("")?)?;
    println!("{} · R{} · main at #{}", v["name"].as_str().unwrap_or("?"), v["clock"].as_u64().unwrap_or(0) / 6 + 1, v["seq"]);
    for cr in v["creatures"].as_array().into_iter().flatten() {
        let hp = match (cr["hp"].as_i64(), cr["max_hp"].as_i64()) {
            (Some(h), Some(m)) => format!("{h}/{m} HP"),
            _ => String::new(),
        };
        let stance = cr["stance"].as_str().map(|s| format!("{s} to the party")).unwrap_or_default();
        println!(
            "{:<10} {:<16} ({}, {})  {:<9} {:>2} ft  {stance}",
            cr["handle"].as_str().unwrap_or("?"),
            cr["label"].as_str().unwrap_or("?"),
            cr["pos"]["x"],
            cr["pos"]["y"],
            hp,
            cr["speed_ft"]
        );
    }
    Ok(())
}

/// After every command: whether players are waiting on the DM.
fn footer(c: &Client) {
    if let Ok(v) = c.get("/pending") {
        let (unseen, open) = (v["unseen"].as_u64().unwrap_or(0), v["open"].as_u64().unwrap_or(0));
        if unseen > 0 {
            println!("📨 {unseen} new message{} waiting: dm wait", if unseen == 1 { "" } else { "s" });
        } else if open > 0 {
            println!("📨 {open} message{} not yet marked done", if open == 1 { "" } else { "s" });
        }
    }
}
