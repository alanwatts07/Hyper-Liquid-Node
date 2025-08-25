// src/utils/ChartGenerator.js

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
const ANALYSIS_DATA_FILE = path.resolve(process.cwd(), 'analysis_data.json');
const CANDLE_INTERVAL_MINUTES = 5;

/**
 * Main function to generate the chart
 */
async function generateChart() {
    console.log(`[ChartGenerator] Connecting to database at: ${DB_FILE}`);
    let db;
    try {
        db = await open({ filename: DB_FILE, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
    } catch (error) {
        console.error(`\n[ChartGenerator] ❌ ERROR: Could not open the database file at "${DB_FILE}".`);
        return;
    }

    console.log('[ChartGenerator] Fetching price and event data...');
    const priceData = await db.all('SELECT timestamp, price FROM prices ORDER BY timestamp ASC');
    const eventData = await db.all('SELECT timestamp, event_type, details FROM events ORDER BY timestamp ASC');
    await db.close();

    if (priceData.length === 0) {
        console.error('[ChartGenerator] No price data found in the database.');
        return;
    }

    console.log(`[ChartGenerator] Processing ${priceData.length} price points...`);
    const ohlcData = resampleToOHLC(priceData);

    console.log('[ChartGenerator] Reading full analysis data from JSON...');
    let analysisData = [];
    try {
        const rawData = fs.readFileSync(ANALYSIS_DATA_FILE, 'utf-8');
        analysisData = JSON.parse(rawData);
    } catch (err) {
        console.warn(`\n[ChartGenerator] ⚠️ WARNING: Could not read ${ANALYSIS_DATA_FILE}.`);
    }

    const wmaFib0Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_0
    })).filter(d => d.value);

    const wmaFib50Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_50
    })).filter(d => d.value);

    const stochRSIKData = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.stoch_rsi ? d.stoch_rsi.k : null
    })).filter(d => d.value);

    const stochRSIDData = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.stoch_rsi ? d.stoch_rsi.d : null
    })).filter(d => d.value);

    const eventMarkers = extractMarkersFromEvents(eventData);

    console.log('[ChartGenerator] Generating chart HTML...');
    const chartHtml = createChartHtml(ohlcData, eventMarkers, wmaFib0Data, wmaFib50Data, stochRSIKData, stochRSIDData);

    fs.writeFileSync(CHART_OUTPUT_FILE, chartHtml);
    console.log(`\n[ChartGenerator] ✅ Chart generated successfully!`);
}

function resampleToOHLC(data) {
    const grouped = {};
    data.forEach(d => {
        const dt = DateTime.fromISO(d.timestamp);
        const minute = dt.minute - (dt.minute % CANDLE_INTERVAL_MINUTES);
        const key = dt.set({ minute, second: 0, millisecond: 0 }).toISO();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(d.price);
    });
    // --- THIS IS THE CORRECTED BLOCK ---
    return Object.keys(grouped).map(key => {
        const prices = grouped[key]; // <-- This line was missing
        return {
            time: Math.floor(DateTime.fromISO(key).toSeconds()),
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices[prices.length - 1],
        };
    }).sort((a, b) => a.time - b.time);
}

function extractMarkersFromEvents(events) {
    return events.filter(event => ['TRADE_EXECUTED', 'FIB_STOP_HIT', 'TAKE_PROFIT_HIT', 'STOP-LOSS HIT'].includes(event.event_type))
        .map(event => ({
            time: Math.floor(DateTime.fromISO(event.timestamp).toSeconds()),
            position: 'aboveBar',
            color: event.event_type === 'TRADE_EXECUTED' ? '#2196F3' : '#e91e63',
            shape: 'arrowDown',
            text: event.event_type.replace(/_/g, ' ').substring(0, 5)
        }));
}

function createChartHtml(ohlcData, eventMarkers, wmaFib0Data, wmaFib50Data, stochRSIKData, stochRSIDData) {
     const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Trading Bot Chart</title>
            <style>
                body { margin: 0; padding: 0; background-color: #1a1e26; color: #d1d4dc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; }
                #chart-container { position: relative; width: 1200px; height: 750px; }
            </style>
        </head>
        <body>
            <div id="chart-container"></div>
            <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
        </body>
        </html>`, { runScripts: "outside-only" });

    const { window } = dom;

    const script = `
        try {
            const chartElement = document.getElementById('chart-container');
            const chart = LightweightCharts.createChart(chartElement, {
                width: 1200,
                height: 750,
                layout: { textColor: 'white', background: { type: 'solid', color: '#1a1e26' } },
                grid: { vertLines: { color: '#2e333e' }, horzLines: { color: '#2e333e' } },
                timeScale: { timeVisible: true, secondsVisible: false },
            });
            const candleSeries = chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350'
            });
            candleSeries.setData(${JSON.stringify(ohlcData)});
            if (${wmaFib0Data.length > 0}) {
                const wma0Series = chart.addLineSeries({ color: '#ffc107', lineWidth: 2, priceScaleId: 'right' });
                wma0Series.setData(${JSON.stringify(wmaFib0Data)});
            }
            if (${wmaFib50Data.length > 0}) {
                const wma50Series = chart.addLineSeries({ color: '#2962FF', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, priceScaleId: 'right' });
                wma50Series.setData(${JSON.stringify(wmaFib50Data)});
            }
            if (${eventMarkers.length > 0}) {
                candleSeries.setMarkers(${JSON.stringify(eventMarkers)});
            }

            if (${stochRSIKData.length > 0}) {
                const stochRsiPane = chart.addHistogramSeries({
                    priceFormat: {
                        type: 'volume',
                    },
                    priceScaleId: 'stoch_rsi',
                    lastValueVisible: false,
                    priceLineVisible: false,
                });
                
                chart.priceScale('stoch_rsi').applyOptions({
                    scaleMargins: {
                        top: 0.8,
                        bottom: 0,
                    },
                });

                const stochRSIKSeries = chart.addLineSeries({ color: '#2962FF', lineWidth: 2, priceScaleId: 'stoch_rsi' });
                stochRSIKSeries.setData(${JSON.stringify(stochRSIKData)});

                const stochRSIDSeries = chart.addLineSeries({ color: '#FF6D00', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, priceScaleId: 'stoch_rsi' });
                stochRSIDSeries.setData(${JSON.stringify(stochRSIDData)});
            }


            chart.timeScale().fitContent();
        } catch (e) {
            console.error('Error rendering chart script:', e);
        }
    `;

    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = script;
    window.document.body.appendChild(scriptEl);

    return dom.serialize();
}

// --- Run the generator and exit ---
generateChart()
    .catch(err => console.error(err))
    .finally(() => process.exit(0));