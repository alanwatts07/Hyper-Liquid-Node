// src/components/SignalGenerator.js
import logger from '../utils/logger.js';

class SignalGenerator {
    constructor(config, db, state, notifier) {
        this.config = config;
        this.db = db;
        this.state = state;
        this.notifier = notifier;
    }

    /**
     * Generates a trade signal based on the latest analysis and current state.
     * @param {Object} analysis - The analysis object from TechnicalAnalyzer.
     * @returns {Object} A signal object, e.g., { type: 'buy' } or { type: 'hold' }.
     */
    generate(analysis) {
        // Default signal is to do nothing.
        let signal = { type: 'hold' };

        // If analysis is null (e.g., not enough data), we can't do anything.
        if (!analysis) {
            return signal;
        }

        const { wma_fib_0, fib_entry, latest_price } = analysis;
        const { resetPctAboveFib0 } = this.config.ta;

        // --- Trading Logic ---
        // We only generate signals if we are NOT currently in a position.
        if (!this.state.isInPosition()) {
            const resetThreshold = wma_fib_0 * (1 + resetPctAboveFib0);

            // Condition to DISARM the trigger: Price moves too high above the Fib 0 line.
            if (latest_price > resetThreshold) {
                if (this.state.isTriggerArmed()) {
                    this.state.setTriggerArmed(false);
                    this.notifier.send("Trigger DISARMED", `Price ($${latest_price.toFixed(2)}) crossed above reset threshold ($${resetThreshold.toFixed(2)})`, "warning");
                    this.db.logEvent("TRIGGER_DISARMED", { savant_data: analysis });
                }
            }
            // Condition to ARM the trigger: Price drops below the fib_entry level.
            else if (latest_price < fib_entry) {
                if (!this.state.isTriggerArmed()) {
                    this.state.setTriggerArmed(true);
                    this.notifier.send("Trigger ARMED!", `Price ($${latest_price.toFixed(2)}) is below entry level ($${fib_entry.toFixed(2)})`, "info");
                    this.db.logEvent("TRIGGER_ARMED", { savant_data: analysis });
                }
            }

            // BUY SIGNAL Condition: The trigger must be armed AND the price must cross back above the wma_fib_0 level.
            if (this.state.isTriggerArmed() && latest_price > wma_fib_0) {
                logger.success(`BUY SIGNAL DETECTED: Price ($${latest_price.toFixed(2)}) > Fib 0 ($${wma_fib_0.toFixed(2)}) with trigger armed.`);
                
                signal = { type: 'buy' };
                
                this.notifier.send("🚀 BUY SIGNAL!", `Price ($${latest_price.toFixed(2)}) crossed above Fib 0 with trigger armed.`, "success");
                this.db.logEvent("BUY_SIGNAL", { savant_data: analysis });

                // Disarm the trigger after firing to prevent immediate re-entry.
                this.state.setTriggerArmed(false);
            }
        }

        return signal;
    }
}

export default SignalGenerator;