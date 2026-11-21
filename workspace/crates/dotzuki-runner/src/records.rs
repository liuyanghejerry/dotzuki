//! Parsed data-table definitions shared by battles, menus and shops.
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::vfs::{FileRevision, ProjectFiles};

pub(crate) struct Records {
    files: Arc<dyn ProjectFiles>,
    entries: RefCell<HashMap<String, Record>>,
    directories: RefCell<HashMap<String, Directory>>,
}

struct Record {
    value: Rc<Value>,
    revision: Option<FileRevision>,
    // Mutable third-party VFSes without revision tokens still see exact edits.
    bytes: Option<Vec<u8>>,
}

struct Directory {
    ids: Rc<[String]>,
    revision: Option<FileRevision>,
}

impl Records {
    pub(crate) fn new(files: Arc<dyn ProjectFiles>) -> Self {
        Self {
            files,
            entries: RefCell::default(),
            directories: RefCell::default(),
        }
    }

    pub(crate) fn invalidate(&self, dir: &str, path: &str) {
        self.directories.borrow_mut().remove(dir);
        self.entries.borrow_mut().remove(path);
    }

    pub(crate) fn ids(&self, dir: &str) -> Rc<[String]> {
        let revision = self.files.revision(dir);
        let cacheable = self.files.is_immutable() || revision.is_some();
        let mut directories = self.directories.borrow_mut();
        if let Some(entry) = directories.get(dir) {
            if cacheable && entry.revision == revision {
                return Rc::clone(&entry.ids);
            }
        }
        let prefix = format!("{dir}/");
        let mut ids: Vec<_> = self
            .files
            .list(dir)
            .into_iter()
            .filter_map(|path| {
                let name = path.strip_prefix(&prefix)?.strip_suffix(".json")?;
                (!name.contains('/')).then(|| name.to_owned())
            })
            .collect();
        ids.sort();
        ids.dedup();
        let ids: Rc<[String]> = ids.into();
        if cacheable {
            directories.insert(
                dir.to_owned(),
                Directory {
                    ids: Rc::clone(&ids),
                    revision,
                },
            );
        }
        ids
    }

    pub(crate) fn contains(&self, dir: &str, id: &str) -> bool {
        if self.files.is_immutable() && !id.contains('/') {
            return self
                .ids(dir)
                .binary_search_by(|key| key.as_str().cmp(id))
                .is_ok();
        }
        self.files.exists(&format!("{dir}/{id}.json"))
    }

    pub(crate) fn read(&self, dir: &str, id: &str) -> Result<Rc<Value>> {
        let path = format!("{dir}/{id}.json");
        let revision = self.files.revision(&path);
        let check_bytes = !self.files.is_immutable() && revision.is_none();
        let mut entries = self.entries.borrow_mut();
        let cached = entries.get(&path);
        if let Some(entry) = cached {
            if !check_bytes && entry.revision == revision {
                return Ok(Rc::clone(&entry.value));
            }
        }
        let bytes = self
            .files
            .read_bytes(&path)
            .with_context(|| format!("failed to read {path}"))?;
        if let Some(entry) = cached {
            if check_bytes && entry.bytes.as_deref() == Some(bytes.as_ref()) {
                return Ok(Rc::clone(&entry.value));
            }
        }
        let value = Rc::new(
            serde_json::from_slice(&bytes).with_context(|| format!("failed to parse {path}"))?,
        );
        entries.insert(
            path,
            Record {
                value: Rc::clone(&value),
                revision,
                bytes: check_bytes.then(|| bytes.into_owned()),
            },
        );
        Ok(value)
    }
}
