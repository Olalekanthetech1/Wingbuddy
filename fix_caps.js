const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  try {
    const { models } = await request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/models',
      method: 'GET'
    });
    
    for (const m of models) {
      const id = m.modelId.toLowerCase();
      let newCaps = [...(m.capabilities || [])];
      let changed = false;
      
      if (id.includes('flux') || id.includes('image') || id.includes('sdxl') || id.includes('stable-diffusion')) {
        if (!newCaps.includes('image_generation')) {
          newCaps.push('image_generation');
          changed = true;
        }
      }
      if (id.includes('wan') || id.includes('video') || id.includes('sora') || id.includes('kling')) {
        if (!newCaps.includes('video_generation')) {
          newCaps.push('video_generation');
          changed = true;
        }
      }
      
      if (changed) {
        console.log('Updating capabilities for:', m.modelId);
        await request({
          hostname: 'localhost',
          port: 3000,
          path: '/api/models/' + encodeURIComponent(m.id),
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' }
        }, { capabilities: newCaps });
      }
    }
    console.log("Done updating!");
  } catch(e) {
    console.error(e);
  }
}
run();
