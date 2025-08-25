// src/components/TechnicalAnalyzer.js

import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import logger from '../utils/logger.js';

const ANALYSIS_OUTPUT_FILE = path.resolve(process.cwd(), 'analysis_data.json');

// ... (simpleMovingAverage function remains the same) ...
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


class TechnicalAnalyzer {
    constructor(config) {
        this.config = config;
    }

    // ... (resampleToOHLC function remains the same) ...
    resampleToOHLC(historicalData) {
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
                timestamp: key, // Use ISO string for JSON compatibility
                open: prices[0],
                high: Math.max(...prices),
                low: Math.min(...prices),
                close: prices[prices.length - 1],
            };
        });

        if (ohlcData.length === 0) return [];
        return ohlcData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }


    calculate(historicalData) {
        const { fibLookback, wmaPeriod, atrPeriod } = this.config.ta;
        const minRecords = fibLookback + wmaPeriod;

        if (!historicalData || historicalData.length < minRecords) {
            logger.warn(`Not enough historical data. Need >= ${minRecords}, have ${historicalData.length}.`);
            return null;
        }

        try {
            const ohlc = this.resampleToOHLC(historicalData);
            if (ohlc.length < minRecords) {
                logger.warn(`Not enough OHLC candles. Need >= ${minRecords}, have ${ohlc.length}.`);
                return null;
            }

            // ... (all manual calculation loops remain the same) ...
            let highestHighs = [];
            let lowestLows = [];
            let trueRanges = [];

            for (let i = 0; i < ohlc.length; i++) {
                // Calculate Highest High
                if (i < fibLookback - 1) {
                    highestHighs.push(NaN);
                } else {
                    let max = 0;
                    for (let j = 0; j < fibLookback; j++) {
                        if (ohlc[i - j].high > max) {
                            max = ohlc[i - j].high;
                        }
                    }
                    highestHighs.push(max);
                }

                // Calculate Lowest Low
                if (i < fibLookback - 1) {
                    lowestLows.push(NaN);
                } else {
                    let min = Infinity;
                    for (let j = 0; j < fibLookback; j++) {
                        if (ohlc[i - j].low < min) {
                            min = ohlc[i - j].low;
                        }
                    }
                    lowestLows.push(min);
                }
                
                // Calculate True Range (for ATR)
                if (i === 0) {
                    trueRanges.push(ohlc[i].high - ohlc[i].low);
                } else {
                    const tr1 = ohlc[i].high - ohlc[i].low;
                    const tr2 = Math.abs(ohlc[i].high - ohlc[i - 1].close);
                    const tr3 = Math.abs(ohlc[i].low - ohlc[i - 1].close);
                    trueRanges.push(Math.max(tr1, tr2, tr3));
                }
            }
            
            // --- Manual Moving Average Calculations ---
            const wma_fib_0_values = simpleMovingAverage(lowestLows, wmaPeriod);
            const fib_50_range = highestHighs.map((h, i) => (h - lowestLows[i]) * 0.5);
            const fib_50_base = highestHighs.map((h, i) => h - fib_50_range[i]);
            const wma_fib_50_values = simpleMovingAverage(fib_50_base, wmaPeriod);
            const atr_values = simpleMovingAverage(trueRanges, atrPeriod);

            // --- Combine and get the latest complete record ---
            const results = [];
            for (let i = 0; i < ohlc.length; i++) {
                results.push({
                    timestamp: ohlc[i].timestamp,
                    open: ohlc[i].open,
                    high: ohlc[i].high,
                    low: ohlc[i].low,
                    close: ohlc[i].close,
                    wma_fib_0: wma_fib_0_values[i],
                    wma_fib_50: wma_fib_50_values[i],
                    atr: atr_values[i],
                });
            }


            const completeResults = results.filter(r => !isNaN(r.wma_fib_0) && !isNaN(r.atr));
            if (completeResults.length === 0) {
                logger.warn("No valid analysis after manual calculations. Bot needs more data.");
                return null;
            }

            // --- MODIFIED SECTION ---
            // Only write the analysis file if debug mode is enabled in the config
            if (this.config.debug) {
                try {
                    fs.writeFileSync(ANALYSIS_OUTPUT_FILE, JSON.stringify(completeResults, null, 2));
                    logger.info(`Debug mode is ON. Analysis data saved to ${ANALYSIS_OUTPUT_FILE}`);
                } catch (err) {
                    logger.error(`Failed to write analysis data to file: ${err.message}`);
                }
            }

            // The function still returns the latest analysis for the bot's live logic
            const latest = completeResults[completeResults.length - 1];
            const fib_entry = latest.wma_fib_0 * (1 - this.config.ta.fibEntryOffsetPct);

            return {
                ...latest,
                fib_entry,
                latest_price: latest.close,
            };

        } catch (error) {
            logger.error(`CRITICAL ERROR during technical analysis: ${error.message}`);
            console.error(error.stack);
            return null;
        }
    }
}

export default TechnicalAnalyzer;
