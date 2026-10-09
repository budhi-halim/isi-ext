import { collectArchiveReport } from './offline-report.js';
import { seedVaultKey } from './offline-vault.js';

self.onmessage = async ({data}) => {
  seedVaultKey(data.account,data.vaultKey);
  try {
    const report = await collectArchiveReport({...data,onSource:source => self.postMessage({source})});
    self.postMessage({report});
  } catch {
    self.postMessage({error:'The local report could not finish. Unlock the saved copy again, then retry.'});
  } finally {
    seedVaultKey(data.account,null);
  }
};
