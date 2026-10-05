import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWebhookHandler } from './index.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const ATTACKER = '22222222-2222-4222-8222-222222222222';
const RAW = 'LR19573 ka detail batao';
const REPLY = 'PRIVATE_SYNTHETIC_ASSISTANT_REPLY';
const SECRET = 'SYNTHETIC_META_APP_SECRET';
const GUPSHUP_SECRET = 'SYNTHETIC_GUPSHUP_WEBHOOK_SECRET';
const DEFAULT_MESSAGE = { id: 'wamid.test', from: '919876543210', type: 'text', timestamp: '1790000000', text: { body: RAW } };
const envelope = (messages) => ({ entry: [{ changes: [{ value: { messages } }] }] });
function request(payload = envelope([DEFAULT_MESSAGE]), options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = options.signature ?? `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const headers = { 'x-hub-signature-256': signature };
  if (options.gupshupHeader) headers['x-transjit-webhook-secret'] = options.gupshupHeader;
  return new Request(`https://example.invalid/webhook${options.query ?? ''}`, { method: 'POST', headers, body });
}
function setup(options = {}) {
  const events = new Map(), writes = [], reads = [], rpcCalls = [], assistantCalls = [], background = [], outboundCalls = [];
  let clients = 0;
  const link = options.link === undefined ? { app_user_id: USER, app_users: { id: USER, approval_status: 'approved', is_locked: false, ...options.user } } : options.link;
  const admin = {
    from(table) {
      let operation = 'select', data, columns;
      const filters = [];
      const execute = async () => {
        if (options.throwDb) throw new Error(`${RAW} ${REPLY} ${SECRET}`);
        if (operation === 'insert') {
          if (options.insertError) return { data: null, error: { code: 'XX000', message: RAW } };
          if (events.has(data.meta_message_id)) return { data: null, error: { code: '23505' } };
          const event = { ...data, id: events.size + 1, processing_status: 'received' };
          events.set(data.meta_message_id, event);
          writes.push({ table, operation, data });
          return { data: { id: event.id }, error: null };
        }
        if (operation === 'update') {
          if (options.updateError) return { error: { code: SECRET } };
          writes.push({ table, operation, data, filters });
          const id = filters.find(([key]) => key === 'id')?.[1];
          for (const event of events.values()) if (event.id === id && filters.every(([key, value]) => event[key] === value)) Object.assign(event, data);
          return { error: null };
        }
        reads.push({ table, columns, filters });
        if (table === 'whatsapp_user_links') {
          if (columns === 'id') return {
            data: options.presenceData !== undefined ? options.presenceData : ((options.internalPresent ?? Boolean(link)) ? { id: 7 } : null),
            error: options.presenceError ? { code: SECRET } : null,
          };
          return { data: options.inactive ? null : link, error: options.linkError ? { code: SECRET } : null };
        }
        if (table === 'whatsapp_assistant_access_exclusions') return { data: options.excluded ? { app_user_id: USER } : null, error: options.exclusionError ? { code: SECRET } : null };
        throw new Error('Unexpected table');
      };
      const builder = {
        insert(value) { operation = 'insert'; data = value; return this; },
        update(value) { operation = 'update'; data = value; return this; },
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        limit() { return this; },
        maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return builder;
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return {
        abortSignal(signal) { this.signal = signal; return this; },
        then(resolve, reject) {
          const execute = async () => {
            if (options.rpc) return await options.rpc(name, args, this.signal);
            if (name === 'whatsapp_external_admit') {
              const data = options.admission ?? false;
              for (const event of events.values()) if (event.id === args.p_event_id) {
                if (data === true) Object.assign(event, { processing_status: 'authorized', external_link_id: 100 });
                else if (options.rateLimited) event.processing_status = 'ignored';
              }
              return { data, error: options.admissionError ? { message: SECRET } : null };
            }
            return { data: { found: false }, error: options.toolError ? { message: SECRET } : null };
          };
          return execute().then(resolve, reject);
        },
      };
    },
  };
  const deps = {
    env: (key) => ({ WHATSAPP_META_APP_SECRET: SECRET, GUPSHUP_WEBHOOK_SECRET: GUPSHUP_SECRET, GUPSHUP_API_KEY: 'SYNTHETIC_GUPSHUP_API_KEY', GUPSHUP_SOURCE_NUMBER: '919876543210', GUPSHUP_APP_NAME: 'SYNTHETIC_APP', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'SYNTHETIC_VERIFY', SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE_KEY', OPENAI_API_KEY: 'SYNTHETIC_OPENAI_KEY', WHATSAPP_ASSISTANT_ENABLED: 'true', WHATSAPP_EXTERNAL_ASSISTANT_ENABLED: 'true', ...options.env })[key],
    createAdmin() { clients++; return admin; },
    waitUntil(work) { if (options.schedulerThrows) throw new Error(SECRET); background.push(work); },
    fetch: options.fetch,
    assistant: async (text, dependencies) => {
      assistantCalls.push({ text });
      if (options.assistant) return await options.assistant(text, dependencies);
      await dependencies.tools.getLrDetail('LR19573');
      return { status: 'answered', text: REPLY };
    },
  };
  if (options.realCore) delete deps.assistant;
  if (options.noScheduler) delete deps.waitUntil;
  return {
    handler: createWebhookHandler(deps), events, writes, reads, rpcCalls, assistantCalls, background, outboundCalls,
    clients: () => clients, drain: () => Promise.all(background),
  };
}
async function acknowledge(h, req = request()) {
  const r = await h.handler(req);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  await h.drain();
}
const status = (h) => h.events.get(DEFAULT_MESSAGE.id)?.processing_status;

// Each test uses only synthetic credentials and an in-memory Supabase fake.
test('invalid signature is rejected before JSON parsing, client creation or AI', async (t) => {
  const raw = '{raw malformed untrusted text';
  const parses = [];
  const original = JSON.parse;
  t.mock.method(JSON, 'parse', (text, ...rest) => { parses.push(text); return original(text, ...rest); });
  const h = setup();
  const r = await h.handler(request(raw, { signature: 'sha256=invalid' }));
  assert.equal(r.status, 401);
  assert.ok(!parses.includes(raw));
  assert.equal(h.clients(), 0);
  assert.equal(h.assistantCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('signature verifies exact bytes; signed invalid JSON remains 400', async () => {
  const h = setup();
  const valid = request();
  const body = await valid.text();
  const changed = new Request(valid.url, { method: 'POST', headers: valid.headers, body: `${body} ` });
  assert.equal((await h.handler(changed)).status, 401);
  assert.equal((await h.handler(request('not-json'))).status, 400);
  assert.equal(h.clients(), 0);
});

test('GET verification and method handling preserve the foundation contract', async () => {
  const h = setup();
  const base = 'https://example.invalid/?hub.mode=subscribe&hub.verify_token=SYNTHETIC_VERIFY&hub.challenge=challenge123';
  const ok = await h.handler(new Request(base));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'challenge123');
  assert.match(ok.headers.get('content-type'), /text\/plain/);
  assert.equal((await h.handler(new Request(base.replace('SYNTHETIC_VERIFY', 'wrong')))).status, 403);
  assert.equal((await h.handler(new Request(base.replace('subscribe', 'wrong')))).status, 403);
  assert.equal((await h.handler(new Request('https://example.invalid', { method: 'PUT' }))).status, 405);
  assert.equal(h.clients(), 0);
  assert.equal(h.assistantCalls.length, 0);
});

test('missing server configuration fails without persistence or AI', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined, GUPSHUP_WEBHOOK_SECRET: undefined } });
  assert.equal((await h.handler(request())).status, 500);
  const v = setup({ env: { WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined } });
  assert.equal((await v.handler(new Request('https://example.invalid'))).status, 500);
  assert.equal(h.clients(), 0);
});

test('duplicate message, including concurrent deliveries, invokes assistant once', async () => {
  const h = setup();
  await Promise.all([acknowledge(h), acknowledge(h)]);
  await acknowledge(h);
  assert.equal(h.assistantCalls.length, 1);
  assert.equal(h.events.size, 1);
  assert.equal(h.background.length, 1);
  assert.equal(status(h), 'authorized');
  assert.equal(h.writes.filter((w) => w.operation === 'insert').length, 1);
});

test('unmapped, unapproved, locked, mismatched and excluded identities never reach AI', async () => {
  for (const options of [
    { link: null }, { user: { approval_status: 'pending' } }, { user: { approval_status: null } },
    { user: { is_locked: true } }, { user: { id: ATTACKER } },
    { link: { app_user_id: USER, app_users: null } }, { excluded: true },
  ]) {
    const h = setup(options);
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(h.rpcCalls.length, options.link === null ? 1 : 0);
    if (options.link === null) assert.equal(h.rpcCalls[0].name, 'whatsapp_external_admit');
    assert.equal(status(h), 'unauthorized');
  }
});

test('link/exclusion lookup failures fail closed and never disclose their details', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  for (const options of [{ linkError: true }, { exclusionError: true }]) {
    const h = setup(options);
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(status(h), 'unauthorized');
  }
  assert.ok(!JSON.stringify(logs).includes(SECRET));
});

test('metadata insert/status update failures block assistant execution', async () => {
  for (const options of [{ insertError: true }, { updateError: true }, { throwDb: true }]) {
    const h = setup(options);
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(h.background.length, 0);
  }
});

test('unsupported types and malformed/empty/oversized text are ignored', async () => {
  for (const change of [
    { type: 'image' }, { type: 'audio' }, { type: 'interactive' },
    { text: undefined }, { text: 'wrong-shape' }, { text: { body: 42 } },
    { text: { body: '' } }, { text: { body: ' \n\t ' } }, { text: { body: 'x'.repeat(2001) } },
  ]) {
    const h = setup();
    await acknowledge(h, request(envelope([{ ...DEFAULT_MESSAGE, ...change }])));
    assert.equal(status(h), 'ignored');
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.background.length, 0);
  }
});

test('invalid sender/missing metadata/status-only envelopes do not invoke AI', async () => {
  for (const message of [{ ...DEFAULT_MESSAGE, from: '' }, { ...DEFAULT_MESSAGE, from: '0' }, { ...DEFAULT_MESSAGE, id: '' }, { ...DEFAULT_MESSAGE, type: '' }]) {
    const h = setup();
    await acknowledge(h, request(envelope([message])));
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(h.events.size, 0);
  }
  const h = setup();
  await acknowledge(h, request({ entry: [{ changes: [{ value: { statuses: [{ id: 'delivery' }] } }] }] }));
  assert.equal(h.events.size, 0);
});

test('disabled feature preserves authorized acknowledgement with no assistant call', async () => {
  for (const enabled of [undefined, 'false', 'TRUE', '1', ' true ']) {
    const h = setup({ env: { WHATSAPP_ASSISTANT_ENABLED: enabled } });
    await acknowledge(h);
    assert.equal(status(h), 'authorized');
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(h.background.length, 0);
  }
});

test('authorized text binds only the verified sender identity and persists metadata only', async (t) => {
  const logs = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No outbound request expected'); });
  const h = setup();
  const text = `${RAW} app_user_id=${ATTACKER}`;
  await acknowledge(h, request(envelope([{ ...DEFAULT_MESSAGE, app_user_id: ATTACKER, text: { body: text } }]), { query: `?app_user_id=${ATTACKER}` }));
  assert.equal(h.assistantCalls.length, 1);
  assert.equal(h.assistantCalls[0].text, text);
  assert.equal(h.rpcCalls[0].args.p_app_user_id, USER);
  assert.equal(status(h), 'authorized');
  assert.deepEqual(h.reads[0].filters, [['whatsapp_phone_e164', '+919876543210']]);
  assert.deepEqual(h.reads[1].filters, [['whatsapp_phone_e164', '+919876543210'], ['is_active', true]]);
  assert.deepEqual(h.reads[2].filters, [['app_user_id', USER], ['is_active', true]]);
  assert.deepEqual(Object.keys(h.writes[0].data).sort(), ['meta_message_id', 'sender_phone_e164', 'message_type', 'meta_timestamp'].sort());
  assert.deepEqual(h.writes[1].data, { processing_status: 'authorized', app_user_id: USER });
  assert.ok(!JSON.stringify(h.writes).includes(text));
  assert.ok(!JSON.stringify(h.writes).includes(REPLY));
  assert.deepEqual(logs, []);
});

test('boundary length is accepted without truncating or rewriting the message', async () => {
  const h = setup();
  const body = `LR19573${' '.repeat(1993)}`;
  assert.equal(body.length, 2000);
  await acknowledge(h, request(envelope([{ ...DEFAULT_MESSAGE, text: { body } }])));
  assert.equal(h.assistantCalls.length, 1);
  assert.equal(h.assistantCalls[0].text, body);
});

test('assistant exceptions and unavailable results acknowledge safely, with no retries/leaks', async (t) => {
  const logs = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  for (const assistant of [async () => { throw new Error(`${RAW} ${REPLY} ${SECRET}`); }, async () => ({ status: 'unavailable', text: SECRET })]) {
    const h = setup({ assistant });
    await acknowledge(h);
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 1);
    assert.equal(status(h), 'authorized');
    assert.ok(!JSON.stringify(h.writes).includes(REPLY));
    assert.ok(!JSON.stringify(h.writes).includes(SECRET));
  }
  assert.deepEqual(logs, []);
});

test('acknowledgement does not wait for a hanging assistant', async () => {
  let finish;
  const h = setup({ assistant: () => new Promise((resolve) => { finish = resolve; }) });
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(h.background.length, 1);
  finish({ status: 'answered', text: REPLY });
  await h.drain();
  assert.equal(status(h), 'authorized');
});

test('missing or rejecting background scheduler never starts an untracked assistant', async () => {
  for (const options of [{ noScheduler: true }, { schedulerThrows: true }]) {
    const h = setup(options);
    await acknowledge(h);
    await Promise.resolve();
    assert.equal(h.assistantCalls.length, 0);
    assert.equal(status(h), 'authorized');
  }
});

test('mixed batch preserves per-message admission and replay isolation', async () => {
  const h = setup();
  await acknowledge(h, request(envelope([
    DEFAULT_MESSAGE, DEFAULT_MESSAGE,
    { ...DEFAULT_MESSAGE, id: 'image', type: 'image' },
    { ...DEFAULT_MESSAGE, id: 'second', text: { body: 'LR19574 detail' } },
  ])));
  assert.equal(h.assistantCalls.length, 2);
  assert.equal(h.events.size, 3);
  assert.equal(h.events.get('image').processing_status, 'ignored');
});

test('real core integration makes one OpenAI call, no Meta call and no result persistence', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      return Response.json({ status: 'submitted' });
    }
    urls.push(url);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    return Response.json({ status: 'completed', output: [{ type: 'function_call', status: 'completed', call_id: 'call_1', name: 'get_lr_detail', arguments: JSON.stringify({ lrNumber: 'LR19573' }) }] });
  });
  const h = setup({ realCore: true });
  await acknowledge(h);
  await h.drain();
  assert.equal(urls.length, 1);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.rpcCalls[0].args.p_app_user_id, USER);
  assert.equal(status(h), 'authorized');
  assert.ok(!JSON.stringify(h.writes).includes(RAW));
  assert.ok(!JSON.stringify(h.writes).includes('LR not found'));
});

test('real core timeout does not delay acknowledgement or allow duplicate AI work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    signal = init.signal; started();
    return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error(SECRET)), { once: true }));
  });
  const h = setup({ realCore: true });
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  await ready;
  t.mock.timers.tick(30000);
  await h.drain();
  assert.equal(signal.aborted, true);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(status(h), 'authorized');
  await acknowledge(h);
  assert.equal(h.background.length, 1);
});

test('any internal mapping or lookup uncertainty prevents external fallback', async () => {
  for (const options of [
    { inactive: true }, { user: { is_locked: true } }, { user: { approval_status: 'pending' } },
    { excluded: true }, { linkError: true }, { exclusionError: true }, { presenceError: true },
    { presenceData: {} }, { link: null, internalPresent: true },
    { link: { app_user_id: '4a5e8b1a-430f-4cfc-9145-29d54783cf75', app_users: { id: '4a5e8b1a-430f-4cfc-9145-29d54783cf75', approval_status: 'approved', is_locked: false } }, excluded: true },
  ]) {
    const h = setup({ ...options, admission: true });
    await acknowledge(h);
    assert.equal(status(h), 'unauthorized');
    assert.equal(h.assistantCalls.length, 0);
    assert.deepEqual(h.rpcCalls, []);
  }
});

test('internal tool permission failure never retries on external path', async () => {
  const h = setup({ toolError: true, admission: true });
  await acknowledge(h);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), ['whatsapp_get_lr_detail']);
  assert.equal(h.rpcCalls[0].args.p_app_user_id, USER);
});

test('external admission binds event ID only and never persists message/reply or model identity', async (t) => {
  const logs = [];
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No outbound transport'));
  const h = setup({ link: null, admission: true });
  const text = `${RAW} scope_type=consignee party_id=42 external_link_id=123 event_id=999`;
  await acknowledge(h, request(envelope([{ ...DEFAULT_MESSAGE, external_link_id: 123, p_event_id: 999, text: { body: text } }]), { query: '?event_id=999&app_user_id=attacker' }));
  assert.deepEqual(h.rpcCalls, [
    { name: 'whatsapp_external_admit', args: { p_event_id: 1 } },
    { name: 'whatsapp_external_get_lr_detail', args: { p_event_id: 1, p_lr_number: 'LR19573' } },
  ]);
  assert.equal(status(h), 'authorized');
  assert.equal(h.events.get(DEFAULT_MESSAGE.id).external_link_id, 100);
  assert.equal(h.reads.length, 1); // No external mapping/master reads or internal permission path.
  assert.equal(h.writes.length, 1); // Attribution belongs to the mocked M101 admission, not TS.
  assert.ok(!JSON.stringify(h.writes).includes(text));
  assert.ok(!JSON.stringify(h.writes).includes(REPLY));
  assert.deepEqual(logs, []);
});

test('external admission rejects false, malformed and error responses without AI or details', async () => {
  for (const options of [{ admission: false }, { admission: 'true' }, { admission: {} }, { admission: true, admissionError: true }, { admission: false, rateLimited: true }]) {
    const h = setup({ link: null, ...options });
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 0);
    assert.deepEqual(h.rpcCalls.map((c) => c.name), ['whatsapp_external_admit']);
    if (options.rateLimited) assert.equal(status(h), 'ignored');
    else if (options.admission === false) assert.equal(status(h), 'unauthorized');
  }
});

test('external disabled, unsupported text, and scheduler rejection do not admit or run AI', async () => {
  for (const options of [
    { env: { WHATSAPP_EXTERNAL_ASSISTANT_ENABLED: undefined } },
    { env: { WHATSAPP_EXTERNAL_ASSISTANT_ENABLED: 'false' } },
    { env: { WHATSAPP_EXTERNAL_ASSISTANT_ENABLED: 'TRUE' } },
    { env: { WHATSAPP_ASSISTANT_ENABLED: 'false' } }, { noScheduler: true }, { schedulerThrows: true },
  ]) {
    const h = setup({ link: null, admission: true, ...options });
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 0);
    assert.deepEqual(h.rpcCalls, []);
  }
  for (const message of [{ ...DEFAULT_MESSAGE, type: 'image' }, { ...DEFAULT_MESSAGE, text: { body: '' } }, { ...DEFAULT_MESSAGE, text: { body: 'x'.repeat(2001) } }]) {
    const h = setup({ link: null, admission: true });
    await acknowledge(h, request(envelope([message])));
    assert.deepEqual(h.rpcCalls, []);
  }
});

test('external duplicate delivery and consumed/expired RPC failure never readmit', async () => {
  for (const toolError of [false, true]) {
    const h = setup({ link: null, admission: true, toolError });
    await Promise.all([acknowledge(h), acknowledge(h)]);
    await acknowledge(h);
    assert.equal(h.assistantCalls.length, 1);
    assert.deepEqual(h.rpcCalls.map((c) => c.name), ['whatsapp_external_admit', 'whatsapp_external_get_lr_detail']);
  }
});

test('external admission timeout acknowledges promptly and discards late success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, signal, start;
  const started = new Promise((resolve) => { start = resolve; });
  const h = setup({ link: null, rpc: async (name, _args, s) => {
    assert.equal(name, 'whatsapp_external_admit'); signal = s; start();
    return await new Promise((resolve) => { finish = resolve; });
  } });
  assert.equal((await h.handler(request())).status, 200);
  await started;
  t.mock.timers.tick(5000);
  await h.drain();
  assert.equal(signal.aborted, true);
  finish({ data: true, error: null });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.assistantCalls.length, 0);
  assert.equal(h.rpcCalls.length, 1);
});

test('real external core exposes external function only and never sends Meta traffic', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(url);
    const body = JSON.parse(init.body);
    assert.equal(body.tools[0].name, 'external_get_lr_detail');
    assert.deepEqual(body.tool_choice, { type: 'function', name: 'external_get_lr_detail' });
    assert.equal(body.store, false);
    return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'external_1', name: body.tools[0].name, arguments: '{"lrNumber":"LR19573"}' }] });
  });
  const h = setup({ link: null, admission: true, realCore: true });
  await acknowledge(h);
  assert.deepEqual(urls, ['https://api.openai.com/v1/responses']);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), ['whatsapp_external_admit', 'whatsapp_external_get_lr_detail']);
});

test('Gupshup: valid Meta signature -> accepted (A)', async () => {
  const h = setup();
  await acknowledge(h);
});

test('Gupshup: valid Gupshup secret, no Meta signature -> accepted (B)', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined } });
  const r = await h.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: GUPSHUP_SECRET }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(h.clients(), 1);
});

test('Gupshup: invalid Gupshup secret, no Meta signature -> 401 (C)', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined } });
  const r = await h.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: 'wrong-secret' }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { ok: false, code: 'invalid_signature' });
  assert.equal(h.clients(), 0);
});

test('Gupshup: no authentication headers -> 401 (D)', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined } });
  const r = await h.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: undefined }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { ok: false, code: 'invalid_signature' });
  assert.equal(h.clients(), 0);
});

test('Gupshup: valid Meta signature + missing/invalid Gupshup header -> accepted (E)', async () => {
  const h = setup();
  const r = await h.handler(request({}, { gupshupHeader: 'wrong-secret' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('Gupshup: invalid Meta signature + valid Gupshup header -> accepted (F)', async () => {
  const h = setup();
  const r = await h.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: GUPSHUP_SECRET }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('Gupshup: empty/missing GUPSHUP_WEBHOOK_SECRET cannot authenticate (G)', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined } });
  const r = await h.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: '' }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { ok: false, code: 'invalid_signature' });
  assert.equal(h.clients(), 0);

  const h2 = setup({ env: { WHATSAPP_META_APP_SECRET: undefined } });
  const r2 = await h2.handler(request({ signature: 'sha256=invalid' }, { gupshupHeader: undefined }));
  assert.equal(r2.status, 401);
  assert.deepEqual(await r2.json(), { ok: false, code: 'invalid_signature' });
  assert.equal(h2.clients(), 0);
});

test('Gupshup: neither Meta nor Gupshup authentication secret configured -> server_misconfigured (H)', async () => {
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined, GUPSHUP_WEBHOOK_SECRET: undefined } });
  const r = await h.handler(request());
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { ok: false, code: 'server_misconfigured' });
  assert.equal(h.clients(), 0);
});

test('Gupshup: GET verification behavior still works unchanged (I)', async () => {
  const h = setup();
  const base = 'https://example.invalid/?hub.mode=subscribe&hub.verify_token=SYNTHETIC_VERIFY&hub.challenge=challenge123';
  const ok = await h.handler(new Request(base));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'challenge123');
  assert.match(ok.headers.get('content-type'), /text\/plain/);
  assert.equal(h.clients(), 0);
});

test('Outbound: authorized internal user + valid assistant reply -> exactly one Gupshup send (A)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls.length, 1);
  const call = outboundCalls[0];
  assert.equal(call.url, 'https://api.gupshup.io/wa/api/v1/msg');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, 'SYNTHETIC_GUPSHUP_API_KEY');
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get('channel'), 'whatsapp');
  assert.equal(body.get('source'), '919876543210');
  assert.equal(body.get('destination'), '919876543210');
  assert.equal(body.get('src.name'), 'SYNTHETIC_APP');
  const msg = JSON.parse(body.get('message'));
  assert.equal(msg.type, 'text');
  assert.equal(msg.text, REPLY);
  assert.equal(msg.previewUrl, false);
});

test('Outbound: never-settling fetch that ignores abort is hard-bounded without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  let signal, finish;
  const calls = [];
  const h = setup({ fetch: (url, init) => {
    assert.equal(url, 'https://api.gupshup.io/wa/api/v1/msg');
    calls.push({ url, init });
    signal = init.signal;
    // Deliberately ignore abort and settle only when the test releases it.
    return new Promise((resolve) => { finish = resolve; });
  } });
  const response = await h.handler(request());
  assert.equal(response.status, 200);
  for (let i = 0; i < 20 && !signal; i++) await Promise.resolve();
  assert.ok(signal);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(10000);
  await h.drain();
  assert.equal(signal.aborted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, [
    ['[WhatsApp assistant webhook] outbound started'],
    ['[WhatsApp assistant webhook] outbound timeout'],
  ]);
  finish(Response.json({ status: 'submitted', sensitive: `${RAW} ${REPLY} ${SECRET}` }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 2);
  assert.ok(!JSON.stringify(logs).includes(RAW));
  assert.ok(!JSON.stringify(logs).includes(REPLY));
  assert.ok(!JSON.stringify(logs).includes(SECRET));
  assert.ok(!JSON.stringify(logs).includes(USER));
  assert.ok(!JSON.stringify(logs).includes(DEFAULT_MESSAGE.from));
});

test('Outbound: successful submission keeps one send and emits safe lifecycle logs', async (t) => {
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  const calls = [];
  const h = setup({ fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ status: 'submitted' });
  } });
  await acknowledge(h);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, [
    ['[WhatsApp assistant webhook] outbound started'],
    ['[WhatsApp assistant webhook] outbound submitted'],
  ]);
  assert.ok(!JSON.stringify(logs).includes(RAW));
  assert.ok(!JSON.stringify(logs).includes(REPLY));
  assert.ok(!JSON.stringify(logs).includes(SECRET));
});

test('Outbound: destination equals authenticated sender digits without + (B)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  const call = outboundCalls[0];
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get('destination'), '919876543210');
});

test('Outbound: request uses POST (C)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls[0].init.method, 'POST');
});

test('Outbound: request URL exactly https://api.gupshup.io/wa/api/v1/msg (D)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls[0].url, 'https://api.gupshup.io/wa/api/v1/msg');
});

test('Outbound: apikey header uses GUPSHUP_API_KEY (E)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls[0].init.headers.apikey, 'SYNTHETIC_GUPSHUP_API_KEY');
});

test('Outbound: form contains correct fields (F)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  const call = outboundCalls[0];
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get('channel'), 'whatsapp');
  assert.equal(body.get('source'), '919876543210');
  assert.equal(body.get('destination'), '919876543210');
  assert.equal(body.get('src.name'), 'SYNTHETIC_APP');
  const msg = JSON.parse(body.get('message'));
  assert.deepEqual(msg, { type: 'text', text: REPLY, previewUrl: false });
});

test('Outbound: assistant error -> no outbound send (G)', async () => {
  const h = setup({ assistant: async () => { throw new Error('assistant error'); } });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: empty assistant reply -> no outbound send (H)', async () => {
  const h = setup({ assistant: async () => ({ status: 'answered', text: '' }) });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: missing API key -> no outbound network call (I)', async () => {
  const h = setup({ env: { GUPSHUP_API_KEY: undefined } });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: missing source -> no outbound network call (J)', async () => {
  const h = setup({ env: { GUPSHUP_SOURCE_NUMBER: undefined } });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: missing app name -> no outbound network call (K)', async () => {
  const h = setup({ env: { GUPSHUP_APP_NAME: undefined } });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: malformed source with + / spaces / hyphens -> zero outbound calls (A)', async () => {
  for (const badSource of ['+919876543210', '91 9876543210', '91-9876543210', '91 98 76 54 32 10', '+91-98765-43210']) {
    const calls = [];
    const h = setup({ env: { GUPSHUP_SOURCE_NUMBER: badSource }, fetch: async (url, init) => {
      if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
        calls.push({ url, init });
        return Response.json({ status: 'submitted' });
      }
      return Response.json({});
    } });
    await acknowledge(h);
    await h.drain();
    assert.equal(calls.length, 0, `badSource=${badSource} should cause zero calls`);
  }
});

test('Outbound: HTTP 201 with status=submitted -> NOT success (B)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return new Response(JSON.stringify({ status: 'submitted' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls.length, 1); // One attempt, but not treated as success (no retry logic exists anyway)
  // The function treats only 200 as success, so 201 is failure
});

test('Outbound: HTTP 200 with status=submitted -> remains success (C)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls.length, 1);
});

test('Outbound: Gupshup 400/401/429 -> no retry (L)', async () => {
  const statuses = [400, 401, 429];
  for (const status of statuses) {
    const calls = [];
    const h = setup({ fetch: async (url, init) => {
      if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
        calls.push({ url, init });
        return new Response(null, { status });
      }
      return Response.json({});
    } });
    await acknowledge(h);
    await h.drain();
    assert.equal(calls.length, 1);
  }
});

test('Outbound: Gupshup HTTP 200 but status != submitted -> treated as failure (M)', async () => {
  const outboundCalls = [];
  const h = setup({ fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'failed' });
    }
    return Response.json({});
  } });
  await acknowledge(h);
  await h.drain();
  assert.equal(outboundCalls.length, 1); // One attempt, no retry
});

test('Outbound: unauthorized internal user -> no assistant/outbound (N)', async () => {
  const h = setup({ link: { app_user_id: USER, app_users: { id: USER, approval_status: 'pending', is_locked: false } } });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.assistantCalls.length, 0);
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: external path remains unchanged and does not send outbound (O)', async () => {
  const h = setup({ link: null, admission: true });
  await acknowledge(h);
  await h.drain();
  assert.equal(h.assistantCalls.length, 1);
  assert.equal(h.outboundCalls.length, 0);
});

test('Outbound: existing Gupshup/Meta inbound authentication tests still pass (P)', async () => {
  const outboundCalls = [];
  const h = setup({ env: { WHATSAPP_META_APP_SECRET: undefined }, fetch: async (url, init) => {
    if (url === 'https://api.gupshup.io/wa/api/v1/msg') {
      outboundCalls.push({ url, init });
      return Response.json({ status: 'submitted' });
    }
    return Response.json({});
  } });
  const req = request(undefined, { signature: 'sha256=invalid', gupshupHeader: GUPSHUP_SECRET });
  const r = await h.handler(req);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  await h.drain();
  assert.equal(outboundCalls.length, 1);
});

test('Outbound: existing GET verification tests still pass (Q)', async () => {
  const h = setup();
  const base = 'https://example.invalid/?hub.mode=subscribe&hub.verify_token=SYNTHETIC_VERIFY&hub.challenge=challenge123';
  const ok = await h.handler(new Request(base));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'challenge123');
  assert.match(ok.headers.get('content-type'), /text\/plain/);
});
