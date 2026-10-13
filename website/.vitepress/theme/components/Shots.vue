<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ base: string; items: Array<{ file: string; caption: string }> }>()
const open = ref<number | null>(null)
</script>

<template>
  <div class="shots">
    <figure v-for="(it, i) in props.items" :key="it.file" @click="open = i">
      <img :src="`${props.base}/${it.file}`" :alt="it.caption" loading="lazy" />
      <figcaption>{{ it.caption }}</figcaption>
    </figure>
  </div>
  <div v-if="open !== null" class="lightbox" @click="open = null">
    <img :src="`${props.base}/${props.items[open].file}`" :alt="props.items[open].caption" />
    <p>{{ props.items[open].caption }}</p>
  </div>
</template>

<style scoped>
.shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 20px 0; }
figure { margin: 0; cursor: zoom-in; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-soft); }
img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; }
figcaption { padding: 8px 12px; font-size: 13px; color: var(--vp-c-text-2); }
.lightbox { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, 0.82); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; cursor: zoom-out; }
.lightbox img { max-width: 100%; max-height: 85vh; width: auto; aspect-ratio: auto; object-fit: contain; border-radius: 8px; }
.lightbox p { color: #ddd; font-size: 14px; }
@media (max-width: 640px) { .shots { grid-template-columns: 1fr; } }
</style>
