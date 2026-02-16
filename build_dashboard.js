const fs = require('fs');

// Read the JSON data file directly
const data = JSON.parse(fs.readFileSync('bills_weather_data.json', 'utf8'));
const dataStr = JSON.stringify(data);

// Read the HTML template (top part) and the script reference
const top = fs.readFileSync('dashboard_top.html', 'utf8');
const full = top + '\n    <script>const allData = ' + dataStr + ';<\/script>\n    <script src="dashboard_charts.js"><\/script>\n</body>\n</html>';

fs.writeFileSync('usage_dashboard.html', full);
console.log('Done! Size:', full.length);
