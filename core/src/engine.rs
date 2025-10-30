use crate::{Session, SessionStatus, DiffTracker, AstDiffEngine, AstDiff, DependencyGraphBuilder, ImpactAnalysis};
use rocksdb::{DB, Options};
use std::path::Path;
use std::sync::Arc;

pub struct Engine {
    db: Option<Arc<DB>>,
    session: Option<Session>,
    diff_tracker: Option<DiffTracker>,
    shadow_dir: Option<String>,
    ast_engine: AstDiffEngine,
    dep_graph: Option<DependencyGraphBuilder>,
}

impl Engine {
    pub fn new() -> Self {
        Engine {
            db: None,
            session: None,
            diff_tracker: None,
            shadow_dir: None,
            ast_engine: AstDiffEngine::new(),
            dep_graph: None,
        }
    }

    pub fn initialize(&mut self, shadow_dir: &str) -> Result<(), Box<dyn std::error::Error>> {
        let db_path = Path::new(shadow_dir).join("session.db");
        
        let mut opts = Options::default();
        opts.create_if_missing(true);
        
        let db = DB::open(&opts, db_path)?;
        self.db = Some(Arc::new(db));
        self.shadow_dir = Some(shadow_dir.to_string());
        self.diff_tracker = Some(DiffTracker::new(shadow_dir));
        
        Ok(())
    }

    pub fn start_session(&mut self) -> Result<String, Box<dyn std::error::Error>> {
        if self.session.is_some() {
            return Err("Session already active".into());
        }

        let session = Session::new();
        let session_id = session.id.clone();
        
        // Store session in database
        if let Some(db) = &self.db {
            let session_data = serde_json::to_string(&session)?;
            db.put("current_session", session_data.as_bytes())?;
        }

        self.session = Some(session);
        
        // Initialize diff tracking
        if let Some(diff_tracker) = &mut self.diff_tracker {
            diff_tracker.start_tracking()?;
        }

        Ok(session_id)
    }

    pub fn stop_session(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.session.is_none() {
            return Err("No active session".into());
        }

        // Clear session from database
        if let Some(db) = &self.db {
            db.delete("current_session")?;
        }

        // Stop diff tracking and clear diffs
        if let Some(diff_tracker) = &mut self.diff_tracker {
            diff_tracker.stop_tracking()?;
            diff_tracker.clear_diffs()?;
        }

        self.session = None;
        Ok(())
    }

    pub fn get_status(&self) -> Result<SessionStatus, Box<dyn std::error::Error>> {
        if let Some(session) = &self.session {
            Ok(SessionStatus {
                is_active: true,
                session_id: Some(session.id.clone()),
                start_time: Some(session.start_time.to_rfc3339()),
            })
        } else {
            // Check database for persisted session
            if let Some(db) = &self.db {
                match db.get("current_session")? {
                    Some(data) => {
                        let session: Session = serde_json::from_slice(&data)?;
                        Ok(SessionStatus {
                            is_active: true,
                            session_id: Some(session.id),
                            start_time: Some(session.start_time.to_rfc3339()),
                        })
                    }
                    None => Ok(SessionStatus {
                        is_active: false,
                        session_id: None,
                        start_time: None,
                    })
                }
            } else {
                Ok(SessionStatus {
                    is_active: false,
                    session_id: None,
                    start_time: None,
                })
            }
        }
    }

    pub fn get_diff_count(&self) -> Result<u32, Box<dyn std::error::Error>> {
        if let Some(diff_tracker) = &self.diff_tracker {
            diff_tracker.get_diff_count()
        } else {
            Ok(0)
        }
    }

    pub fn compute_ast_diffs(&self, file_changes: &[(String, String, String)]) -> Result<Vec<AstDiff>, Box<dyn std::error::Error>> {
        let mut diffs = Vec::new();
        
        for (file_path, old_content, new_content) in file_changes {
            let diff = self.ast_engine.compute_diff(file_path, old_content, new_content)?;
            diffs.push(diff);
        }
        
        Ok(diffs)
    }

    pub fn build_dependency_graph(&mut self, workspace_root: &str) -> Result<(), Box<dyn std::error::Error>> {
        let mut builder = DependencyGraphBuilder::new(workspace_root);
        builder.build_graph()?;
        self.dep_graph = Some(builder);
        Ok(())
    }

    pub fn analyze_impact(&self, changed_files: &[String]) -> Result<ImpactAnalysis, Box<dyn std::error::Error>> {
        if let Some(dep_graph) = &self.dep_graph {
            Ok(dep_graph.analyze_impact(changed_files))
        } else {
            Err("Dependency graph not built. Call build_dependency_graph first.".into())
        }
    }
}