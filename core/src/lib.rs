use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

mod engine;
mod session;
mod diff;
mod ast_diff;
mod dep_graph;

pub use engine::*;
pub use session::*;
pub use diff::*;
pub use ast_diff::*;
pub use dep_graph::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionStatus {
    pub is_active: bool,
    pub session_id: Option<String>,
    pub start_time: Option<String>,
}

#[wasm_bindgen]
pub struct ShadowEngine {
    engine: engine::Engine,
}

#[wasm_bindgen]
impl ShadowEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ShadowEngine {
        ShadowEngine {
            engine: engine::Engine::new(),
        }
    }

    #[wasm_bindgen]
    pub async fn initialize(&mut self, shadow_dir: &str) -> Result<(), JsValue> {
        self.engine.initialize(shadow_dir)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn start_session(&mut self) -> Result<String, JsValue> {
        self.engine.start_session()
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn stop_session(&mut self) -> Result<(), JsValue> {
        self.engine.stop_session()
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn get_status(&self) -> Result<JsValue, JsValue> {
        let status = self.engine.get_status()
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        serde_wasm_bindgen::to_value(&status)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn get_diff_count(&self) -> Result<u32, JsValue> {
        self.engine.get_diff_count()
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn compute_ast_diffs(&self, files: JsValue) -> Result<JsValue, JsValue> {
        let file_changes: Vec<(String, String, String)> = serde_wasm_bindgen::from_value(files)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        let result = self.engine.compute_ast_diffs(&file_changes)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn analyze_impact(&self, changed_files: JsValue) -> Result<JsValue, JsValue> {
        let files: Vec<String> = serde_wasm_bindgen::from_value(changed_files)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        let result = self.engine.analyze_impact(&files)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        
        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub async fn build_dependency_graph(&mut self, workspace_root: &str) -> Result<(), JsValue> {
        self.engine.build_dependency_graph(workspace_root)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}