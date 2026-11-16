const { chromium } = require('playwright');
const assert = require('assert');
const file = 'file://' + process.argv[2], SP = process.argv[3];
const seed = (N) => {
  S.viewer = { id: 1, name: 't', mediaListOptions: { scoreFormat: 'POINT_10' } }; S.lastSync = Date.now();
  S.items = {}; S.events = []; S.raw = [];
  for (let i = 1; i <= N; i++) S.items[i] = { id: String(i), title: 'Title ' + i, status: 'COMPLETED', progress: 50, score: 7, baseScore: 7, addedAt: 1, genres: [], tags: [], format: 'MANGA' };
};
(async () => {
  const b = await chromium.launch();
  // ---------- desktop
  let pg = await b.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.route(/^https?:/, r => r.abort());
  await pg.goto(file); await pg.waitForFunction('window.APP_READY');

  // 1. second look
  const r1 = await pg.evaluate((seedSrc) => {
    (0, eval)('(' + seedSrc + ')')(30);
    const old = Date.now() - 400 * 864e5, mid = Date.now() - 90 * 864e5; let n = 0;
    const ev = (a, b, result, t) => S.events.push({ id: 'e' + (n++), t, a: String(a), b: String(b), result });
    // old clear picks, spread over everything; title 1 beat 2 long ago
    ev(1, 2, 'a', old);
    for (let i = 3; i < 30; i++) ev(i, i + 1, 'a', old + i * 1000);
    for (let k = 0; k < 6; k++) for (let i = 1; i <= 30; i++) { const j = (i + 3 + k * 5) % 30 + 1; if (j !== i && !(Math.min(i, j) === 1 && Math.max(i, j) === 2)) ev(Math.min(i, j), Math.max(i, j), 'a', mid + n * 1000); }
    recompute();
    const R = S.ratings, ids = rankedIds();
    const count = (focus, tries = 400) => { let hit = 0; for (let k = 0; k < tries; k++) { const p = choosePair(ids, R, S.events, { focus }); if (p.includes('1') && p.includes('2')) hit++; } return hit / tries; };
    const calm = { p: R['1'].p || 0, sigma: R['1'].sigma, n: R['1'].n, unsure: unsure(R['1']), rate: count('1') };
    R['1'].p = 0.5;   // results started going against its place
    const shaky = { unsure: unsure(R['1']), rate: count('1') };
    const line = recheckLine(['1', '2']), none = recheckLine(['5', '9']);
    // answering it again ends the second look
    S.events.push({ id: 'new', t: Date.now(), a: '1', b: '2', result: 'b' });
    const after = { rate: count('1'), line: recheckLine(['1', '2']) };
    return { calm, shaky, line, none, after };
  }, seed.toString());
  console.log(JSON.stringify(r1));
  assert(!r1.calm.unsure && r1.calm.rate < 0.1, 'calm title is not re-asked');
  assert(r1.shaky.unsure && r1.shaky.rate > 0.3 && r1.shaky.rate < 0.7, 'unsure title re-asked about half the time');
  assert(/second look/.test(r1.line) && r1.none === '' && r1.after.line === '' && r1.after.rate < 0.1);

  // 2. meter
  const r2 = await pg.evaluate(() => { recompute(); go('compare'); return { set: $('m-set').textContent, tip: $('m-set').title, focus: $('focus-line').textContent, done: planNow().done }; });
  console.log(JSON.stringify(r2)); assert(/^\d+% settled$/.test(r2.set));
  await pg.evaluate(() => { const p = buildPlan(); p.rows.forEach((r, i) => { r.settled = i > 1; }); p.done = true; updateMeter(); });
  const f2 = await pg.evaluate(() => $('focus-line').textContent); console.log(f2); 
  await pg.screenshot({ path: SP + '/compare.png' });

  // 3. authors
  const r3 = await pg.evaluate(() => {
    const m = id => ({ status: 'FINISHED', staff: { edges: [
      { role: 'Story & Art', node: { id, name: { full: 'Author ' + id } } }, { role: 'Art', node: { id, name: { full: 'Author ' + id } } },
      { role: 'Translator (English)', node: { id: 900, name: { full: 'Trans Lator' } } }, { role: 'Assistant', node: { id: 901, name: { full: 'Helper' } } }, { role: 'Touch-up Art & Lettering', node: { id: 902, name: { full: 'Letterer' } } }] } });
    const ex = mediaExtras(m(7));
    const before = (renderAuthors(), $('in-authors').textContent);
    // author 10: three ranked titles; author 11: two ranked + one planning; author 12: only one
    [[1, 10], [2, 10], [3, 10], [4, 11], [5, 11], [6, 12]].forEach(([i, a]) => { S.items[i].authors = mediaExtras(m(a)).authors; });
    S.items[99] = { id: '99', title: 'Planned One', status: 'PLANNING', progress: 0, addedAt: 1, authors: [[11, 'Author 11']], format: 'MANGA' };
    for (let i = 7; i <= 30; i++) S.items[i].authors = [];
    recompute(); const A = authorStats(); renderAuthors(); go('insights');
    return { ex: ex.authors, before, list: A.list.map(a => [a.name, a.t.length, a.avg, a.planning]), html: $('in-authors').textContent.replace(/\s+/g, ' '), snap: 'authors' in snapshot().items[1], noStaff: 'authors' in mediaExtras({ status: 'x' }) };
  });
  console.log(JSON.stringify(r3));
  assert.deepStrictEqual(r3.ex, [[7, 'Author 7']]); assert(/Update from AniList/.test(r3.before));
  assert.strictEqual(r3.list.length, 2); assert(!/Author 12/.test(r3.html) && /Planned One/.test(r3.html)); assert(!r3.snap && !r3.noStaff);
  await pg.locator('#in-authors').scrollIntoViewIfNeeded(); await pg.screenshot({ path: SP + '/authors.png' });

  // 4. token expiry, browser: hand-entered date
  const r4 = await pg.evaluate(async () => {
    S.gh = { token: 'ghp_x', id: 'g', at: Date.now(), remember: false }; store.set('setupSec', 'account'); go('setup'); renderCloud();
    const el = $('exp-sync'); const had = !!el; const d = new Date(Date.now() + 5 * 864e5);
    el.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; el.onchange();
    const warn = $('warn-banner').textContent; renderCloud(); const kept = $('exp-sync').value === el.value;
    $('exp-sync').value = ''; $('exp-sync').onchange(); return { had, warn, kept, hidden: $('warn-banner').hidden };
  });
  console.log(JSON.stringify(r4)); assert(r4.had && /GitHub sync token expires in [56] days/.test(r4.warn) && r4.kept && r4.hidden);
  await pg.close();

  // ---------- phone app (Capacitor stubbed)
  pg = await b.newPage({ viewport: { width: 390, height: 800 } }); pg.on('pageerror', e => errs.push('app: ' + e));
  await pg.route(/^https?:/, r => r.abort());
  await pg.addInitScript(() => {
    window.__calls = [];
    const noop = new Proxy({}, { get: () => async () => ({}) });
    window.Capacitor = { isNativePlatform: () => true, convertFileSrc: x => x, Plugins: new Proxy({ CapacitorHttp: { get: async o => { window.__calls.push(o); return { status: 200, data: {}, headers: window.__hdr || {} }; } },
      App: { addListener() {}, getLaunchUrl: async () => null, getInfo: async () => ({ version: '1.0.12', build: '12' }), minimizeApp() {} } }, { get: (t, k) => t[k] || noop }) };
  });
  await pg.goto(file); await pg.waitForFunction('window.APP_READY');
  const r5 = await pg.evaluate(async () => {
    const soon = new Date(Date.now() + 3 * 864e5).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    window.__hdr = { 'GitHub-Authentication-Token-Expiration': soon };
    S.gh = { token: 'ghp_secret', id: 'g', at: Date.now(), remember: false };
    await checkSyncExpiry(); await checkSyncExpiry();   // second call within a day does nothing
    const c = window.__calls.filter(x => /rate_limit/.test(x.url));
    const warn = $('warn-banner').textContent; store.set('setupSec', 'account'); go('setup'); renderCloud();
    const body = $('cloud-body').textContent;
    // a token that never expires clears the warning
    window.__hdr = {}; expCheckedAt = 0; await checkSyncExpiry();
    return { isApp: IS_APP, n: c.length, url: c[0]?.url, auth: c[0]?.headers.Authorization, warn, auto: /This token expires on/.test(body), field: !!$('exp-sync'), hiddenAfter: $('warn-banner').hidden };
  });
  console.log(JSON.stringify(r5));
  assert(r5.isApp && r5.n === 1 && r5.auth === 'Bearer ghp_secret' && /sync token expires in [34] days/.test(r5.warn) && r5.auto && !r5.field && r5.hiddenAfter);
  console.log('page errors:', errs); assert.strictEqual(errs.length, 0);
  console.log('ALL PASSED'); await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
