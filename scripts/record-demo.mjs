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
// Burn the narration in as on-screen captions. Makes the silent recording
// self-explanatory, so it is submittable as-is if there is no time to record a
// voice track — and doubles as accessibility subtitles if there is.
const CAPTIONS = process.argv.includes('--captions');

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

    // Vercel's Deployment Protection challenge is served as an HTML page with a
    // 2xx status, so a status check alone does not catch it. If we asked for
    // JSON and got a document, say so precisely instead of failing on a JSON
    // parse error that points at the wrong problem.
    const body = await response.text();
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);

    if (looksLikeHtml) {
      const vercelSso =
        /_vercel\/sso|vercel\.com\/sso|Authentication Required|sso-api/i.test(body);

      console.error(`\n  ${BASE}/api/health returned an HTML page, not JSON.`);
      console.error('');
      if (vercelSso) {
        console.error('  It is Vercel\'s Deployment Protection login page.');
        console.error('  The URL works in the browser you are signed into, and is');
        console.error('  invisible to everyone else — including judges, and this script.');
      } else {
        console.error('  Something other than the Sentinel API is answering that path.');
        console.error('  Most often this is Deployment Protection, or a deployment built');
        console.error('  from a branch that does not contain the app.');
      }
      console.error('');
      console.error('  Fix Deployment Protection:');
      console.error('    Vercel -> your project -> Settings -> Deployment Protection');
      console.error('    -> Vercel Authentication -> Disabled  (Save)');
      console.error('');
      console.error('  Then verify in a private/incognito window:');
      console.error(`    ${BASE}/api/health`);
      console.error('  You should see JSON starting with {"status":...\n');
      process.exit(1);
    }

    try {
      health = JSON.parse(body);
    } catch {
      console.error(`\n  ${BASE}/api/health did not return valid JSON.`);
      console.error(`  First bytes: ${body.slice(0, 120).replace(/\s+/g, ' ')}\n`);
      process.exit(1);
    }
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

  // Caption bar. Re-created on demand because a navigation wipes the DOM.
  const caption = async (text, holdMs = 0) => {
    if (CAPTIONS) {
      await page.evaluate((value) => {
        let bar = document.getElementById('__caption');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = '__caption';
          bar.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
            'max-width:1100px', 'z-index:2147483646', 'pointer-events:none',
            'padding:11px 24px', 'border-radius:9px',
            'background:rgba(7,17,31,.93)', 'border:1px solid rgba(36,54,75,.9)',
            'box-shadow:0 8px 32px rgba(0,0,0,.55)',
            'color:#F4F7FA', 'font:500 21px/1.35 ui-sans-serif,system-ui,sans-serif',
            'text-align:center', 'letter-spacing:.1px',
            'opacity:0', 'transition:opacity .28s ease',
          ].join(';');
          document.body.appendChild(bar);
        }
        if (!value) {
          bar.style.opacity = '0';
          return;
        }
        bar.style.opacity = '0';
        setTimeout(() => {
          bar.textContent = value;
          bar.style.opacity = '1';
        }, 140);
      }, text);
    }
    if (holdMs) await page.waitForTimeout(holdMs);
  };

  const started = Date.now();
  const mark = (label) => {
    const total = Math.round((Date.now() - started) / 1000);
    const stamp =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:` +
      `${String(total % 60).padStart(2, '0')}`;
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
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    }, [to, ms]);

  // -- 0:00 the problem ----------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wait(3500);
  mark('the problem — hold on the incident header');
  await glideScroll(120, 1200);
  await caption('During an industrial emergency, the people change faster than the situation does.', 5000);
  await caption('Shifts rotate. Responders hand over. Agent processes restart.', 4500);
  await caption("What gets lost isn't the incident description — it's the consequence of what was already tried.", 5500);

  // -- 0:20 the live incident ---------------------------------------------
  mark('the live incident — observation feed');
  await glideScroll(0, 900);
  await caption('Incident INC-2026-0817 — smoke near Machine 7. Critical, in containment.', 2600);
  await glideTo(page.locator('text=/Pressure reading increasing/').first());
  await caption('Pressure is rising on the Machine 8 header.', 3600);
  await glideTo(page.locator('text=/Main power to the Zone 4 cell/').first());
  await caption('Main power is still live.', 3600);
  await glideTo(page.locator('header select').first());
  await caption('Every observation is a durable row in CockroachDB — not a message in a context window.', 5600);

  // -- 0:45 retrieval ------------------------------------------------------
  mark('retrieval — propose the risky action');
  await glideScroll(320, 900);
  await caption("Here's the reasonable thing to do: restart Machine 7 to clear the fault.", 1800);
  await clickIt(page.getByRole('button', { name: /Check a proposed action against memory/i }));
  await caption("Sentinel embeds that proposal and searches CockroachDB's distributed vector index.", 0);
  await page.waitForSelector('text=/Approve safer action/i', { timeout: 60000 });
  await wait(2500);
  await glideScroll(0, 1000);
  await wait(3200);
  mark('retrieval telemetry');
  await glideTo(page.locator('text=/memories searched/').first());
  await caption('Eighteen memories searched, in milliseconds.', 5200);
  await glideScroll(560, 1300);
  await caption('Each row carries the action taken, the outcome it produced, and the lesson recorded.', 6400);
  await glideScroll(0, 1100);
  await caption('That is the difference between remembering a conversation and remembering a consequence.', 3200);

  // -- 1:15 counterfactual + approval -------------------------------------
  mark('counterfactual card');
  await glideTo(page.locator('text=/What happened last time/').first());
  await caption('The closest match: INC-2025-0412. Same machine, same situation.', 3200);
  await caption('Someone restarted Machine 7 before isolating the shared pressure line.', 3000);
  await caption('Pressure transferred to Machine 8. Secondary valve destroyed. Eleven-hour shutdown.', 3200);
  mark('approve');
  await caption('So Sentinel recommends the safer sequence instead — and cites the memory it came from.', 1200);
  await clickIt(page.getByRole('button', { name: /Approve safer action/i }));
  await caption('A human approves. Sentinel never touches the machine — a person does.', 2500);
  await clickIt(page.getByRole('button', { name: /Approve as authorized responder/i }));
  await caption('Decision, recommendation status, incident state and audit event — one CockroachDB transaction.', 6000);

  // -- 1:40 handoff --------------------------------------------------------
  mark('handoff');
  await clickIt(page.getByRole('link', { name: /Agent Handoff/i }));
  await page.waitForSelector('text=/Backup agent/i', { timeout: 30000 });
  await caption('Now the part that usually breaks everything.', 2800);
  await clickIt(page.getByRole('button', { name: /Simulate Primary Agent Disconnect/i }));
  await caption('The primary agent is gone. The backup has zero context.', 3800);
  await clickIt(page.getByRole('button', { name: /Transfer to Backup Agent/i }));
  await caption('Except the incident was never stored in the agent.', 0);
  await page.waitForSelector('text=/Continuity verified/i', { timeout: 90000 });
  await wait(3800);
  mark('continuity briefing');
  await glideScroll(420, 1500);
  await caption('Sentinel rebuilds it from CockroachDB: what happened, what was attempted...', 6600);
  await glideScroll(900, 1500);
  await caption('...what must not be repeated, current risks, and the next step.', 4800);

  // -- 2:05 the receipts ---------------------------------------------------
  mark('timeline');
  await clickIt(page.getByRole('link', { name: /Incident Timeline/i }));
  await page.waitForSelector('text=/Event stream/i', { timeout: 30000 });
  await caption('Every step is auditable — retrieval, warning, recommendation, approval, handoff.', 2200);
  await glideScroll(500, 2000);
  await wait(3600);
  await glideScroll(1100, 2000);
  await caption('All reconstructed from durable memory events in CockroachDB.', 3600);
  mark('memory explorer');
  await clickIt(page.getByRole('link', { name: /Memory Explorer/i }));
  await wait(3500);
  await glideScroll(260, 1200);
  await caption('The same retrieval is searchable directly — similarity, latency, and which index served it.', 6600);

  // -- 2:30 close ----------------------------------------------------------
  mark('close on the counterfactual');
  await clickIt(page.getByRole('link', { name: /Command Center/i }));
  await page.waitForSelector('text=/What happened last time/i', { timeout: 30000 });
  await wait(1200);
  await glideScroll(120, 900);
  await caption('CockroachDB is the system of record. Amazon Bedrock reasons over what memory returns.', 4200);
  await caption('Normal agents remember conversations.', 2600);
  await caption('Sentinel remembers consequences.', 4200);
  await caption('', 600);

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
