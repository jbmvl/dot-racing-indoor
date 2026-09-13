/*
 * worldpaint — amène le décor à la dernière version de `main`, au build.
 * ---------------------------------------------------------------------
 *
 * `worldpaint` vit dans son propre dépôt et n'est pas publié sur npm : il est
 * consommé comme une **archive HTTPS figée sur un commit** (cf. `CLAUDE.md`
 * pour la raison — le raccourci `github:` est réécrit en `git+ssh://` dans le
 * lockfile, et `npm ci` échoue alors sur toute machine de build sans clé SSH).
 *
 * Le prix de ce gel était qu'une correction du décor ne descendait plus toute
 * seule : il fallait remplacer le SHA à la main. Ce script fait ce geste-là,
 * automatiquement, avant chaque build.
 *
 * ## Pourquoi un script, et pas simplement une URL de branche
 *
 * `…/archive/refs/heads/main.tar.gz` paraît suffire. Elle ne suffit pas : npm
 * inscrit dans le lockfile une **empreinte d'intégrité** du contenu téléchargé.
 * Le jour où `main` bouge, l'archive change, l'empreinte ne correspond plus, et
 * l'installation s'arrête sur un `EINTEGRITY` — une panne de build qui ne
 * ressemble en rien à sa cause. Une URL mouvante et un lockfile ne peuvent pas
 * coexister.
 *
 * On garde donc une URL figée, et c'est **le SHA qu'on déplace** : la référence
 * est résolue par `git ls-remote`, l'URL réécrite, et `npm install` recalcule
 * l'empreinte qui va avec. Le lockfile reste exact, et deux installations du
 * même commit installent le même décor.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'échoue jamais le build. Sans réseau — ou si GitHub est injoignable —,
 * on construit avec le commit déjà figé : un décor de la semaine dernière vaut
 * mieux qu'un déploiement manqué.
 *
 * ## Reproduire un build ancien
 *
 * `WORLDPAINT_REF` impose une référence : un SHA pour refaire à l'identique un
 * build passé, un nom de branche pour essayer un décor en cours.
 *
 *     WORLDPAINT_REF=19e3c3eb842feced215345401ee2ae9e5ff65217 npm run build
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'package.json');
const REPO = 'https://github.com/jbmvl/worldpaint';
const REF = process.env.WORLDPAINT_REF || 'main';

const archiveUrl = (sha) => `${REPO}/archive/${sha}.tar.gz`;
const SHA_PATTERN = /\/archive\/([0-9a-f]{40})\.tar\.gz$/;

/** Le SHA actuellement figé dans le manifeste. */
function pinnedSha(manifest) {
  const url = manifest.dependencies?.worldpaint ?? '';
  return url.match(SHA_PATTERN)?.[1] ?? null;
}

/**
 * Le commit que `REF` désigne aujourd'hui.
 *
 * `git ls-remote` plutôt que l'API GitHub : celle-ci limite les appels anonymes
 * par adresse, et une machine de build partage la sienne avec beaucoup d'autres
 * — la panne serait intermittente, donc incompréhensible.
 */
function resolveSha() {
  if (/^[0-9a-f]{40}$/.test(REF)) return REF;
  const output = execFileSync('git', ['ls-remote', REPO, `refs/heads/${REF}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  const sha = output.split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`référence introuvable : ${REF}`);
  return sha;
}

function main() {
  const original = readFileSync(MANIFEST, 'utf8');
  const manifest = JSON.parse(original);
  const pinned = pinnedSha(manifest);

  if (!pinned) {
    console.warn('[worldpaint] dépendance absente ou sous une autre forme — rien à faire');
    return;
  }

  let target;
  try {
    target = resolveSha();
  } catch (e) {
    // Pas de réseau, ou GitHub muet : on construit avec ce qui est figé.
    console.warn(`[worldpaint] ${REF} non résolu (${e.message.trim()}) — on garde ${pinned.slice(0, 7)}`);
    return;
  }

  if (target === pinned) {
    console.info(`[worldpaint] déjà sur ${REF} (${target.slice(0, 7)})`);
    return;
  }

  console.info(`[worldpaint] ${pinned.slice(0, 7)} → ${target.slice(0, 7)} (${REF})`);
  manifest.dependencies.worldpaint = archiveUrl(target);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  try {
    // `--include=dev` est chargé : une machine de build pose souvent
    // `NODE_ENV=production`, et une installation qui élaguerait les
    // dépendances de développement emporterait Vite au milieu de son propre
    // build. `npm install` recalcule au passage l'empreinte du lockfile.
    execFileSync('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 600_000,
    });
  } catch (e) {
    // L'archive n'a pas pu être installée : on rend le manifeste tel qu'il
    // était, pour ne pas laisser un `package.json` qui annonce un décor absent
    // du lockfile — `npm ci` refuserait alors de s'installer du tout.
    writeFileSync(MANIFEST, original);
    console.warn(`[worldpaint] installation impossible — on garde ${pinned.slice(0, 7)}`);
  }
}

main();
