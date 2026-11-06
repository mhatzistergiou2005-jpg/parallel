const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const vm = require('node:vm');
const CareerEngine = require('../career-engine.js');
const { createApp } = require('../server.js');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const careerData = script.slice(script.indexOf('const careers ='), script.indexOf('\nconst questions ='));
const careers = vm.runInNewContext(`${careerData}; careers`);

const accounts = [
  { name: 'Avery Writer', email: 'avery@example.test', password: 'Strong-password-A9!', expectedCareer: 'Media & Journalism', answers: { 0: ['creative'], 4: ['creative'], 7: ['media'], 8: ['research'] } },
  { name: 'Blake Analyst', email: 'blake@example.test', password: 'Strong-password-B9!', expectedCareer: 'Data & Business Analytics', answers: { 0: ['analysis'], 5: ['finance'], 8: ['analysis'] } },
  { name: 'Casey Helper', email: 'casey@example.test', password: 'Strong-password-C9!', expectedCareer: 'Healthcare & Wellbeing', answers: { 5: ['health', 'science'], 6: ['helping'], 9: ['helping'] } }
];

test('three accounts keep separate, persistent, quiz-driven career experiences', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-career-test-'));
  const databasePath = path.join(directory, 'career.db');
  const app = createApp({ databasePath });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const homepage = await fetch(baseUrl);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /id="greetingName"/);
  const engineResponse = await fetch(`${baseUrl}/career-engine.js`);
  assert.equal(engineResponse.status, 200);

  async function request(url, route, method = 'GET', data, cookie) {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {})
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    const payload = await response.json();
    return { response, payload };
  }

  const sessions = new Map();
  const views = new Map();
  for (const account of accounts) {
    const { response, payload } = await request(baseUrl, '/api/register', 'POST', account);
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    sessions.set(account.email, cookie);

    const recommendations = CareerEngine.rankCareers(careers, account.answers);
    assert.equal(recommendations[0].name, account.expectedCareer);
    const selected = recommendations[0];
    const skillMap = CareerEngine.groupSkills(selected.career, account.answers);
    const learning = CareerEngine.learningItems(selected.career, skillMap.grow);
    const roadmap = CareerEngine.buildRoadmap(selected.name, selected.career, skillMap.grow);
    assert.ok(learning[0][0].includes(selected.career.tags[0]) || learning.length > 1);
    assert.match(roadmap[0].text, new RegExp(selected.name));
    views.set(account.email, {
      paths: recommendations.slice(0, 3).map(item => item.name),
      skills: [...skillMap.have, ...skillMap.grow].map(([name]) => name),
      learning: learning.map(([title]) => title),
      roadmap: roadmap.flatMap(stage => stage.tasks)
    });

    const profile = {
      answers: account.answers,
      selectedCareer: selected.name,
      completed: { '0-0': true }
    };
    const saved = await request(baseUrl, '/api/profile', 'PUT', profile, cookie);
    assert.equal(saved.response.status, 200);
    assert.deepEqual(saved.payload.profile, profile);
    assert.equal(payload.profile.selectedCareer, '');
  }

  const duplicate = await request(baseUrl, '/api/register', 'POST', accounts[0]);
  assert.equal(duplicate.response.status, 409);

  for (const section of ['paths', 'skills', 'learning', 'roadmap']) {
    const uniqueViews = new Set(accounts.map(account => JSON.stringify(views.get(account.email)[section])));
    assert.equal(uniqueViews.size, accounts.length, `${section} should differ for all three accounts`);
  }

  for (const account of accounts) {
    const { response, payload } = await request(baseUrl, '/api/me', 'GET', undefined, sessions.get(account.email));
    assert.equal(response.status, 200);
    assert.equal(payload.user.name, account.name);
    assert.deepEqual(payload.profile.answers, account.answers);
    assert.equal(payload.profile.selectedCareer, account.expectedCareer);
    assert.deepEqual(payload.profile.completed, { '0-0': true });
  }

  const database = new DatabaseSync(databasePath);
  const storedPassword = database.prepare('SELECT password_hash, password_salt FROM users WHERE email = ?').get(accounts[0].email);
  assert.notEqual(storedPassword.password_hash, accounts[0].password);
  assert.notEqual(storedPassword.password_hash, '');
  assert.notEqual(storedPassword.password_salt, '');
  database.close();

  const first = accounts[0];
  const loggedOut = await request(baseUrl, '/api/logout', 'POST', {}, sessions.get(first.email));
  assert.equal(loggedOut.response.status, 200);
  const login = await request(baseUrl, '/api/login', 'POST', { email: first.email, password: first.password });
  assert.equal(login.response.status, 200);
  const returningCookie = login.response.headers.get('set-cookie').split(';')[0];
  const returningProfile = await request(baseUrl, '/api/me', 'GET', undefined, returningCookie);
  assert.deepEqual(returningProfile.payload.profile.answers, first.answers);

  const retakenAnswers = { 5: ['health', 'science'], 6: ['helping'] };
  const retaken = await request(baseUrl, '/api/profile', 'PUT', {
    answers: retakenAnswers,
    selectedCareer: 'Healthcare & Wellbeing',
    completed: {}
  }, returningCookie);
  assert.equal(retaken.response.status, 200);
  const updatedRecommendations = CareerEngine.rankCareers(careers, retaken.payload.profile.answers);
  assert.equal(updatedRecommendations[0].name, 'Healthcare & Wellbeing');
  assert.notDeepEqual(updatedRecommendations.map(item => item.name), views.get(first.email).paths);

  const isolated = await request(baseUrl, '/api/me', 'GET', undefined, sessions.get(accounts[1].email));
  assert.deepEqual(isolated.payload.profile.answers, accounts[1].answers);
});
