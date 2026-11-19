// One capture run at a time across workers: an exclusive lock file holding the
// owner pid. A lock whose pid is dead is reclaimed.
import { open, readFile, unlink } from 'node:fs/promises';

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export async function acquireLock(
  file,
  { pollMs = 2000, isAlive = alive, onWait } = {},
) {
  let announced = false;
  for (;;) {
    try {
      const handle = await open(file, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return async () => {
        // Remove only our own lock.
        if (
          (await readFile(file, 'utf8').catch(() => '')) === String(process.pid)
        )
          await unlink(file).catch(() => undefined);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const owner = Number.parseInt(
      await readFile(file, 'utf8').catch(() => ''),
      10,
    );
    if (Number.isInteger(owner) && !isAlive(owner)) {
      // Re-read before removing so a lock taken meanwhile is not deleted.
      if ((await readFile(file, 'utf8').catch(() => '')) === String(owner))
        await unlink(file).catch(() => undefined);
      continue;
    }
    if (!announced && onWait) onWait(owner);
    announced = true;
    await new Promise((done) => setTimeout(done, pollMs));
  }
}
