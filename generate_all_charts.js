// generate_all_charts.js - Generate charts for all configured tokens
import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { DateTime } from 'luxon';
import multiConfig from './multi.config.js';

const CANDLE_INTERVAL_MINUTES = 5;

/**
 * Generate chart for a specific token
 */
async function generateTokenChart(tokenSymbol, tokenConfig) {
    console.log(`\n🎯 [${tokenSymbol}] Generating chart...`);
    
    const dbFile = path.resolve(process.cwd(), `${tokenConfig.dataDir}/${tokenSymbol}_bot.db`);
    const chartOutputFile = path.resolve(process.cwd(), `chart_${tokenSymbol.toLowerCase()}.html`);
    const analysisDataFile = path.resolve(process.cwd(), `${tokenConfig.dataDir}/live_analysis.json`);
    
    // Check if database exists
    try {
        await fs.access(dbFile);
    } catch (error) {
        console.log(`⚠️  [${tokenSymbol}] Database not found at ${dbFile} - skipping`);
        return { success: false, reason: 'No database file' };
    }

    let db;
    try {
        db = await open({ filename: dbFile, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
        console.log(`✅ [${tokenSymbol}] Connected to database`);
    } catch (error) {
        console.error(`❌ [${tokenSymbol}] Could not open database: ${error.message}`);
        return { success: false, reason: 'Database connection failed' };
    }

    // Fetch data
    const priceData = await db.all('SELECT timestamp, price FROM prices ORDER BY timestamp DESC LIMIT 2000');
    const eventData = await db.all('SELECT timestamp, event_type, details FROM events ORDER BY timestamp DESC LIMIT 100');
    await db.close();

    if (priceData.length === 0) {
        console.log(`⚠️  [${tokenSymbol}] No price data found - skipping`);
        return { success: false, reason: 'No price data' };
    }

    console.log(`📊 [${tokenSymbol}] Processing ${priceData.length} price points...`);
    
    // Reverse data to get chronological order
    priceData.reverse();
    eventData.reverse();
    
    const ohlcData = resampleToOHLC(priceData);

    // Read analysis data if available
    let analysisData = [];
    try {
        const rawData = await fs.readFile(analysisDataFile, 'utf-8');
        const singleAnalysis = JSON.parse(rawData);
        // Convert single analysis to array format
        if (singleAnalysis.timestamp) {
            analysisData = [singleAnalysis];
        }
    } catch (err) {
        console.log(`⚠️  [${tokenSymbol}] No live analysis data available`);
    }

    // Process analysis data
    const wmaFib0Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_0
    })).filter(d => d.value);

    const wmaFib50Data = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.wma_fib_50
    })).filter(d => d.value);

    const fibEntryData = analysisData.map(d => ({
        time: Math.floor(new Date(d.timestamp).getTime() / 1000),
        value: d.fib_entry
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

    console.log(`📈 [${tokenSymbol}] Generating chart HTML...`);
    const chartHtml = createChartHtml(
        tokenSymbol, 
        ohlcData, 
        eventMarkers, 
        wmaFib0Data, 
        wmaFib50Data, 
        fibEntryData,
        stochRSIKData, 
        stochRSIDData,
        tokenConfig.color
    );

    await fs.writeFile(chartOutputFile, chartHtml);
    console.log(`✅ [${tokenSymbol}] Chart saved to ${chartOutputFile}`);
    
    return { success: true, file: chartOutputFile, dataPoints: priceData.length };
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

function extractMarkersFromEvents(events) {
    return events.filter(event => ['TRADE_EXECUTED', 'FIB_STOP_HIT', 'TAKE_PROFIT_HIT', 'STOP-LOSS HIT', 'TRADE_BLOCKED'].includes(event.event_type))
        .map(event => ({
            time: Math.floor(DateTime.fromISO(event.timestamp).toSeconds()),
            position: 'aboveBar',
            color: getEventColor(event.event_type),
            shape: getEventShape(event.event_type),
            text: event.event_type.replace(/_/g, ' ').substring(0, 8)
        }));
}

function getEventColor(eventType) {
    switch (eventType) {
        case 'TRADE_EXECUTED': return '#2196F3'; // Blue
        case 'TAKE_PROFIT_HIT': return '#4CAF50'; // Green
        case 'FIB_STOP_HIT': return '#FF9800'; // Orange
        case 'STOP-LOSS HIT': return '#f44336'; // Red
        case 'TRADE_BLOCKED': return '#9C27B0'; // Purple
        default: return '#757575'; // Gray
    }
}

function getEventShape(eventType) {
    switch (eventType) {
        case 'TRADE_EXECUTED': return 'arrowUp';
        case 'TAKE_PROFIT_HIT': return 'circle';
        case 'TRADE_BLOCKED': return 'square';
        default: return 'arrowDown';
    }
}

function createChartHtml(tokenSymbol, ohlcData, eventMarkers, wmaFib0Data, wmaFib50Data, fibEntryData, stochRSIKData, stochRSIDData, tokenColor) {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${tokenSymbol} Trading Bot Chart</title>
            <style>
                body { 
                    margin: 0; 
                    padding: 20px; 
                    background-color: #0f1419; 
                    color: #d1d4dc; 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; 
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .token-title {
                    font-size: 24px;
                    font-weight: bold;
                    color: #${tokenColor.toString(16).padStart(6, '0')};
                    margin-bottom: 10px;
                }
                .stats {
                    display: flex;
                    justify-content: center;
                    gap: 30px;
                    margin-bottom: 20px;
                    font-size: 14px;
                    color: #888;
                }
                #chart-container { 
                    position: relative; 
                    width: 1400px; 
                    height: 800px; 
                    margin: 0 auto;
                    border: 1px solid #2e333e;
                    border-radius: 8px;
                }
                .legend {
                    display: flex;
                    justify-content: center;
                    gap: 20px;
                    margin-top: 15px;
                    font-size: 12px;
                }
                .legend-item {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .legend-color {
                    width: 12px;
                    height: 2px;
                    border-radius: 1px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="token-title">${tokenSymbol} Trading Analysis</div>
                <div class="stats">
                    <span>📊 ${ohlcData.length} Candles</span>
                    <span>🎯 ${eventMarkers.length} Events</span>
                    <span>⏱️ ${CANDLE_INTERVAL_MINUTES}min Timeframe</span>
                </div>
            </div>
            <div id="chart-container"></div>
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #ffc107;"></div>
                    <span>Fib 0% (WMA)</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #2962FF;"></div>
                    <span>Fib 50%</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #e91e63;"></div>
                    <span>Fib Entry</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #2196F3;"></div>
                    <span>Stoch K</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #FF6D00;"></div>
                    <span>Stoch D</span>
                </div>
            </div>
            <script src="https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js"></script>
        </body>
        </html>`, { runScripts: "outside-only" });

    const { window } = dom;

    const script = `
        try {
            const chartElement = document.getElementById('chart-container');
            const chart = LightweightCharts.createChart(chartElement, {
                width: 1400,
                height: 800,
                layout: { textColor: 'white', background: { type: 'solid', color: '#0f1419' } },
                grid: { vertLines: { color: '#2e333e' }, horzLines: { color: '#2e333e' } },
                timeScale: { timeVisible: true, secondsVisible: false },
                rightPriceScale: { borderVisible: false },
                leftPriceScale: { visible: false },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
            });

            // Main candlestick series
            const candleSeries = chart.addCandlestickSeries({
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350'
            });
            candleSeries.setData(${JSON.stringify(ohlcData)});

            // Fibonacci levels
            if (${wmaFib0Data.length > 0}) {
                const wma0Series = chart.addLineSeries({ 
                    color: '#ffc107', 
                    lineWidth: 2, 
                    priceScaleId: 'right',
                    title: 'Fib 0% (Bounce Level)'
                });
                wma0Series.setData(${JSON.stringify(wmaFib0Data)});
            }

            if (${wmaFib50Data.length > 0}) {
                const wma50Series = chart.addLineSeries({ 
                    color: '#2962FF', 
                    lineWidth: 2, 
                    lineStyle: LightweightCharts.LineStyle.Dashed, 
                    priceScaleId: 'right',
                    title: 'Fib 50%'
                });
                wma50Series.setData(${JSON.stringify(wmaFib50Data)});
            }

            if (${fibEntryData.length > 0}) {
                const fibEntrySeries = chart.addLineSeries({ 
                    color: '#e91e63', 
                    lineWidth: 2, 
                    lineStyle: LightweightCharts.LineStyle.Dotted, 
                    priceScaleId: 'right',
                    title: 'Fib Entry (Arm Trigger)'
                });
                fibEntrySeries.setData(${JSON.stringify(fibEntryData)});
            }

            // Event markers
            if (${eventMarkers.length > 0}) {
                candleSeries.setMarkers(${JSON.stringify(eventMarkers)});
            }

            // Stochastic RSI in separate pane
            if (${stochRSIKData.length > 0}) {
                chart.priceScale('stoch_rsi').applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0.05 },
                    borderVisible: false,
                });

                const stochRSIKSeries = chart.addLineSeries({ 
                    color: '#2196F3', 
                    lineWidth: 2, 
                    priceScaleId: 'stoch_rsi',
                    title: 'Stoch RSI K'
                });
                stochRSIKSeries.setData(${JSON.stringify(stochRSIKData)});

                if (${stochRSIDData.length > 0}) {
                    const stochRSIDSeries = chart.addLineSeries({ 
                        color: '#FF6D00', 
                        lineWidth: 2, 
                        lineStyle: LightweightCharts.LineStyle.Dashed, 
                        priceScaleId: 'stoch_rsi',
                        title: 'Stoch RSI D'
                    });
                    stochRSIDSeries.setData(${JSON.stringify(stochRSIDData)});
                }

                // Add overbought/oversold lines
                const overboughtLine = chart.addLineSeries({
                    color: '#ff4444',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dotted,
                    priceScaleId: 'stoch_rsi'
                });
                overboughtLine.setData([
                    { time: ${ohlcData[0]?.time || 0}, value: 80 },
                    { time: ${ohlcData[ohlcData.length - 1]?.time || 0}, value: 80 }
                ]);

                const oversoldLine = chart.addLineSeries({
                    color: '#44ff44',
                    lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dotted,
                    priceScaleId: 'stoch_rsi'
                });
                oversoldLine.setData([
                    { time: ${ohlcData[0]?.time || 0}, value: 20 },
                    { time: ${ohlcData[ohlcData.length - 1]?.time || 0}, value: 20 }
                ]);
            }

            chart.timeScale().fitContent();
            
        } catch (e) {
            console.error('Error rendering chart:', e);
            document.body.innerHTML = '<h2 style="color: red;">Error: ' + e.message + '</h2>';
        }
    `;

    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = script;
    window.document.body.appendChild(scriptEl);

    return dom.serialize();
}

// Main function to generate charts for all tokens
async function generateAllCharts() {
    console.log('🚀 Generating charts for all configured tokens...');
    console.log('=' .repeat(50));

    const results = [];
    
    // Get all tokens (both enabled and disabled)
    const tokens = Object.entries(multiConfig.tokens);
    
    for (const [tokenSymbol, tokenConfig] of tokens) {
        const result = await generateTokenChart(tokenSymbol, tokenConfig);
        results.push({ token: tokenSymbol, ...result });
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 CHART GENERATION SUMMARY:');
    console.log('='.repeat(50));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    successful.forEach(r => {
        console.log(`✅ ${r.token}: ${r.file} (${r.dataPoints} data points)`);
    });

    failed.forEach(r => {
        console.log(`❌ ${r.token}: ${r.reason}`);
    });

    console.log(`\n🎯 Successfully generated ${successful.length}/${results.length} charts`);
    
    if (successful.length > 0) {
        console.log('\n💡 Open the HTML files in your browser to view the charts!');
    }
}

// Run the generator
generateAllCharts()
    .catch(err => {
        console.error('❌ Error generating charts:', err);
        process.exit(1);
    })
    .finally(() => {
        console.log('\n✅ Chart generation complete!');
        process.exit(0);
    });