import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';

const [python, modulePath, executablePath, evidence, requestedWidth] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(modulePath).href);
const fixture = spawn(python, ['tests/fixture_chat_cuentas_ui.py'], { env: process.env, stdio: ['pipe','pipe','inherit'] });
let browser;
try {
  const info = await new Promise((resolve,reject) => {
    const timeout = setTimeout(()=>reject(Error('Fixture no inició')),30000);
    createInterface({input:fixture.stdout}).on('line',line=> {
      if (line.startsWith('V733_SERVER ')) {clearTimeout(timeout);resolve(JSON.parse(line.slice(12)));}
    });
    fixture.once('exit',code=>{clearTimeout(timeout);reject(Error(`Fixture terminó ${code}`));});
  });
  await fs.mkdir(evidence,{recursive:true});
  browser = await chromium.launch({headless:true,executablePath});
  for (const width of requestedWidth ? [Number(requestedWidth)] : [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    const page = await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const legacyCalls=[];page.on('request',r=>{if(r.url().includes('/api/admin/')||r.url().includes('/api/chat/'))legacyCalls.push(r.url());});
    await page.goto(info.url);
    await page.locator('.vehicle-card').first().waitFor();
    assert.equal(await page.locator('a[href="/administracion"]').count(),0);
    await page.goto(info.url+'/cuenta');
    await page.locator('#email').fill('seller_a@example.test');
    await page.locator('#password').fill('local-fixture-password');
    await page.locator('#enviar-cuenta').click();
    await page.waitForFunction(()=>document.querySelector('#cuenta-form').hidden);
    await page.goto(info.url+'/vendedor');
    await page.locator('#admin-workspace:not([hidden])').waitFor();
    assert.equal(await page.locator('#admin-password').count(),0);
    if(width===390) await page.locator('#admin-mobile-menu').click();
    await page.locator('[data-archive-link]').click();
    await page.getByRole('heading',{name:'Archivo histórico',exact:true}).waitFor();
    assert.equal(await page.locator('.archive-list li').count(),4);
    await page.locator('.archive-list a').first().click();
    await page.getByText('Consulta histórica <script>sin ejecutar</script>',{exact:true}).waitFor();
    assert.equal(await page.locator('form,textarea').count(),0);
    assert.equal(await page.locator('.archive-message script').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${evidence}/archivo-${width}.png`,fullPage:true});
    const other=await browser.newContext();
    await other.addCookies(Object.entries({cuenta_sid:info.users.seller_b.sid,cuenta_access:info.users.seller_b.access}).map(([name,value])=>({name,value,url:info.url,httpOnly:true})));
    const denied=await other.request.get(page.url());assert.equal(denied.status(),404);await other.close();
    await page.getByRole('link',{name:'Volver al inventario'}).click();
    await page.locator('#admin-workspace:not([hidden])').waitFor();
    if(width===390) await page.locator('#admin-mobile-menu').click();
    await page.locator('#seller-chat-nav').click();
    await page.locator('#seller-chat-list button').filter({hasText:'Toyota Corolla'}).click();
    await page.locator('#seller-thread-messages').getByText('Mensaje inicial del comprador A',{exact:true}).waitFor();
    const archivoTab = await context.newPage();
    await archivoTab.goto(info.url+'/vendedor/archivo/'+info.archive[0]);
    await archivoTab.getByText('Consulta histórica <script>sin ejecutar</script>',{exact:true}).waitFor();
    if (width===390) {
      await page.locator('#admin-mobile-menu').click();
      await page.locator('[data-admin-logout]').click();
    } else await page.locator('#admin-logout').click();
    await page.waitForURL('**/cuenta');
    await archivoTab.waitForURL('**/cuenta');
    assert.equal(await archivoTab.getByText('Consulta histórica <script>sin ejecutar</script>',{exact:true}).count(),0);
    assert.equal((await context.request.get(info.url+'/vendedor/archivo')).status(),401);
    assert.deepEqual(errors,[]);assert.deepEqual(legacyCalls,[]);
    console.log(JSON.stringify({result:'PASS',width,checks:['catálogo sin admin','inventario vendedor','archivo cuatro conversaciones','XSS escapado','sin formulario de respuesta','aislamiento de otra cuenta','chat privado','logout','sin errores JS ni overflow']}));
    await context.close();
  }
} finally {
  if(browser)await browser.close();
  if(fixture.exitCode===null){fixture.stdin.write('\n');await new Promise(resolve=>fixture.once('exit',resolve));}
}
