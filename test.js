import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('requestfailed', request => {
    console.log(`REQUEST FAILED: ${request.url()} - ${request.failure().errorText}`);
  });
  page.on('response', response => {
    if (!response.ok()) {
      console.log(`RESPONSE ERROR: ${response.url()} - ${response.status()}`);
    }
  });

  console.log("Navigating...");
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  const html = await page.content();
  console.log("ROOT CONTENT:", await page.$eval('#root', el => el.innerHTML));
  console.log("Done.");
  await browser.close();
})();
