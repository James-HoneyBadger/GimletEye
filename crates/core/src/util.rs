use std::time::{SystemTime, UNIX_EPOCH};

/// Current time as RFC 3339 UTC, e.g. `2026-10-23T16:28:42Z`.
pub fn now_rfc3339() -> String {
    format_rfc3339(SystemTime::now())
}

/// Format a `SystemTime` as RFC 3339 UTC with second precision.
///
/// Hand-rolled to keep the core crate dependency-free; the algorithm is Howard
/// Hinnant's `civil_from_days`.
pub fn format_rfc3339(time: SystemTime) -> String {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = rest / 3_600;
    let minute = (rest % 3_600) / 60;
    let second = rest % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// Compact human duration for terminal output.
pub fn human_duration(millis: u64) -> String {
    if millis < 1_000 {
        format!("{millis} ms")
    } else if millis < 60_000 {
        format!("{:.2} s", millis as f64 / 1_000.0)
    } else {
        let minutes = millis / 60_000;
        let seconds = (millis % 60_000) / 1_000;
        format!("{minutes}m {seconds}s")
    }
}

/// Truncate on a character boundary, appending an ellipsis when shortened.
pub fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn epoch_formats_as_utc() {
        assert_eq!(format_rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn formats_a_known_timestamp() {
        let time = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        assert_eq!(format_rfc3339(time), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn truncates_on_char_boundary() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("abcdef", 4), "abc…");
    }

    #[test]
    fn humanizes_durations() {
        assert_eq!(human_duration(12), "12 ms");
        assert_eq!(human_duration(1_500), "1.50 s");
        assert_eq!(human_duration(125_000), "2m 5s");
    }
}
