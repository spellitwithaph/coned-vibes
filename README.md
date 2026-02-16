# ConEd Bill Dashboard

An interactive dashboard that visualizes your ConEd electricity and gas usage, costs, and weather data over time.

## Prerequisites

- **Node.js** (v16+)
- **ConEd HTML bills** — Download your bills as HTML from your [ConEd account](https://www.coned.com/)

## Quick Start

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd <repo-folder>
npm install
```

### 2. Add your ConEd bill HTML files

Place your downloaded ConEd bill HTML files in this directory. Name them using this format:

```
ConEd-Bill-YYYY-MM.html
```

For example: `ConEd-Bill-2024-01.html`, `ConEd-Bill-2024-02.html`, etc.

> **Tip:** Download your bills from ConEd's website — go to *My Account → Billing & Payments → Bill History*, and save/download each bill as HTML.

> **Tip:** If you can only download the PDF, install pdftohtml command line tool to convert PDF to HTML

### 3. Run the pipeline

```bash
bash update_dashboard.sh
```

This runs three steps automatically:
1. **Extract** — Parses all `ConEd-Bill-*.html` files and extracts usage/cost data → `bills_data.json`
2. **Enrich** — Fetches historical weather data from [Open-Meteo](https://open-meteo.com/) for the NYC area → `bills_weather_data.json`
3. **Build** — Assembles the final dashboard → `usage_dashboard.html`

### 4. View your dashboard

Open `usage_dashboard.html` in any web browser.

## Customization

### Weather Location

Edit the coordinates in `enrich_with_weather.js` to match your location/zip code:

```javascript
const LAT = 40.7536;  // Your latitude
const LON = -73.9432; // Your longitude
```

### Date Range

The extractor processes bills from **June 2017 onward**. To change this, edit the date filter in `extract_bills.js` (line 123).

## Pipeline Files

| File | Purpose |
|------|---------|
| `extract_bills.js` | Parses HTML bills → JSON + CSV |
| `enrich_with_weather.js` | Adds weather data to bill records |
| `build_dashboard.js` | Combines template + data + charts into final HTML |
| `update_dashboard.sh` | Runs the full pipeline in one command |
| `dashboard_top.html` | Dashboard HTML template |
| `dashboard_charts.js` | Chart.js visualization logic |

## Tech Stack

- [Chart.js](https://www.chartjs.org/) for interactive charts
- [Cheerio](https://cheerio.js.org/) for HTML parsing
- [Open-Meteo API](https://open-meteo.com/) for historical weather data (free, no API key needed)
