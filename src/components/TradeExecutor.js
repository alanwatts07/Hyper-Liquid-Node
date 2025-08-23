// src/components/TradeExecutor.js
import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";
import logger from '../utils/logger.js';

class TradeExecutor {
    // ... constructor is the same ...
    constructor(config, db, dataCollector) {
        this.config = config;
        this.db = db;
        this.dataCollector = dataCollector;
        if (!process.env.HYPERLIQUID_WALLET_PRIVATE_KEY) {
            throw new Error("HYPERLIQUID_WALLET_PRIVATE_KEY is not set in the .env file.");
        }
        const wallet = new ethers.Wallet(process.env.HYPERLIQUID_WALLET_PRIVATE_KEY);
        this.walletAddress = wallet.address;
        const transport = new hl.HttpTransport({ isTestnet: false });
        this.exchangeClient = new hl.ExchangeClient({ wallet: wallet, transport });
        this.infoClient = new hl.InfoClient({ transport });
        logger.info(`TradeExecutor initialized for wallet: ${this.walletAddress}`);
    }


    async executeBuy(asset, usdSize) {
        try {
            // ... (logic to create order is the same) ...
            logger.info(`Executing BUY for ${asset} with target size ~$${usdSize}`);
            const meta = await this.infoClient.meta();
            const assetInfo = meta.universe.find(u => u.name === asset);
            if (!assetInfo) throw new Error(`Asset ${asset} not found in exchange metadata.`);
            const { szDecimals } = assetInfo;
            const assetIndex = meta.universe.findIndex(u => u.name === asset);
            const currentPrice = await this.dataCollector.getCurrentPrice(asset);
            if (!currentPrice) throw new Error(`Could not fetch current price for ${asset}.`);
            const orderSize = (usdSize / currentPrice).toFixed(szDecimals);
            const slippagePrice = (currentPrice * (1 + this.config.trading.slippage)).toFixed(2);
            const orderPayload = { a: assetIndex, b: true, p: slippagePrice, s: orderSize, r: false, t: { "limit": { "tif": "Ioc" } } };

            const result = await this.exchangeClient.order({ orders: [orderPayload], grouping: "na" });

            if (result.status === "ok") {
                const filledOrder = result.response.data.statuses[0].filled;
                if (!filledOrder) throw new Error('Order was not filled immediately.');
                
                const avgPx = parseFloat(filledOrder.avgPx);
                const filledSize = parseFloat(filledOrder.totalSz);

                logger.success(`TRADE EXECUTED: Bought ${filledSize} ${asset} @ $${avgPx}`);
                await this.db.updatePosition(asset, "LONG", filledSize, avgPx, "OPEN");
                await this.db.logEvent("TRADE_EXECUTED", { asset, size: filledSize, avg_px: avgPx });

                // --- FIX: Return the entire filled order object ---
                return { success: true, filledOrder: filledOrder };

            } else {
                throw new Error(`Trade execution failed: ${JSON.stringify(result)}`);
            }
        } catch (error) {
            logger.error(`Error in executeBuy: ${error.message}`);
            await this.db.logEvent("TRADE_FAILED", { error: error.message });
            return { success: false, error: error.message };
        }
    }

    // ... closePosition and getClearinghouseState are the same ...
    async closePosition(asset, size) {
        try {
            const isClosingLong = size > 0;
            const action = isClosingLong ? "SELL" : "BUY";
            logger.info(`Executing CLOSE for ${asset} position of size ${size}. Action: ${action}`);
            const meta = await this.infoClient.meta();
            const assetInfo = meta.universe.find(u => u.name === asset);
            if (!assetInfo) throw new Error(`Asset ${asset} not found.`);
            const assetIndex = meta.universe.findIndex(u => u.name === assetInfo.name);
            const currentPrice = await this.dataCollector.getCurrentPrice(asset);
            if (!currentPrice) throw new Error(`Could not fetch current price for ${asset}.`);
            const slippagePrice = isClosingLong ? (currentPrice * (1 - this.config.trading.slippage)).toFixed(2) : (currentPrice * (1 + this.config.trading.slippage)).toFixed(2);
            const order = { a: assetIndex, b: !isClosingLong, p: slippagePrice, s: Math.abs(size).toString(), r: true, t: { "limit": { "tif": "Ioc" } } };
            const result = await this.exchangeClient.order({ orders: [order], grouping: "na" });
            if (result.status === "ok") {
                const filledOrder = result.response.data.statuses[0].filled;
                const avgPx = filledOrder ? parseFloat(filledOrder.avgPx) : 0;
                logger.success(`POSITION CLOSED: ${asset} @ ~$${avgPx}`);
                await this.db.updatePosition(asset, "N/A", 0, 0, "CLOSED");
                return { success: true, price: avgPx };
            } else {
                throw new Error(`Failed to close position: ${JSON.stringify(result)}`);
            }
        } catch (error) {
            logger.error(`Error in closePosition: ${error.message}`);
            await this.db.logEvent("CLOSE_FAILED", { asset, error: error.message });
            return { success: false, error: error.message };
        }
    }

    async getClearinghouseState() {
        try {
            const userAddress = process.env.HYPERLIQUID_MAIN_ACCOUNT_ADDRESS || this.walletAddress;
            return await this.infoClient.clearinghouseState({ user: userAddress.toLowerCase() });
        } catch (error) {
            logger.error(`Error fetching clearinghouse state: ${error.message}`);
            return null;
        }
    }
}

export default TradeExecutor;