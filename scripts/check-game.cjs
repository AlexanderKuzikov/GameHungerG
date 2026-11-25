"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, "В index.html должен быть один встроенный script");
const script = scriptMatch[1];

new vm.Script(script, { filename: "index.html:inline" });
assert.ok(!/(?:src|href)=["']https?:\/\//i.test(html), "Игра не должна загружать внешние ресурсы");
for (const id of ["game", "menu", "hud", "pause", "upgrade-screen", "gameover", "start-button", "restart-button"]) {
  assert.ok(html.includes(`id="${id}"`), `Отсутствует обязательный элемент #${id}`);
}
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Все id в HTML должны быть уникальны");

function createContext() {
  const gradient = { addColorStop() {} };
  const target = {
    canvas: null,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => ({}),
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    measureText: () => ({ width: 0 })
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => {};
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    }
  });
}

function createElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName: String(tagName).toUpperCase(),
    hidden: false,
    textContent: "",
    style: {},
    dataset: {},
    children: [],
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    append(...children) {
      element.children.push(...children);
    },
    replaceChildren(...children) {
      element.children = children;
    },
    closest() { return null; },
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720 };
    }
  };
  if (element.tagName === "CANVAS") {
    const context = createContext();
    context.canvas = element;
    element.getContext = () => context;
  }
  return element;
}

const elements = new Map();
const document = {
  hidden: false,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, createElement(id === "game" ? "canvas" : "div"));
    return elements.get(id);
  },
  createElement,
  addEventListener() {}
};
const storage = new Map();
const windowListeners = new Map();
const window = {
  devicePixelRatio: 1,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  },
  matchMedia: () => ({ matches: false }),
  requestAnimationFrame() {}
};
const sandbox = {
  window,
  document,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value)
  },
  performance: { now: () => 0 },
  requestAnimationFrame: window.requestAnimationFrame,
  console,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Object,
  Array,
  Set,
  Map,
  JSON,
  Uint8ClampedArray
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "index.html:inline" });

const game = window.StarfallGame;
assert.ok(game && game.version === "1.0.0", "Публичный игровой интерфейс недоступен");

function dispatchKey(type, key, code = "") {
  const event = { key, code, repeat: false, preventDefault() {} };
  for (const handler of windowListeners.get(type) || []) handler(event);
}

const first = game.createState(12345);
const second = game.createState(12345);
assert.equal(first.mode, "menu");
assert.equal(first.motes.length, second.motes.length);
assert.deepEqual(
  first.motes.map(({ x, y }) => [x, y]),
  second.motes.map(({ x, y }) => [x, y]),
  "Одинаковый seed должен давать одинаковое начальное состояние"
);

game.start();
let state = game.getState();
assert.equal(state.mode, "playing");
assert.equal(state.score, 0);
assert.equal(state.cargo, 0);
assert.ok(state.motes.length >= 15);

dispatchKey("keydown", "Escape");
assert.equal(state.mode, "paused", "Escape без event.code должен ставить игру на паузу");
dispatchKey("keydown", "Enter");
assert.equal(state.mode, "playing", "Enter должен продолжать игру");

const startX = state.player.x;
game.setInput({ x: 1, y: 0, pointer: { active: false } });
for (let i = 0; i < 30; i += 1) game.step(1 / 60);
assert.ok(state.player.x > startX + 20, "Клавиатурное движение должно перемещать садовника");

game.setInput({ x: 0, y: 0, pointer: { active: false } });
state.enemies.length = 0;
state.cargo = 0;
state.motes = [{
  id: 999,
  x: state.player.x,
  y: state.player.y,
  vx: 0,
  vy: 0,
  radius: 6,
  phase: 0,
  age: 0,
  hue: "gold"
}];
game.step(1 / 60);
assert.equal(state.cargo, 1, "Осколок должен собираться при контакте");

state.cargo = 3;
state.depositCooldown = 0;
state.player.x = state.core.x;
state.player.y = state.core.y;
state.player.vx = 0;
state.player.vy = 0;
game.step(1 / 60);
assert.equal(state.cargo, 0, "Память должна сдаваться у сердца");
assert.ok(state.score > 0, "Кормление должно давать очки");
assert.ok(state.feeds >= 3, "Кормление должно продвигать цветение");

state.pulseRecharge = 0;
state.pulseCharges = 2;
state.enemies = [{
  id: 1,
  kind: "wisp",
  x: state.player.x + 55,
  y: state.player.y,
  vx: 0,
  vy: 0,
  radius: 13,
  speed: 60,
  hp: 1,
  maxHp: 1,
  hit: 0,
  phase: 0,
  age: 10,
  dashTimer: 99,
  dashTime: 0,
  dashAngle: 0
}];
game.pulse();
game.step(1 / 60);
assert.equal(state.pulseCharges, 1, "Импульс должен расходовать заряд");
assert.equal(state.enemies.length, 0, "Импульс должен уничтожать слабого врага рядом");

game.pulse();
game.step(1 / 60);
assert.equal(state.pulseCharges, 0, "Второй накопленный заряд должен работать во время перезарядки");
game.pulse();
game.step(1 / 60);
assert.equal(state.pulseCharges, 0, "Импульс без заряда не должен ставиться в очередь");

state.player.dashCooldown = 1;
game.dash();
game.step(1 / 60);
assert.equal(state.player.dashTime, 0, "Рывок во время cooldown не должен выполняться");
assert.equal(state.actions.dash, false, "Недоступный рывок не должен оставаться в очереди");
state.player.dashCooldown = 0;
game.step(1 / 60);
assert.equal(state.player.dashTime, 0, "Отменённый рывок не должен сработать позже");

state.enemies.length = 0;
state.lives = 5;
state.cargoMax = 9;
state.cargo = state.levelGoal;
state.depositCooldown = 0;
state.player.x = state.core.x;
state.player.y = state.core.y;
state.player.vx = 0;
state.player.vy = 0;
game.step(1 / 60);
assert.equal(state.mode, "upgrade", "Заполненная шкала должна открывать выбор улучшения");
assert.equal(state.upgradeChoices.length, 3);
assert.ok(state.upgradeChoices.every((upgrade) => upgrade.id !== "life" && upgrade.id !== "cargo"), "Максимальные улучшения не должны предлагаться");
assert.equal(game.chooseUpgrade("life"), false, "Нельзя выбрать улучшение вне предложенной тройки");
const chosenId = state.upgradeChoices[0].id;
assert.equal(game.chooseUpgrade(chosenId), true);
assert.equal(state.mode, "playing", "После выбора улучшения игра должна продолжиться");

game.pause();
assert.equal(state.mode, "paused");
state.score = 500;
game.restart();
state = game.getState();
assert.equal(state.mode, "playing");
assert.ok(JSON.parse(storage.get("starfall-orchard-v1")).best >= 500, "Рестарт из паузы должен сохранять рекорд");
game.resume();
assert.equal(state.mode, "playing");

state.lives = 1;
state.player.invulnerable = 0;
state.enemies = [{
  id: 2,
  kind: "wisp",
  x: state.player.x,
  y: state.player.y,
  vx: 0,
  vy: 0,
  radius: 13,
  speed: 60,
  hp: 1,
  maxHp: 1,
  hit: 0,
  phase: 0,
  age: 10,
  dashTimer: 99,
  dashTime: 0,
  dashAngle: 0
}];
game.step(1 / 60);
assert.equal(state.mode, "gameover", "Потеря последней жизни должна завершать игру");
assert.ok(state.best >= state.score, "Рекорд должен обновляться при завершении игры");

game.restart();
state = game.getState();
assert.equal(state.mode, "playing");
assert.equal(state.score, 0);
assert.equal(state.lives, 3);

console.log("Starfall Orchard: синтаксис, автономность и игровой цикл проверены");
