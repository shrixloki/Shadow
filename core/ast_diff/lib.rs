use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod languages;

#[cfg(test)]
mod tests;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AstNode {
    pub node_type: String,
    pub name: Option<String>,
    pub start_line: u32,
    pub end_line: u32,
    pub children: Vec<AstNode>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AstDiff {
    pub file_path: String,
    pub changes: Vec<AstChange>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AstChange {
    pub change_type: ChangeType,
    pub node_type: String,
    pub name: Option<String>,
    pub line_range: (u32, u32),
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum ChangeType {
    Added,
    Modified,
    Removed,
}

pub struct AstDiffEngine {
    parsers: HashMap<String, Box<dyn AstParser>>,
}

pub trait AstParser: Send + Sync {
    fn parse(&self, content: &str) -> Result<AstNode, Box<dyn std::error::Error>>;
    fn supported_extensions(&self) -> Vec<&'static str>;
}

impl AstDiffEngine {
    pub fn new() -> Self {
        let mut engine = AstDiffEngine {
            parsers: HashMap::new(),
        };
        
        // Register TypeScript/JavaScript parser
        let ts_parser = languages::ts::TypeScriptParser::new();
        for ext in ts_parser.supported_extensions() {
            engine.parsers.insert(ext.to_string(), Box::new(ts_parser.clone()));
        }
        
        engine
    }

    pub fn compute_diff(&self, file_path: &str, old_content: &str, new_content: &str) -> Result<AstDiff, Box<dyn std::error::Error>> {
        let extension = std::path::Path::new(file_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("");

        let parser = self.parsers.get(extension)
            .ok_or_else(|| format!("No parser available for extension: {}", extension))?;

        let old_ast = parser.parse(old_content)?;
        let new_ast = parser.parse(new_content)?;

        let changes = self.diff_nodes(&old_ast, &new_ast);

        Ok(AstDiff {
            file_path: file_path.to_string(),
            changes,
        })
    }

    fn diff_nodes(&self, old_node: &AstNode, new_node: &AstNode) -> Vec<AstChange> {
        let mut changes = Vec::new();

        // Simple diff algorithm - compare by name and type
        let old_children: HashMap<String, &AstNode> = old_node.children.iter()
            .filter_map(|child| child.name.as_ref().map(|name| (name.clone(), child)))
            .collect();

        let new_children: HashMap<String, &AstNode> = new_node.children.iter()
            .filter_map(|child| child.name.as_ref().map(|name| (name.clone(), child)))
            .collect();

        // Find removed nodes
        for (name, old_child) in &old_children {
            if !new_children.contains_key(name) {
                changes.push(AstChange {
                    change_type: ChangeType::Removed,
                    node_type: old_child.node_type.clone(),
                    name: Some(name.clone()),
                    line_range: (old_child.start_line, old_child.end_line),
                    old_content: Some(format!("{} {}", old_child.node_type, name)),
                    new_content: None,
                });
            }
        }

        // Find added and modified nodes
        for (name, new_child) in &new_children {
            match old_children.get(name) {
                None => {
                    changes.push(AstChange {
                        change_type: ChangeType::Added,
                        node_type: new_child.node_type.clone(),
                        name: Some(name.clone()),
                        line_range: (new_child.start_line, new_child.end_line),
                        old_content: None,
                        new_content: Some(format!("{} {}", new_child.node_type, name)),
                    });
                }
                Some(old_child) => {
                    if self.nodes_differ(old_child, new_child) {
                        changes.push(AstChange {
                            change_type: ChangeType::Modified,
                            node_type: new_child.node_type.clone(),
                            name: Some(name.clone()),
                            line_range: (new_child.start_line, new_child.end_line),
                            old_content: Some(format!("{} {}", old_child.node_type, name)),
                            new_content: Some(format!("{} {}", new_child.node_type, name)),
                        });
                    }
                    
                    // Recursively diff children
                    changes.extend(self.diff_nodes(old_child, new_child));
                }
            }
        }

        changes
    }

    fn nodes_differ(&self, old_node: &AstNode, new_node: &AstNode) -> bool {
        old_node.node_type != new_node.node_type ||
        old_node.children.len() != new_node.children.len()
    }
}