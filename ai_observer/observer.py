#!/usr/bin/env python3

import json
import time
import sys
import os
from pathlib import Path
from typing import Dict, List, Any, Optional
import threading
import queue

class ShadowObserver:
    def __init__(self, config_path: str = "ai_observer/models/heuristics.json"):
        self.config_path = config_path
        self.heuristics = self.load_heuristics()
        self.last_activity = time.time()
        self.pause_threshold = 3.0  # seconds
        self.is_monitoring = False
        self.activity_queue = queue.Queue()
        
    def load_heuristics(self) -> Dict[str, Any]:
        """Load heuristic rules for impact analysis"""
        try:
            with open(self.config_path, 'r') as f:
                return json.load(f)
        except FileNotFoundError:
            return self.get_default_heuristics()
    
    def get_default_heuristics(self) -> Dict[str, Any]:
        """Default heuristic rules"""
        return {
            "risk_weights": {
                "function_changes": 1.0,
                "class_changes": 1.5,
                "import_changes": 2.0,
                "export_changes": 2.5
            },
            "impact_multipliers": {
                "core_modules": 2.0,
                "utility_modules": 1.2,
                "test_modules": 0.5
            },
            "risk_thresholds": {
                "low": 2.0,
                "medium": 5.0,
                "high": 10.0
            }
        }
    
    def start_monitoring(self):
        """Start passive monitoring"""
        self.is_monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
    
    def stop_monitoring(self):
        """Stop monitoring"""
        self.is_monitoring = False
    
    def record_activity(self):
        """Record developer activity"""
        self.last_activity = time.time()
        if not self.activity_queue.empty():
            try:
                self.activity_queue.get_nowait()
            except queue.Empty:
                pass
        self.activity_queue.put(time.time())
    
    def _monitor_loop(self):
        """Main monitoring loop"""
        while self.is_monitoring:
            time.sleep(0.5)
            
            # Check for pause
            if time.time() - self.last_activity > self.pause_threshold:
                self._on_pause_detected()
                time.sleep(self.pause_threshold)  # Avoid rapid triggers
    
    def _on_pause_detected(self):
        """Handle pause detection - could trigger analysis"""
        # For now, just log the pause
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        self._log_event(f"{timestamp} - Pause detected")
    
    def analyze_impact(self, ast_diffs: List[Dict], dependency_graph: Dict, changed_files: List[str]) -> Dict[str, Any]:
        """Analyze impact using heuristics"""
        
        # Calculate risk score
        risk_score = self._calculate_risk_score(ast_diffs)
        
        # Determine impacted modules
        impacted_modules = self._find_impacted_modules(changed_files, dependency_graph)
        
        # Apply impact multipliers
        adjusted_risk = self._apply_impact_multipliers(risk_score, changed_files, impacted_modules)
        
        # Determine risk level
        risk_level = self._determine_risk_level(adjusted_risk)
        
        # Generate summary
        summary = self._generate_summary(ast_diffs, impacted_modules, risk_level)
        
        return {
            "changed": self._extract_changed_entities(ast_diffs),
            "impacted": impacted_modules,
            "risk": risk_level,
            "summary": summary,
            "timestamp": time.time()
        }
    
    def _calculate_risk_score(self, ast_diffs: List[Dict]) -> float:
        """Calculate base risk score from AST diffs"""
        score = 0.0
        weights = self.heuristics["risk_weights"]
        
        for diff in ast_diffs:
            for change in diff.get("changes", []):
                node_type = change.get("node_type", "").lower()
                
                if "function" in node_type:
                    score += weights["function_changes"]
                elif "class" in node_type:
                    score += weights["class_changes"]
                elif "import" in node_type:
                    score += weights["import_changes"]
                elif "export" in node_type:
                    score += weights["export_changes"]
                else:
                    score += 0.5  # Default weight for other changes
        
        return score
    
    def _find_impacted_modules(self, changed_files: List[str], dependency_graph: Dict) -> List[str]:
        """Find modules impacted by changes"""
        impacted = set()
        edges = dependency_graph.get("edges", {})
        
        # Find direct dependents
        for file_path, dependencies in edges.items():
            for changed_file in changed_files:
                if changed_file in dependencies:
                    impacted.add(file_path)
        
        return list(impacted)
    
    def _apply_impact_multipliers(self, base_score: float, changed_files: List[str], impacted_modules: List[str]) -> float:
        """Apply multipliers based on module types"""
        multipliers = self.heuristics["impact_multipliers"]
        adjusted_score = base_score
        
        all_files = changed_files + impacted_modules
        
        for file_path in all_files:
            if self._is_core_module(file_path):
                adjusted_score *= multipliers["core_modules"]
            elif self._is_utility_module(file_path):
                adjusted_score *= multipliers["utility_modules"]
            elif self._is_test_module(file_path):
                adjusted_score *= multipliers["test_modules"]
        
        return adjusted_score
    
    def _is_core_module(self, file_path: str) -> bool:
        """Check if module is core/critical"""
        core_indicators = ["engine", "core", "main", "index", "app"]
        return any(indicator in file_path.lower() for indicator in core_indicators)
    
    def _is_utility_module(self, file_path: str) -> bool:
        """Check if module is utility"""
        utility_indicators = ["util", "helper", "common", "shared"]
        return any(indicator in file_path.lower() for indicator in utility_indicators)
    
    def _is_test_module(self, file_path: str) -> bool:
        """Check if module is test"""
        test_indicators = ["test", "spec", "__tests__"]
        return any(indicator in file_path.lower() for indicator in test_indicators)
    
    def _determine_risk_level(self, risk_score: float) -> str:
        """Determine risk level from score"""
        thresholds = self.heuristics["risk_thresholds"]
        
        if risk_score < thresholds["low"]:
            return "low"
        elif risk_score < thresholds["medium"]:
            return "medium"
        else:
            return "high"
    
    def _extract_changed_entities(self, ast_diffs: List[Dict]) -> List[str]:
        """Extract names of changed entities"""
        entities = []
        
        for diff in ast_diffs:
            for change in diff.get("changes", []):
                if change.get("name"):
                    entity_name = change["name"]
                    node_type = change.get("node_type", "")
                    entities.append(f"{node_type}.{entity_name}")
        
        return entities
    
    def _generate_summary(self, ast_diffs: List[Dict], impacted_modules: List[str], risk_level: str) -> str:
        """Generate human-readable summary"""
        change_count = sum(len(diff.get("changes", [])) for diff in ast_diffs)
        impact_count = len(impacted_modules)
        
        return f"{change_count} changes detected, {impact_count} modules impacted, risk: {risk_level}"
    
    def _log_event(self, message: str):
        """Log event to session log"""
        log_path = ".shadow/session.log"
        try:
            with open(log_path, 'a') as f:
                f.write(f"{message}\n")
        except Exception:
            pass  # Fail silently

def main():
    """CLI interface for observer"""
    if len(sys.argv) < 2:
        print("Usage: python observer.py <command> [args...]")
        sys.exit(1)
    
    command = sys.argv[1]
    observer = ShadowObserver()
    
    if command == "analyze":
        # Expect JSON input for analysis
        if len(sys.argv) < 5:
            print("Usage: python observer.py analyze <ast_diffs_json> <dep_graph_json> <changed_files_json>")
            sys.exit(1)
        
        try:
            ast_diffs = json.loads(sys.argv[2])
            dep_graph = json.loads(sys.argv[3])
            changed_files = json.loads(sys.argv[4])
            
            result = observer.analyze_impact(ast_diffs, dep_graph, changed_files)
            print(json.dumps(result, indent=2))
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON: {e}")
            sys.exit(1)
    
    elif command == "start":
        observer.start_monitoring()
        print("Observer started")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            observer.stop_monitoring()
            print("Observer stopped")
    
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()