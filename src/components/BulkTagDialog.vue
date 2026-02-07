<template>
    <div ref="modal" class="modal fade" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-body">
                    <h4>{{ dialogTitle }}</h4>

                    <vue-multiselect
                        v-model="selectedTag"
                        class="mb-2"
                        :options="tagOptions"
                        :multiple="false"
                        :searchable="true"
                        :placeholder="$t('Add New below or Select...')"
                        track-by="id"
                        label="name"
                    >
                        <template #option="{ option }">
                            <div
                                class="mx-2 py-1 px-3 rounded d-inline-flex"
                                style="margin-top: -5px; margin-bottom: -5px; height: 24px"
                                :style="{ color: textColor(option), backgroundColor: option.color + ' !important' }"
                            >
                                <span>{{ option.name }}</span>
                            </div>
                        </template>
                        <template #singleLabel="{ option }">
                            <div
                                class="py-1 px-3 rounded d-inline-flex"
                                style="height: 24px"
                                :style="{ color: textColor(option), backgroundColor: option.color + ' !important' }"
                            >
                                <span>{{ option.name }}</span>
                            </div>
                        </template>
                    </vue-multiselect>

                    <div v-if="currentMode === 'add'" class="mb-2">
                        <input
                            v-model="tagValue"
                            class="form-control"
                            :placeholder="$t('value (optional)')"
                        />
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" @click="close">
                        {{ $t("Cancel") }}
                    </button>
                    <button
                        type="button"
                        class="btn btn-primary"
                        :disabled="!selectedTag"
                        @click="apply"
                    >
                        {{ $t("Apply") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";
import VueMultiselect from "vue-multiselect";

export default {
    components: {
        VueMultiselect,
    },
    props: {
        /** Object of selected monitor IDs (keyed by ID) */
        selectedMonitors: {
            type: Object,
            required: true,
        },
    },
    emits: [ "apply" ],
    data() {
        return {
            modal: null,
            currentMode: "add",
            existingTags: [],
            selectedTag: null,
            tagValue: "",
        };
    },
    computed: {
        /**
         * Title for the dialog based on current mode
         * @returns {string} Dialog title
         */
        dialogTitle() {
            return this.currentMode === "add" ? this.$t("Add Tag") : this.$t("Remove Tag");
        },

        /**
         * Tags available in the picker.
         * Add mode: all tags. Remove mode: only tags on selected monitors.
         * @returns {Array} Tag options
         */
        tagOptions() {
            if (this.currentMode === "add") {
                return this.existingTags;
            }

            // Remove mode: only show tags present on at least one selected monitor
            const monitorIds = Object.keys(this.selectedMonitors);
            const tagIdsOnSelected = new Set();
            for (const id of monitorIds) {
                const monitor = this.$root.monitorList[id];
                if (monitor && monitor.tags) {
                    for (const tag of monitor.tags) {
                        tagIdsOnSelected.add(tag.tag_id);
                    }
                }
            }
            return this.existingTags.filter((tag) => tagIdsOnSelected.has(tag.id));
        },
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    beforeUnmount() {
        if (this.modal) {
            this.modal.dispose();
            this.modal = null;
        }
    },
    methods: {
        /**
         * Show the dialog
         * @param {string} mode "add" or "remove"
         * @returns {void}
         */
        show(mode) {
            this.currentMode = mode;
            this.selectedTag = null;
            this.tagValue = "";
            this.getExistingTags();
            this.modal.show();
        },

        /**
         * Close the dialog
         * @returns {void}
         */
        close() {
            this.modal.hide();
        },

        /**
         * Fetch all existing tags from server
         * @returns {void}
         */
        getExistingTags() {
            this.$root.getSocket().emit("getTags", (res) => {
                if (res.ok) {
                    this.existingTags = res.tags;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        /**
         * Get text color for tag display
         * @param {object} option Tag option
         * @returns {string} CSS color value
         */
        textColor(option) {
            if (option.color) {
                return "white";
            }
            return this.$root.theme === "light" ? "var(--bs-body-color)" : "inherit";
        },

        /**
         * Emit apply event and close dialog
         * @returns {void}
         */
        apply() {
            if (!this.selectedTag) {
                return;
            }

            this.$emit("apply", {
                tagID: this.selectedTag.id,
                tagName: this.selectedTag.name,
                value: this.tagValue,
                mode: this.currentMode,
            });

            this.close();
        },
    },
};
</script>
