import { renderContractHtml, type RenderArgs } from './contractTemplate'

/**
 * Render the counter-PDF for a contract review.
 *
 * On Vercel/serverless we use puppeteer-core + @sparticuz/chromium.
 * Locally (development), we fall back to puppeteer (full Chromium download)
 * if it is installed; otherwise puppeteer-core will look for a system Chrome.
 *
 * If you change the contract HTML template, also update
 * public/contracts/sirreel-rental-agreement.pdf and contractClauses.ts so the
 * canonical PDF and the generated counter-PDF stay in lockstep.
 */
export async function generateCounterPdf(args: RenderArgs): Promise<Buffer> {
  const html = renderContractHtml(args)

  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_VERSION || !!process.env.VERCEL
  const puppeteer = (await import('puppeteer-core')).default

  let launchOptions: Parameters<typeof puppeteer.launch>[0]

  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    launchOptions = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless as any,
    }
  } else {
    const localPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    launchOptions = {
      headless: true,
      executablePath: localPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
  }

  const browser = await puppeteer.launch(launchOptions)
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.6in', bottom: '0.5in', left: '0.6in' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

export { renderContractHtml }
