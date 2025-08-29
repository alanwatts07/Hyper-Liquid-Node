import logger from '../utils/logger.js';

class SignalGenerator {
    constructor(config, db, state, notifier) {
        this.config = config;
        this.db = db;
        this.state = state; // this.state is the StateManager instance
        this.notifier = notifier;
    }

    generate(analysis) {
        const currentPrice = analysis.latest_price;
        // --- FIX: Add stoch_rsi_4hr and bull_state to the destructuring ---
        const { fib_entry, wma_fib_0, stoch_rsi, stoch_rsi_4hr, bull_state } = analysis;

        // --- Safety Checks ---
        if (!stoch_rsi || typeof stoch_rsi.k === 'undefined' || typeof stoch_rsi.d === 'undefined') {
            return { type: 'hold', reason: 'Waiting for Stochastic RSI data to be calculated.' };
        }
        
        // NEW: 4-hour Stoch RSI check
        if (!stoch_rsi_4hr || typeof stoch_rsi_4hr.k === 'undefined') {
            return { type: 'hold', reason: 'Waiting for 4-hour Stochastic RSI data.' };
        }

        // NEW: Prevent trades if 4hr Stoch is too high
        if (stoch_rsi_4hr.k > 80 || stoch_rsi_4hr.d > 80) {
            const reason = `HOLD: 4-hour Stoch RSI is too high (K: ${stoch_rsi_4hr.k.toFixed(2)}, D: ${stoch_rsi_4hr.d.toFixed(2)}).`;
            logger.info(reason);
            return { type: 'hold', reason: reason };
        }


        // 1. Check conditions if the trigger is NOT currently armed
        if (!this.state.isTriggerArmed()) {
            // ARM condition: Price drops BELOW our desired entry zone.
            if (currentPrice < fib_entry) {
                this.state.setTriggerArmed(true);
                const message = `BUY TRIGGER ARMED. Price ${currentPrice.toFixed(2)} is below entry level ${fib_entry.toFixed(2)}. Waiting for bounce above buy level > ${wma_fib_0.toFixed(2)}.`;
                logger.info(message);
                this.notifier.send("Trigger Armed", message, "info");
                return { type: 'hold', reason: 'Trigger has been armed.' };
            }
            // If not armed and condition isn't met, just wait.
            return { type: 'hold', reason: `Waiting for price < ${fib_entry.toFixed(2)} to arm trigger.` };
        }

        // 2. Check conditions if the trigger IS currently armed
        if (this.state.isTriggerArmed()) {
            // BUY Condition: Price has bounced back up and crossed ABOVE our target buy level.
            if (currentPrice > wma_fib_0) {
                
                // --- ADDED THIS FINAL CHECK ---
                // Also check if both Stoch RSI lines are below 60 to confirm momentum isn't exhausted.
                if (stoch_rsi.k < 80 && stoch_rsi.d < 80) {
                    this.state.setTriggerArmed(false); // Disarm after the successful trade signal.
                    const message = `BUY SIGNAL! Price > WMA_Fib_0 AND Stoch RSI K/D (${stoch_rsi.k.toFixed(2)}/${stoch_rsi.d.toFixed(2)}) < 60.`;
                    logger.info(`🟢 ${message}`);
                    this.notifier.send("🔥 BUY SIGNAL 🔥", message, "success");
                    return { type: 'buy', reason: message };
                } else {
                    // Price condition was met, but the Stoch RSI filter blocked it.
                    const reason = `HOLD: Price is > ${wma_fib_0.toFixed(2)}, but Stoch RSI is too high (K: ${stoch_rsi.k.toFixed(2)}, D: ${stoch_rsi.d.toFixed(2)}). Waiting for a pullback.`;
                    logger.info(reason);
                    return { type: 'hold', reason: reason };
                }
            }

            // If still armed but the buy condition is not met, we simply wait.
            return { type: 'hold', reason: `Trigger is armed. Waiting for price > ${wma_fib_0.toFixed(2)}.` };
        }

        // Default case, should not be reached but good for safety
        return { type: 'hold', reason: 'No signal conditions met.' };
    }
}

export default SignalGenerator;