use crate::ast_diff::{AstNode, AstParser};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone)]
pub struct TypeScriptParser {
    // Simple regex-based parser for prototype
}

impl TypeScriptParser {
    pub fn new() -> Self {
        TypeScriptParser {}
    }

    fn parse_simple(&self, content: &str) -> AstNode {
        let mut root = AstNode {
            node_type: "Program".to_string(),
            name: None,
            start_line: 1,
            end_line: content.lines().count() as u32,
            children: Vec::new(),
        };

        let mut current_line = 1;
        
        for line in content.lines() {
            let trimmed = line.trim();
            
            // Parse function declarations
            if let Some(func_name) = self.extract_function_name(trimmed) {
                root.children.push(AstNode {
                    node_type: "FunctionDeclaration".to_string(),
                    name: Some(func_name),
                    start_line: current_line,
                    end_line: current_line,
                    children: Vec::new(),
                });
            }
            
            // Parse class declarations
            if let Some(class_name) = self.extract_class_name(trimmed) {
                root.children.push(AstNode {
                    node_type: "ClassDeclaration".to_string(),
                    name: Some(class_name),
                    start_line: current_line,
                    end_line: current_line,
                    children: Vec::new(),
                });
            }
            
            // Parse import statements
            if let Some(import_name) = self.extract_import_name(trimmed) {
                root.children.push(AstNode {
                    node_type: "ImportDeclaration".to_string(),
                    name: Some(import_name),
                    start_line: current_line,
                    end_line: current_line,
                    children: Vec::new(),
                });
            }
            
            current_line += 1;
        }

        root
    }

    fn extract_function_name(&self, line: &str) -> Option<String> {
        // Simple regex patterns for function detection
        if line.starts_with("function ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[1].split('(').next()?;
                return Some(name.to_string());
            }
        }
        
        if line.starts_with("export function ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let name = parts[2].split('(').next()?;
                return Some(name.to_string());
            }
        }
        
        // Arrow functions
        if line.contains(" = ") && line.contains(" => ") {
            let parts: Vec<&str> = line.split(" = ").collect();
            if parts.len() >= 2 {
                let name = parts[0].trim().split_whitespace().last()?;
                return Some(name.to_string());
            }
        }
        
        None
    }

    fn extract_class_name(&self, line: &str) -> Option<String> {
        if line.starts_with("class ") || line.starts_with("export class ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == "class" && i + 1 < parts.len() {
                    let name = parts[i + 1].split('{').next()?.split(' ').next()?;
                    return Some(name.to_string());
                }
            }
        }
        None
    }

    fn extract_import_name(&self, line: &str) -> Option<String> {
        if line.starts_with("import ") {
            // Extract module name from import statement
            if let Some(from_pos) = line.find(" from ") {
                let module_part = &line[from_pos + 6..];
                let module_name = module_part.trim().trim_matches('\'').trim_matches('"');
                return Some(module_name.to_string());
            }
        }
        None
    }
}

impl AstParser for TypeScriptParser {
    fn parse(&self, content: &str) -> Result<AstNode, Box<dyn std::error::Error>> {
        Ok(self.parse_simple(content))
    }

    fn supported_extensions(&self) -> Vec<&'static str> {
        vec!["ts", "js", "tsx", "jsx"]
    }
}