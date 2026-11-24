import { lstat, mkdtemp, open, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

async function requireWritable(directory, label) {
  try {
    const probe = await mkdtemp(join(directory, '.nexus-write-'));
    await rmdir(probe);
  } catch (error) {
    throw new Error(`${label} deve existir e permitir gravação (${error.code ?? 'erro'}).`);
  }
}

export async function verifyExecutorPermissions({codexHome,gitDirectory,receipts}) {
  await requireWritable(codexHome, 'O diretório de estado do Codex (CODEX_HOME)');
  try {
    const installation = join(codexHome, 'installation_id');
    const info = await lstat(installation).catch(error=>{
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info) {
      if (!info.isFile()) throw new Error('tipo inválido');
      const handle = await open(installation, 'r+');
      await handle.close();
    }
  } catch (error) {
    throw new Error(`O arquivo de estado installation_id deve ser regular e gravável (${error.code ?? 'tipo inválido'}).`);
  }
  await requireWritable(gitDirectory, 'O diretório de metadados do Git');
  await requireWritable(receipts, 'O diretório privado de recibos e worktrees');
}
