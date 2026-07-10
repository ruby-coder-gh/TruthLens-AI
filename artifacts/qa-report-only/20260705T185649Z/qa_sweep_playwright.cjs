const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173';
const RUN_ID = process.env.RUN_ID || '20260705T185649Z';
const ROOT = path.resolve(process.cwd(), `artifacts/qa-report-only/${RUN_ID}`);

fs.mkdirSync(ROOT, { recursive: true });

function rel(absPath) {
  return path.relative(process.cwd(), absPath).split(path.sep).join('/');
}

(async () => {
  const flowResults = [];
  const flowIndex = new Map();
  const discoveredLinks = [];
  const consoleEvents = [];
  const networkEvents = [];
  let currentFlow = 'bootstrap';

  const ensureFlow = (name) => {
    if (!flowIndex.has(name)) {
      const flow = { flow: name, status: 'passed', checks: [] };
      flowIndex.set(name, flow);
      flowResults.push(flow);
    }
    return flowIndex.get(name);
  };

  const addCheck = (flowName, check) => {
    const flow = ensureFlow(flowName);
    flow.checks.push(check);
    if (check.status === 'failed') {
      flow.status = 'failed';
    } else if (check.status === 'blocked' && flow.status === 'passed') {
      flow.status = 'blocked';
    }
  };

  const toUrl = (route) => {
    try {
      return new URL(route, FRONTEND_URL).toString();
    } catch {
      return FRONTEND_URL;
    }
  };

  const routeLabel = (route) => {
    const clean = (route || '/').replace(/^https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return clean || 'root';
  };

  const looksDenied = (requestedRoute, finalUrl, text) => {
    const req = (requestedRoute || '').toLowerCase();
    const fin = (finalUrl || '').toLowerCase();
    const t = (text || '').toLowerCase();
    const redirectedToAuth = fin.includes('/login') || fin.includes('/signin') || fin.includes('/register');
    const deniedText =
      t.includes('access denied') ||
      t.includes('unauthorized') ||
      t.includes('forbidden') ||
      t.includes('please log in') ||
      t.includes('please login') ||
      t.includes('sign in to continue') ||
      t.includes('login required');
    const requestedAdminOrProtected = req.includes('/admin') || req.includes('/workspace') || req.includes('/chat');
    return redirectedToAuth || deniedText || (requestedAdminOrProtected && fin.includes('/login'));
  };

  let browser;
  let context;
  let page;

  const capture = async (name) => {
    const abs = path.join(ROOT, `${name}.png`);
    try {
      await page.screenshot({ path: abs, fullPage: true });
      return rel(abs);
    } catch {
      return null;
    }
  };

  const bodyText = async () => {
    try {
      const txt = await page.locator('body').innerText({ timeout: 5000 });
      return txt || '';
    } catch {
      return '';
    }
  };

  const hasAuthToken = async () => {
    try {
      return await page.evaluate(() => {
        const keys = Object.keys(localStorage);
        return keys.some((k) => {
          const v = localStorage.getItem(k);
          return /(token|auth|jwt|session)/i.test(k) && v && v.length > 0;
        });
      });
    } catch {
      return false;
    }
  };

  const clearClientSession = async () => {
    try {
      await context.clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch {
      // ignore
    }
  };

  const safeGoto = async (route) => {
    const target = toUrl(route);
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1200);
      return { ok: true, target, finalUrl: page.url(), error: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, target, finalUrl: page.url(), error: message };
    }
  };

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        consoleEvents.push({
          flow: currentFlow,
          type,
          text: msg.text(),
        });
      }
    });

    page.on('pageerror', (err) => {
      consoleEvents.push({
        flow: currentFlow,
        type: 'pageerror',
        text: String(err),
      });
    });

    page.on('requestfailed', (request) => {
      networkEvents.push({
        flow: currentFlow,
        url: request.url(),
        method: request.method(),
        status: null,
        failureText: request.failure()?.errorText || 'unknown',
        resourceType: request.resourceType(),
      });
    });

    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400) {
        networkEvents.push({
          flow: currentFlow,
          url: response.url(),
          method: response.request().method(),
          status,
          failureText: null,
          resourceType: response.request().resourceType(),
        });
      }
    });

    // Flow 1: public pages
    currentFlow = 'public_pages';
    ensureFlow('public_pages');

    const homeNav = await safeGoto('/');
    const homeShot = await capture('public-home');
    const homeText = await bodyText();
    addCheck('public_pages', {
      name: 'Load home page',
      status: homeNav.ok ? 'passed' : 'failed',
      expected: 'Home page renders without crashes.',
      actual: homeNav.ok
        ? `Loaded ${homeNav.finalUrl}; body length ${homeText.length}.`
        : `Navigation failed: ${homeNav.error || 'unknown error'}`,
      route: '/',
      evidence_paths: [homeShot].filter(Boolean),
    });

    let navLinks = [];
    if (homeNav.ok) {
      try {
        navLinks = await page.evaluate(() => {
          const out = [];
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const a of anchors) {
            const visible = !!(a.offsetParent || a.getClientRects().length);
            if (!visible) continue;
            const href = a.getAttribute('href') || '';
            const text = (a.textContent || '').trim();
            out.push({ href, text });
          }
          return out;
        });
      } catch {
        navLinks = [];
      }
    }

    const origin = new URL(FRONTEND_URL).origin;
    const seen = new Set(['/']);
    const normalized = [];
    for (const link of navLinks) {
      if (!link?.href) continue;
      const href = String(link.href).trim();
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        continue;
      }
      let u;
      try {
        u = new URL(href, FRONTEND_URL);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      const route = `${u.pathname}${u.search}${u.hash}`;
      if (seen.has(route)) continue;
      seen.add(route);
      normalized.push({ route, text: link.text || route });
    }

    const publicLinks = normalized.slice(0, 10);
    discoveredLinks.push(...publicLinks.map((x) => x.route));

    if (publicLinks.length === 0) {
      addCheck('public_pages', {
        name: 'Discover visible public nav links',
        status: 'blocked',
        expected: 'At least one visible public navigation link should be discoverable.',
        actual: 'No visible public nav links were detected on home page.',
        route: '/',
        evidence_paths: [homeShot].filter(Boolean),
      });
    } else {
      for (let i = 0; i < publicLinks.length; i += 1) {
        const link = publicLinks[i];
        const nav = await safeGoto(link.route);
        const shot = await capture(`public-link-${i + 1}-${routeLabel(link.route)}`);
        const text = await bodyText();
        addCheck('public_pages', {
          name: `Visit public nav link ${i + 1}: ${link.text}`,
          status: nav.ok ? 'passed' : 'failed',
          expected: 'Linked page renders without crash.',
          actual: nav.ok
            ? `Loaded ${nav.finalUrl}; body length ${text.length}.`
            : `Navigation failed: ${nav.error || 'unknown error'}`,
          route: link.route,
          evidence_paths: [shot].filter(Boolean),
        });
      }
    }

    // Flow 2: invalid login
    currentFlow = 'invalid_login';
    ensureFlow('invalid_login');

    const loginCandidate = publicLinks.find((l) => /login|sign-in|signin/i.test(l.route) || /login|sign in/i.test(l.text));
    const loginRoute = loginCandidate?.route || '/login';
    const loginNav = await safeGoto(loginRoute);
    const invalidLoginBefore = await capture(`invalid-login-before-${routeLabel(loginRoute)}`);

    if (!loginNav.ok) {
      addCheck('invalid_login', {
        name: 'Open login page for invalid credential check',
        status: 'failed',
        expected: 'Login page is reachable for authentication test.',
        actual: `Login route navigation failed: ${loginNav.error || 'unknown error'}`,
        route: loginRoute,
        evidence_paths: [invalidLoginBefore].filter(Boolean),
      });
    } else {
      const emailLocator = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first();
      const passwordLocator = page.locator('input[type="password"], input[name*="password" i], input[placeholder*="password" i]').first();
      const emailCount = await emailLocator.count();
      const passwordCount = await passwordLocator.count();

      if (emailCount < 1 || passwordCount < 1) {
        const after = await capture('invalid-login-missing-form');
        addCheck('invalid_login', {
          name: 'Login form fields present',
          status: 'blocked',
          expected: 'Email and password fields visible on login page.',
          actual: `Detected email fields: ${emailCount}, password fields: ${passwordCount}.`,
          route: loginRoute,
          evidence_paths: [invalidLoginBefore, after].filter(Boolean),
        });
      } else {
        await emailLocator.fill('qa-invalid@example.com');
        await passwordLocator.fill('WrongPass123!');

        const submitCandidates = [
          page.locator('button[type="submit"]').first(),
          page.getByRole('button', { name: /log in|login|sign in|signin/i }).first(),
          page.locator('input[type="submit"]').first(),
        ];
        let submitted = false;
        for (const candidate of submitCandidates) {
          if (await candidate.count()) {
            try {
              await candidate.click({ timeout: 4000 });
              submitted = true;
              break;
            } catch {
              // continue
            }
          }
        }
        if (!submitted) {
          try {
            await passwordLocator.press('Enter');
            submitted = true;
          } catch {
            submitted = false;
          }
        }

        await page.waitForTimeout(1800);
        const invalidLoginAfter = await capture('invalid-login-after-submit');
        const text = await bodyText();
        const finalUrl = page.url();
        const tokenPresent = await hasAuthToken();
        const hasErrorText = /invalid|incorrect|wrong|failed|error|unauthorized|does not match/i.test(text);
        const stayedOnAuthPage = /\/login|\/signin|\/sign-in|\/register/.test(finalUrl.toLowerCase());
        const rejected = !tokenPresent && (hasErrorText || stayedOnAuthPage);
        const clearErrorShown = hasErrorText;

        const status = rejected && clearErrorShown ? 'passed' : 'failed';
        addCheck('invalid_login', {
          name: 'Reject invalid login credentials',
          status,
          expected: 'Invalid credentials are rejected with clear error and no authenticated session.',
          actual: `finalUrl=${finalUrl}; tokenPresent=${tokenPresent}; hasErrorText=${hasErrorText}; stayedOnAuthPage=${stayedOnAuthPage}`,
          route: loginRoute,
          evidence_paths: [invalidLoginBefore, invalidLoginAfter].filter(Boolean),
        });
      }
    }

    // Flow 3: workspace/chat access logged out
    currentFlow = 'workspace_chat_access';
    ensureFlow('workspace_chat_access');

    await safeGoto('/');
    await clearClientSession();

    const workspaceChatRoutes = [];
    const discoveredProtected = publicLinks
      .map((l) => l.route)
      .filter((r) => /workspace|chat/i.test(r));
    workspaceChatRoutes.push(...discoveredProtected);
    workspaceChatRoutes.push('/workspace', '/chat');

    const dedupRoutes = Array.from(new Set(workspaceChatRoutes)).slice(0, 10);
    for (let i = 0; i < dedupRoutes.length; i += 1) {
      const route = dedupRoutes[i];
      const nav = await safeGoto(route);
      const shot = await capture(`workspace-chat-${i + 1}-${routeLabel(route)}`);
      const text = await bodyText();
      const denied = looksDenied(route, page.url(), text);
      addCheck('workspace_chat_access', {
        name: `Logged-out protected route check: ${route}`,
        status: nav.ok ? (denied ? 'passed' : 'failed') : 'failed',
        expected: 'Logged-out user should be redirected to login or shown access denied.',
        actual: nav.ok
          ? `finalUrl=${page.url()}; deniedDetected=${denied}`
          : `Navigation failed: ${nav.error || 'unknown error'}`,
        route,
        evidence_paths: [shot].filter(Boolean),
      });
    }

    // Flow 4: invalid route
    currentFlow = 'invalid_route';
    ensureFlow('invalid_route');

    const invalidRoute = '/__qa_invalid_route__';
    const invalidRouteNav = await safeGoto(invalidRoute);
    const invalidRouteShot = await capture('invalid-route');
    const invalidText = await bodyText();
    const graceful404 = /404|not found|page not found|doesn\'t exist|cannot find/i.test(invalidText);

    addCheck('invalid_route', {
      name: 'Graceful not-found state for invalid route',
      status: invalidRouteNav.ok ? (graceful404 ? 'passed' : 'failed') : 'failed',
      expected: 'Application shows graceful 404/not-found state without crash.',
      actual: invalidRouteNav.ok
        ? `finalUrl=${page.url()}; graceful404Detected=${graceful404}`
        : `Navigation failed: ${invalidRouteNav.error || 'unknown error'}`,
      route: invalidRoute,
      evidence_paths: [invalidRouteShot].filter(Boolean),
    });

    // Flow 5: admin logged out
    currentFlow = 'admin_access_logged_out';
    ensureFlow('admin_access_logged_out');

    await safeGoto('/');
    await clearClientSession();
    const adminLoggedOutNav = await safeGoto('/admin');
    const adminLoggedOutShot = await capture('admin-logged-out');
    const adminLoggedOutText = await bodyText();
    const deniedLoggedOut = looksDenied('/admin', page.url(), adminLoggedOutText);

    addCheck('admin_access_logged_out', {
      name: 'Logged-out /admin access denied',
      status: adminLoggedOutNav.ok ? (deniedLoggedOut ? 'passed' : 'failed') : 'failed',
      expected: 'Logged-out user cannot access /admin (redirect/login/403).',
      actual: adminLoggedOutNav.ok
        ? `finalUrl=${page.url()}; deniedDetected=${deniedLoggedOut}`
        : `Navigation failed: ${adminLoggedOutNav.error || 'unknown error'}`,
      route: '/admin',
      evidence_paths: [adminLoggedOutShot].filter(Boolean),
    });

    // Flow 6: admin non-admin
    currentFlow = 'admin_access_non_admin';
    ensureFlow('admin_access_non_admin');

    const signupCandidate = publicLinks.find((l) => /register|signup|sign-up|create-account/i.test(l.route) || /register|sign up|create account/i.test(l.text));
    const signupRoute = signupCandidate?.route || '/register';

    const signupNav = await safeGoto(signupRoute);
    const signupBeforeShot = await capture(`admin-non-admin-signup-before-${routeLabel(signupRoute)}`);

    if (!signupNav.ok) {
      addCheck('admin_access_non_admin', {
        name: 'Open self-signup path for non-admin flow',
        status: 'blocked',
        expected: 'Non-admin test should create or use non-admin account.',
        actual: `Signup route not reachable: ${signupNav.error || 'unknown error'}`,
        route: signupRoute,
        evidence_paths: [signupBeforeShot].filter(Boolean),
      });
    } else {
      const email = `qa_non_admin_${Date.now()}@example.com`;
      const username = `qa_non_admin_${Math.floor(Math.random() * 100000)}`;
      const password = 'TestPass123!';

      const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
      const passwordInputs = page.locator('input[type="password"], input[name*="password" i]');
      const textInput = page
        .locator('#username, input[id*="username" i], input[name*="username" i], input[placeholder*="username" i], input[placeholder*="yourname" i], input[name*="name" i]')
        .first();

      const emailFound = (await emailInput.count()) > 0;
      const passwordCount = await passwordInputs.count();
      if (!emailFound || passwordCount < 1) {
        const signupNoFormShot = await capture('admin-non-admin-signup-form-missing');
        addCheck('admin_access_non_admin', {
          name: 'Self-signup form available',
          status: 'blocked',
          expected: 'Self-signup form available to create non-admin user.',
          actual: `emailFound=${emailFound}; passwordFields=${passwordCount}`,
          route: signupRoute,
          evidence_paths: [signupBeforeShot, signupNoFormShot].filter(Boolean),
        });
      } else {
        await emailInput.fill(email);
        if ((await textInput.count()) > 0) {
          await textInput.fill(username);
        }
        await passwordInputs.nth(0).fill(password);
        if (passwordCount > 1) {
          await passwordInputs.nth(1).fill(password);
        }

        let submitted = false;
        const submitButtons = [
          page.locator('button[type="submit"]').first(),
          page.getByRole('button', { name: /register|sign up|create account|create/i }).first(),
          page.locator('input[type="submit"]').first(),
        ];
        for (const btn of submitButtons) {
          if (await btn.count()) {
            try {
              await btn.click({ timeout: 4000 });
              submitted = true;
              break;
            } catch {
              // continue
            }
          }
        }
        if (!submitted) {
          try {
            await passwordInputs.nth(0).press('Enter');
            submitted = true;
          } catch {
            submitted = false;
          }
        }

        await page.waitForTimeout(2000);
        const signupAfterShot = await capture('admin-non-admin-signup-after-submit');
        const signupText = await bodyText();
        let loggedIn = await hasAuthToken();

        if (!loggedIn) {
          const loginTry = await safeGoto('/login');
          if (loginTry.ok) {
            const loginEmail = page.locator('input[type="email"], input[name*="email" i]').first();
            const loginPassword = page.locator('input[type="password"], input[name*="password" i]').first();
            if ((await loginEmail.count()) > 0 && (await loginPassword.count()) > 0) {
              await loginEmail.fill(email);
              await loginPassword.fill(password);
              const loginBtn = page.locator('button[type="submit"], input[type="submit"]').first();
              if ((await loginBtn.count()) > 0) {
                await loginBtn.click();
              } else {
                await loginPassword.press('Enter');
              }
              await page.waitForTimeout(2000);
              await capture('admin-non-admin-login-after-submit');
              loggedIn = await hasAuthToken();
            }
          }
        }

        if (!loggedIn) {
          addCheck('admin_access_non_admin', {
            name: 'Establish non-admin authenticated session',
            status: 'blocked',
            expected: 'Create/login non-admin user before testing /admin denial.',
            actual: `Could not confirm non-admin login. signupSubmitted=${submitted}; currentUrl=${page.url()}; signupTextHasError=${/error|invalid|failed|exists/i.test(signupText)}`,
            route: signupRoute,
            evidence_paths: [signupBeforeShot, signupAfterShot].filter(Boolean),
          });
        } else {
          const adminAsUserNav = await safeGoto('/admin');
          const adminAsUserShot = await capture('admin-non-admin-admin-route');
          const adminAsUserText = await bodyText();
          const deniedAsUser = looksDenied('/admin', page.url(), adminAsUserText) || /forbidden|not authorized|access denied/i.test(adminAsUserText.toLowerCase());
          addCheck('admin_access_non_admin', {
            name: 'Non-admin /admin access denied',
            status: adminAsUserNav.ok ? (deniedAsUser ? 'passed' : 'failed') : 'failed',
            expected: 'Non-admin user cannot access /admin (redirect/login/403).',
            actual: adminAsUserNav.ok
              ? `finalUrl=${page.url()}; deniedDetected=${deniedAsUser}`
              : `Navigation failed: ${adminAsUserNav.error || 'unknown error'}`,
            route: '/admin',
            evidence_paths: [adminAsUserShot, signupAfterShot].filter(Boolean),
          });
        }
      }
    }
  } catch (fatal) {
    const message = fatal instanceof Error ? `${fatal.name}: ${fatal.message}` : String(fatal);
    const fatalPath = path.join(ROOT, 'fatal-error.txt');
    fs.writeFileSync(fatalPath, message);
    ensureFlow('public_pages');
    addCheck('public_pages', {
      name: 'Fatal runtime',
      status: 'failed',
      expected: 'QA sweep runs to completion.',
      actual: message,
      route: '/',
      evidence_paths: [rel(fatalPath)],
    });
  } finally {
    const consolePath = path.join(ROOT, 'console-events.json');
    const networkPath = path.join(ROOT, 'network-events.json');
    const rawPath = path.join(ROOT, 'flow-results-raw.json');

    fs.writeFileSync(consolePath, JSON.stringify(consoleEvents, null, 2));
    fs.writeFileSync(networkPath, JSON.stringify(networkEvents, null, 2));
    fs.writeFileSync(
      rawPath,
      JSON.stringify(
        {
          frontend_url: FRONTEND_URL,
          run_id: RUN_ID,
          discovered_links: discoveredLinks,
          flow_results: flowResults,
          console_events_path: rel(consolePath),
          network_events_path: rel(networkPath),
        },
        null,
        2,
      ),
    );

    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
})();
