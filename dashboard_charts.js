// dashboard_charts.js — All chart + dashboard logic for ConEd dashboard
// allData is expected to be defined globally before this script runs.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_MAP = { 0: 'Winter', 1: 'Winter', 2: 'Spring', 3: 'Spring', 4: 'Spring', 5: 'Summer', 6: 'Summer', 7: 'Summer', 8: 'Fall', 9: 'Fall', 10: 'Fall', 11: 'Winter' };
function isMobile() { return window.innerWidth < 768; }
function getAspectRatio() { return isMobile() ? 1.2 : 2; }
function getTitleFont() { return { size: isMobile() ? 12 : 15, weight: '600' }; }
function getTickFont() { return { size: isMobile() ? 9 : 12 }; }
function getLegendFont() { return { size: isMobile() ? 10 : 12 }; }
function getPointRadius() { return isMobile() ? 1 : 2; }
function getMaxTicks() { return isMobile() ? 8 : 20; }
function chartOpts() { return { responsive: true, maintainAspectRatio: false }; }
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#2d3348';
Chart.defaults.font.family = "'Inter',system-ui,sans-serif";

// Populate year filter
const years = [...new Set(allData.map(d => new Date(d.date).getFullYear()))].sort();
const yearSelect = document.getElementById('yearFilter');
years.forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y; yearSelect.appendChild(o); });

// Chart instances
let charts = {};

// Sort state
let sortCol = null, sortAsc = true;

// --- UTILITY ---
function fmt$(v) { return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function pct(v) { return (v * 100).toFixed(1) + '%' }
function getSeason(month) { return SEASON_MAP[month] }

function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

function heatClass(val, min, max) {
    if (max === min) return 'heat-mid';
    const ratio = (val - min) / (max - min);
    if (ratio < 0.33) return 'heat-low';
    if (ratio < 0.66) return 'heat-mid';
    return 'heat-high';
}

// --- MAIN UPDATE ---
function updateDashboard() {
    const yearVal = document.getElementById('yearFilter').value;
    const monthVal = document.getElementById('monthFilter').value;
    const filtered = allData.filter(d => {
        const dt = new Date(d.date);
        return (yearVal === 'all' || dt.getFullYear().toString() === yearVal) &&
            (monthVal === 'all' || dt.getMonth().toString() === monthVal);
    });

    updateSummary(filtered, yearVal);
    updateTable(filtered);
    updateMainCharts(filtered);
    updateAnalysisCharts(filtered, yearVal);
}

// --- SUMMARY KPI ---
function updateSummary(data, yearVal) {
    const el = document.getElementById('summary');
    if (!data.length) { el.innerHTML = '<p style="color:#64748b">No data for selected filters.</p>'; return; }

    const totalSpent = data.reduce((a, d) => a + d.electricCost + d.gasCost, 0);
    const avgMonthly = totalSpent / data.length;
    const totalDays = data.reduce((a, d) => a + d.daysCovered, 0);
    const avgPerDay = totalSpent / totalDays;
    const elecTotal = data.reduce((a, d) => a + d.electricCost, 0);
    const gasTotal = data.reduce((a, d) => a + d.gasCost, 0);
    const elecPct = elecTotal / totalSpent;

    // Supply / Delivery totals
    const supplyData = data.filter(d => d.electricSupply != null || d.gasSupply != null);
    const totalSupply = supplyData.reduce((a, d) => a + (d.electricSupply || 0) + (d.gasSupply || 0), 0);
    const totalDelivery = supplyData.reduce((a, d) => a + (d.electricDelivery || 0) + (d.gasDelivery || 0), 0);
    const supplyDeliveryTotal = totalSupply + totalDelivery;

    // Find highest/lowest
    const withTotals = data.map(d => ({ ...d, total: d.electricCost + d.gasCost }));
    const highest = withTotals.reduce((a, b) => a.total > b.total ? a : b);
    const lowest = withTotals.reduce((a, b) => a.total < b.total ? a : b);

    // YoY
    let yoyHtml = '';
    if (yearVal !== 'all') {
        const yr = parseInt(yearVal);
        const prevYrData = allData.filter(d => new Date(d.date).getFullYear() === yr - 1);
        if (prevYrData.length) {
            const prevTotal = prevYrData.reduce((a, d) => a + d.electricCost + d.gasCost, 0);
            const curTotal = data.reduce((a, d) => a + d.electricCost + d.gasCost, 0);
            const change = (curTotal - prevTotal) / prevTotal;
            const cls = change > 0.01 ? 'yoy-up' : change < -0.01 ? 'yoy-down' : 'yoy-flat';
            const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
            yoyHtml = `<div class='summary-item'><div class='summary-value ${cls}'>${arrow} ${pct(Math.abs(change))}</div><div class='summary-label'>vs ${yr - 1}</div></div>`;
        }
    }

    // Supply / Delivery pct card
    let sdHtml = '';
    if (supplyDeliveryTotal > 0) {
        const supPct = totalSupply / supplyDeliveryTotal;
        sdHtml = `<div class='summary-item'><div class='summary-value' style='font-size:18px'>${pct(supPct)} / ${pct(1 - supPct)}</div><div class='summary-label'>Supply / Delivery</div><div class='summary-sub'>${supplyData.length} bills w/ data</div></div>`;
    }

    el.innerHTML = `
        <div class='summary-item'><div class='summary-value'>${fmt$(totalSpent)}</div><div class='summary-label'>Total Spent</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(avgMonthly)}</div><div class='summary-label'>Avg Monthly</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(avgPerDay)}</div><div class='summary-label'>Avg $/Day</div></div>
        <div class='summary-item'><div class='summary-value'>${data.length}</div><div class='summary-label'>Bills</div></div>
        <div class='summary-item'><div class='summary-value'>${pct(elecPct)}</div><div class='summary-label'>Electric Share</div><div class='summary-sub'>${pct(1 - elecPct)} Gas</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(highest.total)}</div><div class='summary-label'>Highest Bill</div><div class='summary-sub'>${highest.date}</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(lowest.total)}</div><div class='summary-label'>Lowest Bill</div><div class='summary-sub'>${lowest.date}</div></div>
        ${sdHtml}
        ${yoyHtml}
    `;
}

// --- TABLE ---
function updateTable(data) {
    const tbody = document.querySelector('#dataTable tbody');
    const costs = data.map(d => d.electricCost + d.gasCost);
    const minC = Math.min(...costs), maxC = Math.max(...costs);

    // Apply sort
    let sorted = [...data];
    if (sortCol) {
        sorted.sort((a, b) => {
            let va, vb;
            if (sortCol === 'totalCost') { va = a.electricCost + a.gasCost; vb = b.electricCost + b.gasCost; }
            else if (sortCol === 'kwhPerDay') { va = a.electricUsage / a.daysCovered; vb = b.electricUsage / b.daysCovered; }
            else if (sortCol === 'costPerDay') { va = (a.electricCost + a.gasCost) / a.daysCovered; vb = (b.electricCost + b.gasCost) / b.daysCovered; }
            else if (sortCol === 'supplyTotal') { va = (a.electricSupply || 0) + (a.gasSupply || 0); vb = (b.electricSupply || 0) + (b.gasSupply || 0); }
            else if (sortCol === 'deliveryTotal') { va = (a.electricDelivery || 0) + (a.gasDelivery || 0); vb = (b.electricDelivery || 0) + (b.gasDelivery || 0); }
            else { va = a[sortCol]; vb = b[sortCol]; }
            if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortAsc ? va - vb : vb - va;
        });
    }

    tbody.innerHTML = sorted.map(d => {
        const total = d.electricCost + d.gasCost;
        const kwhDay = (d.electricUsage / d.daysCovered).toFixed(1);
        const costDay = (total / d.daysCovered).toFixed(2);
        const hc = heatClass(total, minC, maxC);
        const supplyVal = (d.electricSupply != null || d.gasSupply != null) ? fmt$((d.electricSupply || 0) + (d.gasSupply || 0)) : '—';
        const deliveryVal = (d.electricDelivery != null || d.gasDelivery != null) ? fmt$((d.electricDelivery || 0) + (d.gasDelivery || 0)) : '—';
        return `<tr>
            <td>${d.date}</td><td>${d.avgTemp}</td><td>${d.electricUsage}</td><td>${fmt$(d.electricCost)}</td>
            <td>${d.gasUsage}</td><td>${fmt$(d.gasCost)}</td><td class="${hc}">${fmt$(total)}</td>
            <td>${supplyVal}</td><td>${deliveryVal}</td>
            <td>${d.daysCovered}</td><td>${kwhDay}</td><td>${fmt$(parseFloat(costDay))}</td>
        </tr>`;
    }).join('');

    document.getElementById('tableCount').textContent = `${sorted.length} records`;
}

// --- MAIN CHARTS ---
function updateMainCharts(data) {
    const labels = data.map(d => d.date);
    const eUsage = data.map(d => d.electricUsage);
    const gUsage = data.map(d => d.gasUsage);
    const eCost = data.map(d => d.electricCost);
    const gCost = data.map(d => d.gasCost);
    const temps = data.map(d => d.avgTemp);
    const kwhDay = data.map(d => +(d.electricUsage / d.daysCovered).toFixed(1));
    const thermDay = data.map(d => +(d.gasUsage / d.daysCovered).toFixed(2));

    // 1. Electric Usage vs Temp
    destroyChart('electric');
    charts.electric = new Chart(document.getElementById('electricChart'), {
        type: 'line', data: {
            labels, datasets: [
                { label: 'Electric (kWh)', data: eUsage, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius() },
                { label: 'Avg Temp (°F)', data: temps, borderColor: '#f59e0b', yAxisID: 'y1', borderDash: [5, 5], tension: 0.3, pointRadius: 0 }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Electric Usage vs Temperature', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'kWh' }, ticks: { font: getTickFont() } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°F' }, ticks: { font: getTickFont() } } }
        }
    });

    // 2. Gas Usage vs Temp
    destroyChart('gas');
    charts.gas = new Chart(document.getElementById('gasChart'), {
        type: 'line', data: {
            labels, datasets: [
                { label: 'Gas (therms)', data: gUsage, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius() },
                { label: 'Avg Temp (°F)', data: temps, borderColor: '#f59e0b', yAxisID: 'y1', borderDash: [5, 5], tension: 0.3, pointRadius: 0 }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Gas Usage vs Temperature', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'Therms' }, ticks: { font: getTickFont() } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°F' }, ticks: { font: getTickFont() } } }
        }
    });

    // 3. Cost breakdown — 4-segment stacked bar
    destroyChart('cost');
    const hasBreakdown = data.some(d => d.electricSupply != null || d.electricDelivery != null);
    const costDatasets = hasBreakdown ? [
        { label: 'Elec Supply $', data: data.map(d => d.electricSupply || 0), backgroundColor: '#3b82f6' },
        { label: 'Elec Delivery $', data: data.map(d => d.electricDelivery || 0), backgroundColor: '#60a5fa' },
        { label: 'Gas Supply $', data: data.map(d => d.gasSupply || 0), backgroundColor: '#22c55e' },
        { label: 'Gas Delivery $', data: data.map(d => d.gasDelivery || 0), backgroundColor: '#4ade80' }
    ] : [
        { label: 'Electric $', data: eCost, backgroundColor: '#3b82f6' },
        { label: 'Gas $', data: gCost, backgroundColor: '#22c55e' }
    ];
    charts.cost = new Chart(document.getElementById('costBreakdownChart'), {
        type: 'bar', data: { labels, datasets: costDatasets },
        options: {
            ...chartOpts(), aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: hasBreakdown ? 'Cost Breakdown: Supply vs Delivery' : 'Monthly Cost Breakdown', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { stacked: true, ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { stacked: true, title: { display: true, text: 'USD ($)' }, ticks: { font: getTickFont() } } }
        }
    });

    // 4. Daily Normalized
    destroyChart('daily');
    charts.daily = new Chart(document.getElementById('dailyNormChart'), {
        type: 'line', data: {
            labels, datasets: [
                { label: 'kWh / Day', data: kwhDay, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius() },
                { label: 'Therms / Day', data: thermDay, borderColor: '#14b8a6', yAxisID: 'y1', tension: 0.3, pointRadius: getPointRadius() }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Daily Normalized Usage', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'kWh/day' }, ticks: { font: getTickFont() } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Therms/day' }, ticks: { font: getTickFont() } } }
        }
    });
}

// --- ANALYSIS CHARTS ---
function updateAnalysisCharts(data, yearVal) {
    const labels = data.map(d => d.date);

    // 5. Temp vs Usage bar+line combo
    destroyChart('tempUsage');
    charts.tempUsage = new Chart(document.getElementById('tempVsUsageChart'), {
        type: 'bar', data: {
            labels, datasets: [
                { label: 'Electric (kWh)', data: data.map(d => d.electricUsage), backgroundColor: 'rgba(59,130,246,0.5)', yAxisID: 'y' },
                { label: 'Gas (therms)', data: data.map(d => d.gasUsage), backgroundColor: 'rgba(34,197,94,0.5)', yAxisID: 'y' },
                { type: 'line', label: 'Avg Temp (°F)', data: data.map(d => d.avgTemp), borderColor: '#ef4444', borderWidth: 2, yAxisID: 'y1', tension: 0.4, pointRadius: 0 }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Total Usage vs Temperature', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'Units' }, ticks: { font: getTickFont() } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°F' }, ticks: { font: getTickFont() } } }
        }
    });

    // 6. Rate chart (cost per unit)
    const rateE = data.map(d => d.electricUsage > 0 ? +(d.electricCost / d.electricUsage).toFixed(3) : 0);
    const rateG = data.map(d => d.gasUsage > 0 ? +(d.gasCost / d.gasUsage).toFixed(3) : 0);
    destroyChart('rate');
    charts.rate = new Chart(document.getElementById('rateChart'), {
        type: 'line', data: {
            labels, datasets: [
                { label: '$/kWh', data: rateE, borderColor: '#f97316', tension: 0.3, pointRadius: getPointRadius() },
                { label: '$/Therm', data: rateG, borderColor: '#06b6d4', yAxisID: 'y1', tension: 0.3, pointRadius: getPointRadius() }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Unit Cost Rates', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: '$/kWh' }, ticks: { font: getTickFont() } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '$/Therm' }, ticks: { font: getTickFont() } } }
        }
    });

    // 7. Scatter — Temp vs Electric Usage colored by year
    const scatterData = data.map(d => ({ x: d.avgTemp, y: d.electricUsage, year: new Date(d.date).getFullYear() }));
    const scatterYears = [...new Set(scatterData.map(d => d.year))].sort();
    const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#6366f1', '#84cc16'];
    destroyChart('scatter');
    charts.scatter = new Chart(document.getElementById('scatterChart'), {
        type: 'scatter', data: {
            datasets: scatterYears.map((yr, i) => ({
                label: '' + yr, data: scatterData.filter(d => d.year === yr).map(d => ({ x: d.x, y: d.y })),
                backgroundColor: palette[i % palette.length], pointRadius: isMobile() ? 3 : 5, pointHoverRadius: isMobile() ? 5 : 7
            }))
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: 'Temperature vs Electric Usage', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { title: { display: true, text: 'Avg Temp (°F)' }, ticks: { font: getTickFont() } }, y: { title: { display: true, text: 'kWh' }, ticks: { font: getTickFont() } } }
        }
    });

    // 8. Seasonal Doughnut
    const seasonTotals = { Winter: 0, Spring: 0, Summer: 0, Fall: 0 };
    data.forEach(d => { seasonTotals[getSeason(new Date(d.date).getMonth())] += d.electricCost + d.gasCost; });
    destroyChart('seasonal');
    charts.seasonal = new Chart(document.getElementById('seasonalChart'), {
        type: 'doughnut', data: {
            labels: Object.keys(seasonTotals), datasets: [{
                data: Object.values(seasonTotals).map(v => +v.toFixed(2)),
                backgroundColor: ['#60a5fa', '#4ade80', '#fbbf24', '#f87171'], borderColor: '#1e2235', borderWidth: 3
            }]
        }, options: {
            ...chartOpts(), aspectRatio: isMobile() ? 1 : 1.5, plugins: {
                title: { display: true, text: 'Spending by Season', font: getTitleFont() },
                legend: { position: 'bottom', labels: { padding: isMobile() ? 8 : 16, font: getLegendFont() } }
            }
        }
    });

    // 8.5. Supply vs Delivery Trend
    const sdData = data.filter(d => d.electricSupply != null || d.gasSupply != null);
    const supplyDeliveryCanvas = document.getElementById('supplyDeliveryChart');
    if (sdData.length > 1 && supplyDeliveryCanvas) {
        const sdLabels = sdData.map(d => d.date);
        const supplyLine = sdData.map(d => +((d.electricSupply || 0) + (d.gasSupply || 0)).toFixed(2));
        const deliveryLine = sdData.map(d => +((d.electricDelivery || 0) + (d.gasDelivery || 0)).toFixed(2));
        destroyChart('supplyDelivery');
        charts.supplyDelivery = new Chart(supplyDeliveryCanvas, {
            type: 'line', data: {
                labels: sdLabels, datasets: [
                    { label: 'Total Supply $', data: supplyLine, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', tension: 0.3, fill: true, pointRadius: getPointRadius(), borderWidth: 2.5 },
                    { label: 'Total Delivery $', data: deliveryLine, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', tension: 0.3, fill: true, pointRadius: getPointRadius(), borderWidth: 2.5 }
                ]
            }, options: {
                ...chartOpts(), aspectRatio: getAspectRatio(), interaction: { mode: 'index', intersect: false },
                plugins: { title: { display: true, text: 'Supply vs Delivery Cost Trend', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
                scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'USD ($)' }, ticks: { font: getTickFont() } } }
            }
        });
    } else {
        destroyChart('supplyDelivery');
    }

    // 9. YoY Comparison
    const yoyData = {};
    data.forEach(d => {
        const dt = new Date(d.date); const yr = dt.getFullYear(); const mo = dt.getMonth();
        if (!yoyData[yr]) yoyData[yr] = []; yoyData[yr][mo] = (d.electricCost + d.gasCost);
    });
    destroyChart('yoy');
    charts.yoy = new Chart(document.getElementById('yoyChart'), {
        type: 'line', data: {
            labels: MONTH_NAMES, datasets: Object.keys(yoyData).sort().map((yr, i) => ({
                label: '' + yr, data: MONTH_NAMES.map((_, mi) => yoyData[yr][mi] || null),
                borderColor: palette[i % palette.length], tension: 0.3, pointRadius: getPointRadius() + 1, spanGaps: false
            }))
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(), plugins: {
                title: { display: true, text: 'Year-over-Year Cost Comparison', font: getTitleFont() },
                legend: { position: 'bottom', labels: { padding: isMobile() ? 6 : 12, font: getLegendFont() } }
            }, scales: { x: { ticks: { font: getTickFont() } }, y: { title: { display: true, text: 'Total Cost ($)' }, ticks: { font: getTickFont() } } }
        }
    });

    // 10. Rolling 12-month average (always uses allData)
    const rolling = [];
    const rollingLabels = [];
    for (let i = 11; i < allData.length; i++) {
        const window = allData.slice(i - 11, i + 1);
        const avg = window.reduce((a, d) => a + d.electricCost + d.gasCost, 0) / 12;
        rolling.push(+avg.toFixed(2));
        rollingLabels.push(allData[i].date);
    }
    destroyChart('rolling');
    charts.rolling = new Chart(document.getElementById('rollingChart'), {
        type: 'line', data: {
            labels: rollingLabels, datasets: [
                { label: '12-Month Rolling Avg', data: rolling, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.08)', tension: 0.3, fill: true, pointRadius: 0, borderWidth: 2.5 }
            ]
        }, options: {
            ...chartOpts(), aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: 'Rolling 12-Month Average Cost', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: { x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } }, y: { title: { display: true, text: 'Avg Monthly Cost ($)' }, ticks: { font: getTickFont() } } }
        }
    });
}

// --- SORTABLE TABLE ---
document.querySelectorAll('#dataTable th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; }
        document.querySelectorAll('#dataTable th').forEach(h => h.classList.remove('sorted'));
        th.classList.add('sorted');
        th.querySelector('.sort-arrow').textContent = sortAsc ? '▲' : '▼';
        updateDashboard();
    });
});

// --- CSV EXPORT ---
function exportCSV() {
    const rows = [['Date', 'Avg Temp', 'kWh', 'Electric $', 'Therms', 'Gas $', 'Total $', 'Supply $', 'Delivery $', 'Days', 'kWh/Day', '$/Day']];
    document.querySelectorAll('#dataTable tbody tr').forEach(tr => {
        rows.push([...tr.querySelectorAll('td')].map(td => td.textContent.replace(/^\$/, '')));
    });
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'coned_bills.csv';
    a.click();
}

// --- EVENT LISTENERS ---
document.getElementById('yearFilter').addEventListener('change', updateDashboard);
document.getElementById('monthFilter').addEventListener('change', updateDashboard);

// Re-render on resize/orientation change for mobile responsiveness
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => updateDashboard(), 250);
});

// Initial render
updateDashboard();
