import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getVersion } = require('prismarine-viewer/viewer/lib/version.js');
const Block = require('prismarine-block');
const mcData = require('minecraft-data');
const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan');

export function renderCompatibility(sourceVersion) {
    const renderVersion = getVersion(sourceVersion);
    if (!renderVersion) throw new Error(`No renderer assets for Minecraft ${sourceVersion}`);
    const unsupportedBlocks = new Set();
    const cache = new Map();
    const source = Block(sourceVersion);
    const target = Block(renderVersion);
    const targetData = mcData(renderVersion);
    function state(id) {
        if (sourceVersion === renderVersion) return id;
        if (cache.has(id)) return cache.get(id);
        const block = source.fromStateId(id, 0);
        let mapped;
        if (targetData.blocksByName[block.name]) {
            mapped = target.fromProperties(block.name, block.getProperties(), 0).stateId;
        } else {
            unsupportedBlocks.add(block.name);
            mapped = targetData.blocksByName.air.defaultState;
        }
        cache.set(id, mapped);
        return mapped;
    }
    function chunk(json) {
        if (sourceVersion === renderVersion) return json;
        const copy = JSON.parse(json);
        copy.sections = copy.sections.map(text => {
            const section = JSON.parse(text);
            const data = JSON.parse(section.data);
            if (data.type === 'single') data.value = state(data.value);
            else if (data.type === 'indirect') data.palette = data.palette.map(state);
            else if (data.type === 'direct') {
                const array = BitArray.fromJson(data.data);
                for (let i = 0; i < array.capacity; i++) array.set(i, state(array.get(i)));
                data.data = array.toJson();
            } else throw new Error(`Unsupported chunk palette: ${data.type}`);
            section.data = JSON.stringify(data);
            return JSON.stringify(section);
        });
        return JSON.stringify(copy);
    }
    return { sourceVersion, renderVersion, unsupportedBlocks, state, chunk };
}
