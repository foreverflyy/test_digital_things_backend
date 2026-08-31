const targets = [
  { name: 'api', url: 'http://localhost:3010/healthz' },
  { name: 'supplier-a', url: 'http://localhost:4001/healthz' },
  { name: 'supplier-b', url: 'http://localhost:4002/healthz' },
];

const deadline = Date.now() + 120_000;

for (const target of targets) {
  for (;;) {
    if (Date.now() > deadline) {
      console.error(`timeout waiting for ${target.name}`);
      process.exit(1);
    }
    try {
      const response = await fetch(target.url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        console.log(`${target.name} ready`);
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

await fetch('http://localhost:3010/admin/recovery/run', { method: 'POST' });
console.log('остатки синхронизированы');
