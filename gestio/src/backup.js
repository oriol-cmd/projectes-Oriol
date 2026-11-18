// Còpies de seguretat: base de dades + documents en un .tar.gz
// Ús des de la línia d'ordres: node src/backup.js <carpeta-destí> [dies-a-conservar]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Fa una còpia coherent de la base de dades (encara que el servidor estigui funcionant)
function snapshot(db) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gestio-copia-'));
  const file = path.join(tmp, 'gestio.db');
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return tmp;
}

// Retorna un procés tar que escriu el .tar.gz per stdout
function backupStream(db, dataDir) {
  const tmp = snapshot(db);
  const args = ['czf', '-', '-C', tmp, 'gestio.db'];
  if (fs.existsSync(path.join(dataDir, 'uploads'))) args.push('-C', dataDir, 'uploads');
  const tar = spawn('tar', args);
  const cleanup = () => fs.rm(tmp, { recursive: true, force: true }, () => {});
  tar.on('close', cleanup);
  tar.on('error', cleanup);
  return tar;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

module.exports = { backupStream, stamp };

if (require.main === module) {
  const dest = process.argv[2];
  const keepDays = Number(process.argv[3] || 14);
  if (!dest) { console.error('Ús: node src/backup.js <carpeta-destí> [dies-a-conservar]'); process.exit(1); }
  fs.mkdirSync(dest, { recursive: true });
  const { db, DATA_DIR } = require('./db');
  const out = path.join(dest, `gestio-${stamp()}.tar.gz`);
  const tar = backupStream(db, DATA_DIR);
  tar.stdout.pipe(fs.createWriteStream(out));
  tar.stderr.pipe(process.stderr);
  tar.on('close', code => {
    if (code !== 0) { console.error('La còpia ha fallat'); process.exit(1); }
    // esborra les còpies antigues
    const limit = Date.now() - keepDays * 86400000;
    for (const f of fs.readdirSync(dest)) {
      if (/^gestio-.*\.tar\.gz$/.test(f) && fs.statSync(path.join(dest, f)).mtimeMs < limit) fs.rmSync(path.join(dest, f));
    }
    console.log('Còpia desada a', out);
  });
}
