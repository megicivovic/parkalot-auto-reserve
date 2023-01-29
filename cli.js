#!/usr/bin/env node

'use strict'

const fs = require('fs').promises
const {promisify} = require('util')
const read = promisify(require('read'))
const puppeteer = require('puppeteer')
const homedir = require('os').homedir()
const cron = require('node-cron');


async function configure() {
    console.log('parkalot-auto-reserve hasn\'t been configured yet!')

    const config = {
        username: await read({prompt: 'Enter your username:', terminal: true}),
        password: await read({prompt: 'Enter your password:', silent: true, terminal: true})
    }

    await fs.writeFile(`${homedir}/.parkalotrc`, JSON.stringify(config))

    return config
};

const job = cron.schedule('0 1 12 * *', (async () => {
    let config

    try {
        config = JSON.parse(await fs.readFile(`${homedir}/.parkalotrc`))
    } catch (ex) {
        if (ex.code !== 'ENOENT') {
            throw ex
        }
    }

    try {
        if (!config) {
            config = await configure()
        }

        const browser = await puppeteer.launch({
            headless: false, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        })
        const page = await browser.newPage()
        page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36')


        await page.setViewport({
            width: 1200,
            height: 980
        })

        console.log('Going to app.parkalot.io...')

        await page.goto('https://app.parkalot.io/#/login', {waitUntil: 'networkidle2'})

        console.log('Logging in...')
        await page.type('[type="email"]', config.username)
        await page.type('[type="password"]', config.password)

        const [logInButton] = (await page.$x('//button[contains(., "log in")]'));
        await logInButton.click()

        await page.waitFor(5000)

        const rows = await page.$$('.row')

        let reserveClicked = false
        console.log('Reserving...')
        let hasntReserved = true;
        let index = rows.length;
        let row;
        while (hasntReserved) {
            index--;
            row = rows[index]
            // Find the title by class name.
            const titleElement = await row.$('.r-t')
            if (!titleElement) {
                continue
            }

            // The day of week is the first <span> in the title element.
            const dayOfWeek = await titleElement.$eval('span', node => node.innerText)
            if (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday') {
                continue
            }
            hasntReserved = false;
        }

        if (!row) {
            return
        }

        const buttons = await row.$$('button')
        for (const button of buttons) {
            // Find the details button.
            const buttonText = await button.evaluate(node => node.innerText)
            if (!buttonText.toLowerCase().includes('details')) {
                continue
            }
            await button.click()
            await page.waitFor(5000)
            break
        }

        const scrollToBottom = await page.evaluate(() => {
            const allWrappers = document.getElementsByClassName('css-1oadw05');
            if (allWrappers && allWrappers[0] && 21 > allWrappers.length) allWrappers[allWrappers.length - 1].scrollIntoView();
            return true
        })
        await page.waitFor(2000)
        const buttonId = await page.evaluate(() => {
            const allWrappers = document.getElementsByClassName('css-1oadw05');
            for (let wrapper of allWrappers) {
                if (wrapper.innerHTML.includes('1021')) {
                    let button = wrapper.querySelectorAll('button');
                    if (button[0]) return button[0].id;
                }
            }
            return undefined;
        })
        await page.waitFor(2000)

        let buttonReserve = await page.$(`#${buttonId}`);
        if (buttonReserve) {
            reserveClicked = true;
            await buttonReserve.click()
            await page.waitFor(500);
        }

        console.log('Reserving complete!')

        // If a reserve button was clicked, give it some time to catch up.
        if (reserveClicked) {
            await page.waitFor(5000)
        }

        console.log('Logging out...')
        const [logOutButton] = (await page.$x('//a[contains(., "Logout")]'));

        if (logOutButton) {
            await logOutButton.click()
        }

        console.log('Successfully logged out!')
        if (reserveClicked) {
            await page.waitFor(3000)
        }

        await browser.close()
    } catch
        (e) {
        console.error('Error occured' + e)
        process.exit(1)
    }
}));

job.start();
console.log('Job started!')
