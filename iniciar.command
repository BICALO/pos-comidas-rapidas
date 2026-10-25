#!/bin/bash
cd "$(dirname "$0")"
osascript -e 'tell application "Terminal" to do script "cd \"'"$(pwd)"'\" && npm start"' 2>/dev/null || (npm start &)
sleep 3
open http://localhost:3000
