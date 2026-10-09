import { exportArchiveSources } from './offline-source-export.js';
import { seedVaultKey } from './offline-vault.js';

self.onmessage = async ({data}) => {
  seedVaultKey(data.account, data.vaultKey);
  try {
    const result = await exportArchiveSources({...data, onProgress:progress => self.postMessage({progress})});
    self.postMessage({result});
  } catch {
    self.postMessage({error:true});
  } finally {
    seedVaultKey(data.account, null);
  }
};
