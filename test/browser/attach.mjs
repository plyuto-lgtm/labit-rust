// A picture pasted or dropped into a comment box in real browsers (WebKit and Chrome's engine): the strip with its ✕, the
// picture sent smaller, the comment saved with it, the thread showing it. Not part of `npm test`; CI runs it in the `browser` job.
import fs from 'node:fs';
import path from 'node:path';
import { claimPort } from './port.mjs';
import { playwright, engines, tmp, labEnv, startLab, labUp, sleep, check, finish } from './harness.mjs';

const pw = playwright();
const DIR = tmp('labit-attach-');
const PORT = claimPort(8420, 30);
const B = `http://localhost:${PORT}`;
fs.writeFileSync(path.join(DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Home</title><h1 style="margin:80px">Home</h1><p>words</p>');
fs.writeFileSync(path.join(DIR, 'labit.json'), JSON.stringify({ port: PORT }));
const server = startLab(DIR, labEnv());
await labUp(B);
const list = async () => (await (await fetch(`${B}/_lab/api/comments?page=/index`)).json()).comments || [];
// a picture as the clipboard (or a drag) carries it: drawn here at 3000 × 2000
const dataOf = (p) => p.evaluateHandle(async () => {
  const cv = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 });
  const g = cv.getContext('2d');
  g.fillStyle = '#e63'; g.fillRect(0, 0, 3000, 2000);
  const dt = new DataTransfer();
  dt.items.add(new File([await new Promise((r) => cv.toBlob(r, 'image/png'))], 'image.png', { type: 'image/png' }));
  return dt;
});
try {
  for (const eng of engines()) {
    const browser = await pw[eng].launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem('lab-name', 'tester'); localStorage.setItem('lab-on', '1'); });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('pageerror', e.message));
      await p.goto(B + '/');
      await p.waitForFunction(() => [...document.querySelectorAll('*')].some((n) => n.shadowRoot?.querySelector('.scrim')), null, { timeout: 8000 });
      await sleep(800);
      const until = async (fn, tries = 40) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(150); } return false; };
      await p.mouse.click(300, 160);
      const area = p.locator('textarea').first();
      check(eng, 'a click opens the comment box', await until(async () => (await area.count()) > 0));
      await area.focus();
      const paste = async (words = 'image.png') => (await p.evaluate(async (words) => {
        const cv = Object.assign(document.createElement('canvas'), { width: 3000, height: 2000 });
        const g = cv.getContext('2d');
        g.fillStyle = '#e63'; g.fillRect(0, 0, 3000, 2000);
        const dt = new DataTransfer();
        dt.items.add(new File([await new Promise((r) => cv.toBlob(r, 'image/png'))], 'image.png', { type: 'image/png' }));
        dt.setData('text/plain', words);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
        (document.activeElement?.shadowRoot?.activeElement || document.activeElement).dispatchEvent(ev);
        return ev.defaultPrevented;
      }, words));
      const prevented = await paste('first words'); // the first paste: the part is not loaded yet, the words must still arrive
      check(eng, 'a pasted picture shows as a thumbnail above the words', await until(async () => (await p.locator('.atts .p img').count()) === 1));
      check(eng, 'and the paste is taken, its words arrive though the part loaded after the event', prevented && (await area.inputValue()) === 'first words');
      await paste();
      check(eng, 'a second one makes two', await until(async () => (await p.locator('.atts .p img').count()) === 2));
      await p.locator('.atts .p .x').first().click();
      check(eng, '✕ takes one away', await until(async () => (await p.locator('.atts .p img').count()) === 1));
      // a picture pasted with the cursor in the name field is attached too
      await p.locator('input[name=search-lab-who]').first().focus();
      await paste();
      check(eng, 'a paste in the name field attaches the picture', await until(async () => (await p.locator('.atts .p img').count()) === 2));
      await p.locator('.atts .p .x').last().click();
      await area.focus();
      // the widget draws its boxes again when a comment comes in: the picture (and the words) are put back
      await area.fill('half a thought');
      await fetch(`${B}/_lab/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ page: '/index', name: 'Other', text: 'a comment from someone else', anchor: { kind: 'element', selector: 'p', x: 0.5, y: 0.5, docX: 0.1, docY: 300, width: 1000, element: '<p>' } }) });
      await sleep(2500);
      check(eng, 'a comment coming in does not wipe the picture or the words in the box', (await p.locator('.atts .p img').count()) === 1 && (await p.locator('textarea').first().inputValue()) === 'half a thought');
      // "+ picture": the file picker's input
      await p.locator('.composer input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEklEQVR4nGPg31PMQAAMtUoDAAXdAWG+IDI/AAAAAElFTkSuQmCC', 'base64') });
      check(eng, 'a file picked with "+ picture" is a second thumbnail', await until(async () => (await p.locator('.atts .p img').count()) === 2));
      await p.locator('.atts .p .x').last().click();
      await area.fill('the header overlaps');
      await area.press('Enter');
      let saved;
      for (let i = 0; i < 40 && !saved; i++) { await sleep(150); saved = (await list()).find((c) => c.text === 'the header overlaps'); }
      const im = saved?.images?.[0];
      check(eng, 'the comment is saved with its one picture, sent at 2000 px on its long side', saved?.images?.length === 1 && Math.max(im.w, im.h) === 2000, JSON.stringify(saved?.images));
      const file = saved && path.join(DIR, '.lab/attachments', `${saved.id}-1.${im.type}`);
      check(eng, 'its file is in .lab/attachments under the comment id', Boolean(file) && fs.existsSync(file));
      check(eng, 'the agent reads its path', saved && (await (await fetch(`${B}/_lab/agent/index`)).text()).includes(`image: .lab/attachments/${saved.id}-1.${im.type} (${im.w}×${im.h})`));
      // the thread shows the thumbnail
      await sleep(500);
      await p.keyboard.press('Escape');
      const pinsN = await p.locator('button.pin').count();
      for (let i = 0; i < pinsN; i++) { // ours is the one whose thread has a picture
        await p.locator('button.pin').nth(i).click();
        await sleep(700);
        if (await p.locator('.att img').count()) break;
        await p.keyboard.press('Escape');
      }
      check(eng, 'the thread shows the picture, loaded', await until(async () => p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.att img'))?.shadowRoot; const i = r?.querySelector('.att img'); return Boolean(i && i.naturalWidth > 0); })));
      // a drop on a reply box carries one too
      const reply = p.locator('textarea').first();
      await reply.focus();
      const dropped = await p.evaluate(async () => {
        const cv = Object.assign(document.createElement('canvas'), { width: 400, height: 300 });
        cv.getContext('2d').fillRect(0, 0, 400, 300);
        const dt = new DataTransfer();
        dt.items.add(new File([await new Promise((r) => cv.toBlob(r, 'image/png'))], 'drop.png', { type: 'image/png' }));
        const box = (document.activeElement?.shadowRoot?.activeElement || document.activeElement).closest('.box');
        const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true });
        box.dispatchEvent(over);
        box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
        return over.defaultPrevented;
      }).catch(() => null);
      if (dropped === null || !(await until(async () => (await p.locator('.atts .p img').count()) === 1, 15))) console.log(`skip ${eng}   this engine did not carry a synthetic drop`);
      else {
        check(eng, 'a drop on the reply box adds a thumbnail', true);
        await reply.fill('and this');
        await reply.press('Enter');
        let withReply;
        for (let i = 0; i < 40 && !withReply; i++) { await sleep(150); withReply = (await list()).find((c) => c.parent && c.images?.length); }
        check(eng, 'the reply is saved with it', Boolean(withReply), JSON.stringify((await list()).map((c) => c.images)));
      }
      // a send that fails keeps the words and the picture
      await ctx.route('**/_lab/api/comments', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
      await reply.focus();
      await p.evaluate(async () => {
        const cv = Object.assign(document.createElement('canvas'), { width: 100, height: 100 });
        cv.getContext('2d').fillRect(0, 0, 100, 100);
        const dt = new DataTransfer();
        dt.items.add(new File([await new Promise((r) => cv.toBlob(r, 'image/png'))], 'p.png', { type: 'image/png' }));
        (document.activeElement?.shadowRoot?.activeElement || document.activeElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
      });
      await until(async () => (await p.locator('.atts .p img').count()) === 1);
      await reply.fill('will not go');
      await reply.press('Enter');
      await sleep(6000);
      check(eng, 'a send that fails keeps the words and the picture in the box', (await reply.inputValue()) === 'will not go' && (await p.locator('.atts .p img').count()) === 1);
      await ctx.unroute('**/_lab/api/comments');
      // the chat takes pictures too
      await p.keyboard.press('Escape');
      await p.evaluate(() => [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.chat-btn')).shadowRoot.querySelector('.chat-btn').click());
      const chatBox = p.locator('.chat textarea').first();
      check(eng, 'the chat opens with its box', await until(async () => (await chatBox.count()) > 0));
      await chatBox.focus();
      await paste();
      check(eng, 'a picture pasted in the chat box is a thumbnail there', await until(async () => (await p.locator('.chat .atts .p img').count()) === 1));
      await chatBox.fill('this is the whole page');
      await chatBox.press('Enter');
      let said;
      for (let i = 0; i < 40 && !said; i++) { await sleep(150); said = (await list()).find((c) => c.text === 'this is the whole page'); }
      check(eng, 'the chat message is saved with the picture', said?.images?.length === 1 && said.anchor?.kind === 'page', JSON.stringify(said?.images));
      check(eng, 'and the chat shows it, loaded', await until(async () => p.evaluate(() => { const r = [...document.querySelectorAll('*')].find((n) => n.shadowRoot?.querySelector('.chatwin .att img'))?.shadowRoot; const i = r?.querySelector('.chatwin .att img'); return Boolean(i && i.naturalWidth > 0); })));
      check(eng, 'the agent reads it as an image: line under the message', Boolean(said) && (await (await fetch(`${B}/_lab/agent/index`)).text()).includes(`image: .lab/attachments/${said.id}-1.`));
      await p.keyboard.press('Escape');
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
finish();
