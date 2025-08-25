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
        const { fib_entry, wma_fib_0 } = analysis;

        // --- FINAL CORRECTED LOGIC ---

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
                this.state.setTriggerArmed(false); // DISARM ONLY WHEN THE TRADE IS MADE.
                const message = `BUY SIGNAL! Price ${currentPrice.toFixed(2)} is > WMA_Fib_0 ${wma_fib_0.toFixed(2)}.`;
                logger.info(`🟢 ${message}`);
                this.notifier.send("🔥 BUY SIGNAL 🔥", message, "success");
                return { type: 'buy', reason: message };
            }

            // If still armed but the buy condition is not met, we simply wait.
            // There is no other way to disarm the trigger.
            return { type: 'hold', reason: `Trigger is armed. Waiting for price > ${wma_fib_0.toFixed(2)}.` };
        }

        // Default case, should not be reached but good for safety
        return { type: 'hold', reason: 'No signal conditions met.' };
    }
}

export default SignalGenerator;