const fs = require('fs');
const https = require('https');

// Load billing data
const bills = JSON.parse(fs.readFileSync('bills_data.json', 'utf8'));

// Zip 11101 Coordinates (Long Island City)
const LAT = 40.7536;
const LON = -73.9432;
const DEGREE_DAY_BASE = 65;

// Helper to make HTTPS request
function fetchWeather(startDate, endDate) {
    return new Promise((resolve, reject) => {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FNew_York`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) reject(new Error(json.reason));
                    else resolve(json);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Helper to subtract days from date
function subtractDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
}

// Main logic
async function enrich() {
    console.log(`Processing ${bills.length} bills...`);
    const enrichedBills = [];

    // Process sequentially to be nice to the API (though it handles bulk likely fine)
    // We can actually just fetch the ENTIRE range in one go to be efficient?
    // Let's find min and max date.

    // Sort bills
    bills.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (bills.length === 0) return;

    const lastDate = bills[bills.length - 1].date;
    const firstBillDate = bills[0].date;
    // Assume first bill covers prev 30 days
    const firstDate = subtractDays(firstBillDate, 35);

    console.log(`Fetching weather from ${firstDate} to ${lastDate}...`);

    try {
        const weatherData = await fetchWeather(firstDate, lastDate);
        const dailyTemps = {}; // Map "YYYY-MM-DD" -> temp

        weatherData.daily.time.forEach((t, i) => {
            dailyTemps[t] = weatherData.daily.temperature_2m_mean[i];
        });

        console.log(`Fetched ${Object.keys(dailyTemps).length} days of weather data.`);

        // Now map to bills
        for (let i = 0; i < bills.length; i++) {
            const bill = bills[i];
            const endDate = bill.date;

            // Determine start date: 
            // If there is a previous bill, use its date + 1 day? 
            // Or just assume 30 days if gap is too large?
            let startDate;
            if (i > 0) {
                const prevDate = bills[i - 1].date;
                const diffTime = Math.abs(new Date(endDate) - new Date(prevDate));
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > 45 || diffDays < 20) {
                    // Gap too big or small, assume ~30 days
                    startDate = subtractDays(endDate, 30);
                } else {
                    startDate = prevDate; // Use previous bill date as start
                }
            } else {
                startDate = subtractDays(endDate, 30);
            }

            // Calculate avg temp for range [startDate, endDate]
            let sum = 0;
            let count = 0;
            let curr = new Date(startDate);
            const end = new Date(endDate);

            while (curr <= end) {
                const dateStr = curr.toISOString().split('T')[0];
                if (dailyTemps[dateStr] !== undefined) {
                    sum += dailyTemps[dateStr];
                    count++;
                }
                curr.setDate(curr.getDate() + 1);
            }

            bill.avgTemp = count > 0 ? parseFloat((sum / count).toFixed(1)) : null;
            bill.daysCovered = count;
            if (bill.avgTemp != null && count > 0) {
                const hdd = Math.max(0, DEGREE_DAY_BASE - bill.avgTemp) * count;
                const cdd = Math.max(0, bill.avgTemp - DEGREE_DAY_BASE) * count;
                const totalDegreeDays = hdd + cdd;
                bill.hdd = parseFloat(hdd.toFixed(1));
                bill.cdd = parseFloat(cdd.toFixed(1));
                bill.totalDegreeDays = parseFloat(totalDegreeDays.toFixed(1));
                bill.electricIntensity = totalDegreeDays > 0 ? parseFloat((bill.electricUsage / totalDegreeDays).toFixed(3)) : 0;
                bill.gasIntensity = hdd > 0 ? parseFloat((bill.gasUsage / hdd).toFixed(3)) : 0;
            } else {
                bill.hdd = null;
                bill.cdd = null;
                bill.totalDegreeDays = null;
                bill.electricIntensity = null;
                bill.gasIntensity = null;
            }
            enrichedBills.push(bill);
        }

        fs.writeFileSync('bills_weather_data.json', JSON.stringify(enrichedBills, null, 2));
        console.log("Written bills_weather_data.json");

    } catch (e) {
        console.error("Failed to fetch weather:", e);
    }
}

enrich();
