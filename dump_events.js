// dump_events.js
// A simple script to connect to the trading bot's database and print all logged events.

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import config from './src/config.js'; // Import config to get the database file path

// --- Configuration ---
const DB_FILE = path.resolve(process.cwd(), config.database.file);

/**
 * Main function to fetch and display events.
 */
async function dumpEvents() {
    console.log(`[+] Attempting to connect to database at: ${DB_FILE}`);
    let db;

    try {
        // Open the database connection
        db = await open({
            filename: DB_FILE,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY // Open in read-only mode to prevent accidental changes
        });
        console.log("[+] Database connection successful.");

        // Fetch all records from the 'events' table
        const events = await db.all('SELECT * FROM events ORDER BY id ASC');

        if (events.length === 0) {
            console.log("[!] No events found in the database.");
            return;
        }

        console.log(`\n--- Found ${events.length} total events ---\n`);

        // Loop through each event and print it in a readable format
        for (const event of events) {
            console.log(`----------------------------------------`);
            console.log(`ID         : ${event.id}`);
            console.log(`Timestamp  : ${event.timestamp}`);
            console.log(`Event Type : ${event.event_type}`);
            // Parse and format the details JSON for readability
            try {
                const details = JSON.parse(event.details);
                console.log(`Details    : ${JSON.stringify(details, null, 2)}`);
            } catch {
                console.log(`Details    : (Could not parse JSON) ${event.details}`);
            }
        }
        console.log(`\n--- End of events dump ---\n`);

    } catch (error) {
        console.error(`[!] CRITICAL ERROR: Could not read database: ${error.message}`);
    } finally {
        // Ensure the database connection is closed
        if (db) {
            await db.close();
            console.log("[+] Database connection closed.");
        }
    }
}

// Run the main function
dumpEvents();
