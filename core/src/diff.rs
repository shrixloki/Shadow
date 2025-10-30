use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct FileDiff {
    pub path: String,
    pub original_content: String,
    pub modified_content: String,
    pub timestamp: String,
}

pub struct DiffTracker {
    shadow_dir: String,
    tracked_files: HashMap<String, String>,
    diffs: Vec<FileDiff>,
}

impl DiffTracker {
    pub fn new(shadow_dir: &str) -> Self {
        DiffTracker {
            shadow_dir: shadow_dir.to_string(),
            tracked_files: HashMap::new(),
            diffs: Vec::new(),
        }
    }

    pub fn start_tracking(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        // Initialize tracking by scanning current workspace
        self.scan_workspace()?;
        Ok(())
    }

    pub fn stop_tracking(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.tracked_files.clear();
        Ok(())
    }

    pub fn clear_diffs(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.diffs.clear();
        
        // Clear diffs directory
        let diffs_dir = Path::new(&self.shadow_dir).join("diffs");
        if diffs_dir.exists() {
            fs::remove_dir_all(&diffs_dir)?;
            fs::create_dir_all(&diffs_dir)?;
        }
        
        Ok(())
    }

    pub fn get_diff_count(&self) -> Result<u32, Box<dyn std::error::Error>> {
        Ok(self.diffs.len() as u32)
    }

    fn scan_workspace(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let current_dir = std::env::current_dir()?;
        self.scan_directory(&current_dir)?;
        Ok(())
    }

    fn scan_directory(&mut self, dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
        if dir.file_name().map_or(false, |name| name == ".shadow") {
            return Ok(());
        }

        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                self.scan_directory(&path)?;
            } else if self.should_track_file(&path) {
                let content = fs::read_to_string(&path).unwrap_or_default();
                self.tracked_files.insert(
                    path.to_string_lossy().to_string(),
                    content
                );
            }
        }
        
        Ok(())
    }

    fn should_track_file(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension() {
            matches!(ext.to_str(), Some("rs") | Some("ts") | Some("js") | Some("json") | Some("toml"))
        } else {
            false
        }
    }
}