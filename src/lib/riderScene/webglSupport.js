/*
 * Le décor 3D n'est pas une option d'affichage : sans WebGL, il n'y a rien à
 * montrer. La sonde répond une fois pour toutes — un appareil ne se met pas à
 * supporter WebGL en cours de partie — et ne lève jamais : un navigateur qui
 * refuse le contexte doit faire retomber le joueur sur la carte, pas sur une
 * erreur.
 */
export function detectWebglSupport(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return false;
  try {
    const probe = doc.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

export default detectWebglSupport;
