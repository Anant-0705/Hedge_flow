#!/usr/bin/env bash
set -e

echo "Setting up HedgeFlow Multi-Process Environment..."

# Ensure Node dependencies are installed
echo "Installing Node.js dependencies..."
(cd executor && npm install)

# Create necessary directories
mkdir -p logs data

# Start the Python signal monitor in the background
echo "Starting Signal Monitor..."
python -u -m agent.signal_monitor 2>&1 | sed -u 's/^/[MONITOR] /' &

# Start the Node.js trade watcher in the background
echo "Starting Trade Watcher..."
(cd executor && node trade_watcher.js 2>&1 | sed -u 's/^/[WATCHER] /') &

# Start the Node.js trade settler in the background
echo "Starting Trade Settler..."
(cd executor && node trade_settler.js 2>&1 | sed -u 's/^/[SETTLER] /') &

# Start the FastAPI Dashboard in the foreground
echo "Starting FastAPI Dashboard on port ${PORT:-8000}..."
python -m uvicorn dashboard.backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
