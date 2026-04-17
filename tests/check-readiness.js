async function checkUrl(url, name) {
  const start = Date.now();
  const timeout = 120000; // 2 minutes
  process.stdout.write(`⏳ Waiting for ${name} (${url})`);
  
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.status < 500) {
        console.log(`\n✅ ${name} is ready!`);
        return true;
      }
    } catch (e) {
      // ignore
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`\n❌ ${name} timed out.`);
  return false;
}

async function main() {
  const results = await Promise.all([
    checkUrl('http://127.0.0.1:4101/api/auth/ok', 'IdP'),
    checkUrl('http://127.0.0.1:4100', 'Portal'),
    checkUrl('http://127.0.0.1:4102', 'Demo App')
  ]);

  
  if (results.every(r => r)) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
