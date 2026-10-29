// Models the bundled pi catalog doesn't list yet. Each one borrows the settings of a close catalog
// model from the same provider. Once the catalog has its own entry, that entry is used instead.
const EXTRA_MODELS = {
    openai: {
        'gpt-6.1-terra': { like: 'gpt-5.6-terra', name: 'GPT-6.1 Terra' },
    },
};

export function findModel(runtime, provider, id) {
    const model = runtime.getModel(provider, id);
    if (model) return model;
    const extra = EXTRA_MODELS[provider]?.[id];
    const like = extra && runtime.getModel(provider, extra.like);
    return like ? { ...like, id, name: extra.name } : undefined;
}

export function extraModelIds(runtime, provider) {
    return Object.keys(EXTRA_MODELS[provider] ?? {}).filter(
        id => !runtime.getModel(provider, id) && findModel(runtime, provider, id),
    );
}
