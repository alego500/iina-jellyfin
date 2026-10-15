import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from './helpers/load-commonjs.js';

const itemA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const itemB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ticksPerSecond = 10000000;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Load the real entry point as well as the tracking module: tracker-only tests
// cannot catch a missing markTrackedFileEnded call in the end-file handler.
function setup() {
  const events = {};
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  const saved = new Map([
    [itemA, 180.714],
    [itemB, 60],
  ]);
  const stops = [];
  const seeks = [];
  const properties = {};
  const status = { position: 0, duration: 3600, paused: false };
  const timers = {
    setInterval(callback) {
      intervals.set(++timerId, callback);
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout(callback, delay) {
      timeouts.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  const iina = {
    core: {
      status,
      osd() {},
      seekTo(position) {
        seeks.push(position);
        status.position = position;
      },
    },
    console,
    menu: { item() {}, addItem() {} },
    event: { on: (name, callback) => (events[name] = callback) },
    http: {
      async get(url) {
        const id = new URL(url).pathname.split('/')[2];
        assert.ok(saved.has(id), 'metadata belongs to a known item');
        return {
          statusCode: 200,
          data: url.includes('/PlaybackInfo')
            ? { PlaySessionId: `session-${id}` }
            : {
                UserData: { PlaybackPositionTicks: saved.get(id) * ticksPerSecond, Played: false },
              },
        };
      },
      async post(url, { data }) {
        if (url.includes('/Stopped')) {
          stops.push(data);
          if (!data.Failed) saved.set(data.ItemId, data.PositionTicks / ticksPerSecond);
        }
        return { statusCode: 204 };
      },
    },
    utils: { resolvePath: (path) => path },
    preferences: { get: (key) => key === 'sync_playback_progress', set() {}, sync() {} },
    mpv: {
      addHook() {},
      getString: (key) => properties[key],
      set: (key, value) => (properties[key] = value),
    },
    sidebar: { loadFile() {}, postMessage() {}, onMessage() {} },
    standaloneWindow: {},
  };
  loadCommonJs('src/index.js', {
    iina,
    ...timers,
    require: (path) => loadCommonJs('src/' + path.slice(2), timers),
  });

  return {
    saved,
    stops,
    seeks,
    async load(id, resume = true) {
      status.position = 0;
      const url = `https://host/Videos/${id}/stream?ApiKey=test-token`;
      properties['stream-open-filename'] = url;
      events['iina.file-loaded'](url);
      await flush();
      if (resume) {
        for (const [id, timer] of [...timeouts]) {
          if (timer.delay === 1000) {
            timeouts.delete(id);
            timer.callback();
          }
        }
      }
    },
    sample(position) {
      status.position = position;
      for (const callback of [...intervals.values()]) callback();
    },
    end() {
      // This is the observed IINA ordering on manual Next/Previous: core has
      // reset before the plugin receives end-file, not a deliberate rewind.
      status.position = 0;
      events['mpv.end-file']();
      events['mpv.pause.changed']();
      assert.equal(intervals.size, 0, 'the ended file must no longer be sampled');
    },
  };
}

test('repeated playlist Next/Previous preserves each item and resumes the latest position', async () => {
  const state = setup();
  await state.load(itemA);
  assert.equal(state.seeks.at(-1), 180.714);

  for (const position of [187, 194]) {
    state.sample(position);
    state.end();
    await state.load(itemB);
    assert.equal(state.saved.get(itemA), position, 'Next must not erase the outgoing resume point');
    state.sample(65);
    state.end();
    await state.load(itemA);
    assert.equal(state.saved.get(itemB), 65);
    assert.equal(state.seeks.at(-1), position, 'Previous must resume at the position just saved');
  }
  assert.deepEqual(
    state.stops.map(({ ItemId, PositionTicks }) => [ItemId, PositionTicks / ticksPerSecond]),
    [
      [itemA, 187],
      [itemB, 65],
      [itemA, 194],
      [itemB, 65],
    ]
  );
});

test('an intentional rewind sampled before end-file still saves position zero', async () => {
  const state = setup();
  await state.load(itemA);
  state.sample(187);
  state.sample(0);
  state.end();
  assert.equal(state.saved.get(itemA), 0);
  assert.equal(state.stops[0].Failed, false);
});

test('leaving an item before its resume seek preserves the existing saved position', async () => {
  const state = setup();
  await state.load(itemA, false);
  state.end();
  assert.equal(state.saved.get(itemA), 180.714);
  assert.equal(state.stops[0].Failed, false);
});
