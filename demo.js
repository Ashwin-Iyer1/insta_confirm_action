'use strict';
const events = [];
let deliveries = 0;
function record(kind, message) {
  events.push({ kind, message, time: new Date().toISOString() });
  document.querySelector('.empty')?.remove();
  const row = document.createElement('li'); row.className = kind; row.textContent = message;
  const time = document.createElement('small'); time.textContent = new Date().toLocaleTimeString(); row.append(time);
  document.querySelector('#trail').prepend(row);
  while (document.querySelector('#trail').children.length > 50) document.querySelector('#trail').lastElementChild.remove();
  if (events.length > 200) events.shift();
}
window.fetch = async () => { deliveries++; document.querySelector('#delivered').textContent = deliveries; return new Response('{"mock":true}', { status: 200 }); };
window.addEventListener('instaconfirm:status', event => { for (const key of ['allowed', 'cancelled', 'pending']) document.getElementById(key).textContent = event.detail[key]; });
const guard = window.InstaConfirmInstall(window, { baseURL: 'https://www.instagram.com/' });
async function request(kind, signal) {
  const like = kind === 'like';
  const url = like ? 'https://www.instagram.com/api/v1/web/likes/123/like/' : 'https://www.instagram.com/api/graphql';
  const body = new URLSearchParams({ fb_api_req_friendly_name: kind === 'read' ? 'DemoFeedQuery' : 'DemoSavePostMutation', variables: JSON.stringify({ input: { fictional: true } }) });
  try { await fetch(url, { method: 'POST', body, signal }); record('delivered', `${kind === 'read' ? 'Feed query' : like ? 'Like action' : 'Save action'} delivered to mock transport.`); }
  catch (error) { record('cancelled', `${kind === 'like' ? 'Like' : 'Save'} action cancelled · ${error.name}`); }
}
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.scenario;
  if (kind === 'queue') { void request('like'); void request('mutation'); }
  else if (kind === 'abort') { const controller = new AbortController(); void request('like', controller.signal); setTimeout(() => controller.abort(), 2000); }
  else void request(kind);
}));
document.querySelector('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ fictional: true, transport: 'in-memory', stats: guard.getStats(), deliveries, events }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'action-guard-session.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
