#!/bin/bash
echo "Starting Dashboard Update..."

echo "1. Extracting data from HTML bills..."
node extract_bills.js

echo "2. Fetching weather data and enriching..."
node enrich_with_weather.js

echo "3. Building HTML dashboard..."
node build_dashboard.js

echo "Done! Open usage_dashboard.html to view results."
