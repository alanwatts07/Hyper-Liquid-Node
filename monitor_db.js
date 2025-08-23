// monitor_db.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import chalk from 'chalk';
import fs from 'fs/promises';
import config from './src/config.js';

class Monitor {
    constructor() {
        this.db = null;
        this.analysisFile = 'live_analysis.json';
        this.riskFile = 'live_risk.json'; // <-- Add the new file to watch
    }

    async connect() {
        this.db = await open({
            filename: config.database.file,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY
        });
    }

    async display() {
        console.clear();
        console.log(chalk.cyan.bold('--- Hyperliquid Bot Live Monitor ---'));

        try {
            // 1. Display Live Risk Management (from JSON file)
            console.log(chalk.yellow.bold('\n🛡️ Live Position & Risk Management'));
            try {
                const riskData = JSON.parse(await fs.readFile(this.riskFile, 'utf8'));
                const formatNum = (num, dec = 4) => num ? chalk.bold(num.toFixed(dec)) : chalk.gray('N/A');
                
                console.log(`   Asset:         ${chalk.bold(riskData.asset)}`);
                console.log(`   Entry Price:   $${formatNum(riskData.entryPrice, 2)}`);
                console.log(`   Current Price: $${formatNum(riskData.currentPrice, 2)}`);
                console.log(`   Est. ROE:      ${riskData.roe.includes('-') ? chalk.red(riskData.roe) : chalk.green(riskData.roe)}`);
                console.log(chalk.gray('   ----------------------------------'));
                
                if (riskData.fibStopActive) {
                    console.log(`   Stop Type:     ${chalk.magenta.bold('Fib Trail Stop')}`);
                    console.log(`   Stop Price:    $${formatNum(riskData.stopPrice, 2)}`);
                } else {
                    console.log(`   Stop Type:     ${chalk.cyan('Fixed Percentage')}`);
                    console.log(`   Stop ROE:      ${chalk.bold('< ' + (config.risk.stopLossPercentage * -100) + '%')}`);
                }
                console.log(`   Take Profit:   ${chalk.bold('> ' + (config.risk.takeProfitPercentage * 100) + '% ROE')}`);

            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.log(chalk.gray('   No open positions being tracked.'));
                } else {
                    console.log(chalk.red(`   Error reading risk file: ${err.message}`));
                }
            }

            // 2. Display Live Technical Analysis (from JSON file)
            console.log(chalk.yellow.bold('\n🔬 Live Technical Analysis'));
            try {
                const analysisData = JSON.parse(await fs.readFile(this.analysisFile, 'utf8'));
                const formatNum = (num, dec = 4) => num ? chalk.bold(num.toFixed(dec)) : chalk.gray('N/A');
                
                console.log(`   Latest Price:  $${formatNum(analysisData.latest_price, 2)}`);
                console.log(`   Fib Entry Lvl: $${formatNum(analysisData.fib_entry, 2)}`);
                console.log(`   WMA Fib 0 Lvl: $${formatNum(analysisData.wma_fib_0, 2)}`);
            } catch (err) {
                 console.log(chalk.gray('   Waiting for analysis data...'));
            }

            // 3. Display Recent Events (from DB)
            console.log(chalk.yellow.bold('\n📜 Recent Events (last 10)'));
            const events = await this.db.all("SELECT * FROM events ORDER BY id DESC LIMIT 10");
            if (events.length > 0) {
                events.reverse().forEach(event => {
                    const time = new Date(event.timestamp).toLocaleTimeString();
                    let color = chalk.white;
                    if (event.event_type.includes('BUY') || event.event_type.includes('EXECUTED')) color = chalk.green;
                    if (event.event_type.includes('FAIL') || event.event_type.includes('STOP')) color = chalk.red;
                    if (event.event_type.includes('ARMED')) color = chalk.cyan;
                    console.log(`   ${chalk.gray(time)} - ${color(event.event_type)}`);
                });
            } else {
                console.log(chalk.gray('   No events logged yet.'));
            }

        } catch (error) {
            console.error(chalk.red(`Error fetching data: ${error.message}`));
        }
    }

    start() {
        this.connect().then(() => {
            this.display();
            setInterval(() => this.display(), 3000);
        });
    }
}

const monitor = new Monitor();
monitor.start();