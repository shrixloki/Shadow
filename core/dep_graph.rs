use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DependencyGraph {
    pub nodes: HashMap<String, GraphNode>,
    pub edges: HashMap<String, Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphNode {
    pub file_path: String,
    pub imports: Vec<String>,
    pub exports: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImpactAnalysis {
    pub changed_files: Vec<String>,
    pub impacted_files: Vec<String>,
    pub risk_level: RiskLevel,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

pub struct DependencyGraphBuilder {
    graph: DependencyGraph,
    workspace_root: String,
}

impl DependencyGraphBuilder {
    pub fn new(workspace_root: &str) -> Self {
        DependencyGraphBuilder {
            graph: DependencyGraph {
                nodes: HashMap::new(),
                edges: HashMap::new(),
            },
            workspace_root: workspace_root.to_string(),
        }
    }

    pub fn build_graph(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.scan_workspace(&self.workspace_root.clone())?;
        self.build_edges()?;
        Ok(())
    }

    pub fn analyze_impact(&self, changed_files: &[String]) -> ImpactAnalysis {
        let mut impacted = HashSet::new();
        let mut queue = VecDeque::new();

        // Start with directly changed files
        for file in changed_files {
            queue.push_back(file.clone());
            impacted.insert(file.clone());
        }

        // BFS to find all impacted files
        while let Some(current_file) = queue.pop_front() {
            if let Some(dependents) = self.find_dependents(&current_file) {
                for dependent in dependents {
                    if !impacted.contains(&dependent) {
                        impacted.insert(dependent.clone());
                        queue.push_back(dependent);
                    }
                }
            }
        }

        // Remove the originally changed files from impacted list
        let impacted_files: Vec<String> = impacted.iter()
            .filter(|file| !changed_files.contains(file))
            .cloned()
            .collect();

        let risk_level = self.calculate_risk_level(changed_files.len(), impacted_files.len());

        ImpactAnalysis {
            changed_files: changed_files.to_vec(),
            impacted_files,
            risk_level,
        }
    }

    pub fn get_graph(&self) -> &DependencyGraph {
        &self.graph
    }

    fn scan_workspace(&mut self, dir: &str) -> Result<(), Box<dyn std::error::Error>> {
        let path = Path::new(dir);
        
        if !path.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let file_path = entry.path();
            
            if file_path.is_dir() {
                let dir_name = file_path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("");
                
                // Skip shadow directory and node_modules
                if dir_name != ".shadow" && dir_name != "node_modules" && dir_name != ".git" {
                    self.scan_workspace(&file_path.to_string_lossy())?;
                }
            } else if self.is_supported_file(&file_path) {
                self.analyze_file(&file_path)?;
            }
        }

        Ok(())
    }

    fn is_supported_file(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|ext| ext.to_str()) {
            matches!(ext, "ts" | "js" | "tsx" | "jsx")
        } else {
            false
        }
    }

    fn analyze_file(&mut self, file_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(file_path)?;
        let relative_path = self.get_relative_path(file_path);
        
        let imports = self.extract_imports(&content);
        let exports = self.extract_exports(&content);

        let node = GraphNode {
            file_path: relative_path.clone(),
            imports,
            exports,
        };

        self.graph.nodes.insert(relative_path, node);
        Ok(())
    }

    fn get_relative_path(&self, file_path: &Path) -> String {
        file_path.strip_prefix(&self.workspace_root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .replace('\\', "/")
    }

    fn extract_imports(&self, content: &str) -> Vec<String> {
        let mut imports = Vec::new();
        
        for line in content.lines() {
            let trimmed = line.trim();
            
            // Match import statements
            if trimmed.starts_with("import ") {
                if let Some(from_pos) = trimmed.find(" from ") {
                    let module_part = &trimmed[from_pos + 6..];
                    let module_name = module_part.trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .trim_matches(';');
                    
                    // Only track relative imports
                    if module_name.starts_with('.') {
                        imports.push(self.resolve_import_path(module_name));
                    }
                }
            }
            
            // Match require statements
            if let Some(require_start) = trimmed.find("require(") {
                let after_require = &trimmed[require_start + 8..];
                if let Some(quote_end) = after_require.find(')') {
                    let module_name = &after_require[..quote_end]
                        .trim_matches('\'')
                        .trim_matches('"');
                    
                    if module_name.starts_with('.') {
                        imports.push(self.resolve_import_path(module_name));
                    }
                }
            }
        }
        
        imports
    }

    fn extract_exports(&self, content: &str) -> Vec<String> {
        let mut exports = Vec::new();
        
        for line in content.lines() {
            let trimmed = line.trim();
            
            if trimmed.starts_with("export ") {
                // Extract export names (simplified)
                if trimmed.contains("function ") {
                    if let Some(func_name) = self.extract_function_name_from_export(trimmed) {
                        exports.push(func_name);
                    }
                } else if trimmed.contains("class ") {
                    if let Some(class_name) = self.extract_class_name_from_export(trimmed) {
                        exports.push(class_name);
                    }
                } else if trimmed.contains("const ") || trimmed.contains("let ") || trimmed.contains("var ") {
                    if let Some(var_name) = self.extract_var_name_from_export(trimmed) {
                        exports.push(var_name);
                    }
                }
            }
        }
        
        exports
    }

    fn resolve_import_path(&self, import_path: &str) -> String {
        // Simple path resolution - normalize relative paths
        let mut resolved = import_path.to_string();
        
        // Add .ts extension if missing
        if !resolved.ends_with(".ts") && !resolved.ends_with(".js") && 
           !resolved.ends_with(".tsx") && !resolved.ends_with(".jsx") {
            resolved.push_str(".ts");
        }
        
        resolved
    }

    fn extract_function_name_from_export(&self, line: &str) -> Option<String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, part) in parts.iter().enumerate() {
            if *part == "function" && i + 1 < parts.len() {
                let name = parts[i + 1].split('(').next()?;
                return Some(name.to_string());
            }
        }
        None
    }

    fn extract_class_name_from_export(&self, line: &str) -> Option<String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, part) in parts.iter().enumerate() {
            if *part == "class" && i + 1 < parts.len() {
                let name = parts[i + 1].split('{').next()?.split(' ').next()?;
                return Some(name.to_string());
            }
        }
        None
    }

    fn extract_var_name_from_export(&self, line: &str) -> Option<String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, part) in parts.iter().enumerate() {
            if matches!(*part, "const" | "let" | "var") && i + 1 < parts.len() {
                let name = parts[i + 1].split('=').next()?.trim();
                return Some(name.to_string());
            }
        }
        None
    }

    fn build_edges(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        for (file_path, node) in &self.graph.nodes.clone() {
            let mut dependencies = Vec::new();
            
            for import in &node.imports {
                // Find the actual file that matches this import
                if let Some(target_file) = self.resolve_import_to_file(import) {
                    dependencies.push(target_file);
                }
            }
            
            self.graph.edges.insert(file_path.clone(), dependencies);
        }
        
        Ok(())
    }

    fn resolve_import_to_file(&self, import_path: &str) -> Option<String> {
        // Try to find matching file in nodes
        for file_path in self.graph.nodes.keys() {
            if file_path.ends_with(import_path) || 
               file_path == import_path ||
               file_path.replace(".ts", "") == import_path.replace(".ts", "") {
                return Some(file_path.clone());
            }
        }
        None
    }

    fn find_dependents(&self, file: &str) -> Option<Vec<String>> {
        let mut dependents = Vec::new();
        
        for (dependent_file, dependencies) in &self.graph.edges {
            if dependencies.contains(file) {
                dependents.push(dependent_file.clone());
            }
        }
        
        if dependents.is_empty() {
            None
        } else {
            Some(dependents)
        }
    }

    fn calculate_risk_level(&self, changed_count: usize, impacted_count: usize) -> RiskLevel {
        let total_impact = changed_count + impacted_count;
        
        match total_impact {
            0..=2 => RiskLevel::Low,
            3..=7 => RiskLevel::Medium,
            _ => RiskLevel::High,
        }
    }
}