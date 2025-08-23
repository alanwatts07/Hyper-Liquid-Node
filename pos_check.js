// position_checker.js
import * as hl from "@nktkas/hyperliquid";
import { ethers } from "ethers";
import 'dotenv/config';
import logger from './src/utils/logger.js';
import chalk from 'chalk';

async function queryForUser(userAddress, infoClient, addressLabel) {
    console.log(chalk.cyan.bold(`\n--- Querying for ${addressLabel}: ${chalk.yellow(userAddress)} ---`));

    // Method 1: clearinghouseState
    console.log(chalk.blue.bold('1. Testing `infoClient.clearinghouseState()`...'));
    try {
        const state = await infoClient.clearinghouseState({ user: userAddress.toLowerCase() });
        const openPositions = state.assetPositions.filter(p => p && p.position && Number(p.position.szi) !== 0);
        
        console.log(chalk.green('   Request Succeeded!'));
        if (openPositions.length > 0) {
            console.log(chalk.green.bold(`   ✅ FOUND ${openPositions.length} OPEN POSITION(S)!`));
            console.log(JSON.stringify(openPositions, null, 2));
        } else {
            console.log(chalk.gray('   - No open positions found with this method.'));
        }
    } catch (error) {
        logger.error(`   Request Failed: ${error.message}`);
    }
    console.log(chalk.gray('\n----------------------------------------'));

    // Method 2: activeAssetData
    console.log(chalk.blue.bold('\n2. Testing `infoClient.activeAssetData()`...'));
    try {
        const activeData = await infoClient.activeAssetData({ user: userAddress.toLowerCase() });
        const openPositions = activeData.assetPositions.filter(p => p && p.position && Number(p.position.szi) !== 0);

        console.log(chalk.green('   Request Succeeded!'));
        if (openPositions.length > 0) {
            console.log(chalk.green.bold(`   ✅ FOUND ${openPositions.length} OPEN POSITION(S)!`));
            console.log(JSON.stringify(openPositions, null, 2));
        } else {
            console.log(chalk.gray('   - No open positions found with this method.'));
        }
    } catch (error) {
        logger.error(`   Request Failed: ${error.message}`);
    }
}

async function checkPositions() {
    console.log(chalk.cyan.bold('\n--- Hyperliquid Position Checker (Dual Address) ---'));

    // Get Main Wallet Address from Private Key
    if (!process.env.HYPERLIQUID_WALLET_PRIVATE_KEY) {
        logger.error("HYPERLIQUID_WALLET_PRIVATE_KEY not set. Aborting.");
        return;
    }
    const mainWallet = new ethers.Wallet(process.env.HYPERLIQUID_WALLET_PRIVATE_KEY);
    const mainAddress = mainWallet.address;

    // Get API Wallet Address from .env
    const apiAddress = process.env.HYPERLIQUID_API_WALLET_ADDRESS;

    // Setup connection
    const transport = new hl.HttpTransport({ isTestnet: false });
    const infoClient = new hl.InfoClient({ transport });

    // Test Main Wallet Address
    await queryForUser(mainAddress, infoClient, "Main Wallet Address");

    // Test API Wallet Address if it exists
    if (apiAddress) {
        await queryForUser(apiAddress, infoClient, "API Wallet Address");
    } else {
        logger.warn("\nHYPERLIQUID_API_WALLET_ADDRESS not set in .env. Skipping test for API address.");
    }
    
    console.log("\n--- Check Complete ---");
}

checkPositions();