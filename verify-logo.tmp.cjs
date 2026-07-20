const puppeteer = require('puppeteer-core');
const { encode } = require('next-auth/jwt');

const SECRET = '9FZPFoMEkW4KnAatUkQNu8Cd3GGej5iNC8Ev4eakef0=';
const SCRATCH = '/private/tmp/claude-501/-Users-wesbailey/90736e28-3d5a-4cdf-83b5-6fdfcf51546f/scratchpad';

(async () => {
  const token = { name: 'Wes', email: 'wes@sirreel.com', picture: null, sub: 'wes-verify' };
  const jwt = await encode({ token, secret: SECRET, maxAge: 3600 });

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    args: ['--window-size=1400,1000'],
    defaultViewport: null,
  });
  const [page] = await browser.pages();

  await page.setCookie({
    name: 'next-auth.session-token',
    value: jwt,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  });

  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle2' });
  console.log('URL after nav:', page.url());
  await new Promise((r) => setTimeout(r, 1500));

  await page.screenshot({ path: `${SCRATCH}/full-dashboard.png` });

  const sidebarHeader = await page.$('aside a[href="/"]');
  if (sidebarHeader) {
    await sidebarHeader.screenshot({ path: `${SCRATCH}/sidebar-header.png` });
    console.log('SIDEBAR_SCREENSHOT_OK');
  } else {
    console.log('SIDEBAR_HEADER_NOT_FOUND');
  }

  console.log('DONE');
  await browser.close();
})().catch((e) => {
  console.error('SCRIPT_ERROR', e);
  process.exit(1);
});
