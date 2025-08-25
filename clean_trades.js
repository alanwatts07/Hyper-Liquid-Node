// cleanup_trades.js
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import config from './src/config.js';

const DB_FILE = path.resolve(process.cwd(), config.database.file);

/**
 * This script will connect to your trading bot's database and delete all
 * records from the 'events' and 'positions' tables.
 *
 * IT WILL NOT AFFECT THE 'prices' TABLE.
 *
 * This is useful for clearing old trade markers from your chart without
 * losing all of the collected price data.
 */
async function clearTradeHistory() {
    console.log('Connecting to the database...');
    let db;

    try {
        db = await open({
            filename: DB_FILE,
            driver: sqlite3.Database
        });

        console.log("Connection successful. Deleting data from 'events' and 'positions' tables...");

        // Execute the DELETE commands
        await db.exec("DELETE FROM events;");
        await db.exec("DELETE FROM positions;");

        // This command cleans up the database file to reduce its size after deletion.
        await db.exec("VACUUM;");

        console.log("\n✅ Success! All records from 'events' and 'positions' have been deleted.");
        console.log("Price data has not been affected.");

    } catch (error) {
        console.error("\n❌ An error occurred:", error.message);
    } finally {
        if (db) {
            await db.close();
            console.log("\nDatabase connection closed.");
        }
    }
}

// Run the function
clearTradeHistory();