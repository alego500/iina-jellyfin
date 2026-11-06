const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');

const itemA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const itemB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const stream = (id) => `https://host/Videos/${id}/stream?ApiKey=test-token`;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function setup({ getMetadata, enabled = true, setTitle = true } = {}) {
  const messages = [];
  const requests = [];
  const events = {};
  const hooks = {};
  const handlers = {};
  const properties = { 'stream-open-filename': stream(itemA), 'playlist-count': 1 };
  const values = {
    show_playback_title_osd: enabled,
    set_video_title: setTitle,
    show_notifications: true,
  };
  const iina = {
    core: {
      status: {
        get title() {
          return properties['force-media-title'] || properties['stream-open-filename'];
        },
      },
      osd: (message) => messages.push(message),
      open: (url) => (properties['stream-open-filename'] = url),
    },
    console,
    menu: { item() {}, addItem() {} },
    event: { on: (name, callback) => (events[name] = callback) },
    http: {
      async get(url) {
        requests.push(url);
        const data = getMetadata ? await getMetadata(url) : { Name: 'Movie A' };
        return { statusCode: 200, data };
      },
    },
    utils: { resolvePath: (path) => path },
    preferences: { get: (key) => values[key], set() {}, sync() {} },
    mpv: {
      getNumber: (key) => properties[key],
      getString: (key) => properties[key],
      getFlag: () => false,
      set: (key, value) => (properties[key] = value),
      addHook: (name, priority, callback) => (hooks[priority] = callback),
      command() {},
    },
    playlist: { add: () => true },
    sidebar: {
      loadFile() {},
      postMessage() {},
      onMessage: (name, callback) => (handlers[name] = callback),
    },
    standaloneWindow: {},
  };
  loadModule('src/index.js', {
    iina,
    setTimeout() {},
    require: (path) =>
      loadModule('src/' + path.slice(2), {
        setTimeout,
        clearTimeout,
      }),
  });
  return {
    messages,
    requests,
    events,
    hooks,
    handlers,
    properties,
  };
}

test('browser playback announces the known title once and suppresses the older automatic Title message', async () => {
  const state = setup();
  state.events['iina.window-loaded']();
  state.handlers['play-media']({ streamUrl: stream(itemA), title: 'Movie A' });
  await state.hooks[50](() => {});
  state.events['iina.file-loaded'](stream(itemA));
  assert.ok(state.messages.includes('Movie A'), 'show immediately after load');
  await flush();
  assert.deepEqual(
    state.messages.filter((message) => message === 'Movie A' || /^Title:/.test(message)),
    ['Movie A']
  );
});

test('a direct Jellyfin stream announces its preloaded metadata title', async () => {
  const state = setup();
  await state.hooks[50](() => {});
  state.events['iina.file-loaded'](stream(itemA));
  await flush();
  assert.deepEqual(state.messages, ['Movie A']);
  assert.equal(state.requests.length, 1, 'reuse the title hook metadata request');
});

test('a delayed title is announced after metadata arrives, without echoing the URL', async () => {
  let finish;
  const state = setup({ getMetadata: () => new Promise((resolve) => (finish = resolve)) });
  state.events['iina.file-loaded'](stream(itemA));
  assert.deepEqual(state.messages, []);
  finish({ Name: 'Late movie' });
  await flush();
  assert.deepEqual(state.messages, ['Late movie']);
});

test('an incoming load or end-file cancels an outgoing delayed title message', async () => {
  for (const cancel of [(state) => state.hooks[20](), (state) => state.events['mpv.end-file']()]) {
    let finish;
    const state = setup({ getMetadata: () => new Promise((resolve) => (finish = resolve)) });
    state.events['iina.file-loaded'](stream(itemA));
    cancel(state);
    state.properties['stream-open-filename'] = stream(itemB);
    finish({ Name: 'Outgoing movie' });
    await flush();
    assert.deepEqual(state.messages, []);
  }
});

test('turning off the new toggle suppresses extra title messages while metadata titles still update', async () => {
  const state = setup({ enabled: false });
  await state.hooks[50](() => {});
  state.events['iina.file-loaded'](stream(itemA));
  await flush();
  assert.equal(state.properties['force-media-title'], 'Movie A');
  assert.deepEqual(state.messages, []);
});

test('the title OSD can use an existing media title without enabling metadata title replacement', async () => {
  const state = setup({ setTitle: false });
  state.properties['force-media-title'] = 'Embedded title';
  state.events['iina.file-loaded'](stream(itemA));
  await flush();
  assert.deepEqual(state.messages, ['Embedded title']);
  assert.deepEqual(state.requests, []);
});
