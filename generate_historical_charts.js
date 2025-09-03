// generate_historical_charts.js - Generate charts with full historical EMA calculations
import fs from 'fs/promises';
import path from 'path';
import { JSDOM } from 'jsdom';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { DateTime } from 'luxon';
import multiConfig from './multi.config.js';

const CANDLE_INTERVAL_MINUTES = 5;

// Technical Analysis functions (copied from TechnicalAnalyzer.js)
function simpleMovingAverage(data, windowSize) {
    let result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < windowSize - 1) {
            result.push(NaN);
        } else {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                sum += data[i - j];
            }
            result.push(sum / windowSize);
        }
    }
    return result;
}

function exponentialMovingAverage(data, period) {
    const multiplier = 2 / (period + 1);
    let result = [];
    
    for (let i = 0; i < data.length; i++) {
        if (isNaN(data[i])) {
            result.push(NaN);
            continue;
        }
        
        if (i === 0 || isNaN(result[i - 1])) {
            result.push(data[i]);
        } else {
            const ema = (data[i] * multiplier) + (result[i - 1] * (1 - multiplier));
            result.push(ema);
        }
    }
    
    return result;
}

function resampleToOHLC(historicalData) {
    const grouped = {};
    historicalData.forEach(d => {
        const dt = DateTime.fromISO(d.timestamp);
        const minute = dt.minute - (dt.minute % 5);
        const key = dt.set({ minute, second: 0, millisecond: 0 }).toISO();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(d.price);
    });

    const ohlcData = Object.keys(grouped).map(key => {
        const prices = grouped[key];
        return {
            timestamp: key,
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices[prices.length - 1],
        };
    });

    if (ohlcData.length === 0) return [];
    return ohlcData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Calculate full historical technical analysis
function calculateHistoricalAnalysis(ohlcData, config) {
    const fibLookback = config.fibLookback || 42;
    const wmaPeriod = config.wmaPeriod || 3;
    const fibEntryOffsetPct = config.fibEntryOffsetPct || 0.0025;

    console.log(`📊 Calculating historical analysis: ${ohlcData.length} candles, ${fibLookback} lookback, ${wmaPeriod} EMA period`);

    let highestHighs = [];
    let lowestLows = [];
    const closes = ohlcData.map(c => c.close);

    // Calculate Fibonacci levels for each candle
    for (let i = 0; i < ohlcData.length; i++) {
        // Calculate Highest High over lookback period
        if (i < fibLookback - 1) {
            highestHighs.push(NaN);
        } else {
            let max = 0;
            for (let j = 0; j < fibLookback; j++) {
                if (ohlcData[i - j].high > max) {
                    max = ohlcData[i - j].high;
                }
            }
            highestHighs.push(max);
        }

        // Calculate Lowest Low over lookback period
        if (i < fibLookback - 1) {
            lowestLows.push(NaN);
        } else {
            let min = Infinity;
            for (let j = 0; j < fibLookback; j++) {
                if (ohlcData[i - j].low < min) {
                    min = ohlcData[i - j].low;
                }
            }
            lowestLows.push(min);
        }
    }

    // Calculate EMAs and other levels
    const wma_fib_0_values = exponentialMovingAverage(lowestLows, wmaPeriod);
    const fib_50_range = highestHighs.map((h, i) => (h - lowestLows[i]) * 0.5);
    const fib_50_base = highestHighs.map((h, i) => h - fib_50_range[i]);
    const wma_fib_50_values = simpleMovingAverage(fib_50_base, wmaPeriod);
    
    // Calculate fib_entry levels
    const fib_entry_values = wma_fib_0_values.map(val => val * (1 - fibEntryOffsetPct));

    // Combine results
    const results = [];
    for (let i = 0; i < ohlcData.length; i++) {
        results.push({
            timestamp: ohlcData[i].timestamp,
            time: Math.floor(DateTime.fromISO(ohlcData[i].timestamp).toSeconds()),
            open: ohlcData[i].open,
            high: ohlcData[i].high,
            low: ohlcData[i].low,
            close: ohlcData[i].close,
            wma_fib_0: wma_fib_0_values[i],
            wma_fib_50: wma_fib_50_values[i],
            fib_entry: fib_entry_values[i]
        });
    }

    console.log(`✅ Historical analysis complete: ${results.filter(r => !isNaN(r.wma_fib_0)).length} valid data points`);
    return results;
}

/**
 * Generate enhanced chart for a specific token with historical calculations
 */
async function generateTokenChart(tokenSymbol, tokenConfig) {
    console.log(`\n🎯 [${tokenSymbol}] Generating historical chart...`);
    
    const dbFile = path.resolve(process.cwd(), `${tokenConfig.dataDir}/${tokenSymbol}_bot.db`);
    const chartOutputFile = path.resolve(process.cwd(), `historical_chart_${tokenSymbol.toLowerCase()}.html`);
    
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

    // Fetch MORE data for better historical analysis
    const priceData = await db.all('SELECT timestamp, price FROM prices ORDER BY timestamp DESC LIMIT 5000');
    const eventData = await db.all('SELECT timestamp, event_type, details FROM events ORDER BY timestamp DESC LIMIT 200');
    await db.close();

    if (priceData.length === 0) {
        console.log(`⚠️  [${tokenSymbol}] No price data found - skipping`);
        return { success: false, reason: 'No price data' };
    }

    console.log(`📊 [${tokenSymbol}] Processing ${priceData.length} price points...`);
    
    // Reverse to get chronological order
    priceData.reverse();
    eventData.reverse();
    
    // Resample to OHLC
    const ohlcData = resampleToOHLC(priceData);
    console.log(`📈 [${tokenSymbol}] Generated ${ohlcData.length} OHLC candles`);

    if (ohlcData.length < 50) {
        console.log(`⚠️  [${tokenSymbol}] Not enough OHLC data (${ohlcData.length} candles) - skipping`);
        return { success: false, reason: 'Insufficient OHLC data' };
    }

    // Load token-specific config for TA parameters
    let taConfig = {
        fibLookback: 42,
        wmaPeriod: 3,
        fibEntryOffsetPct: 0.0025
    };

    try {
        const configModule = await import(`./configs/${tokenSymbol}.config.js`);
        const tokenSpecificConfig = configModule.default;
        if (tokenSpecificConfig.ta) {
            taConfig = { ...taConfig, ...tokenSpecificConfig.ta };
        }
        console.log(`📝 [${tokenSymbol}] Using TA config: ${JSON.stringify(taConfig)}`);
    } catch (error) {
        console.log(`⚠️  [${tokenSymbol}] Could not load config, using defaults`);
    }

    // Calculate historical technical analysis
    const analysisResults = calculateHistoricalAnalysis(ohlcData, taConfig);

    // Filter to only complete analysis (last 80% of data to avoid initial NaN values)
    const startIndex = Math.floor(analysisResults.length * 0.2);
    const validAnalysis = analysisResults.slice(startIndex);
    
    console.log(`🔍 [${tokenSymbol}] Using ${validAnalysis.length} valid analysis points (filtered from ${analysisResults.length})`);

    // Prepare chart data
    const chartOhlcData = validAnalysis.map(d => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
    }));

    const wmaFib0Data = validAnalysis
        .filter(d => !isNaN(d.wma_fib_0))
        .map(d => ({ time: d.time, value: d.wma_fib_0 }));

    const wmaFib50Data = validAnalysis
        .filter(d => !isNaN(d.wma_fib_50))
        .map(d => ({ time: d.time, value: d.wma_fib_50 }));

    const fibEntryData = validAnalysis
        .filter(d => !isNaN(d.fib_entry))
        .map(d => ({ time: d.time, value: d.fib_entry }));

    const eventMarkers = extractMarkersFromEvents(eventData);

    console.log(`📈 [${tokenSymbol}] Chart data prepared:
    📊 OHLC: ${chartOhlcData.length} candles
    🟡 Fib 0% EMA: ${wmaFib0Data.length} points
    🔵 Fib 50%: ${wmaFib50Data.length} points  
    🟣 Fib Entry: ${fibEntryData.length} points
    🎯 Events: ${eventMarkers.length} markers`);

    // Generate chart HTML
    const chartHtml = createEnhancedChartHtml(
        tokenSymbol, 
        chartOhlcData,
        wmaFib0Data, 
        wmaFib50Data, 
        fibEntryData,
        eventMarkers,
        tokenConfig.color,
        taConfig
    );

    await fs.writeFile(chartOutputFile, chartHtml);
    console.log(`✅ [${tokenSymbol}] Historical chart saved to ${chartOutputFile}`);
    
    return { 
        success: true, 
        file: chartOutputFile, 
        dataPoints: priceData.length,
        ohlcCandles: ohlcData.length,
        fibPoints: wmaFib0Data.length,
        config: taConfig
    };
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

function createEnhancedChartHtml(tokenSymbol, ohlcData, wmaFib0Data, wmaFib50Data, fibEntryData, eventMarkers, tokenColor, taConfig) {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${tokenSymbol} Historical Trading Analysis</title>
            <style>
                body { 
                    margin: 0; 
                    padding: 20px; 
                    background: linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%);
                    color: #e1e4e8; 
                    font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    min-height: 100vh;
                }
                .container {
                    max-width: 1600px;
                    margin: 0 auto;
                }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    background: rgba(255, 255, 255, 0.05);
                    padding: 25px;
                    border-radius: 12px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                .token-title {
                    font-size: 32px;
                    font-weight: 700;
                    color: #${tokenColor.toString(16).padStart(6, '0')};
                    margin-bottom: 15px;
                    text-shadow: 0 0 20px rgba(${parseInt(tokenColor.toString(16).substr(0,2), 16)}, ${parseInt(tokenColor.toString(16).substr(2,2), 16)}, ${parseInt(tokenColor.toString(16).substr(4,2), 16)}, 0.3);
                }
                .subtitle {
                    font-size: 18px;
                    color: #8b949e;
                    margin-bottom: 20px;
                }
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 25px;
                }
                .stat-item {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 15px;
                    border-radius: 8px;
                    text-align: center;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                .stat-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #${tokenColor.toString(16).padStart(6, '0')};
                }
                .stat-label {
                    font-size: 12px;
                    color: #8b949e;
                    margin-top: 5px;
                }
                #chart-container { 
                    width: 100%; 
                    height: 850px; 
                    margin: 0 auto;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 12px;
                    background: rgba(0, 0, 0, 0.3);
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                }
                .legend {
                    display: flex;
                    justify-content: center;
                    flex-wrap: wrap;
                    gap: 25px;
                    margin-top: 20px;
                    padding: 20px;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                }
                .legend-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                }
                .legend-color {
                    width: 16px;
                    height: 3px;
                    border-radius: 2px;
                    box-shadow: 0 0 8px currentColor;
                }
                .config-info {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 15px;
                    border-radius: 8px;
                    margin-top: 20px;
                    font-size: 12px;
                    color: #8b949e;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="token-title">${tokenSymbol}</div>
                    <div class="subtitle">Historical Fibonacci Trading Analysis</div>
                    <div class="stats">
                        <div class="stat-item">
                            <div class="stat-value">${ohlcData.length}</div>
                            <div class="stat-label">OHLC Candles</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${wmaFib0Data.length}</div>
                            <div class="stat-label">Fib 0% Points</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${eventMarkers.length}</div>
                            <div class="stat-label">Trading Events</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${CANDLE_INTERVAL_MINUTES}m</div>
                            <div class="stat-label">Timeframe</div>
                        </div>
                    </div>
                </div>
                
                <div id="chart-container"></div>
                
                <div class="legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #ffc107; color: #ffc107;"></div>
                        <span><strong>Fib 0% EMA</strong> - Dynamic bounce level (${taConfig.wmaPeriod}-period EMA of ${taConfig.fibLookback}-bar lows)</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #2962FF; color: #2962FF;"></div>
                        <span><strong>Fib 50%</strong> - Mid-range retracement level (${taConfig.wmaPeriod}-period SMA)</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #e91e63; color: #e91e63;"></div>
                        <span><strong>Entry Level</strong> - Trigger arm threshold (${(taConfig.fibEntryOffsetPct * 100).toFixed(3)}% below Fib 0%)</span>
                    </div>
                </div>
                
                <div class="config-info">
                    Configuration: ${taConfig.fibLookback}-period Fibonacci lookback • ${taConfig.wmaPeriod}-period EMA smoothing • ${(taConfig.fibEntryOffsetPct * 100).toFixed(3)}% entry offset
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
                width: chartElement.clientWidth,
                height: 850,
                layout: { 
                    textColor: '#e1e4e8', 
                    background: { type: 'solid', color: 'transparent' },
                    fontSize: 12
                },
                grid: { 
                    vertLines: { color: 'rgba(255, 255, 255, 0.1)' }, 
                    horzLines: { color: 'rgba(255, 255, 255, 0.1)' } 
                },
                timeScale: { 
                    timeVisible: true, 
                    secondsVisible: false,
                    borderColor: 'rgba(255, 255, 255, 0.2)'
                },
                rightPriceScale: { 
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    textColor: '#e1e4e8'
                },
                crosshair: { 
                    mode: LightweightCharts.CrosshairMode.Normal,
                    vertLine: { color: 'rgba(255, 255, 255, 0.5)' },
                    horzLine: { color: 'rgba(255, 255, 255, 0.5)' }
                },
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true,
                }
            });

            // Main candlestick series
            const candleSeries = chart.addCandlestickSeries({
                upColor: '#00d4aa',
                downColor: '#fb4570',
                borderVisible: false,
                wickUpColor: '#00d4aa',
                wickDownColor: '#fb4570',
                borderUpColor: '#00d4aa',
                borderDownColor: '#fb4570',
                wickUpColor: '#00d4aa',
                wickDownColor: '#fb4570'
            });
            candleSeries.setData(${JSON.stringify(ohlcData)});

            // Fibonacci 0% EMA (main bounce level)
            if (${wmaFib0Data.length > 0}) {
                const fib0Series = chart.addLineSeries({ 
                    color: '#ffc107', 
                    lineWidth: 3, 
                    priceScaleId: 'right',
                    title: 'Fib 0% EMA (Bounce Level)',
                    lastValueVisible: true,
                    priceLineVisible: true
                });
                fib0Series.setData(${JSON.stringify(wmaFib0Data)});
            }

            // Fibonacci 50% level
            if (${wmaFib50Data.length > 0}) {
                const fib50Series = chart.addLineSeries({ 
                    color: '#2962FF', 
                    lineWidth: 2, 
                    lineStyle: LightweightCharts.LineStyle.Dashed, 
                    priceScaleId: 'right',
                    title: 'Fib 50%'
                });
                fib50Series.setData(${JSON.stringify(wmaFib50Data)});
            }

            // Entry trigger level
            if (${fibEntryData.length > 0}) {
                const fibEntrySeries = chart.addLineSeries({ 
                    color: '#e91e63', 
                    lineWidth: 2, 
                    lineStyle: LightweightCharts.LineStyle.Dotted, 
                    priceScaleId: 'right',
                    title: 'Entry Trigger Level'
                });
                fibEntrySeries.setData(${JSON.stringify(fibEntryData)});
            }

            // Event markers
            if (${eventMarkers.length > 0}) {
                candleSeries.setMarkers(${JSON.stringify(eventMarkers)});
            }

            // Auto-fit and responsive behavior
            chart.timeScale().fitContent();
            
            // Make chart responsive
            const resizeObserver = new ResizeObserver(entries => {
                if (entries.length === 0 || entries[0].target !== chartElement) {
                    return;
                }
                const newRect = entries[0].contentRect;
                chart.applyOptions({ width: newRect.width, height: newRect.height });
            });
            resizeObserver.observe(chartElement);
            
        } catch (e) {
            console.error('Error rendering chart:', e);
            document.getElementById('chart-container').innerHTML = 
                '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ff6b6b; font-size: 18px;">' +
                '❌ Error rendering chart: ' + e.message + '</div>';
        }
    `;

    const scriptEl = window.document.createElement('script');
    scriptEl.textContent = script;
    window.document.body.appendChild(scriptEl);

    return dom.serialize();
}

// Main function to generate historical charts for all tokens
async function generateAllHistoricalCharts() {
    console.log('🚀 Generating HISTORICAL charts with full EMA calculations...');
    console.log('=' .repeat(60));

    const results = [];
    
    // Get all tokens (both enabled and disabled)
    const tokens = Object.entries(multiConfig.tokens);
    
    for (const [tokenSymbol, tokenConfig] of tokens) {
        const result = await generateTokenChart(tokenSymbol, tokenConfig);
        results.push({ token: tokenSymbol, ...result });
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 HISTORICAL CHART GENERATION SUMMARY:');
    console.log('='.repeat(60));

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    successful.forEach(r => {
        console.log(`✅ ${r.token}: ${r.file}
    📊 Data: ${r.dataPoints} prices → ${r.ohlcCandles} candles → ${r.fibPoints} Fib points
    ⚙️  Config: ${r.config.fibLookback}-bar lookback, ${r.config.wmaPeriod}-period EMA`);
    });

    failed.forEach(r => {
        console.log(`❌ ${r.token}: ${r.reason}`);
    });

    console.log(`\n🎯 Successfully generated ${successful.length}/${results.length} historical charts`);
    
    if (successful.length > 0) {
        console.log('\n💡 These charts show the ACTUAL historical EMA lines, not just static levels!');
        console.log('🔍 Look for:');
        console.log('   🟡 Yellow lines showing dynamic Fib 0% bounce levels over time');
        console.log('   🔵 Blue dashed lines showing Fib 50% levels'); 
        console.log('   🟣 Pink dotted lines showing entry trigger levels');
        console.log('   🎯 Colored markers showing actual trading events');
        console.log('\n📂 Open the historical_chart_*.html files in your browser!');
    }
}

// Run the enhanced generator
generateAllHistoricalCharts()
    .catch(err => {
        console.error('❌ Error generating historical charts:', err);
        process.exit(1);
    })
    .finally(() => {
        console.log('\n✅ Historical chart generation complete!');
        process.exit(0);
    });