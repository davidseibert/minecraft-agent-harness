import { pathToFileURL } from 'node:url';
import { choice, integer, number, object, text } from './game/schema.js';

export const schema = Object.freeze({ text, number, integer, choice, object });

export async function loadToolsModule(file, context) {
    const mod = await import(pathToFileURL(file).href);
    const create = mod.default ?? mod.createTools;
    if (typeof create !== 'function')
        throw new Error(`${file} must export a default function that returns a list of tools`);
    const specs = await create({ ...context, schema });
    if (!Array.isArray(specs)) throw new Error(`${file} must return an array of tools`);
    return specs;
}
