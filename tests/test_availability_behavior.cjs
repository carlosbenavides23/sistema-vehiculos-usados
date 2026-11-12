// Ejecutar con tests/fixture_v651.py aislado y PLAYWRIGHT_MODULE opcional.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const origin = process.env.UX_FIXTURE_URL || 'http://127.0.0.1:5198';
    let auth = false, version = 0, requests = 0, conflict = false, failure = false;
    const dates = ['2026-11-09T12:00:00+00:00', '2026-11-09T12:00:01+00:00', '2026-11-09T12:00:02+00:00', '2026-11-09T12:00:03+00:00', '2026-11-09T12:00:04+00:00'];
    const vehicle = {id:2,marca:'Toyota',modelo:'Corolla',anio:2020,kilometraje:42000,precio_centavos:1450000,ubicacion:'Managua',disponibilidad:'disponible',updated_at:dates[0],descripcion:'Vehículo ficticio.',fotografias:[]};
    await page.route('**/*', async route => {
      const req=route.request(), url=new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data={ok:true,csrf_token:'fixture'},status=200;
      if(url.pathname==='/api/admin/session')data={ok:true,autenticado:auth,solo_lectura:false};
      else if(url.pathname==='/api/admin/login')auth=true;
      else if(url.pathname==='/api/admin/logout')auth=false;
      else if(url.pathname==='/api/admin/vehiculos')data={ok:true,vehiculos:[vehicle]};
      else if(url.pathname==='/api/vehiculos/2/disponibilidad'){
        requests++;
        const body=req.postDataJSON();
        await new Promise(resolve=>setTimeout(resolve,150));
        if(failure){status=503;data={ok:false,mensaje:'Error de conexión simulado.'};}
        else if(conflict || body.version_esperada!==vehicle.updated_at){status=409;data={ok:false,mensaje:'El vehículo cambió.'};}
        else {vehicle.disponibilidad=body.disponibilidad;vehicle.updated_at=dates[++version];data={ok:true,vehiculo:{...vehicle}};}
      }
      await route.fulfill({status,json:data});
    });
    await page.goto(origin+'/administracion');
    await page.locator('#admin-password').fill('temporal');
    await page.locator('#admin-login-form button').click();
    const container=page.locator(width===390?'#admin-inventory-mobile':'#admin-inventory-list');
    const sold=container.getByRole('button',{name:'Marcar vendido'});
    await sold.waitFor({state:'visible'});
    const availableStyle=await container.locator('.admin-state-pill').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));
    await sold.evaluate(button => { button.click(); button.click(); });
    const undo=page.locator('#availability-undo');
    await undo.waitFor({state:'visible'});
    assert.equal(vehicle.disponibilidad,'vendido');
    assert.equal(await container.locator('.is-sold').innerText(),'Vendido');
    const soldStyle=await container.locator('.is-sold').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}));
    assert.notDeepEqual(soldStyle,availableStyle);
    await undo.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#availability-message').textContent.includes('deshecho'));
    assert.equal(vehicle.disponibilidad,'disponible');
    assert.equal(await undo.isVisible(),false);
    await container.getByRole('button',{name:'Marcar vendido'}).click();
    await page.waitForFunction(()=>document.querySelector('#availability-undo').hidden===false);
    conflict=true;
    await undo.click();
    await page.waitForFunction(()=>document.querySelector('#availability-message').textContent.includes('cambió'));
    assert.equal(vehicle.disponibilidad,'vendido');
    assert.equal(await undo.isVisible(),false);
    conflict=false;
    failure=true;
    await container.getByRole('button',{name:'Marcar disponible'}).click();
    await page.waitForFunction(()=>document.querySelector('#availability-message').textContent.includes('Error de conexión'));
    assert.equal(vehicle.disponibilidad,'vendido');
    assert.equal(await undo.isVisible(),false);
    assert.equal(requests,5);
    failure=false;
    await container.getByRole('button',{name:'Marcar disponible'}).click();
    if(width===390){await page.locator('#admin-mobile-menu').click();await page.locator('[data-admin-logout]').click();}
    else await page.locator('#admin-logout').click();
    await page.waitForSelector('#admin-auth:not([hidden])');
    await page.waitForTimeout(250);
    await page.locator('#admin-password').fill('temporal');
    await page.locator('#admin-login-form button').click();
    await page.waitForSelector('#admin-workspace:not([hidden])');
    assert.equal(await undo.isVisible(),false);
    assert.equal(requests,6);
    console.log(`${width}px: cambio, deshacer y conflicto verificados`);
    await context.close();
  }
  await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1});
