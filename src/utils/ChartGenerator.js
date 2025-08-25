// debug.js

import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { DateTime } from 'luxon';
import config from '../config.js';

// --- CONFIGURATION ---
const DB_FILE = path.resolve(process.cwd(), config.database.file);
const CHART_OUTPUT_FILE = path.resolve(process.cwd(), 'chart.html');
const ANALYSIS_DATA_FILE = path.resolve(process.cwd(), 'analysis_data.json'); // --- ADDED ---
const CANDLE_INTERVAL_MINUTES = 5;

/**
 * Main function to generate the chart
 */
async function generateChart() {
    console.log(`Connecting to database at: ${DB_FILE}`);
    let db;
    try {
        db = await open({ filename: DB_FILE, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    } catch (error) {
        console.error(`\n❌ ERROR: Could not open the database file at "${DB_FILE}".`);
        return;
    }

    console.log('Fetching price and event data...');
    const priceData = await db.all('SELECT timestamp, price FROM prices ORDER BY timestamp ASC');
    const eventData = await db.all('SELECT timestamp, event_type, details FROM events ORDER BY timestamp ASC');
    await db.close();

    if (priceData.length === 0) {
        console.error('No price data found in the database.');
        return;
    }

    console.log(`Processing ${priceData.length} price points into ${CANDLE_INTERVAL_MINUTES}-minute candles...`);
    const ohlcData = resampleToOHLC(priceData);

    // --- MODIFIED: Read analysis data from JSON file ---
    console.log('Reading full analysis data from JSON...');
    let analysisData = [];
    try {
        const rawData = fs.readFileSync(ANALYSIS_DATA_FILE, 'utf-8');
        analysisData = JSON.parse(rawData);
    } catch (err) {
        console.warn(`\n⚠️ WARNING: Could not read ${ANALYSIS_DATA_FILE}. Chart will not have analysis lines.`);
        console.warn('   Run the main bot once to generate this file.');
    }

    // --- MODIFIED: Prepare analysis lines for the chart ---
    const wmaFib0Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_0
    })).filter(d => d.value);

    const wmaFib50Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_50
    })).filter(d => d.value);

    const eventMarkers = extractMarkersFromEvents(eventData);

    console.log('Generating chart HTML...');
    const chartHtml = createChartHtml(ohlcData, eventMarkers, wmaFib0Data, wmaFib50Data);

    fs.writeFileSync(CHART_OUTPUT_FILE, chartHtml);
    console.log(`\n✅ Chart generated successfully! Open "${path.basename(CHART_OUTPUT_FILE)}" in your browser.`);
}

/**
 * Resamples raw price ticks into OHLC candles.
 */
function resampleToOHLC(data) {
    // This function remains the same as before
    const grouped = {};
    data.forEach(d => {
        const dt = DateTime.fromISO(d.timestamp);
        const minute = dt.minute - (dt.minute % CANDLE_INTERVAL_MINUTES);
        const key = dt.set({ minute, second: 0, millisecond: 0 }).toISO();

        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(d.price);
    });

    return Object.keys(grouped).map(key => {
        const prices = grouped[key];
        return {
            time: Math.floor(DateTime.fromISO(key).toSeconds()),
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices[prices.length - 1],
        };
    }).sort((a, b) => a.time - b.time);
}

/**
 * Extracts ONLY trade markers from the 'events' table.
 */
function extractMarkersFromEvents(events) {
    const eventMarkers = [];
    events.forEach(event => {
        if (['TRIGGER_ARMED', 'TRADE_EXECUTED', 'STOP_LOSS_HIT', 'TAKE_PROFIT_HIT'].includes(event.event_type)) {
            eventMarkers.push({
                time: Math.floor(DateTime.fromISO(event.timestamp).toSeconds()),
                position: 'aboveBar',
                color: event.event_type === 'TRADE_EXECUTED' ? '#2196F3' : '#e91e63',
                shape: 'arrowDown',
                text: event.event_type.replace(/_/g, ' ').substring(0, 5)
            });
        }
    });
    return eventMarkers;
}

/**
 * Uses JSDOM and Lightweight Charts to create an HTML string of the chart.
 */
function createChartHtml(ohlcData, eventMarkers, wmaFib0Data, wmaFib50Data) {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Trading Bot Chart</title>
            <style>
                body { margin: 0; padding: 0; background-color: #1a1e26; color: white; font-family: sans-serif; }
                h1 { margin: 20px; }
            </style>
        </head>
        <body>
            <h1>Trading Bot Analysis Chart</h1>
            <div id="chart-container" style="position: absolute; top: 80px; left: 20px; right: 20px; bottom: 20px;"></div>
            <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
        </body>
        </html>`, { runScripts: "outside-only" });

    const { window } = dom;

    const script = `
        try {
            const chartElement = document.getElementById('chart-container');
            const chart = LightweightCharts.createChart(chartElement, {
                width: chartElement.clientWidth,
                height: chartElement.clientHeight,
                layout: { textColor: 'white', background: { type: 'solid', color: '#1a1e26' } },
                grid: { vertLines: { color: '#2e333e' }, horzLines: { color: '#2e333e' } },
                timeScale: { timeVisible: true, secondsVisible: false },
            });

            const candleSeries = chart.addCandlestickSeries({
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
                wickUpColor: '#26a69a', wickDownColor: '#ef5350'
            });
            candleSeries.setData(${JSON.stringify(ohlcData)});

            if (${wmaFib0Data.length > 0}) {
                const wma0Series = chart.addLineSeries({ color: '#ffc107', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid });
                wma0Series.setData(${JSON.stringify(wmaFib0Data)});
            }

            if (${wmaFib50Data.length > 0}) {
                const wma50Series = chart.addLineSeries({ color: '#2962FF', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed });
                wma50Series.setData(${JSON.stringify(wmaFib50Data)});
            }

            if (${eventMarkers.length > 0}) {
                candleSeries.setMarkers(${JSON.stringify(eventMarkers)});
            }
            
            chart.timeScale().fitContent();
            window.addEventListener('resize', () => {
                chart.resize(chartElement.clientWidth, chartElement.clientHeight);
            });
        } catch (e) {
            alert('An error occurred while rendering the chart: ' + e.message);
        }
    `;

    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = script;
    window.document.body.appendChild(scriptEl);

    return dom.serialize();
}

// --- Run the generator ---
generateChart().catch(err => console.error(err));