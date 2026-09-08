# CLAUDE.md — règles de travail sur dot-racing-indoor

## Vérification visuelle : ce n'est pas à toi de la faire

Ce projet produit un paysage et un mouvement : leur qualité se constate à
l'œil, et c'est le rôle de l'auteur — pas le tien.

- ne lance pas l'application, ne prends pas de capture, n'ouvre pas de
  navigateur pour « aller voir si ça rend bien » ;
- n'affirme jamais qu'un changement « rend mieux », « est plus fluide » ou
  « se sent mieux à la pédale » : tu ne l'as pas vu ni senti ;
- décris ce que le code **fait**, pas l'effet que tu supposes qu'il produira ;
- à la fin d'un chantier, dis explicitement ce qui reste à vérifier à l'œil, et
  où le regarder.

Ce qui est vérifiable sans les yeux doit l'être vraiment : `npm test`,
`npm run build`, le nombre de tests avant et après. Rapporte ces chiffres tels
quels, sans les arrondir dans le bon sens.

## Le vocabulaire du projet

Code, commentaires et tests sont **en français**. Les commentaires expliquent
*pourquoi*, pas *quoi* — un commentaire qui paraphrase la ligne suivante est du
bruit. Les modules portent un en-tête qui dit leur raison d'être et les
décisions qu'on ne doit pas défaire par inadvertance ; quand tu modifies un
module en profondeur, cet en-tête fait partie du diff.

## La frontière avec worldpaint

Le générateur de paysage vit dans son propre dépôt,
[jbmvl/worldpaint](https://github.com/jbmvl/worldpaint), consommé comme une
dépendance Git. Donc **toujours** `import { … } from 'worldpaint'`, jamais un
chemin relatif ni `@/`.

Pour corriger le décor : cloner `worldpaint` à part, faire le changement
là-bas avec son test, publier un commit, puis mettre à jour la référence dans
`package.json`. Rien de ce dépôt n'est importé par `worldpaint`, et three.js
lui est injecté, jamais importé par lui.

## Ce qui vient de Dot Racing

`src/lib/riderScene/`, `src/components/ui/`, `src/stores/`, `src/assets/main.css`
et `src/styles/dark-mode.css` sont **copiés** de
[jbmvl/1230-bornes](https://github.com/jbmvl/1230-bornes), pas partagés. La
divergence est assumée : ce sont deux jeux différents. Si un correctif vaut
pour les deux, il se porte à la main, dans les deux sens.

## La règle qui structure tout : qui possède la distance

Dot Racing est une simulation **asynchrone** — le serveur diffuse une position
toutes les cinq secondes, et le client passe son temps à rattraper ce retard
sans que cela se voie. Ici, **le client possède sa distance** : elle avance
sous les jambes du joueur, à chaque image.

Conséquence pratique, et elle revient souvent : l'horloge de course, le suiveur
de distance et l'ancre de tracé de Dot Racing n'ont pas lieu d'être pour le
coureur local. Les rebrancher serait une régression, pas un rattrapage.
(`raceClock.js` reste présent parce que la **foule** — les autres joueurs, dont
les positions arrivent bien par un flux — s'en sert.)

## Portée d'un chantier

- Une étape à la fois, telle qu'elle a été demandée. Pas de refactor préventif,
  pas d'abstraction « pendant qu'on y est », pas de système générique tant
  qu'il n'a pas deux sites d'appel réels.
- Aucun objet three.js ne doit devenir réactif : un `ref()` autour d'une scène
  WebGL fait proxifier son graphe interne par Vue et fige l'onglet. Les objets
  3D vivent dans des variables de fermeture ; seuls des scalaires remontent.
- Tout ce qui est alloué est libéré au démontage (`dispose()` +
  `forceContextLoss()`).
- La **pente** est la valeur sensible : elle entre dans le calcul de vitesse,
  donc dans ce que les jambes ressentent. Toute modification de la lecture
  d'altitude se teste.

## Ce qu'on attend en fin de tâche

1. le nombre de tests avant / après, et le résultat réel de `npm test` ;
2. la liste exacte des fichiers modifiés ;
3. ce qui a été délibérément laissé hors périmètre, et pourquoi ;
4. ce qui reste à contrôler à l'œil, et où.
