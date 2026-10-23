//! A short text form of commands, for the DM and agents to write and for typed player text to be
//! parsed into: one command per line or per `;`.
//!
//! ```text
//! move rook 4,5          move rook to (4, 5)
//! move rook to altar     move rook to osric   (a place or creature, by handle)
//! place snikka 3,1       place snikka at 3 1
//! wait 10m               wait 3 rounds · wait 30s · wait 1 hour
//! ```

use crate::command::Command;
use crate::geom::Cell;
use crate::id::Handle;

pub const SYNTAX: &str = "move <who> <x>,<y> · move <who> to <place or creature> · place <who> <x>,<y> · wait <n> s|rounds|min|hours";

/// Parses a script into commands, in the writer's own names. Errors say which statement and why.
pub fn parse(script: &str) -> Result<Vec<Command<String>>, String> {
    script
        .split(['\n', ';'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.starts_with("//"))
        .map(|s| statement(s).map_err(|e| format!("`{s}`: {e} (commands: {SYNTAX})")))
        .collect()
}

/// Commands back in the short form, `; `-separated: what the journal shows of a step.
pub fn write(cmds: &[Command<String>]) -> String {
    cmds.iter()
        .map(|c| match c {
            Command::Move { who, to } => format!("move {who} {},{}", to.x, to.y),
            Command::MoveToward { who, toward } => format!("move {who} to {toward}"),
            Command::Place { who, to } => format!("place {who} {},{}", to.x, to.y),
            Command::Wait { seconds } => match *seconds {
                s if s >= 3600 && s % 3600 == 0 => format!("wait {} hours", s / 3600),
                s if s >= 60 && s % 60 == 0 => format!("wait {} min", s / 60),
                s if s % 6 == 0 => format!("wait {} rounds", s / 6),
                s => format!("wait {s}s"),
            },
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn statement(s: &str) -> Result<Command<String>, String> {
    let words: Vec<&str> = s.split_whitespace().collect();
    let (verb, rest) = words.split_first().ok_or("empty command")?;
    match verb.to_ascii_lowercase().as_str() {
        "move" | "go" => {
            let (who, rest) = rest.split_first().ok_or("move whom?")?;
            let target = skip(rest, "to");
            // A handle starts with a letter; a square starts with a digit or a bracket.
            match target {
                [name] if name.starts_with(|c: char| c.is_ascii_alphabetic()) => {
                    let toward = Handle::new(&name.to_ascii_lowercase())?.to_string();
                    Ok(Command::MoveToward { who: who.to_string(), toward })
                }
                _ => Ok(Command::Move { who: who.to_string(), to: cell(target)? }),
            }
        }
        "place" | "put" => {
            let (who, rest) = rest.split_first().ok_or("place whom?")?;
            Ok(Command::Place { who: who.to_string(), to: cell(skip(rest, "at"))? })
        }
        "wait" => Ok(Command::Wait { seconds: duration(&rest.join(" "))? }),
        other => Err(format!("unknown command \"{other}\"")),
    }
}

fn skip<'a>(words: &'a [&'a str], word: &str) -> &'a [&'a str] {
    match words.first() {
        Some(w) if w.eq_ignore_ascii_case(word) => &words[1..],
        _ => words,
    }
}

/// `4,5` · `(4, 5)` · `4 5`.
fn cell(words: &[&str]) -> Result<Cell, String> {
    let text = words.join(" ").replace(['(', ')', ','], " ");
    let nums: Vec<i32> = text.split_whitespace().map(|n| n.parse().map_err(|_| format!("\"{n}\" isn't a number"))).collect::<Result<_, _>>()?;
    match nums[..] {
        [x, y] => Ok(Cell::new(x, y)),
        _ => Err("a square is two numbers, x,y".into()),
    }
}

/// `30s` · `3 rounds` · `10m` · `1 hour`.
fn duration(text: &str) -> Result<u64, String> {
    let t = text.trim().to_ascii_lowercase();
    let split = t.find(|c: char| !c.is_ascii_digit()).unwrap_or(t.len());
    let n: u64 = t[..split].parse().map_err(|_| format!("how long? \"{text}\""))?;
    let unit = t[split..].trim();
    let per = match unit {
        "" | "s" | "sec" | "secs" | "second" | "seconds" => 1,
        "r" | "round" | "rounds" => 6,
        "m" | "min" | "mins" | "minute" | "minutes" => 60,
        "h" | "hr" | "hour" | "hours" => 3600,
        _ => return Err(format!("unknown unit \"{unit}\"")),
    };
    Ok(n * per)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_short_forms() {
        let cmds = parse("move rook 4,5; place snikka at (3, 1)\nwait 3 rounds\n// a comment\ngo wren to 2 2").unwrap();
        assert_eq!(
            cmds,
            vec![
                Command::Move { who: "rook".into(), to: Cell::new(4, 5) },
                Command::Place { who: "snikka".into(), to: Cell::new(3, 1) },
                Command::Wait { seconds: 18 },
                Command::Move { who: "wren".into(), to: Cell::new(2, 2) },
            ]
        );
        assert_eq!(
            parse("move rook to altar; go wren osric").unwrap(),
            vec![Command::MoveToward { who: "rook".into(), toward: "altar".into() }, Command::MoveToward { who: "wren".into(), toward: "osric".into() }]
        );
        assert_eq!(parse("wait 10m").unwrap(), vec![Command::Wait { seconds: 600 }]);
    }

    #[test]
    fn writes_what_it_parses() {
        let text = "move rook 4,5; move rook to altar; place snikka 3,1; wait 3 rounds; wait 10 min; wait 7s";
        assert_eq!(write(&parse(text).unwrap()), text);
    }

    #[test]
    fn errors_name_the_statement_and_the_syntax() {
        let e = parse("move rook 4,5; jump rook 3,3").unwrap_err();
        assert!(e.starts_with("`jump rook 3,3`: unknown command \"jump\""), "{e}");
        assert!(e.contains("move <who>"));
        assert!(parse("move rook 4").unwrap_err().contains("two numbers"));
    }
}
