// Playwright + Flask + PostgreSQL local real; Auth doble. Ejecución explícita.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

const [python, playwright, chromiumPath, evidence, viewport = '1440'] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwright).href);
await fs.mkdir(evidence, { recursive: true });
const server = spawn(python, ['tests/fixture_chat_cuentas_ui.py'], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
let browser;
const checks = [];
try {
  const info = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('El servidor aislado no inició')), 30000);
    createInterface({ input: server.stdout }).on('line', line => {
      if (line.startsWith('V733_SERVER ')) { clearTimeout(timeout); resolve(JSON.parse(line.slice(12))); }
    });
    server.once('exit', code => {clearTimeout(timeout);reject(Error(`Servidor terminó: ${code}`));});
  });
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath });
  const errors=[];
  async function login(page, name) {
    const identity = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith('/api/cuenta'));
    await page.goto(info.url+'/cuenta');
    await identity;
    if (await page.locator('#salir-cuenta').isVisible()) {
      const logout = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/cuenta/logout'));
      await page.locator('#salir-cuenta').click();
      await logout;
    }
    await page.locator('#enviar-cuenta').waitFor();
    await page.locator('#email').fill(`${name}@example.test`);
    await page.locator('#password').fill('local-fixture-password');
    const loginResponse = page.waitForResponse(r => r.url().endsWith('/api/cuenta/login'));
    await page.locator('#enviar-cuenta').click();
    const response = await loginResponse;
    if (!response.ok()) throw Error(`Login de fixture rechazado (${response.status()}): ${await response.text()}`);
    await page.waitForFunction(()=>document.querySelector('#cuenta-form').hidden);
  }
  async function openBuyer(page) {
    await page.goto(info.url);
    await page.locator('#abrir-chat-cuentas').click();
    const item = page.locator('#chat-comprador-lista button').filter({hasText:'Toyota Corolla'});
    await item.waitFor();
    assert.equal((await item.innerText()).includes('Vendedor: Vendedora Carla'), true);
    await item.click();
    await page.getByText('Mensaje inicial del comprador A',{exact:true}).waitFor();
    assert.equal(await page.locator('#chat-comprador-vendedor').innerText(), 'Vendedor: Vendedora Carla');
  }
  async function submit(page, role, text, expected=201) {
    const input=role==='buyer'?'#chat-comprador-texto':'#seller-reply-text';
    const form=role==='buyer'?'#chat-comprador-form':'#seller-reply-form';
    await page.locator(input).fill(text);
    const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/mensajes'));
    await page.locator(form).evaluate(f=>f.requestSubmit());
    assert.equal((await response).status(),expected);
    await page.waitForFunction(sel=>!document.querySelector(sel).hasAttribute('aria-busy'),form);
  }
  async function lostReply(page, role, width) {
    const buyer=role==='buyer';
    const keys=[]; let lose=true;
    const pattern=buyer?'**/api/cuenta/chat/comprador/vehiculos/*/mensajes':'**/api/cuenta/chat/vendedor/conversaciones/*/mensajes';
    await page.route(pattern,async route=>{
      if(route.request().method()!=='POST') return route.continue();
      keys.push(route.request().headers()['idempotency-key']);
      if(lose){lose=false;const response=await route.fetch();assert.equal(response.status(),201);return route.abort('failed');}
      return route.continue();
    });
    const input=buyer?'#chat-comprador-texto':'#seller-reply-text';
    const form=buyer?'#chat-comprador-form':'#seller-reply-form';
    const feedback=buyer?'#chat-comprador-feedback':'#seller-thread-feedback';
    const back=buyer?'#chat-comprador-volver':'#seller-chat-back';
    const list=buyer?'#chat-comprador-lista button':'#seller-chat-list button';
    const text=`Resultado incierto ${role} ${width}`;
    await page.locator(input).fill(text);
    await page.locator(form).evaluate(f=>f.requestSubmit());
    await page.waitForFunction(sel=>document.querySelector(sel).textContent.includes('No hay conexión'),feedback);
    await page.locator(back).click();
    await page.locator(list).filter({hasText:'Ford Escape'}).click();
    await page.locator(back).click();
    if(buyer) await page.locator(list).filter({hasText:'Toyota Corolla'}).click();
    else await page.locator(`#seller-chat-list [data-conversation-id="${info.conversations.active_a}"]`).click();
    assert.equal(await page.locator(input).inputValue(),text);
    // No se confunde un texto nuevo con el reintento aún no reconciliado.
    await submit(page,role,'Texto nuevo deliberado '+width,200);
    assert.equal(keys[0],keys[1]);
    assert.equal(await page.locator(input).inputValue(),'Texto nuevo deliberado '+width);
    const log=buyer?'#chat-comprador-mensajes article p':'#seller-thread-messages article span';
    assert.equal(await page.locator(log).filter({hasText:text}).count(),1);
    await submit(page,role,'Texto nuevo deliberado '+width,201);
    assert.notEqual(keys[1],keys[2]);
    await page.unroute(pattern);
    checks.push(`A04 ${role} ${width}: misma clave, un mensaje; nuevo texto conserva borrador y usa otra clave`);
  }
  // Una base desechable por resolución conserva los límites reales de mensajes.
  for(const width of [Number(viewport)]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    const page=await context.newPage();
    await login(page,'buyer_a'); await openBuyer(page);
    await page.locator('#chat-comprador-volver').click();
    const unsafeName = '<img src=x onerror=alert(1)>';
    await page.locator('#chat-comprador-lista button').filter({hasText:'Honda CR-V'}).click();
    await page.locator('#chat-comprador-vendedor').waitFor();
    assert.equal(await page.locator('#chat-comprador-vendedor').innerText(), `Vendedor: ${unsafeName}`);
    assert.equal(await page.locator('#chat-comprador-vendedor img').count(), 0, 'El nombre debe representarse como texto, nunca como HTML.');
    await page.locator('#chat-comprador-volver').click();
    await page.locator('#chat-comprador-lista button').filter({hasText:'Toyota Corolla'}).click();
    checks.push(`V76 ${width}: nombres de vendedores visibles y texto potencialmente hostil no ejecutable`);
    for(let i=0;i<3;i++) await submit(page,'buyer',`Consecutivo ${width} ${i}`);
    checks.push(`A01 existente ${width}: tres envíos consecutivos`);
    await page.locator('#chat-comprador-texto').fill('Borrador Toyota '+width);
    await page.locator('#chat-comprador-volver').click();
    await page.locator('#chat-comprador-lista button').filter({hasText:'Honda CR-V'}).click();
    await page.locator('#chat-comprador-texto').fill('Borrador Honda '+width);
    await page.locator('#chat-comprador-volver').click();
    await page.locator('#chat-comprador-lista button').filter({hasText:'Toyota Corolla'}).click();
    assert.equal(await page.locator('#chat-comprador-texto').inputValue(),'Borrador Toyota '+width);
    await page.locator('#cerrar-chat-comprador').click();
    await page.locator('#abrir-chat-cuentas').click();
    await page.locator('#chat-comprador-lista button').filter({hasText:'Honda CR-V'}).click();
    assert.equal(await page.locator('#chat-comprador-texto').inputValue(),'Borrador Honda '+width);
    await page.locator('#chat-comprador-volver').click();
    await page.locator('#chat-comprador-lista button').filter({hasText:'Toyota Corolla'}).click();
    checks.push(`A03 ${width}: borradores independientes y cierre/reapertura`);
    await lostReply(page,'buyer',width);
    await page.screenshot({path:path.join(evidence,`comprador-${width}.png`)});
    // Una respuesta vieja retenida no puede repoblar el DOM tras cambio de cuenta.
    let release; let requested;
    const held=new Promise(r=>requested=r);
    const gate=new Promise(r=>release=r);
    await page.route('**/api/cuenta/chat/comprador/conversaciones/*/mensajes?*',async route=>{
      const old=await route.fetch(); requested(); await gate;
      await route.fulfill({response:old}).catch(()=>{});
    });
    await Promise.race([held, new Promise((_,reject)=>setTimeout(()=>reject(Error('No se recibió el polling esperado')),15000))]);
    const account=await context.newPage(); await login(account,'buyer_b');
    await page.waitForFunction(()=>document.querySelector('#chat-comprador-mensajes').childElementCount===0);
    release();
    await page.unrouteAll({behavior:'wait'});
    assert.equal(await page.locator('#chat-comprador-mensajes article').count(),0);
    assert.equal(await page.locator('#chat-comprador-texto').inputValue(),'');
    await page.locator('#cerrar-chat-comprador').click();
    await page.locator('#abrir-chat-cuentas').click();
    assert.equal(await page.getByText('Mensaje inicial del comprador A',{exact:true}).count(),0);
    // Conversación nueva con el vehículo de la otra cuenta: dos envíos seguidos.
    const vehicle=width===1440?info.vehicles.active_a:info.vehicles.active_b;
    await page.goto(`${info.url}/vehiculo/${vehicle}`);
    await page.locator('#mostrar-chat').click();
    for(let i=0;i<2;i++) await submit(page,'buyer',`Nueva ${width} ${i}`);
    checks.push(`A01 nueva ${width}: dos envíos; A05 señal entre pestañas elimina DOM y respuesta antigua`);
    // Cambio sin BroadcastChannel: verificación de identidad previa al siguiente polling.
    await context.addCookies(Object.entries(info.users.buyer_a).map(([key,value])=>({name:key==='sid'?'cuenta_sid':'cuenta_access',value,url:info.url})));
    await page.waitForFunction(()=>document.querySelector('#chat-comprador-mensajes').childElementCount===0);
    checks.push(`A05 ${width}: cambio sin señal detectado por verificación de identidad`);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('dialog-open')),false);
    await context.close();

    const seller=await browser.newContext({viewport:{width,height:900}});
    seller.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    const sp=await seller.newPage(); await login(sp,'seller_a');
    await sp.goto(info.url+'/vendedor');
    if(width===390) await sp.locator('#admin-mobile-menu').click();
    await sp.locator('#seller-chat-nav').click();
    const sellerItem = sp.locator(`#seller-chat-list [data-conversation-id="${info.conversations.active_a}"]`);
    await sellerItem.waitFor();
    assert.equal((await sellerItem.innerText()).includes('Comprador: Comprador Ana'), true);
    await sellerItem.click();
    assert.equal(await sp.locator('#seller-thread-contact').innerText(), 'Comprador: Comprador Ana');
    await lostReply(sp,'seller',width);
    await sp.screenshot({path:path.join(evidence,`vendedor-${width}.png`)});
    const ap=await seller.newPage(); await ap.goto(info.url+'/cuenta');
    await ap.locator('#salir-cuenta').click();
    await sp.waitForFunction(()=>document.querySelector('#seller-thread-messages').childElementCount===0);
    assert.equal(await sp.locator('#seller-reply-text').inputValue(),'');
    checks.push(`A05 vendedor ${width}: logout en otra pestaña elimina DOM y borrador`);
    await seller.close();
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(evidence,'resultados.json'),JSON.stringify({result:'PASS',checks},null,2));
  console.log(JSON.stringify({result:'PASS',checks}));
} finally {
  await browser?.close();
  server.stdin.write('stop\n');
  await new Promise(resolve=>{const timeout=setTimeout(()=>{server.kill();resolve();},10000);server.once('exit',()=>{clearTimeout(timeout);resolve();});});
}
