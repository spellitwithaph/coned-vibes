const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const htmlDir = path.join(__dirname, 'bills');
const outputJson = 'bills_data.json';
const outputCsv = 'bills_data.csv';

const patterns = {
    dateRange: /Billing period:?.*to\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    dateEnd: /Billing period ending:?\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    datePayment: /Total amount due by\s+(\w+\s+\d{1,2},?\s+\d{4})/i,

    electricCostCombined: /Electricity charges\s*-\s*for\s*\d+\s*days\s*\$([\d.]+)/i,
    electricCostCombinedAlternative: /Your electricity total\s*\$([\d.]+)/i,
    escoSupply: /Esco electricity supply charges\s*-\s*for\s*\d+\s*days\s*\$([\d.]+)/i,
    conEdDelivery: /Con Edison electricity charges\s*\$([\d.]+)/i,

    gasCostCombined: /Gas charges\s*-\s*for\s*\d+\s*days\s*\$([\d.]+)/i,
    gasCostTotal: /Your gas total\s*\$([\d.]+)/i,

    electricUsage: /Your electricity use\s*([\d,]+)\s*kWh/i,
    electricUsageAlt: /Total electricity use\s*([\d,]+)\s*kWh/i,
    electricUsageSupply: /Supply\s+([\d,]+(?:\.\d+)?)\s*kWh/i,
    electricUsageTable: /Read Diff\s*kWh.*?(\d+)\s+(\d+)/i,

    gasUsage: /Your gas use\s*([\d,]+)\s*therms/i,
    gasUsageAlt: /Total Gas Use\s*([\d,]+(?:\.\d+)?)\s*therms/i,

    electricSupplyTotal: /Total electricity supply charges\s+\$?([\d.]+)/i,
    electricDeliveryTotal: /Total electricity delivery charges\s+\$?([\d.]+)/i,
    gasSupplyTotal: /Total gas supply charges\s+\$?([\d.]+)/i,
    gasDeliveryTotal: /Total gas delivery charges\s+\$?([\d.]+)/i,

    genericSupplyTotal: /Total supply charges\s+\$?([\d.]+)/ig,
    genericDeliveryTotal: /Total delivery charges\s+\$?([\d.]+)/ig,

    totalAmountDue: /Total amount due.*?\$([\d,.]+)/i
};

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function parseNumber(raw) {
    if (!raw) return null;
    const parsed = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isNaN(parsed) ? null : parsed;
}

function extractFloat(text, pattern) {
    const match = text.match(pattern);
    return match && match[1] ? parseNumber(match[1]) : null;
}

function extractFirstFloat(text, patternList) {
    for (const pattern of patternList) {
        const value = extractFloat(text, pattern);
        if (value !== null) return value;
    }
    return null;
}

function extractAllFloats(text, pattern) {
    const values = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const value = parseNumber(match[1]);
        if (value !== null) values.push(value);
    }
    pattern.lastIndex = 0;
    return values;
}

function toIsoDate(dateString) {
    const dt = new Date(dateString);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().split('T')[0];
}

function extractBillDate(text, filename) {
    const dateText = [patterns.dateRange, patterns.dateEnd, patterns.datePayment]
        .map((pattern) => text.match(pattern))
        .find((match) => match && match[1]);

    let date = dateText ? toIsoDate(dateText[1]) : null;

    if (!date || date === '2014-03-01' || date < '2017-01-01') {
        const fileMatch = filename.match(/ConEd-Bill-(\d{4})-(\d{2})/);
        if (fileMatch) {
            date = `${fileMatch[1]}-${fileMatch[2]}-01`;
        } else {
            console.warn(`[WARN] No valid date found for ${filename}`);
        }
    }

    return date;
}

function extractElectricCost(text) {
    const directCost = extractFirstFloat(text, [
        patterns.electricCostCombined,
        patterns.electricCostCombinedAlternative
    ]);
    if (directCost !== null) return directCost;

    const supply = extractFloat(text, patterns.escoSupply) || 0;
    const delivery = extractFloat(text, patterns.conEdDelivery) || 0;
    return supply || delivery ? supply + delivery : 0;
}

function extractElectricUsage(text) {
    const usage = extractFirstFloat(text, [
        patterns.electricUsage,
        patterns.electricUsageAlt,
        patterns.electricUsageSupply
    ]);
    if (usage !== null) return usage;

    const tableMatch = text.match(patterns.electricUsageTable);
    if (tableMatch && tableMatch[2]) {
        const tableValue = parseNumber(tableMatch[2]);
        if (tableValue !== null) return tableValue;
    }

    return 0;
}

function applySupplyDeliveryFallback(text, billData) {
    const genericSupply = extractAllFloats(text, patterns.genericSupplyTotal);
    const genericDelivery = extractAllFloats(text, patterns.genericDeliveryTotal);

    if (billData.electricDelivery === null && genericDelivery.length >= 1) {
        billData.electricDelivery = genericDelivery[0];
    }
    if (billData.gasDelivery === null && genericDelivery.length >= 2) {
        billData.gasDelivery = genericDelivery[1];
    }

    if (billData.electricSupply === null && genericSupply.length >= 1) {
        if (genericSupply.length >= 2) {
            billData.electricSupply = genericSupply[0];
            if (billData.gasSupply === null) billData.gasSupply = genericSupply[1];
        } else if (billData.gasSupply === null) {
            billData.gasSupply = genericSupply[0];
        }
    } else if (billData.gasSupply === null && genericSupply.length >= 1) {
        billData.gasSupply = genericSupply[0];
    }
}

async function processFiles() {
    const files = fs.readdirSync(htmlDir).filter((f) => f.endsWith('.html'));
    const results = [];

    console.log(`Found ${files.length} HTML files.`);

    for (const file of files) {
        const filePath = path.join(htmlDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(content);

        $('br').replaceWith('\n');
        const text = cleanText($.root().text());

        const billData = {
            filename: file,
            date: extractBillDate(text, file),
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

        if (!billData.date || billData.date < '2017-06-01') {
            continue;
        }

        billData.electricCost = extractElectricCost(text);
        billData.gasCost = extractFirstFloat(text, [patterns.gasCostCombined, patterns.gasCostTotal]) || 0;

        billData.electricUsage = extractElectricUsage(text);
        billData.gasUsage = extractFirstFloat(text, [patterns.gasUsage, patterns.gasUsageAlt]) || 0;

        billData.electricSupply = extractFloat(text, patterns.electricSupplyTotal);
        billData.electricDelivery = extractFloat(text, patterns.electricDeliveryTotal);
        billData.gasSupply = extractFloat(text, patterns.gasSupplyTotal);
        billData.gasDelivery = extractFloat(text, patterns.gasDeliveryTotal);

        if (billData.electricDelivery === null || billData.gasDelivery === null) {
            applySupplyDeliveryFallback(text, billData);
        }

        billData.totalAmountDue = extractFloat(text, patterns.totalAmountDue);
        results.push(billData);
    }

    results.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    fs.writeFileSync(outputJson, JSON.stringify(results, null, 2));
    console.log(`Written JSON to ${outputJson}`);

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
