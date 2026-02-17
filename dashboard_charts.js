const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_MAP = { 0: 'Winter', 1: 'Winter', 2: 'Spring', 3: 'Spring', 4: 'Spring', 5: 'Summer', 6: 'Summer', 7: 'Summer', 8: 'Fall', 9: 'Fall', 10: 'Fall', 11: 'Winter' };
const DEGREE_DAY_BASE = 65;

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

const enrichedAllData = [...allData]
    .map(enrichBill)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

const years = [...new Set(enrichedAllData.map(d => new Date(d.date).getFullYear()))].sort();
const yearSelect = document.getElementById('yearFilter');
years.forEach(y => {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = y;
    yearSelect.appendChild(o);
});

let charts = {};
let sortCol = null;
let sortAsc = true;
let currentFuel = 'both';

function fmt$(v) { return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(v) { return (v * 100).toFixed(1) + '%'; }
function getSeason(month) { return SEASON_MAP[month]; }
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
function safeDiv(numerator, denominator, precision = 2) {
    if (!denominator || denominator <= 0) return null;
    return +(numerator / denominator).toFixed(precision);
}
function num(v) { return Number.isFinite(v) ? v : null; }
function valOrDash(v, digits = 2) { return v == null ? '—' : v.toFixed(digits); }

function heatClass(val, min, max) {
    if (max === min) return 'heat-mid';
    const ratio = (val - min) / (max - min);
    if (ratio < 0.33) return 'heat-low';
    if (ratio < 0.66) return 'heat-mid';
    return 'heat-high';
}

function enrichBill(d) {
    const hdd = Math.max(0, DEGREE_DAY_BASE - d.avgTemp) * d.daysCovered;
    const cdd = Math.max(0, d.avgTemp - DEGREE_DAY_BASE) * d.daysCovered;
    const totalDegreeDays = hdd + cdd;
    const electricIntensity = safeDiv(d.electricUsage, totalDegreeDays, 3);
    const gasIntensity = safeDiv(d.gasUsage, hdd, 3);

    return {
        ...d,
        hdd: +hdd.toFixed(1),
        cdd: +cdd.toFixed(1),
        totalDegreeDays: +totalDegreeDays.toFixed(1),
        electricIntensity,
        gasIntensity,
        totalCost: +(d.electricCost + d.gasCost).toFixed(2)
    };
}

function getSelectedCost(d) {
    if (currentFuel === 'electric') return d.electricCost;
    if (currentFuel === 'gas') return d.gasCost;
    return d.totalCost;
}

function getFilteredData() {
    const yearVal = document.getElementById('yearFilter').value;
    const monthVal = document.getElementById('monthFilter').value;
    const filtered = enrichedAllData.filter(d => {
        const dt = new Date(d.date);
        return (yearVal === 'all' || dt.getFullYear().toString() === yearVal) &&
            (monthVal === 'all' || dt.getMonth().toString() === monthVal);
    });
    return { filtered, yearVal, monthVal };
}

function updateDashboard() {
    const { filtered, yearVal, monthVal } = getFilteredData();
    updateSummary(filtered, yearVal);
    updateTable(filtered);
    updateCumulativeSpend(yearVal, monthVal);
    updateMainCharts(filtered);
    updateEfficiency(filtered);
    updateLongTermCharts(filtered);
}

function updateSummary(data, yearVal) {
    const el = document.getElementById('summary');
    if (!data.length) {
        el.innerHTML = '<p style="color:#64748b">No data for selected filters.</p>';
        return;
    }

    const selectedTotal = data.reduce((a, d) => a + getSelectedCost(d), 0);
    const avgMonthly = selectedTotal / data.length;
    const totalDays = data.reduce((a, d) => a + d.daysCovered, 0);
    const avgPerDay = selectedTotal / totalDays;
    const withTotals = data.map(d => ({ ...d, selectedCost: getSelectedCost(d) }));
    const highest = withTotals.reduce((a, b) => a.selectedCost > b.selectedCost ? a : b);
    const lowest = withTotals.reduce((a, b) => a.selectedCost < b.selectedCost ? a : b);

    const intensityValues = data.map(d => {
        if (currentFuel === 'electric') return d.electricIntensity;
        if (currentFuel === 'gas') return d.gasIntensity;
        return safeDiv(d.electricUsage + d.gasUsage, d.totalDegreeDays, 3);
    }).filter(v => v != null);
    const avgIntensity = intensityValues.length ? intensityValues.reduce((a, v) => a + v, 0) / intensityValues.length : null;

    let yoyHtml = '';
    if (yearVal !== 'all') {
        const yr = parseInt(yearVal, 10);
        const prevYrData = enrichedAllData.filter(d => new Date(d.date).getFullYear() === yr - 1);
        if (prevYrData.length) {
            const prevTotal = prevYrData.reduce((a, d) => a + getSelectedCost(d), 0);
            if (prevTotal > 0) {
                const curTotal = data.reduce((a, d) => a + getSelectedCost(d), 0);
                const change = (curTotal - prevTotal) / prevTotal;
                const cls = change > 0.01 ? 'yoy-up' : change < -0.01 ? 'yoy-down' : 'yoy-flat';
                const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
                yoyHtml = `<div class='summary-item'><div class='summary-value ${cls}'>${arrow} ${pct(Math.abs(change))}</div><div class='summary-label'>vs ${yr - 1}</div></div>`;
            }
        }
    }

    const selectedLabel = currentFuel === 'both' ? 'Total Spent' : `${currentFuel[0].toUpperCase()}${currentFuel.slice(1)} Spent`;
    const intensityLabel = currentFuel === 'electric' ? 'Avg kWh/DD' : currentFuel === 'gas' ? 'Avg Therm/HDD' : 'Avg Usage/DD';

    el.innerHTML = `
        <div class='summary-item'><div class='summary-value'>${fmt$(selectedTotal)}</div><div class='summary-label'>${selectedLabel}</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(avgMonthly)}</div><div class='summary-label'>Avg Monthly</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(avgPerDay)}</div><div class='summary-label'>Avg $/Day</div></div>
        <div class='summary-item'><div class='summary-value'>${data.length}</div><div class='summary-label'>Bills</div></div>
        <div class='summary-item'><div class='summary-value'>${avgIntensity == null ? '—' : avgIntensity.toFixed(3)}</div><div class='summary-label'>${intensityLabel}</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(highest.selectedCost)}</div><div class='summary-label'>Highest Bill</div><div class='summary-sub'>${highest.date}</div></div>
        <div class='summary-item'><div class='summary-value'>${fmt$(lowest.selectedCost)}</div><div class='summary-label'>Lowest Bill</div><div class='summary-sub'>${lowest.date}</div></div>
        ${yoyHtml}
    `;
}

function updateTable(data) {
    const tbody = document.querySelector('#dataTable tbody');
    if (!data.length) {
        tbody.innerHTML = '';
        document.getElementById('tableCount').textContent = '0 records';
        return;
    }

    const costs = data.map(d => getSelectedCost(d));
    const minC = Math.min(...costs);
    const maxC = Math.max(...costs);

    let sorted = [...data];
    if (sortCol) {
        sorted.sort((a, b) => {
            let va;
            let vb;
            if (sortCol === 'totalCost') {
                va = getSelectedCost(a);
                vb = getSelectedCost(b);
            } else if (sortCol === 'kwhPerDay') {
                va = a.electricUsage / a.daysCovered;
                vb = b.electricUsage / b.daysCovered;
            } else if (sortCol === 'kwhPerDegreeDay') {
                va = a.electricIntensity ?? -1;
                vb = b.electricIntensity ?? -1;
            } else if (sortCol === 'thermsPerHdd') {
                va = a.gasIntensity ?? -1;
                vb = b.gasIntensity ?? -1;
            } else if (sortCol === 'costPerDay') {
                va = getSelectedCost(a) / a.daysCovered;
                vb = getSelectedCost(b) / b.daysCovered;
            } else if (sortCol === 'supplyTotal') {
                va = (a.electricSupply || 0) + (a.gasSupply || 0);
                vb = (b.electricSupply || 0) + (b.gasSupply || 0);
            } else if (sortCol === 'deliveryTotal') {
                va = (a.electricDelivery || 0) + (a.gasDelivery || 0);
                vb = (b.electricDelivery || 0) + (b.gasDelivery || 0);
            } else {
                va = a[sortCol];
                vb = b[sortCol];
            }
            if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortAsc ? va - vb : vb - va;
        });
    }

    tbody.innerHTML = sorted.map(d => {
        const selectedCost = getSelectedCost(d);
        const kwhDay = (d.electricUsage / d.daysCovered).toFixed(1);
        const costDay = (selectedCost / d.daysCovered).toFixed(2);
        const hc = heatClass(selectedCost, minC, maxC);
        const supplyVal = (d.electricSupply != null || d.gasSupply != null) ? fmt$((d.electricSupply || 0) + (d.gasSupply || 0)) : '—';
        const deliveryVal = (d.electricDelivery != null || d.gasDelivery != null) ? fmt$((d.electricDelivery || 0) + (d.gasDelivery || 0)) : '—';
        return `<tr>
            <td>${d.date}</td><td>${d.avgTemp}</td><td>${d.electricUsage}</td><td>${fmt$(d.electricCost)}</td>
            <td>${d.gasUsage}</td><td>${fmt$(d.gasCost)}</td><td class="${hc}">${fmt$(selectedCost)}</td>
            <td>${supplyVal}</td><td>${deliveryVal}</td><td>${d.daysCovered}</td>
            <td>${d.hdd.toFixed(1)}</td><td>${d.cdd.toFixed(1)}</td><td>${kwhDay}</td>
            <td>${valOrDash(d.electricIntensity, 3)}</td><td>${valOrDash(d.gasIntensity, 3)}</td>
            <td>${fmt$(parseFloat(costDay))}</td>
        </tr>`;
    }).join('');

    document.getElementById('tableCount').textContent = `${sorted.length} records`;
}

function updateCumulativeSpend(yearVal, monthVal) {
    const cutoffMonth = monthVal === 'all' ? 11 : parseInt(monthVal, 10);
    const source = enrichedAllData.filter(d => {
        const dt = new Date(d.date);
        const includeYear = yearVal === 'all' || dt.getFullYear().toString() === yearVal;
        return includeYear && dt.getMonth() <= cutoffMonth;
    });

    const totalsByYear = {};
    source.forEach(d => {
        const dt = new Date(d.date);
        const yr = dt.getFullYear();
        const mo = dt.getMonth();
        if (!totalsByYear[yr]) totalsByYear[yr] = Array(12).fill(0);
        totalsByYear[yr][mo] += getSelectedCost(d);
    });

    const palette = ['#38bdf8', '#f59e0b', '#4ade80', '#f87171', '#a78bfa', '#14b8a6', '#f97316', '#84cc16'];
    const datasets = Object.keys(totalsByYear).sort().map((yr, idx) => {
        const monthTotals = totalsByYear[yr];
        let cumulative = 0;
        const cumulativeSeries = monthTotals.map((v, monthIdx) => {
            if (monthIdx > cutoffMonth) return null;
            cumulative += v;
            return +cumulative.toFixed(2);
        });
        return {
            label: `${yr} cumulative`,
            data: cumulativeSeries,
            borderColor: palette[idx % palette.length],
            backgroundColor: 'transparent',
            pointRadius: getPointRadius() + 1,
            borderWidth: 2.2,
            tension: 0.2,
            spanGaps: false
        };
    });

    destroyChart('cumulative');
    charts.cumulative = new Chart(document.getElementById('cumulativeSpendChart'), {
        type: 'line',
        data: { labels: MONTH_NAMES, datasets },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            plugins: {
                title: { display: true, text: 'Cumulative Annual Spend', font: getTitleFont() },
                legend: { position: 'bottom', labels: { font: getLegendFont() } }
            },
            scales: {
                x: { ticks: { font: getTickFont() } },
                y: { title: { display: true, text: 'Cumulative Cost ($)' }, ticks: { font: getTickFont() } }
            }
        }
    });
}

function updateMainCharts(data) {
    const labels = data.map(d => d.date);
    const eUsage = data.map(d => d.electricUsage);
    const gUsage = data.map(d => d.gasUsage);
    const temps = data.map(d => d.avgTemp);
    const kwhDay = data.map(d => +(d.electricUsage / d.daysCovered).toFixed(2));
    const thermDay = data.map(d => +(d.gasUsage / d.daysCovered).toFixed(2));

    destroyChart('electric');
    charts.electric = new Chart(document.getElementById('electricChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Electric (kWh)', data: eUsage, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius() },
                { label: 'Avg Temp (°F)', data: temps, borderColor: '#f59e0b', yAxisID: 'y1', borderDash: [5, 5], tension: 0.3, pointRadius: 0 }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Electric Usage vs Temperature', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: 'kWh' }, ticks: { font: getTickFont() } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°F' }, ticks: { font: getTickFont() } }
            }
        }
    });

    destroyChart('gas');
    charts.gas = new Chart(document.getElementById('gasChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Gas (therms)', data: gUsage, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius() },
                { label: 'Avg Temp (°F)', data: temps, borderColor: '#f59e0b', yAxisID: 'y1', borderDash: [5, 5], tension: 0.3, pointRadius: 0 }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Gas Usage vs Temperature', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: 'Therms' }, ticks: { font: getTickFont() } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°F' }, ticks: { font: getTickFont() } }
            }
        }
    });

    destroyChart('cost');
    const hasBreakdown = data.some(d => d.electricSupply != null || d.electricDelivery != null);
    const costDatasets = [];
    if (hasBreakdown) {
        if (currentFuel !== 'gas') {
            costDatasets.push(
                { label: 'Elec Supply $', data: data.map(d => d.electricSupply || 0), backgroundColor: '#3b82f6' },
                { label: 'Elec Delivery $', data: data.map(d => d.electricDelivery || 0), backgroundColor: '#60a5fa' }
            );
        }
        if (currentFuel !== 'electric') {
            costDatasets.push(
                { label: 'Gas Supply $', data: data.map(d => d.gasSupply || 0), backgroundColor: '#22c55e' },
                { label: 'Gas Delivery $', data: data.map(d => d.gasDelivery || 0), backgroundColor: '#4ade80' }
            );
        }
    } else {
        if (currentFuel !== 'gas') costDatasets.push({ label: 'Electric $', data: data.map(d => d.electricCost), backgroundColor: '#3b82f6' });
        if (currentFuel !== 'electric') costDatasets.push({ label: 'Gas $', data: data.map(d => d.gasCost), backgroundColor: '#22c55e' });
    }

    charts.cost = new Chart(document.getElementById('costBreakdownChart'), {
        type: 'bar',
        data: { labels, datasets: costDatasets },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: hasBreakdown ? 'Cost Breakdown: Supply vs Delivery' : 'Monthly Cost Breakdown', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { stacked: true, ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { stacked: true, title: { display: true, text: 'USD ($)' }, ticks: { font: getTickFont() } }
            }
        }
    });

    destroyChart('daily');
    charts.daily = new Chart(document.getElementById('dailyNormChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'kWh / Day', data: kwhDay, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', yAxisID: 'y', tension: 0.3, fill: true, pointRadius: getPointRadius(), hidden: currentFuel === 'gas' },
                { label: 'Therms / Day', data: thermDay, borderColor: '#14b8a6', yAxisID: 'y1', tension: 0.3, pointRadius: getPointRadius(), hidden: currentFuel === 'electric' }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Daily Normalized Usage', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: 'kWh/day' }, ticks: { font: getTickFont() } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Therms/day' }, ticks: { font: getTickFont() } }
            }
        }
    });
}

function updateEfficiency(data) {
    const labels = data.map(d => d.date);
    const electricEff = data.map(d => num(d.electricIntensity));
    const gasEff = data.map(d => num(d.gasIntensity));
    const rateE = data.map(d => d.electricUsage > 0 ? +(d.electricCost / d.electricUsage).toFixed(3) : null);
    const rateG = data.map(d => d.gasUsage > 0 ? +(d.gasCost / d.gasUsage).toFixed(3) : null);

    destroyChart('efficiency');
    charts.efficiency = new Chart(document.getElementById('efficiencyChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'kWh / Degree Day', data: electricEff, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.08)', tension: 0.3, pointRadius: getPointRadius() + 1, spanGaps: false, hidden: currentFuel === 'gas' },
                { label: 'Therms / HDD', data: gasEff, borderColor: '#4ade80', yAxisID: 'y1', tension: 0.3, pointRadius: getPointRadius() + 1, spanGaps: false, hidden: currentFuel === 'electric' }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Efficiency Trend', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: 'kWh / DD' }, ticks: { font: getTickFont() } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Therm / HDD' }, ticks: { font: getTickFont() } }
            }
        }
    });

    destroyChart('rate');
    charts.rate = new Chart(document.getElementById('rateChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: '$/kWh', data: rateE, borderColor: '#f97316', tension: 0.3, pointRadius: getPointRadius(), hidden: currentFuel === 'gas' },
                { label: '$/Therm', data: rateG, borderColor: '#06b6d4', yAxisID: 'y1', tension: 0.3, pointRadius: getPointRadius(), hidden: currentFuel === 'electric' }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            interaction: { mode: 'index', intersect: false },
            plugins: { title: { display: true, text: 'Unit Cost Rates', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: '$/kWh' }, ticks: { font: getTickFont() } },
                y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '$/Therm' }, ticks: { font: getTickFont() } }
            }
        }
    });
}

function updateLongTermCharts(data) {
    const labels = data.map(d => d.date);
    const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#6366f1', '#84cc16'];

    const scatterData = data.map(d => ({
        x: d.avgTemp,
        y: currentFuel === 'gas' ? d.gasUsage : d.electricUsage,
        year: new Date(d.date).getFullYear()
    }));
    const scatterYears = [...new Set(scatterData.map(d => d.year))].sort();
    destroyChart('scatter');
    charts.scatter = new Chart(document.getElementById('scatterChart'), {
        type: 'scatter',
        data: {
            datasets: scatterYears.map((yr, i) => ({
                label: '' + yr,
                data: scatterData.filter(d => d.year === yr).map(d => ({ x: d.x, y: d.y })),
                backgroundColor: palette[i % palette.length],
                pointRadius: isMobile() ? 3 : 5,
                pointHoverRadius: isMobile() ? 5 : 7
            }))
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: currentFuel === 'gas' ? 'Temperature vs Gas Usage' : 'Temperature vs Electric Usage', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { title: { display: true, text: 'Avg Temp (°F)' }, ticks: { font: getTickFont() } },
                y: { title: { display: true, text: currentFuel === 'gas' ? 'Therms' : 'kWh' }, ticks: { font: getTickFont() } }
            }
        }
    });

    const seasonTotals = { Winter: 0, Spring: 0, Summer: 0, Fall: 0 };
    data.forEach(d => { seasonTotals[getSeason(new Date(d.date).getMonth())] += getSelectedCost(d); });
    destroyChart('seasonal');
    charts.seasonal = new Chart(document.getElementById('seasonalChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(seasonTotals),
            datasets: [{
                data: Object.values(seasonTotals).map(v => +v.toFixed(2)),
                backgroundColor: ['#60a5fa', '#4ade80', '#fbbf24', '#f87171'],
                borderColor: '#1e2235',
                borderWidth: 3
            }]
        },
        options: {
            ...chartOpts(),
            aspectRatio: isMobile() ? 1 : 1.5,
            plugins: {
                title: { display: true, text: 'Spending by Season', font: getTitleFont() },
                legend: { position: 'bottom', labels: { padding: isMobile() ? 8 : 16, font: getLegendFont() } }
            }
        }
    });

    const sdData = data.filter(d => d.electricSupply != null || d.gasSupply != null);
    const supplyDeliveryCanvas = document.getElementById('supplyDeliveryChart');
    if (sdData.length > 1 && supplyDeliveryCanvas) {
        const sdLabels = sdData.map(d => d.date);
        const supplyLine = sdData.map(d => {
            if (currentFuel === 'electric') return +(d.electricSupply || 0).toFixed(2);
            if (currentFuel === 'gas') return +(d.gasSupply || 0).toFixed(2);
            return +((d.electricSupply || 0) + (d.gasSupply || 0)).toFixed(2);
        });
        const deliveryLine = sdData.map(d => {
            if (currentFuel === 'electric') return +(d.electricDelivery || 0).toFixed(2);
            if (currentFuel === 'gas') return +(d.gasDelivery || 0).toFixed(2);
            return +((d.electricDelivery || 0) + (d.gasDelivery || 0)).toFixed(2);
        });
        destroyChart('supplyDelivery');
        charts.supplyDelivery = new Chart(supplyDeliveryCanvas, {
            type: 'line',
            data: {
                labels: sdLabels,
                datasets: [
                    { label: 'Total Supply $', data: supplyLine, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', tension: 0.3, fill: true, pointRadius: getPointRadius(), borderWidth: 2.5 },
                    { label: 'Total Delivery $', data: deliveryLine, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', tension: 0.3, fill: true, pointRadius: getPointRadius(), borderWidth: 2.5 }
                ]
            },
            options: {
                ...chartOpts(),
                aspectRatio: getAspectRatio(),
                interaction: { mode: 'index', intersect: false },
                plugins: { title: { display: true, text: 'Supply vs Delivery Cost Trend', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
                scales: {
                    x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                    y: { title: { display: true, text: 'USD ($)' }, ticks: { font: getTickFont() } }
                }
            }
        });
    } else {
        destroyChart('supplyDelivery');
    }

    const yoyData = {};
    data.forEach(d => {
        const dt = new Date(d.date);
        const yr = dt.getFullYear();
        const mo = dt.getMonth();
        if (!yoyData[yr]) yoyData[yr] = [];
        yoyData[yr][mo] = getSelectedCost(d);
    });
    destroyChart('yoy');
    charts.yoy = new Chart(document.getElementById('yoyChart'), {
        type: 'line',
        data: {
            labels: MONTH_NAMES,
            datasets: Object.keys(yoyData).sort().map((yr, i) => ({
                label: '' + yr,
                data: MONTH_NAMES.map((_, mi) => yoyData[yr][mi] || null),
                borderColor: palette[i % palette.length],
                tension: 0.3,
                pointRadius: getPointRadius() + 1,
                spanGaps: false
            }))
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            plugins: {
                title: { display: true, text: 'Year-over-Year Cost Comparison', font: getTitleFont() },
                legend: { position: 'bottom', labels: { padding: isMobile() ? 6 : 12, font: getLegendFont() } }
            },
            scales: {
                x: { ticks: { font: getTickFont() } },
                y: { title: { display: true, text: 'Total Cost ($)' }, ticks: { font: getTickFont() } }
            }
        }
    });

    const rolling = [];
    const rollingLabels = [];
    for (let i = 11; i < enrichedAllData.length; i++) {
        const windowSlice = enrichedAllData.slice(i - 11, i + 1);
        const avg = windowSlice.reduce((a, d) => a + getSelectedCost(d), 0) / 12;
        rolling.push(+avg.toFixed(2));
        rollingLabels.push(enrichedAllData[i].date);
    }
    destroyChart('rolling');
    charts.rolling = new Chart(document.getElementById('rollingChart'), {
        type: 'line',
        data: {
            labels: rollingLabels,
            datasets: [
                { label: '12-Month Rolling Avg', data: rolling, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.08)', tension: 0.3, fill: true, pointRadius: 0, borderWidth: 2.5 }
            ]
        },
        options: {
            ...chartOpts(),
            aspectRatio: getAspectRatio(),
            plugins: { title: { display: true, text: 'Rolling 12-Month Average Cost', font: getTitleFont() }, legend: { labels: { font: getLegendFont() } } },
            scales: {
                x: { ticks: { maxRotation: 90, maxTicksLimit: getMaxTicks(), font: getTickFont() } },
                y: { title: { display: true, text: 'Avg Monthly Cost ($)' }, ticks: { font: getTickFont() } }
            }
        }
    });
}

function toggleFuelType(fuelType) {
    currentFuel = fuelType;
    document.querySelectorAll('#fuelToggle .fuel-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fuel === fuelType);
    });

    document.querySelectorAll('[data-fuel-wrapper]').forEach(wrapper => {
        const requiredFuel = wrapper.getAttribute('data-fuel-wrapper');
        const isVisible = fuelType === 'both' || requiredFuel === fuelType;
        wrapper.classList.toggle('chart-hidden', !isVisible);
    });

    updateDashboard();
}

document.querySelectorAll('#dataTable th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) {
            sortAsc = !sortAsc;
        } else {
            sortCol = col;
            sortAsc = true;
        }
        document.querySelectorAll('#dataTable th').forEach(h => h.classList.remove('sorted'));
        th.classList.add('sorted');
        th.querySelector('.sort-arrow').textContent = sortAsc ? '▲' : '▼';
        updateDashboard();
    });
});

function exportCSV() {
    const rows = [['Date', 'Avg Temp', 'kWh', 'Electric $', 'Therms', 'Gas $', 'Selected Total $', 'Supply $', 'Delivery $', 'Days', 'HDD', 'CDD', 'kWh/Day', 'kWh/DD', 'Therm/HDD', '$/Day']];
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

document.getElementById('yearFilter').addEventListener('change', updateDashboard);
document.getElementById('monthFilter').addEventListener('change', updateDashboard);
document.querySelectorAll('#fuelToggle .fuel-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleFuelType(btn.dataset.fuel));
});

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => updateDashboard(), 250);
});

updateDashboard();
