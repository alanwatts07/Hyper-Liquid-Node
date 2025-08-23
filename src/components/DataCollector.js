// src/components/DataCollector.js
import * as hl from "@nktkas/hyperliquid";
import EventEmitter from 'events';
import logger from '../utils/logger.js';

class DataCollector extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        // 1. Initialize the InfoClient with the required transport layer
        this.infoClient = new hl.InfoClient({
            transport: new hl.HttpTransport({ isTestnet: false }), // Set isTestnet to true for testing
        });
        this.intervalId = null;
        this.backoffTime = config.collector.intervalSeconds * 1000;
    }

    start() {
        logger.info(`Starting data collector for ${this.config.trading.asset} every ${this.config.collector.intervalSeconds} seconds.`);
        this.fetchPrice();
        this.intervalId = setInterval(() => this.fetchPrice(), this.config.collector.intervalSeconds * 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            logger.info("Data collector stopped.");
        }
    }

    async fetchPrice() {
        const asset = this.config.trading.asset;
        try {
            // 2. Use the client to call the allMids() method
            const allMids = await this.infoClient.allMids();
            this.backoffTime = this.config.collector.intervalSeconds * 1000;

            if (allMids[asset]) {
                const price = parseFloat(allMids[asset]);
                const timestamp = new Date().toISOString();
                this.emit('newData', { timestamp, price });
                logger.info(`Fetched new price for ${asset}: $${price.toFixed(4)}`);
            } else {
                logger.warn(`Asset '${asset}' not found in the API response.`);
            }
        } catch (error) {
            // Exponential backoff logic remains the same
            if (error.message && error.message.includes('429')) {
                logger.warn(`Rate limit exceeded (429). Backing off for ${this.backoffTime / 1000} seconds...`);
                clearInterval(this.intervalId);
                await new Promise(resolve => setTimeout(resolve, this.backoffTime));
                this.backoffTime = Math.min(this.backoffTime * 2, 3600000);
                this.start(); 
            } else {
                logger.error(`An unexpected error occurred in fetchPrice: ${error.message}`);
            }
        }
    }

    async getCurrentPrice(asset) {
        try {
            const allMids = await this.infoClient.allMids();
            return allMids[asset] ? parseFloat(allMids[asset]) : null;
        } catch (error) {
            logger.error(`Error in getCurrentPrice for ${asset}: ${error.message}`);
            return null;
        }
    }
}

export default DataCollector;