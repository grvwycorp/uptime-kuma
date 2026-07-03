<template>
    <slot />
</template>

<script setup lang="ts">
const { resolved, init } = useColorMode();

useHead({
    htmlAttrs: { "data-theme": resolved },
});

onMounted(() => {
    init();
});
</script>
