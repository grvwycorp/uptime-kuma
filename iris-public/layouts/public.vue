<template>
    <slot />
</template>

<script setup lang="ts">
const { resolved, init } = useColorMode();

useHead({
    title: "Iris",
    htmlAttrs: { "data-theme": resolved },
});

onMounted(() => {
    init();
});
</script>
