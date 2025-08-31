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

// NEW: Exponential Moving Average function
function exponentialMovingAverage(data, period) {
    const multiplier = 2 / (period + 1);
    let result = [];
    
    for (let i = 0; i < data.length; i++) {
        if (isNaN(data[i])) {
            result.push(NaN);
            continue;
        }
        
        if (i === 0 || isNaN(result[i - 1])) {
            // First valid value becomes the initial EMA
            result.push(data[i]);
        } else {
            // EMA = (Current Value × Multiplier) + (Previous EMA × (1 - Multiplier))
            const ema = (data[i] * multiplier) + (result[i - 1] * (1 - multiplier));
            result.push(ema);
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

    resampleToOHLC_4hr(historicalData) {
        const grouped = {};
        historicalData.forEach(d => {
            const dt = DateTime.fromISO(d.timestamp);
            const hour = dt.hour - (dt.hour % 4); // Group by 4-hour blocks
            const key = dt.set({ hour, minute: 0, second: 0, millisecond: 0 }).toISO();
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

    calculate(historicalData, stateManager = null) {
        const { fibLookback, wmaPeriod, atrPeriod, stoch } = this.config.ta;
        const minRecords = Math.max(fibLookback + wmaPeriod, stoch.rsiPeriod + stoch.stochPeriod);
        // --- 4-HOUR ANALYSIS ---
        const { trendMaPeriod, stoch: stoch4hr } = this.config.ta.fourHour;
        const ohlc4hr = this.resampleToOHLC_4hr(historicalData);
        logger.info(`[Analysis Debug] Generated ${ohlc4hr.length} four-hour candles. (Need at least ${trendMaPeriod})`);
        let bull_state = false;
        let stoch_rsi_4hr = null;

        if (ohlc4hr.length >= trendMaPeriod) {
            const closes4hr = ohlc4hr.map(c => c.close);
            const trendMa = simpleMovingAverage(closes4hr, trendMaPeriod);
            const latestClose4hr = closes4hr[closes4hr.length - 1];
            const latestTrendMa = trendMa[trendMa.length - 1];

            if (latestClose4hr > latestTrendMa) {
                bull_state = true;
            }

            const { stochRSI } = this.calculateStochRSI(closes4hr, stoch4hr.rsiPeriod, stoch4hr.stochPeriod, stoch4hr.kPeriod, stoch4hr.dPeriod);
             // --- THIS IS THE MODIFIED PART ---
        if (stochRSI.length > 0) {
            const latestStoch4hr = stochRSI[stochRSI.length - 1];
            // Add a check to ensure K and D are valid numbers before assigning
            if (latestStoch4hr && typeof latestStoch4hr.k === 'number' && typeof latestStoch4hr.d === 'number' && !isNaN(latestStoch4hr.k) && !isNaN(latestStoch4hr.d)) {
                stoch_rsi_4hr = latestStoch4hr;
            }
            // Add this new, more detailed log
            logger.info(`[Analysis Debug] Latest 4hr Stoch Object: ${JSON.stringify(latestStoch4hr)}`);
        }
    }
    // --- END OF MODIFIED PART ---
        
        // --- END 4-HOUR ANALYSIS ---
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
            const closes = ohlc.map(c => c.close);
            const { rsi, stochRSI } = this.calculateStochRSI(closes, stoch.rsiPeriod, stoch.stochPeriod, stoch.kPeriod, stoch.dPeriod);

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
            
            // --- MODIFIED: EMA instead of SMA for fib_0 (keeping original variable names) ---
            const wma_fib_0_values = exponentialMovingAverage(lowestLows, wmaPeriod);
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
                    wma_fib_0: wma_fib_0_values[i], // Uses EMA but keeps original name
                    wma_fib_50: wma_fib_50_values[i],
                    atr: atr_values[i],
                    stoch_rsi: stochRSI[i]
                });
            }

            const completeResults = results.filter(r => !isNaN(r.wma_fib_0) && !isNaN(r.atr) && r.stoch_rsi);
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
            const fib_entry = latest.wma_fib_0 * (1 - this.config.ta.fibEntryOffsetPct); // Back to using wma_fib_0 name

            // Add trigger state information if available
            const triggerState = this.getTriggerStateInfo(stateManager, latest.close, fib_entry, latest.wma_fib_0);
            
            return {
                ...latest,
                fib_entry,
                latest_price: latest.close,
                bull_state: bull_state, // <-- ADD THIS
                stoch_rsi_4hr: stoch_rsi_4hr, // <-- ADD THIS
                triggerArmed: triggerState.armed,
                triggerReason: triggerState.reason
            };

        } catch (error) {
            logger.error(`CRITICAL ERROR during technical analysis: ${error.message}`);
            console.error(error.stack);
            return null;
        }
    }

    /**
     * Get trigger state information for display
     * @param {StateManager} stateManager - Optional state manager instance
     * @param {number} currentPrice - Current market price
     * @param {number} fibEntry - Fibonacci entry level
     * @param {number} wmaFib0 - WMA Fibonacci 0 level (bounce target)
     * @returns {Object} Trigger state info
     */
    getTriggerStateInfo(stateManager, currentPrice, fibEntry, wmaFib0) {
        if (!stateManager) {
            return {
                armed: false,
                reason: 'StateManager not available'
            };
        }

        const isArmed = stateManager.isTriggerArmed();
        
        if (isArmed) {
            const distanceToTarget = ((currentPrice - wmaFib0) / wmaFib0 * 100).toFixed(2);
            if (currentPrice > wmaFib0) {
                return {
                    armed: true,
                    reason: `Armed - price ${distanceToTarget}% above bounce target $${wmaFib0.toFixed(3)}`
                };
            } else {
                return {
                    armed: true,
                    reason: `Armed - waiting for bounce above $${wmaFib0.toFixed(3)} (${Math.abs(distanceToTarget)}% below)`
                };
            }
        } else {
            const distanceToTrigger = ((currentPrice - fibEntry) / fibEntry * 100).toFixed(2);
            if (currentPrice > fibEntry) {
                return {
                    armed: false,
                    reason: `Waiting for price drop to $${fibEntry.toFixed(3)} (${distanceToTrigger}% above trigger)`
                };
            } else {
                return {
                    armed: false,
                    reason: `Price below trigger level - should arm soon`
                };
            }
        }
    }

    calculateRSI(prices, period) {
        let gains = [];
        let losses = [];

        for (let i = 1; i < prices.length; i++) {
            let change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains.push(change);
                losses.push(0);
            } else {
                gains.push(0);
                losses.push(Math.abs(change));
            }
        }

        let avgGain = [];
        let avgLoss = [];
        let rsi = [];

        // Calculate initial averages
        let firstAvgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
        let firstAvgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
        avgGain.push(firstAvgGain);
        avgLoss.push(firstAvgLoss);

        // Calculate subsequent averages and RSI
        for (let i = period; i < gains.length; i++) {
            let currentAvgGain = (avgGain[avgGain.length - 1] * (period - 1) + gains[i]) / period;
            let currentAvgLoss = (avgLoss[avgLoss.length - 1] * (period - 1) + losses[i]) / period;
            avgGain.push(currentAvgGain);
            avgLoss.push(currentAvgLoss);
        }

        for (let i = 0; i < avgGain.length; i++) {
            let rs = avgGain[i] / avgLoss[i];
            rsi.push(100 - (100 / (1 + rs)));
        }

        // Pad the beginning of the RSI array with nulls to match the original price array length
        const rsiPadding = Array(prices.length - rsi.length).fill(null);
        return rsiPadding.concat(rsi);
    }

    calculateStochRSI(prices, rsiPeriod, stochPeriod, kPeriod, dPeriod) {
        const rsi = this.calculateRSI(prices, rsiPeriod);
        let stochRSI = [];

        for (let i = rsiPeriod; i < rsi.length; i++) {
            if (i < rsiPeriod + stochPeriod - 1) {
                stochRSI.push(null);
                continue;
            }

            const rsiSlice = rsi.slice(i - stochPeriod + 1, i + 1);
            const lowestRSI = Math.min(...rsiSlice);
            const highestRSI = Math.max(...rsiSlice);
            const currentRSI = rsi[i];

            // --- THIS IS THE CORRECTED LINE ---
            let stoch = ((currentRSI - lowestRSI) / (highestRSI - lowestRSI)) * 100;
            
            if (isNaN(stoch) || !isFinite(stoch)) {
                stoch = stochRSI[stochRSI.length - 1] ? stochRSI[stochRSI.length - 1].stoch : 50; // Default to 50 if NaN
            }
            stochRSI.push({ stoch });
        }

        const k = simpleMovingAverage(stochRSI.map(s => s ? s.stoch : NaN), kPeriod);
        const d = simpleMovingAverage(k, dPeriod);

        for (let i = 0; i < stochRSI.length; i++) {
            if (stochRSI[i]) {
                stochRSI[i].k = k[i];
                stochRSI[i].d = d[i];
            }
        }
        
        // Pad the beginning of the array with nulls to match the original price array length
        const padding = Array(prices.length - stochRSI.length).fill(null);
        return { rsi, stochRSI: padding.concat(stochRSI) };
    }
}

export default TechnicalAnalyzer;