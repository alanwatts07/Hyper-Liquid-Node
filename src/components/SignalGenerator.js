// src/components/SignalGenerator.js
import logger from '../utils/logger.js';

class SignalGenerator {
    constructor(config, db, state, notifier) {
        this.config = config;
        this.db = db;
        this.state = state;
        this.notifier = notifier;
    }

    // --- 1. Make the function async ---
    async generate(analysis) {
        // Back to original variable names (wma_fib_0 uses EMA under the hood)
        const { latest_price, fib_entry, wma_fib_0, stoch_rsi, stoch_rsi_4hr, bull_state } = analysis;
        const { tradeBlockers } = this.config.trading; // Get the new blocker settings

        // --- Safety Checks (ensure data exists) ---
        if (!stoch_rsi || typeof stoch_rsi.k === 'undefined' || typeof stoch_rsi.d === 'undefined') {
            return { type: 'hold', reason: 'Waiting for 5-min Stochastic RSI data.' };
        }
        if (!stoch_rsi_4hr || typeof stoch_rsi_4hr.k === 'undefined') {
            return { type: 'hold', reason: 'Waiting for 4-hour Stochastic RSI data.' };
        }

        // ==========================================================
        // /// <<<--- UPDATED TRADE BLOCKER LOGIC ---
        // ==========================================================
        
        // --- Blocker 1: 4-Hour Stochastic RSI ---
        if (tradeBlockers.blockOn4hrStoch && (stoch_rsi_4hr.k > 80 || stoch_rsi_4hr.d > 80)) {
            const reason = `HOLD (BLOCKER): 4hr Stoch is overbought.`;
            logger.info(reason);
            // --- 2. Add database event log ---
            await this.db.logEvent('TRADE_BLOCKED', { 
                reason: '4hr_stoch_overbought', 
                k: stoch_rsi_4hr.k, 
                d: stoch_rsi_4hr.d 
            });
            return { type: 'hold', reason };
        }

        // ==========================================================
        // /// <<<--- THIS IS THE MODIFIED LOGIC ---
        // ==========================================================
        // --- Blocker 2: 4-Hour Price Trend (with new exception) ---
        if (tradeBlockers.blockOnPriceTrend && !bull_state) {
            // EXCEPTION: If the trend is down BUT the 4hr stoch is deeply oversold, allow the trade.
            if (stoch_rsi_4hr.k < 20 && stoch_rsi_4hr.d < 20) {
                logger.info(`TRADE PERMITTED (OVERRIDE): Trend is bearish, but 4hr Stoch is oversold (K:${stoch_rsi_4hr.k.toFixed(2)}), allowing potential reversal entry.`);
            } else {
                // If the trend is down and we are NOT oversold, block the trade.
                const reason = `HOLD (BLOCKER): 4hr price trend is bearish and Stoch is not oversold.`;
                logger.info(reason);
                await this.db.logEvent('TRADE_BLOCKED', { 
                    reason: '4hr_trend_bearish_not_oversold', 
                    bull_state: bull_state,
                    k_4hr: stoch_rsi_4hr.k,
                    d_4hr: stoch_rsi_4hr.d
                });
                return { type: 'hold', reason };
            }
        }

        // --- Standard Arm/Disarm Logic (no changes here) ---
        if (!this.state.isTriggerArmed()) {
            if (latest_price < fib_entry) {
                this.state.setTriggerArmed(true);
                const message = `BUY TRIGGER ARMED. Price ${latest_price.toFixed(2)} is below entry level ${fib_entry.toFixed(2)}.`;
                logger.info(message);
                this.notifier.send("Trigger Armed", message, "info");
                return { type: 'hold', reason: 'Trigger has been armed.' };
            }
            return { type: 'hold', reason: `Waiting for price < ${fib_entry.toFixed(2)} to arm trigger.` };
        }

        // --- Buy Condition Logic (Original variable names, EMA under the hood) ---
        if (this.state.isTriggerArmed()) {
            // Buy condition: Price has bounced above the base fib_0 level (now using EMA)
            if (latest_price > wma_fib_0) {

                // --- Blocker 3: 5-Minute Stochastic RSI ---
                // If enabled, check if the 5min Stoch is overbought right at the entry point.
                if (tradeBlockers.blockOn5minStoch) {
                    if (stoch_rsi.k >= 80 || stoch_rsi.d >= 80) {
                        const reason = `HOLD: Price condition met, but 5min Stoch is overbought.`;
                        logger.info(reason);
                        // --- 2. Add database event log ---
                        await this.db.logEvent('TRADE_BLOCKED', { 
                            reason: '5min_stoch_overbought', 
                            k: stoch_rsi.k, 
                            d: stoch_rsi.d 
                        });
                        return { type: 'hold', reason: reason };
                    }
                }

                // If we get to this point, all enabled blockers and conditions have been passed.
                this.state.setTriggerArmed(false);
                const message = `BUY SIGNAL! Price > WMA_Fib_0 (${wma_fib_0.toFixed(2)}) and all blockers passed.`;
                logger.info(`🟢 ${message}`);
                this.notifier.send("🔥 BUY SIGNAL 🔥", message, "success");
                return { type: 'buy', reason: message };
            }
            return { type: 'hold', reason: `Trigger is armed. Waiting for price > ${wma_fib_0.toFixed(2)}.` };
        }
        
        return { type: 'hold', reason: 'No signal conditions met.' };
    }
}

export default SignalGenerator;