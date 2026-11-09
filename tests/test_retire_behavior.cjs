// Inicia tests/fixture_v651.py y ejecuta con PLAYWRIGHT_MODULE opcional.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true});
  for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:900}}), page = await context.newPage();
    const origin = process.env.UX_FIXTURE_URL || 'http://127.0.0.1:5198';
    const car = {id:2,marca:'Toyota',modelo:'Corolla',anio:2020,kilometraje:42000,precio_centavos:1450000,ubicacion:'Managua',disponibilidad:'disponible',updated_at:'2026-11-09T12:00:00+00:00',descripcion:'Vehículo ficticio.',fotografias:[]};
    let auth=false, retired=false, attempts=0, conflict=true, failure=false;
    await page.route('**/*', async route => {
      const req=route.request(),u=new URL(req.url());
      if(u.origin!==origin) return route.abort();
      if(!u.pathname.startsWith('/api/')) return route.continue();
      let status=200,data={ok:true,csrf_token:'fixture'};
      if(u.pathname==='/api/admin/session')data={ok:true,autenticado:auth,solo_lectura:false};
      else if(u.pathname==='/api/admin/login')auth=true;
      else if(u.pathname==='/api/vehiculos')data={ok:true,vehiculos:retired?[]:[car]};
      else if(u.pathname==='/api/vehiculos/2/retirar'){
        attempts++;
        assert.equal(req.postDataJSON().version_esperada,car.updated_at);
        await new Promise(resolve=>setTimeout(resolve,120));
        if(failure){status=503;data={ok:false,mensaje:'Fallo temporal simulado.'};}
        else if(conflict){status=409;data={ok:false,mensaje:'El vehículo cambió. Actualizá el inventario.'};}
        else retired=true;
      }
      await route.fulfill({status,json:data});
    });
    await page.goto(origin+'/administracion');
    await page.locator('#admin-password').fill('temporal');
    await page.locator('#admin-login-form button').click();
    const cards=page.locator(width===390?'#admin-inventory-mobile':'#admin-inventory-list');
    const action=cards.getByRole('button',{name:width===390?'Retirar publicación':'Retirar',exact:true});
    await action.click();
    assert.match(await page.locator('#admin-retire-title').innerText(),/Toyota Corolla/);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'admin-retire-cancel');
    if (process.env.RETIRE_CAPTURE_DIR) {
      await page.waitForTimeout(350);
      await page.screenshot({path:require('node:path').join(process.env.RETIRE_CAPTURE_DIR,`retiro-${width}.png`)});
    }
    await page.locator('#admin-retire-cancel').click();
    assert.equal(attempts,0);
    await action.click();
    await page.locator('#admin-retire-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#admin-retire-feedback').textContent.includes('cambió'));
    assert.equal(retired,false);
    await page.locator('#admin-retire-cancel').click();
    conflict=false;
    failure=true;
    await action.click();
    await page.locator('#admin-retire-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#admin-retire-feedback').textContent.includes('Fallo temporal'));
    assert.equal(retired,false);
    failure=false;
    await page.locator('#admin-retire-confirm').evaluate(b=>{b.click();b.click();});
    await page.waitForFunction(()=>!document.querySelector('#admin-retire-dialog').open);
    await page.waitForFunction(()=>document.querySelector('#admin-inventory-empty').hidden===false);
    assert.equal(attempts,3);
    assert.equal(retired,true);
    assert.match(await page.locator('#admin-status').innerText(),/Publicación retirada/);
    console.log(`${width}px: cancelación, conflicto y retiro verificados`);
    await context.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
