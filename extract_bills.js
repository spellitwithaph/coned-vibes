const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const htmlDir = __dirname;
const outputJson = 'bills_data.json';
const outputCsv = 'bills_data.csv';

// Regex Patterns
const patterns = {
    // Prioritize "Billing period: X to Y" or "Billing period ending: Y"
    dateRange: /Billing period:?.*to\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    dateEnd: /Billing period ending:?\s+(\w+\s+\d{1{1,2},?\s+\d{4})/i,
    datePayment: /Total amount due by\s+(\w+\s+\d{1,2},?\s+\d{4})/i, // Fallback

    electricCostCombined: /Electricity charges\s*-\s*for\s*\d+\s*days\s*\$([\d\.]+)/i,
    electricCostCombinedAlternative: /Your electricity total\s*\$([\d\.]+)/i,

    // For split charges (older bills)
    escoSupply: /Esco electricity supply charges\s*-\s*for\s*\d+\s*days\s*\$([\d\.]+)/i,
    conEdDelivery: /Con Edison electricity charges\s*\$([\d\.]+)/i,

    gasCostCombined: /Gas charges\s*-\s*for\s*\d+\s*days\s*\$([\d\.]+)/i,
    gasCostTotal: /Your gas total\s*\$([\d\.]+)/i,

    // Electric Usage
    electricUsage: /Your electricity use\s*([\d,]+)\s*kWh/i,
    electricUsageAlt: /Total electricity use\s*([\d,]+)\s*kWh/i, // Added for 2020-09
    electricUsageSupply: /Supply\s+([\d,]+(?:\.\d+)?)\s*kWh/i,

    // Complex Table Match fallback for 2024
    electricUsageTable: /Read Diff\s*kWh.*?(\d+)\s+(\d+)/i,

    gasUsage: /Your gas use\s*([\d,]+)\s*therms/i,
    gasUsageAlt: /Total Gas Use\s*([\d,]+(?:\.\d+)?)\s*therms/i,

    // Supply / Delivery subtotals
    electricSupplyTotal: /Total electricity supply charges\s+\$?([\d.]+)/i,
    electricDeliveryTotal: /Total electricity delivery charges\s+\$?([\d.]+)/i,
    gasSupplyTotal: /Total gas supply charges\s+\$?([\d.]+)/i,
    gasDeliveryTotal: /Total gas delivery charges\s+\$?([\d.]+)/i,

    // Total amount due (for data integrity)
    totalAmountDue: /Total amount due.*?\$([\d,.]+)/i
};

// Helper to extract float from regex match
function extractFloat(text, pattern) {
    const match = text.match(pattern);
    if (match && match[1]) {
        return parseFloat(match[1].replace(/,/g, ''));
    }
    return null;
}

// Helper to clean text
function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

async function processFiles() {
    const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
    const results = [];

    console.log(`Found ${files.length} HTML files.`);

    for (const file of files) {
        const filePath = path.join(htmlDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(content);

        // Extract text content. 
        // Cheerio's .text() might join without spaces if block elements are adjacent.
        // Let's replace <br> with newlines first to be safe.
        $('br').replaceWith('\n');
        const rawText = $.root().text();
        const text = cleanText(rawText); // Single line version for some regexes
        const multilineText = rawText; // Keep newlines for others if needed

        let billData = {
            filename: file,
            date: null,
            electricUsage: 0,
            electricCost: 0,
            gasUsage: 0,
            gasCost: 0,
            electricSupply: null,
            electricDelivery: null,
            gasSupply: null,
            gasDelivery: null,
            totalAmountDue: null
        };

        // 1. Date Extraction (Hierarchy)
        let dateMatch = text.match(patterns.dateRange);
        if (!dateMatch) dateMatch = text.match(patterns.dateEnd);
        if (!dateMatch) dateMatch = text.match(patterns.datePayment);

        if (dateMatch) {
            try {
                billData.date = new Date(dateMatch[1]).toISOString().split('T')[0];
            } catch (e) {
                console.warn(`[WARN] Failed to parse date string "${dateMatch[1]}" in ${file}`);
            }
        }

        // Validation & Fallback: 
        // If date is missing OR it is the known bad date ("2014-03-01"), try filename.
        if (!billData.date || billData.date === '2014-03-01' || billData.date < '2017-01-01') {
            // Filename format: ConEd-Bill-YYYY-MM.html
            const fileMatch = file.match(/ConEd-Bill-(\d{4})-(\d{2})/);
            if (fileMatch) {
                // specific day doesn't matter much for sorting, pick 01 or approximation
                billData.date = `${fileMatch[1]}-${fileMatch[2]}-01`;
                // console.log(`[INFO] Used filename date for ${file}: ${billData.date}`);
            } else {
                console.warn(`[WARN] No valid date found for ${file}`);
            }
        }

        // Final Filter: User requested nothing before June 2017
        if (billData.date && billData.date >= '2017-06-01') {
            // Only push if valid
            // 2. Electric Cost
            let eCost = extractFloat(text, patterns.electricCostCombined);
            if (eCost === null) eCost = extractFloat(text, patterns.electricCostCombinedAlternative);
            if (eCost === null) {
                const supply = extractFloat(text, patterns.escoSupply) || 0;
                const delivery = extractFloat(text, patterns.conEdDelivery) || 0;
                if (supply || delivery) eCost = supply + delivery;
            }
            billData.electricCost = eCost || 0;

            // 3. Gas Cost
            let gCost = extractFloat(text, patterns.gasCostCombined);
            if (gCost === null) gCost = extractFloat(text, patterns.gasCostTotal);
            billData.gasCost = gCost || 0;

            // 4. Electric Usage (kWh)
            let eUsage = extractFloat(text, patterns.electricUsage);
            if (eUsage === null) eUsage = extractFloat(text, patterns.electricUsageAlt); // Try "Total electricity use"
            if (eUsage === null) eUsage = extractFloat(text, patterns.electricUsageSupply);

            // Complex Table Match fallback for 2024 if Supply line is missing
            if (eUsage === null) {
                const tableMatch = text.match(/Read Diff\s*kWh.*?(\d+)\s+(\d+)/i);
                if (tableMatch && tableMatch[2]) {
                    eUsage = parseFloat(tableMatch[2]);
                }
            }
            billData.electricUsage = eUsage || 0;

            // 5. Gas Usage (therms)
            let gUsage = extractFloat(text, patterns.gasUsage);
            if (gUsage === null) gUsage = extractFloat(text, patterns.gasUsageAlt);
            billData.gasUsage = gUsage || 0;

            // 6. Supply / Delivery subtotals (null if not found)
            // Try specific patterns first (newer bills: "Total electricity supply charges")
            billData.electricSupply = extractFloat(text, patterns.electricSupplyTotal);
            billData.electricDelivery = extractFloat(text, patterns.electricDeliveryTotal);
            billData.gasSupply = extractFloat(text, patterns.gasSupplyTotal);
            billData.gasDelivery = extractFloat(text, patterns.gasDeliveryTotal);

            // Fallback: older bills use generic "Total supply/delivery charges"
            // Order in the bill text is: elec supply, elec delivery, gas supply, gas delivery
            if (billData.electricDelivery === null || billData.gasDelivery === null) {
                const genericSupply = [];
                const genericDelivery = [];
                let gm;
                const gsp = /Total supply charges\s+\$?([\d.]+)/ig;
                while ((gm = gsp.exec(text)) !== null) genericSupply.push(parseFloat(gm[1]));
                const gdp = /Total delivery charges\s+\$?([\d.]+)/ig;
                while ((gm = gdp.exec(text)) !== null) genericDelivery.push(parseFloat(gm[1]));

                // First delivery match = electric delivery, second = gas delivery
                if (billData.electricDelivery === null && genericDelivery.length >= 1) {
                    billData.electricDelivery = genericDelivery[0];
                }
                if (billData.gasDelivery === null && genericDelivery.length >= 2) {
                    billData.gasDelivery = genericDelivery[1];
                }
                // If no specific electric supply, first generic supply = electric supply
                if (billData.electricSupply === null && genericSupply.length >= 1) {
                    // When both are generic, first = electric, second = gas
                    if (genericSupply.length >= 2) {
                        billData.electricSupply = genericSupply[0];
                        if (billData.gasSupply === null) billData.gasSupply = genericSupply[1];
                    } else {
                        // Only one generic supply match — it's gas (electric uses specific pattern)
                        if (billData.gasSupply === null) billData.gasSupply = genericSupply[0];
                    }
                } else if (billData.gasSupply === null && genericSupply.length >= 1) {
                    // Electric supply was specific, so the one generic supply = gas
                    billData.gasSupply = genericSupply[0];
                }
            }

            // 7. Total Amount Due
            const totalDueMatch = text.match(patterns.totalAmountDue);
            if (totalDueMatch) {
                billData.totalAmountDue = parseFloat(totalDueMatch[1].replace(/,/g, ''));
            }

            results.push(billData);
        }
    }

    // Sort by date
    results.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Write JSON
    fs.writeFileSync(outputJson, JSON.stringify(results, null, 2));
    console.log(`Written JSON to ${outputJson}`);

    // Write CSV
    const csvWriter = createCsvWriter({
        path: outputCsv,
        header: [
            { id: 'date', title: 'Date' },
            { id: 'electricUsage', title: 'Electric Usage (kWh)' },
            { id: 'electricCost', title: 'Electric Cost ($)' },
            { id: 'electricSupply', title: 'Elec Supply ($)' },
            { id: 'electricDelivery', title: 'Elec Delivery ($)' },
            { id: 'gasUsage', title: 'Gas Usage (therms)' },
            { id: 'gasCost', title: 'Gas Cost ($)' },
            { id: 'gasSupply', title: 'Gas Supply ($)' },
            { id: 'gasDelivery', title: 'Gas Delivery ($)' },
            { id: 'totalAmountDue', title: 'Total Due ($)' },
            { id: 'filename', title: 'Source File' }
        ]
    });

    await csvWriter.writeRecords(results);
    console.log(`Written CSV to ${outputCsv}`);
}

processFiles().catch(console.error);
