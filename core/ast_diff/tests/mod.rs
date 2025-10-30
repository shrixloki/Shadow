#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::ast_diff::languages::ts::TypeScriptParser;

    #[test]
    fn test_typescript_parser_functions() {
        let parser = TypeScriptParser::new();
        let content = r#"
function hello() {
    return "world";
}

export function goodbye() {
    return "farewell";
}

const arrow = () => {
    return "arrow";
};
"#;
        
        let ast = parser.parse(content).unwrap();
        assert_eq!(ast.node_type, "Program");
        assert_eq!(ast.children.len(), 3);
        
        // Check function names
        let function_names: Vec<&str> = ast.children.iter()
            .filter_map(|child| child.name.as_deref())
            .collect();
        
        assert!(function_names.contains(&"hello"));
        assert!(function_names.contains(&"goodbye"));
        assert!(function_names.contains(&"arrow"));
    }

    #[test]
    fn test_ast_diff_engine() {
        let engine = AstDiffEngine::new();
        
        let old_content = r#"
function oldFunction() {
    return "old";
}
"#;
        
        let new_content = r#"
function newFunction() {
    return "new";
}

function oldFunction() {
    return "modified";
}
"#;
        
        let diff = engine.compute_diff("test.ts", old_content, new_content).unwrap();
        
        assert_eq!(diff.file_path, "test.ts");
        assert!(!diff.changes.is_empty());
        
        // Should detect added and modified functions
        let change_types: Vec<&ChangeType> = diff.changes.iter()
            .map(|change| &change.change_type)
            .collect();
        
        assert!(change_types.iter().any(|ct| matches!(ct, ChangeType::Added)));
    }

    #[test]
    fn test_dependency_graph_builder() {
        let mut builder = DependencyGraphBuilder::new(".");
        
        // Test with mock data since we can't rely on actual files
        let analysis = builder.analyze_impact(&["file1.ts".to_string()]);
        
        assert_eq!(analysis.changed_files.len(), 1);
        assert_eq!(analysis.changed_files[0], "file1.ts");
    }

    #[test]
    fn test_impact_analysis_risk_levels() {
        let builder = DependencyGraphBuilder::new(".");
        
        // Test low risk
        let low_risk = builder.analyze_impact(&["single.ts".to_string()]);
        assert!(matches!(low_risk.risk_level, RiskLevel::Low));
        
        // Test high risk (many files)
        let many_files: Vec<String> = (0..10).map(|i| format!("file{}.ts", i)).collect();
        let high_risk = builder.analyze_impact(&many_files);
        assert!(matches!(high_risk.risk_level, RiskLevel::High));
    }
}