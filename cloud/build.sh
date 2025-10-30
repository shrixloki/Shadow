#!/bin/bash

# Build script for Shadow Cloud services

echo "Building Shadow Cloud - Block III"
echo "================================="

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "Error: Go is not installed. Please install Go 1.21 or later."
    exit 1
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Warning: Docker is not installed. Docker runner will not work."
fi

# Build API Gateway
echo "Building API Gateway..."
cd api_gateway
go mod tidy
go build -o ../bin/api_gateway main.go session_store.go sync_worker.go docker_runner.go
if [ $? -eq 0 ]; then
    echo "✓ API Gateway built successfully"
else
    echo "✗ API Gateway build failed"
    exit 1
fi

cd ..

# Make binary executable
chmod +x bin/api_gateway

echo ""
echo "Build complete!"
echo ""
echo "To run the cloud services:"
echo "  ./bin/api_gateway"
echo ""
echo "To serve the dashboard:"
echo "  cd dashboard/minimal && python3 -m http.server 3000"
echo ""
echo "Dashboard will be available at: http://localhost:3000"
echo "API Gateway will be available at: http://localhost:8080"