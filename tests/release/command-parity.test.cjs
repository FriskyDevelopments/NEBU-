const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const botSource = readFileSync(path.join(__dirname, '../../bot.cjs'), 'utf8');

function readLanguageCatalog(source) {
  const declaration = 'const strings = ';
  const start = source.indexOf(declaration);
  const end = source.indexOf('\n\nfunction getUserLanguage', start);

  assert.notEqual(start, -1, 'bot.cjs should define its language catalog');
  assert.notEqual(end, -1, 'language catalog should end before getUserLanguage');

  const catalogSource = source.slice(start + declaration.length, end).trim().replace(/;$/, '');
  return vm.runInNewContext(`(${catalogSource});`, {}, { timeout: 1000 });
}

function catalogShape(value) {
  if (Array.isArray(value)) return Array.from(value, catalogShape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, catalogShape(value[key])])
    );
  }
  return typeof value;
}

function commandNames(commandList) {
  return Array.from(commandList, (entry) => {
    const match = entry.match(/^\/(\w+)/);
    assert.ok(match, `command menu entry should begin with a slash command: ${entry}`);
    return match[1];
  });
}

const strings = readLanguageCatalog(botSource);

test('English and Spanish localization catalogs have matching coverage', () => {
  assert.deepEqual(Object.keys(strings).sort(), ['en', 'es']);
  assert.deepEqual(
    catalogShape(strings.en),
    catalogShape(strings.es),
    'English and Spanish must define the same message paths and array entries'
  );
});

test('English and Spanish welcome menus list the same commands', () => {
  const englishCommands = commandNames(strings.en.welcome.commandList);
  const spanishCommands = commandNames(strings.es.welcome.commandList);

  assert.ok(englishCommands.length > 0, 'welcome menu should list at least one command');
  assert.deepEqual(spanishCommands, englishCommands);
  assert.equal(new Set(englishCommands).size, englishCommands.length, 'menu commands should be unique');
});

test('every bilingual welcome-menu command has a registered bot handler', () => {
  const registeredCommands = new Set(
    [...botSource.matchAll(/bot\.onText\(\s*\/\\\/([a-z][a-z0-9_]*)/gi)]
      .map((match) => match[1])
  );
  const unregistered = commandNames(strings.en.welcome.commandList)
    .filter((command) => !registeredCommands.has(command));

  assert.deepEqual(unregistered, [], 'welcome menu must not advertise unregistered commands');
});
