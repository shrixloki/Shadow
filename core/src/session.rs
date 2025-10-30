use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub start_time: DateTime<Utc>,
    pub workspace_path: String,
}

impl Session {
    pub fn new() -> Self {
        Session {
            id: Uuid::new_v4().to_string(),
            start_time: Utc::now(),
            workspace_path: std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        }
    }
}