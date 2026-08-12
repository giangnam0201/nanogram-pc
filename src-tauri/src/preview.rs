//! In-memory host for GameGen build previews.
//!
//! A generated game is returned as a blob of HTML with inline `<script>` tags.
//! Rendering it with `srcdoc` does not work: an srcdoc document inherits the
//! embedder's CSP, and the app's `script-src 'self'` kills every inline script,
//! so the preview comes up blank.
//!
//! Serving the same HTML over its own URI scheme gives it a separate origin
//! with no inherited policy, so the build runs exactly as it will once
//! published — without loosening the CSP of the app itself.

use std::sync::Mutex;

/// Only a couple of builds are ever on screen; keeping more just holds memory.
const MAX_ENTRIES: usize = 4;

#[derive(Default)]
pub struct Previews {
    entries: Mutex<Vec<(String, String)>>,
}

impl Previews {
    pub fn new() -> Self {
        Self::default()
    }

    /// Store HTML and return the id it can be fetched with.
    pub fn insert(&self, html: String) -> String {
        let id = format!("{:016x}", fnv1a(html.as_bytes()));
        let mut entries = self.entries.lock().expect("previews poisoned");

        if let Some(slot) = entries.iter().position(|(key, _)| key == &id) {
            // Same build already staged; move it to the front and reuse the id.
            let existing = entries.remove(slot);
            entries.insert(0, existing);
            return id;
        }

        entries.insert(0, (id.clone(), html));
        entries.truncate(MAX_ENTRIES);
        id
    }

    pub fn get(&self, id: &str) -> Option<String> {
        let entries = self.entries.lock().expect("previews poisoned");
        entries
            .iter()
            .find(|(key, _)| key == id)
            .map(|(_, html)| html.clone())
    }

    pub fn clear(&self) {
        self.entries.lock().expect("previews poisoned").clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.lock().expect("previews poisoned").len()
    }
}

/// Small non-cryptographic hash — this only needs to name a cache slot.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_html() {
        let p = Previews::new();
        let id = p.insert("<h1>hi</h1>".into());
        assert_eq!(p.get(&id).as_deref(), Some("<h1>hi</h1>"));
    }

    #[test]
    fn unknown_id_is_none() {
        assert!(Previews::new().get("nope").is_none());
    }

    #[test]
    fn identical_html_reuses_one_slot() {
        let p = Previews::new();
        let a = p.insert("<p>same</p>".into());
        let b = p.insert("<p>same</p>".into());
        assert_eq!(a, b);
        assert_eq!(p.len(), 1);
    }

    #[test]
    fn evicts_the_oldest_build() {
        let p = Previews::new();
        let first = p.insert("build-0".into());
        for i in 1..=MAX_ENTRIES {
            p.insert(format!("build-{i}"));
        }
        assert_eq!(p.len(), MAX_ENTRIES);
        assert!(p.get(&first).is_none(), "oldest build should be evicted");
    }

    #[test]
    fn clear_drops_everything() {
        let p = Previews::new();
        p.insert("x".into());
        p.clear();
        assert_eq!(p.len(), 0);
    }
}
