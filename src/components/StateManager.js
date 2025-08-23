// src/components/StateManager.js
import logger from '../utils/logger.js';

class StateManager {
    constructor(db) {
        this.db = db;
        // The in-memory state, which is the single source of truth while the bot is running.
        this.state = {
            inPosition: false,
            triggerArmed: false,
        };
    }

    /**
     * Loads the initial state by checking the database for any open positions.
     * This ensures the bot knows if it's already in a trade when it starts.
     */
    async loadInitialState() {
        logger.info("StateManager: Loading initial state from database...");
        const openPositions = await this.db.getOpenPositions();

        if (openPositions.length > 0) {
            this.state.inPosition = true;
            logger.info(`StateManager: Initial state loaded. Found an open position for ${openPositions[0].asset}.`);
        } else {
            this.state.inPosition = false;
            logger.info("StateManager: Initial state loaded. No open positions found.");
        }
        // The trigger always starts as disarmed.
        this.state.triggerArmed = false;
    }

    /**
     * Checks if the bot is currently in an open position.
     * @returns {boolean}
     */
    isInPosition() {
        return this.state.inPosition;
    }

    /**
     * Sets the bot's position status.
     * @param {boolean} status - true if in a position, false otherwise.
     */
    setInPosition(status) {
        this.state.inPosition = status;
    }

    /**
     * Checks if the buy signal trigger is currently armed.
     * @returns {boolean}
     */
    isTriggerArmed() {
        return this.state.triggerArmed;
    }

    /**
     * Sets the trigger's armed status.
     * @param {boolean} status - true to arm the trigger, false to disarm.
     */
    setTriggerArmed(status) {
        if (this.state.triggerArmed !== status) {
            this.state.triggerArmed = status;
            logger.info(`StateManager: Trigger has been ${status ? 'ARMED' : 'DISARMED'}.`);
        }
    }
}

export default StateManager;