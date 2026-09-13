<template>
  <aside v-if="visible" class="standings" :aria-label="$t('ROOM.STANDINGS')">
    <ol class="standings__list">
      <li
        v-for="rider in shown"
        :key="rider.id"
        class="standings__row"
        :class="{ 'is-self': rider.self }"
      >
        <span class="standings__rank">{{ rider.rank }}</span>
        <span class="standings__dot" :style="{ background: rider.color }"></span>
        <span class="standings__name">{{ rider.name }}</span>
        <span class="standings__gap">{{ gapLabel(rider) }}</span>
      </li>
    </ol>
    <p v-if="hidden > 0" class="standings__more">{{ $t('ROOM.MORE', { count: hidden }) }}</p>
  </aside>
</template>

<script setup>
/*
 * RaceStandings — qui est devant, et de combien.
 *
 * Muet comme le reste du tableau de bord : on lui passe une liste déjà classée
 * (cf. `peloton.standings`), il l'affiche. Il ne lit ni la salle ni la séance.
 *
 * Le panneau ne montre pas tout le monde : au-delà d'une poignée de lignes, il
 * couvre la route. Les premiers sont toujours là ; le coureur local aussi,
 * même s'il est dernier — c'est la seule ligne qu'il cherche.
 */
import { computed } from 'vue';

const props = defineProps({
  /** Coureurs classés, du premier au dernier. */
  standings: { type: Array, default: () => [] },
  /** Lignes affichées avant de renvoyer le reste au compteur. */
  limit: { type: Number, default: 6 },
});

const visible = computed(() => props.standings.length > 1);

const shown = computed(() => {
  const list = props.standings;
  if (list.length <= props.limit) return list;

  const head = list.slice(0, props.limit);
  if (head.some((rider) => rider.self)) return head;

  // Le coureur local prend la dernière place du panneau : sa position dans la
  // course est ce qu'il regarde, et une liste qui ne le contient pas ne lui
  // apprend rien.
  const self = list.find((rider) => rider.self);
  return self ? [...head.slice(0, props.limit - 1), self] : head;
});

const hidden = computed(() => Math.max(0, props.standings.length - shown.value.length));

/** Écart au premier. Le leader porte son rang, pas un zéro. */
function gapLabel(rider) {
  if (rider.rank === 1) return '';
  const gap = rider.gapM;
  return gap >= 1000 ? `−${(gap / 1000).toFixed(1)} km` : `−${Math.round(gap)} m`;
}
</script>

<style scoped>
.standings {
  position: absolute;
  top: max(4.4rem, calc(env(safe-area-inset-top) + 4.4rem));
  left: 0.9rem;
  min-width: 10.5rem;
  max-width: 15rem;
  padding: 0.4rem 0.5rem;
  border-radius: 12px;
  border: 1px solid var(--c-border);
  background: color-mix(in srgb, var(--c-bg) 82%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
  pointer-events: none;
}

.standings__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.standings__row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0;
  font-size: 0.78rem;
  color: var(--c-text-soft);
}

.standings__row.is-self {
  color: var(--c-text);
  font-weight: 600;
}

.standings__rank {
  min-width: 1.1em;
  font-family: 'Fugaz One', 'Inter', sans-serif;
  letter-spacing: var(--fugaz-letter-spacing, -0.02em);
  text-align: right;
  color: var(--c-text-muted);
}

.standings__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--c-icon);
  flex: none;
}

.standings__name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.standings__gap {
  font-variant-numeric: tabular-nums;
  color: var(--c-text-muted);
}

.standings__more {
  margin: 0.2rem 0 0;
  font-size: 0.7rem;
  color: var(--c-text-muted);
}
</style>
