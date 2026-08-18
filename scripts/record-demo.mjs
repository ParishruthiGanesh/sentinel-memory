/**
 * Automated demo recorder.
 *
 * Drives the Sentinel Memory demo through a real browser with deliberate,
 * jitter-free pacing and records it to a video file. Run this against YOUR
 * deployment (with CockroachDB and Bedrock configured), then narrate over the
 * result using docs/VIDEO_NARRATION.md — the section timings below are matched
 * to that script.
 *
 * Why bother instead of screen-recording by hand: no mouse wobble, no missed
 * clicks, no dead air while you hunt for a button, and it is repeatable — if a
 * take goes wrong you just run it again.
 *
 *   npm run record:demo                                  # against localhost:3000
 *   npm run record:demo -- --base-url https://your-app.vercel.app
 *   npm run record:demo -- --out ./take2 --width 1920 --height 1080
 *   npm run record:demo -- --executable-path /path/to/chrome
 *
 * Requires Playwright:  npm i -D playwright && npx playwright install chromium
 *
 * The recording is SILENT by design. Add narration in any editor (iMovie,
 * DaVinci Resolve, CapCut, Descript).
 */

import { mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const BASE = (arg('base-url', 'http://localhost:3000')).replace(/\/$/, '');
const OUT = resolve(arg('out', './demo-recording'));
const WIDTH = Number(arg('width', 1600));
const HEIGHT = Number(arg('height', 1000));
const SKIP_HEALTH = process.argv.includes('--skip-health-check');
// Escape hatch: point at an existing Chrome/Chromium instead of Playwright's
// managed download (useful in locked-down environments, or to record in the
// exact browser you already have installed).
const EXECUTABLE_PATH = arg('executable-path', process.env.CHROME_PATH);

// ---------------------------------------------------------------------------
// pre-flight: refuse to silently record a fallback-mode demo
// ---------------------------------------------------------------------------

async function preflight() {
  console.log(`\n  Target: ${BASE}`);
  let health;
  try {
    const response = await fetch(`${BASE}/api/health`);

    // A 401/403 here almost always means Vercel Deployment Protection is on:
    // the URL opens fine in the browser you are logged into, and is invisible
    // to everyone else — including this script, and including a judge.
    if (response.status === 401 || response.status === 403) {
      console.error(`\n  ${BASE}/api/health returned ${response.status}.`);
      console.error('  That usually means Vercel Deployment Protection is enabled.');
      console.error('  The URL works in your logged-in browser but is private to everyone else.');
      console.error('');
      console.error('  Fix: Vercel -> Project -> Settings -> Deployment Protection');
      console.error('       -> set Vercel Authentication to Disabled for Production.');
      console.error('  Then confirm in a private/incognito window before recording.\n');
      process.exit(1);
    }
    if (!response.ok) {
      console.error(`\n  ${BASE}/api/health returned HTTP ${response.status}.`);
      console.error('  Is the app deployed and running at that URL?\n');
      process.exit(1);
    }

    health = await response.json();
  } catch (error) {
    console.error(`\n  Could not reach ${BASE}/api/health`);
    console.error(`  ${error.message}`);
    console.error('');
    console.error('  Check the URL is correct and publicly reachable. If you are');
    console.error('  recording a local build, start it first: npm run build && npm start\n');
    process.exit(1);
  }

  const { store, reasoning, embeddings } = health.mode ?? {};
  console.log(`  Store:      ${store}`);
  console.log(`  Reasoning:  ${reasoning}`);
  console.log(`  Embeddings: ${embeddings}\n`);

  const degraded = [];
  if (store !== 'cockroachdb') degraded.push('CockroachDB is NOT connected (in-memory demo store)');
  if (reasoning !== 'bedrock') degraded.push('Bedrock is NOT connected (local rule-based fallback)');
  if (embeddings !== 'bedrock') degraded.push('Bedrock embeddings are NOT configured');

  if (degraded.length > 0 && !SKIP_HEALTH) {
    console.error('  REFUSING TO RECORD');
    console.error('  ' + '-'.repeat(62));
    degraded.forEach((line) => console.error(`    - ${line}`));
    console.error('  ' + '-'.repeat(62));
    console.error('  The app paints a degraded-mode banner across every page, which');
    console.error('  would appear in every frame of your submission video and');
    console.error('  contradict the integration you are demonstrating.');
    console.error('');
    console.error('  Fix the environment variables, then re-run.');
    console.error('  To record anyway (e.g. for a UI walkthrough): --skip-health-check');
    console.error('');
    process.exit(1);
  }
  if (degraded.length > 0) {
    console.warn('  ! Recording in degraded mode because --skip-health-check was passed.\n');
  }
}

// ---------------------------------------------------------------------------
// recording
// ---------------------------------------------------------------------------

async function record() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  // Imported lazily so the health check above runs first, and so a missing
  // Playwright install produces a useful message instead of a stack trace.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '\n  Playwright is not installed. It is an optional tool for this script only:\n' +
        '    npm i -D playwright && npx playwright install chromium\n',
    );
    process.exit(1);
  }

  const browser = await chromium.launch(
    EXECUTABLE_PATH ? { executablePath: EXECUTABLE_PATH } : {},
  );
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: OUT, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();

  // Playwright does not draw a cursor into the recording, so we render one.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const dot = document.createElement('div');
      dot.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'width:18px', 'height:18px',
        'margin:-9px 0 0 -9px', 'border-radius:50%', 'pointer-events:none',
        'background:rgba(56,189,248,.85)', 'box-shadow:0 0 0 4px rgba(56,189,248,.25)',
        'transition:transform .08s linear', 'left:0', 'top:0',
      ].join(';');
      document.body.appendChild(dot);
      document.addEventListener('mousemove', (event) => {
        dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      });
    });
  });

  const started = Date.now();
  const mark = (label) => {
    const seconds = (Date.now() - started) / 1000;
    const stamp = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(0).padStart(2, '0')}`;
    console.log(`  ${stamp}  ${label}`);
  };
  const wait = (ms) => page.waitForTimeout(ms);

  const glideTo = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
    await wait(350);
  };
  const clickIt = async (locator) => {
    await glideTo(locator);
    await locator.click();
  };
  // The app scrolls an inner <main>, not the window.
  const glideScroll = (to, ms = 1400) =>
    page.evaluate(async ([target, duration]) => {
      const main = document.querySelector('main');
      if (!main) return;
      const start = main.scrollTop;
      const delta = target - start;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (t) => {
          const p = Math.min(1, (t - t0) / duration);
          const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
          main.scrollTop = start + delta * eased;
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    }, [to, ms]);

  // -- 0:00 the problem ----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wait(3500);
  mark('the problem — hold on the incident header');
  await glideScroll(120, 1200);
  await wait(15000);

  // -- 0:20 the live incident ---------------------------------------------
  mark('the live incident — observation feed');
  await glideScroll(0, 900);
  await wait(3000);
  await glideTo(page.locator('text=/Pressure reading increasing/').first());
  await wait(4000);
  await glideTo(page.locator('text=/Main power to the Zone 4 cell/').first());
  await wait(4000);
  await glideTo(page.locator('header select').first());
  await wait(6000);

  // -- 0:45 retrieval ------------------------------------------------------
  mark('retrieval — propose the risky action');
  await glideScroll(320, 900);
  await clickIt(page.getByRole('button', { name: /Check a proposed action against memory/i }));
  await page.waitForSelector('text=/Approve safer action/i', { timeout: 60000 });
  await wait(2500);
  await glideScroll(0, 1000);
  await wait(4000);
  mark('retrieval telemetry');
  await glideTo(page.locator('text=/memories searched/').first());
  await wait(6000);
  await glideScroll(560, 1300);
  await wait(7000);
  await glideScroll(0, 1100);
  await wait(3000);

  // -- 1:15 counterfactual + approval -------------------------------------
  mark('counterfactual card');
  await glideTo(page.locator('text=/What happened last time/').first());
  await wait(9000);
  mark('approve');
  await clickIt(page.getByRole('button', { name: /Approve safer action/i }));
  await wait(2500);
  await clickIt(page.getByRole('button', { name: /Approve as authorized responder/i }));
  await wait(6000);

  // -- 1:40 handoff --------------------------------------------------------
  mark('handoff');
  await clickIt(page.getByRole('link', { name: /Agent Handoff/i }));
  await page.waitForSelector('text=/Backup agent/i', { timeout: 30000 });
  await wait(3000);
  await clickIt(page.getByRole('button', { name: /Simulate Primary Agent Disconnect/i }));
  await wait(4000);
  await clickIt(page.getByRole('button', { name: /Transfer to Backup Agent/i }));
  await page.waitForSelector('text=/Continuity verified/i', { timeout: 90000 });
  await wait(4000);
  mark('continuity briefing');
  await glideScroll(420, 1500);
  await wait(7000);
  await glideScroll(900, 1500);
  await wait(5000);

  // -- 2:05 the receipts ---------------------------------------------------
  mark('timeline');
  await clickIt(page.getByRole('link', { name: /Incident Timeline/i }));
  await page.waitForSelector('text=/Event stream/i', { timeout: 30000 });
  await wait(2500);
  await glideScroll(500, 2000);
  await wait(4000);
  await glideScroll(1100, 2000);
  await wait(4000);
  mark('memory explorer');
  await clickIt(page.getByRole('link', { name: /Memory Explorer/i }));
  await wait(3500);
  await glideScroll(260, 1200);
  await wait(7000);

  // -- 2:30 close ----------------------------------------------------------
  mark('close on the counterfactual');
  await clickIt(page.getByRole('link', { name: /Command Center/i }));
  await page.waitForSelector('text=/What happened last time/i', { timeout: 30000 });
  await wait(1500);
  await glideScroll(120, 900);
  await wait(9000);

  mark('done');
  await context.close(); // finalizes the video file
  await browser.close();

  const file = readdirSync(OUT).find((name) => name.endsWith('.webm'));
  if (file) {
    const target = join(OUT, 'sentinel-memory-demo.webm');
    renameSync(join(OUT, file), target);
    console.log(`\n  Video: ${target}`);
    console.log('  Silent by design — add narration from docs/VIDEO_NARRATION.md.');
    console.log('  YouTube and Vimeo both accept .webm directly.\n');
  }
}

await preflight();
await record();
