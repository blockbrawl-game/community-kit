// `brawl-modes check`: everything review checks, in one command, with one verdict.
//
//   policy   no eval, network, workers, typed arrays or Math.random in the mode's sources
//   test     fuzz, sync, determinism, hydration and size budgets (`brawl-modes test`)
//   bench    work units within the server's gates (`brawl-modes bench`)
//   build    the bundle and client build, and the hashes a reviewer approves (`brawl-modes build`)
//
// The review server runs this same command on the submitted source. Passing here is the bar for
// submitting; a person still reads and plays the mode before it goes live.
import { bundleClient, bundleServer, hashText, isOffline, limits, loadMode } from './build.js';
import { checkPolicy } from './policy.js';

export async function runCheck({ modeName, report = {} }) {
  const mode = await loadMode(modeName);
  const { manifest } = mode;
  const steps = {};
  console.log(`Checking ${manifest.id} ${manifest.version}\n`);

  const policy = checkPolicy(mode);
  steps.policy = { passed: policy.length === 0, failures: policy };
  console.log(policy.length === 0 ? 'policy  ok' : `policy  FAIL\n${policy.map((p) => `  - ${p}`).join('\n')}`);

  console.log('\ntest');
  if (isOffline(manifest)) {
    // An offline mode is only a client: nothing to fuzz or replay, only its size to check.
    const bytes = Buffer.byteLength(await bundleClient(mode));
    const ok = bytes <= limits.maxClientBytes;
    steps.test = { passed: ok, failures: ok ? [] : [`built client is ${bytes} bytes (limit ${limits.maxClientBytes})`], budgets: { clientBytes: bytes } };
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  client ${bytes} bytes (limit ${limits.maxClientBytes})`);
  } else {
    const { runTests } = await import('./test.js');
    steps.test = {};
    await runTests({ modeName, report: steps.test });
  }

  console.log('\nbench');
  const { runBench } = await import('./bench.js');
  steps.bench = {};
  await runBench({ modeName, report: steps.bench });

  console.log('\nbuild');
  try {
    const client = await bundleClient(mode);
    const server = isOffline(manifest) ? null : await bundleServer(mode);
    const key = `${manifest.id}@${manifest.version}`;
    steps.build = {
      passed: true,
      hashes: { [`${key}#client`]: hashText(client), ...(server ? { [key]: hashText(server) } : {}) },
    };
    for (const [name, hash] of Object.entries(steps.build.hashes)) console.log(`  ${name}: ${hash}`);
  } catch (error) {
    steps.build = { passed: false, failures: [error.message] };
    console.log(`  FAIL  ${error.message}`);
  }

  const failed = Object.entries(steps).filter(([, step]) => !step.passed).map(([name]) => name);
  const passed = failed.length === 0;
  console.log(passed ? '\nREADY TO SUBMIT' : `\nNOT READY: ${failed.join(', ')} failed`);
  Object.assign(report, { passed, mode: { id: manifest.id, version: manifest.version }, failed, steps });
  return passed;
}
